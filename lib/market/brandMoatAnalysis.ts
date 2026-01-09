/**
 * Brand Moat Analysis
 * 
 * Computes deterministic Brand Moat detection from Page-1 listings only.
 * 
 * Rules:
 * - Page-1 only (no historical inference)
 * - Deterministic output
 * - Missing brand = compute using available ones
 * - Never throw or return null — default to NONE
 * - No additional API calls — uses existing Page-1 keyword data
 */

export interface BrandRevenueBreakdown {
  brand: string;
  revenue: number;
  share_pct: number;
  asin_count: number;
  top10_count: number;
}

export interface BrandMoatResult {
  level: "HARD" | "SOFT" | "NONE";
  top_brand: string | null;
  top_brand_share_pct: number;
  top_3_share_pct: number;
  unique_brand_count: number;
  brand_revenue_breakdown: BrandRevenueBreakdown[];
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
 * Analyzes Brand Moat from Page-1 listings.
 * 
 * Aggregates Page-1 listings by brand and computes:
 * - brand_name
 * - asin_count
 * - estimated_page1_revenue
 * - revenue_share_pct
 * 
 * Classification rules:
 * - HARD MOAT if: top_brand_revenue_share >= 50% OR top_3_brands_revenue_share >= 75% OR top brand has >= 3 listings ranking top 10
 * - SOFT MOAT if: top_brand_revenue_share between 30%–49% AND top_3_brands_revenue_share between 50%–74%
 * - NO MOAT otherwise
 * 
 * @param listings - Page-1 listings with brand, revenue, rank
 * @returns Brand Moat result with level, top brand, and share percentages
 */
export function analyzeBrandMoat(
  listings: PageOneListing[]
): BrandMoatResult {
  // Guard: If no listings, return NONE
  if (!listings || listings.length === 0) {
    return {
      level: "NONE",
      top_brand: null,
      top_brand_share_pct: 0,
      top_3_share_pct: 0,
      unique_brand_count: 0,
      brand_revenue_breakdown: [],
    };
  }

  // Filter listings with valid brands (exclude null/empty)
  const listingsWithBrand = listings.filter(
    l => normalizeBrand(l.brand) !== null
  );

  // If no brands available, return NONE
  if (listingsWithBrand.length === 0) {
    return {
      level: "NONE",
      top_brand: null,
      top_brand_share_pct: 0,
      top_3_share_pct: 0,
      unique_brand_count: 0,
      brand_revenue_breakdown: [],
    };
  }

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
    brand_name: string;
    asin_count: number;
    estimated_page1_revenue: number;
    revenue_share_pct: number;
    top_10_listing_count: number; // Count of listings ranking in top 10
  }> = [];

  brandGroups.forEach((brandListings, brandName) => {
    const asin_count = brandListings.length;
    
    const estimated_page1_revenue = brandListings.reduce(
      (sum, l) => sum + (l.estimated_monthly_revenue || 0),
      0
    );
    
    const revenue_share_pct =
      totalPage1Revenue > 0
        ? (estimated_page1_revenue / totalPage1Revenue) * 100
        : 0;

    // Count listings ranking in top 10 (rank <= 10, lower is better)
    const top_10_listing_count = brandListings.filter(l => {
      const pos = l.page_position ?? l.rank;
      return pos !== null && pos !== undefined && pos > 0 && pos <= 10;
    }).length;

    brandMetrics.push({
      brand_name: brandName,
      asin_count,
      estimated_page1_revenue,
      revenue_share_pct,
      top_10_listing_count,
    });
  });

  // Sort by revenue share (descending)
  brandMetrics.sort((a, b) => b.revenue_share_pct - a.revenue_share_pct);

  // Get top brand
  const topBrand = brandMetrics[0];
  const top_brand_share_pct = topBrand ? topBrand.revenue_share_pct : 0;
  const top_brand_name = topBrand && topBrand.revenue_share_pct > 0 ? topBrand.brand_name : null;

  // Calculate top 3 brands revenue share
  const top3Revenue = brandMetrics
    .slice(0, 3)
    .reduce((sum, b) => sum + b.estimated_page1_revenue, 0);
  const top_3_share_pct =
    totalPage1Revenue > 0 ? (top3Revenue / totalPage1Revenue) * 100 : 0;

  // Unique brand count
  const unique_brand_count = brandGroups.size;

  // ──────────────────────────────────────────────────────────────────────────────
  // BRAND MOAT CLASSIFICATION
  // ──────────────────────────────────────────────────────────────────────────────
  // HARD MOAT if:
  //   - top_brand_revenue_share >= 50%
  //   OR
  //   - top_3_brands_revenue_share >= 75%
  //   OR
  //   - top brand has >= 3 listings ranking top 10
  //
  // SOFT MOAT if:
  //   - top_brand_revenue_share between 30%–49%
  //   AND
  //   - top_3_brands_revenue_share between 50%–74%
  //
  // NO MOAT otherwise

  let level: "HARD" | "SOFT" | "NONE" = "NONE";

  // Check HARD MOAT thresholds
  if (
    top_brand_share_pct >= 50 ||
    top_3_share_pct >= 75 ||
    (topBrand && topBrand.top_10_listing_count >= 3)
  ) {
    level = "HARD";
  }
  // Check SOFT MOAT thresholds (only if not HARD)
  else if (
    top_brand_share_pct >= 30 &&
    top_brand_share_pct < 50 &&
    top_3_share_pct >= 50 &&
    top_3_share_pct < 75
  ) {
    level = "SOFT";
  }
  // Otherwise NONE (already default)

  // Build brand revenue breakdown array (sorted by revenue share descending)
  const brand_revenue_breakdown: BrandRevenueBreakdown[] = brandMetrics.map(bm => ({
    brand: bm.brand_name,
    revenue: bm.estimated_page1_revenue,
    share_pct: Math.round(bm.revenue_share_pct * 100) / 100,
    asin_count: bm.asin_count,
    top10_count: bm.top_10_listing_count,
  }));

  // Build result
  const result: BrandMoatResult = {
    level,
    top_brand: top_brand_name,
    top_brand_share_pct: Math.round(top_brand_share_pct * 100) / 100,
    top_3_share_pct: Math.round(top_3_share_pct * 100) / 100,
    unique_brand_count,
    brand_revenue_breakdown,
  };

  return result;
}
