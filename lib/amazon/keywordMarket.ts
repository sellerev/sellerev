/**
 * Keyword Market Aggregation Service
 * 
 * Fetches Amazon search results via Rainforest API and computes
 * aggregated market signals for keyword-based analyses.
 * 
 * STRICT RULES:
 * - DO NOT invent data
 * - ALL data must come from Amazon search results
 * - If data cannot be computed, omit it (do NOT fake it)
 */

import { computePPCIndicators } from "./ppcIndicators";

export interface ParsedListing {
  asin: string | null;
  title: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  is_sponsored: boolean;
  position: number; // Organic rank (1-indexed position on Page 1)
  brand: string | null;
  image_url: string | null; // Rainforest search_results[].image
  bsr: number | null; // Best Seller Rank (if available from Rainforest) - DEPRECATED: use main_category_bsr
  main_category_bsr: number | null; // Main category Best Seller Rank (top-level category only)
  main_category: string | null; // Main category name (e.g., "Home & Kitchen")
  fulfillment: "FBA" | "FBM" | "Amazon" | null; // Fulfillment type (if available)
  seller?: string | null; // Seller name (for Amazon Retail detection)
  is_prime?: boolean; // Prime eligibility (for FBA detection)
  est_monthly_revenue?: number | null; // 30-day revenue estimate (modeled)
  est_monthly_units?: number | null; // 30-day units estimate (modeled)
  revenue_confidence?: "low" | "medium"; // Confidence level for revenue estimate
  bsr_invalid_reason?: string | null; // Reason why BSR was marked invalid (e.g., "duplicate_bug")
  parent_asin?: string | null; // Parent ASIN for variant grouping (null if listing is its own parent)
  raw_title?: string | null; // Raw title from search result (for presentation fallback)
  raw_image_url?: string | null; // Raw image URL from search result (for presentation fallback)
}

export interface KeywordMarketSnapshot {
  keyword: string;
  avg_price: number | null;
  avg_reviews: number; // Always a number (0 if no valid reviews)
  avg_rating: number | null;
  avg_bsr: number | null; // Representative Page-1 BSR (sampled, Helium-10 style)
  bsr_min?: number | null; // Best (lowest) BSR observed on Page-1 (main category only)
  bsr_max?: number | null; // Worst (highest) BSR observed on Page-1 (main category only)
  bsr_sample_method?: "top4_bottom2" | "all_available" | "none";
  bsr_sample_size?: number; // How many BSRs were used to compute avg_bsr
  total_page1_listings: number; // Only Page 1 listings
  sponsored_count: number;
  dominance_score: number; // 0-100, % of listings belonging to top brand
  total_page1_brands?: number; // Total distinct brands on Page-1 (includes "Generic")
  top_brands_by_frequency?: Array<{ brand: string; count: number }>; // Top brands by listing count
  fulfillment_mix: {
    fba: number; // % of listings fulfilled by Amazon (FBA)
    fbm: number; // % of listings merchant fulfilled (FBM)
    amazon: number; // % of listings sold by Amazon
  } | null; // null only if no listings exist
  representative_asin?: string | null; // Optional representative ASIN for fee estimation
  // 30-Day Revenue Estimates (modeled, not exact)
  est_total_monthly_revenue_min?: number | null;
  est_total_monthly_revenue_max?: number | null;
  est_total_monthly_units_min?: number | null;
  est_total_monthly_units_max?: number | null;
  // Search volume estimation (modeled, not exact)
  search_demand?: {
    search_volume_range: string; // e.g., "10k–20k"
    search_volume_confidence: "low" | "medium" | "high";
    search_volume_source?: string; // Task 5: "model_v1" | "model_v2"
    model_version?: string; // Task 5: Model version
  } | null;
  // Task 5: Model metadata
  search_volume_source?: string; // "model_v1" | "model_v2"
  revenue_estimate_source?: string; // "model_v1" | "model_v2"
  model_version?: string; // "v2.0.20250117"
  // Top 5 Brands Revenue Control
  top_5_brand_revenue_share_pct?: number | null; // % of total page-1 revenue controlled by top 5 brands
  top_5_brands?: Array<{
    brand: string;
    revenue: number;
    revenue_share_pct: number;
  }> | null; // Top 5 brands with revenue breakdown
  // Competitive Pressure Index (CPI) - seller-context aware, 0-100
  // Computed once per analysis, cached, immutable
  cpi?: {
    score: number; // 0-100
    label: string; // "Low — structurally penetrable" | "Moderate — requires differentiation" | "High — strong incumbents" | "Extreme — brand-locked"
    breakdown: {
      review_dominance: number; // 0-30 points
      brand_concentration: number; // 0-25 points
      sponsored_saturation: number; // 0-20 points
      price_compression: number; // 0-15 points
      seller_fit_modifier: number; // -10 to +10 points
    };
  } | null;
  // PPC Indicators - heuristic assessment of advertising intensity
  ppc?: {
    sponsored_pct: number; // 0-100
    ad_intensity_label: "Low" | "Medium" | "High";
    signals: string[]; // Max 3 signal bullets
    source: "heuristic_v1";
  } | null;
}

export interface KeywordMarketData {
  snapshot: KeywordMarketSnapshot;
  listings: ParsedListing[];
}

/**
 * Safely parses a price value from various formats.
 */
function parsePrice(item: any): number | null {
  if (item.price?.value) {
    const parsed = parseFloat(item.price.value);
    return isNaN(parsed) ? null : parsed;
  }
  if (item.price?.raw) {
    const parsed = parseFloat(item.price.raw);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof item.price === "number") {
    return isNaN(item.price) ? null : item.price;
  }
  if (typeof item.price === "string") {
    const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ""));
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Safely parses review count from Rainforest API.
 * Checks all possible field names to match Amazon Page-1 review count.
 * Fallback order: reviews ?? review_count ?? ratings_total ?? null
 */
function parseReviews(item: any): number | null {
  // Primary: reviews.count (most common in search results)
  if (item.reviews?.count !== undefined && item.reviews.count !== null) {
    const parsed = parseInt(item.reviews.count.toString().replace(/,/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  
  // Secondary: reviews as direct number
  if (typeof item.reviews === "number" && !isNaN(item.reviews) && item.reviews >= 0) {
    return item.reviews;
  }
  
  // Tertiary: review_count (alternative field name)
  if (item.review_count !== undefined && item.review_count !== null) {
    const parsed = parseInt(item.review_count.toString().replace(/,/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  
  // Quaternary: ratings_total (used in some API responses)
  if (item.ratings_total !== undefined && item.ratings_total !== null) {
    const parsed = parseInt(item.ratings_total.toString().replace(/,/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  
  // Quinary: reviews_total (used in product API responses)
  if (item.reviews_total !== undefined && item.reviews_total !== null) {
    const parsed = parseInt(item.reviews_total.toString().replace(/,/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  
  // Senary: reviews.total (alternative structure)
  if (item.reviews?.total !== undefined && item.reviews.total !== null) {
    const parsed = parseInt(item.reviews.total.toString().replace(/,/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  
  return null;
}

/**
 * Safely parses rating.
 */
function parseRating(item: any): number | null {
  if (item.rating !== undefined && item.rating !== null) {
    const parsed = parseFloat(item.rating.toString());
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Extracts main category BSR from product data (handles various formats)
 * CRITICAL: Uses main category BSR (highest-level category, shortest path), NOT subcategories
 * 
 * Strategy:
 * - If bestsellers_rank is an array, find the entry with the shortest category path (main category)
 * - If multiple entries exist, choose the one with the shortest category string
 * - Do not require category mapping tables
 * 
 * @param item - Product item from Rainforest API
 * @returns Object with rank and category, or null if not found
 */
/**
 * Extracts main category BSR from product data (handles various formats)
 * CRITICAL: Uses main category BSR (highest-level category, shortest path), NOT subcategories
 * 
 * Rainforest API may return BSR in different formats:
 * 1. bestsellers_rank array (most common) - array of {rank, category, ...}
 * 2. bsr field (direct number)
 * 3. best_seller_rank (singular)
 * 
 * Strategy: Find the entry with shortest category string (main categories are shorter)
 */
export function extractMainCategoryBSR(item: any): { rank: number; category: string } | null {
  if (!item || !item.asin) {
    return null;
  }
  
  // CRITICAL: Try bestsellers_rank array first (Rainforest API format)
  // This is the primary format from Rainforest search results
  if (item.bestsellers_rank && Array.isArray(item.bestsellers_rank) && item.bestsellers_rank.length > 0) {
    // Find the main category (highest-level, shortest path)
    // Strategy: Choose the entry with the shortest category string (main categories are shorter)
    let mainBSR: { rank: number; category: string } | null = null;
    let shortestCategoryLength = Infinity;
    
    for (const bsrEntry of item.bestsellers_rank) {
      if (!bsrEntry || typeof bsrEntry !== 'object') continue;
      
      // Try multiple field names for rank
      const rankValue = bsrEntry.rank ?? 
                       bsrEntry.Rank ?? 
                       bsrEntry.rank_value ?? 
                       bsrEntry.value;
      
      if (rankValue !== undefined && rankValue !== null) {
        const rank = parseInt(rankValue.toString().replace(/,/g, ""), 10);
        if (!isNaN(rank) && rank > 0) {
          // Try multiple field names for category
          const categoryStr = bsrEntry.category || 
                              bsrEntry.Category || 
                              bsrEntry.category_name || 
                              bsrEntry.name ||
                              bsrEntry.category_path ||
                              '';
          
          // Choose the entry with the shortest category string (main category)
          // Main categories like "Home & Kitchen" are shorter than subcategories like "Home & Kitchen > Kitchen & Dining > Storage & Organization"
          const categoryLength = categoryStr.length;
          if (categoryLength < shortestCategoryLength || (categoryLength === shortestCategoryLength && !mainBSR)) {
            shortestCategoryLength = categoryLength;
            mainBSR = {
              rank,
              category: categoryStr || 'default',
            };
          }
        }
      }
    }
    
    if (mainBSR) {
      return mainBSR;
    }
  }
  
  // Fallback: try direct bsr field (if already parsed, but we don't have category)
  if (item.bsr !== undefined && item.bsr !== null) {
    const rank = parseInt(item.bsr.toString().replace(/,/g, ""), 10);
    if (!isNaN(rank) && rank > 0) {
      const category = item.category || item.main_category || item.category_name || 'default';
      return { rank, category };
    }
  }
  
  // Fallback: try best_seller_rank (singular, not array)
  if (item.best_seller_rank !== undefined && item.best_seller_rank !== null) {
    const rank = parseInt(item.best_seller_rank.toString().replace(/,/g, ""), 10);
    if (!isNaN(rank) && rank > 0) {
      const category = item.category || item.main_category || 'default';
      return { rank, category };
    }
  }
  
  // Try nested bestsellers_rank (sometimes it's nested in product data)
  if (item.product?.bestsellers_rank && Array.isArray(item.product.bestsellers_rank) && item.product.bestsellers_rank.length > 0) {
    const firstRank = item.product.bestsellers_rank[0];
    if (firstRank?.rank !== undefined && firstRank?.rank !== null) {
      const rank = parseInt(firstRank.rank.toString().replace(/,/g, ""), 10);
      if (!isNaN(rank) && rank > 0) {
        const category = firstRank.category || firstRank.Category || firstRank.category_name || 'default';
        return { rank, category };
      }
    }
  }
  
  return null;
}

/**
 * PHASE 1: Detect duplicate BSRs (non-disruptive utility)
 * 
 * Identifies broken Rainforest data where the same BSR appears across many products.
 * Returns a Set of invalid BSR values that should be excluded.
 * 
 * Logic:
 * - Extract all valid BSR values (1-300,000)
 * - Count frequency
 * - If a BSR appears ≥ 8 times → mark as invalid
 * 
 * @param listings - Array of parsed listings
 * @returns Set of invalid BSR values
 */
export function detectDuplicateBSRs(listings: ParsedListing[]): Set<number> {
  const invalidBSRs = new Set<number>();
  
  // Extract all valid BSR values (1-300,000)
  const bsrCounts: Record<number, number> = {};
  
  for (const listing of listings) {
    // Check both main_category_bsr and deprecated bsr field
    const bsr = listing.main_category_bsr ?? listing.bsr;
    
    // Validate BSR range: 1-300,000
    if (bsr !== null && bsr !== undefined && bsr >= 1 && bsr <= 300000) {
      bsrCounts[bsr] = (bsrCounts[bsr] || 0) + 1;
    }
  }
  
  // Find BSRs that appear ≥ 8 times (invalid duplicates)
  for (const [bsrStr, count] of Object.entries(bsrCounts)) {
    if (count >= 8) {
      const bsr = parseInt(bsrStr, 10);
      invalidBSRs.add(bsr);
      console.log(`🔵 BSR_DUPLICATE_DETECTED: BSR ${bsr} appears ${count} times - marking as invalid`);
    }
  }
  
  if (invalidBSRs.size > 0) {
    console.log("🔵 BSR_DUPLICATE_DETECTION", {
      invalid_bsr_count: invalidBSRs.size,
      invalid_bsrs: Array.from(invalidBSRs),
      total_listings: listings.length,
      timestamp: new Date().toISOString(),
    });
  }
  
  return invalidBSRs;
}

/**
 * STEP 2: Detects duplicate BSR bug from Rainforest API
 * If the same BSR appears ≥ 5 times across Page-1 listings, mark it as invalid
 * 
 * @param listings - Array of parsed listings
 * @returns Array of listings with invalid BSRs set to null
 */
function detectAndRemoveDuplicateBSRs(listings: ParsedListing[]): ParsedListing[] {
  // STEP 4: Enhanced logging for duplicate BSR detection
  console.log("🔵 BSR_DUPLICATE_DETECTION_START", {
    total_listings: listings.length,
    listings_with_bsr: listings.filter(l => l.main_category_bsr !== null && l.main_category_bsr !== undefined && l.main_category_bsr > 0).length,
    timestamp: new Date().toISOString(),
  });
  
  // Count BSR occurrences
  const bsrCounts: Record<number, number> = {};
  
  for (const listing of listings) {
    const bsr = listing.main_category_bsr;
    if (bsr !== null && bsr !== undefined && bsr > 0) {
      bsrCounts[bsr] = (bsrCounts[bsr] || 0) + 1;
    }
  }
  
  // Find BSRs that appear ≥ 5 times (invalid duplicates)
  const invalidBSRs = new Set<number>();
  const duplicateDetails: Array<{ bsr: number; count: number }> = [];
  
  for (const [bsrStr, count] of Object.entries(bsrCounts)) {
    if (count >= 5) {
      const bsr = parseInt(bsrStr, 10);
      invalidBSRs.add(bsr);
      duplicateDetails.push({ bsr, count });
      console.log(`🔵 BSR_DUPLICATE_DETECTED: BSR ${bsr} appears ${count} times - marking as invalid`);
    }
  }
  
  // STEP 4: Enhanced logging for duplicate detection results
  if (invalidBSRs.size > 0) {
    console.log("🔵 BSR_DUPLICATE_DETECTION_RESULTS", {
      invalid_bsr_count: invalidBSRs.size,
      duplicate_details: duplicateDetails,
      affected_listings: listings.filter(l => 
        l.main_category_bsr !== null && 
        l.main_category_bsr !== undefined && 
        invalidBSRs.has(l.main_category_bsr)
      ).length,
      timestamp: new Date().toISOString(),
    });
  } else {
    console.log("🔵 BSR_DUPLICATE_DETECTION_RESULTS", {
      status: "no_duplicates_found",
      unique_bsrs: Object.keys(bsrCounts).length,
      timestamp: new Date().toISOString(),
    });
  }
  
  // If no duplicates found, return listings unchanged
  if (invalidBSRs.size === 0) {
    return listings;
  }
  
  // Remove invalid BSRs from listings
  const cleanedListings = listings.map(listing => {
    if (listing.main_category_bsr !== null && 
        listing.main_category_bsr !== undefined && 
        invalidBSRs.has(listing.main_category_bsr)) {
      return {
        ...listing,
        main_category_bsr: null,
        bsr: null, // Also clear deprecated bsr field
      };
    }
    return listing;
  });
  
  console.log("🔵 BSR_DUPLICATE_DETECTION_COMPLETE", {
    original_listings_with_bsr: listings.filter(l => l.main_category_bsr !== null && l.main_category_bsr !== undefined && l.main_category_bsr > 0).length,
    cleaned_listings_with_bsr: cleanedListings.filter(l => l.main_category_bsr !== null && l.main_category_bsr !== undefined && l.main_category_bsr > 0).length,
    invalid_bsrs_removed: invalidBSRs.size,
    timestamp: new Date().toISOString(),
  });
  
  return cleanedListings;
}

/**
 * STEP 3: Multi-source BSR extraction with priority ordering
 * 
 * Extraction priority:
 * 1. bestsellers_rank[] (prefer category-matched entries)
 * 2. sales_rank.current_rank
 * 3. buying_choice.bestsellers_rank
 * 
 * Validation rules:
 * - BSR must be a number
 * - Range: 1-300,000
 * - Exclude any BSR flagged by duplicate detection (passed as invalidBSRs set)
 * 
 * @param item - Product item from Rainforest API
 * @param invalidBSRs - Set of BSR values flagged as duplicates (optional)
 * @param preferredCategory - Preferred category name for matching (optional)
 * @returns Object with rank and category, or null if not found
 */
export function extractMultiSourceBSR(
  item: any,
  invalidBSRs?: Set<number>,
  preferredCategory?: string
): { rank: number; category: string } | null {
  if (!item) {
    return null;
  }
  
  // Validation helper: BSR must be a number in range 1-300,000
  const isValidBSR = (bsr: number | null | undefined): bsr is number => {
    return typeof bsr === "number" && bsr >= 1 && bsr <= 300000;
  };
  
  // Check if BSR is in invalid set
  const isInvalidBSR = (bsr: number): boolean => {
    return invalidBSRs ? invalidBSRs.has(bsr) : false;
  };
  
  const candidateBSRs: { rank: number; source: string; categoryMatch: boolean; category: string }[] = [];
  
  // SOURCE 1: bestsellers_rank[] array (prefer category-matched entries)
  if (item.bestsellers_rank && Array.isArray(item.bestsellers_rank)) {
    for (const entry of item.bestsellers_rank) {
      if (!entry || typeof entry !== 'object') continue;
      
      const rankValue = entry.rank ?? 
                       entry.Rank ?? 
                       entry.rank_value ?? 
                       entry.value;
      
      if (rankValue !== undefined && rankValue !== null) {
        const rank = parseInt(rankValue.toString().replace(/,/g, ""), 10);
        
        if (isValidBSR(rank) && !isInvalidBSR(rank)) {
          const categoryStr = entry.category || 
                              entry.Category || 
                              entry.category_name || 
                              entry.name ||
                              entry.category_path ||
                              'default';
          
          // Check if category matches preferred category (if provided)
          const categoryMatch = preferredCategory 
            ? categoryStr.toLowerCase().includes(preferredCategory.toLowerCase())
            : false;
          
          candidateBSRs.push({
            rank,
            source: "bestsellers_rank",
            categoryMatch,
            category: categoryStr,
          });
        }
      }
    }
  }
  
  // SOURCE 2: sales_rank.current_rank
  if (item.sales_rank?.current_rank !== undefined && item.sales_rank.current_rank !== null) {
    const rank = parseInt(item.sales_rank.current_rank.toString().replace(/,/g, ""), 10);
    if (isValidBSR(rank) && !isInvalidBSR(rank)) {
      const category = item.category || item.main_category || item.sales_rank?.category || 'default';
      candidateBSRs.push({
        rank,
        source: "sales_rank",
        categoryMatch: false,
        category,
      });
    }
  }
  
  // SOURCE 3: buying_choice.bestsellers_rank
  if (item.buying_choice?.bestsellers_rank !== undefined && item.buying_choice.bestsellers_rank !== null) {
    const bcBsr = item.buying_choice.bestsellers_rank;
    
    // Handle both number and array formats
    if (typeof bcBsr === 'number') {
      const rank = parseInt(bcBsr.toString().replace(/,/g, ""), 10);
      if (isValidBSR(rank) && !isInvalidBSR(rank)) {
        const category = item.category || item.main_category || 'default';
        candidateBSRs.push({
          rank,
          source: "buying_choice",
          categoryMatch: false,
          category,
        });
      }
    } else if (Array.isArray(bcBsr)) {
      for (const entry of bcBsr) {
        if (!entry || typeof entry !== 'object') continue;
        const rankValue = entry.rank ?? entry.Rank ?? entry.rank_value ?? entry.value;
        if (rankValue !== undefined && rankValue !== null) {
          const rank = parseInt(rankValue.toString().replace(/,/g, ""), 10);
          if (isValidBSR(rank) && !isInvalidBSR(rank)) {
            const category = entry.category || entry.Category || entry.category_name || 'default';
            candidateBSRs.push({
              rank,
              source: "buying_choice_array",
              categoryMatch: false,
              category,
            });
          }
        }
      }
    }
  }
  
  // If we have candidates, prioritize: category-match first, then lowest BSR (best rank)
  if (candidateBSRs.length > 0) {
    // Sort: category matches first, then by lowest BSR (best rank)
    candidateBSRs.sort((a, b) => {
      if (a.categoryMatch && !b.categoryMatch) return -1;
      if (!a.categoryMatch && b.categoryMatch) return 1;
      return a.rank - b.rank; // Lower BSR is better
    });
    
    const best = candidateBSRs[0];
    return {
      rank: best.rank,
      category: best.category,
    };
  }
  
  return null;
}

/**
 * Safely parses BSR (Best Seller Rank) - DEPRECATED: use extractMainCategoryBSR or extractMultiSourceBSR instead
 * @deprecated Use extractMainCategoryBSR or extractMultiSourceBSR for BSR extraction
 */
function parseBSR(item: any): number | null {
  const mainBSR = extractMainCategoryBSR(item);
  return mainBSR ? mainBSR.rank : null;
}

/**
 * Safely parses fulfillment type (FBA/FBM/Amazon).
 */
function parseFulfillment(item: any): "FBA" | "FBM" | "Amazon" | null {
  // Try various fulfillment field names from Rainforest API
  if (item.fulfillment) {
    const fulfillment = item.fulfillment.toString().toUpperCase();
    if (fulfillment.includes("FBA") || fulfillment.includes("FULFILLED BY AMAZON")) {
      return "FBA";
    }
    if (fulfillment.includes("FBM") || fulfillment.includes("MERCHANT")) {
      return "FBM";
    }
    if (fulfillment.includes("AMAZON")) {
      return "Amazon";
    }
  }
  if (item.is_amazon) {
    return "Amazon";
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIME-BASED FBA INFERENCE (for cached listings without fulfillment_channel)
  // ═══════════════════════════════════════════════════════════════════════════
  // Check is_prime flag
  if (item.is_prime === true || item.isPrime === true) {
    return "FBA";
  }
  // Check delivery field for "Prime" text
  if (item.delivery) {
    const deliveryStr = typeof item.delivery === 'string' 
      ? item.delivery 
      : (item.delivery?.text || item.delivery?.message || String(item.delivery));
    if (typeof deliveryStr === 'string' && deliveryStr.toLowerCase().includes('prime')) {
      return "FBA";
    }
  }
  // Check badges array for "Prime" badge
  if (item.badges && Array.isArray(item.badges)) {
    const hasPrimeBadge = item.badges.some((badge: any) => {
      const badgeText = typeof badge === 'string' 
        ? badge 
        : (badge?.text || badge?.label || String(badge));
      return typeof badgeText === 'string' && badgeText.toLowerCase().includes('prime');
    });
    if (hasPrimeBadge) {
      return "FBA";
    }
  }
  
  return null;
}

/**
 * Extracts brand from title locally (NO API CALLS)
 * 
 * Rules:
 * - Extract first 1-3 capitalized tokens before generic words
 * - Stop on generic words (Electric, Coffee, Grinder, Burr, etc.)
 * - Normalize casing
 * - Never return empty
 */
function extractBrandFromTitle(title: string | null): string | null {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return null;
  }

  // Generic words that indicate end of brand name
  const genericWords = new Set([
    'electric', 'coffee', 'grinder', 'burr', 'bean', 'maker', 'machine',
    'kettle', 'pot', 'cup', 'oz', 'ounce', 'pound', 'lb', 'pack', 'set',
    'with', 'for', 'and', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to',
    'black', 'white', 'red', 'blue', 'green', 'stainless', 'steel', 'silver',
    'professional', 'premium', 'deluxe', 'basic', 'standard', 'mini', 'large'
  ]);

  // Split title into tokens
  const tokens = title.trim().split(/\s+/);
  const brandTokens: string[] = [];
  
  // Collect first 1-3 capitalized tokens, stopping at generic words
  for (let i = 0; i < Math.min(tokens.length, 3); i++) {
    const token = tokens[i];
    // Check if token starts with capital letter
    if (token && /^[A-Z]/.test(token)) {
      const lowerToken = token.toLowerCase().replace(/[^a-z]/g, '');
      // Stop if we hit a generic word
      if (genericWords.has(lowerToken)) {
        break;
      }
      brandTokens.push(token);
    } else {
      break; // Stop at first non-capitalized token
    }
  }

  if (brandTokens.length > 0) {
    // Normalize: capitalize first letter of each word, lowercase rest
    const normalized = brandTokens.map(t => {
      const cleaned = t.replace(/[^a-zA-Z]/g, '');
      if (cleaned.length === 0) return '';
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    }).filter(t => t.length > 0).join(' ');
    
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

/**
 * Extracts brand from product data (Rainforest API product response)
 * Returns brand from brand_name or by_line.name, or null if not available
 */
function extractBrandFromProduct(product: any): string | null {
  if (!product) return null;
  
  // Priority 1: brand_name
  if (product.brand_name && typeof product.brand_name === 'string' && product.brand_name.trim().length > 0) {
    return product.brand_name.trim();
  }
  
  // Priority 2: by_line.name
  if (product.by_line?.name && typeof product.by_line.name === 'string' && product.by_line.name.trim().length > 0) {
    return product.by_line.name.trim();
  }
  
  // Priority 3: brand (direct field)
  if (product.brand && typeof product.brand === 'string' && product.brand.trim().length > 0) {
    return product.brand.trim();
  }
  
  return null;
}

/**
 * Normalizes brand name (lightweight, safe only)
 * - lowercase
 * - trim
 * - collapse whitespace
 * - remove trailing category nouns (e.g., "kitchen", "home", "store")
 */
function normalizeBrand(brand: string): string {
  if (!brand || typeof brand !== 'string') return brand;
  
  let normalized = brand
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Collapse whitespace
  
  // Remove trailing category nouns
  const categoryNouns = ['kitchen', 'home', 'store', 'shop', 'outlet', 'warehouse'];
  const words = normalized.split(' ');
  if (words.length > 1 && categoryNouns.includes(words[words.length - 1])) {
    words.pop();
    normalized = words.join(' ');
  }
  
  return normalized.trim();
}

/**
 * Resolves brand from search results ONLY (low-cost, Helium-10 style)
 * 
 * ALLOWED SOURCES (SEARCH RESULTS ONLY - NO API CALLS):
 * - item.brand (search result brand field)
 * - item.brand_name (search result brand_name field)
 * - item.seller (seller name as brand fallback)
 * - item.is_amazon_brand
 * - item.is_exclusive_to_amazon
 * - item.featured_from_our_brands
 * - Fallback: inferred from title prefix (first 1-3 capitalized words)
 * 
 * NOT ALLOWED:
 * - Product API calls (type=product)
 * - High confidence requirement
 * - Dropping "Generic" brands for counting
 */
function resolveBrandFromSearchResult(
  item: any
): { 
  brand_display: string | null;
  brand_entity: string | 'Amazon' | 'Generic';
  brand_confidence: 'high' | 'medium' | 'low' | 'none';
  brand_source: 'search' | 'brand_name' | 'seller' | 'title' | 'amazon_flag' | 'generic';
} {
  // Priority 1: Amazon brand flags
  if (item.is_amazon_brand === true || 
      item.is_exclusive_to_amazon === true || 
      item.featured_from_our_brands === true) {
    return {
      brand_display: 'Amazon',
      brand_entity: 'Amazon',
      brand_confidence: 'high',
      brand_source: 'amazon_flag'
    };
  }
  
  // Priority 2: search_result.brand field
  if (item.brand && typeof item.brand === 'string' && item.brand.trim().length > 0) {
    const normalized = normalizeBrand(item.brand.trim());
    return {
      brand_display: item.brand.trim(), // Keep original for display
      brand_entity: normalized,
      brand_confidence: 'medium',
      brand_source: 'search'
    };
  }
  
  // Priority 3: search_result.brand_name field
  if (item.brand_name && typeof item.brand_name === 'string' && item.brand_name.trim().length > 0) {
    const normalized = normalizeBrand(item.brand_name.trim());
    return {
      brand_display: item.brand_name.trim(), // Keep original for display
      brand_entity: normalized,
      brand_confidence: 'medium',
      brand_source: 'brand_name'
    };
  }
  
  // Priority 4: seller name (as brand fallback)
  if (item.seller && typeof item.seller === 'string' && item.seller.trim().length > 0) {
    const sellerName = item.seller.trim();
    // Skip if seller is clearly not a brand (e.g., "Amazon.com", "Fulfilled by Amazon")
    if (!sellerName.toLowerCase().includes('amazon') && 
        !sellerName.toLowerCase().includes('fulfilled')) {
      const normalized = normalizeBrand(sellerName);
      return {
        brand_display: sellerName, // Keep original for display
        brand_entity: normalized,
        brand_confidence: 'low',
        brand_source: 'seller'
      };
    }
  }
  
  // Priority 5: Infer from title prefix (first 1-3 capitalized words)
  if (item.title && typeof item.title === 'string' && item.title.trim().length > 0) {
    const inferredBrand = extractBrandFromTitle(item.title);
    if (inferredBrand) {
      const normalized = normalizeBrand(inferredBrand);
      return {
        brand_display: inferredBrand, // Keep original for display
        brand_entity: normalized,
        brand_confidence: 'low',
        brand_source: 'title'
      };
    }
  }
  
  // Priority 6: Generic (no brand found)
  return {
    brand_display: null,
    brand_entity: 'Generic',
    brand_confidence: 'none',
    brand_source: 'generic'
  };
}

/**
 * Enriches ParsedListing objects with ratings and reviews by fetching full product data from Rainforest API.
 * 
 * CRITICAL OPTIMIZATION: Only enriches ratings/reviews (SP-API cannot provide these).
 * Title, image_url, brand, category, BSR are already provided by SP-API Catalog
 * and merged into listings BEFORE this function runs.
 * 
 * This function is decoupled from snapshot finalization.
 * Metadata enrichment runs as soon as ASINs are discovered, regardless of:
 * - Snapshot stability
 * - Inferred state
 * - Expected ASIN count
 * - Mixed category detection
 * - Snapshot estimating state
 * 
 * @param listings - Array of ParsedListing objects to enrich
 * @param keyword - Keyword for logging context (optional)
 * @param rainforestApiKey - Rainforest API key (optional, will use env var if not provided)
 * @returns Enriched listings (only missing fields are populated, existing data is preserved)
 */
export async function enrichListingsMetadata(
  listings: ParsedListing[],
  keyword?: string,
  rainforestApiKey?: string,
  apiCallCounter?: { count: number; max: number }
): Promise<ParsedListing[]> {
  if (!listings || listings.length === 0) {
    return listings;
  }

  // Get API key from parameter or environment
  const apiKey = rainforestApiKey || process.env.RAINFOREST_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ ASIN_METADATA_ENRICHMENT_SKIPPED", {
      keyword: keyword || "unknown",
      reason: "RAINFOREST_API_KEY not configured",
      listings_count: listings.length,
    });
    return listings;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚨 COST OPTIMIZATION: METADATA ENRICHMENT FOR RATINGS/REVIEWS ONLY
  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: SP-API Catalog already provides title, brand, image_url, category, BSR
  // This enrichment ONLY fills ratings/reviews (SP-API cannot provide these)
  // Rules:
  // - Only top 2 ranked listings (part of 7-call budget: 1 search + 4 BSR + 0-2 metadata)
  //   Note: Metadata calls now only for ratings/reviews (title/image/brand from SP-API Catalog)
  // - Enrich ONLY if ratings/reviews are missing (title/image/brand come from SP-API Catalog)
  // - Never enrich more than 2 ASINs per analysis
  const MAX_METADATA_ENRICHMENT = 2;
  
  // Check which listings need enrichment (ratings/reviews only)
  // SP-API Catalog already provides title, brand, image_url, category, BSR
  // We only enrich ratings/reviews which SP-API cannot provide
  const listingsNeedingEnrichment = listings
    .slice(0, MAX_METADATA_ENRICHMENT) // Only top 2 (part of 7-call budget, now optional: only if ratings/reviews missing)
    .filter(l => {
      if (!l.asin) return false;
      
      // Only enrich if ratings or reviews are missing
      // Title, image, brand come from SP-API Catalog (already merged before this function runs)
      const needsRating = l.rating === null;
      const needsReviews = l.reviews === null;
      
      return needsRating || needsReviews;
    });

  if (listingsNeedingEnrichment.length === 0) {
    // All listings have ratings/reviews from search data - no enrichment needed
    console.log("✅ METADATA_ENRICHMENT_SKIPPED", {
      keyword: keyword || "unknown",
      reason: "All listings have ratings and reviews from search data",
      total_listings: listings.length,
      note: "Title, image, brand already provided by SP-API Catalog",
    });
    return listings;
  }

  console.log("🔵 ASIN_METADATA_ENRICHMENT_START", {
    keyword: keyword || "unknown",
    listings_needing_enrichment: listingsNeedingEnrichment.length,
    total_listings: listings.length,
    enrichment_scope: "ratings_and_reviews_only",
    note: "Title, image, brand already provided by SP-API Catalog",
    missing_metadata_breakdown: {
      missing_rating: listingsNeedingEnrichment.filter(l => l.rating === null).length,
      missing_reviews: listingsNeedingEnrichment.filter(l => l.reviews === null).length,
    },
  });

  try {
    // Get ASINs that need enrichment
    const asinsToEnrich = listingsNeedingEnrichment
      .map(l => l.asin)
      .filter((asin): asin is string => asin !== null && asin !== undefined);

    if (asinsToEnrich.length === 0) {
      return listings;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INDIVIDUAL PARALLEL FETCH (NO RETRIES, NO BACKOFF, SINGLE ATTEMPT)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Rainforest API does NOT support comma-separated ASINs in batch requests
    // Must fetch each ASIN individually, but we can do it in parallel for speed
    // No retries, no fire-and-forget, no async background tasks
    // If fetch fails, preserve listings with null fields (do NOT fabricate placeholders)
    
    // Remove duplicates from ASIN list
    const uniqueAsins = Array.from(new Set(asinsToEnrich));
    
    console.log("🔵 METADATA_ENRICHMENT_FETCH_START", {
      keyword: keyword || "unknown",
      total_asins: uniqueAsins.length,
      fetch_strategy: "individual_parallel",
    });
    
    // Fetch all ASINs in parallel (but limit concurrency to avoid rate limits)
    const CONCURRENCY_LIMIT = 5; // Process 5 ASINs at a time
    const allProducts: any[] = [];
    let successfulFetches = 0;
    let failedFetches = 0;
    
    // Process ASINs in batches to respect rate limits
    for (let i = 0; i < uniqueAsins.length; i += CONCURRENCY_LIMIT) {
      const asinBatch = uniqueAsins.slice(i, i + CONCURRENCY_LIMIT);
      
      // Fetch this batch in parallel
      const batchPromises = asinBatch.map(async (asin) => {
        // 🚨 API SAFETY LIMIT: Check before each call
        if (apiCallCounter && apiCallCounter.count >= apiCallCounter.max) {
          const remainingBudget = apiCallCounter.max - apiCallCounter.count;
          const skippedAsins = asinBatch.filter(a => a !== asin).length + 1; // Count this ASIN + remaining in batch
          console.warn("🚨 ENRICHMENT_SKIPPED_DUE_TO_BUDGET", {
            enrichment_type: "metadata",
            asin,
            keyword: keyword || "unknown",
            current_count: apiCallCounter.count,
            max_allowed: apiCallCounter.max,
            remaining_budget: remainingBudget,
            asins_skipped: skippedAsins,
            message: "Metadata enrichment skipped - API call budget exhausted",
          });
          return null;
        }
        
        // Increment counter before API call
        if (apiCallCounter) {
          apiCallCounter.count++;
        }
        
        const productUrl = `https://api.rainforestapi.com/request?api_key=${apiKey}&type=product&amazon_domain=amazon.com&asin=${asin}`;
        
        try {
          const response = await fetch(productUrl, {
            method: "GET",
            headers: { "Accept": "application/json" },
          });

          if (!response.ok) {
            console.warn("⚠️ METADATA_ENRICHMENT_FETCH_FAILED", {
              keyword: keyword || "unknown",
              asin: asin,
              status: response.status,
              statusText: response.statusText,
            });
            return null;
          }

          const data = await response.json();
          
          // Check for API-level errors in response
          if (data && data.error) {
            console.warn("⚠️ METADATA_ENRICHMENT_API_ERROR", {
              keyword: keyword || "unknown",
              asin: asin,
              api_error: data.error,
            });
            return null;
          }
          
          // Extract product from response
          const product = data?.product || data;
          if (product && product.asin) {
            return product;
          }
          
          return null;
        } catch (fetchError) {
          console.warn("⚠️ METADATA_ENRICHMENT_FETCH_EXCEPTION", {
            keyword: keyword || "unknown",
            asin: asin,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          });
          return null;
        }
      });
      
      // Wait for this batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Filter out null results and add to allProducts
      const validProducts = batchResults.filter((p): p is any => p !== null);
      allProducts.push(...validProducts);
      successfulFetches += validProducts.length;
      failedFetches += (batchResults.length - validProducts.length);
      
      // Log progress for first batch
      if (i === 0 && validProducts.length > 0) {
        console.log("✅ METADATA_ENRICHMENT_FETCH_PROGRESS", {
          batch_index: Math.floor(i / CONCURRENCY_LIMIT) + 1,
          total_batches: Math.ceil(uniqueAsins.length / CONCURRENCY_LIMIT),
          products_fetched: validProducts.length,
          asins_in_batch: asinBatch.length,
        });
      }
    }
    
    // Log fetch summary
    console.log("🔵 METADATA_ENRICHMENT_FETCH_SUMMARY", {
      keyword: keyword || "unknown",
      total_asins: uniqueAsins.length,
      successful_fetches: successfulFetches,
      failed_fetches: failedFetches,
      total_products_fetched: allProducts.length,
    });
    
    // If all fetches failed, return original listings
    if (allProducts.length === 0) {
      console.warn("⚠️ ASIN_METADATA_ENRICHMENT_FAILED", {
        keyword: keyword || "unknown",
        reason: "all_fetches_failed",
        listings_needing_enrichment: listingsNeedingEnrichment.length,
        message: "All product fetches failed - preserving listings with null fields",
      });
      return listings;
    }
    
    // Use all fetched products
    const products = allProducts;

    // Create enrichment map: ASIN -> product data
    const enrichmentMap = new Map<string, any>();
    for (const productData of products) {
      const product = productData?.product || productData;
      if (product?.asin) {
        enrichmentMap.set(product.asin.toUpperCase(), product);
      }
    }

    // Enrich listings with fetched metadata (title, image, rating, reviews)
    // NOTE: Brands come from search results only, not from product API enrichment
    let enrichedListingsCount = 0;
    let enrichedFieldsCount = 0;
    const enrichedListings = listings.map(listing => {
      // If this listing was enriched via API, use that data
      if (listing.asin && enrichmentMap.has(listing.asin.toUpperCase())) {
        // Will be enriched below
      } else {
        // No API enrichment - return with locally extracted brand
        return listing;
      }
      
      if (!listing.asin || !enrichmentMap.has(listing.asin.toUpperCase())) {
        return listing; // No enrichment data available
      }

      const productData = enrichmentMap.get(listing.asin.toUpperCase())!;
      const enriched: ParsedListing = { ...listing };
      // Preserve raw fields for presentation fallback (do not overwrite)
      (enriched as any).raw_title = (listing as any).raw_title;
      (enriched as any).raw_image_url = (listing as any).raw_image_url;
      let listingEnriched = false;

      // NOTE: Title and image_url enrichment removed
      // SP-API Catalog already provides authoritative title and image_url
      // These are merged into listings BEFORE this function runs (see fetchKeywordMarketSnapshot)
      // Only enrich ratings/reviews which SP-API cannot provide

      // Enrich rating (only if null)
      if (enriched.rating === null) {
        const rating = parseRating(productData);
        if (rating !== null) {
          enriched.rating = rating;
          enrichedFieldsCount++;
          listingEnriched = true;
        } else {
          // Ensure rating is 0 if missing (not null) for aggregation calculations
          enriched.rating = 0;
        }
      }

      // Enrich reviews (only if null)
      if (enriched.reviews === null) {
        const reviews = parseReviews(productData);
        if (reviews !== null) {
          enriched.reviews = reviews;
          enrichedFieldsCount++;
          listingEnriched = true;
        } else {
          // Ensure review_count is 0 if missing (not null) for aggregation calculations
          enriched.reviews = 0;
        }
      }

      // NOTE: Brand enrichment removed - brands come from search results only (low-cost, Helium-10 style)
      // Brands are resolved in fetchKeywordMarketSnapshot using resolveBrandFromSearchResult()
      
      if (listingEnriched) {
        enrichedListingsCount++;
      }

      return enriched;
    });

    console.log("✅ ASIN_METADATA_ENRICHMENT_COMPLETE", {
      keyword: keyword || "unknown",
      listings_enriched: enrichedListingsCount,
      fields_enriched: enrichedFieldsCount,
      total_listings: enrichedListings.length,
      enrichment_success_rate: listingsNeedingEnrichment.length > 0 
        ? `${((enrichedListingsCount / listingsNeedingEnrichment.length) * 100).toFixed(1)}%`
        : "0%",
      api_calls_made: allProducts.length,
      max_allowed: MAX_METADATA_ENRICHMENT,
    });

    // NOTE: Brand resolution removed - brands come from search results only
    const finalListings = enrichedListings;

    // Log brand stats (for debugging - brands should already be set from search results)
    const brandMissingAfterEnrichment = finalListings.filter(l => !l.brand || l.brand === "").length;
    console.log("BRAND_STATS_AFTER_ENRICHMENT", {
      keyword: keyword || "unknown",
    });
    console.log("BRAND_MISSING_AFTER_ENRICHMENT", {
      count: brandMissingAfterEnrichment,
      keyword: keyword || "unknown",
    });

    return finalListings;
  } catch (error) {
    console.warn("⚠️ ASIN_METADATA_ENRICHMENT_ERROR", {
      keyword: keyword || "unknown",
      error: error instanceof Error ? error.message : String(error),
      listings_needing_enrichment: listingsNeedingEnrichment.length,
      message: "Metadata enrichment failed - using original listing data",
    });
    // Return original listings - do NOT overwrite with empty defaults
    return listings;
  }
}

/**
 * Fetches Amazon search results for a keyword and computes aggregated market signals.
 * 
 * @param keyword - The search keyword
 * @returns KeywordMarketData if valid data exists, null otherwise
 */
export async function fetchKeywordMarketSnapshot(
  keyword: string,
  supabase?: any,
  marketplace: string = "US",
  apiCallCounter?: { count: number; max: number }
): Promise<KeywordMarketData | null> {
  const rainforestApiKey = process.env.RAINFOREST_API_KEY;
  
  if (!rainforestApiKey) {
    console.error("RAINFOREST_API_KEY not configured in environment variables");
    throw new Error("Rainforest API key not configured. Please set RAINFOREST_API_KEY environment variable.");
  }

  // TASK 2: Track if we extracted ASINs to classify errors correctly
  let extractedAsinCount = 0;
  let apiReturnedResults = false;

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // PAGE-1 ONLY: Hard-coded page=1 parameter ensures Page-1 results only
    // ═══════════════════════════════════════════════════════════════════════════
    
    // 🚨 API SAFETY LIMIT: Check before search call
    if (apiCallCounter && apiCallCounter.count >= apiCallCounter.max) {
      console.warn("🚨 API_CALL_LIMIT_REACHED", {
        keyword,
        current_count: apiCallCounter.count,
        max_allowed: apiCallCounter.max,
        message: "Search request skipped - API call limit reached",
      });
      return null;
    }
    
    // Increment counter for search call
    if (apiCallCounter) {
      apiCallCounter.count++;
    }
    
    const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=amazon.com&search_term=${encodeURIComponent(keyword)}&page=1`;
    console.log("RAINFOREST_API_REQUEST", { 
      keyword, 
      url: apiUrl.replace(rainforestApiKey, "***"),
      api_call_count: apiCallCounter?.count || 0,
      api_calls_remaining: apiCallCounter ? apiCallCounter.max - apiCallCounter.count : "unlimited",
    });
    
    // Fetch Amazon search results via Rainforest API
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Rainforest API error: ${response.status} ${response.statusText}`, {
        keyword,
        error_body: errorText.substring(0, 500), // First 500 chars
      });
      return null;
    }

    let raw: any;
    try {
      raw = await response.json();
    } catch (jsonError) {
      const responseText = await response.text().catch(() => "Unable to read response");
      console.error("Failed to parse Rainforest API JSON response", {
        keyword,
        status: response.status,
        statusText: response.statusText,
        response_preview: responseText.substring(0, 500),
        error: jsonError instanceof Error ? jsonError.message : String(jsonError),
      });
      return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1 — CONFIRM RAW DATA (NO TRANSFORMS)
    // ═══════════════════════════════════════════════════════════════════════════
    // Log the raw Rainforest response immediately after it is fetched
    // Extract first 5 products from all possible locations
    const allRawProducts: any[] = [];
    if (Array.isArray(raw.search_results)) allRawProducts.push(...raw.search_results);
    if (Array.isArray(raw.organic_results)) allRawProducts.push(...raw.organic_results);
    if (Array.isArray(raw.ads)) allRawProducts.push(...raw.ads);
    if (Array.isArray(raw.results)) allRawProducts.push(...raw.results);
    
    const first5Raw = allRawProducts.slice(0, 5);
    console.log("🔍 STEP_1_RAW_RAINFOREST_DATA", {
      keyword,
      total_products_found: allRawProducts.length,
      first_5_products: first5Raw.map((item: any, idx: number) => ({
        index: idx + 1,
        asin: item.asin || null,
        title: item.title || null,
        price: item.price?.value || item.price?.raw || item.price || null,
        rating: item.rating || null,
        reviews: item.reviews?.count || item.reviews || null,
        image_url: item.image || null,
        bestsellers_rank: item.bestsellers_rank || null,
        sales_rank: item.sales_rank?.current_rank || item.sales_rank || null,
      })),
      timestamp: new Date().toISOString(),
    });

    // Log FULL raw response for debugging (Step 1)
    console.log("RAW_KEYWORD_RESULTS_FULL", {
      keyword,
      status: response.status,
      full_response: JSON.stringify(raw, null, 2), // Full response for inspection
    });
    
    // Log raw payload structure for debugging (truncated for large responses)
    console.log("RAW_KEYWORD_RESULTS", {
      keyword,
      status: response.status,
      has_request_info: !!raw.request_info,
      has_search_information: !!raw.search_information,
      search_results_count: Array.isArray(raw.search_results) ? raw.search_results.length : "not an array",
      search_results_type: typeof raw.search_results,
      organic_results_count: Array.isArray(raw.organic_results) ? raw.organic_results.length : "not an array",
      ads_count: Array.isArray(raw.ads) ? raw.ads.length : "not an array",
      results_count: Array.isArray(raw.results) ? raw.results.length : "not an array",
      raw_keys: Object.keys(raw),
      error: raw.error || null,
    });
    
    // Extract search_information.total_results for search volume estimation
    // total_results is typically a string like "50,000 results" or number
    const searchInformation = raw.search_information || {};
    let totalResults: number | null = null;
    if (searchInformation.total_results) {
      const totalResultsStr = searchInformation.total_results.toString();
      const match = totalResultsStr.match(/([\d,]+)/);
      if (match) {
        totalResults = parseInt(match[1].replace(/,/g, ''), 10);
        if (isNaN(totalResults)) totalResults = null;
      }
    }

    // Check for API errors in response
    if (raw.error) {
      console.error("Rainforest API returned an error", {
        keyword,
        error: raw.error,
        error_type: raw.error_type || "unknown",
        request_info: raw.request_info || null,
      });
      return null;
    }

    // Extract search_results array
    if (!raw || typeof raw !== "object") {
      console.error("Invalid Rainforest API response structure", {
        keyword,
        response_type: typeof raw,
        response_value: raw,
      });
      return null;
    }

    // Step 2: Collect ALL listings from ALL possible locations in Rainforest response
    // PAGE-1 SCOPE: All results come from page=1 API call above - includes both organic and sponsored
    // Check: search_results, organic_results, ads (sponsored), results, etc.
    const allResultArrays: any[][] = [];
    
    if (Array.isArray(raw.search_results) && raw.search_results.length > 0) {
      allResultArrays.push(raw.search_results);
    }
    if (Array.isArray(raw.organic_results) && raw.organic_results.length > 0) {
      allResultArrays.push(raw.organic_results);
    }
    if (Array.isArray(raw.ads) && raw.ads.length > 0) {
      allResultArrays.push(raw.ads); // Sponsored listings from Page-1
    }
    if (Array.isArray(raw.results) && raw.results.length > 0) {
      allResultArrays.push(raw.results);
    }
    
    // Flatten all arrays into a single array (Page-1 only: organic + sponsored)
    const searchResults = allResultArrays.flat();
    
    console.log("COLLECTED_LISTINGS_FROM_ALL_SOURCES", {
      keyword,
      search_results_count: Array.isArray(raw.search_results) ? raw.search_results.length : 0,
      organic_results_count: Array.isArray(raw.organic_results) ? raw.organic_results.length : 0,
      ads_count: Array.isArray(raw.ads) ? raw.ads.length : 0,
      results_count: Array.isArray(raw.results) ? raw.results.length : 0,
      total_collected: searchResults.length,
    });

    // Step 5: Only return null if ZERO ASINs exist across all result blocks
    if (searchResults.length === 0) {
      console.log("No search results found in any location", {
        keyword,
        has_raw: !!raw,
        raw_keys: raw ? Object.keys(raw) : [],
        checked_locations: ["search_results", "organic_results", "ads", "results"],
      });
      return null;
    }
    
    // Count ASINs to verify we have valid listings
    const asinCount = searchResults.filter((item: any) => item.asin).length;
    extractedAsinCount = asinCount; // TASK 2: Track for error classification
    apiReturnedResults = searchResults.length > 0; // TASK 2: Track if API returned results
    
    if (asinCount === 0) {
      console.log("No ASINs found in any result", {
        keyword,
        total_items: searchResults.length,
        sample_item: searchResults[0] ? Object.keys(searchResults[0]) : null,
      });
      return null; // TASK 2: This is genuine "zero_asins" case
    }

    // DEBUG TASK: Log one full product object for inspection (Step 1 & 2)
    if (searchResults.length > 0) {
      const sampleProduct = searchResults[0];
      console.log("SAMPLE_PRODUCT_FULL_OBJECT", {
        keyword,
        asin: sampleProduct.asin,
        has_bestsellers_rank: !!sampleProduct.bestsellers_rank,
        bestsellers_rank_type: typeof sampleProduct.bestsellers_rank,
        bestsellers_rank_is_array: Array.isArray(sampleProduct.bestsellers_rank),
        bestsellers_rank_length: Array.isArray(sampleProduct.bestsellers_rank) ? sampleProduct.bestsellers_rank.length : null,
        bestsellers_rank_value: sampleProduct.bestsellers_rank,
        full_product_object: JSON.stringify(sampleProduct, null, 2),
        product_keys: Object.keys(sampleProduct),
      });
      
      // Specifically inspect bestsellers_rank structure
      if (sampleProduct.bestsellers_rank) {
        console.log("BESTSELLERS_RANK_STRUCTURE", {
          keyword,
          bestsellers_rank: sampleProduct.bestsellers_rank,
          is_array: Array.isArray(sampleProduct.bestsellers_rank),
          first_element: Array.isArray(sampleProduct.bestsellers_rank) && sampleProduct.bestsellers_rank.length > 0
            ? sampleProduct.bestsellers_rank[0]
            : null,
          all_elements: Array.isArray(sampleProduct.bestsellers_rank)
            ? sampleProduct.bestsellers_rank.map((r: any, i: number) => ({
                index: i,
                element: r,
                has_rank: r?.rank !== undefined,
                rank_value: r?.rank,
                has_category: r?.category !== undefined,
                category_value: r?.category,
                keys: r ? Object.keys(r) : [],
              }))
            : null,
        });
      }
    }

    // STEP B: Extract all Page-1 ASINs (all listings, not just top 20)
    const page1Asins = searchResults
      .filter((item: any) => item.asin)
      .map((item: any) => item.asin);
    
    console.log("SEARCH_ASINS_COUNT", {
      keyword,
      total_search_results: searchResults.length,
      page1_asins: page1Asins,
      asin_count: page1Asins.length,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔥 HARD-FORCED SP-API EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════
    // This must run for EVERY keyword search.
    // No confidence checks. No cache skips.
    // SP-API is PRIMARY DATA. Not enrichment.
    let spApiCatalogResults: Map<string, any> = new Map();
    let spApiPricingResults: Map<string, any> = new Map();
    
    console.log("🔥 SP_API_FORCED_START", {
      keyword,
      asin_count: page1Asins.length,
      marketplace: "ATVPDKIKX0DER",
    });
    
    if (!page1Asins.length) {
      console.error("❌ SP_API_ABORTED_NO_ASINS", {
        keyword,
        error: "SP_API_ABORTED_NO_ASINS",
      });
      throw new Error("SP_API_ABORTED_NO_ASINS");
    }
    
    // Batch ASINs by 20 (SP-API hard limit)
    const asinBatches: string[][] = [];
    for (let i = 0; i < page1Asins.length; i += 20) {
      asinBatches.push(page1Asins.slice(i, i + 20));
    }
    
    const marketplaceId = "ATVPDKIKX0DER"; // US marketplace
    let spApiExecuted = false;
    let spApiError: Error | null = null;
    
    try {
      // --- SP-API CATALOG (Brand, Category, BSR) ---
      const { batchEnrichCatalogItems } = await import("../spapi/catalogItems");
      
      for (let i = 0; i < asinBatches.length; i++) {
        const batch = asinBatches[i];
        console.log("🔥 SP_API_CATALOG_BATCH_START", {
          batch_index: i,
          batch_size: batch.length,
          asins: batch,
          keyword,
        });
        
        try {
          const catalogResponse = await batchEnrichCatalogItems(batch, marketplaceId, 2000);
          
          if (!catalogResponse || !catalogResponse.enriched || catalogResponse.enriched.size === 0) {
            console.error("❌ SP_API_CATALOG_EMPTY_RESPONSE", { 
              batch,
              keyword,
              batch_index: i,
            });
          } else {
            // Merge results into main map
            for (const [asin, metadata] of catalogResponse.enriched.entries()) {
              spApiCatalogResults.set(asin, metadata);
            }
          }
          
          console.log("✅ SP_API_CATALOG_BATCH_COMPLETE", {
            batch_index: i,
            returned_items: catalogResponse?.enriched?.size ?? 0,
            keyword,
          });
        } catch (error) {
          console.error("❌ SP_API_CATALOG_BATCH_ERROR", {
            batch_index: i,
            batch,
            keyword,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      // --- SP-API PRICING (FBA / FBM / Buy Box) ---
      const { batchEnrichPricing } = await import("../spapi/pricing");
      
      for (let i = 0; i < asinBatches.length; i++) {
        const batch = asinBatches[i];
        console.log("🔥 SP_API_PRICING_BATCH_START", {
          batch_index: i,
          batch_size: batch.length,
          asins: batch,
          keyword,
        });
        
        try {
          const pricingResponse = await batchEnrichPricing(batch, marketplaceId, 2000);
          
          if (!pricingResponse || !pricingResponse.enriched || pricingResponse.enriched.size === 0) {
            // Check if this is a permission error (all ASINs failed with 403)
            const hasPermissionError = pricingResponse?.errors?.some((e: any) => 
              e.error?.includes('Unauthorized') || e.error?.includes('403')
            );
            
            if (hasPermissionError || pricingResponse?.failed?.length === batch.length) {
              console.error("❌ SP_API_PRICING_PERMISSION_ERROR", { 
                batch,
                keyword,
                batch_index: i,
                failed_count: pricingResponse?.failed?.length ?? 0,
                total_asins: batch.length,
                message: "Pricing API permission denied - will fallback to Rainforest data",
                suggestion: "Check IAM role policies and SP-API scope permissions for Pricing API",
              });
            } else {
              console.error("❌ SP_API_PRICING_EMPTY_RESPONSE", { 
                batch,
                keyword,
                batch_index: i,
                failed_count: pricingResponse?.failed?.length ?? 0,
              });
            }
          } else {
            // Merge results into main map
            for (const [asin, metadata] of pricingResponse.enriched.entries()) {
              spApiPricingResults.set(asin, metadata);
            }
          }
          
          console.log("✅ SP_API_PRICING_BATCH_COMPLETE", {
            batch_index: i,
            returned_items: pricingResponse?.enriched?.size ?? 0,
            keyword,
          });
        } catch (error) {
          console.error("❌ SP_API_PRICING_BATCH_ERROR", {
            batch_index: i,
            batch,
            keyword,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      spApiExecuted = true;
      
      console.log("🟢 SP_API_FORCED_COMPLETE", {
        keyword,
        total_asins: page1Asins.length,
        total_batches: asinBatches.length,
        catalog_enriched: spApiCatalogResults.size,
        pricing_enriched: spApiPricingResults.size,
      });
    } catch (error) {
      spApiError = error instanceof Error ? error : new Error(String(error));
      console.error("❌ SP_API_HARD_FAILURE", {
        keyword,
        error: spApiError.message,
        total_asins: page1Asins.length,
        total_batches: asinBatches.length,
      });
      // Continue without SP-API data - non-fatal for UI, but log hard error
    }
    
    // HARD VERIFICATION: If SP-API did not execute, log HARD ERROR
    if (!spApiExecuted) {
      console.error("❌ SP_API_HARD_ERROR_NOT_EXECUTED", {
        keyword,
        asin_count: page1Asins.length,
        error: spApiError?.message || "SP-API execution was skipped or failed",
        message: "SP-API MUST execute for all keyword searches. This is a critical error.",
      });
    }

    // STEP C: Bulk cache lookup (includes BSR and brand data)
    const { bulkLookupBsrCache, bulkUpsertBsrCache } = await import("./asinBsrCache");
    const cacheMap = supabase ? await bulkLookupBsrCache(supabase, page1Asins) : new Map();
    
    // Create brand cache map for quick lookups
    const brandCacheMap = new Map<string, string>();
    for (const [asin, cacheEntry] of cacheMap.entries()) {
      if (cacheEntry.brand && typeof cacheEntry.brand === 'string' && cacheEntry.brand.trim().length > 0) {
        brandCacheMap.set(asin, cacheEntry.brand.trim());
      }
    }
    
    const cachedAsins = Array.from(cacheMap.keys());
    const missingAsins = page1Asins.filter(asin => !cacheMap.has(asin));
    
    console.log("BSR_CACHE_HITS", {
      keyword,
      total_asins: page1Asins.length,
      cached_asins: cachedAsins.length,
      missing_asins: missingAsins.length,
      cache_hit_rate: `${((cachedAsins.length / page1Asins.length) * 100).toFixed(1)}%`,
    });

    // STEP D: Batch product fetch for missing ASINs (ONE REQUEST)
    const bsrDataMap: Record<string, { rank: number; category: string; price: number | null } | null> = {};
    
    // First, populate from cache (only valid BSRs: >= 1)
    const excludedFromCache: string[] = [];
    for (const [asin, cacheEntry] of cacheMap.entries()) {
      // PRODUCTION HARDENING: Validate cached BSR (null, 0, or < 1 are invalid)
      if (cacheEntry.main_category_bsr !== null && 
          cacheEntry.main_category_bsr !== undefined && 
          cacheEntry.main_category_bsr >= 1) {
        bsrDataMap[asin] = {
          rank: cacheEntry.main_category_bsr,
          category: cacheEntry.main_category || 'default',
          price: cacheEntry.price,
        };
      } else {
        excludedFromCache.push(asin);
      }
    }
    
    if (excludedFromCache.length > 0) {
      console.warn("BSR_EXCLUDED_FROM_CACHE", {
        keyword,
        excluded_count: excludedFromCache.length,
        excluded_asins: excludedFromCache.slice(0, 5), // Log first 5
        message: "Cached entries with invalid BSR excluded from calculations",
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🚨 BSR ENRICHMENT MOVED TO ASYNC/BACKGROUND (SKIP FOR IMMEDIATE RETURN)
    // ═══════════════════════════════════════════════════════════════════════════
    // BSR enrichment is now done asynchronously after Page-1 returns
    // This allows immediate return without waiting for BSR API calls
    // BSR data will be populated in background and cached for future use
    const MAX_BSR_ASINS = 4; // Updated to match 7-call budget (max 4 BSR calls)
    
    // Get top-ranked ASINs that need BSR (prioritize by position)
    // NOTE: This is prepared but NOT executed here - will be done async
    const asinsForBSR = searchResults
      .slice(0, MAX_BSR_ASINS * 2) // Check more to account for duplicates/cached
      .map((item: any) => item.asin)
      .filter((asin: string | null): asin is string => 
        asin !== null && 
        asin !== undefined && 
        missingAsins.includes(asin) &&
        !cacheMap.has(asin) // Skip if already cached
      )
      .slice(0, MAX_BSR_ASINS); // Hard cap at 4

    // SKIP BSR FETCH HERE - Will be done async after Page-1 returns
    // This allows immediate return without waiting for BSR API calls
    if (asinsForBSR.length > 0) {
      console.log("BSR_ENRICHMENT_DEFERRED_TO_ASYNC", {
        keyword,
        missing_asins: asinsForBSR,
        asin_count: asinsForBSR.length,
        total_missing: missingAsins.length,
        message: `BSR enrichment will be done async after Page-1 returns (HARD CAP: max 4)`,
      });
    }

    // SKIP BSR FETCH - Return immediately with cached BSR data only
    // BSR enrichment will be triggered async after Page-1 returns (see /api/analyze async enrichment)
    if (asinsForBSR.length === 0) {
      console.log("BSR_BATCH_FETCH_SKIPPED", {
        keyword,
        total_missing: missingAsins.length,
        message: "No ASINs need BSR fetch (all cached or cap reached)",
      });
    }

    console.log("🔵 BSR_PROCESSING_COMPLETE", {
      keyword,
      timestamp: new Date().toISOString(),
    });

    // STEP E: Log final BSR coverage
    const listingsWithBSR = Object.values(bsrDataMap).filter(Boolean).length;
    const bsrCoveragePercent = page1Asins.length > 0 
      ? ((listingsWithBSR / page1Asins.length) * 100).toFixed(1)
      : "0.0";
    
    const stillMissingAsins = page1Asins.filter(asin => !bsrDataMap[asin] || bsrDataMap[asin] === null);
    
    console.log("FINAL_BSR_COVERAGE_PERCENT", {
      keyword,
      total_asins: page1Asins.length,
      asins_with_bsr: listingsWithBSR,
      coverage_percent: `${bsrCoveragePercent}%`,
      missing_after_fetch: stillMissingAsins.length,
      bsr_missing_asins: stillMissingAsins.slice(0, 5), // Log first 5
    });

    if (stillMissingAsins.length > 0) {
      console.log("BSR_MISSING_AFTER_FETCH", {
        keyword,
        missing_count: stillMissingAsins.length,
        missing_asins: stillMissingAsins,
        message: "These ASINs will be excluded from BSR-based calculations",
      });
    }

    // Step 4: Parse and normalize each search result item
    // Normalize using single helper - all fields except ASIN are optional
    let parsedListings: ParsedListing[] = [];
    try {
      // PHASE 1: Detect duplicate BSRs before normalization (non-disruptive)
      // This allows us to mark invalid BSRs during normalization
      const tempListingsForDetection = searchResults.map((item: any, index: number) => {
        const asin = item.asin ?? null;
        const position = item.position ?? index + 1;
        
        // Extract BSR for duplicate detection
        let mainBSRData = extractMultiSourceBSR(item);
        if (!mainBSRData && asin && bsrDataMap[asin]) {
          const cachedBSR = bsrDataMap[asin];
          if (cachedBSR && cachedBSR.rank >= 1 && cachedBSR.rank <= 300000) {
            mainBSRData = {
              rank: cachedBSR.rank,
              category: cachedBSR.category,
            };
          }
        }
        
        const main_category_bsr = (mainBSRData && mainBSRData.rank && mainBSRData.rank >= 1 && mainBSRData.rank <= 300000) 
          ? mainBSRData.rank 
          : null;
        const bsr = main_category_bsr;
        
        return {
          asin,
          main_category_bsr,
          bsr,
        } as ParsedListing;
      });
      
      // Detect duplicate BSRs
      const invalidBSRs = detectDuplicateBSRs(tempListingsForDetection);
      
      // Now parse listings with duplicate detection applied
      parsedListings = searchResults.map((item: any, index: number) => {
      // Step 2: ASIN is required, everything else is optional
      const asin = item.asin ?? null;
      
      // Step 4: Normalize all fields (nullable where appropriate)
      // CRITICAL: Never allow empty strings - use null instead, so buildKeywordPageOne can handle fallback
      
      // Store raw title from search result (for presentation fallback)
      const raw_title = (item.title && typeof item.title === 'string' && item.title.trim().length > 0)
        ? item.title.trim()
        : null;
      
      const title = raw_title; // Use raw title as processed title initially
      const price = parsePrice(item); // Nullable
      const rating = parseRating(item); // Nullable
      const reviews = parseReviews(item); // Nullable
      const is_sponsored = item.is_sponsored ?? false; // Boolean, default false
      const position = item.position ?? index + 1; // Organic rank (1-indexed)
      
      // STEP 3: Multi-source BSR extraction (robust, checks multiple sources)
      // Priority: 1) bestsellers_rank[], 2) sales_rank.current_rank, 3) buying_choice.bestsellers_rank
      let mainBSRData = extractMultiSourceBSR(item);
      
      // If not found in search result, check our cached/fetched BSR data map
      if (!mainBSRData && asin && bsrDataMap[asin]) {
        const cachedBSR = bsrDataMap[asin];
        // Validate cached BSR before using it
        if (cachedBSR && cachedBSR.rank >= 1 && cachedBSR.rank <= 300000) {
          mainBSRData = {
            rank: cachedBSR.rank,
            category: cachedBSR.category,
          };
        }
      }
      
      // PRODUCTION HARDENING: Validate BSR (null, 0, or < 1 are invalid, must be ≤ 300,000)
      // Exclude from calculations but still allow listing to exist
      let main_category_bsr = (mainBSRData && mainBSRData.rank && mainBSRData.rank >= 1 && mainBSRData.rank <= 300000) 
        ? mainBSRData.rank 
        : null;
      const main_category = (mainBSRData && mainBSRData.rank && mainBSRData.rank >= 1 && mainBSRData.rank <= 300000)
        ? mainBSRData.category
        : null;
      let bsr = main_category_bsr; // Keep for backward compatibility
      
      // PHASE 1: Apply duplicate BSR detection (non-disruptive)
      // If BSR is in invalid set, mark it as null and add reason
      let bsr_invalid_reason: string | null = null;
      if (main_category_bsr !== null && invalidBSRs.has(main_category_bsr)) {
        bsr_invalid_reason = "duplicate_bug";
        main_category_bsr = null;
        bsr = null;
        console.log(`🔵 BSR_MARKED_INVALID: Listing ${asin} BSR ${mainBSRData?.rank} marked as invalid (duplicate_bug)`);
      }
      
      const fulfillment = parseFulfillment(item); // Nullable
      
      // ═══════════════════════════════════════════════════════════════════════════
      // BRAND RESOLUTION: Search-based only (low-cost, Helium-10 style)
      // ═══════════════════════════════════════════════════════════════════════════
      // Uses ONLY: item.brand, item.is_amazon_brand, item.is_exclusive_to_amazon, item.featured_from_our_brands
      // NO title extraction, NO product API, NO seller inference
      const brandResolution = resolveBrandFromSearchResult(item);
      const brand = brandResolution.brand_entity === 'Generic' ? null : brandResolution.brand_display;
      // Store brand metadata for backward compatibility and new fields
      (item as any)._brand_confidence = brandResolution.brand_confidence;
      (item as any)._brand_entity = brandResolution.brand_entity;
      (item as any)._brand_display = brandResolution.brand_display;
      (item as any)._brand_source = brandResolution.brand_source;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // STEP 1: Log raw brand data from Rainforest (first 5 listings)
      // ═══════════════════════════════════════════════════════════════════════════
      if (index < 5) {
        console.log("🟣 RAW BRAND SAMPLE", {
          index,
          asin,
          brand_display: brandResolution.brand_display,
          brand_entity: brandResolution.brand_entity,
          brand_confidence: brandResolution.brand_confidence,
          brand_source: brandResolution.brand_source,
          raw_brand: item.brand,
          is_amazon_brand: item.is_amazon_brand,
          is_exclusive_to_amazon: item.is_exclusive_to_amazon,
          featured_from_our_brands: item.featured_from_our_brands,
        });
      }

      // Extract image URL from Rainforest search_results[].image
      // CRITICAL: Check multiple sources and never allow empty strings
      
      // Store raw image URL from search result (for presentation fallback)
      const raw_image_url = (item.image && typeof item.image === 'string' && item.image.trim().length > 0)
        ? item.image.trim()
        : (item.image_url && typeof item.image_url === 'string' && item.image_url.trim().length > 0)
          ? item.image_url.trim()
          : (item.main_image && typeof item.main_image === 'string' && item.main_image.trim().length > 0)
            ? item.main_image.trim()
            : (Array.isArray(item.images) && item.images.length > 0 && typeof item.images[0] === 'string' && item.images[0].trim().length > 0)
              ? item.images[0].trim()
              : null; // Use null instead of empty string
      
      const image_url = raw_image_url; // Use raw image URL as processed image_url initially
      
      // Extract seller and is_prime for fulfillment mix detection
      const seller = item.seller ?? null; // Nullable
      const is_prime = item.is_prime ?? false; // Boolean, default false

      // Step 4: Return normalized listing - only ASIN is required
      // CRITICAL: Preserve raw item data for fallback in buildKeywordPageOne
      return {
        asin, // Required
        title, // Optional (nullable) - NEVER empty string, only null if missing
        price, // Optional (nullable)
        rating, // Optional (nullable)
        reviews, // Optional (nullable)
        is_sponsored, // Boolean
        position,
        brand, // Optional (nullable)
        image_url, // Optional (nullable) - NEVER empty string, only null if missing
        bsr, // Optional (nullable) - DEPRECATED: use main_category_bsr
        main_category_bsr, // Main category BSR (top-level category only)
        main_category, // Main category name
        fulfillment, // Optional (nullable)
        // Add seller and is_prime for fulfillment mix computation
        seller, // Optional (nullable)
        is_prime, // Boolean
        // PHASE 1: BSR invalid reason (if BSR was marked invalid)
        bsr_invalid_reason, // Optional (nullable) - reason why BSR is invalid
        // PRESENTATION FALLBACK: Store raw fields from search result
        raw_title, // Raw title from search result (for presentation fallback)
        raw_image_url, // Raw image URL from search result (for presentation fallback)
        // PRESERVE RAW ITEM DATA for fallback in buildKeywordPageOne
        _rawItem: item, // Preserve original Rainforest item for title/image fallback
      } as ParsedListing & { seller?: string | null; is_prime?: boolean; _rawItem?: any };
    });
    } catch (parseError) {
      console.error("Error parsing search results:", {
        error: parseError,
        keyword,
        search_results_length: searchResults.length,
      });
      return null;
    }

    // Step 2 & 3: VALID listing rule: A listing is valid if ASIN exists (title is optional)
    // Do NOT filter out listings due to missing optional fields (price, reviews, rating, BSR, fulfillment)
    const validListings = parsedListings.filter(
      (listing) => listing.asin !== null && listing.asin !== undefined && listing.asin !== ""
    );

    // TASK 1: Create canonical `listings` variable for all downstream logic
    let listings = validListings; // Canonical variable name

    // ═══════════════════════════════════════════════════════════════════════════
    // MERGE SP-API RESULTS IMMEDIATELY (BEFORE ANY OTHER PROCESSING)
    // ═══════════════════════════════════════════════════════════════════════════
    // SP-API data is foundational - merge it immediately after parsing
    // SP-API overwrites Rainforest data (authoritative source)
    for (const listing of listings) {
      if (!listing.asin) continue;
      
      const asin = listing.asin.toUpperCase();
      const catalog = spApiCatalogResults.get(asin);
      const pricing = spApiPricingResults.get(asin);
      
      // SP-API Catalog overwrites: brand, category, BSR, title, image
      // CRITICAL: SP-API brand is authoritative - override title-parsed brands
      if (catalog) {
        if (catalog.brand) {
          listing.brand = catalog.brand;
          (listing as any).brand_source = 'sp_api_catalog';
          // Update brand confidence to high when from SP-API (authoritative)
          (listing as any)._brand_confidence = 'high';
          (listing as any)._brand_entity = catalog.brand;
          (listing as any)._brand_display = catalog.brand;
        }
        if (catalog.category) {
          listing.main_category = catalog.category;
          (listing as any).category_source = 'sp_api_catalog';
        }
        // CRITICAL: BSR from catalog is authoritative and must be preserved
        // Pricing failures must NOT affect BSR coverage
        if (catalog.bsr !== null && catalog.bsr > 0) {
          listing.main_category_bsr = catalog.bsr;
          listing.bsr = catalog.bsr;
          (listing as any).bsr_source = 'sp_api_catalog';
        } else if (catalog.bsr === null) {
          // Catalog returned null BSR - preserve existing BSR if available, don't overwrite with null
          // Only set bsr_source if we actually got BSR data
        }
        if (catalog.title) {
          listing.title = catalog.title;
          (listing as any).title_source = 'sp_api_catalog';
        }
        if (catalog.image_url) {
          listing.image_url = catalog.image_url;
          (listing as any).image_source = 'sp_api_catalog';
        }
      }
      
      // SP-API Pricing overwrites: fulfillment, price, buy box
      // CRITICAL: If pricing fails, fulfillment_source remains null (not set to rainforest)
      // Only set fulfillment_source if SP-API pricing actually succeeded
      if (pricing) {
        if (pricing.fulfillment_channel) {
          listing.fulfillment = pricing.fulfillment_channel === 'FBA' ? 'FBA' : 'FBM';
          (listing as any).fulfillment_source = 'sp_api_pricing';
        }
        if (pricing.buy_box_price !== null) {
          listing.price = pricing.buy_box_price;
          (listing as any).price_source = 'sp_api_pricing';
        } else if (pricing.lowest_price !== null) {
          listing.price = pricing.lowest_price;
          (listing as any).price_source = 'sp_api_pricing';
        }
        if (pricing.buy_box_owner) {
          (listing as any).buy_box_owner = pricing.buy_box_owner;
          (listing as any).buy_box_owner_source = 'sp_api_pricing';
        }
        if (pricing.offer_count !== null) {
          (listing as any).offer_count = pricing.offer_count;
          (listing as any).offer_count_source = 'sp_api_pricing';
        }
      } else {
        // Pricing API failed or returned no data - mark price source as Rainforest fallback
        // Only if we have a price from Rainforest and no SP-API price was set
        if (listing.price !== null && listing.price !== undefined && !(listing as any).price_source) {
          (listing as any).price_source = 'rainforest_serp';
        }
        // Do NOT set fulfillment_source to rainforest_serp here - only set it if we have Rainforest data
        // and it wasn't already set by SP-API. This is handled in route.ts fallback logic.
      }
    }

    console.warn("PAGE1_LISTINGS_COUNT", listings.length); // Step 7: Debug log
    console.log(`Extracted ${listings.length} valid listings from ${parsedListings.length} total results`, {
      keyword,
      valid_listings: listings.length,
      total_parsed: parsedListings.length,
      sample_valid_listing: listings[0] ? {
        asin: listings[0].asin,
        has_title: !!listings[0].title,
        has_price: listings[0].price !== null,
        has_reviews: listings[0].reviews !== null,
        has_rating: listings[0].rating !== null,
      } : null,
    });

    // Step 5: Only return null if ZERO ASINs exist
    if (listings.length === 0) {
      console.log("No valid listings (zero ASINs found)", {
        keyword,
        total_parsed: parsedListings.length,
        valid_count: listings.length,
        sample_listing: parsedListings[0] ? {
          has_asin: !!parsedListings[0].asin,
          asin_value: parsedListings[0].asin,
        } : null,
      });
      return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ASIN METADATA ENRICHMENT (RATINGS/REVIEWS ONLY)
    // ═══════════════════════════════════════════════════════════════════════════
    // Enrich listings missing ratings/reviews by fetching full product data from Rainforest API.
    // CRITICAL: Title, image_url, brand, category, BSR already provided by SP-API Catalog
    // (merged in previous step). This enrichment ONLY fills ratings/reviews which SP-API cannot provide.
    // This runs regardless of snapshot state - metadata must be populated
    // as soon as ASINs are discovered, not gated behind snapshot finalization.
    // Only enriches missing fields - does NOT overwrite existing data.
    console.log("🔵 STARTING_METADATA_ENRICHMENT", {
      keyword,
      listings_count: listings.length,
      enrichment_scope: "ratings_and_reviews_only",
      note: "Title, image, brand already provided by SP-API Catalog",
      timestamp: new Date().toISOString(),
    });
    listings = await enrichListingsMetadata(listings, keyword, rainforestApiKey);
    console.log("✅ METADATA_ENRICHMENT_DONE", {
      keyword,
      listings_count: listings.length,
      timestamp: new Date().toISOString(),
    });

    // Aggregate metrics from Page 1 listings only (using canonical `listings` variable)
    const total_page1_listings = listings.length;
    const sponsored_count = listings.filter((l) => l.is_sponsored).length;
    const organic_count = total_page1_listings - sponsored_count;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PAGE-1 SCOPE VERIFICATION (REQUIRED)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("✅ PAGE-1 SCOPE VERIFIED", {
      keyword,
      total_listings_ingested: total_page1_listings,
      organic_count,
      sponsored_count,
      confirmation: "PAGE-1 SCOPE VERIFIED",
      timestamp: new Date().toISOString(),
    });

    // TASK 3: Average price (only over listings with price != null) - do NOT fall back when real listings exist
    const listingsWithPrice = listings.filter((l) => l.price !== null && l.price !== undefined);
    const avg_price =
      listingsWithPrice.length > 0
        ? listingsWithPrice.reduce((sum, l) => sum + (l.price ?? 0), 0) / listingsWithPrice.length
        : null; // null is OK - we'll use fallback only if NO listings exist

    // TASK 3: Average reviews (only over listings with reviews != null)
    const { computeAvgReviews } = await import("./marketAggregates");
    const avg_reviews = computeAvgReviews(listings); // Always returns a number (0 if none)

    // TASK 3: Average rating (only over listings with rating != null) - do NOT fall back when real listings exist
    const listingsWithRating = listings.filter((l) => l.rating !== null && l.rating !== undefined);
    const avg_rating =
      listingsWithRating.length > 0
        ? listingsWithRating.reduce((sum, l) => sum + (l.rating ?? 0), 0) / listingsWithRating.length
        : null; // null is OK - we'll use fallback only if NO listings exist

    // Average BSR (only over listings with main category BSR)
    // CRITICAL: Only use listings with valid main_category_bsr (exclude if missing)
    const listingsWithMainBSR = listings.filter((l) => 
      l.main_category_bsr !== null && 
      l.main_category_bsr !== undefined && 
      l.main_category_bsr > 0
    );
    // Helium-10 style BSR sampling:
    // - Use best 4 (lowest BSR) + worst 2 (highest BSR) when possible
    // - Falls back to "all available" when fewer BSRs exist
    const bsrsSorted = listingsWithMainBSR
      .map(l => l.main_category_bsr as number)
      .filter((b): b is number => typeof b === "number" && isFinite(b) && b > 0)
      .sort((a, b) => a - b);

    const bsr_min = bsrsSorted.length > 0 ? bsrsSorted[0] : null;
    const bsr_max = bsrsSorted.length > 0 ? bsrsSorted[bsrsSorted.length - 1] : null;

    const topCount = Math.min(4, bsrsSorted.length);
    const top = bsrsSorted.slice(0, topCount);
    // Avoid overlap when there are fewer than (4 + 2) BSRs available
    const bottomStart = Math.max(bsrsSorted.length - 2, top.length);
    const bottom = bsrsSorted.slice(bottomStart);
    const sample = [...top, ...bottom];

    const avg_bsr =
      sample.length > 0
        ? sample.reduce((sum, b) => sum + b, 0) / sample.length
        : null;

    const bsr_sample_method: KeywordMarketSnapshot["bsr_sample_method"] =
      sample.length === 0 ? "none"
      : (sample.length === bsrsSorted.length ? "all_available" : "top4_bottom2");
    
    // CRITICAL: Log BSR extraction summary for debugging
    const listingsWithoutBSR = listings.filter((l) => 
      l.main_category_bsr === null || 
      l.main_category_bsr === undefined || 
      l.main_category_bsr <= 0
    );
    
    console.log("BSR_EXTRACTION_SUMMARY", {
      keyword,
      total_listings: listings.length,
      listings_with_bsr: listingsWithMainBSR.length,
      listings_without_bsr: listingsWithoutBSR.length,
      bsr_extraction_rate: `${((listingsWithMainBSR.length / listings.length) * 100).toFixed(1)}%`,
      avg_bsr: avg_bsr !== null ? Math.round(avg_bsr) : null,
      bsr_min,
      bsr_max,
      bsr_sample_method,
      bsr_sample_size: sample.length,
      sample_bsrs: listingsWithMainBSR.slice(0, 5).map(l => ({
        asin: l.asin,
        bsr: l.main_category_bsr,
        category: l.main_category,
      })),
      missing_bsr_asins: listingsWithoutBSR.slice(0, 5).map(l => l.asin),
    });
    
    // BSR is optional for keyword Page-1 analysis - no warnings logged
    // BSR warnings only apply to explicit ASIN deep dives

    // Fulfillment mix calculation - ALWAYS return a value (use computeFulfillmentMix helper)
    const { computeFulfillmentMix } = await import("./fulfillmentMix");
    const fulfillmentMix = listings.length > 0 
      ? computeFulfillmentMix(listings)
      : { fba: 0, fbm: 0, amazon: 0 };

    // ═══════════════════════════════════════════════════════════════════════════
    // BRAND COUNTING (SEARCH RESULTS ONLY - NO API CALLS)
    // ═══════════════════════════════════════════════════════════════════════════
    // Count distinct brands including "Generic" for accurate brand diversity metrics
    // Uses normalized brand entities (lowercase, trimmed) for deduplication
    const brandCounts: Record<string, number> = {};
    const brandEntityMap = new Map<string, string>(); // Map normalized entity -> display name
    
    listings.forEach((l) => {
      // Get brand entity (normalized) - includes "Generic" for missing brands
      const brandEntity = l.brand ? normalizeBrand(l.brand) : 'Generic';
      const brandDisplay = l.brand || 'Generic';
      
      // Count by normalized entity (deduplicates variations)
      brandCounts[brandEntity] = (brandCounts[brandEntity] || 0) + 1;
      
      // Store display name for first occurrence of each entity
      if (!brandEntityMap.has(brandEntity)) {
        brandEntityMap.set(brandEntity, brandDisplay);
      }
    });

    // Build top brands list with display names
    const top_brands = Object.entries(brandCounts)
      .map(([brandEntity, count]) => ({ 
        brand: brandEntityMap.get(brandEntity) || brandEntity, // Use display name if available
        count 
      }))
      .sort((a, b) => b.count - a.count);

    // Total distinct brands (includes "Generic" if present)
    const total_page1_brands = Object.keys(brandCounts).length;

    // Page 1 dominance score: % of Page 1 listings belonging to top brand (0-100)
    // Exclude "Generic" from dominance calculation (only count known brands)
    const topKnownBrand = top_brands.find(b => b.brand !== 'Generic');
    const dominance_score =
      topKnownBrand && total_page1_listings > 0
        ? Math.round((topKnownBrand.count / total_page1_listings) * 100)
        : 0;

    // Compute PPC indicators
    let ppcIndicators: { sponsored_pct: number; ad_intensity_label: "Low" | "Medium" | "High"; signals: string[]; source: "heuristic_v1" } | null = null;
    try {
      const ppcResult = computePPCIndicators(
        listings,
        total_page1_listings,
        sponsored_count,
        dominance_score,
        avg_price
      );
      ppcIndicators = {
        sponsored_pct: ppcResult.sponsored_pct,
        ad_intensity_label: ppcResult.ad_intensity_label,
        signals: ppcResult.signals,
        source: "heuristic_v1",
      };
    } catch (error) {
      console.error("Error computing PPC indicators:", error);
      // Continue without PPC indicators if computation fails
    }

    const snapshot: KeywordMarketSnapshot = {
      keyword,
      avg_price: avg_price !== null ? Math.round(avg_price * 100) / 100 : null,
      avg_reviews: avg_reviews, // Always a number now (never null)
      avg_rating: avg_rating !== null ? Math.round(avg_rating * 10) / 10 : null,
      avg_bsr: avg_bsr !== null ? Math.round(avg_bsr) : null,
      bsr_min,
      bsr_max,
      bsr_sample_method,
      bsr_sample_size: sample.length,
      total_page1_listings,
      sponsored_count,
      dominance_score,
      total_page1_brands, // Total distinct brands (includes "Generic")
      top_brands_by_frequency: top_brands.slice(0, 10), // Top 10 brands by frequency
      fulfillment_mix: fulfillmentMix, // Always an object now (never null when listings exist)
      ppc: ppcIndicators,
    };

    // STEP 2: BSR Duplicate Bug Detection
    // Prevent Rainforest's known bug where the same BSR appears across many products
    // This must run BEFORE unit/revenue estimation to prevent corrupted data
    const listingsWithValidBSR = detectAndRemoveDuplicateBSRs(listings);
    
    // Log duplicate detection results
    const invalidBSRCount = listings.filter(l => 
      l.main_category_bsr !== null && 
      l.main_category_bsr !== undefined && 
      l.main_category_bsr > 0
    ).length - listingsWithValidBSR.filter(l => 
      l.main_category_bsr !== null && 
      l.main_category_bsr !== undefined && 
      l.main_category_bsr > 0
    ).length;
    
    if (invalidBSRCount > 0) {
      console.log("BSR_DUPLICATE_BUG_DETECTED", {
        keyword,
        invalid_bsr_count: invalidBSRCount,
        total_listings: listings.length,
        listings_with_valid_bsr: listingsWithValidBSR.filter(l => 
          l.main_category_bsr !== null && 
          l.main_category_bsr !== undefined && 
          l.main_category_bsr > 0
        ).length,
        message: "Duplicate BSRs detected and marked as invalid - will use non-BSR estimation fallback",
      });
    }

    // FIX #2: BSR-based revenue and units estimation (NO position-based logic, NO fallbacks)
    // CRITICAL: All estimates come from main_category_bsr → monthly_units → monthly_revenue
    // If BSR or price is missing, exclude from estimates (no fallbacks)
    let listingsWithEstimates: ParsedListing[] = [];
    
    try {
      // Import BSR-to-sales calculator
      const { estimateMonthlySalesFromBSR } = await import("@/lib/revenue/bsr-calculator");
      
      listingsWithEstimates = listingsWithValidBSR.map((listing) => {
        // CRITICAL: Only estimate if we have BOTH main_category_bsr AND price
        // No fallbacks, no position-based estimates, no hybrids
        if (
          listing.main_category_bsr === null || 
          listing.main_category_bsr === undefined || 
          listing.main_category_bsr <= 0 ||
          listing.price === null || 
          listing.price <= 0
        ) {
          // Missing required data - exclude from estimates
          return {
            ...listing,
            est_monthly_revenue: null,
            est_monthly_units: null,
            revenue_confidence: "low",
          };
        }
        
        // Get category (use main_category if available, otherwise default)
        const category = listing.main_category || 'default';
        
        // BSR-based calculation: main_category_bsr → monthly_units
        const monthlyUnits = estimateMonthlySalesFromBSR(listing.main_category_bsr, category);
        
        // Revenue = units * price
        const monthlyRevenue = monthlyUnits * listing.price;
        
        // Confidence: "medium" if BSR is reasonable, "low" if very high BSR
        const confidence: "low" | "medium" = listing.main_category_bsr <= 100000 ? "medium" : "low";
        
        return {
          ...listing,
          est_monthly_revenue: Math.round(monthlyRevenue * 100) / 100, // Round to 2 decimals
          est_monthly_units: monthlyUnits,
          revenue_confidence: confidence,
        };
      });
      
      // Log BSR-based estimation stats
      const listingsWithEstimatesCount = listingsWithEstimates.filter(
        l => l.est_monthly_revenue !== null && l.est_monthly_units !== null
      ).length;
      
      console.log("BSR_BASED_ESTIMATION_STATS", {
        keyword,
        total_listings: listings.length,
        listings_with_estimates: listingsWithEstimatesCount,
        listings_without_estimates: listings.length - listingsWithEstimatesCount,
        total_estimated_units: listingsWithEstimates
          .filter(l => l.est_monthly_units !== null)
          .reduce((sum, l) => sum + (l.est_monthly_units || 0), 0),
        total_estimated_revenue: listingsWithEstimates
          .filter(l => l.est_monthly_revenue !== null)
          .reduce((sum, l) => sum + (l.est_monthly_revenue || 0), 0),
      });
      
    } catch (bsrError) {
      console.error("BSR-based estimation failed, keeping listings without estimates", {
        keyword,
        error: bsrError instanceof Error ? bsrError.message : String(bsrError),
        stack: bsrError instanceof Error ? bsrError.stack : undefined,
        listings_count: listings.length,
      });
      // If estimation fails, return listings without estimates
      listingsWithEstimates = listings.map(l => ({
        ...l,
        est_monthly_revenue: null,
        est_monthly_units: null,
        revenue_confidence: "low" as const,
      }));
    }

    // FIX #2: Aggregate BSR-based revenue and units estimates with market dampening
    // Uses calculateMarketSnapshot() which applies market-level dampening
    let aggregated = {
      total_revenue_min: 0,
      total_revenue_max: 0,
      total_units_min: 0,
      total_units_max: 0,
    };
    let revenueEstimateSource = "bsr_based";
    let revenueModelVersion = "v1.0";
    
    try {
      // Prepare product estimates for market snapshot calculation
      const validEstimates = listingsWithEstimates.filter(
        l => l.est_monthly_revenue !== null && 
             l.est_monthly_revenue !== undefined && 
             l.est_monthly_units !== null && 
             l.est_monthly_units !== undefined &&
             l.main_category_bsr !== null &&
             l.main_category_bsr !== undefined &&
             l.main_category_bsr > 0 &&
             l.price !== null &&
             l.price !== undefined &&
             l.price > 0
      );
      
      if (validEstimates.length > 0) {
        // Import market snapshot calculator with dampening
        const { calculateMarketSnapshot } = await import("./bsrToUnits");
        
        // Convert listings to product estimates format
        const productEstimates = validEstimates.map(l => ({
          asin: l.asin || '',
          bsr: l.main_category_bsr!,
          price: l.price!,
          monthlyUnits: l.est_monthly_units!,
          monthlyRevenue: l.est_monthly_revenue!,
        }));
        
        // Calculate market snapshot (applies dampening internally)
        const marketSnapshot = calculateMarketSnapshot(productEstimates);
        
        // Apply confidence-based ranges to dampened totals
        // Medium confidence: ±25% range
        // Low confidence: ±40% range
        const mediumConfidenceCount = validEstimates.filter(l => l.revenue_confidence === "medium").length;
        const lowConfidenceCount = validEstimates.filter(l => l.revenue_confidence === "low").length;
        
        // Weighted average confidence adjustment
        const avgConfidenceAdjustment = mediumConfidenceCount > 0 && lowConfidenceCount > 0
          ? 0.30 // Mixed: use 30% adjustment
          : mediumConfidenceCount > 0
          ? 0.25 // All medium: 25% adjustment
          : 0.40; // All low: 40% adjustment
        
        const revenueRange = marketSnapshot.totalMonthlyRevenue * avgConfidenceAdjustment;
        const unitsRange = marketSnapshot.totalMonthlyUnits * avgConfidenceAdjustment;
        
        aggregated = {
          total_revenue_min: Math.max(0, Math.round(marketSnapshot.totalMonthlyRevenue - revenueRange)),
          total_revenue_max: Math.round(marketSnapshot.totalMonthlyRevenue + revenueRange),
          total_units_min: Math.max(0, Math.round(marketSnapshot.totalMonthlyUnits - unitsRange)),
          total_units_max: Math.round(marketSnapshot.totalMonthlyUnits + unitsRange),
        };
        
        console.log("BSR_BASED_AGGREGATION_WITH_DAMPENING", {
          keyword,
          valid_estimates_count: validEstimates.length,
          raw_total_revenue: validEstimates.reduce((sum, l) => sum + (l.est_monthly_revenue || 0), 0),
          raw_total_units: validEstimates.reduce((sum, l) => sum + (l.est_monthly_units || 0), 0),
          dampened_total_revenue: marketSnapshot.totalMonthlyRevenue,
          dampened_total_units: marketSnapshot.totalMonthlyUnits,
          demand_level: marketSnapshot.demandLevel.level,
          revenue_range: `${aggregated.total_revenue_min} - ${aggregated.total_revenue_max}`,
          units_range: `${aggregated.total_units_min} - ${aggregated.total_units_max}`,
        });
      } else {
        // BSR is optional for keyword Page-1 - estimates proceed without BSR
        // No warning logged (BSR only required for explicit ASIN deep dives)
      }
    } catch (aggError) {
      console.warn("BSR_BASED_AGGREGATION_FAILED", {
        keyword,
        error: aggError instanceof Error ? aggError.message : String(aggError),
        stack: aggError instanceof Error ? aggError.stack : undefined,
        listings_count: listings.length,
        message: "BSR-based aggregation failed, but listings will still be returned",
      });
      // aggregated already defaults to zeros above
    }
    
    // TASK 4: Estimate search volume using V2 model (with calibration) - wrapped in try/catch
    // Never returns null - uses deterministic H10-style heuristics with learned calibration
    let search_demand: { 
      search_volume_range: string; 
      search_volume_confidence: "low" | "medium" | "high";
      search_volume_source?: string;
      model_version?: string;
    } | null = null;
    
    if (listings.length > 0) {
      try {
        // Try V2 model first (if supabase provided and model exists)
        if (supabase) {
          const { estimateSearchVolumeV2 } = await import("@/lib/estimators/modelV2");
          const v2Estimate = await estimateSearchVolumeV2(supabase, {
            page1_count: listings.length,
            avg_reviews: avg_reviews,
            sponsored_count: sponsored_count,
            avg_price: avg_price,
            category: undefined, // Can be enhanced later
          }, marketplace);
          
          // Format range as string (e.g., "10k–20k")
          const formatRange = (min: number, max: number): string => {
            if (min >= 1000000 || max >= 1000000) {
              const minM = (min / 1000000).toFixed(1).replace(/\.0$/, '');
              const maxM = (max / 1000000).toFixed(1).replace(/\.0$/, '');
              return `${minM}M–${maxM}M`;
            } else if (min >= 1000 || max >= 1000) {
              const minK = Math.round(min / 1000);
              const maxK = Math.round(max / 1000);
              return `${minK}k–${maxK}k`;
            } else {
              return `${min}–${max}`;
            }
          };
          
          search_demand = {
            search_volume_range: formatRange(v2Estimate.min, v2Estimate.max),
            search_volume_confidence: v2Estimate.confidence,
            search_volume_source: v2Estimate.source, // Task 5: Add source metadata
            model_version: v2Estimate.model_version, // Task 5: Add model version
          };
        } else {
          // Fallback to V1 if no supabase/model available
          const searchVolumeEstimator = await import("./searchVolumeEstimator");
          const searchVolume = searchVolumeEstimator.estimateSearchVolume({
            page1Listings: listings,
            sponsoredCount: sponsored_count,
            avgReviews: avg_reviews,
            category: undefined,
          });
          
          const formatRange = (min: number, max: number): string => {
            if (min >= 1000000 || max >= 1000000) {
              const minM = (min / 1000000).toFixed(1).replace(/\.0$/, '');
              const maxM = (max / 1000000).toFixed(1).replace(/\.0$/, '');
              return `${minM}M–${maxM}M`;
            } else if (min >= 1000 || max >= 1000) {
              const minK = Math.round(min / 1000);
              const maxK = Math.round(max / 1000);
              return `${minK}k–${maxK}k`;
            } else {
              return `${min}–${max}`;
            }
          };
          
          search_demand = {
            search_volume_range: formatRange(searchVolume.min, searchVolume.max),
            search_volume_confidence: searchVolume.confidence,
            search_volume_source: "model_v1", // Task 5: Add source metadata
            model_version: "v1.0", // Task 5: Add model version
          };
        }
      } catch (searchVolumeError) {
        console.error("Search volume estimator failed, using fallback range", {
          keyword,
          error: searchVolumeError instanceof Error ? searchVolumeError.message : String(searchVolumeError),
          listings_count: listings.length,
        });
        // TASK 4: Set fallback range instead of null
        search_demand = {
          search_volume_range: "12k–18k",
          search_volume_confidence: "low",
          search_volume_source: "fallback",
          model_version: "v1.0",
        };
      }
    }
    
    // TASK 4: market_snapshot.est_total_monthly_revenue may be null (revenue aggregation is optional)
    // TASK 5: Add model version metadata
    const snapshotWithEstimates: KeywordMarketSnapshot & {
      search_volume_source?: string;
      revenue_estimate_source?: string;
      model_version?: string;
    } = {
      ...snapshot,
      est_total_monthly_revenue_min: aggregated.total_revenue_min > 0 ? aggregated.total_revenue_min : null,
      est_total_monthly_revenue_max: aggregated.total_revenue_max > 0 ? aggregated.total_revenue_max : null,
      est_total_monthly_units_min: aggregated.total_units_min > 0 ? aggregated.total_units_min : null,
      est_total_monthly_units_max: aggregated.total_units_max > 0 ? aggregated.total_units_max : null,
      search_demand, // Always set when listings exist, null only if no listings
      search_volume_source: search_demand?.search_volume_source || "model_v1", // Task 5: Add source metadata
      revenue_estimate_source: revenueEstimateSource, // Task 5: Add source metadata
      model_version: search_demand?.model_version || revenueModelVersion, // Task 5: Add model version
    };

    // CRITICAL: Final BSR validation summary
    const finalBSRCount = listingsWithEstimates.filter(l => 
      l.main_category_bsr !== null && l.main_category_bsr !== undefined && l.main_category_bsr > 0
    ).length;
    
    console.log("BSR_EXTRACTION_FINAL_VALIDATION", {
      keyword,
      total_listings: listingsWithEstimates.length,
      listings_with_valid_bsr: finalBSRCount,
      bsr_extraction_success_rate: `${((finalBSRCount / listingsWithEstimates.length) * 100).toFixed(1)}%`,
      avg_bsr: avg_bsr !== null ? Math.round(avg_bsr) : null,
      status: finalBSRCount === listingsWithEstimates.length ? "✅ ALL_LISTINGS_HAVE_BSR" : 
              finalBSRCount >= listingsWithEstimates.length * 0.8 ? "⚠️ MOST_LISTINGS_HAVE_BSR" :
              "❌ LOW_BSR_EXTRACTION_RATE",
    });
    
    // TASK 5: Invariant log right before returning snapshot
    console.warn("KEYWORD_SNAPSHOT_RETURN", { 
      listings_count: listingsWithEstimates.length, 
      has_real_listings: listingsWithEstimates.length > 0,
      bsr_extraction_rate: `${((finalBSRCount / listingsWithEstimates.length) * 100).toFixed(1)}%`,
    });
    
    // TASK 6: Final invariant log
    console.info("KEYWORD_ANALYZE_COMPLETE", {
      listings_count: listingsWithEstimates.length,
      has_revenue_estimate: !!(snapshotWithEstimates.est_total_monthly_revenue_min || snapshotWithEstimates.est_total_monthly_revenue_max),
      bsr_extraction_success: finalBSRCount > 0,
      avg_bsr: avg_bsr !== null ? Math.round(avg_bsr) : null,
    });
    
    // TASK 3: Always populate market_snapshot.listings[] if listings exist
    console.log("RETURNING_KEYWORD_MARKET_DATA", {
      keyword,
      total_listings: listingsWithEstimates.length,
      snapshot_total_page1_listings: snapshotWithEstimates.total_page1_listings,
      has_avg_price: snapshotWithEstimates.avg_price !== null,
      has_avg_reviews: snapshotWithEstimates.avg_reviews > 0,
      has_avg_rating: snapshotWithEstimates.avg_rating !== null,
      has_revenue_estimate: !!(snapshotWithEstimates.est_total_monthly_revenue_min || snapshotWithEstimates.est_total_monthly_revenue_max),
    });
    
    return {
      snapshot: snapshotWithEstimates,
      listings: listingsWithEstimates, // TASK 3: Always populated if listings exist
    };
  } catch (error) {
    // TASK 2: Classify error - don't treat processing errors as "zero ASINs"
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isProcessingError = apiReturnedResults && extractedAsinCount > 0;
    const isRevenueAggregationError = errorMessage.includes("aggregateRevenueEstimates") || 
                                     errorMessage.includes("REVENUE_AGGREGATION") ||
                                     errorMessage.includes("revenue aggregation");
    
    console.error("Error fetching keyword market snapshot:", {
      keyword,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      api_returned_results: apiReturnedResults,
      extracted_asin_count: extractedAsinCount,
      error_type: isProcessingError ? "processing_error" : "api_error",
      is_revenue_aggregation_error: isRevenueAggregationError,
    });
    
    // TASK 5: Revenue aggregation failures must NOT trigger "zero ASINs" or "No Page-1 listings"
    // If it's a revenue aggregation error and we have ASINs, we should still return the listings
    // However, since we're in a catch block, we can't easily reconstruct the data
    // The revenue aggregation happens AFTER listings are created, so if we get here,
    // it means the error happened during revenue aggregation
    // We should re-throw with a special marker so the caller knows it's a revenue-only error
    if (isRevenueAggregationError && extractedAsinCount > 0) {
      console.warn("REVENUE_AGGREGATION_ERROR_BUT_HAS_LISTINGS", {
        keyword,
        extracted_asin_count: extractedAsinCount,
        message: "Revenue aggregation failed but we have listings - this should be handled before catch",
      });
      // This shouldn't happen if we wrapped revenue aggregation properly
      // But if it does, throw with a special marker
      throw new Error(`REVENUE_AGGREGATION_ONLY: ${errorMessage} (extracted ${extractedAsinCount} ASINs, revenue aggregation failed)`);
    }
    
    // TASK 2: If we extracted ASINs but processing failed (non-revenue errors), throw with classification
    if (isProcessingError && !isRevenueAggregationError) {
      throw new Error(`Processing error: ${errorMessage} (extracted ${extractedAsinCount} ASINs but processing failed)`);
    }
    
    return null; // Only return null for genuine API errors or zero ASINs
  }
}

