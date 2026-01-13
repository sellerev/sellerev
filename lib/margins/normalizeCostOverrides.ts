/**
 * Normalize Cost Overrides Utility
 * 
 * Recalculates margin snapshot using user-provided cost overrides.
 * If cost_overrides exist in analysis_run.response, uses them to override
 * COGS and/or FBA fees, then recalculates the margin snapshot with confidence = "refined".
 */

import { MarginSnapshot } from "@/types/margin";
import { calculateMarginSnapshot } from "./calculateMarginSnapshot";

type SourcingModel =
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

interface CostOverrides {
  cogs: number | null;
  fba_fees: number | null;
  last_updated: string;
  source: "user";
}

interface AnalysisResponse {
  cost_overrides?: CostOverrides;
  market_snapshot?: {
    margin_snapshot?: MarginSnapshot;
    avg_price?: number | null;
  };
}

/**
 * Normalize cost overrides and recalculate margin snapshot
 * 
 * @param response - Analysis response object (from analysis_runs.response)
 * @param defaultMarginSnapshot - Default margin snapshot to use as base
 * @param sourcingModel - Seller's sourcing model (for COGS calculation if not overridden)
 * @param categoryHint - Product category hint (optional, for FBA fee defaults)
 * @returns Updated MarginSnapshot with overrides applied and confidence = "refined"
 */
export function normalizeCostOverrides({
  response,
  defaultMarginSnapshot,
  sourcingModel,
  categoryHint,
}: {
  response: AnalysisResponse;
  defaultMarginSnapshot: MarginSnapshot;
  sourcingModel: SourcingModel;
  categoryHint?: string | null;
}): MarginSnapshot {
  const costOverrides = response.cost_overrides;

  // If no overrides exist, return default snapshot unchanged
  if (!costOverrides) {
    return defaultMarginSnapshot;
  }

  // Extract selling price from default snapshot or market snapshot
  const sellingPrice =
    defaultMarginSnapshot.assumed_price ||
    (response.market_snapshot?.avg_price as number) ||
    25.0; // Fallback

  // Determine COGS values
  let cogsLow: number;
  let cogsHigh: number;

  if (costOverrides.cogs !== null && costOverrides.cogs !== undefined && costOverrides.cogs > 0) {
    // User provided specific COGS - use it for both low and high (single value)
    cogsLow = costOverrides.cogs;
    cogsHigh = costOverrides.cogs;
  } else {
    // No COGS override - use default from snapshot
    cogsLow = defaultMarginSnapshot.estimated_cogs_min ?? 0;
    cogsHigh = defaultMarginSnapshot.estimated_cogs_max ?? 0;
  }

  // Determine FBA fees
  let fbaFeesValue: number | null;

  if (costOverrides.fba_fees !== null && costOverrides.fba_fees !== undefined && costOverrides.fba_fees > 0) {
    // User provided specific FBA fees
    fbaFeesValue = costOverrides.fba_fees;
  } else {
    // No FBA fees override - use default from snapshot
    fbaFeesValue = defaultMarginSnapshot.estimated_fba_fee;
  }

  // Recalculate net margins
  const netMarginLow = sellingPrice - cogsHigh - (fbaFeesValue || 0);
  const netMarginHigh = sellingPrice - cogsLow - (fbaFeesValue || 0);

  // Calculate margin percentages
  const netMarginLowPct = (netMarginLow / sellingPrice) * 100;
  const netMarginHighPct = (netMarginHigh / sellingPrice) * 100;

  // Calculate breakeven prices
  const breakevenPriceLow = cogsLow + (fbaFeesValue || 0);
  const breakevenPriceHigh = cogsHigh + (fbaFeesValue || 0);

  // Return updated snapshot with confidence = "refined"
  return {
    mode: defaultMarginSnapshot.mode,
    confidence_tier: "REFINED",
    confidence_reason: "User-provided cost overrides applied",
    assumed_price: sellingPrice,
    price_source: defaultMarginSnapshot.price_source,
    estimated_cogs_min: cogsLow,
    estimated_cogs_max: cogsHigh,
    cogs_source: "user_override",
    estimated_fba_fee: fbaFeesValue,
    fba_fee_source: defaultMarginSnapshot.fba_fee_source,
    net_margin_min_pct: Math.max(0, netMarginLowPct),
    net_margin_max_pct: Math.max(0, netMarginHighPct),
    breakeven_price_min: breakevenPriceLow,
    breakeven_price_max: breakevenPriceHigh,
    assumptions: [
      ...defaultMarginSnapshot.assumptions,
      "User-provided cost overrides applied",
    ],
  };
}










