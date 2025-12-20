/**
 * Margin Snapshot Type
 * 
 * Represents a calculated margin snapshot with COGS assumptions and FBA fees.
 * Used for margin calculations in chat and analysis.
 * 
 * PART G: Extended contract with confidence_level, assumptions_used, and structured ranges.
 */

export interface MarginSnapshot {
  // Legacy fields (maintained for backward compatibility)
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
  
  // PART G: New structured fields
  confidence_level: "LOW" | "MEDIUM" | "HIGH";
  assumed_price: number | null;
  estimated_cogs_range: { low: number; high: number } | null;
  estimated_fba_fees: number | null;
  estimated_margin_pct_range: { low: number; high: number } | null;
  breakeven_price_range: { low: number; high: number } | null;
  sourcing_model: "private_label" | "wholesale_arbitrage" | "retail_arbitrage" | "dropshipping" | "not_sure";
  assumptions_used: string[];
}
