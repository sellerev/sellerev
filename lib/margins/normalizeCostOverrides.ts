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
    defaultMarginSnapshot.selling_price ||
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
    cogsLow = defaultMarginSnapshot.cogs_assumed_low;
    cogsHigh = defaultMarginSnapshot.cogs_assumed_high;
  }

  // Determine FBA fees
  let fbaFeesValue: number | null;

  if (costOverrides.fba_fees !== null && costOverrides.fba_fees !== undefined && costOverrides.fba_fees > 0) {
    // User provided specific FBA fees
    fbaFeesValue = costOverrides.fba_fees;
  } else {
    // No FBA fees override - use default from snapshot
    fbaFeesValue = defaultMarginSnapshot.fba_fees;
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
    selling_price: sellingPrice,
    cogs_assumed_low: cogsLow,
    cogs_assumed_high: cogsHigh,
    fba_fees: fbaFeesValue,
    net_margin_low_pct: Math.max(0, netMarginLowPct), // Ensure non-negative
    net_margin_high_pct: Math.max(0, netMarginHighPct), // Ensure non-negative
    breakeven_price_low: breakevenPriceLow,
    breakeven_price_high: breakevenPriceHigh,
    confidence: "refined", // Always "refined" when using user overrides
    source: defaultMarginSnapshot.source, // Preserve original source (amazon_fees or assumption_engine)
  };
}
