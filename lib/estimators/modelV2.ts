/**
 * Estimator V2 - Self-Improving Estimator
 * 
 * Uses historical observations to calibrate estimates.
 * Starts with deterministic heuristic, adds learned calibration layer.
 */

export interface EstimatorModel {
  id: string;
  marketplace: string;
  model_version: string;
  model_type: 'search_volume' | 'revenue_estimate';
  coefficients_json: {
    intercept: number;
    page1_count_coef: number;
    avg_reviews_log_coef: number;
    sponsored_pct_coef: number;
    avg_price_coef: number;
    category_multipliers?: Record<string, number>;
  };
  trained_at: string;
  training_rows: number;
  training_metadata?: {
    r_squared?: number;
    mae?: number;
    feature_importance?: Record<string, number>;
  };
}

export interface EstimatorInputs {
  page1_count: number;
  avg_reviews: number;
  sponsored_count: number;
  avg_price: number | null;
  category?: string;
}

/**
 * Get active model for marketplace and type
 */
export async function getActiveModel(
  supabase: any,
  marketplace: string,
  modelType: 'search_volume' | 'revenue_estimate'
): Promise<EstimatorModel | null> {
  try {
    const { data, error } = await supabase
      .from("estimator_models")
      .select("*")
      .eq("marketplace", marketplace)
      .eq("model_type", modelType)
      .eq("is_active", true)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return {
      id: data.id,
      marketplace: data.marketplace,
      model_version: data.model_version,
      model_type: data.model_type,
      coefficients_json: data.coefficients_json,
      trained_at: data.trained_at,
      training_rows: data.training_rows,
      training_metadata: data.training_metadata || undefined,
    };
  } catch (error) {
    console.error("Failed to get active model:", error);
    return null;
  }
}

/**
 * Estimate search volume using V2 model (with calibration)
 */
export async function estimateSearchVolumeV2(
  supabase: any,
  inputs: EstimatorInputs,
  marketplace: string = "US"
): Promise<{
  min: number;
  max: number;
  source: string;
  confidence: 'low' | 'medium' | 'high';
  model_version: string;
}> {
  // Start with deterministic heuristic (current v1)
  const { estimateSearchVolume } = await import("@/lib/amazon/searchVolumeEstimator");
  const baseEstimate = estimateSearchVolume({
    page1Listings: Array(inputs.page1_count).fill({}), // Dummy array for count
    sponsoredCount: inputs.sponsored_count,
    avgReviews: inputs.avg_reviews,
    category: inputs.category,
  });
  
  // Try to get active V2 model for calibration
  const model = await getActiveModel(supabase, marketplace, 'search_volume');
  
  if (!model) {
    // No model available - return base estimate with v1 source
    return {
      ...baseEstimate,
      source: 'model_v1',
      model_version: 'v1.0',
    };
  }
  
  // Apply calibration layer
  const coeffs = model.coefficients_json;
  const avgReviewsLog = inputs.avg_reviews > 0 ? Math.log(inputs.avg_reviews + 1) : 0;
  const sponsoredPct = inputs.page1_count > 0 
    ? (inputs.sponsored_count / inputs.page1_count) * 100 
    : 0;
  const avgPrice = inputs.avg_price || 0;
  
  // Linear calibration: calibrated = base * (1 + calibration_adjustment)
  const calibrationAdjustment = 
    coeffs.intercept +
    (coeffs.page1_count_coef * inputs.page1_count) +
    (coeffs.avg_reviews_log_coef * avgReviewsLog) +
    (coeffs.sponsored_pct_coef * sponsoredPct) +
    (coeffs.avg_price_coef * avgPrice);
  
  // Apply category multiplier if available
  const categoryMultiplier = inputs.category && coeffs.category_multipliers
    ? (coeffs.category_multipliers[inputs.category] || 1.0)
    : 1.0;
  
  const calibratedVolume = baseEstimate.min * (1 + calibrationAdjustment) * categoryMultiplier;
  
  // Return calibrated range
  return {
    min: Math.round(calibratedVolume * 0.7),
    max: Math.round(calibratedVolume * 1.3),
    source: 'model_v2',
    confidence: model.training_rows >= 500 ? 'high' : model.training_rows >= 200 ? 'medium' : 'low',
    model_version: model.model_version,
  };
}

/**
 * Estimate revenue using V2 model (with calibration)
 */
export async function estimateRevenueV2(
  supabase: any,
  inputs: EstimatorInputs,
  marketplace: string = "US"
): Promise<{
  total_revenue_min: number;
  total_revenue_max: number;
  total_units_min: number;
  total_units_max: number;
  model_version: string;
} | null> {
  // Try to get active V2 model
  const model = await getActiveModel(supabase, marketplace, 'revenue_estimate');
  
  if (!model) {
    // No model available - return null (use v1 estimator)
    return null;
  }
  
  // Apply model coefficients
  const coeffs = model.coefficients_json;
  const avgReviewsLog = inputs.avg_reviews > 0 ? Math.log(inputs.avg_reviews + 1) : 0;
  const sponsoredPct = inputs.page1_count > 0 
    ? (inputs.sponsored_count / inputs.page1_count) * 100 
    : 0;
  const avgPrice = inputs.avg_price || 0;
  
  // Linear model: revenue = intercept + features
  const estimatedRevenue = 
    coeffs.intercept +
    (coeffs.page1_count_coef * inputs.page1_count) +
    (coeffs.avg_reviews_log_coef * avgReviewsLog) +
    (coeffs.sponsored_pct_coef * sponsoredPct) +
    (coeffs.avg_price_coef * avgPrice);
  
  // Apply category multiplier if available
  const categoryMultiplier = inputs.category && coeffs.category_multipliers
    ? (coeffs.category_multipliers[inputs.category] || 1.0)
    : 1.0;
  
  const adjustedRevenue = estimatedRevenue * categoryMultiplier;
  
  // Return range
  return {
    total_revenue_min: Math.round(adjustedRevenue * 0.8),
    total_revenue_max: Math.round(adjustedRevenue * 1.2),
    total_units_min: avgPrice > 0 ? Math.round((adjustedRevenue * 0.8) / avgPrice) : 0,
    total_units_max: avgPrice > 0 ? Math.round((adjustedRevenue * 1.2) / avgPrice) : 0,
    model_version: model.model_version,
  };
}
