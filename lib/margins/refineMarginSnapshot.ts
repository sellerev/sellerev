/**
 * Margin Snapshot Refinement
 * 
 * Applies user refinements to margin snapshot and recalculates values.
 * Upgrades confidence tier from ESTIMATED → REFINED.
 */

import { MarginSnapshot } from "@/types/margin";

interface RefinementInput {
  cogs?: number | null;
  fbaFee?: number | null;
}

/**
 * Refine margin snapshot with user-provided costs
 * 
 * @param snapshot - Current margin snapshot
 * @param refinement - User-provided refinements
 * @returns Updated margin snapshot with refined values and RECALCULATED margins
 */
export function refineMarginSnapshot(
  snapshot: MarginSnapshot,
  refinement: RefinementInput
): MarginSnapshot {
  const updated: MarginSnapshot = {
    ...snapshot,
    assumptions: [...snapshot.assumptions],
  };

  // Apply COGS refinement
  if (refinement.cogs !== undefined && refinement.cogs !== null && refinement.cogs > 0) {
    updated.estimated_cogs_min = refinement.cogs;
    updated.estimated_cogs_max = refinement.cogs; // Single value → use for both
    updated.cogs_source = "user_override";
    updated.assumptions.push(`COGS refined to $${refinement.cogs.toFixed(2)} (user-provided)`);
  }

  // Apply FBA fee refinement
  if (refinement.fbaFee !== undefined && refinement.fbaFee !== null && refinement.fbaFee > 0) {
    updated.estimated_fba_fee = refinement.fbaFee;
    // Note: Part G contract uses "sp_api" | "category_estimate" | "unknown"
    // User refinements are noted in assumptions and confidence_reason, not in fba_fee_source
    // Keep existing source (or use category_estimate if unknown) - refinement is tracked via confidence_tier
    if (updated.fba_fee_source === "unknown") {
      updated.fba_fee_source = "category_estimate";
    }
    updated.assumptions.push(`FBA fees refined to $${refinement.fbaFee.toFixed(2)} (user-provided)`);
  }

  // Recalculate net margins if we have required values
  if (updated.estimated_cogs_min !== null && updated.estimated_cogs_max !== null && updated.estimated_fba_fee !== null) {
    // Net margin = (price - COGS - FBA_fees) / price
    const netMarginMin = updated.assumed_price - updated.estimated_cogs_max - updated.estimated_fba_fee;
    const netMarginMax = updated.assumed_price - updated.estimated_cogs_min - updated.estimated_fba_fee;

    updated.net_margin_min_pct = Math.max(0, (netMarginMin / updated.assumed_price) * 100);
    updated.net_margin_max_pct = Math.max(0, (netMarginMax / updated.assumed_price) * 100);

    // Recalculate breakeven prices
    // Breakeven = COGS + FBA_fees
    updated.breakeven_price_min = updated.estimated_cogs_min + updated.estimated_fba_fee;
    updated.breakeven_price_max = updated.estimated_cogs_max + updated.estimated_fba_fee;
  }

  // Update confidence tier: If any refinement applied, upgrade to REFINED
  if (refinement.cogs !== undefined || refinement.fbaFee !== undefined) {
    updated.confidence_tier = "REFINED";
    
    // Update confidence reason
    const refinedParts: string[] = [];
    if (refinement.cogs !== undefined && refinement.cogs !== null) {
      refinedParts.push("user-provided COGS");
    }
    if (refinement.fbaFee !== undefined && refinement.fbaFee !== null) {
      refinedParts.push("user-provided FBA fees");
    }
    updated.confidence_reason = `Using ${refinedParts.join(" and ")}`;
  }

  return updated;
}
