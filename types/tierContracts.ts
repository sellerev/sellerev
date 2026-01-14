/**
 * Tier-1 / Tier-2 Data Contracts
 * 
 * These contracts define the data structures for the two-phase execution model:
 * - Tier-1: Fast, blocking data required for initial UI render (≤10s)
 * - Tier-2: Refined, async data that improves accuracy (non-blocking)
 */

/**
 * Tier-1 Product Contract (BLOCKING)
 * 
 * This data is REQUIRED to render product cards, charts, and AI insights.
 * Returned synchronously from /api/analyze.
 * 
 * ABSOLUTE RULES:
 * - NEVER return more than 49 products
 * - Tier-1 must not depend on BSR fetch completion
 * - Tier-1 estimations may be approximate but consistent
 */
export interface Tier1Product {
  asin: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  fulfillment: 'FBA' | 'FBM' | 'Amazon' | 'Unknown';
  organic_rank: number;
  page_position: number;
  is_sponsored: boolean;
  estimated_monthly_units: number;
  estimated_monthly_revenue: number;
}

/**
 * Tier-1 Market Snapshot Contract (BLOCKING)
 * 
 * Returned immediately from /api/analyze.
 * Status is 'partial' until Tier-2 refinement completes.
 */
export interface Tier1MarketSnapshot {
  snapshot_id: string;
  keyword: string;
  marketplace: 'US' | 'CA';
  tier: 'tier1';
  status: 'partial';
  phase: 'fetching' | 'canonicalizing' | 'estimating' | 'branding' | 'complete';
  products: Tier1Product[]; // HARD CAP: 49 products max
  aggregates: {
    total_page1_units: number;
    total_page1_revenue: number;
    avg_price: number | null;
    avg_reviews: number | null;
    avg_rating: number | null;
  };
  // Brand stats computed from canonical Page-1 listings (includes Unknown/Generic in count + denominator)
  brand_stats?: {
    page1_brand_count: number;
    top_5_brand_share_pct: number; // revenue-weighted (denominator includes Unknown)
  };
  created_at: string;
}

/**
 * Tier-2 Enrichment Contract (ASYNC)
 * 
 * This data refines accuracy and confidence and MUST NOT block UI.
 * Updates are merged into the existing Tier-1 snapshot.
 */
export interface Tier2Enrichment {
  snapshot_id: string;
  tier: 'tier2';
  status: 'refined';
  refinements: {
    calibrated_units?: number;
    calibrated_revenue?: number;
    confidence_score?: number;
    confidence_level?: 'low' | 'medium' | 'high';
    brand_dominance?: {
      top_5_brand_share_pct: number;
      brands: { brand: string; revenue_share_pct: number }[];
    };
    algorithm_boosts?: {
      asin: string;
      appearances: number;
    }[];
  };
  completed_at: string;
}

/**
 * Combined Response Contract
 * 
 * /api/analyze returns this immediately with Tier-1 data.
 * UI hints indicate that refinement is happening.
 */
export interface TieredAnalyzeResponse {
  snapshot: Tier1MarketSnapshot;
  ui_hints: {
    show_refining_badge: boolean;
    next_update_expected_sec: number;
  };
}

