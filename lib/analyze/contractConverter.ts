/**
 * Contract Converter — Converts Analyze responses to stable contract format
 * 
 * This module converts the current Analyze response format to the stable
 * AnalyzeResultsContract format for consumption by the AI Copilot.
 */

import { AnalyzeResultsContract, ListingCard, MarketSummary } from "@/types/analyzeContract";

/**
 * Converts a listing from Analyze response format to ListingCard format
 */
function convertListingToCard(listing: any): ListingCard {
  return {
    // Core identifiers
    asin: listing.asin || "",
    rank: listing.rank ?? listing.organic_rank ?? null,
    page_position: listing.page_position ?? listing.position ?? listing.rank ?? 1,
    organic_rank: listing.organic_rank ?? (() => {
      // Use isSponsored if available, otherwise check is_sponsored
      const isSponsored = typeof listing.isSponsored === 'boolean' 
        ? listing.isSponsored 
        : Boolean(listing.is_sponsored === true);
      return isSponsored === true ? null : listing.rank ?? null;
    })(),
    
    // Basic product data
    title: listing.title ?? null,
    image_url: listing.image_url ?? listing.image ?? null,
    price: listing.price ?? 0,
    
    // Review & rating data
    rating: listing.rating ?? 0,
    review_count: listing.review_count ?? listing.reviews ?? 0,
    
    // Sponsored status (ASIN-level aggregation)
    // CRITICAL: Use appearsSponsored (ASIN-level), NOT isSponsored (instance-level)
    // appearsSponsored: true if ASIN appears sponsored ANYWHERE on Page 1
    appearsSponsored: typeof listing.appearsSponsored === 'boolean' 
      ? listing.appearsSponsored 
      : (!!listing.sponsored || !!listing.is_sponsored),
    sponsoredPositions: Array.isArray(listing.sponsoredPositions) 
      ? listing.sponsoredPositions 
      : [],
    is_sponsored: typeof listing.appearsSponsored === 'boolean' 
      ? listing.appearsSponsored 
      : (!!listing.sponsored || !!listing.is_sponsored), // DEPRECATED: Use appearsSponsored
    sponsored_position: listing.sponsored_position ?? null,
    sponsored_source: listing.sponsored_source ?? 'organic_serp',
    
    // Fulfillment data (never defaults to FBM, uses UNKNOWN if missing)
    fulfillment: listing.fulfillment === "FBA" || listing.fulfillment === "FBM" 
      ? listing.fulfillment 
      : "UNKNOWN",
    fulfillmentSource: listing.fulfillmentSource ?? 'unknown',
    fulfillmentConfidence: listing.fulfillmentConfidence ?? 'low',
    
    // Revenue & units estimates
    estimated_monthly_units: listing.estimated_monthly_units ?? listing.est_monthly_units ?? 0,
    estimated_monthly_revenue: listing.estimated_monthly_revenue ?? listing.est_monthly_revenue ?? 0,
    revenue_share_pct: listing.revenue_share_pct ?? 0,
    
    // Optional enrichment fields
    brand: listing.brand ?? null,
    brand_confidence: listing.brand_confidence,
    brand_source: listing.brand_source,
    main_category: listing.main_category ?? null,
    category_source: listing.category_source,
    bsr: listing.main_category_bsr ?? listing.bsr ?? null, // Prefer main_category_bsr
    main_category_bsr: listing.main_category_bsr ?? listing.bsr ?? null,
    bsr_source: listing.bsr_source,
    bsr_confidence: listing.bsr_confidence,
    dimensions: listing.dimensions ?? null,
    dimensions_source: listing.dimensions_source,
    seller_country: listing.seller_country,
    snapshot_inferred: listing.snapshot_inferred ?? false,
    snapshot_inferred_fields: listing.snapshot_inferred_fields,
    page_one_appearances: listing.page_one_appearances,
    is_algorithm_boosted: listing.is_algorithm_boosted,
    appeared_multiple_times: listing.appeared_multiple_times,
  };
}

/**
 * Computes market summary from listings array
 */
function computeMarketSummary(listings: ListingCard[]): MarketSummary {
  const totalListings = listings.length;
  // Compute counts from isSponsored (canonical field, always boolean)
  const organicListings = listings.filter(l => l.is_sponsored === false).length;
  const sponsoredListings = listings.filter(l => l.is_sponsored === true).length;
  const unknownSponsored = 0; // isSponsored is always boolean, no unknown states
  
  const prices = listings.map(l => l.price).filter(p => p > 0);
  const priceMin = prices.length > 0 ? Math.min(...prices) : null;
  const priceMax = prices.length > 0 ? Math.max(...prices) : null;
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  
  const ratings = listings.map(l => l.rating).filter(r => r > 0);
  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  
  const reviews = listings.map(l => l.review_count);
  const avgReviews = reviews.length > 0 ? reviews.reduce((a, b) => a + b, 0) / reviews.length : 0;
  const medianReviews = reviews.length > 0 
    ? [...reviews].sort((a, b) => a - b)[Math.floor(reviews.length / 2)]
    : null;
  
  const top5Listings = listings.slice(0, 5);
  const top5Reviews = top5Listings.map(l => l.review_count).filter(r => r > 0);
  const top5MedianReviews = top5Reviews.length > 0
    ? [...top5Reviews].sort((a, b) => a - b)[Math.floor(top5Reviews.length / 2)]
    : null;
  
  const bsrs = listings.map(l => l.main_category_bsr ?? l.bsr).filter(b => b !== null && b !== undefined) as number[];
  const avgBsr = bsrs.length > 0 ? bsrs.reduce((a, b) => a + b, 0) / bsrs.length : null;
  const bsrCoveragePct = totalListings > 0 ? (bsrs.length / totalListings) * 100 : null;
  
  // Amazon Retail is detected via seller or brand, not fulfillment
  // fulfillment only has "FBA" | "FBM" | "UNKNOWN" (no "AMZ")
  const fulfillmentCounts = {
    fba: listings.filter(l => l.fulfillment === "FBA").length,
    fbm: listings.filter(l => l.fulfillment === "FBM").length,
    amazon: listings.filter(l => {
      // Check seller or brand for Amazon Retail detection
      const seller = (l as any).seller;
      const brand = l.brand;
      return seller === 'Amazon' || brand === 'Amazon';
    }).length,
  };
  
  const brands = listings.map(l => l.brand).filter(b => b !== null && b !== undefined) as string[];
  const distinctBrands = new Set(brands);
  
  const totalMonthlyUnits = listings.reduce((sum, l) => sum + l.estimated_monthly_units, 0);
  const totalMonthlyRevenue = listings.reduce((sum, l) => sum + l.estimated_monthly_revenue, 0);
  
  // Calculate price cluster width (top 5 listings)
  let priceClusterWidthPct: number | null = null;
  if (top5Listings.length >= 2) {
    const top5Prices = top5Listings.map(l => l.price).filter(p => p > 0);
    if (top5Prices.length >= 2) {
      const minPrice = Math.min(...top5Prices);
      const maxPrice = Math.max(...top5Prices);
      if (minPrice > 0) {
        priceClusterWidthPct = ((maxPrice - minPrice) / minPrice) * 100;
      }
    }
  }
  
  return {
    total_listings: totalListings,
    organic_listings: organicListings,
    sponsored_listings: sponsoredListings,
    unknown_sponsored_count: unknownSponsored,
    sponsored_pct: totalListings > 0 ? (sponsoredListings / totalListings) * 100 : 0,
    organic_pct: totalListings > 0 ? (organicListings / totalListings) * 100 : 0,
    avg_price: avgPrice,
    price_min: priceMin,
    price_max: priceMax,
    price_range: priceMin !== null && priceMax !== null ? [priceMin, priceMax] : null,
    price_cluster_width_pct: priceClusterWidthPct,
    avg_rating: avgRating,
    avg_reviews: avgReviews,
    median_reviews: medianReviews,
    top5_median_reviews: top5MedianReviews,
    avg_bsr: avgBsr,
    bsr_coverage_pct: bsrCoveragePct,
    fulfillment_mix: {
      fba: totalListings > 0 ? (fulfillmentCounts.fba / totalListings) * 100 : 0,
      fbm: totalListings > 0 ? (fulfillmentCounts.fbm / totalListings) * 100 : 0,
      amazon: totalListings > 0 ? (fulfillmentCounts.amazon / totalListings) * 100 : 0,
    },
    distinct_brand_count: distinctBrands.size > 0 ? distinctBrands.size : null,
    top_brand_asin_count: null, // Would need brand breakdown to compute
    top_5_brand_revenue_share_pct: null, // Would need brand breakdown to compute
    total_monthly_units_est: totalMonthlyUnits,
    total_monthly_revenue_est: totalMonthlyRevenue,
    prime_eligible_count: null, // Not available in current format
    prime_eligible_pct: null, // Not available in current format
  };
}

/**
 * Converts Analyze response to stable contract format
 * 
 * This is the main entry point for converting Analyze responses to the
 * stable contract format consumed by the AI Copilot.
 */
export function convertToAnalyzeContract(
  analysisResponse: Record<string, unknown>,
  enrichmentStatus?: {
    sp_api_catalog?: { status: string; asin_count: number };
    bsr_extraction?: { status: string; asin_count: number };
  }
): AnalyzeResultsContract {
  // Extract listings from response (try multiple field names)
  const rawListings = (analysisResponse.page_one_listings as any[]) ||
                     (analysisResponse.products as any[]) ||
                     (analysisResponse.listings as any[]) ||
                     [];
  
  // Convert listings to ListingCard format
  const listings: ListingCard[] = rawListings.map(convertListingToCard);
  
  // Compute market summary from listings
  const marketSummary = computeMarketSummary(listings);
  
  // Extract metadata
  const keyword = (analysisResponse.input_value as string) || "";
  const marketplace = (analysisResponse.marketplace as "US" | "CA" | "UK" | "EU" | "AU") || "US";
  const currency = (analysisResponse.currency as "USD" | "CAD" | "GBP" | "EUR") || "USD";
  const timestamp = (analysisResponse.timestamp as string) || new Date().toISOString();
  
  // Extract confidence data
  const confidence = (analysisResponse.confidence as "low" | "medium" | "high") || "medium";
  const confidenceReason = (analysisResponse.confidence_reason as string) || "Data available";
  const estimationConfidenceScore = (analysisResponse.estimation_confidence_score as number) ?? 50;
  const estimationNotes = (analysisResponse.estimation_notes as string[]) || [];
  
  // Extract enrichment status
  type EnrichmentStatus = {
    sp_api_catalog?: {
      status?: string;
      asin_count?: number;
    };
    bsr_extraction?: {
      status?: string;
      asin_count?: number;
    };
    [key: string]: unknown;
  };
  const enrichment: EnrichmentStatus = (enrichmentStatus || analysisResponse.enrichment_status || {}) as EnrichmentStatus;
  
  // Build rankings if available
  const rankings = {
    highest_revenue_asin: null as string | null,
    highest_units_asin: null as string | null,
    lowest_review_asin: null as string | null,
    highest_review_asin: null as string | null,
  };
  
  if (listings.length > 0) {
    const sortedByRevenue = [...listings].sort((a, b) => b.estimated_monthly_revenue - a.estimated_monthly_revenue);
    const sortedByUnits = [...listings].sort((a, b) => b.estimated_monthly_units - a.estimated_monthly_units);
    const sortedByReviews = [...listings].sort((a, b) => a.review_count - b.review_count);
    const sortedByReviewsDesc = [...listings].sort((a, b) => b.review_count - a.review_count);
    
    rankings.highest_revenue_asin = sortedByRevenue[0]?.asin ?? null;
    rankings.highest_units_asin = sortedByUnits[0]?.asin ?? null;
    rankings.lowest_review_asin = sortedByReviews[0]?.asin ?? null;
    rankings.highest_review_asin = sortedByReviewsDesc[0]?.asin ?? null;
  }
  
  return {
    contract_version: "1.0.0",
    keyword,
    marketplace,
    currency,
    timestamp,
    data_sources: {
      page1: "rainforest",
      estimation_model: "sellerev_bsr_v1",
      search_volume: (analysisResponse.search_volume_source as any) || null,
    },
    confidence,
    confidence_reason: confidenceReason,
    estimation_confidence_score: estimationConfidenceScore,
    estimation_notes: estimationNotes,
    listings,
    market_summary: marketSummary,
    enrichment_status: {
      sp_api_catalog: {
        status: (enrichment.sp_api_catalog?.status as "pending" | "complete" | "skipped" | "failed") || "skipped",
        asin_count: enrichment.sp_api_catalog?.asin_count || 0,
      },
      bsr_extraction: {
        status: (enrichment.bsr_extraction?.status as "pending" | "complete" | "skipped" | "failed") || "skipped",
        asin_count: enrichment.bsr_extraction?.asin_count || 0,
      },
    },
    rankings,
    data_quality: {
      data_completeness_score: (analysisResponse.data_completeness_score as number) ?? 50,
      rainforest_coverage_pct: (analysisResponse.rainforest_coverage_pct as number) ?? 100,
      sp_api_coverage_pct: (analysisResponse.sp_api_coverage_pct as number) ?? 0,
    },
  };
}

