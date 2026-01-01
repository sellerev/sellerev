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
    title: string;
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: Fulfillment;
    brand: string | null;
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
    title: string;
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: Fulfillment;
    brand: string | null;
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

  // F) AI Context (Read-only)
  ai_context: {
    mode: "keyword";
    keyword: string;
    summary: KeywordAnalyzeResponse["summary"];
    products: KeywordAnalyzeResponse["products"];
    market_structure: KeywordAnalyzeResponse["market_structure"];
    margin_snapshot: KeywordAnalyzeResponse["margin_snapshot"];
    signals: KeywordAnalyzeResponse["signals"];
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
 * Calculates top 3 brand share percentage
 */
function calculateTop3BrandShare(products: Array<{ brand: string | null }>): number {
  const brandCounts: Record<string, number> = {};
  
  products.forEach(p => {
    if (p.brand) {
      brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
    }
  });
  
  const sorted = Object.values(brandCounts).sort((a, b) => b - a);
  const top3 = sorted.slice(0, 3).reduce((a, b) => a + b, 0);
  const total = products.length;
  
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
  canonicalProducts?: CanonicalProduct[] // CANONICAL PAGE-1 PRODUCTS (FINAL AUTHORITY)
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
    products = canonicalProducts.map(p => ({
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
      brand: p.brand,
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
    }));
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
    products = top20.map((listing, index) => {
      const revenue = listing.est_monthly_revenue || 0;
      const revenueShare = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
      
      return {
        rank: listing.position || index + 1, // Legacy field - fallback path doesn't distinguish organic
        asin: listing.asin || "",
        title: listing.title || "",
        image_url: listing.image_url || null,
        price: listing.price || 0,
        rating: listing.rating || 0,
        review_count: listing.reviews || 0,
        bsr: listing.bsr || null,
        estimated_monthly_units: listing.est_monthly_units || 0,
        estimated_monthly_revenue: revenue,
        revenue_share_pct: Math.round(revenueShare * 100) / 100,
        fulfillment: normalizeFulfillment(listing.fulfillment),
        brand: listing.brand || null,
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
    });
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
  
  // Build market structure from products (canonical or fallback)
  const marketStructure = {
    brand_dominance_pct: snapshot.dominance_score || 0,
    top_3_brand_share_pct: calculateTop3BrandShare(products),
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
    const averageBSR = productsWithBSR.length > 0
      ? Math.round(productsWithBSR.reduce((sum, p) => sum + (p.bsr || 0), 0) / productsWithBSR.length)
      : null;
    
    // Assign to market snapshot (mutate snapshot object)
    if (snapshot) {
      (snapshot as any).monthly_units = totalMonthlyUnits;
      (snapshot as any).monthly_revenue = totalMonthlyRevenue;
      if (averageBSR !== null) {
        snapshot.avg_bsr = averageBSR;
      }
    }
    
    console.log("📈 MARKET SNAPSHOT AGGREGATED", {
      total_monthly_units: totalMonthlyUnits,
      total_monthly_revenue: totalMonthlyRevenue,
      average_bsr: averageBSR,
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
    .filter((b): b is number => b !== null && b > 0);
  const avg_bsr = pageOneBsrs.length > 0
    ? pageOneBsrs.reduce((sum, b) => sum + b, 0) / pageOneBsrs.length
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
  
  // Build AI context (read-only copy)
  const aiContext = {
    mode: "keyword" as const,
    keyword,
    summary,
    products,
    market_structure: marketStructure,
    margin_snapshot: marginSnapshotContract,
    signals,
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
    summary,
    products, // Canonical Page-1 array
    page_one_listings: products, // Explicit canonical Page-1 array for UI (same as products) - ensures UI, aggregates, and cards all derive from ONE canonical Page-1 array
    aggregates_derived_from_page_one, // Aggregates calculated from canonical Page-1 array (NOT snapshot)
    market_structure: marketStructure,
    margin_snapshot: marginSnapshotContract,
    signals,
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

