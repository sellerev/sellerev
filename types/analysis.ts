/**
 * Analysis Types
 * 
 * Shared type definitions for the Analyze feature.
 */

export interface RiskLevel {
  level: "Low" | "Medium" | "High";
  explanation: string;
}

export interface AnalysisResponse {
  analysis_run_id: string;
  created_at: string;
  input_type: "asin" | "keyword";
  input_value: string;
  decision: {
    verdict: "GO" | "CAUTION" | "NO_GO";
    confidence: number;
  };
  confidence_downgrades?: string[]; // Reasons why confidence was reduced
  executive_summary: string;
  reasoning: {
    primary_factors: string[];
    seller_context_impact: string;
  };
  risks: {
    competition: RiskLevel;
    pricing: RiskLevel;
    differentiation: RiskLevel;
    operations: RiskLevel;
  };
  recommended_actions: {
    must_do: string[];
    should_do: string[];
    avoid: string[];
  };
  assumptions_and_limits: string[];
  // Optional: Market data (from keyword aggregation or ASIN analysis)
  market_data?: {
    average_price?: number;
    price_min?: number;
    price_max?: number;
    review_count_avg?: number;
    average_rating?: number;
    competitor_count?: number;
    top_asins?: string[];
    data_fetched_at?: string;
  };
  // Optional: Aggregated keyword market snapshot (when input_type === "keyword")
  // Matches KeywordMarketSnapshot from lib/amazon/keywordMarket.ts
  // Represents Page 1 results only
  margin_snapshot?: {
    mode: "ASIN" | "KEYWORD";
    confidence_tier: "ESTIMATED" | "REFINED" | "EXACT";
    confidence_reason: string;
    assumed_price: number;
    price_source: "asin_price" | "page1_avg" | "fallback";
    estimated_cogs_min: number | null;
    estimated_cogs_max: number | null;
    cogs_source: "assumption_engine" | "user_override" | "exact";
    estimated_fba_fee: number | null;
    fba_fee_source: "sp_api" | "category_estimate" | "unknown";
    net_margin_min_pct: number | null;
    net_margin_max_pct: number | null;
    breakeven_price_min: number | null;
    breakeven_price_max: number | null;
    assumptions: string[];
  };
  // Canonical Page-1 array (explicit for UI - ensures UI, aggregates, and cards all derive from ONE canonical Page-1 array)
  page_one_listings?: Array<{
    rank: number | null; // null for sponsored listings (legacy field, equals organic_rank for organic, null for sponsored)
    asin: string;
    title: string | null;
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: "FBA" | "FBM" | "AMZ";
    brand: string | null;
    seller_country?: "US" | "CN" | "Other" | "Unknown"; // Optional - may be missing in stored data
    [key: string]: unknown; // Allow additional fields
  }>;
  
  // Products array (same as page_one_listings, kept for backward compatibility)
  products?: Array<{
    rank: number | null; // null for sponsored listings (legacy field, equals organic_rank for organic, null for sponsored)
    asin: string;
    title: string | null;
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: "FBA" | "FBM" | "AMZ";
    brand: string | null;
    seller_country?: "US" | "CN" | "Other" | "Unknown"; // Optional - may be missing in stored data
    [key: string]: unknown; // Allow additional fields
  }>;
  
  // Aggregates derived from canonical Page-1 array (explicit for UI)
  aggregates_derived_from_page_one?: {
    avg_price: number;
    avg_rating: number;
    avg_bsr: number | null;
    total_monthly_units_est: number;
    total_monthly_revenue_est: number;
    page1_product_count: number;
  };
  
  market_snapshot?: {
    keyword: string;
    avg_price: number | null;
    avg_reviews: number | null;
    avg_rating: number | null;
    total_page1_listings: number;
    sponsored_count: number;
    dominance_score: number; // 0-100
    // Brand stats: must reflect Page-1 listings reality
    total_page1_brands?: number | null; // legacy/compat
    brand_stats?: {
      page1_brand_count: number;
      top_5_brand_share_pct: number;
    } | null;
    representative_asin?: string | null;
    fba_fees?: {
      total_fee: number | null;
      source: "sp_api" | "estimated";
      asin_used: string;
      price_used: number;
    };
    // Page 1 product listings (for data-first display)
    listings?: Array<{
      asin: string | null;
      title: string | null;
      price: number | null;
      rating: number | null;
      reviews: number | null;
      bsr?: number | null;
      organic_rank?: number | null;
      fulfillment?: "FBA" | "FBM" | "Amazon" | null;
      is_sponsored: boolean;
      position: number;
      brand: string | null;
      image_url?: string | null;
      est_monthly_revenue?: number | null;
      est_monthly_units?: number | null;
      estimated_monthly_revenue?: number | null;
      estimated_monthly_units?: number | null;
      revenue_confidence?: "low" | "medium";
      [key: string]: unknown; // Allow additional fields
    }>;
  };
}

