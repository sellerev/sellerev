/**
 * PART H: Margin Assumptions Type
 * 
 * Represents user-refinable cost assumptions saved per analysis run.
 * Used for cost refinement loop in chat.
 */
export interface MarginAssumptions {
  selling_price: number | null;
  cogs_low: number | null;
  cogs_high: number | null;
  fba_fee: number | null;
  fulfillment_model: 'FBA' | 'FBM' | 'UNKNOWN';
  confidence_tier: 'ESTIMATED' | 'REFINED' | 'EXACT';
  source: 'assumption_engine' | 'user_override' | 'sp_api';
  last_updated_at: string;
}

/**
 * PART G: Margin Snapshot Type (First-Class Data Contract)
 * 
 * Deterministic margin snapshot for ASIN + KEYWORD modes.
 * Single source of truth for all margin calculations.
 * Stored at: analysis_runs.response.margin_snapshot
 */
export interface MarginSnapshot {
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
}
