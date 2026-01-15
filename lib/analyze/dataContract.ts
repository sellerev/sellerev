/**
 * ANALYZE DATA CONTRACT — v1 (LOCKED)
 * 
 * This module implements the strict data contract for Analyze feature outputs.
 * All responses MUST conform to these schemas exactly.
 * 
 * Rules:
 * - No scores, verdicts, or recommendations in raw data layer
 * - Missing data must be null, never invented
 * - All estimates must be labeled and explainable
 * - AI uses ONLY the provided ai_context object (read-only)
 */

import { KeywordMarketData, ParsedListing } from "@/lib/amazon/keywordMarket";
import { MarginSnapshot } from "@/types/margin";
import { CanonicalProduct } from "@/lib/amazon/canonicalPageOne";
import { calculateReviewDispersionFromListings } from "@/lib/amazon/calibration";

// ============================================================================
// TYPE DEFINITIONS (EXACT CONTRACT SCHEMAS)
// ============================================================================

export type Marketplace = "US" | "CA" | "UK" | "EU" | "AU";
export type Currency = "USD" | "CAD" | "GBP" | "EUR";
export type Confidence = "low" | "medium" | "high";
export type CalibrationConfidence = "Low" | "Medium" | "High";
export type Fulfillment = "FBA" | "FBM" | "AMZ";
export type SellerCountry = "US" | "CN" | "Other" | "Unknown";
export type PriceTightness = "tight" | "moderate" | "wide";
export type CompetitionLevel = "low" | "medium" | "high";
export type PricingPressure = "low" | "medium" | "high";
export type DifferentiationDifficulty = "low" | "medium" | "high";
export type OperationalComplexity = "low" | "medium" | "high";
export type PricingPosition = "below" | "at" | "above";
export type ReviewPosition = "below" | "at" | "above";
export type ListingStrength = "weak" | "average" | "strong";

// ============================================================================
// KEYWORD ANALYZE CONTRACT
// ============================================================================

export interface KeywordAnalyzeResponse {
  // Top-Level Metadata
  keyword: string;
  marketplace: Marketplace;
  currency: Currency;
  timestamp: string; // ISODate
  data_sources: {
    page1: "rainforest";
    estimation_model: "sellerev_bsr_v1";
    search_volume: "modeled" | "sqp" | "third_party";
  };
  confidence: Confidence;
  confidence_reason: string; // Trust layer: explains why confidence level
  
  // Accuracy Guardrails & Explainability
  estimation_confidence_score: number; // 0-100, based on calibration, parent normalization, refined data
  estimation_notes: string[]; // Human-readable notes about estimation adjustments

  // A) Page-1 Summary Metrics
  summary: {
    search_volume_est: number | null;
    search_volume_confidence: Confidence;
    avg_price: number;
    avg_rating: number;
    avg_bsr: number | null;
    total_monthly_units_est: number;
    total_monthly_revenue_est: number;
    page1_product_count: number;
    sponsored_count: number | null;
  };

  // B) Page-1 Product Table (Top 20, Organic Only)
  products: Array<{
    rank: number | null; // Legacy field - equals organic_rank for organic, null for sponsored
    asin: string;
    title: string | null; // From Rainforest SEARCH response - null if truly missing (never fabricated)
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: Fulfillment;
    // brand removed (Phase 4: brand not in public product types)
    seller_country: SellerCountry;
    // Algorithm boost tracking (Sellerev-only insight for AI/Spellbook)
    page_one_appearances: number; // appearance_count
    is_algorithm_boosted: boolean; // true if appearances >= 2
    appeared_multiple_times: boolean; // true if appearances > 1 (hidden Spellbook signal)
    // Helium-10 style rank semantics
    organic_rank: number | null; // Position among organic listings only (null for sponsored)
    page_position: number; // Actual Page-1 position including sponsored listings
    // Sponsored visibility (for clarity, not estimation changes)
    is_sponsored: boolean; // Explicit flag for sponsored listings
  }>;
  
  // B-2) Canonical Page-1 Array (explicit for UI)
  page_one_listings: Array<{
    rank: number | null; // Legacy field - equals organic_rank for organic, null for sponsored
    asin: string;
    title: string | null; // From Rainforest SEARCH response - null if truly missing (never fabricated)
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: Fulfillment;
    // brand removed (Phase 4: brand not in public product types)
    seller_country: SellerCountry;
    // Algorithm boost tracking (Sellerev-only insight for AI/Spellbook)
    page_one_appearances: number; // appearance_count
    is_algorithm_boosted: boolean; // true if appearances >= 2
    appeared_multiple_times: boolean; // true if appearances > 1 (hidden Spellbook signal)
    // Helium-10 style rank semantics
    organic_rank: number | null; // Position among organic listings only (null for sponsored)
    page_position: number; // Actual Page-1 position including sponsored listings
    // Sponsored visibility (for clarity, not estimation changes)
    is_sponsored: boolean; // Explicit flag for sponsored listings
  }>;
  
  // B-3) Aggregates Derived from Page-1 (explicit for UI)
  aggregates_derived_from_page_one: {
    avg_price: number;
    avg_rating: number;
    avg_bsr: number | null;
    total_monthly_units_est: number;
    total_monthly_revenue_est: number;
    page1_product_count: number;
  };

  // C) Market Structure Breakdown
  market_structure: {
    brand_dominance_pct: number;
    top_3_brand_share_pct: number;
    price_band: {
      min: number;
      max: number;
      tightness: PriceTightness;
    };
    fulfillment_mix: {
      fba_pct: number;
      fbm_pct: number;
      amazon_pct: number;
    };
    review_barrier: {
      median_reviews: number;
      top_5_avg_reviews: number;
    };
    page1_density: number;
  };

  // D) Margin Snapshot (Keyword Mode)
  margin_snapshot: {
    assumed_price: number;
    assumed_cogs_range: [number, number];
    assumed_fba_fees: number;
    estimated_net_margin_pct_range: [number, number];
    breakeven_price_range: [number, number];
    assumptions: string[];
  };

  // E) Signals (NOT verdicts)
  signals: {
    competition_level: CompetitionLevel;
    pricing_pressure: PricingPressure;
    differentiation_difficulty: DifferentiationDifficulty;
    operational_complexity: OperationalComplexity;
  };

  // F) Brand Moat Analysis (Page-1 Only, Deterministic)
  brand_moat: {
    moat_strength: "strong" | "moderate" | "weak" | "none";
    total_brands_count: number;
    top_brand_revenue_share_pct: number;
    top_3_brands_revenue_share_pct: number;
    brand_breakdown: Array<{
      brand: string;
      asin_count: number;
      total_revenue: number;
      revenue_share_pct: number;
    }>;
  };

  // G) AI Context (Read-only)
  ai_context: {
    mode: "keyword";
    keyword: string;
    summary: KeywordAnalyzeResponse["summary"];
    products: KeywordAnalyzeResponse["products"];
    market_structure: KeywordAnalyzeResponse["market_structure"];
    margin_snapshot: KeywordAnalyzeResponse["margin_snapshot"];
    signals: KeywordAnalyzeResponse["signals"];
    brand_moat: KeywordAnalyzeResponse["brand_moat"];
    // Snapshot metrics (explicitly exposed for AI reference)
    snapshot: {
      top_5_brand_revenue_share_pct: number | null;
      total_monthly_revenue: number;
      total_monthly_units: number;
    };
    // Calibration metadata (for AI explanations only, not UI math)
    calibration: {
      applied: boolean;
      revenue_multiplier: number;
      units_multiplier: number;
      confidence: 'high' | 'medium' | 'low';
      source: 'profile' | 'default';
    };
    // Estimation accuracy metadata (for AI explanations)
    estimation_confidence_score: number; // 0-100
    estimation_notes: string[]; // Human-readable notes about estimation adjustments
  };
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Determines price band tightness from min/max prices
 */
function calculatePriceTightness(min: number, max: number): PriceTightness {
  const range = max - min;
  const avg = (min + max) / 2;
  const rangePct = (range / avg) * 100;
  
  if (rangePct < 20) return "tight";
  if (rangePct < 50) return "moderate";
  return "wide";
}

/**
 * Infers seller country from brand/listing data (placeholder - needs actual data)
 */
function inferSellerCountry(listing: ParsedListing): SellerCountry {
  // TODO: Implement actual seller country detection from Rainforest data
  // For now, return "Unknown" as per contract requirement
  return "Unknown";
}

/**
 * Converts fulfillment type to contract format
 */
function normalizeFulfillment(fulfillment: string | null): Fulfillment {
  if (!fulfillment) return "FBM"; // Default fallback
  const normalized = fulfillment.toUpperCase();
  if (normalized === "AMAZON" || normalized === "AMZ") return "AMZ";
  if (normalized === "FBA") return "FBA";
  return "FBM";
}

/**
 * Calculates average BSR from products (null if insufficient data)
 */
function calculateAvgBSR(products: Array<{ bsr: number | null }>): number | null {
  const bsrs = products
    .map(p => p.bsr)
    .filter((bsr): bsr is number => bsr !== null && bsr > 0);
  
  if (bsrs.length === 0) return null;
  
  const sum = bsrs.reduce((a, b) => a + b, 0);
  return Math.round(sum / bsrs.length);
}

/**
 * Calculates top 3 brand share percentage (Phase 4: uses CanonicalProduct for brand data)
 */
function calculateTop3BrandShare(canonicalProducts: CanonicalProduct[] | undefined): number {
  if (!canonicalProducts || canonicalProducts.length === 0) {
    return 0;
  }
  
  const brandCounts: Record<string, number> = {};
  
  canonicalProducts.forEach(p => {
    if (p.brand) {
      brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
    }
  });
  
  const sorted = Object.values(brandCounts).sort((a, b) => b - a);
  const top3 = sorted.slice(0, 3).reduce((a, b) => a + b, 0);
  const total = canonicalProducts.length;
  
  return total > 0 ? Math.round((top3 / total) * 100) : 0;
}

/**
 * Calculates median reviews
 */
function calculateMedianReviews(products: Array<{ review_count: number }>): number {
  const reviews = products
    .map(p => p.review_count)
    .filter(r => r > 0)
    .sort((a, b) => a - b);
  
  if (reviews.length === 0) return 0;
  
  const mid = Math.floor(reviews.length / 2);
  return reviews.length % 2 === 0
    ? Math.round((reviews[mid - 1] + reviews[mid]) / 2)
    : reviews[mid];
}

/**
 * Calculates top 5 average reviews
 */
function calculateTop5AvgReviews(products: Array<{ review_count: number }>): number {
  const reviews = products
    .map(p => p.review_count)
    .filter(r => r > 0)
    .sort((a, b) => b - a)
    .slice(0, 5);
  
  if (reviews.length === 0) return 0;
  
  const sum = reviews.reduce((a, b) => a + b, 0);
  return Math.round(sum / reviews.length);
}

/**
 * Normalizes brand to bucket (Phase 1: Brand aggregation only)
 * Rules:
 * - "Amazon" → "Amazon"
 * - Non-empty brand string → that brand
 * - Otherwise → "Generic"
 */
function normalizeBrandBucket(brand: string | null | undefined): string {
  if (!brand || typeof brand !== 'string' || brand.trim().length === 0) {
    return 'Generic';
  }
  const trimmed = brand.trim();
  // Normalize "Amazon" variations
  if (trimmed.toLowerCase() === 'amazon') {
    return 'Amazon';
  }
  return trimmed;
}

// ============================================================================
// KEYWORD ANALYZE MAPPER
// ============================================================================

export async function buildKeywordAnalyzeResponse(
  keyword: string,
  marketData: KeywordMarketData,
  marginSnapshot: MarginSnapshot,
  marketplace: Marketplace = "US",
  currency: Currency = "USD",
  supabase?: any,
  canonicalProducts?: CanonicalProduct[], // CANONICAL PAGE-1 PRODUCTS (FINAL AUTHORITY)
  refinedDataCount?: number // Number of listings with refined data (for accuracy scoring)
): Promise<KeywordAnalyzeResponse> {
  // Guard against null/undefined inputs
  if (!marketData) {
    throw new Error("marketData is required but was null or undefined");
  }
  if (!marginSnapshot) {
    throw new Error("marginSnapshot is required but was null or undefined");
  }
  
  const { snapshot, listings } = marketData;
  
  // Guard against missing snapshot
  if (!snapshot) {
    throw new Error("marketData.snapshot is required but was null or undefined");
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CANONICAL PAGE-1 IS FINAL AUTHORITY
  // ═══════════════════════════════════════════════════════════════════════════
  // If canonical products are provided, use them directly - DO NOT rebuild
  // CRITICAL: If canonicalProducts is provided (even if empty), use it - never fallback to listings
  // Fallback to listings only when canonicalProducts is null/undefined (not provided)
  let products: KeywordAnalyzeResponse["products"];
  
  const canonical_count = canonicalProducts ? canonicalProducts.length : 0;
  const using_fallback = !canonicalProducts || canonicalProducts.length === 0;
  
  console.log("PAGE1_SOURCE", {
    canonical_count,
    using_fallback,
    has_canonical: !!canonicalProducts,
    listings_count: listings?.length || 0,
  });
  
  if (canonicalProducts && canonicalProducts.length > 0) {
    // Use canonical products directly - they are the final authority
    // NO filtering, NO rebuilding, NO conversion
    // PHASE 2: Remove brand fields at API boundary (brand, brand_confidence, _debug_brand, brand_source)
    products = canonicalProducts.map(p => {
      return {
        rank: p.rank ?? null, // Legacy field - equals organic_rank for organic, null for sponsored
        asin: p.asin,
        title: p.title,
        image_url: p.image_url,
        price: p.price,
        rating: p.rating,
        review_count: p.review_count,
        bsr: p.bsr,
        estimated_monthly_units: p.estimated_monthly_units,
        estimated_monthly_revenue: p.estimated_monthly_revenue,
        revenue_share_pct: p.revenue_share_pct,
        fulfillment: p.fulfillment,
        // brand removed at API boundary (Phase 2)
        seller_country: p.seller_country,
        // Algorithm boost tracking (Sellerev-only insight for AI/Spellbook)
        // Hidden metadata for AI reasoning - not displayed in UI
        page_one_appearances: p.page_one_appearances ?? 1, // appearance_count
        is_algorithm_boosted: p.is_algorithm_boosted ?? false, // true if appearances >= 2
        appeared_multiple_times: p.appeared_multiple_times ?? false, // true if appearances > 1
        // Helium-10 style rank semantics
        organic_rank: p.organic_rank ?? null, // Position among organic listings only
        page_position: p.page_position ?? p.rank ?? 0, // Actual Page-1 position including sponsored
        // Sponsored visibility (for clarity, not estimation changes)
        is_sponsored: p.is_sponsored ?? false, // Explicit flag for sponsored listings
      };
    }) as any; // Type assertion to bypass interface requirement (Phase 2: brand removed at API boundary)
  } else if (canonicalProducts && canonicalProducts.length === 0) {
    // CRITICAL: If canonicalProducts is empty array (but was provided), return empty
    // This means real listings existed but canonical builder returned empty (should not happen)
    // DO NOT fallback to listings - canonical builder is the authority
    console.warn("⚠️ CANONICAL_PRODUCTS_EMPTY", {
      message: "Canonical products array is empty - this should not happen if real listings exist",
      listings_count: listings?.length || 0,
    });
    products = [];
  } else {
    // Fallback: Build from listings (legacy path, should not be used for keyword analysis)
    // ONLY use this when canonicalProducts is null/undefined (not provided)
    if (!Array.isArray(listings)) {
      throw new Error("marketData.listings must be an array when canonical products are not provided");
    }
    
    // Filter organic listings only (exclude sponsored)
    const organicListings = listings.filter(l => !l.is_sponsored);
    
    // Limit to top 20
    const top20 = organicListings.slice(0, 20);
    
    // Calculate revenue share percentages
    const totalRevenue = top20.reduce((sum, p) => {
      return sum + (p.est_monthly_revenue || 0);
    }, 0);
    
    // Build products array
    // PHASE 2: Remove brand fields at API boundary
    products = top20.map((listing, index) => {
      const revenue = listing.est_monthly_revenue || 0;
      const revenueShare = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
      
      return {
        rank: listing.position || index + 1, // Legacy field - fallback path doesn't distinguish organic
        asin: listing.asin || "",
        title: listing.title || null, // From Rainforest SEARCH response - null if truly missing
        image_url: listing.image_url || null,
        price: listing.price || 0,
        rating: listing.rating || 0,
        review_count: listing.reviews || 0,
        bsr: listing.bsr || null,
        estimated_monthly_units: listing.est_monthly_units || 0,
        estimated_monthly_revenue: revenue,
        revenue_share_pct: Math.round(revenueShare * 100) / 100,
        fulfillment: normalizeFulfillment(listing.fulfillment),
        // brand removed at API boundary (Phase 2)
        seller_country: inferSellerCountry(listing),
        // Algorithm boost tracking (default to 1 appearance for fallback path)
        page_one_appearances: 1, // appearance_count
        is_algorithm_boosted: false, // true if appearances >= 2
        appeared_multiple_times: false, // true if appearances > 1
        // Helium-10 style rank semantics (fallback path - approximate)
        organic_rank: listing.is_sponsored ? null : (listing.position || index + 1), // Approximate for fallback
        page_position: listing.position || index + 1, // Actual Page-1 position
        // Sponsored visibility (for clarity, not estimation changes)
        is_sponsored: listing.is_sponsored ?? false, // Explicit flag for sponsored listings
      };
    }) as any; // Type assertion to bypass interface requirement (Phase 2: brand removed at API boundary)
  }
  
  // Calculate price band from products (canonical or fallback)
  const prices = products
    .map(p => p.price)
    .filter((p): p is number => p !== null && p !== undefined && p > 0);
  
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
  
  // Calculate fulfillment mix from snapshot (if available)
  const fulfillmentMix = snapshot.fulfillment_mix
    ? {
        fba_pct: snapshot.fulfillment_mix.fba,
        fbm_pct: snapshot.fulfillment_mix.fbm,
        amazon_pct: snapshot.fulfillment_mix.amazon,
      }
    : {
        fba_pct: 0,
        fbm_pct: 100,
        amazon_pct: 0,
      };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BRAND AGGREGATION (PHASE 4: Removed - using brand_stats from canonical products instead)
  // ═══════════════════════════════════════════════════════════════════════════
  // Brand aggregation is now handled via brand_stats computed from canonicalProducts (Phase 1)
  // Public products array no longer contains brand fields (Phase 2-4)

  // Build market structure from products (canonical or fallback)
  // Phase 4: Use canonicalProducts for brand calculations (public products array no longer has brand)
  const marketStructure = {
    brand_dominance_pct: snapshot.dominance_score || 0,
    top_3_brand_share_pct: calculateTop3BrandShare(canonicalProducts),
    top_5_brand_revenue_share_pct: snapshot.top_5_brand_revenue_share_pct ?? null, // Top 5 Brands Control (%)
    top_5_brands: snapshot.top_5_brands ?? null, // Top 5 brands breakdown
    // brand_dominance_summary removed (Phase 4: using brand_stats instead)
    price_band: {
      min: priceMin,
      max: priceMax,
      tightness: calculatePriceTightness(priceMin, priceMax),
    },
    fulfillment_mix: fulfillmentMix,
    review_barrier: {
      median_reviews: calculateMedianReviews(products),
      top_5_avg_reviews: calculateTop5AvgReviews(products),
    },
    page1_density: snapshot.total_page1_listings,
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKET SNAPSHOT AGGREGATION FROM CANONICAL PRODUCTS
  // ═══════════════════════════════════════════════════════════════════════════
  // If canonical products are provided, aggregate totals for market snapshot
  if (canonicalProducts && canonicalProducts.length > 0) {
    // HELIUM-10 STYLE: Use Page-1 totals directly (products are allocated from total)
    // The sum of allocated units/revenue equals the Page-1 total estimate
    const productsWithUnits = canonicalProducts.filter(p => p.estimated_monthly_units > 0);
    const totalMonthlyUnits = productsWithUnits.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
    
    const productsWithRevenue = canonicalProducts.filter(p => p.estimated_monthly_revenue > 0);
    const totalMonthlyRevenue = productsWithRevenue.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
    
    const productsWithBSR = canonicalProducts.filter(p => p.bsr !== null && p.bsr > 0);
    // Helium-10 style representative BSR:
    // - Use best 4 (lowest) + worst 2 (highest) when possible
    // - Falls back to all available when fewer exist
    const bsrsSorted = productsWithBSR
      .map(p => p.bsr as number)
      .filter((b): b is number => typeof b === "number" && isFinite(b) && b > 0)
      .sort((a, b) => a - b);
    const bsrMin = bsrsSorted.length > 0 ? bsrsSorted[0] : null;
    const bsrMax = bsrsSorted.length > 0 ? bsrsSorted[bsrsSorted.length - 1] : null;
    const topCount = Math.min(4, bsrsSorted.length);
    const top = bsrsSorted.slice(0, topCount);
    const bottomStart = Math.max(bsrsSorted.length - 2, top.length);
    const bottom = bsrsSorted.slice(bottomStart);
    const bsrSample = [...top, ...bottom];
    const averageBSR = bsrSample.length > 0
      ? Math.round(bsrSample.reduce((sum, b) => sum + b, 0) / bsrSample.length)
      : null;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: BRAND STATS COMPUTATION (Page-1 aggregate only)
    // ═══════════════════════════════════════════════════════════════════════════
    // Compute brand buckets and aggregate stats
    // Rules: Amazon, brand string, or Generic - all contribute to counts
    
    // Step 1: Compute brand buckets and aggregate revenue
    const brandRevenueMap = new Map<string, number>();
    const brandBuckets = new Set<string>();
    
    for (const product of canonicalProducts) {
      const brandBucket = normalizeBrandBucket(product.brand);
      brandBuckets.add(brandBucket);
      
      const revenue = product.estimated_monthly_revenue || 0;
      const currentRevenue = brandRevenueMap.get(brandBucket) || 0;
      brandRevenueMap.set(brandBucket, currentRevenue + revenue);
    }
    
    // Step 2: Compute page1_brand_count (includes Generic)
    const page1_brand_count = brandBuckets.size;
    
    // Step 3: Compute top 5 brand share
    const totalRevenue = canonicalProducts.reduce((sum, p) => sum + (p.estimated_monthly_revenue || 0), 0);
    const brandRevenueEntries = Array.from(brandRevenueMap.entries())
      .map(([brand, revenue]) => ({ brand, revenue }))
      .sort((a, b) => b.revenue - a.revenue);
    
    const top5Revenue = brandRevenueEntries
      .slice(0, 5)
      .reduce((sum, entry) => sum + entry.revenue, 0);
    
    const top_5_brand_share_pct = totalRevenue > 0
      ? Math.round((top5Revenue / totalRevenue) * 100 * 10) / 10 // Round to 1 decimal place
      : 0;
    
    // Step 4: Attach brand_stats to snapshot
    if (snapshot) {
      (snapshot as any).monthly_units = totalMonthlyUnits;
      (snapshot as any).monthly_revenue = totalMonthlyRevenue;
      if (averageBSR !== null) {
        snapshot.avg_bsr = averageBSR;
      }
      // Optional metadata for explainability (safe to store even if UI doesn't render yet)
      (snapshot as any).bsr_min = bsrMin;
      (snapshot as any).bsr_max = bsrMax;
      (snapshot as any).bsr_sample_method = bsrSample.length === 0 ? "none" : (bsrSample.length === bsrsSorted.length ? "all_available" : "top4_bottom2");
      (snapshot as any).bsr_sample_size = bsrSample.length;
      // Add brand_stats (Phase 1)
      (snapshot as any).brand_stats = {
        page1_brand_count,
        top_5_brand_share_pct,
      };
    }
    
    // Step 5: Logging
    console.log("📊 BRAND_STATS_COMPUTED", {
      page1_brand_count,
      top_5_brand_share_pct,
      total_revenue: totalRevenue,
      top_5_revenue: top5Revenue,
      brand_buckets: Array.from(brandBuckets),
    });
    
    console.log("📈 MARKET SNAPSHOT AGGREGATED", {
      total_monthly_units: totalMonthlyUnits,
      total_monthly_revenue: totalMonthlyRevenue,
      average_bsr: averageBSR,
      page1_brand_count,
      top_5_brand_share_pct: top_5_brand_share_pct,
    });
  }
  
  // Build summary - calculate aggregates from canonical Page-1 products (NOT snapshot)
  // This ensures UI, aggregates, and cards all derive from ONE canonical Page-1 array
  const pageOneListings = products; // Canonical Page-1 array (final authority)
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FIX PAGE-1 PRODUCT COUNT (Helium-10 Semantics)
  // ═══════════════════════════════════════════════════════════════════════════
  // "Number of Products" = Unique ASINs on Page 1 (organic + sponsored)
  // NOT raw scraped length, NOT post-dedupe + reinsert
  // This matches Helium-10 exactly
  const uniquePageOneAsins = new Set(
    pageOneListings.map(p => p.asin)
  );
  
  // Update snapshot with correct unique ASIN count
  if (snapshot) {
    (snapshot as any).number_of_products = uniquePageOneAsins.size;
    (snapshot as any).total_page1_listings = uniquePageOneAsins.size; // Also update total_page1_listings for consistency
  }
  
  // Sanity log to confirm correctness
  console.log("📊 PAGE 1 SNAPSHOT CHECK", {
    totalListings: pageOneListings.length,
    uniqueAsins: uniquePageOneAsins.size,
    sponsoredCount: pageOneListings.filter(p => p.is_sponsored).length,
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CALIBRATION LOGGING (Helium-10 Comparison)
  // ═══════════════════════════════════════════════════════════════════════════
  // Log metrics to compare Sellerev outputs against Helium-10 ranges
  // Do NOT modify estimation logic - this is observation only
  const totalRevenue = pageOneListings.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  // Calculate top 3 revenue share
  const sortedByRevenue = [...pageOneListings]
    .sort((a, b) => b.estimated_monthly_revenue - a.estimated_monthly_revenue);
  const top3Revenue = sortedByRevenue.slice(0, 3).reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const top3Pct = totalRevenue > 0 ? (top3Revenue / totalRevenue) * 100 : 0;
  
  // Calculate top 10 revenue share
  const top10Revenue = sortedByRevenue.slice(0, 10).reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const top10Pct = totalRevenue > 0 ? (top10Revenue / totalRevenue) * 100 : 0;
  
  // Calculate median product revenue
  const revenues = pageOneListings
    .map(p => p.estimated_monthly_revenue)
    .filter(r => r > 0)
    .sort((a, b) => a - b);
  const medianRevenue = revenues.length > 0
    ? (revenues.length % 2 === 0
        ? (revenues[Math.floor(revenues.length / 2) - 1] + revenues[Math.floor(revenues.length / 2)]) / 2
        : revenues[Math.floor(revenues.length / 2)])
    : 0;
  
  // Log calibration metrics in structured format
  console.log("📊 CALIBRATION METRICS (Helium-10 Comparison)", {
    keyword,
    total_revenue: Math.round(totalRevenue),
    top3_pct: Math.round(top3Pct * 100) / 100,
    top10_pct: Math.round(top10Pct * 100) / 100,
    median_revenue: Math.round(medianRevenue),
  });
  
  // Calculate aggregates from pageOneListings
  const pageOnePrices = pageOneListings
    .map(p => p.price)
    .filter((p): p is number => p !== null && p > 0);
  const avg_price = pageOnePrices.length > 0 
    ? pageOnePrices.reduce((sum, p) => sum + p, 0) / pageOnePrices.length 
    : 0;
  
  const pageOneRatings = pageOneListings
    .map(p => p.rating)
    .filter((r): r is number => r !== null && r > 0);
  const avg_rating = pageOneRatings.length > 0
    ? pageOneRatings.reduce((sum, r) => sum + r, 0) / pageOneRatings.length
    : 0;
  
  const pageOneBsrs = pageOneListings
    .map(p => p.bsr)
    .filter((b): b is number => b !== null && b > 0)
    .sort((a, b) => a - b);
  const topCount = Math.min(4, pageOneBsrs.length);
  const top = pageOneBsrs.slice(0, topCount);
  const bottomStart = Math.max(pageOneBsrs.length - 2, top.length);
  const bottom = pageOneBsrs.slice(bottomStart);
  const bsrSample = [...top, ...bottom];
  const avg_bsr = bsrSample.length > 0
    ? bsrSample.reduce((sum, b) => sum + b, 0) / bsrSample.length
    : null;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HELIUM-10 STYLE: Use Page-1 totals (sum of allocated = Page-1 total)
  // ═══════════════════════════════════════════════════════════════════════════
  // Products are allocated from Page-1 total, so sum equals Page-1 total estimate
  // These are the official snapshot values (not independent per-product estimates)
  const total_monthly_units_est = pageOneListings.reduce((sum, p) => sum + (p.estimated_monthly_units || 0), 0);
  const total_monthly_revenue_est = pageOneListings.reduce((sum, p) => sum + (p.estimated_monthly_revenue || 0), 0);
  
  console.log("📊 PAGE-1 TOTAL UNITS (from allocated products)", total_monthly_units_est);
  console.log("📊 PAGE-1 TOTAL REVENUE (from allocated products)", total_monthly_revenue_est);
  
  let summary = {
    search_volume_est: null, // TODO: Extract from search_demand if available
    search_volume_confidence: "low" as Confidence,
    avg_price,
    avg_rating,
    avg_bsr,
    total_monthly_units_est,
    total_monthly_revenue_est,
    page1_product_count: uniquePageOneAsins.size, // Use unique ASIN count (matches Helium-10)
    sponsored_count: snapshot.sponsored_count || null,
  };
  
  // Apply keyword-level historical blending
  summary = await blendWithKeywordHistory(summary, keyword, marketplace, supabase);
  
  // Build signals (placeholder - needs actual calculation logic)
  const signals = {
    competition_level: "medium" as CompetitionLevel,
    pricing_pressure: "medium" as PricingPressure,
    differentiation_difficulty: "medium" as DifferentiationDifficulty,
    operational_complexity: "medium" as OperationalComplexity,
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRUST LAYER: Calculate confidence and reason
  // ═══════════════════════════════════════════════════════════════════════════
  // Calculate confidence from market signals (same logic as calibration)
  const listingCount = products.length;
  const reviewDispersion = calculateReviewDispersionFromListings(
    products.map(p => ({ reviews: p.review_count }))
  );
  const sponsoredDensity = snapshot.sponsored_count && snapshot.total_page1_listings > 0
    ? (snapshot.sponsored_count / snapshot.total_page1_listings) * 100
    : 0;

  // Calculate confidence score (0-100)
  let confidenceScore = 0;
  const confidenceReasons: string[] = [];

  // Listing count factor (0-40 points)
  if (listingCount >= 15) {
    confidenceScore += 40;
    confidenceReasons.push("Strong listing coverage (15+ products)");
  } else if (listingCount >= 8) {
    confidenceScore += 25;
    confidenceReasons.push("Moderate listing coverage (8-14 products)");
  } else if (listingCount >= 5) {
    confidenceScore += 10;
    confidenceReasons.push("Limited listing coverage (5-7 products)");
  } else {
    confidenceReasons.push("Sparse listing coverage (< 5 products)");
  }

  // Review dispersion factor (0-30 points)
  if (reviewDispersion > 1000) {
    confidenceScore += 30;
    confidenceReasons.push("High review diversity indicates established market");
  } else if (reviewDispersion > 500) {
    confidenceScore += 20;
    confidenceReasons.push("Moderate review diversity");
  } else if (reviewDispersion > 0) {
    confidenceScore += 10;
    confidenceReasons.push("Low review diversity - market may be new");
  } else {
    confidenceReasons.push("No review data available");
  }

  // Sponsored density factor (0-30 points)
  if (sponsoredDensity < 20) {
    confidenceScore += 30;
    confidenceReasons.push("Low sponsored density suggests organic competition");
  } else if (sponsoredDensity < 40) {
    confidenceScore += 15;
    confidenceReasons.push("Moderate sponsored density");
  } else {
    confidenceScore += 5;
    confidenceReasons.push("High sponsored density may indicate paid competition");
  }

  // Determine confidence level
  let confidence: Confidence;
  if (confidenceScore >= 70) {
    confidence = "high";
  } else if (confidenceScore >= 40) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  const confidenceReason = confidenceReasons.join(". ") + ".";

  console.log("🎯 CONFIDENCE CALCULATED", {
    confidence_score: confidenceScore,
    confidence_level: confidence,
    listing_count: listingCount,
    review_dispersion: reviewDispersion,
    sponsored_density: sponsoredDensity.toFixed(1) + "%",
    confidence_reason: confidenceReason,
  });
  
  // Build margin snapshot (from MarginSnapshot type)
  // Guard against null/undefined marginSnapshot
  if (!marginSnapshot) {
    throw new Error("marginSnapshot is required but was null or undefined");
  }
  
  const marginSnapshotContract = {
    assumed_price: marginSnapshot.assumed_price || 0,
    assumed_cogs_range: [
      marginSnapshot.estimated_cogs_min ?? 0,
      marginSnapshot.estimated_cogs_max ?? 0,
    ] as [number, number],
    assumed_fba_fees: marginSnapshot.estimated_fba_fee ?? 0,
    estimated_net_margin_pct_range: [
      marginSnapshot.net_margin_min_pct ?? 0,
      marginSnapshot.net_margin_max_pct ?? 0,
    ] as [number, number],
    breakeven_price_range: [
      marginSnapshot.breakeven_price_min ?? 0,
      marginSnapshot.breakeven_price_max ?? 0,
    ] as [number, number],
    assumptions: Array.isArray(marginSnapshot.assumptions) ? marginSnapshot.assumptions : [],
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BRAND MOAT ANALYSIS (PAGE-1 ONLY, DETERMINISTIC)
  // ═══════════════════════════════════════════════════════════════════════════
  // Compute brand moat detection from Page-1 listings only
  // Groups listings by brand after normalization
  // Computes metrics per brand: listing_count, revenue_share, avg_reviews, max_rank
  // Never throws or returns null — defaults to NONE with explanation
  let brandMoat: KeywordAnalyzeResponse["brand_moat"];

  // Phase 4: Use canonicalProducts for brand moat analysis (they still have brand fields)
  if (canonicalProducts && canonicalProducts.length > 0) {
    try {
      const { analyzeBrandMoat } = await import("@/lib/market/brandMoatAnalysis");
      
      // Map canonicalProducts to PageOneListing format for moat analysis
      // Uses ONLY canonical estimated_monthly_revenue - never recomputes
      // Phase 4: Use canonicalProducts.brand (internal type still has brand field)
      const pageOneListings = canonicalProducts.map((p) => ({
        brand: p.brand || null,
        estimated_monthly_revenue: p.estimated_monthly_revenue || 0,
        review_count: p.review_count || 0,
        rank: p.rank || p.page_position || null,
        page_position: p.page_position || p.rank || null,
      }));

      brandMoat = analyzeBrandMoat(pageOneListings);

      console.log("[BrandMoat] Analysis complete", {
        moat_strength: brandMoat.moat_strength,
        total_brands_count: brandMoat.total_brands_count,
        top_brand_revenue_share_pct: brandMoat.top_brand_revenue_share_pct,
        top_3_brands_revenue_share_pct: brandMoat.top_3_brands_revenue_share_pct,
        breakdown_count: brandMoat.brand_breakdown?.length || 0,
      });
    } catch (error) {
      console.warn("[BrandMoat] Error computing brand moat:", error);
      // Never throw or return null — default to none
      brandMoat = {
        moat_strength: "none",
        total_brands_count: 0,
        top_brand_revenue_share_pct: 0,
        top_3_brands_revenue_share_pct: 0,
        brand_breakdown: [],
      };
    }
  } else {
    // No products — default to none
    brandMoat = {
      moat_strength: "none",
      total_brands_count: 0,
      top_brand_revenue_share_pct: 0,
      top_3_brands_revenue_share_pct: 0,
      brand_breakdown: [],
    };
  }

  // Extract calibration metadata from canonical products array (if present)
  // This metadata is attached during calibration step for AI explanations only
  let calibrationMetadata: {
    applied: boolean;
    revenue_multiplier: number;
    units_multiplier: number;
    confidence: 'high' | 'medium' | 'low';
    source: 'profile' | 'default';
  } | null = null;
  
  if (canonicalProducts && (canonicalProducts as any).__calibration_metadata) {
    calibrationMetadata = (canonicalProducts as any).__calibration_metadata;
    // Remove metadata from products array (cleanup)
    delete (canonicalProducts as any).__calibration_metadata;
  }
  
  // Extract parent normalization metadata from canonical products array (if present)
  let parentNormalizationMetadata: {
    normalized_count: number;
    total_count: number;
  } | null = null;
  
  if (canonicalProducts && (canonicalProducts as any).__parent_normalization_metadata) {
    parentNormalizationMetadata = (canonicalProducts as any).__parent_normalization_metadata;
    // Remove metadata from products array (cleanup)
    delete (canonicalProducts as any).__parent_normalization_metadata;
  }
  
  // Calculate estimation accuracy score and notes
  const { calculateEstimationConfidence } = await import("@/lib/analyze/estimationAccuracy");
  const estimationMetadata = {
    calibration_applied: calibrationMetadata?.applied || false,
    calibration_confidence: calibrationMetadata?.confidence || null,
    calibration_multiplier: calibrationMetadata?.revenue_multiplier || null,
    parent_normalized_count: parentNormalizationMetadata?.normalized_count || 0,
    total_products: products.length,
    refined_data_count: refinedDataCount || 0,
  };
  
  const accuracyResult = calculateEstimationConfidence(estimationMetadata);
  
  // Build AI context (read-only copy)
  const aiContext = {
    mode: "keyword" as const,
    keyword,
    summary,
    products,
    market_structure: marketStructure,
    margin_snapshot: marginSnapshotContract,
    signals,
    brand_moat: brandMoat, // Add brand moat to AI context
    // Snapshot metrics (explicitly exposed for AI reference)
    snapshot: {
      top_5_brand_revenue_share_pct: snapshot.top_5_brand_revenue_share_pct ?? null,
      total_monthly_revenue: summary.total_monthly_revenue_est,
      total_monthly_units: summary.total_monthly_units_est,
    },
    // Calibration metadata (for AI explanations only, not UI math)
    calibration: calibrationMetadata || {
      applied: false,
      revenue_multiplier: 1.0,
      units_multiplier: 1.0,
      confidence: 'low' as const,
      source: 'default' as const,
    },
    // Estimation accuracy metadata (for AI explanations)
    estimation_confidence_score: accuracyResult.confidence_score,
    estimation_notes: accuracyResult.notes,
  };
  
  // Calculate aggregates from canonical Page-1 array
  const aggregates_derived_from_page_one = {
    avg_price: summary.avg_price,
    avg_rating: summary.avg_rating,
    avg_bsr: summary.avg_bsr,
    total_monthly_units_est: summary.total_monthly_units_est,
    total_monthly_revenue_est: summary.total_monthly_revenue_est,
    page1_product_count: uniquePageOneAsins.size, // Use unique ASIN count (matches Helium-10)
  };
  
  // Verify canonical revenue integrity (guardrail)
  const { verifyCanonicalRevenueIntegrity } = await import("@/lib/analyze/estimationAccuracy");
  verifyCanonicalRevenueIntegrity(products, {
    calibration_applied: calibrationMetadata?.applied || false,
    parent_normalization_applied: (parentNormalizationMetadata?.normalized_count || 0) > 0,
  });
  
  return {
    keyword,
    marketplace,
    currency,
    timestamp: new Date().toISOString(),
    data_sources: {
      page1: "rainforest",
      estimation_model: "sellerev_bsr_v1",
      search_volume: "modeled",
    },
    confidence,
    confidence_reason: confidenceReason,
    estimation_confidence_score: accuracyResult.confidence_score,
    estimation_notes: accuracyResult.notes,
    summary,
    products, // Canonical Page-1 array
    page_one_listings: products, // Explicit canonical Page-1 array for UI (same as products) - ensures UI, aggregates, and cards all derive from ONE canonical Page-1 array
    aggregates_derived_from_page_one, // Aggregates calculated from canonical Page-1 array (NOT snapshot)
    market_structure: marketStructure,
    margin_snapshot: marginSnapshotContract,
    signals,
    brand_moat: brandMoat, // Brand Moat verdict (deterministic, Page-1 only)
    ai_context: aiContext,
  };
}

/**
 * Keyword-Level Historical Blending
 * 
 * Blends current market summary totals with historical averages from keyword_history table.
 * Uses 70% current + 30% history for keywords with ≥ 3 history rows.
 * 
 * @param summary - Market summary with current estimates
 * @param keyword - Search keyword
 * @param marketplace - Marketplace identifier
 * @param supabase - Optional Supabase client for querying history
 * @returns Summary with historically blended unit and revenue estimates
 */
async function blendWithKeywordHistory(
  summary: {
    search_volume_est: null;
    search_volume_confidence: Confidence;
    avg_price: number;
    avg_rating: number;
    avg_bsr: number | null;
    total_monthly_units_est: number;
    total_monthly_revenue_est: number;
    page1_product_count: number;
    sponsored_count: number | null;
  },
  keyword: string,
  marketplace: string,
  supabase?: any
): Promise<typeof summary> {
  // Skip if no supabase client provided
  if (!supabase) {
    return summary;
  }
  
  // Skip if current estimates are zero or invalid
  const currentUnits = summary.total_monthly_units_est || 0;
  const currentRevenue = summary.total_monthly_revenue_est || 0;
  
  if (currentUnits <= 0 || currentRevenue <= 0) {
    return summary;
  }
  
  try {
    // Query keyword_history for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: historyData, error } = await supabase
      .from('keyword_history')
      .select('total_monthly_units, total_monthly_revenue, recorded_at')
      .eq('keyword', keyword)
      .eq('marketplace', marketplace)
      .gte('recorded_at', thirtyDaysAgo.toISOString())
      .order('recorded_at', { ascending: false });
    
    if (error) {
      // Table may not exist yet - skip gracefully
      console.log("🔵 KEYWORD_HISTORY_BLEND_SKIPPED", {
        reason: "query_error",
        keyword,
        marketplace,
        error: error.message,
      });
      return summary;
    }
    
    if (!historyData || historyData.length === 0) {
      console.log("🔵 KEYWORD_HISTORY_BLEND_SKIPPED", {
        reason: "no_history_data",
        keyword,
        marketplace,
      });
      return summary;
    }
    
    // Filter valid history entries
    const validHistory = historyData.filter((record: any) => {
      const units = typeof record.total_monthly_units === 'number' 
        ? record.total_monthly_units 
        : parseFloat(record.total_monthly_units);
      const revenue = typeof record.total_monthly_revenue === 'number' 
        ? record.total_monthly_revenue 
        : parseFloat(record.total_monthly_revenue);
      
      return !isNaN(units) && units > 0 && !isNaN(revenue) && revenue > 0;
    });
    
    // Skip if fewer than 3 history rows
    if (validHistory.length < 3) {
      console.log("🔵 KEYWORD_HISTORY_BLEND_SKIPPED", {
        reason: "insufficient_history_rows",
        keyword,
        marketplace,
        history_rows: validHistory.length,
        required: 3,
      });
      return summary;
    }
    
    // Compute averages
    const historyAvgUnits = validHistory.reduce((sum: number, r: any) => {
      const units = typeof r.total_monthly_units === 'number' 
        ? r.total_monthly_units 
        : parseFloat(r.total_monthly_units);
      return sum + units;
    }, 0) / validHistory.length;
    
    const historyAvgRevenue = validHistory.reduce((sum: number, r: any) => {
      const revenue = typeof r.total_monthly_revenue === 'number' 
        ? r.total_monthly_revenue 
        : parseFloat(r.total_monthly_revenue);
      return sum + revenue;
    }, 0) / validHistory.length;
    
    // Blend: 70% current + 30% history
    let blendedUnits = Math.round(0.7 * currentUnits + 0.3 * historyAvgUnits);
    let blendedRevenue = Math.round(0.7 * currentRevenue + 0.3 * historyAvgRevenue);
    
    // Apply clamps: min = 50% of current, max = calibration upper bound
    // For max, we'll use 1.4x current (same as calibration factor max)
    const minUnits = Math.round(0.5 * currentUnits);
    const maxUnits = Math.round(1.4 * currentUnits);
    const minRevenue = Math.round(0.5 * currentRevenue);
    const maxRevenue = Math.round(1.4 * currentRevenue);
    
    blendedUnits = Math.max(minUnits, Math.min(maxUnits, blendedUnits));
    blendedRevenue = Math.max(minRevenue, Math.min(maxRevenue, blendedRevenue));
    
    console.log("🔵 KEYWORD_HISTORY_BLEND_COMPLETE", {
      keyword,
      marketplace,
      current_units: currentUnits,
      history_avg_units: Math.round(historyAvgUnits),
      blended_units: blendedUnits,
      current_revenue: currentRevenue,
      history_avg_revenue: Math.round(historyAvgRevenue),
      blended_revenue: blendedRevenue,
      history_rows: validHistory.length,
    });
    
    return {
      ...summary,
      total_monthly_units_est: blendedUnits,
      total_monthly_revenue_est: blendedRevenue,
    };
  } catch (error) {
    // Gracefully handle any errors (table missing, etc.)
    console.log("🔵 KEYWORD_HISTORY_BLEND_SKIPPED", {
      reason: "exception",
      keyword,
      marketplace,
      error: error instanceof Error ? error.message : String(error),
    });
    return summary;
  }
}

