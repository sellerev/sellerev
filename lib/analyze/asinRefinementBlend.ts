/**
 * ASIN Refinement Blending
 * 
 * Confidence-weighted blending for lazy ASIN refinement (display-only).
 * 
 * Rules:
 * - Blends refined_estimated_revenue with canonical revenue using confidence
 * - high: 70% refined / 30% canonical
 * - medium: 50% / 50%
 * - low: 30% / 70%
 * - Blended value is display-only, never written back to canonical
 * - Never affects market snapshot, brand moat, or totals
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface BlendedRevenue {
  blended_revenue: number;
  confidence: ConfidenceLevel;
  refined_revenue: number;
  canonical_revenue: number;
  refined_weight: number;
  canonical_weight: number;
}

/**
 * Blend refined revenue with canonical revenue based on confidence level
 * 
 * @param refinedRevenue - Refined revenue from ASIN enrichment
 * @param canonicalRevenue - Canonical revenue from Page-1 allocation
 * @param confidence - Confidence level (high, medium, low)
 * @returns Blended revenue with metadata
 */
export function blendRefinedRevenue(
  refinedRevenue: number,
  canonicalRevenue: number,
  confidence: ConfidenceLevel
): BlendedRevenue {
  // Determine weights based on confidence
  let refinedWeight: number;
  let canonicalWeight: number;
  
  switch (confidence) {
    case 'high':
      refinedWeight = 0.70;
      canonicalWeight = 0.30;
      break;
    case 'medium':
      refinedWeight = 0.50;
      canonicalWeight = 0.50;
      break;
    case 'low':
      refinedWeight = 0.30;
      canonicalWeight = 0.70;
      break;
    default:
      // Fallback to medium if invalid confidence
      refinedWeight = 0.50;
      canonicalWeight = 0.50;
  }
  
  // Calculate blended revenue
  const blendedRevenue = Math.round(
    (refinedRevenue * refinedWeight) + (canonicalRevenue * canonicalWeight)
  );
  
  return {
    blended_revenue: blendedRevenue,
    confidence,
    refined_revenue: refinedRevenue,
    canonical_revenue: canonicalRevenue,
    refined_weight: refinedWeight,
    canonical_weight: canonicalWeight,
  };
}

/**
 * Check if refined data has expired
 * 
 * @param expiresAt - Expiration timestamp (ISO string)
 * @returns true if expired, false if still valid
 */
export function isRefinedDataExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) {
    return true; // No expiration date = expired
  }
  
  try {
    const expirationDate = new Date(expiresAt);
    const now = new Date();
    return now > expirationDate;
  } catch (error) {
    return true; // Invalid date = expired
  }
}

