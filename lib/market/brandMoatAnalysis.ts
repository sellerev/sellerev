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


export interface BrandBreakdown {
  brand: string;
  asin_count: number;
  total_revenue: number;
  revenue_share_pct: number;
}

export interface BrandMoatResult {
  moat_strength: "strong" | "moderate" | "weak" | "none";
  total_brands_count: number;
  top_brand_revenue_share_pct: number;
  top_3_brands_revenue_share_pct: number;
  brand_breakdown: BrandBreakdown[];
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
 * Missing brand = "Unknown" (NOT excluded from calculation)
 */
function normalizeBrand(brand: string | null | undefined): string {
  if (!brand || typeof brand !== "string" || brand.trim().length === 0) {
    return "Unknown";
  }
  return brand.trim();
}


/**
 * Analyzes Brand Moat from Page-1 listings.
 * 
 * Pure derived aggregation using ONLY canonical Page-1 data.
 * 
 * Aggregates Page-1 listings by brand and computes:
 * - brand (includes "Unknown" for missing brands)
 * - asin_count
 * - total_revenue (sum of estimated_monthly_revenue)
 * - revenue_share_pct (vs total Page-1 revenue)
 * 
 * MOAT THRESHOLDS (HARD RULES):
 * - Strong moat: top brand ≥ 35% OR top 3 brands ≥ 65%
 * - Moderate moat: top brand 25–34% OR top 3 brands 50–64%
 * - Weak moat: top brand 15–24%
 * - None: top brand < 15%
 * 
 * @param listings - Page-1 listings with brand, estimated_monthly_revenue, rank
 * @returns Brand Moat result with moat_strength, brand breakdown, and share percentages
 */
export function analyzeBrandMoat(
  listings: PageOneListing[]
): BrandMoatResult {
  // Guard: If no listings, return none
  if (!listings || listings.length === 0) {
    return {
      moat_strength: "none",
      total_brands_count: 0,
      top_brand_revenue_share_pct: 0,
      top_3_brands_revenue_share_pct: 0,
      brand_breakdown: [],
    };
  }

  // Group ALL listings by brand (missing brands = "Unknown")
  const brandGroups = new Map<string, PageOneListing[]>();
  
  listings.forEach((listing) => {
    const brand = normalizeBrand(listing.brand);
    if (!brandGroups.has(brand)) {
      brandGroups.set(brand, []);
    }
    brandGroups.get(brand)!.push(listing);
  });

  // Calculate total Page-1 revenue (from ALL listings, including Unknown brands)
  const totalPage1Revenue = listings.reduce(
    (sum, l) => sum + (l.estimated_monthly_revenue || 0),
    0
  );

  // Compute metrics per brand
  const brandBreakdown: BrandBreakdown[] = [];

  brandGroups.forEach((brandListings, brandName) => {
    const asin_count = brandListings.length;
    
    const total_revenue = brandListings.reduce(
      (sum, l) => sum + (l.estimated_monthly_revenue || 0),
      0
    );
    
    const revenue_share_pct =
      totalPage1Revenue > 0
        ? (total_revenue / totalPage1Revenue) * 100
        : 0;

    brandBreakdown.push({
      brand: brandName,
      asin_count,
      total_revenue,
      revenue_share_pct: Math.round(revenue_share_pct * 100) / 100, // Round to 2 decimals
    });
  });

  // Sort by revenue share (descending)
  brandBreakdown.sort((a, b) => b.revenue_share_pct - a.revenue_share_pct);

  // Get top brand share
  const topBrand = brandBreakdown[0];
  const top_brand_revenue_share_pct = topBrand ? topBrand.revenue_share_pct : 0;

  // Calculate top 3 brands revenue share
  const top3Revenue = brandBreakdown
    .slice(0, 3)
    .reduce((sum, b) => sum + b.total_revenue, 0);
  const top_3_brands_revenue_share_pct =
    totalPage1Revenue > 0 ? Math.round((top3Revenue / totalPage1Revenue) * 100 * 100) / 100 : 0;

  // Total brands count
  const total_brands_count = brandGroups.size;

  // ──────────────────────────────────────────────────────────────────────────────
  // BRAND MOAT CLASSIFICATION (HARD RULES)
  // ──────────────────────────────────────────────────────────────────────────────
  // Strong moat:
  //   - top brand ≥ 35% OR
  //   - top 3 brands ≥ 65%
  //
  // Moderate moat:
  //   - top brand 25–34% OR
  //   - top 3 brands 50–64%
  //
  // Weak moat:
  //   - top brand 15–24%
  //
  // None:
  //   - top brand < 15%

  let moat_strength: "strong" | "moderate" | "weak" | "none" = "none";

  // Check Strong moat thresholds (must check first)
  if (top_brand_revenue_share_pct >= 35 || top_3_brands_revenue_share_pct >= 65) {
    moat_strength = "strong";
  }
  // Check Moderate moat thresholds (only if not strong)
  else if (
    (top_brand_revenue_share_pct >= 25 && top_brand_revenue_share_pct < 35) ||
    (top_3_brands_revenue_share_pct >= 50 && top_3_brands_revenue_share_pct < 65)
  ) {
    moat_strength = "moderate";
  }
  // Check Weak moat thresholds (only if not strong or moderate)
  else if (top_brand_revenue_share_pct >= 15 && top_brand_revenue_share_pct < 25) {
    moat_strength = "weak";
  }
  // Otherwise none (already default)

  // Build result
  const result: BrandMoatResult = {
    moat_strength,
    total_brands_count,
    top_brand_revenue_share_pct,
    top_3_brands_revenue_share_pct,
    brand_breakdown,
  };

  return result;
}
