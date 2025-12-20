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
      // Legacy fields
      selling_price: 0,
      cogs_assumed_low: 0,
      cogs_assumed_high: 0,
      fba_fees: null,
      net_margin_low_pct: 0,
      net_margin_high_pct: 0,
      breakeven_price_low: 0,
      breakeven_price_high: 0,
      confidence: "estimated",
      source: "assumption_engine",
      // PART G fields
      confidence_level: "LOW",
      assumed_price: null,
      estimated_cogs_range: null,
      estimated_fba_fees: null,
      estimated_margin_pct_range: null,
      breakeven_price_range: null,
      sourcing_model: "not_sure",
      assumptions_used: ["Selling price unavailable"],
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
    // Legacy fields
    selling_price,
    cogs_assumed_low: cogsLow,
    cogs_assumed_high: cogsHigh,
    fba_fees: fba_fee,
    net_margin_low_pct: Math.max(0, netMarginLowPct),
    net_margin_high_pct: Math.max(0, netMarginHighPct),
    breakeven_price_low: breakevenPriceLow,
    breakeven_price_high: breakevenPriceHigh,
    confidence: confidence_tier === 'EXACT' ? 'refined' : confidence_tier === 'REFINED' ? 'refined' : 'estimated',
    source: source === 'sp_api' ? 'amazon_fees' : 'assumption_engine',
    
    // PART G fields
    confidence_level: confidenceLevel,
    assumed_price: selling_price,
    estimated_cogs_range: cogs_low !== null && cogs_high !== null ? { low: cogsLow, high: cogsHigh } : null,
    estimated_fba_fees: fba_fee,
    estimated_margin_pct_range: {
      low: Math.max(0, netMarginLowPct),
      high: Math.max(0, netMarginHighPct),
    },
    breakeven_price_range: {
      low: breakevenPriceLow,
      high: breakevenPriceHigh,
    },
    sourcing_model: sourcingModel, // PART H: Passed from seller profile
    assumptions_used: assumptionsUsed,
  };
}
