/**
 * Normalize listing data from various sources (Rainforest API, legacy formats)
 * Ensures consistent field names and types across the application
 */

export interface ParsedListing {
  asin: string;
  title: string;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  image: string | null;
  bsr: number | null; // DEPRECATED: use main_category_bsr
  main_category_bsr: number | null; // Main category Best Seller Rank (top-level category only)
  main_category: string | null; // Main category name (e.g., "Home & Kitchen")
  fulfillment: "FBA" | "FBM" | "Amazon" | null;
  sponsored: boolean;
  organic_rank: number | null;
  brand: string | null;
}

/**
 * Extracts main category BSR from product data (handles various formats)
 * CRITICAL: Uses main category BSR (index 0 of bestsellers_rank array), NOT subcategories
 */
function extractMainCategoryBSR(raw: any): { rank: number; category: string } | null {
  // CRITICAL: Use main category BSR (index 0), NOT subcategory
  // Try bestsellers_rank array first (Rainforest API format)
  if (raw.bestsellers_rank && Array.isArray(raw.bestsellers_rank) && raw.bestsellers_rank.length > 0) {
    const mainBSR = raw.bestsellers_rank[0];
    if (mainBSR.rank !== undefined && mainBSR.rank !== null) {
      const rank = parseInt(mainBSR.rank.toString().replace(/,/g, ""), 10);
      if (!isNaN(rank) && rank > 0) {
        const category = mainBSR.category || mainBSR.Category || mainBSR.category_name || null;
        return {
          rank,
          category: category || 'default'
        };
      }
    }
  }
  
  // Fallback: use main_category_bsr if already extracted
  if (raw.main_category_bsr !== undefined && raw.main_category_bsr !== null) {
    const rank = parseInt(raw.main_category_bsr.toString().replace(/,/g, ""), 10);
    if (!isNaN(rank) && rank > 0) {
      return {
        rank,
        category: raw.main_category || 'default'
      };
    }
  }
  
  // Legacy fallback: try direct bsr field
  if (raw.bsr !== undefined && raw.bsr !== null) {
    const rank = parseInt(raw.bsr.toString().replace(/,/g, ""), 10);
    if (!isNaN(rank) && rank > 0) {
      return {
        rank,
        category: raw.main_category || raw.category || 'default'
      };
    }
  }
  
  return null;
}

/**
 * Normalizes a raw listing object from any source into a consistent ParsedListing format
 */
export function normalizeListing(raw: any): ParsedListing {
  // Extract main category BSR (preferred method)
  const mainBSRData = extractMainCategoryBSR(raw);
  const main_category_bsr = mainBSRData ? mainBSRData.rank : null;
  const main_category = mainBSRData ? mainBSRData.category : null;
  
  // Legacy bsr field (for backward compatibility)
  const bsr = main_category_bsr ?? raw.bsr ?? raw.BSR ?? raw.best_seller_rank ?? raw.rank ?? null;
  
  return {
    asin: raw.asin ?? raw.ASIN ?? "",
    title: raw.title ?? raw.Title ?? "",
    price: raw.price?.value ?? raw.price ?? raw.Price ?? null,
    rating: raw.rating ?? raw.Rating ?? null,
    reviews: raw.reviews?.count ?? raw.reviews ?? raw.Reviews ?? raw.review_count ?? null,
    image: raw.image ?? raw.image_url ?? raw.Image ?? raw.images?.[0] ?? null,
    bsr, // DEPRECATED: use main_category_bsr
    main_category_bsr, // Main category BSR (top-level category only)
    main_category, // Main category name
    fulfillment: raw.fulfillment ?? raw.Fulfillment ?? null,
    sponsored: !!raw.is_sponsored ?? !!raw.IsSponsored ?? false,
    organic_rank: raw.organic_rank ?? raw.position ?? raw.Position ?? null,
    brand: raw.brand ?? raw.Brand ?? null,
  };
}
