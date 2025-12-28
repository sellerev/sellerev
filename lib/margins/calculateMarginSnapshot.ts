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
 * Categories (PART G: Updated ranges):
 * - Small/standard: $6–9 (typically < 1 lb, < 18" longest side)
 * - Oversize/home goods: $8–12 (typically > 20 lbs or > 18" longest side, furniture, appliances)
 * - Default: $7–10 (large standard, 1–20 lbs)
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

  // Small/standard items (PART G: $6–9)
  if (
    normalized.includes("small") ||
    normalized.includes("lightweight") ||
    normalized.includes("accessory") ||
    normalized.includes("jewelry") ||
    normalized.includes("phone case") ||
    normalized.includes("cable") ||
    normalized.includes("charger")
  ) {
    return { low: 6, high: 9, label: "Small/standard (estimated)" };
  }

  // Oversize/home goods (PART G: $8–12)
  if (
    normalized.includes("oversized") ||
    normalized.includes("furniture") ||
    normalized.includes("appliance") ||
    normalized.includes("mattress") ||
    normalized.includes("exercise equipment") ||
    normalized.includes("bike") ||
    normalized.includes("home") ||
    normalized.includes("kitchen")
  ) {
    return { low: 8, high: 12, label: "Oversize/home goods (estimated)" };
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
      price: avg_price,
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

    // Determine confidence tier and fee source
    const confidenceTier: "ESTIMATED" | "REFINED" | "EXACT" = source === "amazon_fees" ? "REFINED" : "ESTIMATED";
    const fbaFeeSource: "sp_api" | "category_estimate" | "unknown" = source === "amazon_fees" ? "sp_api" : "category_estimate";
    const priceSource: "asin_price" | "page1_avg" | "fallback" = marginMode === "ASIN" ? "asin_price" : marginMode === "KEYWORD" ? "page1_avg" : "fallback";

    return {
      mode: marginMode || "KEYWORD",
      confidence_tier: confidenceTier,
      confidence_reason: source === "amazon_fees" ? "FBA fees from Amazon SP-API" : "FBA fees estimated by category",
      assumed_price: avg_price,
      price_source: priceSource,
      estimated_cogs_min: cogsLow,
      estimated_cogs_max: cogsHigh,
      cogs_source: "assumption_engine",
      estimated_fba_fee: fbaFeesValue,
      fba_fee_source: fbaFeeSource,
      net_margin_min_pct: Math.max(0, netMarginLowPct),
      net_margin_max_pct: Math.max(0, netMarginHighPct),
      breakeven_price_min: breakevenPriceLow,
      breakeven_price_max: breakevenPriceHigh,
      assumptions: [
        `COGS: $${cogsLow.toFixed(2)}–$${cogsHigh.toFixed(2)} (estimated based on ${sourcing_model})`,
        `FBA fee: $${fbaFeesValue.toFixed(2)} (${source === "amazon_fees" ? "Amazon SP-API" : "estimated by category"})`,
      ],
    };
  } catch (error) {
    // Never throw - return safe defaults
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`calculateMarginSnapshot error: ${errorMessage}`);

    // Return safe default estimates
    const defaultCogsLow = (avg_price * 40) / 100;
    const defaultCogsHigh = (avg_price * 65) / 100;
    const defaultFbaFees = 10; // Default midpoint
    const defaultNetMarginLowPct = Math.max(0, ((avg_price - defaultCogsHigh - defaultFbaFees) / avg_price) * 100);
    const defaultNetMarginHighPct = Math.max(0, ((avg_price - defaultCogsLow - defaultFbaFees) / avg_price) * 100);

    return {
      mode: marginMode || "KEYWORD",
      confidence_tier: "ESTIMATED",
      confidence_reason: "Error occurred during calculation, using safe defaults",
      assumed_price: avg_price,
      price_source: marginMode === "ASIN" ? "asin_price" : marginMode === "KEYWORD" ? "page1_avg" : "fallback",
      estimated_cogs_min: defaultCogsLow,
      estimated_cogs_max: defaultCogsHigh,
      cogs_source: "assumption_engine",
      estimated_fba_fee: defaultFbaFees,
      fba_fee_source: "unknown",
      net_margin_min_pct: defaultNetMarginLowPct,
      net_margin_max_pct: defaultNetMarginHighPct,
      breakeven_price_min: defaultCogsLow + defaultFbaFees,
      breakeven_price_max: defaultCogsHigh + defaultFbaFees,
      assumptions: ["Error during calculation, using safe default estimates"],
    };
  }
}
