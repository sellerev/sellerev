/**
 * Memory Update Helpers
 * 
 * All memory updates require explicit user confirmation.
 * Never infer irreversible facts without confirmation.
 */

import { SellerMemory, HistoricalContext } from "./sellerMemory";

export interface MemoryUpdateRequest {
  type: "preference" | "assumption" | "historical" | "profile";
  field: string;
  value: unknown;
  explanation: string; // Why this update is being made
  requires_confirmation: boolean;
}

export interface MemoryUpdateResult {
  success: boolean;
  updated_memory: SellerMemory | null;
  error?: string;
}

/**
 * Updates seller memory with explicit confirmation
 * 
 * Rules:
 * - Only updates fields that user explicitly confirmed
 * - Never overwrites without confirmation
 * - All updates must have explanations
 */
export function updateSellerMemory(
  currentMemory: SellerMemory,
  update: MemoryUpdateRequest,
  confirmed: boolean = false
): MemoryUpdateResult {
  // Require confirmation for irreversible updates
  if (update.requires_confirmation && !confirmed) {
    return {
      success: false,
      updated_memory: null,
      error: "Update requires explicit user confirmation",
    };
  }

  const updated = { ...currentMemory };
  updated.updated_at = new Date().toISOString();

  try {
    switch (update.type) {
      case "preference":
        if (update.field in updated.preferences) {
          (updated.preferences as Record<string, unknown>)[update.field] = update.value;
        } else {
          return {
            success: false,
            updated_memory: null,
            error: `Unknown preference field: ${update.field}`,
          };
        }
        break;

      case "assumption":
        if (update.field in updated.saved_assumptions) {
          (updated.saved_assumptions as Record<string, unknown>)[update.field] = update.value;
        } else {
          return {
            success: false,
            updated_memory: null,
            error: `Unknown assumption field: ${update.field}`,
          };
        }
        break;

      case "profile":
        if (update.field in updated.seller_profile) {
          (updated.seller_profile as Record<string, unknown>)[update.field] = update.value;
        } else {
          return {
            success: false,
            updated_memory: null,
            error: `Unknown profile field: ${update.field}`,
          };
        }
        break;

      case "historical":
        // Historical updates are append-only
        const history = updated.historical_context;
        const field = update.field as keyof HistoricalContext;
        
        if (field in history && Array.isArray(history[field])) {
          const arr = history[field] as string[];
          const value = update.value as string;
          
          // Only append if not already present
          if (!arr.includes(value)) {
            arr.push(value);
          }
        } else {
          return {
            success: false,
            updated_memory: null,
            error: `Unknown historical field: ${update.field}`,
          };
        }
        break;

      default:
        return {
          success: false,
          updated_memory: null,
          error: `Unknown update type: ${update.type}`,
        };
    }

    return {
      success: true,
      updated_memory: updated,
    };
  } catch (error) {
    return {
      success: false,
      updated_memory: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Records an analyzed keyword (append-only, no confirmation needed)
 */
export function recordAnalyzedKeyword(
  memory: SellerMemory,
  keyword: string
): SellerMemory {
  const updated = { ...memory };
  if (!updated.historical_context.analyzed_keywords.includes(keyword)) {
    updated.historical_context.analyzed_keywords.push(keyword);
    updated.updated_at = new Date().toISOString();
  }
  return updated;
}

/**
 * Records an analyzed ASIN (append-only, no confirmation needed)
 */
export function recordAnalyzedAsin(
  memory: SellerMemory,
  asin: string
): SellerMemory {
  const updated = { ...memory };
  if (!updated.historical_context.analyzed_asins.includes(asin)) {
    updated.historical_context.analyzed_asins.push(asin);
    updated.updated_at = new Date().toISOString();
  }
  return updated;
}

/**
 * Records a rejected opportunity (requires confirmation)
 */
export function recordRejectedOpportunity(
  memory: SellerMemory,
  opportunity: string,
  confirmed: boolean = false
): MemoryUpdateResult {
  if (!confirmed) {
    return {
      success: false,
      updated_memory: null,
      error: "Recording rejected opportunity requires confirmation",
    };
  }

  const updated = { ...memory };
  if (!updated.historical_context.rejected_opportunities.includes(opportunity)) {
    updated.historical_context.rejected_opportunities.push(opportunity);
    updated.updated_at = new Date().toISOString();
  }

  return {
    success: true,
    updated_memory: updated,
  };
}

/**
 * Records an accepted opportunity (requires confirmation)
 */
export function recordAcceptedOpportunity(
  memory: SellerMemory,
  opportunity: string,
  confirmed: boolean = false
): MemoryUpdateResult {
  if (!confirmed) {
    return {
      success: false,
      updated_memory: null,
      error: "Recording accepted opportunity requires confirmation",
    };
  }

  const updated = { ...memory };
  if (!updated.historical_context.accepted_opportunities.includes(opportunity)) {
    updated.historical_context.accepted_opportunities.push(opportunity);
    updated.updated_at = new Date().toISOString();
  }

  return {
    success: true,
    updated_memory: updated,
  };
}
