export type DataIntent = "ANALYSIS_ONLY" | "REQUIRES_LIVE_DATA" | "INVALID_STATE";

export interface GuardrailInput {
  question: string;
  selectedAsins: string[];
  hasSnapshot: boolean;
  creditsAvailable: number;
}

export interface GuardrailResult {
  intent: DataIntent;
  requiresCredits: boolean;
  creditsRequired: number;
  reason?: string;
  blockingMessage?: string;
}

/**
 * Server-side chat guardrails (single source of truth).
 *
 * IMPORTANT PRODUCT RULES:
 * - Chat is never blocked for analysis-only questions when a snapshot exists.
 * - Credits are only required for NEW DATA (Rainforest escalation), not for Page-1 Q&A.
 * - SP-API fees are "live data" but are NOT tied to Seller Credits in the current system.
 */
export function evaluateChatGuardrails({
  question,
  selectedAsins,
  hasSnapshot,
  creditsAvailable,
}: GuardrailInput): GuardrailResult {
  const normalized = (question || "").toLowerCase();

  // Product-specific signal (explicit ASIN, rank reference, or "this product").
  // Used to avoid hard-blocking broad Page-1 questions that mention specs/fees generically.
  const isProductSpecific =
    /\b(B[A-Z0-9]{9})\b/i.test(question || "") ||
    /\b(product|listing|rank|position)\s*(?:#|number)?\s*\d+\b/i.test(normalized) ||
    /\b(this|that)\s+product\b/i.test(normalized);

  const wantsFees =
    /\b(fees?|fba|profit|profitability|margin|referral fee|fulfillment fee)\b/i.test(normalized);

  // "Live data" signals that typically imply escalation / refresh.
  // NOTE: we keep this conservative; Page-1 questions should stay ANALYSIS_ONLY.
  const wantsPerAsinLive =
    /\b(refresh|recalculate|re-run|rerun|pull live|look up live|live data)\b/i.test(normalized) ||
    /\b(30\s*day|last\s*30\s*days)\b/i.test(normalized);

  // 1) Fee / explicit live intents
  if (wantsFees || wantsPerAsinLive) {
    // Only hard-require a selected ASIN when the user is asking for a specific ASIN-level lookup.
    // Broad Page-1 questions must remain answerable without product selection.
    if (selectedAsins.length !== 1 && isProductSpecific) {
      return {
        intent: "INVALID_STATE",
        requiresCredits: false,
        creditsRequired: 0,
        blockingMessage: "Please select **exactly 1 product** to run this lookup.",
      };
    }

    // If fees are mentioned but no specific product is selected/referenced, treat as analysis-only (no live lookup).
    if (wantsFees && selectedAsins.length !== 1) {
      if (hasSnapshot) {
        return {
          intent: "ANALYSIS_ONLY",
          requiresCredits: false,
          creditsRequired: 0,
          reason: "General fees/margin question without a specific product selected.",
        };
      }
    }

    // Fees use SP-API (no Seller Credits) when a specific ASIN is selected.
    if (wantsFees && selectedAsins.length === 1) {
      return {
        intent: "REQUIRES_LIVE_DATA",
        requiresCredits: false,
        creditsRequired: 0,
        reason: "Live Amazon fee quote required (SP-API).",
      };
    }

    // Other live refreshes may require credits (Rainforest).
    return {
      intent: "REQUIRES_LIVE_DATA",
      requiresCredits: true,
      creditsRequired: 1,
      reason: "Live product data required (Rainforest escalation).",
      blockingMessage:
        creditsAvailable >= 1 ? undefined : "This requires live product data. You have 0 credits remaining.",
    };
  }

  // 2) Analysis-only Q&A
  if (hasSnapshot) {
    return {
      intent: "ANALYSIS_ONLY",
      requiresCredits: false,
      creditsRequired: 0,
    };
  }

  // 3) No snapshot edge case
  return {
    intent: "INVALID_STATE",
    requiresCredits: false,
    creditsRequired: 0,
    blockingMessage:
      "No market snapshot loaded. Please open a previous search or run a new one.",
  };
}


