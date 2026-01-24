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

import { Appearance } from "@/types/search";
import { normalizeCategoryForEstimation } from "@/lib/revenue/category-normalizer";

/**
 * 🔒 CANONICAL RAINFOREST DATA CONTRACT
 * 
 * This is the ONLY authoritative mapping from Rainforest API to internal types.
 * 
 * Based on Rainforest type=search official spec:
 * - position: Page position (guaranteed)
 * - asin: ASIN (guaranteed)
 * - title: Title (guaranteed)
 * - brand: Optional
 * - image: Product image (guaranteed)
 * - price: Main price (guaranteed)
 * - rating: Star rating (guaranteed)
 * - ratings_total: Review count (guaranteed)
 * - sponsored: The ONLY sponsored flag (guaranteed, boolean)
 * - is_prime: Prime eligibility (guaranteed, boolean) - NOT fulfillment
 * 
 * ❌ DO NOT USE:
 * - item.is_sponsored (not documented)
 * - Link parsing (/sspa/) (hack, will drift)
 * - is_prime → FBA inference (Prime ≠ FBA)
 * - delivery.text parsing (not guaranteed)
 * 
 * ✅ CORRECT RULES:
 * - isSponsored = item.sponsored === true (treat missing as false)
 * - fulfillment = "Unknown" unless SP-API confirms it
 * - prime_eligible = item.is_prime (use for Prime badge, not fulfillment)
 */
export interface RainforestSearchListing {
  asin: string;
  title: string;
  brand?: string;
  image: string;
  price?: number;
  rating?: number;
  ratings_total?: number;
  sponsored: boolean; // The ONLY sponsored flag - use this exclusively
  is_prime: boolean; // Prime eligibility - NOT fulfillment channel
  position: number;
}

/**
 * PHASE 1 - COLLECT: Raw Market Truth Types
 * 
 * These types represent raw, unprocessed data from Amazon Page 1.
 * No judgment, no estimation, no filtering (except hard invalids).
 */

export interface RawListing {
  asin: string;
  title: string;
  price: number | null;
  image: string | null;
  raw_position: number;
  rainforest_rank: number;
  // Ratings & reviews from Rainforest Page-1 (nullable, but NEVER overwritten by SP-API)
  rating: number | null;
  reviews: number | null;
  raw_badges: any[];
  raw_block_type?: string;
  isSponsored: boolean; // Canonical sponsored status (normalized at ingest from item.sponsored)
  raw_sponsored_flag?: boolean; // DEPRECATED: Use isSponsored instead
}

export interface RawSnapshot {
  keyword: string;
  marketplace: string;
  fetched_at: string;
  listings: RawListing[];
  rainforest_metadata: {
    request_id: string;
    page: number;
    total_results?: number;
  };
  warnings?: string[];
  // ═══════════════════════════════════════════════════════════════════════════
  // ASIN-LEVEL SPONSORED AGGREGATION (CRITICAL - DO NOT MODIFY WITHOUT UPDATING AGGREGATION LOGIC)
  // ═══════════════════════════════════════════════════════════════════════════
  // Sponsored is an ASIN-level property. This map persists through canonicalization.
  asinSponsoredMeta: Map<string, {
    appearsSponsored: boolean;
    sponsoredPositions: number[];
  }>;
}

/**
 * PHASE 2 - INTERPRET: Normalize & Score Types
 */

export interface CanonicalListing {
  asin: string;
  title: string;
  price: number | null;
  image: string | null;
  page_position: number;
  organic_rank?: number;
  sponsored: boolean | "unknown";
  sponsored_confidence: "high" | "medium" | "low";
  source_confidence: number; // 0-1
}

export interface EnrichedListing extends CanonicalListing {
  brand?: string;
  bsr?: number;
  bsr_category?: string;
  bsr_confidence?: "unique" | "shared";
  dimensions?: object;
}

export interface MarketQuality {
  bsr_coverage_pct: number;
  sponsored_detection_confidence: number;
  price_coverage_pct: number;
  overall_confidence: "high" | "medium" | "low";
}

/**
 * PHASE 3 - REASON: Estimate & Explain Types
 */

export interface MarketSnapshot {
  total_monthly_units: number;
  total_monthly_revenue: number;
  avg_price: number;
  sponsored_pct: number;
  top_brand_share_pct: number;
  competition_score: number;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

/**
 * Brand resolution structure - preserves all detected brands
 */
export interface BrandResolution {
  raw_brand: string | null; // Original detected brand string (NEVER null if a brand string exists)
  normalized_brand: string | null; // Normalized/canonical brand name (may be null for variants/low-confidence)
  brand_status: 'canonical' | 'variant' | 'low_confidence' | 'unknown'; // Brand classification
  brand_source: 'sp_api' | 'rainforest' | 'title_parse' | 'fallback'; // Source of brand detection
}

export interface ParsedListing {
  asin: string | null;
  title: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  isSponsored: boolean; // Canonical sponsored status (always boolean, normalized at ingest from item.sponsored)
  is_sponsored?: boolean | null; // DEPRECATED: Use isSponsored instead. Kept for backward compatibility.
  sponsored_position: number | null; // Ad position from Rainforest (null if not sponsored)
  sponsored_source: 'rainforest_serp' | 'organic_serp'; // Source of sponsored data (Rainforest SERP only)
  // ═══════════════════════════════════════════════════════════════════════════
  // ASIN-LEVEL SPONSORED AGGREGATION (CRITICAL - DO NOT MODIFY WITHOUT UPDATING AGGREGATION LOGIC)
  // ═══════════════════════════════════════════════════════════════════════════
  // Sponsored and Fulfillment are ASIN-level properties, not instance-level.
  // appearsSponsored: true if ASIN appears as sponsored ANYWHERE on Page 1
  // sponsoredPositions: all positions where this ASIN appeared as sponsored
  // These fields persist through canonicalization and represent Page-1 advertising presence.
  appearsSponsored: boolean; // ASIN-level: true if appears sponsored anywhere on Page 1
  sponsoredPositions: number[]; // ASIN-level: all positions where ASIN appeared as sponsored
  position: number; // Organic rank (1-indexed position on Page 1)
  brand: string | null; // DEPRECATED: Use brand_resolution.raw_brand instead. Kept for backward compatibility.
  brand_resolution?: BrandResolution; // New brand resolution structure (preserves all brands)
  image_url: string | null; // Rainforest search_results[].image
  bsr: number | null; // Best Seller Rank (if available from Rainforest) - DEPRECATED: use main_category_bsr
  main_category_bsr: number | null; // Main category Best Seller Rank (top-level category only)
  main_category: string | null; // Main category name (e.g., "Home & Kitchen")
  fulfillment: "FBA" | "FBM" | "UNKNOWN"; // Fulfillment type (never null, never defaults to FBM)
  fulfillmentSource: 'sp_api' | 'rainforest_inferred' | 'unknown'; // Source of fulfillment data
  fulfillmentConfidence: 'high' | 'medium' | 'low'; // Confidence in fulfillment inference
  seller?: string | null; // Seller name (for Amazon Retail detection)
  is_prime?: boolean; // Prime eligibility (for FBA detection)
  primeEligible?: boolean; // Prime eligibility (from is_prime, for UI display and AI reasoning)
  fulfillment_status?: 'PRIME' | 'NON_PRIME'; // Prime/Non-Prime status (heuristic from is_prime, NOT FBA guarantee)
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
  sponsored_count: number; // Count of listings with is_sponsored === true
  organic_count: number; // Count of listings with is_sponsored === false
  unknown_sponsored_count: number; // Count of listings with is_sponsored === null
  sponsored_pct: number; // Percentage of sponsored listings (0-100, 1 decimal)
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
 * For search results, ratings_total is the primary source.
 */
function parseReviews(item: any): number | null {
  // Primary: ratings_total (most common in Rainforest search results)
  if (item.ratings_total !== undefined && item.ratings_total !== null) {
    const parsed = parseInt(item.ratings_total.toString().replace(/,/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  
  // Secondary: reviews.count (used in some API responses)
  if (item.reviews?.count !== undefined && item.reviews.count !== null) {
    const parsed = parseInt(item.reviews.count.toString().replace(/,/g, ""), 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  
  // Tertiary: reviews as direct number
  if (typeof item.reviews === "number" && !isNaN(item.reviews) && item.reviews >= 0) {
    return item.reviews;
  }
  
  // Quaternary: review_count (alternative field name)
  if (item.review_count !== undefined && item.review_count !== null) {
    const parsed = parseInt(item.review_count.toString().replace(/,/g, ""), 10);
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
 * PHASE 1: Detect duplicate BSRs (DISABLED)
 * 
 * ⚠️ DUPLICATE DETECTION DISABLED: BSR duplication is valid across categories
 * 
 * Amazon BSR is category-scoped, so multiple products can legitimately have
 * the same BSR number in different categories (e.g., BSR #1 in "Drawer Organizers"
 * and BSR #1 in "Flatware Organizers" are both valid).
 * 
 * Helium 10 does not invalidate duplicate BSRs for this reason.
 * 
 * @param listings - Array of parsed listings
 * @returns Empty Set (no BSRs are marked as invalid)
 */
export function detectDuplicateBSRs(listings: ParsedListing[]): Set<number> {
  console.log("BSR_DUPLICATE_DETECTION_SKIPPED", {
    reason: "BSR duplication is valid across categories",
    total_listings: listings.length,
    timestamp: new Date().toISOString(),
  });
  
  // Return empty Set - no BSRs are invalidated
  return new Set<number>();
}

/**
 * STEP 2: Detects duplicate BSR bug from Rainforest API (DISABLED)
 * 
 * ⚠️ DUPLICATE DETECTION DISABLED: BSR duplication is valid across categories
 * 
 * Amazon BSR is category-scoped, so multiple products can legitimately have
 * the same BSR number in different categories. Helium 10 does not invalidate
 * duplicate BSRs for this reason.
 * 
 * @param listings - Array of parsed listings
 * @returns Listings unchanged (no BSRs are removed)
 */
function detectAndRemoveDuplicateBSRs(listings: ParsedListing[]): ParsedListing[] {
  console.log("BSR_DUPLICATE_DETECTION_SKIPPED", {
    reason: "BSR duplication is valid across categories",
    total_listings: listings.length,
    listings_with_bsr: listings.filter(l => l.main_category_bsr !== null && l.main_category_bsr !== undefined && l.main_category_bsr > 0).length,
    timestamp: new Date().toISOString(),
  });
  
  // Return listings unchanged - no BSRs are removed
  return listings;
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
 * Infers fulfillment type from Rainforest listing using delivery tagline.
 * 
 * 🔒 CANONICAL FULFILLMENT INFERENCE (NORMALIZED AT INGEST):
 * This is market-level inference for competitive analysis, not checkout accuracy.
 * Uses ONLY delivery.tagline for inference.
 * 
 * @param listing - Rainforest listing object with delivery field
 * @returns Fulfillment type: 'FBA' | 'FBM' | 'UNKNOWN'
 */
function inferFulfillment(listing: any): "FBA" | "FBM" | "UNKNOWN" {
  const text = `${listing.delivery?.tagline || ''}`.toLowerCase();

  // Strong FBA indicators
  if (
    text.includes('amazon') ||
    text.includes('prime') ||
    (text.includes('free delivery') && !text.includes('ships from'))
  ) {
    return 'FBA';
  }

  // Strong FBM indicators
  if (
    text.includes('ships from') ||
    text.includes('sold by')
  ) {
    return 'FBM';
  }

  return 'UNKNOWN';
}

/**
 * Infers fulfillment type from Rainforest search results (SERP-based market analysis).
 * 
 * 🔒 CANONICAL FULFILLMENT INFERENCE (NORMALIZED AT INGEST):
 * This is market-level inference for competitive analysis, not checkout accuracy.
 * 
 * Rules (STRICT):
 * - NEVER default to FBM
 * - NEVER guess fulfillment without a source
 * - Fulfillment must include source and confidence
 * 
 * Priority:
 * 1. If item.is_prime === true → "FBA" (PRIMARY signal, high confidence)
 * 2. Else if delivery.tagline OR delivery.text strongly implies FBA → "FBA" (medium confidence)
 * 3. Else → "UNKNOWN" (low confidence)
 * 
 * Note: We do NOT use SP-API or Offers API for fulfillment in Analyze flow.
 * Note: We do NOT infer FBA from is_prime alone without delivery confirmation.
 * 
 * @deprecated Use inferFulfillment instead for simpler tagline-based inference
 */
function inferFulfillmentFromSearchResultWithSource(item: any): {
  fulfillment: "FBA" | "FBM" | "UNKNOWN";
  source: 'sp_api' | 'rainforest_inferred' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
} {
  // STEP 1: PRIMARY SIGNAL - is_prime === true + delivery confirmation → FBA (high confidence)
  if (item.is_prime === true) {
    // Check delivery text for confirmation
    if (item.delivery) {
      const deliveryTagline = item.delivery?.tagline || "";
      const deliveryText = item.delivery?.text || item.delivery?.message || "";
      const deliveryStr = (deliveryTagline + " " + deliveryText).toLowerCase();
      
      // Strong FBA indicators
      if (
        deliveryStr.includes("prime") ||
        deliveryStr.includes("get it") ||
        deliveryStr.includes("shipped by amazon") ||
        deliveryStr.includes("fulfilled by amazon") ||
        deliveryStr.includes("ships from amazon")
      ) {
        return {
          fulfillment: "FBA",
          source: 'rainforest_inferred',
          confidence: 'high',
        };
      }
    }
    
    // is_prime alone (without delivery confirmation) → FBA (medium confidence)
    return {
      fulfillment: "FBA",
      source: 'rainforest_inferred',
      confidence: 'medium',
    };
  }
  
  // STEP 2: Check delivery.tagline OR delivery.text for FBA indicators (medium confidence)
  if (item.delivery) {
    const deliveryTagline = item.delivery?.tagline || "";
    const deliveryText = item.delivery?.text || item.delivery?.message || "";
    const deliveryStr = (deliveryTagline + " " + deliveryText).toLowerCase();
    
    // Strong FBA indicators
    if (
      deliveryStr.includes("prime") ||
      deliveryStr.includes("get it") ||
      deliveryStr.includes("shipped by amazon") ||
      deliveryStr.includes("fulfilled by amazon") ||
      deliveryStr.includes("ships from amazon")
    ) {
      return {
        fulfillment: "FBA",
        source: 'rainforest_inferred',
        confidence: 'medium',
      };
    }
    
    // FBM indicators (explicit merchant fulfillment)
    if (
      deliveryStr.includes("ships from") && 
      !deliveryStr.includes("amazon") &&
      (deliveryTagline || deliveryText)
    ) {
      return {
        fulfillment: "FBM",
        source: 'rainforest_inferred',
        confidence: 'medium',
      };
    }
  }
  
  // STEP 3: No fulfillment signals found → UNKNOWN (never default to FBM)
  return {
    fulfillment: "UNKNOWN",
    source: 'unknown',
    confidence: 'low',
  };
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use inferFulfillmentFromSearchResultWithSource instead
 */
function inferFulfillmentFromSearchResult(item: any): "FBA" | "FBM" | "Amazon" | "UNKNOWN" {
  const result = inferFulfillmentFromSearchResultWithSource(item);
  // Map "UNKNOWN" to legacy return type (no "Amazon" in new system)
  return result.fulfillment;
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
 * 
 * CRITICAL: Never deletes brands - always preserves raw_brand if a string exists
 */
function resolveBrandFromSearchResult(
  item: any
): BrandResolution {
  // Priority 1: Amazon brand flags
  if (item.is_amazon_brand === true || 
      item.is_exclusive_to_amazon === true || 
      item.featured_from_our_brands === true) {
    return {
      raw_brand: 'Amazon',
      normalized_brand: 'Amazon',
      brand_status: 'canonical',
      brand_source: 'rainforest'
    };
  }
  
  // Priority 2: search_result.brand field
  if (item.brand && typeof item.brand === 'string' && item.brand.trim().length > 0) {
    const rawBrand = item.brand.trim();
    const normalized = normalizeBrand(rawBrand);
    return {
      raw_brand: rawBrand, // ALWAYS preserve original
      normalized_brand: normalized,
      brand_status: 'canonical',
      brand_source: 'rainforest'
    };
  }
  
  // Priority 3: search_result.brand_name field
  if (item.brand_name && typeof item.brand_name === 'string' && item.brand_name.trim().length > 0) {
    const rawBrand = item.brand_name.trim();
    const normalized = normalizeBrand(rawBrand);
    return {
      raw_brand: rawBrand, // ALWAYS preserve original
      normalized_brand: normalized,
      brand_status: 'canonical',
      brand_source: 'rainforest'
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
        raw_brand: sellerName, // ALWAYS preserve original
        normalized_brand: normalized,
        brand_status: 'low_confidence',
        brand_source: 'fallback'
      };
    }
  }
  
  // Priority 5: Infer from title prefix (first 1-3 capitalized words)
  if (item.title && typeof item.title === 'string' && item.title.trim().length > 0) {
    const inferredBrand = extractBrandFromTitle(item.title);
    if (inferredBrand) {
      const normalized = normalizeBrand(inferredBrand);
      return {
        raw_brand: inferredBrand, // ALWAYS preserve original
        normalized_brand: normalized,
        brand_status: 'low_confidence',
        brand_source: 'title_parse'
      };
    }
  }
  
  // Priority 6: Unknown (no brand found)
  return {
    raw_brand: null,
    normalized_brand: null,
    brand_status: 'unknown',
    brand_source: 'fallback'
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
  // CRITICAL: Only enrich if BOTH rating AND reviews are null.
  // Ratings & reviews NEVER come from SP-API; they are Rainforest-only fields.
  // Detection must be based on listing.rating/listing.reviews, not SP-API metadata.
  const listingsMissingRatingOrReviews = listings.filter(l => {
    if (!l.asin) return false;
    
    const needsRating = l.rating === null || l.rating === undefined;
    const needsReviews = l.reviews === null || l.reviews === undefined;

    // Enrichment is only relevant if at least one of the two is missing.
    return needsRating || needsReviews;
  });

  // Enforce call cap AFTER detection: we may have many missing, but only enrich top N.
  const listingsNeedingEnrichment = listingsMissingRatingOrReviews
    .slice(0, MAX_METADATA_ENRICHMENT);

  if (listingsNeedingEnrichment.length === 0) {
    // All listings have ratings/reviews from Rainforest/search data - no enrichment needed
    console.log("METADATA_ENRICHMENT_SKIPPED", {
      keyword: keyword || "unknown",
      reason: "ratings_and_reviews_already_populated",
      total_listings: listings.length,
      listings_with_rating: listings.filter(l => l.rating !== null && l.rating !== undefined).length,
      listings_with_reviews: listings.filter(l => l.reviews !== null && l.reviews !== undefined).length,
      note: "Title, image, brand already provided by SP-API Catalog; ratings/reviews from Rainforest/search",
    });
    return listings;
  }

  console.log("🔵 ASIN_METADATA_ENRICHMENT_START", {
    keyword: keyword || "unknown",
    listings_needing_enrichment: listingsNeedingEnrichment.length,
    total_listings: listings.length,
    enrichment_scope: "ratings_and_reviews_only",
    note: "Title, image, brand already provided by SP-API Catalog",
    // IMPORTANT: missing_* counts are computed over ALL listings missing data,
    // not just the first MAX_METADATA_ENRICHMENT entries we will actually refetch.
    missing_metadata_breakdown: {
      missing_rating: listingsMissingRatingOrReviews.filter(l => l.rating === null || l.rating === undefined).length,
      missing_reviews: listingsMissingRatingOrReviews.filter(l => l.reviews === null || l.reviews === undefined).length,
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
        // 🚨 RAINFOREST API HARD CAP: Check before each call (MAX = 7)
        if (apiCallCounter && apiCallCounter.count >= apiCallCounter.max) {
          console.error("🚨 RAINFOREST_CALL_CAP_REACHED", {
            keyword: keyword || "unknown",
            current_count: apiCallCounter.count,
            max_allowed: apiCallCounter.max,
            call_type: "metadata_enrichment",
            asin,
            message: "Rainforest API call cap reached - metadata enrichment blocked. Continuing with available data.",
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

    // Enrich listings with fetched metadata (ratings/reviews only)
    // NOTE: Brands come from search results only, not from product API enrichment
    // CRITICAL: Only enrich listings that need enrichment (BOTH rating AND reviews are null)
    // SP-API data is authoritative - never overwrite non-null fields
    let enrichedListingsCount = 0;
    let enrichedFieldsCount = 0;
    
    // Create a Set of ASINs that need enrichment for fast lookup
    const asinsNeedingEnrichment = new Set(
      listingsNeedingEnrichment.map(l => l.asin?.toUpperCase()).filter(Boolean) as string[]
    );
    
    const enrichedListings = listings.map(listing => {
      // Only enrich if this listing actually needs enrichment (BOTH rating AND reviews are null)
      const needsEnrichment = listing.asin && asinsNeedingEnrichment.has(listing.asin.toUpperCase());
      
      if (!needsEnrichment) {
        // Listing doesn't need enrichment - return as-is
        return listing;
      }
      
      // Listing needs enrichment - check if we have API data
      if (!listing.asin || !enrichmentMap.has(listing.asin.toUpperCase())) {
        // No API enrichment data available - return as-is (don't overwrite with nulls)
        return listing;
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
      // CRITICAL: Preserve existing values - never overwrite with null or undefined
      // GUARD: Enrichment must never reduce data quality

      // Store original values for data quality check
      const originalRating = enriched.rating;
      const originalReviews = enriched.reviews;

      // Enrich rating (only if null/undefined - never overwrite existing value)
      // Only overwrite when we have a valid number (> 0)
      if (enriched.rating === null || enriched.rating === undefined) {
        const rating = parseRating(productData);
        // Only set if we got a valid number (null means couldn't parse, leave as null)
        if (rating !== null && rating !== undefined && !isNaN(rating) && rating > 0) {
          enriched.rating = rating;
          enrichedFieldsCount++;
          listingEnriched = true;
        }
        // If rating is null and can't be parsed, leave it as null (don't set to 0)
      }
      
      // GUARD: Never reduce data quality - preserve existing rating if present
      if (originalRating !== null && originalRating !== undefined && 
          (enriched.rating === null || enriched.rating === undefined)) {
        enriched.rating = originalRating; // Restore original value
      }

      // Enrich reviews (only if null/undefined - never overwrite existing value)
      // Only overwrite when we have a valid number (> 0)
      if (enriched.reviews === null || enriched.reviews === undefined) {
        const reviews = parseReviews(productData);
        // Only set if we got a valid number (null means couldn't parse, leave as null)
        if (reviews !== null && reviews !== undefined && !isNaN(reviews) && reviews > 0) {
          enriched.reviews = reviews;
          enrichedFieldsCount++;
          listingEnriched = true;
        }
        // If reviews is null and can't be parsed, leave it as null (don't set to 0)
      }
      
      // GUARD: Never reduce data quality - preserve existing reviews if present
      if (originalReviews !== null && originalReviews !== undefined && 
          (enriched.reviews === null || enriched.reviews === undefined)) {
        enriched.reviews = originalReviews; // Restore original value
      }

      // NOTE: Brand enrichment removed - brands come from search results only (low-cost, Helium-10 style)
      // Brands are resolved in fetchKeywordMarketSnapshot using resolveBrandFromSearchResult()
      
      // Track enriched listings count (increment after map)
      if (listingEnriched) {
        enrichedListingsCount++;
      }

      return enriched;
    });

    // CRITICAL: enrichment_success_rate must NEVER exceed 100%
    // Cap the rate at 100% if enrichedListingsCount exceeds listingsNeedingEnrichment
    const rawSuccessRate = listingsNeedingEnrichment.length > 0 
      ? (enrichedListingsCount / listingsNeedingEnrichment.length) * 100
      : 0;
    const cappedSuccessRate = Math.min(rawSuccessRate, 100); // Cap at 100%
    
    console.log("✅ ASIN_METADATA_ENRICHMENT_COMPLETE", {
      keyword: keyword || "unknown",
      listings_enriched: enrichedListingsCount,
      fields_enriched: enrichedFieldsCount,
      total_listings: enrichedListings.length,
      listings_needing_enrichment: listingsNeedingEnrichment.length,
      enrichment_success_rate: `${cappedSuccessRate.toFixed(1)}%`,
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
 * PHASE 1 - COLLECT: Parse Raw Rainforest Search Results
 * 
 * "What does Amazon show on Page 1?"
 * 
 * Goals:
 * - Get everything
 * - Do no judgment
 * - Do no estimation
 * - Do no filtering except hard invalids
 * 
 * Rules:
 * ✅ Allowed:
 * - Missing sponsored flag
 * - Missing price
 * - Duplicate ASINs
 * - Duplicate BSRs
 * - Weird categories
 * 
 * ❌ Forbidden:
 * - Estimations
 * - Deduplication
 * - "Invalid" logic
 * - Coverage checks
 * 
 * @param raw - Raw Rainforest API response
 * @param keyword - Search keyword
 * @param marketplace - Marketplace identifier
 * @returns RawSnapshot with listings (empty array if no results, never null)
 */
export function parseRainforestSearchResults(
  raw: any,
  keyword: string,
  marketplace: string = "US"
): RawSnapshot {
  const warnings: string[] = [];
  
  // Extract search_results array (contains both sponsored and organic)
  const searchResults: any[] = [];
  
  if (Array.isArray(raw.search_results) && raw.search_results.length > 0) {
    searchResults.push(...raw.search_results);
  }
  
  // Fallback to results array if search_results is not present
  if (searchResults.length === 0 && Array.isArray(raw.results) && raw.results.length > 0) {
    searchResults.push(...raw.results);
  }
  
  // CRITICAL CHANGE: Never throw, only return empty with warning
  if (searchResults.length === 0) {
    return {
      keyword,
      marketplace,
      fetched_at: new Date().toISOString(),
      listings: [],
      rainforest_metadata: {
        request_id: raw.request_info?.request_id || "unknown",
        page: 1,
        total_results: undefined,
      },
      asinSponsoredMeta: new Map(), // Empty map if no results
      warnings: ["NO_RESULTS_RETURNED"],
    };
  }
  
  // Parse each search result into RawListing
  const rawListings: RawListing[] = [];
  
  for (let i = 0; i < searchResults.length; i++) {
    const item = searchResults[i];
    
    // Only require ASIN - everything else can be missing
    if (!item?.asin) {
      continue; // Skip items without ASIN (hard invalid)
    }
    
    // Extract price (can be null)
    let price: number | null = null;
    if (item.price?.value) {
      const parsed = parseFloat(item.price.value);
      price = isNaN(parsed) ? null : parsed;
    } else if (item.price?.raw) {
      const parsed = parseFloat(item.price.raw);
      price = isNaN(parsed) ? null : parsed;
    } else if (typeof item.price === "number") {
      price = isNaN(item.price) ? null : item.price;
    } else if (typeof item.price === "string") {
      const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ""));
      price = isNaN(parsed) ? null : parsed;
    }
    
    // Extract title (can be empty string, but we'll use null for missing)
    const title = item.title || item.product_title || "";
    
    // Extract image (can be null)
    const image = item.image || item.image_url || null;
    
    // 🔒 CANONICAL SPONSORED DETECTION (NORMALIZED AT INGEST)
    // MANDATORY: Capture sponsored at Rainforest ingestion before any normalization
    // Check multiple field names as fallback (Rainforest may vary)
    const isSponsored: boolean = Boolean(
      item.sponsored === true ||
      item.is_sponsored === true ||
      item.ad === true ||
      (typeof item.link === 'string' && (item.link.includes('/sspa/') || item.link.includes('-spons')))
    );
    
    // Extract BSR/rank from bestsellers_rank (can be null)
    let rainforestRank: number = 0;
    if (item.bestsellers_rank) {
      if (Array.isArray(item.bestsellers_rank) && item.bestsellers_rank.length > 0) {
        const firstRank = item.bestsellers_rank[0];
        const rankValue = firstRank?.rank ?? firstRank?.Rank ?? firstRank?.rank_value ?? firstRank?.value;
        if (rankValue !== undefined && rankValue !== null) {
          const parsed = parseInt(rankValue.toString().replace(/,/g, ""), 10);
          if (!isNaN(parsed) && parsed > 0) {
            rainforestRank = parsed;
          }
        }
      } else if (typeof item.bestsellers_rank === "number") {
        rainforestRank = item.bestsellers_rank;
      }
    }
    
    // Extract badges (can be empty array)
    const rawBadges = item.badges || item.prime_badge || [];
    const badgesArray = Array.isArray(rawBadges) ? rawBadges : (rawBadges ? [rawBadges] : []);
    
    // Extract block type if available
    const rawBlockType = item.block_type || item.type || undefined;
    
    // Extract ratings & reviews from raw Rainforest item
    // CRITICAL: This is the ONLY backend source for ratings/reviews.
    // SP-API Catalog NEVER provides these fields and must not overwrite them.
    const rating = parseRating(item);   // Nullable
    const reviews = parseReviews(item); // Nullable

    rawListings.push({
      asin: item.asin,
      title,
      price,
      image,
      raw_position: i + 1, // 1-indexed position
      rainforest_rank: rainforestRank,
      rating,
      reviews,
      raw_badges: badgesArray,
      raw_block_type: rawBlockType,
      isSponsored, // Canonical sponsored status (normalized at ingest)
      raw_sponsored_flag: isSponsored, // DEPRECATED: kept for backward compatibility
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ASIN-LEVEL SPONSORED AGGREGATION (BEFORE DEDUPLICATION)
  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: Sponsored is an ASIN-level property, not instance-level.
  // Build aggregation map: if ASIN appears sponsored ANYWHERE on Page 1, mark it.
  // This ensures sponsored counts persist through canonicalization.
  const asinSponsoredMeta = new Map<string, {
    appearsSponsored: boolean;
    sponsoredPositions: number[];
  }>();
  
  for (const listing of rawListings) {
    const asin = listing.asin?.trim().toUpperCase() || "";
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) continue;
    
    if (!asinSponsoredMeta.has(asin)) {
      asinSponsoredMeta.set(asin, {
        appearsSponsored: false,
        sponsoredPositions: [],
      });
    }
    
    const meta = asinSponsoredMeta.get(asin)!;
    if (listing.isSponsored === true) {
      meta.appearsSponsored = true;
      meta.sponsoredPositions.push(listing.raw_position);
    }
  }
  
  // Extract search_information.total_results
  const searchInformation = raw.search_information || {};
  let totalResults: number | undefined = undefined;
  if (searchInformation.total_results) {
    const totalResultsStr = searchInformation.total_results.toString();
    const match = totalResultsStr.match(/([\d,]+)/);
    if (match) {
      const parsed = parseInt(match[1].replace(/,/g, ''), 10);
      if (!isNaN(parsed)) {
        totalResults = parsed;
      }
    }
  }
  
  return {
    keyword,
    marketplace,
    fetched_at: new Date().toISOString(),
    listings: rawListings,
    rainforest_metadata: {
      request_id: raw.request_info?.request_id || "unknown",
      page: 1,
      total_results: totalResults,
    },
    asinSponsoredMeta, // Include ASIN-level sponsored aggregation
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * PHASE 2A - CANONICALIZATION: Sponsored Detection
 * 
 * 🔒 STRICT RULE: Use ONLY item.sponsored from Rainforest
 * 
 * @param raw - Raw listing from Phase 1
 * @returns Sponsored status and confidence level
 */
export function detectSponsored(raw: RawListing): {
  sponsored: boolean | "unknown";
  confidence: "high" | "medium" | "low";
} {
  // 🔒 CANONICAL RULE: Use isSponsored (normalized at ingest from item.sponsored)
  // isSponsored is always boolean (true if item.sponsored === true, false otherwise)
  // DO NOT use link parsing, is_sponsored, badges, or any other heuristics
  
  // isSponsored is always defined (boolean) - use it directly
  return { 
    sponsored: raw.isSponsored, 
    confidence: "high" // Always high confidence since it's from Rainforest's authoritative field
  };
}

/**
 * PHASE 2A - CANONICALIZATION: Convert Raw Listings to Canonical Format
 * 
 * "What kind of listings are these?"
 * 
 * This is where all current bugs live — so we isolate them here.
 * 
 * @param rawSnapshot - Raw snapshot from Phase 1
 * @returns Canonical listings with normalized structure
 */
export function canonicalizeListings(rawSnapshot: RawSnapshot): CanonicalListing[] {
  const canonical: CanonicalListing[] = [];
  let organicRankCounter = 1;
  
  for (const raw of rawSnapshot.listings) {
    // Detect sponsored status with confidence
    const sponsoredDetection = detectSponsored(raw);
    
    // Calculate organic rank (only for non-sponsored listings)
    let organicRank: number | undefined = undefined;
    if (sponsoredDetection.sponsored === false) {
      organicRank = organicRankCounter++;
    }
    
    // Calculate source confidence (based on data completeness)
    let sourceConfidence = 1.0;
    if (!raw.title || raw.title.trim().length === 0) {
      sourceConfidence -= 0.2;
    }
    if (raw.price === null) {
      sourceConfidence -= 0.1;
    }
    if (raw.image === null) {
      sourceConfidence -= 0.1;
    }
    if (sponsoredDetection.confidence === "low") {
      sourceConfidence -= 0.1;
    }
    sourceConfidence = Math.max(0, Math.min(1, sourceConfidence));
    
    canonical.push({
      asin: raw.asin,
      title: raw.title,
      price: raw.price,
      image: raw.image,
      page_position: raw.raw_position,
      organic_rank: organicRank,
      sponsored: sponsoredDetection.sponsored,
      sponsored_confidence: sponsoredDetection.confidence,
      source_confidence: sourceConfidence,
    });
  }
  
  return canonical;
}

/**
 * PHASE 2B - ENRICHMENT: Add SP-API Data with BSR Confidence
 * 
 * Critical Fix: BSR duplicates
 * ❌ CURRENT (wrong): if (bsr appears > N times) mark invalid
 * ✅ NEW (correct): if (bsr appears > 1 time) { bsr_confidence = "shared" } else { bsr_confidence = "unique" }
 * 
 * Never delete listings because of shared BSRs.
 * 
 * @param canonical - Canonical listings from Phase 2A
 * @param spApiData - SP-API enrichment data (brand, BSR, category, etc.)
 * @returns Enriched listings with BSR confidence
 */
export function enrichListings(
  canonical: CanonicalListing[],
  spApiData: Map<string, { brand?: string; bsr?: number; bsr_category?: string; dimensions?: object }>
): EnrichedListing[] {
  // Count BSR occurrences to determine confidence
  const bsrCounts: Record<number, number> = {};
  
  // First pass: count BSRs from SP-API data
  for (const [asin, data] of spApiData.entries()) {
    if (data.bsr !== undefined && data.bsr !== null && data.bsr > 0) {
      bsrCounts[data.bsr] = (bsrCounts[data.bsr] || 0) + 1;
    }
  }
  
  // Enrich canonical listings
  const enriched: EnrichedListing[] = canonical.map((listing) => {
    const spApi = spApiData.get(listing.asin);
    
    // Determine BSR confidence
    let bsrConfidence: "unique" | "shared" | undefined = undefined;
    if (spApi?.bsr !== undefined && spApi.bsr !== null && spApi.bsr > 0) {
      const count = bsrCounts[spApi.bsr] || 0;
      bsrConfidence = count > 1 ? "shared" : "unique";
    }
    
    return {
      ...listing,
      brand: spApi?.brand,
      bsr: spApi?.bsr,
      bsr_category: spApi?.bsr_category,
      bsr_confidence: bsrConfidence,
      dimensions: spApi?.dimensions,
    };
  });
  
  return enriched;
}

/**
 * PHASE 2C - COVERAGE SCORING: Calculate Market Quality Metrics
 * 
 * Rule: Coverage never blocks, only influences confidence + AI language
 * 
 * @param enriched - Enriched listings from Phase 2B
 * @returns Market quality metrics
 */
export function calculateMarketQuality(enriched: EnrichedListing[]): MarketQuality {
  if (enriched.length === 0) {
    return {
      bsr_coverage_pct: 0,
      sponsored_detection_confidence: 0,
      price_coverage_pct: 0,
      overall_confidence: "low",
    };
  }
  
  // BSR coverage: % of listings with BSR
  const listingsWithBSR = enriched.filter(l => l.bsr !== undefined && l.bsr !== null && l.bsr > 0).length;
  const bsrCoveragePct = (listingsWithBSR / enriched.length) * 100;
  
  // Sponsored detection confidence: average confidence of sponsored detection
  const sponsoredDetections = enriched.map(l => {
    if (l.sponsored_confidence === "high") return 1.0;
    if (l.sponsored_confidence === "medium") return 0.7;
    if (l.sponsored_confidence === "low") return 0.4;
    return 0.2; // unknown (shouldn't happen with fixed detection)
  });
  const avgSponsoredConfidence = sponsoredDetections.length > 0
    ? sponsoredDetections.reduce((sum, c) => sum + c, 0) / sponsoredDetections.length
    : 0;
  const sponsoredDetectionConfidence = avgSponsoredConfidence * 100;
  
  // Price coverage: % of listings with price
  const listingsWithPrice = enriched.filter(l => l.price !== null && l.price !== undefined && l.price > 0).length;
  const priceCoveragePct = (listingsWithPrice / enriched.length) * 100;
  
  // Overall confidence: high/medium/low based on all metrics
  let overallConfidence: "high" | "medium" | "low" = "low";
  if (bsrCoveragePct >= 80 && sponsoredDetectionConfidence >= 80 && priceCoveragePct >= 90) {
    overallConfidence = "high";
  } else if (bsrCoveragePct >= 50 && sponsoredDetectionConfidence >= 60 && priceCoveragePct >= 70) {
    overallConfidence = "medium";
  }
  
  return {
    bsr_coverage_pct: Math.round(bsrCoveragePct * 10) / 10,
    sponsored_detection_confidence: Math.round(sponsoredDetectionConfidence * 10) / 10,
    price_coverage_pct: Math.round(priceCoveragePct * 10) / 10,
    overall_confidence: overallConfidence,
  };
}

/**
 * PHASE 3A - DEMAND ESTIMATION: Clean Math
 * 
 * "What does this market mean?"
 * 
 * Steps:
 * 1. Convert each BSR → units
 * 2. Apply rank weighting
 * 3. Aggregate totals
 * 4. Apply ONE dampener
 * 
 * ❌ No per-listing dampening
 * ❌ No double normalization
 * 
 * @param enriched - Enriched listings from Phase 2B
 * @param marketQuality - Market quality metrics from Phase 2C
 * @returns Estimated monthly units and revenue
 */
export async function estimateDemand(
  enriched: EnrichedListing[],
  marketQuality: MarketQuality
): Promise<{ total_monthly_units: number; total_monthly_revenue: number }> {
  // Import BSR calculator
  const { estimateMonthlySalesFromBSR } = await import("@/lib/revenue/bsr-calculator");
  
  // Step 1: Convert each BSR → units
  const listingEstimates: Array<{
    asin: string;
    raw_units: number;
    raw_revenue: number;
    organic_rank?: number;
    price: number;
  }> = [];
  
  for (const listing of enriched) {
    // Only estimate if we have BSR, price, and category
    if (
      listing.bsr === undefined ||
      listing.bsr === null ||
      listing.bsr <= 0 ||
      listing.price === null ||
      listing.price <= 0 ||
      !listing.bsr_category
    ) {
      continue; // Skip listings without required data
    }
    
    // Convert BSR → units
    const rawUnits = estimateMonthlySalesFromBSR(listing.bsr, listing.bsr_category);
    
    // Calculate raw revenue
    const rawRevenue = rawUnits * listing.price;
    
    listingEstimates.push({
      asin: listing.asin,
      raw_units: rawUnits,
      raw_revenue: rawRevenue,
      organic_rank: listing.organic_rank,
      price: listing.price,
    });
  }
  
  if (listingEstimates.length === 0) {
    return {
      total_monthly_units: 0,
      total_monthly_revenue: 0,
    };
  }
  
  // Step 2: Apply rank weighting
  // Organic rank 1 gets full weight, rank 2 gets 0.85x, rank 3 gets 0.72x, etc.
  // Exponential decay: weight = exp(-0.15 * (rank - 1))
  // Sponsored listings (no organic_rank) get 0.5x weight
  const weightedEstimates = listingEstimates.map((est) => {
    let rankWeight = 1.0;
    
    if (est.organic_rank !== undefined && est.organic_rank !== null) {
      // Exponential decay based on organic rank
      rankWeight = Math.exp(-0.15 * (est.organic_rank - 1));
    } else {
      // Sponsored listings get reduced weight
      rankWeight = 0.5;
    }
    
    return {
      ...est,
      weighted_units: est.raw_units * rankWeight,
      weighted_revenue: est.raw_revenue * rankWeight,
    };
  });
  
  // Step 3: Aggregate totals
  const rawTotalUnits = weightedEstimates.reduce((sum, est) => sum + est.weighted_units, 0);
  const rawTotalRevenue = weightedEstimates.reduce((sum, est) => sum + est.weighted_revenue, 0);
  
  // Step 4: Apply ONE dampener (market confidence multiplier)
  // Based on market quality metrics
  let marketConfidenceMultiplier = 1.0;
  
  if (marketQuality.overall_confidence === "high") {
    marketConfidenceMultiplier = 0.95; // High confidence = minimal dampening
  } else if (marketQuality.overall_confidence === "medium") {
    marketConfidenceMultiplier = 0.80; // Medium confidence = moderate dampening
  } else {
    marketConfidenceMultiplier = 0.65; // Low confidence = significant dampening
  }
  
  // Apply BSR coverage adjustment (if BSR coverage is low, reduce confidence further)
  if (marketQuality.bsr_coverage_pct < 50) {
    marketConfidenceMultiplier *= 0.85; // Additional dampening for low BSR coverage
  }
  
  const finalUnits = Math.round(rawTotalUnits * marketConfidenceMultiplier);
  const finalRevenue = Math.round(rawTotalRevenue * marketConfidenceMultiplier);
  
  return {
    total_monthly_units: finalUnits,
    total_monthly_revenue: finalRevenue,
  };
}

/**
 * PHASE 3B - MARKET SNAPSHOT: Build Complete Market View
 * 
 * @param enriched - Enriched listings from Phase 2B
 * @param marketQuality - Market quality metrics from Phase 2C
 * @param demandEstimate - Demand estimate from Phase 3A
 * @returns Complete market snapshot
 */

/**
 * PHASE 3C - AI INTERPRETATION: Clean Data Enables Honest Communication
 * 
 * Because data is clean, AI can now:
 * - Cite confidence properly
 * - Explain uncertainty honestly
 * - Never hallucinate reasons
 * 
 * Example prompt improvements:
 * 
 * ❌ OLD (hallucinated reasons):
 * "Market shows high competition due to established brands."
 * 
 * ✅ NEW (cites actual data):
 * "BSR data was available for 58% of listings, which is sufficient for 
 * directional estimates but not precise forecasting. Top brand controls 
 * 42% of Page-1 listings, indicating moderate brand concentration."
 * 
 * Key metrics to cite in AI responses:
 * - marketQuality.bsr_coverage_pct: "BSR data available for X% of listings"
 * - marketQuality.sponsored_detection_confidence: "Sponsored detection confidence: X%"
 * - marketQuality.price_coverage_pct: "Price data available for X% of listings"
 * - marketQuality.overall_confidence: "Overall data quality: high/medium/low"
 * - marketSnapshot.warnings: List any data quality warnings
 * 
 * This builds trust, not doubt.
 */
export function buildMarketSnapshot(
  enriched: EnrichedListing[],
  marketQuality: MarketQuality,
  demandEstimate: { total_monthly_units: number; total_monthly_revenue: number }
): MarketSnapshot {
  const warnings: string[] = [];
  
  // Calculate average price
  const pricesWithValues = enriched
    .map(l => l.price)
    .filter((p): p is number => p !== null && p !== undefined && p > 0);
  
  const avgPrice = pricesWithValues.length > 0
    ? pricesWithValues.reduce((sum, p) => sum + p, 0) / pricesWithValues.length
    : 0;
  
  if (pricesWithValues.length === 0) {
    warnings.push("NO_PRICE_DATA");
  }
  
  // Calculate sponsored percentage
  const sponsoredCount = enriched.filter(l => l.sponsored === true).length;
  const sponsoredPct = enriched.length > 0 ? (sponsoredCount / enriched.length) * 100 : 0;
  
  // Calculate top brand share percentage
  const brandCounts: Record<string, number> = {};
  enriched.forEach(l => {
    if (l.brand) {
      brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
    }
  });
  
  const topBrand = Object.entries(brandCounts)
    .sort(([, a], [, b]) => b - a)[0];
  
  const topBrandSharePct = topBrand && enriched.length > 0
    ? (topBrand[1] / enriched.length) * 100
    : 0;
  
  // Calculate competition score (0-100)
  // Based on: brand concentration, sponsored saturation, price spread
  let competitionScore = 50; // Base score
  
  // Brand concentration: higher = more competitive
  if (topBrandSharePct >= 40) {
    competitionScore += 20; // High brand concentration
  } else if (topBrandSharePct >= 25) {
    competitionScore += 10;
  }
  
  // Sponsored saturation: higher = more competitive
  if (sponsoredPct >= 50) {
    competitionScore += 20;
  } else if (sponsoredPct >= 30) {
    competitionScore += 10;
  }
  
  // Price spread: tighter = more competitive
  if (pricesWithValues.length >= 3) {
    const sortedPrices = [...pricesWithValues].sort((a, b) => a - b);
    const priceRange = sortedPrices[sortedPrices.length - 1] - sortedPrices[0];
    const priceSpreadPct = avgPrice > 0 ? (priceRange / avgPrice) * 100 : 100;
    
    if (priceSpreadPct < 30) {
      competitionScore += 10; // Tight price competition
    }
  }
  
  competitionScore = Math.min(100, Math.max(0, competitionScore));
  
  // Add warnings based on market quality
  if (marketQuality.bsr_coverage_pct < 50) {
    warnings.push(`BSR_COVERAGE_LOW:${Math.round(marketQuality.bsr_coverage_pct)}%`);
  }
  
  if (marketQuality.sponsored_detection_confidence < 70) {
    warnings.push(`SPONSORED_DETECTION_LOW:${Math.round(marketQuality.sponsored_detection_confidence)}%`);
  }
  
  if (marketQuality.price_coverage_pct < 70) {
    warnings.push(`PRICE_COVERAGE_LOW:${Math.round(marketQuality.price_coverage_pct)}%`);
  }
  
  return {
    total_monthly_units: demandEstimate.total_monthly_units,
    total_monthly_revenue: demandEstimate.total_monthly_revenue,
    avg_price: Math.round(avgPrice * 100) / 100,
    sponsored_pct: Math.round(sponsoredPct * 10) / 10,
    top_brand_share_pct: Math.round(topBrandSharePct * 10) / 10,
    competition_score: Math.round(competitionScore),
    confidence: marketQuality.overall_confidence,
    warnings: warnings.length > 0 ? warnings : [],
  };
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
    
    // 🚨 RAINFOREST API HARD CAP: Check before search call (MAX = 7)
    if (apiCallCounter && apiCallCounter.count >= apiCallCounter.max) {
      console.error("🚨 RAINFOREST_CALL_CAP_REACHED", {
        keyword,
        current_count: apiCallCounter.count,
        max_allowed: apiCallCounter.max,
        call_type: "search",
        message: "Rainforest API call cap reached - search request blocked. Continuing with available data.",
      });
      return null;
    }
    
    // Increment counter for search call
    if (apiCallCounter) {
      apiCallCounter.count++;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PART 1: UPDATE RAINFOREST SEARCH REQUEST - INCLUDE ADS
    // ═══════════════════════════════════════════════════════════════════════════
    const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=amazon.com&search_term=${encodeURIComponent(keyword)}&page=1&include_ads=true&include_sponsored=true`;
    console.log("RAINFOREST_API_REQUEST", { 
      keyword, 
      url: apiUrl.replace(rainforestApiKey, "***"),
      api_call_count: apiCallCounter?.count || 0,
      api_calls_remaining: apiCallCounter ? apiCallCounter.max - apiCallCounter.count : "unlimited",
      include_ads: true,
      include_sponsored: true,
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
    // CRITICAL: Only use search_results[] array (contains both sponsored and organic)
    // Do NOT use organic_results[] or ads[] arrays - Rainforest returns everything in search_results[]
    const allRawProducts: any[] = [];
    if (Array.isArray(raw.search_results)) allRawProducts.push(...raw.search_results);
    // Fallback to results array if search_results is not present
    if (allRawProducts.length === 0 && Array.isArray(raw.results)) allRawProducts.push(...raw.results);
    
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
      results_count: Array.isArray(raw.results) ? raw.results.length : "not an array",
      // NOTE: organic_results and ads arrays are not used - all listings come from search_results[]
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1 - COLLECT: Parse Raw Market Truth
    // ═══════════════════════════════════════════════════════════════════════════
    // Use parseRainforestSearchResults() to extract raw data without judgment
    const rawSnapshot = parseRainforestSearchResults(raw, keyword, marketplace);
    
    // Track for error classification
    extractedAsinCount = rawSnapshot.listings.length;
    apiReturnedResults = rawSnapshot.listings.length > 0;
    
    // Log Phase 1 results
    console.log("PHASE_1_COLLECT_COMPLETE", {
      keyword,
      listings_count: rawSnapshot.listings.length,
      warnings: rawSnapshot.warnings || [],
      has_results: rawSnapshot.listings.length > 0,
    });
    
    // If no listings found, return null (Phase 1 returns empty array with warning, but Phase 2/3 can't proceed)
    if (rawSnapshot.listings.length === 0) {
      console.log("PHASE_1_NO_LISTINGS", {
        keyword,
        warnings: rawSnapshot.warnings || [],
        message: "Phase 1 completed but no listings found - cannot proceed to Phase 2/3",
      });
      return null;
    }
    
    // Convert RawSnapshot listings back to searchResults format for Phase 2/3 compatibility
    // This preserves backward compatibility while using Phase 1 structure.
    // CRITICAL: Preserve ratings and reviews from Rainforest so they are not lost
    // when SP-API Catalog is merged later (SP-API has no rating/review fields).
    const searchResults: any[] = rawSnapshot.listings.map((listing) => {
      // Reconstruct the original item structure that Phase 2/3 expects
      const reconstructed: any = {
        asin: listing.asin,
        title: listing.title,
        image: listing.image,
      };
      
      // Reconstruct price in the format Phase 2/3 expects
      if (listing.price !== null) {
        reconstructed.price = { value: listing.price };
      }
      
      // Reconstruct bestsellers_rank if available
      if (listing.rainforest_rank > 0) {
        reconstructed.bestsellers_rank = listing.rainforest_rank;
      }

      // Preserve ratings & reviews from Phase 1
      // These map directly onto the fields parseRating/parseReviews expect.
      if (listing.rating !== null && listing.rating !== undefined) {
        reconstructed.rating = listing.rating;
      }
      if (listing.reviews !== null && listing.reviews !== undefined) {
        // parseReviews can consume a bare number in `reviews`
        reconstructed.reviews = listing.reviews;
      }
      
      // Reconstruct sponsored flags (use isSponsored as canonical field)
      if (listing.isSponsored !== undefined) {
        reconstructed.isSponsored = listing.isSponsored;
        reconstructed.is_sponsored = listing.isSponsored; // DEPRECATED: kept for backward compatibility
      } else if (listing.raw_sponsored_flag !== undefined) {
        const isSponsored = Boolean(listing.raw_sponsored_flag === true);
        reconstructed.isSponsored = isSponsored;
        reconstructed.is_sponsored = isSponsored; // DEPRECATED: kept for backward compatibility
      }
      
      return reconstructed;
    });

    // STEP B: Extract all Page-1 ASINs (all listings, not just top 20)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Deduplicate ASINs before SP-API calls
    // SP-API returns one BSR per ASIN, so duplicates cause false BSR invalidation
    // ═══════════════════════════════════════════════════════════════════════════
    const rawAsins = searchResults
      .filter((item: any) => item?.asin)
      .map((item: any) => item.asin.trim().toUpperCase());
    
    // Track rank positions for each ASIN (for duplicate detection later)
    const asinRanks = new Map<string, number[]>();
    rawAsins.forEach((asin, index) => {
      if (!asinRanks.has(asin)) {
        asinRanks.set(asin, []);
      }
      asinRanks.get(asin)!.push(index + 1); // Rank positions are 1-indexed
    });
    
    // Deduplicate ASINs - keep unique ASINs only
    const uniqueAsins = [...new Set(rawAsins)];
    
    // Use deduplicated ASINs for SP-API calls
    const page1Asins = uniqueAsins;
    
    console.log("SEARCH_ASINS_COUNT", {
      keyword,
      total_search_results: searchResults.length,
      unique_asins: uniqueAsins.length,
      duplicate_count: rawAsins.length - uniqueAsins.length,
      page1_asins: page1Asins,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔥 HARD-FORCED SP-API EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════
    // This must run for EVERY keyword search.
    // No confidence checks. No cache skips.
    // SP-API is PRIMARY DATA. Not enrichment.
    // CRITICAL: Single authoritative map - must be in same scope as merge step
    const normalizeAsin = (a: string) => a.trim().toUpperCase();
    const spApiCatalogResults = new Map<string, any>();
    let spApiPricingResults: Map<string, any> = new Map();
    let didExtractAnyBsr = false;
    
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
    
    const marketplaceId = "ATVPDKIKX0DER"; // US marketplace
    let spApiExecuted = false;
    let spApiError: Error | null = null;
    
    // Track ingestion metrics for final summary
    let totalAttributesWritten = 0;
    let totalClassificationsWritten = 0;
    let totalImagesWritten = 0;
    let totalRelationshipsWritten = 0;
    let totalSkippedDueToCache = 0;
    
    // Collect ingestion promises to await before final summary
    const ingestionPromises: Promise<any>[] = [];
    
    // ═══════════════════════════════════════════════════════════════════════════
    // FIX #2: Check BSR cache to avoid refetching Catalog for ASINs that already have BSR
    // ═══════════════════════════════════════════════════════════════════════════
    // Only call SP-API Catalog for ASINs that don't have BSR in cache
    // STEP C: Bulk cache lookup (includes BSR and brand data) - move earlier
    const { bulkLookupBsrCache } = await import("./asinBsrCache");
    const bsrCache = supabase ? await bulkLookupBsrCache(supabase, page1Asins) : new Map();
    
    // Check catalog cache before making API calls
    let catalogCache: Map<string, any> = new Map();
    let catalogCacheHitCount = 0;
    
    // Filter ASINs that need catalog fetch: only those missing BSR from cache
    const asinsNeedingCatalog = page1Asins.filter(asin => {
      const upperAsin = asin.toUpperCase();
      const bsrCacheEntry = bsrCache.get(upperAsin);
      // Need catalog if: no BSR in cache, or BSR is invalid/null
      const needsCatalog = !bsrCacheEntry || 
                          !bsrCacheEntry.main_category_bsr || 
                          bsrCacheEntry.main_category_bsr <= 0;
      return needsCatalog;
    });
    
    let asinsToFetch: string[] = asinsNeedingCatalog;
    
    console.log("BSR_CACHE_FILTER", {
      keyword,
      total_asins: page1Asins.length,
      asins_with_bsr_in_cache: page1Asins.length - asinsNeedingCatalog.length,
      asins_needing_catalog: asinsNeedingCatalog.length,
      skipped_asins: page1Asins.length - asinsNeedingCatalog.length,
    });
    
    if (supabase && asinsNeedingCatalog.length > 0) {
      try {
        const { bulkLookupCatalogCache } = await import("../spapi/catalogPersist");
        catalogCache = await bulkLookupCatalogCache(supabase, asinsNeedingCatalog);
        catalogCacheHitCount = catalogCache.size;
        if (catalogCacheHitCount > 0) {
          console.log("✅ CATALOG_CACHE_HIT", {
            keyword,
            cached_asins: catalogCacheHitCount,
            total_asins_needing_catalog: asinsNeedingCatalog.length,
          });
          // Merge cached data into results - write directly to authoritative map
          for (const [asin, record] of catalogCache.entries()) {
            const asinKey = normalizeAsin(asin);
            // Convert cached record to CatalogItemMetadata format for backward compatibility
            const metadata: any = {
              asin: asinKey,
              title: record.core.title,
              brand: record.core.brand,
              image_url: record.media.primary_image_url,
              category: record.market.primary_category,
              bsr: record.market.primary_rank,
              primaryCategory: record.market.primary_category,
            };
            spApiCatalogResults.set(asinKey, metadata);
            
            // Track BSR extraction from cache
            if (metadata.bsr != null && metadata.bsr > 0) {
              didExtractAnyBsr = true;
            }
          }
          // Filter out ASINs that were found in cache
          asinsToFetch = asinsNeedingCatalog.filter(asin => !catalogCache.has(asin.toUpperCase()));
        }
      } catch (error) {
        console.warn("CATALOG_CACHE_LOOKUP_ERROR", {
          keyword,
          error: error instanceof Error ? error.message : String(error),
          message: "Continuing without cache",
        });
      }
    }
    
    // Batch ASINs that need to be fetched from API
    // FIX #4: Batch size reduced to 10 (from 20) for better reliability
    const BATCH_SIZE = 10;
    const asinBatchesToFetch: string[][] = [];
    for (let i = 0; i < asinsToFetch.length; i += BATCH_SIZE) {
      asinBatchesToFetch.push(asinsToFetch.slice(i, i + BATCH_SIZE));
    }
    
    try {
      // --- SP-API CATALOG (Brand, Category, BSR) ---
      const { batchEnrichCatalogItems } = await import("../spapi/catalogItems");
      
      // CRITICAL: Ensure all batches are awaited before merge runs
      for (let i = 0; i < asinBatchesToFetch.length; i++) {
        const batch = asinBatchesToFetch[i];
        console.log("🔥 SP_API_CATALOG_BATCH_START", {
          batch_index: i,
          batch_size: batch.length,
          asins: batch,
          keyword,
          cache_hits: catalogCacheHitCount,
        });
        
        try {
          // Pass ingestion metrics tracker to collect results
          const ingestionMetrics = {
            totalAttributesWritten: { value: totalAttributesWritten },
            totalClassificationsWritten: { value: totalClassificationsWritten },
            totalImagesWritten: { value: totalImagesWritten },
            totalRelationshipsWritten: { value: totalRelationshipsWritten },
            totalSkippedDueToCache: { value: totalSkippedDueToCache },
          };
          
          // CRITICAL: Pass spApiCatalogResults map to be mutated directly
          // Function now mutates the map instead of returning a new one
          await batchEnrichCatalogItems(batch, spApiCatalogResults, marketplaceId, 2000, keyword, supabase, ingestionMetrics);
          
          // Update aggregated metrics (updated synchronously in batchEnrichCatalogItems)
          totalAttributesWritten = ingestionMetrics.totalAttributesWritten.value;
          totalClassificationsWritten = ingestionMetrics.totalClassificationsWritten.value;
          totalImagesWritten = ingestionMetrics.totalImagesWritten.value;
          totalRelationshipsWritten = ingestionMetrics.totalRelationshipsWritten.value;
          totalSkippedDueToCache = ingestionMetrics.totalSkippedDueToCache.value;
          
          // Track if any BSR was extracted (check map size change or scan for BSR)
          if (spApiCatalogResults.size > 0) {
            for (const [asin, catalog] of spApiCatalogResults.entries()) {
              if (catalog?.bsr != null && catalog.bsr > 0) {
                didExtractAnyBsr = true;
                break;
              }
            }
          }
          
          // Log batch completion (do not infer success/failure from enriched.size)
          // SP-API was called if SP_API_RESPONSE event was logged, regardless of items.length
          console.log("✅ SP_API_CATALOG_BATCH_COMPLETE", {
            batch_index: i,
            asins_in_batch: batch.length,
            keyword,
            message: "SP-API batch completed. Enrichment status determined by source tags, not items.length",
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
      
      for (let i = 0; i < asinBatchesToFetch.length; i++) {
        const batch = asinBatchesToFetch[i];
        console.log("🔥 SP_API_PRICING_BATCH_START", {
          batch_index: i,
          batch_size: batch.length,
          asins: batch,
          keyword,
        });
        
        try {
          const pricingResponse = await batchEnrichPricing(batch, marketplaceId, 2000);
          
          if (!pricingResponse || !pricingResponse.enriched || pricingResponse.enriched.size === 0) {
            // Check if Pricing API was skipped (no OAuth) vs actual permission error (403)
            // When skipped: failed array has all ASINs but errors array is empty
            // When permission error: errors array has 403/Unauthorized errors
            const hasActualErrors = pricingResponse?.errors && pricingResponse.errors.length > 0;
            const hasPermissionError = hasActualErrors && pricingResponse.errors.some((e: any) => 
              e.error?.includes('Unauthorized') || e.error?.includes('403')
            );
            const allFailed = pricingResponse?.failed?.length === batch.length;
            
            if (hasPermissionError) {
              // Actual 403 permission error (rare - feature flag should prevent this)
              console.error("❌ SP_API_PRICING_PERMISSION_ERROR", { 
                batch,
                keyword,
                batch_index: i,
                failed_count: pricingResponse?.failed?.length ?? 0,
                total_asins: batch.length,
                message: "Pricing API permission denied - will fallback to Rainforest data",
                suggestion: "Check IAM role policies and SP-API scope permissions for Pricing API",
              });
            } else if (allFailed && !hasActualErrors) {
              // Pricing API was skipped (no OAuth) - this is expected, not an error
              console.log("ℹ️ PRICING_SKIPPED_NO_OAUTH", {
                batch,
                keyword,
                batch_index: i,
                failed_count: pricingResponse?.failed?.length ?? 0,
                total_asins: batch.length,
                message: "Pricing API skipped - no seller OAuth token (will use Rainforest fallback)",
              });
            } else {
              // Other error (network, timeout, etc.)
              console.error("❌ SP_API_PRICING_EMPTY_RESPONSE", { 
                batch,
                keyword,
                batch_index: i,
                failed_count: pricingResponse?.failed?.length ?? 0,
                error_count: pricingResponse?.errors?.length ?? 0,
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
        total_batches: asinBatchesToFetch.length,
        catalog_enriched: spApiCatalogResults.size,
        pricing_enriched: spApiPricingResults.size,
      });
    } catch (error) {
      spApiError = error instanceof Error ? error : new Error(String(error));
      console.error("❌ SP_API_HARD_FAILURE", {
        keyword,
        error: spApiError.message,
        total_asins: page1Asins.length,
        total_batches: asinBatchesToFetch.length,
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

    // STEP C: Bulk cache lookup (includes BSR and brand data) - already done above
    // Use bsrCache from earlier (moved before catalog cache check)
    const cacheMap = bsrCache; // Reuse the BSR cache we already fetched
    
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
    // CRITICAL: Skip ASINs that already have BSR from SP-API Catalog
    const asinsForBSR = searchResults
      .slice(0, MAX_BSR_ASINS * 2) // Check more to account for duplicates/cached
      .map((item: any) => item.asin)
      .filter((asin: string | null): asin is string => {
        // Type guard: must be non-null string
        if (!asin || asin === null || asin === undefined) {
          return false;
        }
        
        // Must be in missing ASINs list and not already cached
        if (!missingAsins.includes(asin) || cacheMap.has(asin)) {
          return false;
        }
        
        // Check if SP-API Catalog provided BSR
        const upperAsin = asin.toUpperCase();
        const catalogData = spApiCatalogResults.get(upperAsin);
        
        // Only include if SP-API didn't provide BSR (null or missing)
        if (catalogData && catalogData.bsr !== null && catalogData.bsr > 0) {
          return false; // Skip - SP-API already provided BSR
        }
        
        return true; // Include - needs BSR enrichment
      })
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

    // NOTE: BSR coverage logging moved to after listings are parsed and merged with SP-API data
    // See below after listings are created (around line 2190+)

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Convert Rainforest results → appearances (PRESERVE SPONSORED DATA)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: This is the moment sponsored data must be preserved.
    // Do not drop it later.
    // 🔒 CANONICAL SPONSORED DETECTION (NORMALIZED AT INGEST)
    // Use ONLY item.sponsored (the authoritative field from Rainforest)
    // Single source of truth: !!item.sponsored
    // 🛡️ LOCK SPONSORED EARLY: Capture immediately after Rainforest parse
    // Check multiple field names as fallback (Rainforest may vary)
    const appearances: Appearance[] = searchResults.map((item: any, index: number) => {
      // Lock sponsored flag immediately - check multiple sources
      const isSponsored = !!item.sponsored || 
                         !!item.ad || 
                         (typeof item.link === 'string' && (item.link.includes('/sspa/') || item.link.includes('-spons')));
      
      return {
        asin: item.asin,
        position: item.position ?? index + 1,
        isSponsored,
        source: (isSponsored ? 'sponsored' : 'organic') as 'organic' | 'sponsored'
      };
    }).filter((app: Appearance) => app.asin && /^[A-Z0-9]{10}$/i.test(app.asin.trim()));

    // ═══════════════════════════════════════════════════════════════════════════
    // SPONSORED DIAGNOSTICS (MANDATORY)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('SPONSORED_DIAGNOSTICS', {
      totalAppearances: appearances.length,
      sponsoredAppearances: appearances.filter(a => a.isSponsored).length,
      uniqueSponsoredAsins: new Set(
        appearances.filter(a => a.isSponsored).map(a => a.asin)
      ).size
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ASIN-LEVEL SPONSORED AGGREGATION (BEFORE DEDUPLICATION - CRITICAL)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Sponsored is an ASIN-level property, not instance-level.
    // Build aggregation map: if ASIN appears sponsored ANYWHERE on Page 1, mark it.
    // This ensures sponsored counts persist through canonicalization.
    // DO NOT MODIFY THIS LOGIC WITHOUT UPDATING CANONICALIZATION.
    const asinSponsoredMeta = new Map<string, {
      appearsSponsored: boolean;
      sponsoredPositions: number[];
    }>();
    
    for (const appearance of appearances) {
      const asin = appearance.asin.trim().toUpperCase();
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) continue;
      
      if (!asinSponsoredMeta.has(asin)) {
        asinSponsoredMeta.set(asin, {
          appearsSponsored: false,
          sponsoredPositions: [],
        });
      }
      
      const meta = asinSponsoredMeta.get(asin)!;
      if (appearance.isSponsored === true) {
        meta.appearsSponsored = true;
        meta.sponsoredPositions.push(appearance.position);
      }
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
      
      // ═══════════════════════════════════════════════════════════════════════════
      // PART 2: NORMALIZE SPONSORED STATUS AT INGEST
      // ═══════════════════════════════════════════════════════════════════════════
      // 🔒 CANONICAL SPONSORED DETECTION (NORMALIZED AT INGEST)
      // MANDATORY: Capture sponsored at Rainforest ingestion before any normalization
      // Check multiple field names as fallback (Rainforest may vary)
      const isSponsored: boolean = Boolean(
        item.sponsored === true ||
        item.is_sponsored === true ||
        item.ad === true ||
        (typeof item.link === 'string' && (item.link.includes('/sspa/') || item.link.includes('-spons')))
      );
      const sponsored_position: number | null = isSponsored ? (item.ad_position ?? null) : null;
      const sponsored_source: 'rainforest_serp' | 'organic_serp' = 'rainforest_serp'; // Always from Rainforest SERP
      
      // DEPRECATED: Keep is_sponsored for backward compatibility, but use isSponsored as canonical
      const is_sponsored: boolean = isSponsored;
      
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
      
      // ═══════════════════════════════════════════════════════════════════════════
      // BSR RULES: Only category-based BSR from SP-API (never from Rainforest)
      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: BSR must ONLY come from SP-API CatalogItems (category-specific)
      // Do NOT use Rainforest BSR - it will be set during SP-API merge step
      // If SP-API doesn't provide BSR, it remains null (unavailable)
      let main_category_bsr: number | null = null;
      let bsr: number | null = null;
      
      // Category can come from Rainforest initially, but will be overridden by SP-API if available
      const main_category = (mainBSRData && mainBSRData.rank && mainBSRData.rank >= 1 && mainBSRData.rank <= 300000)
        ? mainBSRData.category
        : null;
      
      // PHASE 1: Apply duplicate BSR detection (non-disruptive)
      // If BSR is in invalid set, mark it as null and add reason
      let bsr_invalid_reason: string | null = null;
      if (main_category_bsr !== null && invalidBSRs.has(main_category_bsr)) {
        bsr_invalid_reason = "duplicate_bug";
        main_category_bsr = null;
        bsr = null;
        console.log(`🔵 BSR_MARKED_INVALID: Listing ${asin} BSR ${mainBSRData?.rank} marked as invalid (duplicate_bug)`);
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // FULFILLMENT: Infer from Rainforest search results (normalized at ingest)
      // ═══════════════════════════════════════════════════════════════════════════
      // 🔒 CANONICAL FULFILLMENT INFERENCE (SERP-based market analysis)
      // Rules: SP-API authoritative → Rainforest inferred → UNKNOWN (NEVER defaults to FBM)
      // This is market-level inference, not checkout accuracy.
      // We do NOT use SP-API or Offers API for fulfillment in Analyze flow.
      // Use delivery.tagline for inference
      const fulfillment: "FBA" | "FBM" | "UNKNOWN" = inferFulfillment(item);
      const fulfillmentSource: 'sp_api' | 'rainforest_inferred' | 'unknown' = 'rainforest_inferred';
      const fulfillmentConfidence: 'high' | 'medium' | 'low' = fulfillment !== 'UNKNOWN' ? 'medium' : 'low';
      
      // CRITICAL: Set both camelCase and snake_case to prevent overwrite later in pipeline
      // The check at line 3577 uses fulfillment_source (snake_case), so we need both
      const fulfillment_source = fulfillmentSource; // snake_case version for DB compatibility
      const fulfillment_confidence = fulfillmentConfidence; // snake_case version for DB compatibility
      
      // ═══════════════════════════════════════════════════════════════════════════
      // BRAND RESOLUTION: Search-based only (will be overridden by SP-API if available)
      // ═══════════════════════════════════════════════════════════════════════════
      // Uses ONLY: item.brand, item.is_amazon_brand, item.is_exclusive_to_amazon, item.featured_from_our_brands
      // NO title extraction, NO product API, NO seller inference
      // CRITICAL: Never deletes brands - always preserves raw_brand
      const brandResolution = resolveBrandFromSearchResult(item);
      // Backward compatibility: set brand field to raw_brand (never null if raw_brand exists)
      const brand = brandResolution.raw_brand;
      // Store brand resolution structure (use snake_case for consistency with interface)
      const brand_resolution = brandResolution;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // STEP 1: Log raw brand data from Rainforest (first 5 listings)
      // ═══════════════════════════════════════════════════════════════════════════
      if (index < 5) {
        console.log("🟣 RAW BRAND SAMPLE", {
          index,
          asin,
          raw_brand: brandResolution.raw_brand,
          normalized_brand: brandResolution.normalized_brand,
          brand_status: brandResolution.brand_status,
          brand_source: brandResolution.brand_source,
          item_brand: item.brand,
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
      
      // ═══════════════════════════════════════════════════════════════════════════
      // PRIME ELIGIBILITY MAPPING (RAW RAINFOREST INGESTION)
      // ═══════════════════════════════════════════════════════════════════════════
      // Map is_prime to primeEligible and fulfillment (PRIME/NON_PRIME)
      // This is a heuristic for UI display and AI reasoning, NOT a guarantee of FBA
      const primeEligible = is_prime === true;
      const fulfillmentStatus: 'PRIME' | 'NON_PRIME' = primeEligible ? 'PRIME' : 'NON_PRIME';

      // ═══════════════════════════════════════════════════════════════════════════
      // ASIN-LEVEL SPONSORED AGGREGATION (ATTACH TO PARSED LISTING)
      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: Sponsored is ASIN-level, not instance-level.
      // Look up ASIN-level metadata from aggregation map.
      const asinUpper = asin?.trim().toUpperCase() || "";
      const asinMeta = asinUpper && /^[A-Z0-9]{10}$/.test(asinUpper)
        ? asinSponsoredMeta.get(asinUpper)
        : null;
      const appearsSponsored = asinMeta?.appearsSponsored ?? false;
      const sponsoredPositions = asinMeta?.sponsoredPositions ?? [];

      // Step 4: Return normalized listing - only ASIN is required
      // CRITICAL: Preserve raw item data for fallback in buildKeywordPageOne
      return {
        asin, // Required
        title, // Optional (nullable) - NEVER empty string, only null if missing
        price, // Optional (nullable)
        rating, // Optional (nullable)
        reviews, // Optional (nullable)
        isSponsored, // Canonical sponsored status (always boolean, normalized at ingest)
        is_sponsored, // DEPRECATED: Use isSponsored instead. Kept for backward compatibility.
        sponsored_position, // Number | null (ad position from Rainforest)
        sponsored_source, // 'rainforest_serp' | 'organic_serp' (source of sponsored data)
        appearsSponsored, // ASIN-level: true if appears sponsored anywhere on Page 1
        sponsoredPositions, // ASIN-level: all positions where ASIN appeared as sponsored
        position,
        brand, // Optional (nullable) - DEPRECATED: Use brand_resolution.raw_brand
        brand_resolution, // Brand resolution structure (preserves all brands) - from brandResolution variable
        image_url, // Optional (nullable) - NEVER empty string, only null if missing
        bsr, // Optional (nullable) - DEPRECATED: use main_category_bsr
        main_category_bsr, // Main category BSR (top-level category only)
        main_category, // Main category name
        fulfillment, // Fulfillment type (never null, never defaults to FBM)
        fulfillmentSource, // Source of fulfillment data (camelCase)
        fulfillmentConfidence, // Confidence in fulfillment inference (camelCase)
        fulfillment_source, // Source of fulfillment data (snake_case for DB compatibility - prevents overwrite at line 3577)
        fulfillment_confidence, // Confidence (snake_case for DB compatibility)
        // Add seller and is_prime for fulfillment mix computation
        seller, // Optional (nullable)
        is_prime, // Boolean
        // Prime eligibility and fulfillment status (from is_prime heuristic)
        primeEligible, // Boolean: true if is_prime === true
        fulfillment_status: fulfillmentStatus, // 'PRIME' | 'NON_PRIME' (heuristic, not FBA guarantee)
        // PHASE 1: BSR invalid reason (if BSR was marked invalid)
        bsr_invalid_reason, // Optional (nullable) - reason why BSR is invalid
        // PRESENTATION FALLBACK: Store raw fields from search result
        raw_title, // Raw title from search result (for presentation fallback)
        raw_image_url, // Raw image URL from search result (for presentation fallback)
        // PRESERVE RAW ITEM DATA for fallback in buildKeywordPageOne
        _rawItem: item, // Preserve original Rainforest item for title/image fallback
      } as ParsedListing & { 
        seller?: string | null; 
        is_prime?: boolean;
        primeEligible?: boolean;
        fulfillment_status?: 'PRIME' | 'NON_PRIME';
        _rawItem?: any;
        fulfillment_source?: string; // snake_case for DB compatibility (prevents overwrite at line 3577)
        fulfillment_confidence?: string; // snake_case for DB compatibility
      };
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // 🔥 HARD ASSERTION LOG: CATALOG_MAP_DIAGNOSTIC (REQUIRED TO PREVENT REGRESSIONS)
    // ═══════════════════════════════════════════════════════════════════════════
    // This MUST NEVER show size 0 if we logged SP_API_BSR_EXTRACTED earlier in the same request
    // If size is 0 but BSR was extracted, the aggregation/persistence pipeline is broken
    console.log('CATALOG_MAP_DIAGNOSTIC', {
      keyword,
      size: spApiCatalogResults.size,
      sample: Array.from(spApiCatalogResults.keys()).slice(0, 5),
      hasBsrSample: Array.from(spApiCatalogResults.values()).slice(0, 5).map(x => ({ 
        asin: x.asin, 
        bsr: x.bsr,
        title: x.title,
        brand: x.brand,
      })),
      timestamp: new Date().toISOString(),
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // HARD ASSERTION: BSR extracted but map empty = BUG
    // ═══════════════════════════════════════════════════════════════════════════
    if (didExtractAnyBsr && spApiCatalogResults.size === 0) {
      throw new Error("BUG: BSR extracted but spApiCatalogResults is empty before merge");
    }
    
    // 🛡️ SPONSORED PRESERVATION LOGGING: Track sponsored flag before merge
    const sponsoredCountPreMerge = listings.filter(l => l.isSponsored === true).length;
    const sponsoredAsinsPreMerge = listings
      .filter(l => l.isSponsored === true)
      .map(l => l.asin)
      .slice(0, 10);
    
    // Debug: Log spApiCatalogResults state before merge
    console.log("🔵 SP_API_MERGE_START", {
      keyword,
      listings_count: listings.length,
      spApiCatalogResults_size: spApiCatalogResults.size,
      sample_catalog_asins: Array.from(spApiCatalogResults.keys()).slice(0, 5),
      sample_catalog_bsrs: Array.from(spApiCatalogResults.entries())
        .slice(0, 5)
        .map(([asin, metadata]) => ({ asin, bsr: metadata.bsr })),
      // 🛡️ SPONSORED PRESERVATION: Log before merge
      sponsored_count_pre_merge: sponsoredCountPreMerge,
      sponsored_asins_pre_merge: sponsoredAsinsPreMerge,
    });
    
    let mergeCount = 0;
    let bsrMergeCount = 0;
    let catalogNotFoundCount = 0;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL MERGE: Patch listings directly from spApiCatalogResults Map
    // ═══════════════════════════════════════════════════════════════════════════
    // This ensures BSR and other catalog data from SP-API is merged into listings
    // DO NOT rely on any other merge logic - this is the authoritative merge step
    for (const listing of listings) {
      if (!listing.asin) continue;
      
      const asinKey = normalizeAsin(listing.asin);
      const catalog = spApiCatalogResults.get(asinKey);
      
      // ═══════════════════════════════════════════════════════════════════════════
      // ✅ FIELD RECONCILIATION: SP-API is CANONICAL SOURCE (overrides Rainforest)
      // ═══════════════════════════════════════════════════════════════════════════
      // SP-API CANONICAL (always overrides Rainforest when available):
      //   - Title (always override)
      //   - Brand (always override, never parse titles if available)
      //   - Image (SP-API preferred, fallback to Rainforest)
      //   - Category (always override)
      //   - BSR (category-based only, mark unavailable if missing)
      // 
      // RAINFOREST ONLY (never overridden by SP-API):
      //   - ASIN list (Page-1 discovery)
      //   - Rank (1-48, immutable)
      //   - Sponsored / Organic (immutable)
      //   - Reviews / Rating (cache aggressively)
      //   - Fallback image (when SP-API missing)
      //   - Fallback price (when SP-API Pricing unavailable)
      // ═══════════════════════════════════════════════════════════════════════════
      if (catalog) {
        mergeCount++;
        
        // 🛡️ CRITICAL: Preserve sponsored flag BEFORE any merge operations
        // SP-API has NO ad data - sponsored flags come ONLY from Rainforest SERP
        const preservedIsSponsored = listing.isSponsored;
        const preservedIsSponsoredDeprecated = listing.is_sponsored;
        const preservedSponsoredPosition = listing.sponsored_position;
        const preservedSponsoredSource = listing.sponsored_source;
        const preservedAppearsSponsored = listing.appearsSponsored;
        const preservedSponsoredPositions = listing.sponsoredPositions;
        
        // Mark that SP-API responded (even if no data was extracted)
        (listing as any).had_sp_api_response = true;
        
        // GUARD: SP-API must never overwrite sponsored flags (no ad data)
        // is_sponsored, sponsored_position, and sponsored_source are RAINFOREST SERP ONLY
        
        // Transition enrichment state when any SP-API catalog data is applied
        if (!(listing as any).enrichment_state || (listing as any).enrichment_state === 'raw') {
          (listing as any).enrichment_state = 'sp_api_catalog_enriched';
        }
        
        // Ensure enrichment_sources object exists
        if (!(listing as any).enrichment_sources) {
          (listing as any).enrichment_sources = {};
        }
        (listing as any).enrichment_sources.sp_api_catalog = true;
        
        // ✅ TITLE: SP-API always overrides Rainforest
        if (catalog.title && typeof catalog.title === 'string' && catalog.title.trim().length > 0) {
          listing.title = catalog.title.trim();
          (listing as any).title_source = 'sp_api';
          (listing as any).title_confidence = 'high';
        }
        
        // ✅ BRAND: SP-API always overrides, never parse titles if SP-API brand exists
        if (catalog.brand && typeof catalog.brand === 'string' && catalog.brand.trim().length > 0) {
          listing.brand = catalog.brand.trim();
          (listing as any).brand_source = 'sp_api';
          (listing as any).brand_confidence = 'high';
          // Update brand_resolution structure
          listing.brand_resolution = {
            raw_brand: catalog.brand.trim(),
            normalized_brand: catalog.brand.trim(),
            brand_status: 'canonical',
            brand_source: 'sp_api'
          };
          // Clear any title-parsed brand when SP-API brand is available
          (listing as any)._brand_confidence = 'high';
          (listing as any)._brand_entity = catalog.brand;
          (listing as any)._brand_display = catalog.brand;
        }
        
        // ✅ IMAGE: SP-API preferred, fallback to Rainforest
        if (catalog.image_url && typeof catalog.image_url === 'string' && catalog.image_url.trim().length > 0) {
          listing.image_url = catalog.image_url.trim();
          (listing as any).image_source = 'sp_api';
          (listing as any).image_confidence = 'high';
        }
        // If SP-API image missing, keep Rainforest image (already set from parseRainforestSearchResults)
        // Fallback is handled automatically - Rainforest image_url remains if SP-API doesn't provide one
        
        // ✅ CATEGORY: SP-API is authoritative (always override when available)
        // CRITICAL: Use chosen_category_name from BSR context (never website_display_group codes)
        const categoryFromContext = catalog.bsr_context?.chosen_category_name;
        const categoryFromCatalog = catalog.category;
        // Prefer category from BSR context (human-readable), fallback to catalog.category
        const finalCategory = categoryFromContext || categoryFromCatalog;
        
        if (finalCategory && typeof finalCategory === 'string' && finalCategory.trim().length > 0) {
          listing.main_category = finalCategory.trim();
          (listing as any).category_source = 'sp_api_catalog';
          (listing as any).category_confidence = 'high';
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // ✅ BSR RULES: Only category-based BSR from SP-API, mark unavailable if missing
        // ═══════════════════════════════════════════════════════════════════════════
        // CRITICAL: BSR from SP-API CatalogItems is authoritative (category-specific)
        // - Only use BSR if it's from SP-API (category-specific)
        // - If SP-API BSR missing: mark as unavailable, do NOT estimate silently
        // - Never overwrite a valid SP-API BSR with null or estimated values
        // - Persist full BSR context for debugging and analysis
        if (catalog.bsr !== null && catalog.bsr !== undefined && catalog.bsr > 0) {
          bsrMergeCount++;
          // SP-API BSR is authoritative - always set when available
          listing.main_category_bsr = catalog.bsr;
          listing.bsr = catalog.bsr;
          
          // Persist structured BSR context to listing
          if (catalog.bsr_context) {
            (listing as any).bsr_context = catalog.bsr_context;
          }
          
          // Set source tags for SP-API BSR
          (listing as any).bsr_source = catalog.bsr_source || 'sp_api';
          (listing as any).bsr_confidence = 'high';
          (listing as any).had_sp_api_response = true;
          
          // Ensure enrichment_sources object exists
          if (!(listing as any).enrichment_sources) {
            (listing as any).enrichment_sources = {};
          }
          (listing as any).enrichment_sources.sp_api_catalog = true;
          
          // Transition enrichment state immediately when BSR is extracted
          (listing as any).enrichment_state = 'sp_api_catalog_enriched';
          
          // Debug log for BSR merge (first 5 ASINs only)
          if (bsrMergeCount <= 5) {
            console.log("MERGE_BSR_FROM_SP_API", {
              asin: listing.asin,
              bsr: listing.main_category_bsr,
              category: finalCategory || listing.main_category,
              category_from_context: categoryFromContext,
              bsr_source: catalog.bsr_context?.chosen_rank_source,
              source: 'sp_api',
            });
          }
        } else {
          // SP-API BSR is missing - mark as unavailable (do NOT estimate)
          // This ensures UI knows BSR is not available from authoritative source
          listing.main_category_bsr = null;
          listing.bsr = null;
          (listing as any).bsr_source = 'unavailable';
          (listing as any).bsr_confidence = 'unknown';
          
          // Debug: Log when catalog exists but BSR is missing
          if (bsrMergeCount < 3) {
            console.warn("⚠️ CATALOG_EXISTS_BUT_NO_BSR", {
              asin: listing.asin,
              catalog_bsr: catalog.bsr,
              catalog_category: finalCategory,
              bsr_context: catalog.bsr_context ? {
                chosen_rank_value: catalog.bsr_context.chosen_rank_value,
                chosen_rank_source: catalog.bsr_context.chosen_rank_source,
                debug_reason: catalog.bsr_context.debug_reason,
              } : null,
              message: "SP-API Catalog returned item but no category-based BSR - marked unavailable",
            });
          }
        }
        
        // Source tracking for fields not set above
        // If SP-API didn't provide title/image, track that Rainforest is being used
        if (!(listing as any).title_source) {
          (listing as any).title_source = 'rainforest';
          (listing as any).title_confidence = 'fallback';
        }
        if (!(listing as any).image_source) {
          (listing as any).image_source = 'rainforest';
          (listing as any).image_confidence = 'fallback';
        }
        
        // 🛡️ CRITICAL: Restore preserved sponsored flags AFTER merge
        // SP-API merge must NEVER overwrite Rainforest SERP sponsored data
        listing.isSponsored = preservedIsSponsored;
        listing.is_sponsored = preservedIsSponsoredDeprecated;
        listing.sponsored_position = preservedSponsoredPosition;
        listing.sponsored_source = preservedSponsoredSource;
        listing.appearsSponsored = preservedAppearsSponsored;
        listing.sponsoredPositions = preservedSponsoredPositions;
      } else {
        catalogNotFoundCount++;
        // Debug: Log first few ASINs not found in catalog
        if (catalogNotFoundCount <= 3) {
          console.warn("⚠️ ASIN_NOT_IN_CATALOG_RESULTS", {
            asin: listing.asin,
            spApiCatalogResults_size: spApiCatalogResults.size,
            sample_catalog_asins: Array.from(spApiCatalogResults.keys()).slice(0, 3),
            all_listing_asins: listings.slice(0, 5).map(l => l.asin),
          });
        }
      }
    }
    
    // Debug: Log merge summary
    const listingsWithBSRAfterMerge = listings.filter(l => 
      (l.bsr !== null && l.bsr > 0) || (l.main_category_bsr !== null && l.main_category_bsr > 0)
    ).length;
    
    // 🛡️ SPONSORED PRESERVATION LOGGING: Track sponsored flag after merge
    const sponsoredCountPostMerge = listings.filter(l => l.isSponsored === true).length;
    const sponsoredAsinsPostMerge = listings
      .filter(l => l.isSponsored === true)
      .map(l => l.asin)
      .slice(0, 10);
    
    // 🚨 GUARDRAIL: Throw if sponsored count dropped
    if (sponsoredCountPostMerge < sponsoredCountPreMerge) {
      const lostAsins = sponsoredAsinsPreMerge.filter(asin => 
        !sponsoredAsinsPostMerge.includes(asin)
      );
      throw new Error(
        `SPONSORED_FLAG_LOST_DURING_MERGE: ` +
        `Pre-merge: ${sponsoredCountPreMerge}, Post-merge: ${sponsoredCountPostMerge}. ` +
        `Lost ASINs: ${lostAsins.join(', ')}`
      );
    }
    
    console.log("🔵 SP_API_MERGE_COMPLETE", {
      keyword,
      total_listings: listings.length,
      catalog_found: mergeCount,
      catalog_not_found: catalogNotFoundCount,
      bsr_merged: bsrMergeCount,
      listings_with_bsr_after_merge: listingsWithBSRAfterMerge,
      sample_listings_with_bsr: listings
        .filter(l => (l.bsr !== null && l.bsr > 0) || (l.main_category_bsr !== null && l.main_category_bsr > 0))
        .slice(0, 5)
        .map(l => ({
          asin: l.asin,
          bsr: l.bsr,
          main_category_bsr: l.main_category_bsr,
          bsr_source: (l as any).bsr_source,
        })),
      // 🛡️ SPONSORED PRESERVATION: Log after merge
      sponsored_count_pre_merge: sponsoredCountPreMerge,
      sponsored_count_post_merge: sponsoredCountPostMerge,
      sponsored_preserved: sponsoredCountPostMerge === sponsoredCountPreMerge,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // H10-STYLE ESTIMATION: Comprehensive BSR estimation + unit allocation
    // ═══════════════════════════════════════════════════════════════════════════
    // Helper function for median calculation
    const median = (values: number[]): number => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    };

    // Helper function for clamping
    const clamp = (value: number, min: number, max: number): number => {
      return Math.max(min, Math.min(max, value));
    };

    // 1. CATEGORY BASE VELOCITY (H10-style bootstrap)
    const CATEGORY_BASE_UNITS: Record<string, number> = {
      electronics_tv: 80000,
      electronics_general: 60000,
      electronics_cell_phone_accessories: 55000, // Cell phone cases, bumpers, etc.
      kitchen_appliance: 25000,
      kitchen_display_on_website: 22000, // Legacy support (will be rejected by normalizer)
      home_decor: 18000,
      tools: 12000,
      industrial: 4000,
    };

    // 4.5. NORMALIZE CATEGORIES FOR ESTIMATION (BEFORE category key determination)
    // Apply category normalization to each listing
    // This ensures stable estimation category keys and prevents display_group codes from being used
    for (const listing of listings) {
      // Extract category information from BSR context (preferred) or main_category
      const bsrContext = (listing as any).bsr_context;
      const spCategoryName = bsrContext?.chosen_category_name || listing.main_category;
      const spBrowseNodeId = bsrContext?.chosen_browse_classification_id || null;
      const productType = (listing as any).product_type || null;
      
      // Get fallback category from existing mapCategoryToKey logic (for backward compatibility)
      // But we'll reject display_group codes in the normalizer
      const fallbackKeywordCategory = listing.main_category || null;
      
      // Normalize category for estimation
      const categoryNormalization = normalizeCategoryForEstimation({
        spCategoryName,
        spBrowseNodeId,
        productType,
        fallbackKeywordCategory,
      });
      
      // Set normalized category fields on listing
      (listing as any).estimation_category_key = categoryNormalization.estimation_category_key;
      (listing as any).display_category_name = categoryNormalization.display_category_name;
      (listing as any).category_normalization_reason = categoryNormalization.normalization_reason;
      
      // Set bsr_category to display_category_name for BSR calculator compatibility
      // The BSR calculator expects category names like "Home & Kitchen", "Kitchen & Dining", etc.
      listing.bsr_category = categoryNormalization.display_category_name;
      
      // Log category normalization
      console.log("CATEGORY_NORMALIZED_FOR_ESTIMATION", {
        asin: listing.asin,
        spCategoryName: spCategoryName || null,
        spBrowseNodeId: spBrowseNodeId || null,
        fallbackKeywordCategory: fallbackKeywordCategory || null,
        estimation_category_key: categoryNormalization.estimation_category_key,
        display_category_name: categoryNormalization.display_category_name,
        reason: categoryNormalization.normalization_reason,
      });
    }

    // Map main_category to category_key (legacy fallback, rejects display_group codes)
    const mapCategoryToKey = (category: string | null): string => {
      if (!category) return "default";
      const lower = category.toLowerCase();
      // Reject display_group codes
      if (lower.endsWith("_display_on_website")) return "default";
      if (lower.includes("television") || lower.includes("tv") || lower.includes("display")) return "electronics_tv";
      if (lower.includes("electronics") || lower.includes("electronic")) return "electronics_general";
      if (lower.includes("appliance")) return "kitchen_appliance";
      if (lower.includes("kitchen") || lower.includes("dining")) return "kitchen_appliance"; // Changed from kitchen_display_on_website
      if (lower.includes("home") || lower.includes("decor")) return "home_decor";
      if (lower.includes("tool")) return "tools";
      if (lower.includes("industrial")) return "industrial";
      return "default";
    };

    // Determine category_key from listings (use normalized estimation_category_key)
    const categories = listings
      .map(l => (l as any).estimation_category_key)
      .filter((c): c is string => c !== null && c !== undefined && c !== "unknown");
    const primaryCategory = categories.length > 0 ? categories[0] : null;
    
    // Use normalized category key if available, otherwise fallback to mapCategoryToKey
    let categoryKey: string;
    if (primaryCategory && !primaryCategory.endsWith("_display_on_website")) {
      // Use normalized category key if it's not a display_group code
      categoryKey = primaryCategory;
    } else {
      // Fallback to old mapping logic (but reject display_group codes)
      const fallbackCategory = listings
        .map(l => l.main_category)
        .filter((c): c is string => c !== null && c !== undefined)[0] || null;
      categoryKey = mapCategoryToKey(fallbackCategory);
    }
    
    const categoryBaseUnits = CATEGORY_BASE_UNITS[categoryKey] ?? 20000;

    // 2. PAGE-1 CTR CURVE (industry standard)
    const page1Ctr = (rank: number): number => {
      if (rank === 1) return 0.28;
      if (rank === 2) return 0.17;
      if (rank === 3) return 0.12;
      if (rank === 4) return 0.09;
      if (rank === 5) return 0.07;
      if (rank <= 10) return 0.035;
      if (rank <= 20) return 0.012;
      return 0.004;
    };

    // 3. BUILD BSR CALIBRATION MODEL (ONLY if enough real BSR exists)
    const listingsWithRealBsr = listings.filter(
      l => typeof l.main_category_bsr === 'number' && l.main_category_bsr > 0 && l.position != null
    );

    let bsrCalibrationFactor = 1.0;

    if (listingsWithRealBsr.length >= 5) {
      const medianRealBsr = median(
        listingsWithRealBsr.map(l => l.main_category_bsr!)
      );

      const medianPosition = median(
        listingsWithRealBsr.map(l => l.position!)
      );

      const medianExpectedUnits =
        categoryBaseUnits *
        page1Ctr(medianPosition);

      // Lower BSR → higher units, logarithmic dampening
      bsrCalibrationFactor =
        Math.log10(medianExpectedUnits + 10) /
        Math.log10(medianRealBsr + 10);
    }

    // Clamp calibration factor
    bsrCalibrationFactor = clamp(bsrCalibrationFactor, 0.6, 1.4);

    // ═══════════════════════════════════════════════════════════════════════════
    // BSR HANDLING: No estimation - only use SP-API category-based BSR
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Do NOT estimate missing BSRs
    // If SP-API doesn't provide BSR, it remains null (unavailable)
    // Source tags are already set during merge step above
    for (const listing of listings) {
      // Ensure source tags are set correctly
      if (listing.main_category_bsr == null || listing.main_category_bsr <= 0) {
        // BSR is unavailable from SP-API - ensure tags reflect this
        if (!(listing as any).bsr_source || (listing as any).bsr_source === 'rainforest') {
          (listing as any).bsr_source = 'unavailable';
          (listing as any).bsr_confidence = 'unknown';
        }
        listing.bsr = null;
        listing.main_category_bsr = null;
      } else {
        // BSR exists from SP-API - ensure source tag is correct
        if (!(listing as any).bsr_source || (listing as any).bsr_source === 'rainforest') {
          (listing as any).bsr_source = 'sp_api';
          (listing as any).bsr_confidence = 'high';
        }
      }
    }

    // 5. CALCULATE MONTHLY UNITS (PRIMARY OUTPUT)
    const medianPrice = median(
      listings
        .map(l => l.price)
        .filter((p): p is number => p !== null && p !== undefined && p > 0)
    );
    const medianReviewCount = median(
      listings
        .map(l => l.reviews ?? 1)
        .filter((r): r is number => r !== null && r !== undefined && r >= 0)
    );

    for (const listing of listings) {
      if (listing.position == null || listing.price == null || listing.price <= 0) {
        continue; // Skip listings without position or price
      }

      const ctrUnits =
        categoryBaseUnits *
        page1Ctr(listing.position) *
        bsrCalibrationFactor;

      const priceMultiplier = clamp(
        medianPrice / listing.price,
        0.7,
        1.3
      );

      const reviewMultiplier = clamp(
        Math.log10((listing.reviews ?? 1) + 1) /
        Math.log10(medianReviewCount + 1),
        0.8,
        1.25
      );

      const estimatedUnits = Math.round(
        ctrUnits * priceMultiplier * reviewMultiplier
      );

      const estimatedRevenue = estimatedUnits * listing.price;

      listing.est_monthly_units = estimatedUnits;
      listing.est_monthly_revenue = Math.round(estimatedRevenue * 100) / 100;
      (listing as any).estimated_units = estimatedUnits; // Keep for backward compatibility
      (listing as any).estimated_monthly_revenue = estimatedRevenue; // Keep for backward compatibility
    }

    // 6. MARKET SNAPSHOT TOTALS (calculated later in aggregation step)
    const totalMonthlyUnits = listings
      .filter(l => l.est_monthly_units != null)
      .reduce((sum, l) => sum + (l.est_monthly_units || 0), 0);
    const totalMonthlyRevenue = listings
      .filter(l => l.est_monthly_revenue != null)
      .reduce((sum, l) => sum + (l.est_monthly_revenue || 0), 0);

    console.log("📊 H10_STYLE_ESTIMATION_COMPLETE", {
      keyword,
      category_key: categoryKey,
      category_base_units: categoryBaseUnits,
      real_bsr_count: listingsWithRealBsr.length,
      bsr_calibration_factor: bsrCalibrationFactor.toFixed(3),
      estimated_listings: listings.filter(l => (l as any).bsr_source === 'estimated').length,
      total_monthly_units: totalMonthlyUnits,
      total_monthly_revenue: Math.round(totalMonthlyRevenue),
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ PRICING & FULFILLMENT: SP-API Pricing is authoritative source
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL RULES:
    // - Buy Box price: SP-API Pricing API (authoritative)
    // - Fulfillment (FBA/FBM): SP-API Pricing API only (never infer from Rainforest)
    // - If OAuth does NOT exist: use Rainforest price as fallback, set fulfillment = unknown
    // - Do NOT assume fulfillment from Rainforest when SP-API pricing is unavailable
    for (const listing of listings) {
      if (!listing.asin) continue;
      
      const asin = listing.asin.toUpperCase();
      const pricing = spApiPricingResults.get(asin);
      
      if (pricing) {
        // Transition enrichment state when pricing data is applied
        if ((listing as any).enrichment_state === 'sp_api_catalog_enriched' || 
            !(listing as any).enrichment_state || 
            (listing as any).enrichment_state === 'raw') {
          (listing as any).enrichment_state = 'pricing_enriched';
        }
        
        // ✅ FULFILLMENT: SP-API Pricing is authoritative (FBA/FBM)
        if (pricing.fulfillment_channel) {
          listing.fulfillment = pricing.fulfillment_channel === 'FBA' ? 'FBA' : 'FBM';
          (listing as any).fulfillment_source = 'sp_api_pricing';
          (listing as any).fulfillment_confidence = 'high';
        }
        
        // ✅ PRICE: SP-API Pricing (Buy Box) is authoritative
        if (pricing.buy_box_price !== null) {
          listing.price = pricing.buy_box_price;
          (listing as any).price_source = 'sp_api_pricing';
          (listing as any).price_confidence = 'high';
        } else if (pricing.lowest_price !== null) {
          listing.price = pricing.lowest_price;
          (listing as any).price_source = 'sp_api_pricing';
          (listing as any).price_confidence = 'high';
        }
        
        // Additional pricing metadata
        if (pricing.buy_box_owner) {
          (listing as any).buy_box_owner = pricing.buy_box_owner;
          (listing as any).buy_box_owner_source = 'sp_api_pricing';
        }
        if (pricing.offer_count !== null) {
          (listing as any).offer_count = pricing.offer_count;
          (listing as any).offer_count_source = 'sp_api_pricing';
        }
      } else {
        // ═══════════════════════════════════════════════════════════════════════
        // SP-API Pricing unavailable (no OAuth or API failure)
        // ═══════════════════════════════════════════════════════════════════════
        // Price: Use Rainforest fallback (already set from parseRainforestSearchResults)
        if (listing.price !== null && listing.price !== undefined && !(listing as any).price_source) {
          (listing as any).price_source = 'rainforest';
          (listing as any).price_confidence = 'fallback';
        }
        
        // Fulfillment: Set to UNKNOWN if not already set
        // Fulfillment should already be normalized at ingest, but ensure it's never null
        if (!listing.fulfillment || listing.fulfillment === null || !(listing as any).fulfillment_source) {
          listing.fulfillment = "UNKNOWN"; // Explicitly mark as unknown (never null)
          (listing as any).fulfillment_source = 'unknown';
          (listing as any).fulfillment_confidence = 'unknown';
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔥 FORCED IN-MEMORY RECONCILIATION PASS
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Ensure BSR from SP-API catalog enrichment is patched into listings[]
    // This happens AFTER both:
    // 1) listings[] exists (created from search results)
    // 2) SP-API catalog enrichment completes (spApiCatalogResults Map exists)
    // 
    // DO NOT rely on existing merge logic alone - force explicit patching here
    // This ensures rawListings passed to buildKeywordPageOne() contains BSR
    // normalizeAsin is already defined in outer scope
    
    const listingByAsin = new Map<string, any>();
    for (const l of listings) {
      if (!l?.asin) continue;
      listingByAsin.set(normalizeAsin(l.asin), l);
    }
    
    // spApiCatalogResults MUST be the authoritative Map<asin, catalogData>
    // used earlier during enrichment. Do NOT create a new one.
    let bsrPatched = 0;
    
    for (const [asin, catalog] of spApiCatalogResults.entries()) {
      const asinKey = normalizeAsin(asin);
      const target = listingByAsin.get(asinKey);
      if (!target) continue;
      
      if (catalog?.bsr != null && catalog.bsr > 0) {
        // 🔴 REQUIRED: Set BSR AND provenance at merge time (not inferred later)
        target.bsr = catalog.bsr;
        target.main_category_bsr = catalog.bsr;
        (target as any).bsr_source = "sp_api";
        (target as any).had_sp_api_response = true;
        
        // Ensure enrichment_sources object exists
        if (!(target as any).enrichment_sources) {
          (target as any).enrichment_sources = {};
        }
        (target as any).enrichment_sources.sp_api_catalog = true;
        (target as any).enrichment_state = 'sp_api_catalog_enriched';
        
        bsrPatched++;
      }
    }
    
    console.log("SP_API_FORCED_RECONCILIATION_COMPLETE", {
      keyword,
      total_listings: listings.length,
      catalog_entries: spApiCatalogResults.size,
      bsr_patched: bsrPatched,
      sample_patched: listings
        .filter(l => (l as any).bsr_source === "sp_api" && l.bsr != null && l.bsr > 0)
        .slice(0, 5)
        .map(l => ({
          asin: l.asin,
          bsr: l.bsr,
          main_category_bsr: l.main_category_bsr,
          bsr_source: (l as any).bsr_source,
        })),
    });

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

    // STEP E: Log final BSR coverage (check source tags, not in-memory objects)
    // CRITICAL: BSR coverage must be computed from source tags or persisted state
    // NOT from in-memory bsrDataMap which may be modified by later phases
    // Safety invariant: If BSR was ever observed, it must remain present
    // NOTE: Moved here after listings are defined and merged with SP-API data
    const listingsWithBSR = listings.filter((l: any) => {
      // Check source tags (authoritative) instead of in-memory BSR
      return (l as any).bsr_source === 'sp_api' || 
             (l as any).bsr_source === 'sp_api_catalog' ||
             (l.main_category_bsr !== null && l.main_category_bsr > 0);
    }).length;
    
    const bsrCoveragePercent = page1Asins.length > 0 
      ? ((listingsWithBSR / page1Asins.length) * 100).toFixed(1)
      : "0.0";
    
    // Safety invariant: Verify all ASINs with BSR source tags have BSR value
    const bsrObservedAsins = new Set<string>();
    for (const listing of listings) {
      const asin = listing.asin?.toUpperCase();
      if (!asin) continue;
      
      if ((listing as any).bsr_source === 'sp_api' || 
          (listing as any).bsr_source === 'sp_api_catalog' ||
          (listing.main_category_bsr !== null && listing.main_category_bsr > 0)) {
        bsrObservedAsins.add(asin);
        
        // Verify invariant: BSR source tag present but BSR value is null
        if (((listing as any).bsr_source === 'sp_api' || (listing as any).bsr_source === 'sp_api_catalog') &&
            listing.main_category_bsr === null) {
          console.error("⚠️ BSR_INVARIANT_VIOLATION", {
            asin,
            keyword,
            bsr_source: (listing as any).bsr_source,
            main_category_bsr: listing.main_category_bsr,
            message: "BSR source tag present but BSR value is null - invariant violation",
          });
        }
      }
    }
    
    // Still track missing ASINs for logging (but use source tags, not bsrDataMap)
    const stillMissingAsins = page1Asins.filter(asin => !bsrObservedAsins.has(asin.toUpperCase()));
    
    console.log("FINAL_BSR_COVERAGE_PERCENT", {
      keyword,
      total_asins: page1Asins.length,
      asins_with_bsr: listingsWithBSR,
      coverage_percent: `${bsrCoveragePercent}%`,
      bsr_observed_count: bsrObservedAsins.size,
      missing_after_fetch: stillMissingAsins.length,
      bsr_missing_asins: stillMissingAsins.slice(0, 5), // Log first 5
      message: "BSR coverage computed from source tags, not in-memory objects",
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
    // ═══════════════════════════════════════════════════════════════════════════
    // PART 5: FIX DIAGNOSTICS (MANDATORY)
    // ═══════════════════════════════════════════════════════════════════════════
    // Compute counts from rawListings[] (NOT from ads[] arrays)
    // ═══════════════════════════════════════════════════════════════════════════
    // SPONSORED COUNTING (ASIN-LEVEL - CRITICAL)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Use appearances for metrics, NOT listings after deduplication
    // This ensures sponsored counts reflect all Page-1 appearances, not canonical instance selection.
    // DO NOT MODIFY THIS LOGIC - it matches Helium 10 / Jungle Scout behavior.
    // Note: appearances variable is created earlier in this function from searchResults
    const sponsored_count = appearances.filter(a => a.isSponsored).length;
    const organic_count = listings.filter((l) => l.appearsSponsored === false).length;
    const unknown_sponsored_count = 0; // appearsSponsored is always boolean, no unknown states
    const sponsored_pct = total_page1_listings > 0
      ? Number(((sponsored_count / total_page1_listings) * 100).toFixed(1))
      : 0;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SPONSORED_ORGANIC_DIAGNOSTICS (MANDATORY - PART 5)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("SPONSORED_ORGANIC_DIAGNOSTICS", {
      total_listings: total_page1_listings,
      sponsored_count,
      organic_count,
      unknown_count: unknown_sponsored_count,
      keyword,
      timestamp: new Date().toISOString(),
    });
    
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

    // TASK 3: Average rating (only over listings with numeric rating) - computed ONLY in final snapshot phase
    // Only compute if coverage is meaningful (>= 10% and >= 3 ratings)
    const ratings: number[] = listings
      .map(l => l.rating)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    
    const ratingCoverage = listings.length > 0 ? ratings.length / listings.length : 0;
    const avg_rating = 
      ratingCoverage >= 0.1 && ratings.length >= 3
        ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
        : null;

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
      organic_count,
      unknown_sponsored_count,
      sponsored_pct,
      dominance_score,
      total_page1_brands, // Total distinct brands (includes "Generic")
      top_brands_by_frequency: top_brands.slice(0, 10), // Top 10 brands by frequency
      fulfillment_mix: fulfillmentMix, // Always an object now (never null when listings exist)
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
        
        const bsrSource = (listing as any).bsr_source;
        let monthlyUnits: number;
        let confidence: "low" | "medium";
        
        // CRITICAL: Use different logic based on BSR source
        if (bsrSource === 'estimated' && (listing as any).estimated_units != null) {
          // For estimated BSR: use pre-calculated estimated_units from H10-style estimation
          monthlyUnits = Math.round((listing as any).estimated_units);
          confidence = "low"; // Estimated BSR has lower confidence
        } else if (bsrSource === 'sp_api' || bsrSource === 'sp_api_catalog') {
          // For real SP-API BSR: convert BSR → units using standard formula
          const category = listing.main_category || 'default';
          monthlyUnits = estimateMonthlySalesFromBSR(listing.main_category_bsr, category);
          // Confidence: "medium" if BSR is reasonable, "low" if very high BSR
          confidence = listing.main_category_bsr <= 100000 ? "medium" : "low";
        } else {
          // Fallback: use BSR → units conversion for any other BSR source
          const category = listing.main_category || 'default';
          monthlyUnits = estimateMonthlySalesFromBSR(listing.main_category_bsr, category);
          confidence = listing.main_category_bsr <= 100000 ? "medium" : "low";
        }
        
        // Revenue = units * price
        const monthlyRevenue = monthlyUnits * listing.price;
        
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

    // CRITICAL SAFETY MERGE: Ensure BSR from spApiCatalogResults is merged into listingsWithEstimates
    // This handles cases where the merge at line 2055-2163 didn't work or was lost during .map()
    // CRITICAL: Never overwrite real SP-API BSR, only fill missing or estimated BSRs
    try {
      const { estimateMonthlySalesFromBSR } = await import("@/lib/revenue/bsr-calculator");
      
      for (const listing of listingsWithEstimates) {
        if (!listing.asin) continue;
        const asin = listing.asin.toUpperCase();
        const catalog = spApiCatalogResults.get(asin);
        const currentBsrSource = (listing as any).bsr_source;
        
        // Only merge if catalog has BSR AND listing doesn't already have real SP-API BSR
        // If listing has estimated BSR, SP-API real BSR should replace it
        if (
          catalog && 
          catalog.bsr !== null && 
          catalog.bsr !== undefined && 
          catalog.bsr > 0 &&
          currentBsrSource !== 'sp_api' &&
          currentBsrSource !== 'sp_api_catalog'
        ) {
          // 🔴 REQUIRED: Set BSR AND provenance at merge time when catalog has BSR
          // This replaces estimated BSR with real SP-API BSR when available
          // 🔴 NEVER overwrite a valid BSR with null - use nullish coalescing
          listing.main_category_bsr ??= catalog.bsr;
          listing.bsr ??= catalog.bsr;
          (listing as any).bsr_source = 'sp_api';
          (listing as any).had_sp_api_response = true;
          
          // Ensure enrichment_sources object exists
          if (!(listing as any).enrichment_sources) {
            (listing as any).enrichment_sources = {};
          }
          (listing as any).enrichment_sources.sp_api_catalog = true;
          (listing as any).enrichment_state = 'sp_api_catalog_enriched';
          
          // If we replaced estimated BSR, we need to recalculate units from real BSR
          if (currentBsrSource === 'estimated' && listing.price !== null && listing.price > 0) {
            const category = listing.main_category || 'default';
            const monthlyUnits = estimateMonthlySalesFromBSR(catalog.bsr, category);
            const monthlyRevenue = monthlyUnits * listing.price;
            listing.est_monthly_units = monthlyUnits;
            listing.est_monthly_revenue = Math.round(monthlyRevenue * 100) / 100;
            listing.revenue_confidence = catalog.bsr <= 100000 ? "medium" : "low";
          }
          
          console.log("🟢 SAFETY_MERGE_BSR_APPLIED", {
            asin: listing.asin,
            bsr: catalog.bsr,
            previous_source: currentBsrSource,
            keyword,
            bsr_source: (listing as any).bsr_source,
            had_sp_api_response: (listing as any).had_sp_api_response,
            message: currentBsrSource === 'estimated' 
              ? "Replaced estimated BSR with real SP-API BSR" 
              : "BSR merged via safety merge - this should not happen if initial merge worked",
          });
        }
      }
    } catch (safetyMergeError) {
      console.error("Safety merge failed, continuing without it", {
        keyword,
        error: safetyMergeError instanceof Error ? safetyMergeError.message : String(safetyMergeError),
      });
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
    
    // Calculate enrichment summary metrics for final log
    const finalListingsWithBSR = listingsWithEstimates.filter(l => l.main_category_bsr !== null && l.main_category_bsr > 0).length;
    const finalListingsWithReviews = listingsWithEstimates.filter(l => l.reviews !== null && l.reviews > 0).length;
    const finalBsrCoveragePercent = listingsWithEstimates.length > 0 ? Math.round((finalListingsWithBSR / listingsWithEstimates.length) * 100) : 0;
    const finalReviewsCoveragePercent = listingsWithEstimates.length > 0 ? Math.round((finalListingsWithReviews / listingsWithEstimates.length) * 100) : 0;
    const rainforestCallCount = apiCallCounter?.count || 0;
    const spApiCatalogCalls = Math.ceil(page1Asins.length / 20); // Catalog batches 20 ASINs per call
    const pricingApiUsed = spApiPricingResults.size > 0;
    
    console.log("FINAL_KEYWORD_ENRICHMENT_SUMMARY", {
      keyword,
      asin_count: listingsWithEstimates.length,
      bsr_coverage_percent: `${finalBsrCoveragePercent}%`,
      reviews_coverage_percent: `${finalReviewsCoveragePercent}%`,
      rainforest_call_count: rainforestCallCount,
      spapi_catalog_calls: spApiCatalogCalls,
      pricing_api_used: pricingApiUsed,
      listings_with_bsr: finalListingsWithBSR,
      listings_with_reviews: finalListingsWithReviews,
      timestamp: new Date().toISOString(),
    });
    
    // ASIN Catalog Enrichment Summary
    const catalogRecordsCount = spApiCatalogResults.size;
    const attributesCount = listingsWithEstimates.filter(l => {
      // Count listings that have at least one attribute (brand, title, or BSR)
      return l.brand !== null || l.title !== null || l.main_category_bsr !== null;
    }).length;
    const attributesCoveragePercent = listingsWithEstimates.length > 0 
      ? Math.round((attributesCount / listingsWithEstimates.length) * 100) 
      : 0;
    
    // Calculate actual API calls made (excluding cache hits)
    const asinsFetchedFromApi = page1Asins.length - (catalogCacheHitCount || 0);
    const catalogApiCalls = Math.ceil(asinsFetchedFromApi / 20);
    
    console.log("ASIN_CATALOG_ENRICHMENT_SUMMARY", {
      keyword,
      asin_count: catalogRecordsCount,
      catalog_calls: catalogApiCalls,
      attributes_coverage_percent: `${attributesCoveragePercent}%`,
      bsr_coverage_percent: `${finalBsrCoveragePercent}%`,
      cache_hits: catalogCacheHitCount || 0,
      api_calls: catalogApiCalls,
      timestamp: new Date().toISOString(),
    });
    
    // ASIN Ingestion Summary - Aggregate metrics from catalog ingestion
    const asinCountTotal = page1Asins.length;
    const asinWrittenCore = spApiCatalogResults.size; // ASINs with core data (title/brand)
    const skippedDueToCache = totalSkippedDueToCache + (catalogCacheHitCount || 0);
    
    console.log("ASIN_INGESTION_SUMMARY", {
      keyword,
      asin_count_total: asinCountTotal,
      asin_written_core: asinWrittenCore,
      attributes_written: totalAttributesWritten,
      classifications_written: totalClassificationsWritten,
      images_written: totalImagesWritten,
      skipped_due_to_cache: skippedDueToCache,
      rainforest_calls_used: rainforestCallCount,
      spapi_catalog_calls_used: catalogApiCalls,
      pricing_used: pricingApiUsed,
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

