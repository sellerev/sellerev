/**
 * Margin Calculation Utility
 * 
 * Calculates margin snapshot with COGS assumptions and FBA fees.
 * Never throws - always returns estimates.
 */

import { estimateCogsRange } from "@/lib/cogs/assumptions";
import { MarginSnapshot } from "@/types/margin";

type SourcingModel =
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

/**
 * Estimate FBA fees by size/weight heuristic (ASIN mode fallback)
 * Used when SP-API fees are unavailable
 * 
 * Categories:
 * - Small standard: $5–7 (typically < 1 lb, < 18" longest side)
 * - Large standard: $7–10 (typically 1–20 lbs, standard dimensions)
 * - Oversize: $10–14 (typically > 20 lbs or > 18" longest side)
 */
export function estimateFbaFeesByCategory(categoryHint: string | null | undefined): {
  low: number;
  high: number;
  label: string;
} {
  if (!categoryHint) {
    // Default: large standard size
    return { low: 7, high: 10, label: "Large standard (estimated)" };
  }

  const normalized = categoryHint.toLowerCase().trim();

  // Small standard items
  if (
    normalized.includes("small") ||
    normalized.includes("lightweight") ||
    normalized.includes("accessory") ||
    normalized.includes("jewelry") ||
    normalized.includes("phone case") ||
    normalized.includes("cable") ||
    normalized.includes("charger")
  ) {
    return { low: 5, high: 7, label: "Small standard (estimated)" };
  }

  // Oversized items
  if (
    normalized.includes("oversized") ||
    normalized.includes("large") ||
    normalized.includes("furniture") ||
    normalized.includes("appliance") ||
    normalized.includes("mattress") ||
    normalized.includes("exercise equipment") ||
    normalized.includes("bike")
  ) {
    return { low: 10, high: 14, label: "Oversize (estimated)" };
  }

  // Large standard (default)
  return { low: 7, high: 10, label: "Large standard (estimated)" };
}

/**
 * Default FBA fee ranges by category (used when fba_fees is null)
 * @deprecated Use estimateFbaFeesByCategory for ASIN mode
 */
function getDefaultFbaFeeRange(categoryHint: string | null | undefined): {
  low: number;
  high: number;
} {
  const estimate = estimateFbaFeesByCategory(categoryHint);
  return { low: estimate.low, high: estimate.high };
}

/**
 * Calculate margin snapshot from inputs
 * 
 * @param params.avg_price - Selling price (for ASIN mode: ASIN price; for KEYWORD mode: avg_price)
 * @param params.sourcing_model - Seller's sourcing model (required)
 * @param params.category_hint - Product category hint (optional, used for FBA fee estimation)
 * @param params.fba_fees - FBA fees from Amazon SP-API (nullable; if null, estimated by category)
 * @param params.marginMode - 'ASIN' for single-listing analysis, 'KEYWORD' for market analysis (optional)
 * @returns MarginSnapshot with calculated margins and breakeven prices
 */
export function calculateMarginSnapshot({
  avg_price,
  sourcing_model,
  category_hint,
  fba_fees,
  marginMode,
}: {
  avg_price: number;
  sourcing_model: SourcingModel;
  category_hint?: string | null;
  fba_fees?: number | null;
  marginMode?: 'ASIN' | 'KEYWORD';
}): MarginSnapshot {
  try {
    // Step 1: Derive COGS range based on sourcing_model
    const cogsEstimate = estimateCogsRange({
      sourcing_model,
      category: category_hint,
      avg_price,
    });

    const cogsLow = cogsEstimate.low;
    const cogsHigh = cogsEstimate.high;

    // Step 2: Determine FBA fees
    let fbaFeesValue: number | null = null;
    let source: "assumption_engine" | "amazon_fees" = "assumption_engine";

    if (fba_fees !== null && fba_fees !== undefined && fba_fees > 0) {
      // Use provided FBA fees (from Amazon SP-API)
      fbaFeesValue = fba_fees;
      source = "amazon_fees";
    } else {
      // Estimate by category (ASIN mode fallback)
      const feeEstimate = estimateFbaFeesByCategory(category_hint);
      // Use midpoint for single value calculation
      fbaFeesValue = (feeEstimate.low + feeEstimate.high) / 2;
      source = "assumption_engine";
    }

    // Step 3: Calculate net margins
    // Net margin = selling_price - COGS - FBA_fees
    const netMarginLow = avg_price - cogsHigh - fbaFeesValue;
    const netMarginHigh = avg_price - cogsLow - fbaFeesValue;

    // Step 4: Calculate margin percentages
    const netMarginLowPct = (netMarginLow / avg_price) * 100;
    const netMarginHighPct = (netMarginHigh / avg_price) * 100;

    // Step 5: Calculate breakeven prices
    // Breakeven = COGS + FBA_fees
    const breakevenPriceLow = cogsLow + fbaFeesValue;
    const breakevenPriceHigh = cogsHigh + fbaFeesValue;

    return {
      selling_price: avg_price,
      cogs_assumed_low: cogsLow,
      cogs_assumed_high: cogsHigh,
      fba_fees: fbaFeesValue,
      net_margin_low_pct: Math.max(0, netMarginLowPct), // Ensure non-negative
      net_margin_high_pct: Math.max(0, netMarginHighPct), // Ensure non-negative
      breakeven_price_low: breakevenPriceLow,
      breakeven_price_high: breakevenPriceHigh,
      confidence: "estimated", // Always "estimated" unless user overrides later
      source,
    };
  } catch (error) {
    // Never throw - return safe defaults
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`calculateMarginSnapshot error: ${errorMessage}`);

    // Return safe default estimates
    const defaultCogsLow = (avg_price * 40) / 100;
    const defaultCogsHigh = (avg_price * 65) / 100;
    const defaultFbaFees = 10; // Default midpoint

    return {
      selling_price: avg_price,
      cogs_assumed_low: defaultCogsLow,
      cogs_assumed_high: defaultCogsHigh,
      fba_fees: defaultFbaFees,
      net_margin_low_pct: Math.max(0, ((avg_price - defaultCogsHigh - defaultFbaFees) / avg_price) * 100),
      net_margin_high_pct: Math.max(0, ((avg_price - defaultCogsLow - defaultFbaFees) / avg_price) * 100),
      breakeven_price_low: defaultCogsLow + defaultFbaFees,
      breakeven_price_high: defaultCogsHigh + defaultFbaFees,
      confidence: "estimated",
      source: "assumption_engine",
    };
  }
}
