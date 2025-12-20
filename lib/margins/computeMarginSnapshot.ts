/**
 * PART G: Shared Margin Assumption Engine
 * 
 * Pure function that computes margin snapshot for BOTH ASIN and KEYWORD modes.
 * Never blocks on missing data - always returns estimates.
 */

import { estimateCogsRange } from "@/lib/cogs/assumptions";
import { MarginSnapshot } from "@/types/margin";
import { estimateFbaFeesByCategory } from "./calculateMarginSnapshot";

type SourcingModel =
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

interface ComputeMarginSnapshotParams {
  analysisMode: "ASIN" | "KEYWORD";
  price: number | null;
  categoryHint: string | null;
  sourcingModel: SourcingModel;
  fbaFees: number | null;
  fbaFeeSource?: "sp_api" | "estimated";
}

/**
 * Compute margin snapshot with confidence logic
 * 
 * RULES:
 * - SELLING PRICE: ASIN mode → asin_snapshot.price, KEYWORD mode → market_snapshot.avg_price
 * - If price missing → return LOW confidence with null ranges
 * - COGS: Estimated by sourcing model (from assumptions engine)
 * - FBA FEES: Use cached SP-API if available, else estimate
 * - CONFIDENCE: HIGH (price + sourcing_model + SP-API fees), MEDIUM (price + sourcing_model + estimated fees), LOW (missing price OR not_sure)
 */
export function computeMarginSnapshot({
  analysisMode,
  price,
  categoryHint,
  sourcingModel,
  fbaFees,
  fbaFeeSource = "estimated",
}: ComputeMarginSnapshotParams): MarginSnapshot {
  const assumptionsUsed: string[] = [];
  
  // If price is missing, return LOW confidence snapshot
  if (price === null || price <= 0) {
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
      sourcing_model: sourcingModel,
      assumptions_used: ["Selling price unavailable"],
    };
  }

  // Step 1: Estimate COGS range
  const cogsEstimate = estimateCogsRange({
    price, // Note: estimateCogsRange expects 'price', not 'avg_price'
    category: categoryHint,
    sourcing_model: sourcingModel,
  });

  const cogsLow = cogsEstimate.low;
  const cogsHigh = cogsEstimate.high;
  assumptionsUsed.push(cogsEstimate.rationale);

  // Step 2: Determine FBA fees
  let fbaFeesValue: number | null = fbaFees;
  let fbaFeeIsEstimated = fbaFeeSource === "estimated" || fbaFees === null;

  if (fbaFeesValue === null || fbaFeesValue <= 0) {
    // Estimate FBA fees by category
    const feeEstimate = estimateFbaFeesByCategory(categoryHint);
    // Use midpoint for single value calculation
    fbaFeesValue = (feeEstimate.low + feeEstimate.high) / 2;
    fbaFeeIsEstimated = true;
    assumptionsUsed.push(`FBA fees estimated: ${feeEstimate.label} ($${feeEstimate.low}-$${feeEstimate.high})`);
  } else {
    assumptionsUsed.push("FBA fees from Amazon SP-API");
  }

  // Step 3: Calculate net margins
  // Net margin = (price - COGS - FBA_fees) / price
  const netMarginLow = price - cogsHigh - fbaFeesValue;
  const netMarginHigh = price - cogsLow - fbaFeesValue;

  // Step 4: Calculate margin percentages
  const netMarginLowPct = (netMarginLow / price) * 100;
  const netMarginHighPct = (netMarginHigh / price) * 100;

  // Step 5: Calculate breakeven prices
  // Breakeven = COGS + FBA_fees
  const breakevenPriceLow = cogsLow + fbaFeesValue;
  const breakevenPriceHigh = cogsHigh + fbaFeesValue;

  // Step 6: Determine confidence level
  // HIGH: price known + sourcing_model selected + SP-API FBA fee available
  // MEDIUM: price known + sourcing_model selected + FBA fee estimated
  // LOW: missing price OR sourcing_model = not_sure
  let confidenceLevel: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM";
  
  if (sourcingModel === "not_sure") {
    confidenceLevel = "LOW";
  } else if (!fbaFeeIsEstimated && fbaFeesValue !== null) {
    confidenceLevel = "HIGH";
  } else {
    confidenceLevel = "MEDIUM";
  }

  // Build margin snapshot with both legacy and PART G fields
  return {
    // Legacy fields (for backward compatibility)
    selling_price: price,
    cogs_assumed_low: cogsLow,
    cogs_assumed_high: cogsHigh,
    fba_fees: fbaFeesValue,
    net_margin_low_pct: Math.max(0, netMarginLowPct), // Ensure non-negative
    net_margin_high_pct: Math.max(0, netMarginHighPct), // Ensure non-negative
    breakeven_price_low: breakevenPriceLow,
    breakeven_price_high: breakevenPriceHigh,
    confidence: confidenceLevel === "HIGH" ? "refined" : "estimated",
    source: fbaFeeIsEstimated ? "assumption_engine" : "amazon_fees",
    
    // PART G: New structured fields
    confidence_level: confidenceLevel,
    assumed_price: price,
    estimated_cogs_range: { low: cogsLow, high: cogsHigh },
    estimated_fba_fees: fbaFeesValue,
    estimated_margin_pct_range: {
      low: Math.max(0, netMarginLowPct),
      high: Math.max(0, netMarginHighPct),
    },
    breakeven_price_range: {
      low: breakevenPriceLow,
      high: breakevenPriceHigh,
    },
    sourcing_model: sourcingModel,
    assumptions_used: assumptionsUsed,
  };
}
