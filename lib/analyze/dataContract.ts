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

// ============================================================================
// TYPE DEFINITIONS (EXACT CONTRACT SCHEMAS)
// ============================================================================

export type Marketplace = "US" | "CA" | "UK" | "EU" | "AU";
export type Currency = "USD" | "CAD" | "GBP" | "EUR";
export type Confidence = "low" | "medium" | "high";
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
    rank: number;
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
  }>;

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

export function buildKeywordAnalyzeResponse(
  keyword: string,
  marketData: KeywordMarketData,
  marginSnapshot: MarginSnapshot,
  marketplace: Marketplace = "US",
  currency: Currency = "USD"
): KeywordAnalyzeResponse {
  // Guard against null/undefined inputs
  if (!marketData) {
    throw new Error("marketData is required but was null or undefined");
  }
  if (!marginSnapshot) {
    throw new Error("marginSnapshot is required but was null or undefined");
  }
  
  const { snapshot, listings } = marketData;
  
  // Guard against missing snapshot or listings
  if (!snapshot) {
    throw new Error("marketData.snapshot is required but was null or undefined");
  }
  if (!Array.isArray(listings)) {
    throw new Error("marketData.listings must be an array");
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
  const products = top20.map((listing, index) => {
    const revenue = listing.est_monthly_revenue || 0;
    const revenueShare = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
    
    return {
      rank: listing.position || index + 1, // Use position from listing if available
      asin: listing.asin || "",
      title: listing.title || "",
      image_url: listing.image_url || null,
      price: listing.price || 0,
      rating: listing.rating || 0,
      review_count: listing.reviews || 0,
      bsr: listing.bsr || null, // BSR from ParsedListing
      estimated_monthly_units: listing.est_monthly_units || 0,
      estimated_monthly_revenue: revenue,
      revenue_share_pct: Math.round(revenueShare * 100) / 100,
      fulfillment: normalizeFulfillment(listing.fulfillment), // Use fulfillment from ParsedListing
      brand: listing.brand || null,
      seller_country: inferSellerCountry(listing),
    };
  });
  
  // Calculate price band
  const prices = top20
    .map(p => p.price)
    .filter((p): p is number => p !== null && p > 0);
  
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
  
  // Build market structure
  const marketStructure = {
    brand_dominance_pct: snapshot.dominance_score || 0,
    top_3_brand_share_pct: calculateTop3BrandShare(top20),
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
  
  // Build summary
  const summary = {
    search_volume_est: null, // TODO: Extract from search_demand if available
    search_volume_confidence: "low" as Confidence,
    avg_price: snapshot.avg_price || 0,
    avg_rating: snapshot.avg_rating || 0,
    avg_bsr: calculateAvgBSR(products),
    total_monthly_units_est: snapshot.est_total_monthly_units_min || 0,
    total_monthly_revenue_est: snapshot.est_total_monthly_revenue_min || 0,
    page1_product_count: snapshot.total_page1_listings,
    sponsored_count: snapshot.sponsored_count || null,
  };
  
  // Build signals (placeholder - needs actual calculation logic)
  const signals = {
    competition_level: "medium" as CompetitionLevel,
    pricing_pressure: "medium" as PricingPressure,
    differentiation_difficulty: "medium" as DifferentiationDifficulty,
    operational_complexity: "medium" as OperationalComplexity,
  };
  
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
    confidence: "medium" as Confidence, // TODO: Calculate from data quality
    summary,
    products,
    market_structure: marketStructure,
    margin_snapshot: marginSnapshotContract,
    signals,
    ai_context: aiContext,
  };
}

