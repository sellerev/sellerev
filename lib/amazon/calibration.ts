/**
 * Market Calibration & Trust Layer
 * 
 * Purpose: Make Sellerev feel as reliable as Helium 10 without copying exactly.
 * 
 * Strategy:
 * - Normalize outputs into trusted bands
 * - Add confidence ranges
 * - Apply soft multipliers (0.8x-1.2x)
 * - Clamp to known Helium-10-like ranges
 * - Never change ranking order
 * 
 * This is how trust is built.
 */

export interface CalibratedMarketTotals {
  calibrated_units: number;
  calibrated_revenue: number;
  calibration_factor: number;
  confidence: "Low" | "Medium" | "High";
  confidence_reason: string;
}

export interface CalibrationInputs {
  raw_units: number;
  raw_revenue: number;
  category?: string | null;
  price_band: {
    min: number;
    max: number;
  };
  listing_count: number;
  review_dispersion?: number; // Standard deviation of review counts
  sponsored_density?: number; // Percentage of sponsored listings (0-100)
}

/**
 * Known Helium-10-like ranges by competition level
 * These are realistic bands based on typical market observations
 */
const MARKET_RANGES = {
  low_competition: {
    units_min: 2000,
    units_max: 6000,
    revenue_min: 50000, // Assuming ~$25 avg price
    revenue_max: 150000,
  },
  medium_competition: {
    units_min: 6000,
    units_max: 15000,
    revenue_min: 150000,
    revenue_max: 375000,
  },
  high_competition: {
    units_min: 15000,
    units_max: 35000,
    revenue_min: 375000,
    revenue_max: 875000,
  },
};

/**
 * Category multipliers (soft adjustments, 0.8x-1.2x range)
 * These account for category-specific demand patterns
 */
const CATEGORY_MULTIPLIERS: Record<string, number> = {
  electronics: 1.15,
  home: 1.05,
  beauty: 1.10,
  health: 1.00,
  default: 1.00,
};

/**
 * Calculate review dispersion (standard deviation of review counts)
 */
function calculateReviewDispersion(listings: Array<{ reviews: number | null }>): number {
  const reviews = listings
    .map(l => l.reviews)
    .filter((r): r is number => r !== null && r > 0);
  
  if (reviews.length === 0) return 0;
  
  const mean = reviews.reduce((sum, r) => sum + r, 0) / reviews.length;
  const variance = reviews.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / reviews.length;
  return Math.sqrt(variance);
}

/**
 * Determine competition level from market signals
 */
function determineCompetitionLevel(
  listingCount: number,
  reviewDispersion: number,
  sponsoredDensity: number
): "low_competition" | "medium_competition" | "high_competition" {
  // Low competition: few listings, low review dispersion, low sponsored density
  if (listingCount < 8 || (reviewDispersion < 500 && sponsoredDensity < 20)) {
    return "low_competition";
  }
  
  // High competition: many listings, high review dispersion, high sponsored density
  if (listingCount >= 15 && (reviewDispersion > 2000 || sponsoredDensity > 40)) {
    return "high_competition";
  }
  
  // Default to medium
  return "medium_competition";
}

/**
 * Calculate confidence level and reason
 */
function calculateConfidence(
  listingCount: number,
  reviewDispersion: number,
  sponsoredDensity: number
): { confidence: "Low" | "Medium" | "High"; reason: string } {
  const reasons: string[] = [];
  let score = 0;
  
  // Listing count factor (0-40 points)
  if (listingCount >= 15) {
    score += 40;
    reasons.push("Strong listing coverage (15+ products)");
  } else if (listingCount >= 8) {
    score += 25;
    reasons.push("Moderate listing coverage (8-14 products)");
  } else if (listingCount >= 5) {
    score += 10;
    reasons.push("Limited listing coverage (5-7 products)");
  } else {
    reasons.push("Sparse listing coverage (< 5 products)");
  }
  
  // Review dispersion factor (0-30 points)
  if (reviewDispersion > 1000) {
    score += 30;
    reasons.push("High review diversity indicates established market");
  } else if (reviewDispersion > 500) {
    score += 20;
    reasons.push("Moderate review diversity");
  } else if (reviewDispersion > 0) {
    score += 10;
    reasons.push("Low review diversity - market may be new");
  } else {
    reasons.push("No review data available");
  }
  
  // Sponsored density factor (0-30 points)
  // Lower sponsored density = more organic competition = higher confidence
  if (sponsoredDensity < 20) {
    score += 30;
    reasons.push("Low sponsored density suggests organic competition");
  } else if (sponsoredDensity < 40) {
    score += 15;
    reasons.push("Moderate sponsored density");
  } else {
    score += 5;
    reasons.push("High sponsored density may indicate paid competition");
  }
  
  // Determine confidence level
  let confidence: "Low" | "Medium" | "High";
  if (score >= 70) {
    confidence = "High";
  } else if (score >= 40) {
    confidence = "Medium";
  } else {
    confidence = "Low";
  }
  
  const reason = reasons.join(". ") + ".";
  
  return { confidence, reason };
}

/**
 * Calibrate market totals into trusted bands
 * 
 * Rules:
 * - Apply soft multipliers (0.8x-1.2x)
 * - Clamp to known Helium-10-like ranges
 * - Never change ranking order (this function only adjusts totals)
 * 
 * @param inputs - Raw market totals and market signals
 * @returns Calibrated totals with confidence information
 */
export function calibrateMarketTotals(
  inputs: CalibrationInputs
): CalibratedMarketTotals {
  const {
    raw_units,
    raw_revenue,
    category,
    price_band,
    listing_count,
    review_dispersion = 0,
    sponsored_density = 0,
  } = inputs;

  // Step 1: Determine competition level
  const competitionLevel = determineCompetitionLevel(
    listing_count,
    review_dispersion,
    sponsored_density
  );
  const marketRange = MARKET_RANGES[competitionLevel];

  // Step 2: Apply category multiplier (soft adjustment)
  const categoryMultiplier = category
    ? (CATEGORY_MULTIPLIERS[category] || CATEGORY_MULTIPLIERS.default)
    : CATEGORY_MULTIPLIERS.default;

  // Step 3: Calculate calibration factor
  // Target: bring raw_units into the middle of the market range
  const targetUnits = (marketRange.units_min + marketRange.units_max) / 2;
  let calibrationFactor = targetUnits / raw_units;

  // Clamp calibration factor to soft range (0.8x-1.2x)
  calibrationFactor = Math.max(0.8, Math.min(1.2, calibrationFactor));

  // Step 4: Apply calibration
  let calibratedUnits = Math.round(raw_units * calibrationFactor * categoryMultiplier);
  let calibratedRevenue = Math.round(raw_revenue * calibrationFactor * categoryMultiplier);

  // Step 5: Clamp to market range
  calibratedUnits = Math.max(
    marketRange.units_min,
    Math.min(marketRange.units_max, calibratedUnits)
  );
  
  // For revenue, use price band to estimate realistic range
  const avgPrice = (price_band.min + price_band.max) / 2;
  const revenueFromUnits = calibratedUnits * avgPrice;
  calibratedRevenue = Math.max(
    marketRange.revenue_min,
    Math.min(marketRange.revenue_max, Math.max(revenueFromUnits, calibratedRevenue))
  );

  // Step 6: Calculate confidence
  const { confidence, reason } = calculateConfidence(
    listing_count,
    review_dispersion,
    sponsored_density
  );

  console.log("🔧 MARKET CALIBRATION", {
    competition_level: competitionLevel,
    raw_units,
    raw_revenue,
    category_multiplier: categoryMultiplier.toFixed(3),
    calibration_factor: calibrationFactor.toFixed(3),
    calibrated_units: calibratedUnits,
    calibrated_revenue: calibratedRevenue,
    confidence,
    confidence_reason: reason,
  });

  return {
    calibrated_units: calibratedUnits,
    calibrated_revenue: calibratedRevenue,
    calibration_factor: calibrationFactor * categoryMultiplier,
    confidence,
    confidence_reason: reason,
  };
}

/**
 * Calculate review dispersion from listings
 */
export function calculateReviewDispersionFromListings(
  listings: Array<{ reviews: number | null }>
): number {
  return calculateReviewDispersion(listings);
}

/**
 * Invariant Validation
 * 
 * Checks data integrity without throwing errors.
 * Logs violations for monitoring and improvement.
 */
export interface InvariantViolation {
  type: "sum_mismatch" | "asin_dominance" | "revenue_mismatch";
  severity: "warning" | "error";
  message: string;
  details: Record<string, unknown>;
}

export interface InvariantCheckResult {
  passed: boolean;
  violations: InvariantViolation[];
}

/**
 * Check invariant: Sum of ASIN units ≈ total units (±1%)
 */
function checkSumInvariant(
  totalUnits: number,
  allocatedUnits: number[]
): InvariantViolation | null {
  const sumAllocated = allocatedUnits.reduce((sum, u) => sum + u, 0);
  const diff = Math.abs(sumAllocated - totalUnits);
  const diffPct = totalUnits > 0 ? (diff / totalUnits) * 100 : 0;
  
  if (diffPct > 1.0) {
    return {
      type: "sum_mismatch",
      severity: "warning",
      message: `Sum of allocated units (${sumAllocated}) differs from total (${totalUnits}) by ${diffPct.toFixed(2)}%`,
      details: {
        total_units: totalUnits,
        sum_allocated: sumAllocated,
        difference: diff,
        difference_pct: diffPct,
      },
    };
  }
  
  return null;
}

/**
 * Check invariant: No ASIN > 35% of market unless branded
 */
function checkAsinDominanceInvariant(
  products: Array<{
    asin: string;
    estimated_monthly_units: number;
    brand: string | null;
    revenue_share_pct: number;
  }>,
  totalUnits: number
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  
  for (const product of products) {
    const sharePct = totalUnits > 0
      ? (product.estimated_monthly_units / totalUnits) * 100
      : 0;
    
    // Allow > 35% if branded (branded products can dominate)
    const isBranded = product.brand !== null && product.brand.trim().length > 0;
    const threshold = isBranded ? 50 : 35;
    
    if (sharePct > threshold) {
      violations.push({
        type: "asin_dominance",
        severity: sharePct > 50 ? "error" : "warning",
        message: `ASIN ${product.asin} dominates ${sharePct.toFixed(1)}% of market${isBranded ? " (branded, allowed up to 50%)" : " (unbranded, max 35%)"}`,
        details: {
          asin: product.asin,
          brand: product.brand,
          market_share_pct: sharePct,
          units: product.estimated_monthly_units,
          total_units: totalUnits,
          threshold,
        },
      });
    }
  }
  
  return violations;
}

/**
 * Check invariant: Revenue always equals units × price
 */
function checkRevenueInvariant(
  products: Array<{
    asin: string;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    price: number;
  }>
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  
  for (const product of products) {
    const expectedRevenue = Math.round(product.estimated_monthly_units * product.price);
    const diff = Math.abs(product.estimated_monthly_revenue - expectedRevenue);
    const diffPct = expectedRevenue > 0 ? (diff / expectedRevenue) * 100 : 0;
    
    // Allow small rounding differences (< 1%)
    if (diffPct >= 1.0) {
      violations.push({
        type: "revenue_mismatch",
        severity: diffPct > 5 ? "error" : "warning",
        message: `ASIN ${product.asin} revenue (${product.estimated_monthly_revenue}) doesn't match units × price (${expectedRevenue}), diff: ${diffPct.toFixed(2)}%`,
        details: {
          asin: product.asin,
          units: product.estimated_monthly_units,
          price: product.price,
          expected_revenue: expectedRevenue,
          actual_revenue: product.estimated_monthly_revenue,
          difference: diff,
          difference_pct: diffPct,
        },
      });
    }
  }
  
  return violations;
}

/**
 * Validate all invariants
 * 
 * Rules:
 * - Sum of ASIN units ≈ total units (±1%)
 * - No ASIN > 35% of market unless branded (then 50%)
 * - Revenue always equals units × price (±1%)
 * 
 * Logs violations but never throws.
 */
export function validateInvariants(
  totalUnits: number,
  totalRevenue: number,
  products: Array<{
    asin: string;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    price: number;
    brand: string | null;
    revenue_share_pct: number;
  }>
): InvariantCheckResult {
  const violations: InvariantViolation[] = [];
  
  // Check 1: Sum of ASIN units ≈ total units
  const allocatedUnits = products.map(p => p.estimated_monthly_units);
  const sumViolation = checkSumInvariant(totalUnits, allocatedUnits);
  if (sumViolation) {
    violations.push(sumViolation);
  }
  
  // Check 2: No ASIN > 35% of market unless branded
  const dominanceViolations = checkAsinDominanceInvariant(products, totalUnits);
  violations.push(...dominanceViolations);
  
  // Check 3: Revenue = units × price
  const revenueViolations = checkRevenueInvariant(products);
  violations.push(...revenueViolations);
  
  // Log violations
  if (violations.length > 0) {
    console.warn("⚠️ INVARIANT VIOLATIONS DETECTED", {
      total_violations: violations.length,
      violations: violations.map(v => ({
        type: v.type,
        severity: v.severity,
        message: v.message,
      })),
    });
    
    // Log each violation separately for clarity
    violations.forEach(v => {
      const logFn = v.severity === "error" ? console.error : console.warn;
      logFn(`⚠️ INVARIANT: ${v.type}`, {
        severity: v.severity,
        message: v.message,
        details: v.details,
      });
    });
  } else {
    console.log("✅ ALL INVARIANTS PASSED", {
      total_units: totalUnits,
      total_revenue: totalRevenue,
      product_count: products.length,
    });
  }
  
  return {
    passed: violations.length === 0,
    violations,
  };
}

