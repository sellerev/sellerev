/**
 * 30-Day Revenue Estimation (Modeled, Not Exact)
 * 
 * Deterministic revenue estimator using:
 * - Page-1 price
 * - Relative rank position (index in Page-1 list)
 * - Category velocity multipliers (simple lookup table)
 * 
 * Rules:
 * - Never imply revenue is real
 * - Always label as "(est.)"
 * - Cache computed values in analysis_runs.response.market_snapshot
 */

export interface RevenueEstimate {
  est_monthly_revenue: number;
  revenue_confidence: "low" | "medium";
}

export interface RevenueEstimateWithUnits extends RevenueEstimate {
  est_monthly_units: number;
}

/**
 * Category velocity multipliers (monthly revenue multipliers by position)
 * Higher positions = more visibility = higher revenue potential
 * 
 * Multipliers are relative to position 1 (which gets 1.0x)
 */
const CATEGORY_VELOCITY_MULTIPLIERS: Record<string, number[]> = {
  // Electronics/Tech: Higher velocity
  electronics: [1.0, 0.75, 0.60, 0.50, 0.45, 0.40, 0.35, 0.30, 0.28, 0.25, 0.23, 0.20, 0.18, 0.16, 0.14, 0.12],
  // Home/Kitchen: Moderate velocity
  home: [1.0, 0.70, 0.55, 0.45, 0.40, 0.35, 0.30, 0.28, 0.25, 0.23, 0.20, 0.18, 0.16, 0.14, 0.12, 0.10],
  // Beauty/Personal Care: Higher velocity
  beauty: [1.0, 0.72, 0.58, 0.48, 0.42, 0.37, 0.32, 0.29, 0.26, 0.24, 0.21, 0.19, 0.17, 0.15, 0.13, 0.11],
  // Health/Fitness: Moderate velocity
  health: [1.0, 0.68, 0.52, 0.43, 0.38, 0.33, 0.29, 0.26, 0.24, 0.22, 0.19, 0.17, 0.15, 0.13, 0.11, 0.09],
  // Default: Conservative velocity
  default: [1.0, 0.65, 0.50, 0.42, 0.37, 0.32, 0.28, 0.25, 0.23, 0.21, 0.18, 0.16, 0.14, 0.12, 0.10, 0.08],
};

/**
 * Base monthly revenue estimate for position 1 (baseline)
 * This is a rough estimate - position 1 products typically see $5k-50k/month depending on category
 */
const BASE_MONTHLY_REVENUE_POSITION_1 = 15000; // $15k/month baseline for position 1

/**
 * Infer category from keyword or use default
 */
function inferCategory(keyword: string): string {
  const normalized = keyword.toLowerCase();
  
  if (/electronic|tech|computer|phone|tablet|headphone|speaker|smartwatch/i.test(normalized)) {
    return "electronics";
  }
  if (/home|kitchen|cookware|furniture|decor|bedding/i.test(normalized)) {
    return "home";
  }
  if (/beauty|cosmetic|skincare|makeup|hair|perfume|nail/i.test(normalized)) {
    return "beauty";
  }
  if (/fitness|health|supplement|vitamin|workout|exercise|gym/i.test(normalized)) {
    return "health";
  }
  
  return "default";
}

/**
 * Get velocity multiplier for a given position
 */
function getVelocityMultiplier(category: string, position: number): number {
  const multipliers = CATEGORY_VELOCITY_MULTIPLIERS[category] || CATEGORY_VELOCITY_MULTIPLIERS.default;
  // Position is 1-indexed, array is 0-indexed
  const index = Math.min(position - 1, multipliers.length - 1);
  return multipliers[index] || multipliers[multipliers.length - 1];
}

/**
 * Estimate monthly revenue for a single listing
 * 
 * Formula: base_revenue * price_ratio * velocity_multiplier
 * 
 * Where:
 * - base_revenue = BASE_MONTHLY_REVENUE_POSITION_1
 * - price_ratio = listing_price / avg_price (normalized around 1.0)
 * - velocity_multiplier = position-based multiplier from category table
 */
export function estimateListingRevenue(
  price: number,
  position: number,
  avgPrice: number | null,
  keyword: string
): RevenueEstimate {
  // Infer category from keyword
  const category = inferCategory(keyword);
  
  // Get velocity multiplier for this position
  const velocityMultiplier = getVelocityMultiplier(category, position);
  
  // Calculate price ratio (how this price compares to average)
  // If avgPrice is null, assume price is average (ratio = 1.0)
  const priceRatio = avgPrice && avgPrice > 0 ? price / avgPrice : 1.0;
  
  // Clamp price ratio to reasonable range (0.5x to 2.0x)
  // Very cheap products might have higher volume, very expensive products might have lower volume
  const clampedPriceRatio = Math.max(0.5, Math.min(2.0, priceRatio));
  
  // Estimate revenue: base * price_ratio * velocity
  // Higher prices can support similar or higher revenue if conversion is maintained
  const estRevenue = BASE_MONTHLY_REVENUE_POSITION_1 * clampedPriceRatio * velocityMultiplier;
  
  // Round to nearest dollar
  const roundedRevenue = Math.round(estRevenue);
  
  // Confidence: "medium" for positions 1-8, "low" for positions 9+
  const confidence: "low" | "medium" = position <= 8 ? "medium" : "low";
  
  return {
    est_monthly_revenue: roundedRevenue,
    revenue_confidence: confidence,
  };
}

/**
 * Estimate monthly units sold
 * 
 * units = revenue / price
 */
export function estimateListingUnits(
  revenue: number,
  price: number
): number {
  if (price <= 0) return 0;
  return Math.round(revenue / price);
}

/**
 * Estimate revenue and units for a listing
 */
export function estimateListingRevenueWithUnits(
  price: number,
  position: number,
  avgPrice: number | null,
  keyword: string
): RevenueEstimateWithUnits {
  const revenueEstimate = estimateListingRevenue(price, position, avgPrice, keyword);
  const units = estimateListingUnits(revenueEstimate.est_monthly_revenue, price);
  
  return {
    ...revenueEstimate,
    est_monthly_units: units,
  };
}

/**
 * Aggregate revenue estimates across all listings
 */
export function aggregateRevenueEstimates(
  estimates: RevenueEstimateWithUnits[]
): {
  total_revenue_min: number;
  total_revenue_max: number;
  total_units_min: number;
  total_units_max: number;
} {
  // For ranges, apply confidence-based adjustments
  // Low confidence: ±40% range
  // Medium confidence: ±25% range
  const lowConfidenceAdjustment = 0.4;
  const mediumConfidenceAdjustment = 0.25;
  
  let totalRevenueMin = 0;
  let totalRevenueMax = 0;
  let totalUnitsMin = 0;
  let totalUnitsMax = 0;
  
  for (const est of estimates) {
    const adjustment = est.revenue_confidence === "low" ? lowConfidenceAdjustment : mediumConfidenceAdjustment;
    const revenueRange = est.est_monthly_revenue * adjustment;
    
    totalRevenueMin += Math.round(est.est_monthly_revenue - revenueRange);
    totalRevenueMax += Math.round(est.est_monthly_revenue + revenueRange);
    totalUnitsMin += Math.round(est.est_monthly_units * (1 - adjustment));
    totalUnitsMax += Math.round(est.est_monthly_units * (1 + adjustment));
  }
  
  return {
    total_revenue_min: Math.max(0, totalRevenueMin),
    total_revenue_max: totalRevenueMax,
    total_units_min: Math.max(0, totalUnitsMin),
    total_units_max: totalUnitsMax,
  };
}
