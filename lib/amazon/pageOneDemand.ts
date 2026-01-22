/**
 * Page-1 Total Demand Estimation (Helium-10 Style)
 * 
 * Estimates total Page-1 demand FIRST, then allocates across products.
 * This stabilizes numbers and prevents runaway ASIN estimates.
 * 
 * Rules:
 * - Estimate total market demand using aggregate signals
 * - Use number of organic listings, median price, median reviews
 * - Apply category multiplier
 * - Clamp outputs to realistic bands
 */

export interface PageOneDemandEstimate {
  total_monthly_units_est: number;
  total_monthly_revenue_est: number;
  confidence_band: "low" | "medium" | "high";
}

export interface PageOneDemandInputs {
  listings: Array<{
    price: number | null;
    reviews: number | null;
    rating: number | null;
    isSponsored?: boolean; // Canonical sponsored status (always boolean, normalized at ingest)
    is_sponsored?: boolean | null; // DEPRECATED: Use isSponsored instead
  }>;
  category?: string | null;
  avgPrice?: number | null;
}

/**
 * Infer category from keyword or listings
 */
function inferCategoryFromListings(listings: PageOneDemandInputs["listings"]): string {
  // Try to infer from prices and review patterns
  // For now, use default - category can be passed explicitly
  return "default";
}

/**
 * Calculate median value from array
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Category multipliers for demand estimation
 * Higher multipliers = more competitive/higher volume categories
 */
const CATEGORY_MULTIPLIERS: Record<string, number> = {
  electronics: 1.3,
  home: 1.1,
  beauty: 1.2,
  health: 1.0,
  default: 1.0,
};

/**
 * Estimate total Page-1 demand (Helium-10 style)
 * 
 * Logic:
 * 1. Count organic listings
 * 2. Use median price and median reviews
 * 3. Base estimate: organic_count * base_units_per_listing
 * 4. Apply review multiplier (more reviews = more established = higher demand)
 * 5. Apply category multiplier
 * 6. Clamp to realistic bands
 * 
 * Example ranges:
 * - Low competition: 2k-6k units
 * - Medium: 6k-15k units
 * - High: 15k-35k units
 */
export function estimatePageOneDemand({
  listings,
  category,
  avgPrice,
}: PageOneDemandInputs): PageOneDemandEstimate {
  // Filter organic listings only (exclude sponsored)
  // Use isSponsored if available, otherwise fall back to is_sponsored
  const organicListings = listings.filter(l => {
    const isSponsored = typeof l.isSponsored === 'boolean' ? l.isSponsored : Boolean(l.is_sponsored === true);
    return isSponsored === false;
  });
  const organicCount = organicListings.length;

  if (organicCount === 0) {
    // No organic listings - return minimal estimate
    return {
      total_monthly_units_est: 0,
      total_monthly_revenue_est: 0,
      confidence_band: "low",
    };
  }

  // Extract valid prices and reviews
  const prices = organicListings
    .map(l => l.price)
    .filter((p): p is number => p !== null && p > 0);
  const reviews = organicListings
    .map(l => l.reviews)
    .filter((r): r is number => r !== null && r > 0);

  // Calculate medians
  const medianPrice = prices.length > 0 ? calculateMedian(prices) : (avgPrice || 25.0);
  const medianReviews = reviews.length > 0 ? calculateMedian(reviews) : 0;

  // Base units per organic listing (conservative estimate)
  // Position 1-3 average ~500-1000 units/month, positions 4-10 average ~200-500 units/month
  // Average across all positions: ~400 units/month per organic listing
  const baseUnitsPerListing = 400;

  // Start with base estimate
  let totalUnits = organicCount * baseUnitsPerListing;

  // Apply review multiplier (more reviews = more established market = higher demand)
  // Median reviews < 100: 0.7x (new/niche market)
  // Median reviews 100-500: 1.0x (standard)
  // Median reviews 500-1500: 1.3x (established)
  // Median reviews > 1500: 1.6x (mature market)
  let reviewMultiplier = 1.0;
  if (medianReviews < 100) {
    reviewMultiplier = 0.7;
  } else if (medianReviews >= 100 && medianReviews < 500) {
    reviewMultiplier = 1.0;
  } else if (medianReviews >= 500 && medianReviews < 1500) {
    reviewMultiplier = 1.3;
  } else {
    reviewMultiplier = 1.6;
  }

  totalUnits = Math.round(totalUnits * reviewMultiplier);

  // Apply category multiplier
  const inferredCategory = category || inferCategoryFromListings(listings);
  const categoryMultiplier = CATEGORY_MULTIPLIERS[inferredCategory] || CATEGORY_MULTIPLIERS.default;
  totalUnits = Math.round(totalUnits * categoryMultiplier);

  // Clamp to realistic bands based on competition level
  // Determine competition level from organic count and median reviews
  let minUnits: number;
  let maxUnits: number;
  let confidence: "low" | "medium" | "high";

  if (organicCount < 8 || medianReviews < 100) {
    // Low competition: fewer listings or low reviews
    minUnits = 2000;
    maxUnits = 6000;
    confidence = "low";
  } else if (organicCount >= 8 && organicCount < 15 && medianReviews < 1500) {
    // Medium competition
    minUnits = 6000;
    maxUnits = 15000;
    confidence = "medium";
  } else {
    // High competition: many listings and high reviews
    minUnits = 15000;
    maxUnits = 35000;
    confidence = "high";
  }

  // Clamp total units to band
  totalUnits = Math.max(minUnits, Math.min(maxUnits, totalUnits));

  // Calculate total revenue from units and median price
  const totalRevenue = Math.round(totalUnits * medianPrice);

  console.log("📦 PAGE-1 DEMAND ESTIMATE", {
    organic_count: organicCount,
    median_price: medianPrice,
    median_reviews: medianReviews,
    review_multiplier: reviewMultiplier.toFixed(2),
    category: inferredCategory,
    category_multiplier: categoryMultiplier,
    total_monthly_units_est: totalUnits,
    total_monthly_revenue_est: totalRevenue,
    confidence_band: confidence,
    competition_level: confidence === "low" ? "low" : confidence === "medium" ? "medium" : "high",
  });

  return {
    total_monthly_units_est: totalUnits,
    total_monthly_revenue_est: totalRevenue,
    confidence_band: confidence,
  };
}

