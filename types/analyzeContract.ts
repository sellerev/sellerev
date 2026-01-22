/**
 * ANALYZE RESULTS DATA CONTRACT — v1.0.0 (STABLE)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * VERSIONING POLICY (CRITICAL)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This contract defines the stable, versioned interface for Analyze results
 * consumed by the AI Copilot and other downstream consumers.
 * 
 * ⚠️  BREAKING CHANGE POLICY:
 * - DO NOT modify existing fields without incrementing the version number
 * - DO NOT remove fields without creating a new version
 * - DO NOT change field types without creating a new version
 * - New fields can be added as optional (backward compatible)
 * - When creating a new version, maintain backward compatibility or provide migration path
 * 
 * Current Version: v1.0.0
 * Last Updated: 2025-01-23
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * USAGE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This contract is the SINGLE SOURCE OF TRUTH for:
 * - AI Copilot input (ai_context)
 * - Frontend rendering (ProductCard components)
 * - Data persistence (analysis_runs.response)
 * 
 * The AI Copilot MUST NOT depend on:
 * - Live API calls (Rainforest, SP-API)
 * - Raw API responses
 * - Unnormalized data structures
 * 
 * All data must be pre-processed and normalized into this contract format.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * ListingCard — Normalized, deterministic product listing data
 * 
 * This is the stable structure for individual product listings.
 * All fields are deterministic (no live API calls required).
 * Optional enrichment fields may be populated asynchronously.
 * 
 * ⚠️ CRITICAL: Sponsored and Fulfillment are ASIN-level properties, not instance-level.
 * - appearsSponsored: true if ASIN appears sponsored ANYWHERE on Page 1
 * - sponsoredPositions: all positions where ASIN appeared as sponsored
 * - DO NOT modify canonicalization without updating aggregation logic
 * - DO NOT use isSponsored (instance-level) for counting - use appearsSponsored (ASIN-level)
 * 
 * ⚠️ CRITICAL: Fulfillment NEVER defaults to FBM
 * - fulfillment: "FBA" | "FBM" | "UNKNOWN" (never null, never defaults to FBM)
 * - fulfillmentSource: indicates data source (sp_api, rainforest_inferred, unknown)
 * - fulfillmentConfidence: indicates inference confidence (high, medium, low)
 */
export interface ListingCard {
  // ═══════════════════════════════════════════════════════════════════════
  // CORE IDENTIFIERS (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  asin: string; // Amazon Standard Identification Number (10 characters, uppercase)
  rank: number | null; // Organic rank (1-indexed) or null for sponsored listings
  page_position: number; // Actual Page-1 position including sponsored (1-indexed)
  organic_rank: number | null; // Position among organic listings only, null if sponsored
  
  // ═══════════════════════════════════════════════════════════════════════
  // BASIC PRODUCT DATA (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  title: string | null; // Product title (null if truly missing, never fabricated)
  image_url: string | null; // Product image URL (null if unavailable)
  price: number; // Current price (always present, may be estimated)
  
  // ═══════════════════════════════════════════════════════════════════════
  // REVIEW & RATING DATA (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  rating: number; // Average rating (0-5 scale, always present)
  review_count: number; // Total review count (always present, may be 0)
  
  // ═══════════════════════════════════════════════════════════════════════
  // SPONSORED STATUS (REQUIRED - ASIN-LEVEL)
  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: Sponsored and Fulfillment are ASIN-level properties, not instance-level.
  // DO NOT MODIFY THIS LOGIC WITHOUT UPDATING AGGREGATION LOGIC.
  // ═══════════════════════════════════════════════════════════════════════════
  is_sponsored: boolean | null; // DEPRECATED: Use appearsSponsored instead. Kept for backward compatibility.
  sponsored_position: number | null; // Ad position from Rainforest (null if not sponsored)
  sponsored_source: 'rainforest_serp' | 'organic_serp'; // Source of sponsored data
  appearsSponsored: boolean; // ASIN-level: true if appears sponsored anywhere on Page 1 (REQUIRED)
  sponsoredPositions: number[]; // ASIN-level: all positions where ASIN appeared as sponsored (REQUIRED)
  
  // ═══════════════════════════════════════════════════════════════════════
  // FULFILLMENT DATA (REQUIRED - NEVER DEFAULTS TO FBM)
  // ═══════════════════════════════════════════════════════════════════════
  fulfillment: "FBA" | "FBM" | "UNKNOWN"; // Fulfillment type (never null, never defaults to FBM)
  fulfillmentSource: 'sp_api' | 'rainforest_inferred' | 'unknown'; // Source of fulfillment data (REQUIRED)
  fulfillmentConfidence: 'high' | 'medium' | 'low'; // Confidence in fulfillment inference (REQUIRED)
  
  // ═══════════════════════════════════════════════════════════════════════
  // REVENUE & UNITS ESTIMATES (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  estimated_monthly_units: number; // Estimated monthly units (always present, modeled)
  estimated_monthly_revenue: number; // Estimated monthly revenue (always present, modeled)
  revenue_share_pct: number; // Percentage of total Page-1 revenue (0-100)
  
  // ═══════════════════════════════════════════════════════════════════════
  // OPTIONAL ENRICHMENT FIELDS (May be populated asynchronously)
  // ═══════════════════════════════════════════════════════════════════════
  
  // Brand enrichment (from SP-API Catalog or title parsing)
  brand?: string | null;
  brand_confidence?: "high" | "medium" | "low";
  brand_source?: "sp_api" | "rainforest" | "title_parse" | "unknown";
  
  // Category enrichment (from SP-API Catalog)
  main_category?: string | null; // Main category name (e.g., "Home & Kitchen")
  category_source?: "sp_api" | "rainforest" | "unknown";
  
  // BSR enrichment (from SP-API Catalog or Rainforest)
  bsr?: number | null; // Best Seller Rank (main category)
  main_category_bsr?: number | null; // Main category BSR (preferred)
  bsr_source?: "sp_api" | "rainforest" | "estimated" | "unavailable";
  bsr_confidence?: "high" | "medium" | "low" | "unknown";
  
  // Dimensions enrichment (from SP-API Catalog, requires escalation)
  dimensions?: {
    length?: number | null; // inches
    width?: number | null; // inches
    height?: number | null; // inches
    weight?: number | null; // pounds
    unit_type?: "imperial" | "metric";
  } | null;
  dimensions_source?: "sp_api" | "escalated" | "unknown";
  
  // Additional metadata
  seller_country?: "US" | "CN" | "Other" | "Unknown";
  snapshot_inferred?: boolean; // true if data was inferred from snapshot
  snapshot_inferred_fields?: string[]; // List of fields that were inferred
  
  // Algorithm boost tracking (Sellerev-only insight)
  page_one_appearances?: number; // How many times ASIN appeared in raw search results
  is_algorithm_boosted?: boolean; // true if page_one_appearances >= 2
  appeared_multiple_times?: boolean; // true if page_one_appearances > 1
}

/**
 * MarketSummary — Aggregate market statistics
 * 
 * Provides high-level market metrics derived from Page-1 listings.
 * All values are deterministic and computed from ListingCard[].
 */
export interface MarketSummary {
  // ═══════════════════════════════════════════════════════════════════════
  // LISTING COUNTS (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  total_listings: number; // Total Page-1 listings
  organic_listings: number; // Count of organic listings (is_sponsored === false)
  sponsored_listings: number; // Count of sponsored listings (is_sponsored === true)
  unknown_sponsored_count: number; // Count of listings with is_sponsored === null
  
  // ═══════════════════════════════════════════════════════════════════════
  // PERCENTAGES (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  sponsored_pct: number; // Percentage of sponsored listings (0-100)
  organic_pct: number; // Percentage of organic listings (0-100)
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRICE STATISTICS (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  avg_price: number; // Average price across all listings
  price_min: number | null; // Minimum price (null if no prices available)
  price_max: number | null; // Maximum price (null if no prices available)
  price_range: [number, number] | null; // [min, max] tuple (null if unavailable)
  price_cluster_width_pct: number | null; // Price spread as percentage (null if unavailable)
  
  // ═══════════════════════════════════════════════════════════════════════
  // REVIEW & RATING STATISTICS (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  avg_rating: number | null; // Average rating (null if insufficient data)
  avg_reviews: number; // Average review count (always present, may be 0)
  median_reviews: number | null; // Median review count (null if insufficient data)
  top5_median_reviews: number | null; // Median reviews of top 5 listings (null if unavailable)
  
  // ═══════════════════════════════════════════════════════════════════════
  // BSR STATISTICS (OPTIONAL - depends on enrichment)
  // ═══════════════════════════════════════════════════════════════════════
  avg_bsr: number | null; // Average BSR (null if BSR data unavailable)
  bsr_coverage_pct: number | null; // Percentage of listings with BSR data (0-100)
  
  // ═══════════════════════════════════════════════════════════════════════
  // FULFILLMENT MIX (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  fulfillment_mix: {
    fba: number; // Percentage FBA (0-100)
    fbm: number; // Percentage FBM (0-100)
    amazon: number; // Percentage Amazon Retail (0-100)
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // BRAND STATISTICS (OPTIONAL - depends on enrichment)
  // ═══════════════════════════════════════════════════════════════════════
  distinct_brand_count: number | null; // Count of distinct brands (null if brand data unavailable)
  top_brand_asin_count: number | null; // Count of ASINs from top brand (null if unavailable)
  top_5_brand_revenue_share_pct: number | null; // Top 5 brands revenue share (0-100, null if unavailable)
  
  // ═══════════════════════════════════════════════════════════════════════
  // REVENUE & UNITS TOTALS (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  total_monthly_units_est: number; // Total estimated monthly units across Page-1
  total_monthly_revenue_est: number; // Total estimated monthly revenue across Page-1
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIME ELIGIBILITY (OPTIONAL)
  // ═══════════════════════════════════════════════════════════════════════
  prime_eligible_count: number | null; // Count of Prime-eligible listings (null if unavailable)
  prime_eligible_pct: number | null; // Percentage Prime-eligible (0-100, null if unavailable)
}

/**
 * AnalyzeResultsContract — Complete Analyze results data contract
 * 
 * This is the root contract that contains all Analyze results data.
 * The AI Copilot consumes ONLY this contract structure.
 */
export interface AnalyzeResultsContract {
  // ═══════════════════════════════════════════════════════════════════════
  // VERSION & METADATA (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  contract_version: "1.0.0"; // Contract version (increment on breaking changes)
  keyword: string; // Search keyword
  marketplace: "US" | "CA" | "UK" | "EU" | "AU"; // Marketplace code
  currency: "USD" | "CAD" | "GBP" | "EUR"; // Currency code
  timestamp: string; // ISO 8601 timestamp of analysis
  
  // ═══════════════════════════════════════════════════════════════════════
  // DATA SOURCES (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  data_sources: {
    page1: "rainforest"; // Source of Page-1 listings
    estimation_model: "sellerev_bsr_v1"; // Revenue/units estimation model
    search_volume?: "modeled" | "sqp" | "third_party" | null; // Search volume source
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // CONFIDENCE & QUALITY (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  confidence: "low" | "medium" | "high"; // Overall data confidence
  confidence_reason: string; // Explanation of confidence level
  estimation_confidence_score: number; // 0-100 estimation confidence
  estimation_notes: string[]; // Human-readable notes about estimation adjustments
  
  // ═══════════════════════════════════════════════════════════════════════
  // CORE DATA (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  listings: ListingCard[]; // Array of normalized Page-1 listings
  market_summary: MarketSummary; // Aggregate market statistics
  
  // ═══════════════════════════════════════════════════════════════════════
  // ENRICHMENT STATUS (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════
  enrichment_status: {
    sp_api_catalog: {
      status: "pending" | "complete" | "skipped" | "failed";
      asin_count: number; // Number of ASINs targeted for enrichment
    };
    bsr_extraction: {
      status: "pending" | "complete" | "skipped" | "failed";
      asin_count: number; // Number of ASINs targeted for BSR extraction
    };
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // OPTIONAL: RANKINGS (for quick lookups)
  // ═══════════════════════════════════════════════════════════════════════
  rankings?: {
    highest_revenue_asin?: string | null;
    highest_units_asin?: string | null;
    lowest_review_asin?: string | null;
    highest_review_asin?: string | null;
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // OPTIONAL: DATA QUALITY METRICS
  // ═══════════════════════════════════════════════════════════════════════
  data_quality?: {
    data_completeness_score: number; // 0-100
    rainforest_coverage_pct: number; // 0-100
    sp_api_coverage_pct: number; // 0-100
  };
}

/**
 * Type guard to validate AnalyzeResultsContract
 */
export function isAnalyzeResultsContract(data: unknown): data is AnalyzeResultsContract {
  if (typeof data !== 'object' || data === null) return false;
  const contract = data as Partial<AnalyzeResultsContract>;
  
  return (
    contract.contract_version === "1.0.0" &&
    typeof contract.keyword === 'string' &&
    Array.isArray(contract.listings) &&
    typeof contract.market_summary === 'object' &&
    contract.market_summary !== null
  );
}

