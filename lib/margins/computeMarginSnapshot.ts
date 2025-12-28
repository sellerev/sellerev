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
      mode: analysisMode,
      confidence_tier: "ESTIMATED",
      confidence_reason: "Selling price unavailable",
      assumed_price: 0,
      price_source: "fallback",
      estimated_cogs_min: null,
      estimated_cogs_max: null,
      cogs_source: "assumption_engine",
      estimated_fba_fee: null,
      fba_fee_source: "unknown",
      net_margin_min_pct: null,
      net_margin_max_pct: null,
      breakeven_price_min: null,
      breakeven_price_max: null,
      assumptions: ["Selling price unavailable"],
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

  // Build margin snapshot
  const confidenceTier: "ESTIMATED" | "REFINED" | "EXACT" = confidenceLevel === "HIGH" ? "EXACT" : confidenceLevel === "MEDIUM" ? "REFINED" : "ESTIMATED";
  const fbaFeeSourceValue: "sp_api" | "category_estimate" | "unknown" = !fbaFeeIsEstimated ? "sp_api" : "category_estimate";
  const priceSource: "asin_price" | "page1_avg" | "fallback" = analysisMode === "ASIN" ? "asin_price" : "page1_avg";

  return {
    mode: analysisMode,
    confidence_tier: confidenceTier,
    confidence_reason: assumptionsUsed.join("; "),
    assumed_price: price,
    price_source: priceSource,
    estimated_cogs_min: cogsLow,
    estimated_cogs_max: cogsHigh,
    cogs_source: "assumption_engine",
    estimated_fba_fee: fbaFeesValue,
    fba_fee_source: fbaFeeSourceValue,
    net_margin_min_pct: Math.max(0, netMarginLowPct),
    net_margin_max_pct: Math.max(0, netMarginHighPct),
    breakeven_price_min: breakevenPriceLow,
    breakeven_price_max: breakevenPriceHigh,
    assumptions: assumptionsUsed,
  };
}
