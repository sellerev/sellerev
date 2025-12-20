/**
 * PART G: Margin Snapshot Builder (First-Class Feature)
 * 
 * Single source of truth for margin calculations.
 * Deterministic, mode-aware, confidence-tiered.
 */

import { MarginSnapshot } from "@/types/margin";
import { estimateCogsRange } from "@/lib/cogs/assumptions";
import { estimateFbaFeesByCategory } from "./calculateMarginSnapshot";

type SourcingModel =
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

interface BuildMarginSnapshotParams {
  analysisMode: "ASIN" | "KEYWORD";
  sellerProfile: {
    sourcing_model: SourcingModel;
  };
  asinSnapshot: {
    price: number | null;
  } | null;
  marketSnapshot: {
    avg_price: number | null;
    category?: string | null;
  } | null;
  fbaFees: {
    total_fba_fees: number | null;
    source: "sp_api" | "estimated" | "unknown";
  } | null;
  userOverrides?: {
    cogs?: number | null;
    price?: number | null;
  } | null;
}

/**
 * Build deterministic margin snapshot
 * 
 * RULES:
 * - ASIN mode uses asin price only (never Page-1 data)
 * - KEYWORD mode uses Page-1 avg price only (never ASIN price)
 * - Never mix modes
 * - No default "magic numbers" without explanation
 */
export function buildMarginSnapshot({
  analysisMode,
  sellerProfile,
  asinSnapshot,
  marketSnapshot,
  fbaFees,
  userOverrides,
}: BuildMarginSnapshotParams): MarginSnapshot {
  const assumptions: string[] = [];
  
  // STEP 1: Resolve selling price (mode-aware, no mixing)
  let assumedPrice: number;
  let priceSource: "asin_price" | "page1_avg" | "fallback";
  
  if (analysisMode === "ASIN") {
    // ASIN mode: Use ASIN price only
    if (userOverrides?.price !== null && userOverrides?.price !== undefined && userOverrides.price > 0) {
      assumedPrice = userOverrides.price;
      priceSource = "asin_price";
      assumptions.push("Using user-provided price override");
    } else if (asinSnapshot?.price !== null && asinSnapshot?.price !== undefined && asinSnapshot.price > 0) {
      assumedPrice = asinSnapshot.price;
      priceSource = "asin_price";
      assumptions.push("Using ASIN listing price");
    } else {
      assumedPrice = 25.0;
      priceSource = "fallback";
      assumptions.push("Price unavailable, using fallback $25.00");
    }
  } else {
    // KEYWORD mode: Use Page-1 avg price only
    if (userOverrides?.price !== null && userOverrides?.price !== undefined && userOverrides.price > 0) {
      assumedPrice = userOverrides.price;
      priceSource = "page1_avg";
      assumptions.push("Using user-provided price override");
    } else if (marketSnapshot?.avg_price !== null && marketSnapshot?.avg_price !== undefined && marketSnapshot.avg_price > 0) {
      assumedPrice = marketSnapshot.avg_price;
      priceSource = "page1_avg";
      assumptions.push("Using Page-1 average price");
    } else {
      assumedPrice = 25.0;
      priceSource = "fallback";
      assumptions.push("Price unavailable, using fallback $25.00");
    }
  }
  
  // STEP 2: Estimate COGS range by sourcing model
  let estimatedCogsMin: number | null = null;
  let estimatedCogsMax: number | null = null;
  let cogsSource: "assumption_engine" | "user_override" | "exact" = "assumption_engine";
  
  if (userOverrides?.cogs !== null && userOverrides?.cogs !== undefined && userOverrides.cogs > 0) {
    // User override: exact value
    estimatedCogsMin = userOverrides.cogs;
    estimatedCogsMax = userOverrides.cogs;
    cogsSource = "user_override";
    assumptions.push(`COGS: $${userOverrides.cogs.toFixed(2)} (user-provided)`);
  } else {
    // Use assumption engine
    const categoryHint = marketSnapshot?.category || null;
    const cogsEstimate = estimateCogsRange({
      price: assumedPrice,
      category: categoryHint,
      sourcing_model: sellerProfile.sourcing_model,
    });
    
    estimatedCogsMin = cogsEstimate.low;
    estimatedCogsMax = cogsEstimate.high;
    cogsSource = "assumption_engine";
    assumptions.push(`COGS: $${cogsEstimate.low.toFixed(2)}–$${cogsEstimate.high.toFixed(2)} (${cogsEstimate.rationale})`);
    
    // Apply not_sure widening (+10%)
    if (sellerProfile.sourcing_model === "not_sure") {
      const range = estimatedCogsMax - estimatedCogsMin;
      const widenBy = range * 0.1;
      estimatedCogsMin = Math.max(0, estimatedCogsMin - widenBy);
      estimatedCogsMax = estimatedCogsMax + widenBy;
      assumptions.push("Widened COGS range by +10% (sourcing model unknown)");
    }
    
    // Apply electronics widening (+10%)
    if (categoryHint && /electronics|tech|computer|phone|tablet/i.test(categoryHint)) {
      const range = estimatedCogsMax - estimatedCogsMin;
      const widenBy = range * 0.1;
      estimatedCogsMin = Math.max(0, estimatedCogsMin - widenBy);
      estimatedCogsMax = estimatedCogsMax + widenBy;
      assumptions.push("Widened COGS range by +10% (electronics category)");
    }
  }
  
  // STEP 3: Determine FBA fees
  let estimatedFbaFee: number | null = null;
  let fbaFeeSource: "sp_api" | "category_estimate" | "unknown" = "unknown";
  
  if (fbaFees?.total_fba_fees !== null && fbaFees?.total_fba_fees !== undefined && fbaFees.total_fba_fees > 0 && fbaFees.source === "sp_api") {
    // SP-API exact fee
    estimatedFbaFee = fbaFees.total_fba_fees;
    fbaFeeSource = "sp_api";
    assumptions.push(`FBA fees: $${estimatedFbaFee.toFixed(2)} (Amazon SP-API)`);
  } else {
    // Category estimate
    const categoryHint = marketSnapshot?.category || null;
    const feeEstimate = estimateFbaFeesByCategory(categoryHint);
    estimatedFbaFee = (feeEstimate.low + feeEstimate.high) / 2; // Midpoint
    fbaFeeSource = "category_estimate";
    assumptions.push(`FBA fees: $${estimatedFbaFee.toFixed(2)} (estimated: ${feeEstimate.label})`);
  }
  
  // STEP 4: Calculate net margins
  let netMarginMinPct: number | null = null;
  let netMarginMaxPct: number | null = null;
  
  if (estimatedCogsMin !== null && estimatedCogsMax !== null && estimatedFbaFee !== null) {
    // Net margin = (price - COGS - FBA_fees) / price
    const netMarginMin = assumedPrice - estimatedCogsMax - estimatedFbaFee;
    const netMarginMax = assumedPrice - estimatedCogsMin - estimatedFbaFee;
    
    netMarginMinPct = Math.max(0, (netMarginMin / assumedPrice) * 100);
    netMarginMaxPct = Math.max(0, (netMarginMax / assumedPrice) * 100);
  }
  
  // STEP 5: Calculate breakeven prices
  let breakevenPriceMin: number | null = null;
  let breakevenPriceMax: number | null = null;
  
  if (estimatedCogsMin !== null && estimatedCogsMax !== null && estimatedFbaFee !== null) {
    // Breakeven = COGS + FBA_fees
    breakevenPriceMin = estimatedCogsMin + estimatedFbaFee;
    breakevenPriceMax = estimatedCogsMax + estimatedFbaFee;
  }
  
  // STEP 6: Determine confidence tier
  let confidenceTier: "ESTIMATED" | "REFINED" | "EXACT" = "ESTIMATED";
  let confidenceReason: string;
  
  if (cogsSource === "user_override" && fbaFeeSource === "sp_api") {
    confidenceTier = "EXACT";
    confidenceReason = "User-provided COGS and Amazon SP-API FBA fees";
  } else if (cogsSource === "user_override") {
    confidenceTier = "REFINED";
    confidenceReason = "User-provided COGS with estimated FBA fees";
  } else if (fbaFeeSource === "sp_api") {
    confidenceTier = "REFINED";
    confidenceReason = "Amazon SP-API FBA fees with estimated COGS";
  } else {
    confidenceTier = "ESTIMATED";
    confidenceReason = "Estimated COGS and FBA fees based on sourcing model and category";
  }
  
  // Build snapshot
  return {
    mode: analysisMode,
    confidence_tier: confidenceTier,
    confidence_reason: confidenceReason,
    assumed_price: assumedPrice,
    price_source: priceSource,
    estimated_cogs_min: estimatedCogsMin,
    estimated_cogs_max: estimatedCogsMax,
    cogs_source: cogsSource,
    estimated_fba_fee: estimatedFbaFee,
    fba_fee_source: fbaFeeSource,
    net_margin_min_pct: netMarginMinPct,
    net_margin_max_pct: netMarginMaxPct,
    breakeven_price_min: breakevenPriceMin,
    breakeven_price_max: breakevenPriceMax,
    assumptions,
  };
}
