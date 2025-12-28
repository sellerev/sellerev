/**
 * PART H: Apply Margin Assumptions to Margin Snapshot
 * 
 * Recalculates margin snapshot using margin_assumptions (user-refined costs).
 * Updates confidence tier based on source (ESTIMATED → REFINED → EXACT).
 */

import { MarginSnapshot } from "@/types/margin";
import { MarginAssumptions } from "@/types/margin";

/**
 * Calculate margin snapshot from margin_assumptions
 * 
 * Uses margin_assumptions to compute all margin values.
 * Confidence tier comes directly from margin_assumptions.confidence_tier.
 * 
 * @param assumptions - Margin assumptions with costs
 * @param sourcingModel - Sourcing model from seller profile (for MarginSnapshot type)
 */
export function calculateMarginSnapshotFromAssumptions(
  assumptions: MarginAssumptions,
  sourcingModel: "private_label" | "wholesale_arbitrage" | "retail_arbitrage" | "dropshipping" | "not_sure" = "not_sure"
): MarginSnapshot {
  const {
    selling_price,
    cogs_low,
    cogs_high,
    fba_fee,
    confidence_tier,
    source,
  } = assumptions;

  // If price is missing, return LOW confidence snapshot
  if (selling_price === null || selling_price <= 0) {
    return {
      mode: "KEYWORD" as const,
      confidence_tier: "ESTIMATED" as const,
      confidence_reason: "Selling price unavailable",
      assumed_price: 0,
      price_source: "fallback" as const,
      estimated_cogs_min: null,
      estimated_cogs_max: null,
      cogs_source: "assumption_engine" as const,
      estimated_fba_fee: null,
      fba_fee_source: "unknown" as const,
      net_margin_min_pct: null,
      net_margin_max_pct: null,
      breakeven_price_min: null,
      breakeven_price_max: null,
      assumptions: ["Selling price unavailable"],
    };
  }

  // Use assumptions values (may be null, handled below)
  const cogsLow = cogs_low ?? 0;
  const cogsHigh = cogs_high ?? cogs_low ?? 0; // If only one value, use it for both
  const fbaFeesValue = fba_fee ?? 0;

  // Calculate net margins
  // Net margin = (price - COGS - FBA_fees) / price
  const netMarginLow = selling_price - cogsHigh - fbaFeesValue;
  const netMarginHigh = selling_price - cogsLow - fbaFeesValue;

  // Calculate margin percentages
  const netMarginLowPct = (netMarginLow / selling_price) * 100;
  const netMarginHighPct = (netMarginHigh / selling_price) * 100;

  // Calculate breakeven prices
  // Breakeven = COGS + FBA_fees
  const breakevenPriceLow = cogsLow + fbaFeesValue;
  const breakevenPriceHigh = cogsHigh + fbaFeesValue;

  // Map confidence_tier to confidence_level
  const confidenceLevelMap: Record<'ESTIMATED' | 'REFINED' | 'EXACT', 'LOW' | 'MEDIUM' | 'HIGH'> = {
    'ESTIMATED': 'MEDIUM',
    'REFINED': 'MEDIUM',
    'EXACT': 'HIGH',
  };

  const confidenceLevel = confidenceLevelMap[confidence_tier] || 'MEDIUM';

  // Build assumptions_used array
  const assumptionsUsed: string[] = [];
  if (cogs_low !== null && cogs_high !== null) {
    assumptionsUsed.push(`COGS: $${cogs_low.toFixed(2)}–$${cogs_high.toFixed(2)} (${source === 'user_override' ? 'user-provided' : 'estimated'})`);
  }
  if (fba_fee !== null) {
    assumptionsUsed.push(`FBA fee: $${fba_fee.toFixed(2)} (${source === 'sp_api' ? 'Amazon SP-API' : source === 'user_override' ? 'user-provided' : 'estimated'})`);
  }

  // Build margin snapshot
  return {
    mode: "KEYWORD" as const,
    confidence_tier: confidenceLevel === "HIGH" ? "EXACT" as const : confidenceLevel === "MEDIUM" ? "REFINED" as const : "ESTIMATED" as const,
    confidence_reason: assumptionsUsed.join("; "),
    assumed_price: selling_price,
    price_source: source === 'sp_api' ? 'page1_avg' as const : 'fallback' as const,
    estimated_cogs_min: cogsLow,
    estimated_cogs_max: cogsHigh,
    cogs_source: source === 'user_override' ? 'user_override' as const : 'assumption_engine' as const,
    estimated_fba_fee: fba_fee,
    fba_fee_source: source === 'sp_api' ? 'sp_api' as const : 'category_estimate' as const,
    net_margin_min_pct: Math.max(0, netMarginLowPct),
    net_margin_max_pct: Math.max(0, netMarginHighPct),
    breakeven_price_min: breakevenPriceLow,
    breakeven_price_max: breakevenPriceHigh,
    assumptions: assumptionsUsed,
  };
}
