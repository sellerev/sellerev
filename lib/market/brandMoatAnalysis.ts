/**
 * Brand Moat Analysis
 * 
 * Computes deterministic Brand Moat detection from Page-1 listings only.
 * 
 * Rules:
 * - Page-1 only (no historical inference)
 * - Deterministic output
 * - Missing brand = compute using available ones
 * - Never throw or return null — default to NO_MOAT
 */

export interface BrandMoatResult {
  dominant_brand: string | null;
  moat_level: "HARD" | "SOFT" | "NONE";
  signals: {
    revenue_share_pct: number;
    listing_count_on_page1: number;
    avg_review_count: number;
    max_rank: number; // Best position (lowest rank number)
  };
}

export interface PageOneListing {
  brand: string | null;
  estimated_monthly_revenue: number;
  review_count: number;
  rank: number | null; // Page-1 position (lower is better)
  page_position?: number | null; // Alternative to rank
}

/**
 * Normalizes brand name (handles null, empty)
 * Excludes UNKNOWN/null brands from moat calculation
 */
function normalizeBrand(brand: string | null | undefined): string | null {
  if (!brand || typeof brand !== "string" || brand.trim().length === 0) {
    return null;
  }
  return brand.trim();
}

/**
 * Computes median review count from Page-1 listings
 */
function computeMedianReviewCount(listings: PageOneListing[]): number {
  const reviewCounts = listings
    .map(l => l.review_count || 0)
    .filter(r => r > 0)
    .sort((a, b) => a - b);
  
  if (reviewCounts.length === 0) {
    return 0;
  }
  
  const mid = Math.floor(reviewCounts.length / 2);
  return reviewCounts.length % 2 === 0
    ? (reviewCounts[mid - 1] + reviewCounts[mid]) / 2
    : reviewCounts[mid];
}

/**
 * Analyzes Brand Moat from Page-1 listings.
 * 
 * Groups listings by brand and computes:
 * - listing_count_on_page1
 * - total_estimated_revenue
 * - revenue_share_pct
 * - avg_review_count
 * - max_rank (best position)
 * 
 * @param listings - Page-1 listings with brand, revenue, review_count, rank
 * @returns Brand Moat result with dominant brand and moat level
 */
export function analyzeBrandMoat(
  listings: PageOneListing[]
): BrandMoatResult {
  // Guard: If no listings, return NO_MOAT
  if (!listings || listings.length === 0) {
    return {
      dominant_brand: null,
      moat_level: "NONE",
      signals: {
        revenue_share_pct: 0,
        listing_count_on_page1: 0,
        avg_review_count: 0,
        max_rank: 0,
      },
    };
  }

  // Filter listings with valid brands (exclude null/empty)
  const listingsWithBrand = listings.filter(
    l => normalizeBrand(l.brand) !== null
  );

  // If no brands available, return NO_MOAT
  if (listingsWithBrand.length === 0) {
    return {
      dominant_brand: null,
      moat_level: "NONE",
      signals: {
        revenue_share_pct: 0,
        listing_count_on_page1: 0,
        avg_review_count: 0,
        max_rank: 0,
      },
    };
  }

  // Compute Page-1 median review count (for SOFT_MOAT threshold)
  const page1MedianReviewCount = computeMedianReviewCount(listings);

  // Group listings by brand
  const brandGroups = new Map<string, PageOneListing[]>();
  
  listingsWithBrand.forEach((listing) => {
    const brand = normalizeBrand(listing.brand);
    if (brand !== null) {
      if (!brandGroups.has(brand)) {
        brandGroups.set(brand, []);
      }
      brandGroups.get(brand)!.push(listing);
    }
  });

  // Calculate total Page-1 revenue
  const totalPage1Revenue = listings.reduce(
    (sum, l) => sum + (l.estimated_monthly_revenue || 0),
    0
  );

  // Compute metrics per brand
  const brandMetrics: Array<{
    brand: string;
    listing_count_on_page1: number;
    total_estimated_revenue: number;
    revenue_share_pct: number;
    avg_review_count: number;
    max_rank: number;
  }> = [];

  brandGroups.forEach((brandListings, brandName) => {
    const listing_count_on_page1 = brandListings.length;
    
    const total_estimated_revenue = brandListings.reduce(
      (sum, l) => sum + (l.estimated_monthly_revenue || 0),
      0
    );
    
    const revenue_share_pct =
      totalPage1Revenue > 0
        ? (total_estimated_revenue / totalPage1Revenue) * 100
        : 0;

    const reviewCounts = brandListings
      .map(l => l.review_count || 0)
      .filter(r => r > 0);
    const avg_review_count =
      reviewCounts.length > 0
        ? reviewCounts.reduce((a, b) => a + b, 0) / reviewCounts.length
        : 0;

    // max_rank = best position (lowest rank number)
    // Use page_position if available, otherwise rank
    const ranks = brandListings
      .map(l => {
        const pos = l.page_position ?? l.rank;
        return pos !== null && pos !== undefined && pos > 0 ? pos : 999;
      })
      .filter(r => r > 0 && r < 999);
    const max_rank =
      ranks.length > 0 ? Math.min(...ranks) : 0; // Lower is better

    brandMetrics.push({
      brand: brandName,
      listing_count_on_page1,
      total_estimated_revenue,
      revenue_share_pct,
      avg_review_count,
      max_rank,
    });
  });

  // Find dominant brand by revenue share
  const dominantBrandMetric = brandMetrics.reduce((dominant, current) => {
    return current.revenue_share_pct > dominant.revenue_share_pct
      ? current
      : dominant;
  }, brandMetrics[0] || {
    brand: "",
    listing_count_on_page1: 0,
    total_estimated_revenue: 0,
    revenue_share_pct: 0,
    avg_review_count: 0,
    max_rank: 0,
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // BRAND MOAT CLASSIFICATION
  // ──────────────────────────────────────────────────────────────────────────────
  // HARD_MOAT if:
  //   - revenue_share_pct ≥ 60%
  //   OR
  //   - listing_count_on_page1 ≥ 3 AND revenue_share_pct ≥ 40%
  //
  // SOFT_MOAT if:
  //   - revenue_share_pct between 40–59% (inclusive)
  //   OR
  //   - listing_count_on_page1 ≥ 2 AND avg_review_count ≥ 2× page1 median
  //
  // NONE otherwise

  let moat_level: "HARD" | "SOFT" | "NONE" = "NONE";

  // Check HARD_MOAT thresholds (must check first)
  if (
    dominantBrandMetric.revenue_share_pct >= 60 ||
    (dominantBrandMetric.listing_count_on_page1 >= 3 &&
      dominantBrandMetric.revenue_share_pct >= 40)
  ) {
    moat_level = "HARD";
  }
  // Check SOFT_MOAT thresholds (only if not HARD)
  else if (
    (dominantBrandMetric.revenue_share_pct >= 40 &&
      dominantBrandMetric.revenue_share_pct < 60) ||
    (dominantBrandMetric.listing_count_on_page1 >= 2 &&
      dominantBrandMetric.avg_review_count >= page1MedianReviewCount * 2 &&
      page1MedianReviewCount > 0)
  ) {
    moat_level = "SOFT";
  }
  // Otherwise NONE (already default)

  // Build result
  const result: BrandMoatResult = {
    dominant_brand:
      dominantBrandMetric.revenue_share_pct > 0
        ? dominantBrandMetric.brand
        : null,
    moat_level,
    signals: {
      revenue_share_pct: Math.round(dominantBrandMetric.revenue_share_pct * 100) / 100,
      listing_count_on_page1: dominantBrandMetric.listing_count_on_page1,
      avg_review_count: Math.round(dominantBrandMetric.avg_review_count),
      max_rank: dominantBrandMetric.max_rank,
    },
  };

  return result;
}
