/**
 * Margin Snapshot Type
 * 
 * Represents a calculated margin snapshot with COGS assumptions and FBA fees.
 * Used for margin calculations in chat and analysis.
 */

export interface MarginSnapshot {
  selling_price: number;
  cogs_assumed_low: number;
  cogs_assumed_high: number;
  fba_fees: number | null;
  net_margin_low_pct: number;
  net_margin_high_pct: number;
  breakeven_price_low: number;
  breakeven_price_high: number;
  confidence: "estimated" | "refined";
  source: "assumption_engine" | "amazon_fees";
}
