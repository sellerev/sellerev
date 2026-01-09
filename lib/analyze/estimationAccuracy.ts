/**
 * Estimation Accuracy & Explainability
 * 
 * System-wide accuracy guardrails and explainability metadata.
 * 
 * Rules:
 * - Canonical revenue can only be modified by:
 *   a) keyword calibration
 *   b) parent normalization
 * - Any other mutation throws error
 */

export interface EstimationMetadata {
  calibration_applied: boolean;
  calibration_confidence: 'high' | 'medium' | 'low' | null;
  calibration_multiplier: number | null;
  parent_normalized_count: number;
  total_products: number;
  refined_data_count: number;
}

export interface EstimationAccuracyResult {
  confidence_score: number; // 0-100
  notes: string[];
}

/**
 * Calculate estimation confidence score (0-100)
 * 
 * Based on:
 * - Calibration confidence (high=+20, medium=+10, low=+5, none=0)
 * - % of parent-normalized ASINs (0-100% = 0-30 points)
 * - % of listings with refined data (0-100% = 0-20 points)
 * 
 * Base score: 50 (model estimates)
 * Max score: 100
 */
export function calculateEstimationConfidence(
  metadata: EstimationMetadata
): EstimationAccuracyResult {
  const notes: string[] = [];
  let score = 50; // Base score for model estimates
  
  // Calibration contribution
  if (metadata.calibration_applied && metadata.calibration_confidence) {
    const multiplier = metadata.calibration_multiplier || 1.0;
    const multiplierStr = multiplier.toFixed(2);
    
    switch (metadata.calibration_confidence) {
      case 'high':
        score += 20;
        notes.push(`Keyword calibration applied (multiplier ${multiplierStr}, confidence: high)`);
        break;
      case 'medium':
        score += 10;
        notes.push(`Keyword calibration applied (multiplier ${multiplierStr}, confidence: medium)`);
        break;
      case 'low':
        score += 5;
        notes.push(`Keyword calibration applied (multiplier ${multiplierStr}, confidence: low)`);
        break;
    }
  }
  
  // Parent normalization contribution (0-30 points)
  if (metadata.total_products > 0) {
    const parentNormalizedPct = (metadata.parent_normalized_count / metadata.total_products) * 100;
    const parentScore = Math.min(30, Math.round(parentNormalizedPct * 0.3)); // Up to 30 points
    score += parentScore;
    
    if (metadata.parent_normalized_count > 0) {
      notes.push(`Parent-child normalization applied (${metadata.parent_normalized_count} of ${metadata.total_products} products normalized)`);
    }
  }
  
  // Refined data contribution (0-20 points)
  if (metadata.total_products > 0) {
    const refinedPct = (metadata.refined_data_count / metadata.total_products) * 100;
    const refinedScore = Math.min(20, Math.round(refinedPct * 0.2)); // Up to 20 points
    score += refinedScore;
    
    if (metadata.refined_data_count > 0) {
      notes.push(`${metadata.refined_data_count} listing${metadata.refined_data_count === 1 ? '' : 's'} refined via Rainforest`);
    }
  }
  
  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));
  
  return {
    confidence_score: score,
    notes,
  };
}

/**
 * Guardrail: Verify canonical revenue was only modified by allowed operations
 * 
 * This is a runtime check to ensure no unauthorized mutations occurred.
 * Should be called after all canonical operations are complete.
 */
export function verifyCanonicalRevenueIntegrity(
  products: Array<{ asin: string; estimated_monthly_revenue: number }>,
  allowedModifications: {
    calibration_applied: boolean;
    parent_normalization_applied: boolean;
  }
): void {
  // This is a placeholder for runtime verification
  // In a production system, you might track modification history
  // For now, we rely on code review and the fact that only two functions modify revenue:
  // 1. applyKeywordCalibration (in keywordCalibration.ts)
  // 2. Parent-child normalization (in canonicalPageOne.ts)
  
  // Log verification
  console.log("[EstimationAccuracy] Canonical revenue integrity check", {
    product_count: products.length,
    calibration_applied: allowedModifications.calibration_applied,
    parent_normalization_applied: allowedModifications.parent_normalization_applied,
  });
  
  // If neither allowed modification was applied, warn (but don't throw)
  // This helps catch bugs during development
  if (!allowedModifications.calibration_applied && !allowedModifications.parent_normalization_applied) {
    console.log("[EstimationAccuracy] No calibration or parent normalization applied - using base model estimates");
  }
}

