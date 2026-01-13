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
 * Extracts brand from title locally (NO API CALLS)
 * Same logic as in keywordMarket.ts
 */
function extractBrandFromTitle(title: string | null): string | null {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return null;
  }

  // Common brand name patterns and normalizations
  const brandNormalizations: Record<string, string> = {
    'amazon basics': 'Amazon Basics',
    'amazonbasics': 'Amazon Basics',
    'bella': 'BELLA',
    'chefman': 'Chefman',
    'cuisinart': 'Cuisinart',
    'hamilton beach': 'Hamilton Beach',
    'instant pot': 'Instant Pot',
    'kitchenaid': 'KitchenAid',
    'ninja': 'Ninja',
    'oster': 'Oster',
    'presto': 'Presto',
    'sunbeam': 'Sunbeam',
  };

  // Pattern 1: First 1-3 capitalized words before common separators
  const pattern1 = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/);
  if (pattern1) {
    const candidate = pattern1[1].trim();
    // Normalize if known brand
    const normalized = brandNormalizations[candidate.toLowerCase()];
    if (normalized) {
      return normalized;
    }
    // Return as-is if it looks like a brand (2-3 words max, all capitalized start)
    if (candidate.split(/\s+/).length <= 3) {
      return candidate;
    }
  }

  // Pattern 2: All caps brand at start (e.g., "BESIGN", "FERVINOW")
  const pattern2 = title.match(/^([A-Z]{2,}(?:\s+[A-Z]{2,})?)/);
  if (pattern2) {
    return pattern2[1].trim();
  }

  return null;
}

/**
 * Normalizes a raw listing object from any source into a consistent ParsedListing format
 * 🚨 COST OPTIMIZATION: Extracts brand from title locally (NO API CALLS)
 */
export function normalizeListing(raw: any): ParsedListing {
  // Extract main category BSR (preferred method)
  const mainBSRData = extractMainCategoryBSR(raw);
  const main_category_bsr = mainBSRData ? mainBSRData.rank : null;
  const main_category = mainBSRData ? mainBSRData.category : null;
  
  // Legacy bsr field (for backward compatibility)
  const bsr = main_category_bsr ?? raw.bsr ?? raw.BSR ?? raw.best_seller_rank ?? raw.rank ?? null;
  
  // Extract title
  const title = raw.title ?? raw.Title ?? "";
  
  // 🚨 COST OPTIMIZATION: Extract brand from title locally if brand field is missing
  const explicitBrand = raw.brand ?? raw.Brand ?? null;
  const brand = explicitBrand || (title ? extractBrandFromTitle(title) : null);
  
  // Extract raw fields for presentation fallback (preserve if they exist)
  const raw_title = raw.raw_title ?? null;
  const raw_image_url = raw.raw_image_url ?? null;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FULFILLMENT NORMALIZATION: Infer FBA from Prime eligibility indicators
  // ═══════════════════════════════════════════════════════════════════════════
  // Cached listings may lack fulfillment_channel but have Prime indicators
  // Check for Prime eligibility to infer FBA
  let fulfillment: "FBA" | "FBM" | "Amazon" | null = raw.fulfillment ?? raw.Fulfillment ?? null;
  
  // If fulfillment is not already set, check for Prime indicators
  if (!fulfillment) {
    // Check is_prime flag
    if (raw.is_prime === true || raw.isPrime === true) {
      fulfillment = "FBA";
    }
    // Check delivery field for "Prime" text
    else if (raw.delivery) {
      const deliveryStr = typeof raw.delivery === 'string' 
        ? raw.delivery 
        : (raw.delivery?.text || raw.delivery?.message || String(raw.delivery));
      if (typeof deliveryStr === 'string' && deliveryStr.toLowerCase().includes('prime')) {
        fulfillment = "FBA";
      }
    }
    // Check badges array for "Prime" badge
    else if (raw.badges && Array.isArray(raw.badges)) {
      const hasPrimeBadge = raw.badges.some((badge: any) => {
        const badgeText = typeof badge === 'string' 
          ? badge 
          : (badge?.text || badge?.label || String(badge));
        return typeof badgeText === 'string' && badgeText.toLowerCase().includes('prime');
      });
      if (hasPrimeBadge) {
        fulfillment = "FBA";
      }
    }
  }
  
  // Fallback to existing fulfillment if still null
  if (!fulfillment) {
    fulfillment = null;
  }
  
  return {
    asin: raw.asin ?? raw.ASIN ?? "",
    title,
    price: raw.price?.value ?? raw.price ?? raw.Price ?? null,
    rating: raw.rating ?? raw.Rating ?? null,
    reviews: raw.reviews?.count ?? raw.reviews ?? raw.Reviews ?? raw.review_count ?? null,
    image: raw.image ?? raw.image_url ?? raw.Image ?? raw.images?.[0] ?? null,
    bsr, // DEPRECATED: use main_category_bsr
    main_category_bsr, // Main category BSR (top-level category only)
    main_category, // Main category name
    fulfillment,
    sponsored: !!raw.is_sponsored || !!raw.IsSponsored || false,
    organic_rank: raw.organic_rank ?? raw.position ?? raw.Position ?? null,
    brand, // Extracted from title if not explicitly provided
    // Preserve raw fields for presentation fallback
    raw_title,
    raw_image_url,
  } as ParsedListing & { raw_title?: string | null; raw_image_url?: string | null };
}
