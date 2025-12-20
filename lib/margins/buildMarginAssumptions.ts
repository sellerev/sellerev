/**
 * PART H: Margin Assumptions Builder
 * 
 * Builds initial margin assumptions from seller context and analysis data.
 * Used to initialize margin_assumptions when missing.
 */

import { MarginAssumptions } from "@/types/margin";
import { estimateCogsRange } from "@/lib/cogs/assumptions";
import { estimateFbaFeesByCategory } from "./calculateMarginSnapshot";

type SourcingModel =
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

interface BuildMarginAssumptionsParams {
  analysisMode: "ASIN" | "KEYWORD";
  sellerProfile: {
    sourcing_model: SourcingModel;
  };
  marketSnapshot: {
    avg_price: number | null;
  } | null;
  asinSnapshot: {
    price: number | null;
    fulfillment: "FBA" | "FBM" | "Amazon" | null;
  } | null;
  categoryHint: string | null;
  fbaFeeFromSpApi: number | null;
  fbaFeeIsFromSpApi: boolean;
}

/**
 * Build initial margin assumptions from available data
 * 
 * RULES:
 * - Selling price: ASIN → asinSnapshot.price, KEYWORD → marketSnapshot.avg_price, Fallback → null
 * - COGS range: By sourcing_model (Private Label 25-35%, Wholesale 55-75%, etc.)
 * - FBA Fee: Use SP-API if available, else category estimate, else null
 * - Fulfillment model: From asinSnapshot.fulfillment or default to UNKNOWN
 * - Default: confidence_tier = 'ESTIMATED', source = 'assumption_engine'
 */
export function buildMarginAssumptions({
  analysisMode,
  sellerProfile,
  marketSnapshot,
  asinSnapshot,
  categoryHint,
  fbaFeeFromSpApi,
  fbaFeeIsFromSpApi,
}: BuildMarginAssumptionsParams): MarginAssumptions {
  // Step 1: Extract selling price
  let sellingPrice: number | null = null;
  
  if (analysisMode === "ASIN" && asinSnapshot?.price !== null && asinSnapshot?.price !== undefined) {
    sellingPrice = asinSnapshot.price;
  } else if (analysisMode === "KEYWORD" && marketSnapshot?.avg_price !== null && marketSnapshot?.avg_price !== undefined) {
    sellingPrice = marketSnapshot.avg_price;
  }

  // Step 2: Estimate COGS range by sourcing_model
  let cogsLow: number | null = null;
  let cogsHigh: number | null = null;
  
  if (sellingPrice !== null && sellingPrice > 0) {
    const cogsEstimate = estimateCogsRange({
      price: sellingPrice,
      category: categoryHint,
      sourcing_model: sellerProfile.sourcing_model,
    });
    cogsLow = cogsEstimate.low;
    cogsHigh = cogsEstimate.high;
  }

  // Step 3: Determine FBA fee
  let fbaFee: number | null = null;
  let confidenceTier: 'ESTIMATED' | 'REFINED' | 'EXACT' = 'ESTIMATED';
  let source: 'assumption_engine' | 'user_override' | 'sp_api' = 'assumption_engine';

  if (fbaFeeIsFromSpApi && fbaFeeFromSpApi !== null && fbaFeeFromSpApi > 0) {
    // SP-API fee available (PART H: EXACT tier)
    fbaFee = fbaFeeFromSpApi;
    confidenceTier = 'EXACT';
    source = 'sp_api';
  } else if (sellingPrice !== null && sellingPrice > 0) {
    // Estimate by category
    const feeEstimate = estimateFbaFeesByCategory(categoryHint);
    fbaFee = (feeEstimate.low + feeEstimate.high) / 2; // Use midpoint
    confidenceTier = 'ESTIMATED';
    source = 'assumption_engine';
  }

  // Step 4: Determine fulfillment model
  let fulfillmentModel: 'FBA' | 'FBM' | 'UNKNOWN' = 'UNKNOWN';
  if (asinSnapshot?.fulfillment) {
    if (asinSnapshot.fulfillment === 'FBA' || asinSnapshot.fulfillment === 'Amazon') {
      fulfillmentModel = 'FBA';
    } else if (asinSnapshot.fulfillment === 'FBM') {
      fulfillmentModel = 'FBM';
    }
  }

  // Step 5: Build assumptions object
  return {
    selling_price: sellingPrice,
    cogs_low: cogsLow,
    cogs_high: cogsHigh,
    fba_fee: fbaFee,
    fulfillment_model: fulfillmentModel,
    confidence_tier: confidenceTier,
    source,
    last_updated_at: new Date().toISOString(),
  };
}
