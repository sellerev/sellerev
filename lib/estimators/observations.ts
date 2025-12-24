/**
 * Market Observations
 * 
 * Stores historical observations from every keyword analyze for self-improving estimators.
 * Each successful analyze creates an observation row.
 */

export interface MarketObservation {
  marketplace: string;
  keyword: string;
  normalized_keyword: string;
  page: number;
  listings_json: any; // Array of ParsedListing
  summary_json: {
    avg_price: number | null;
    avg_reviews: number;
    avg_rating: number | null;
    sponsored_pct: number;
    total_listings: number;
    fulfillment_mix?: {
      fba: number;
      fbm: number;
      amazon: number;
    };
  };
  estimator_inputs_json?: {
    page1_count: number;
    avg_reviews: number;
    sponsored_count: number;
    avg_price: number | null;
    category?: string;
  };
  estimator_outputs_json?: {
    search_volume?: {
      min: number;
      max: number;
      source: string;
      confidence: string;
    };
    revenue_estimates?: {
      total_revenue_min: number;
      total_revenue_max: number;
      total_units_min: number;
      total_units_max: number;
    };
  };
  rainforest_request_metadata?: {
    request_url?: string;
    response_status?: number;
    response_time_ms?: number;
  };
  data_quality: {
    has_listings: boolean;
    listings_count: number;
    missing_fields: string[];
    fallback_used: boolean;
  };
}

/**
 * Insert a market observation after successful keyword analyze
 */
export async function insertMarketObservation(
  supabase: any,
  observation: MarketObservation
): Promise<void> {
  try {
    await supabase
      .from("market_observations")
      .insert({
        marketplace: observation.marketplace,
        keyword: observation.keyword,
        normalized_keyword: observation.normalized_keyword,
        page: observation.page,
        listings_json: observation.listings_json,
        summary_json: observation.summary_json,
        estimator_inputs_json: observation.estimator_inputs_json || null,
        estimator_outputs_json: observation.estimator_outputs_json || null,
        rainforest_request_metadata: observation.rainforest_request_metadata || null,
        data_quality: observation.data_quality,
      });
    
    console.log("MARKET_OBSERVATION_INSERTED", {
      keyword: observation.keyword,
      marketplace: observation.marketplace,
      listings_count: observation.data_quality.listings_count,
    });
  } catch (error) {
    console.error("Failed to insert market observation:", error);
    // Don't throw - observation insertion is non-critical
  }
}

/**
 * Normalize keyword for consistent storage
 */
export function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().trim();
}
