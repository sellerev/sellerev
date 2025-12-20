/**
 * PART H: Cost Override Parser
 * 
 * Parses user messages to detect cost overrides (COGS, FBA fees, fulfillment model).
 * Used for chat-driven cost refinement loop.
 */

interface ParsedCostOverrides {
  cogs?: number | null;
  fbaFee?: number | null;
  fulfillmentModel?: 'FBA' | 'FBM' | null;
  validationError?: string;
}

/**
 * Parse cost overrides from user message
 * 
 * Detects patterns like:
 * - "My COGS is $22"
 * - "FBA fee is $9.40"
 * - "I ship FBM"
 * - "My cost is 21 dollars"
 * 
 * @param message - User's chat message
 * @param sellingPrice - Current selling price (for validation)
 * @returns Parsed cost overrides or null if none detected
 */
export function parseCostOverrides(
  message: string,
  sellingPrice: number | null
): ParsedCostOverrides | null {
  const normalized = message.toLowerCase().trim();
  const result: ParsedCostOverrides = {};

  // Pattern 1: COGS detection
  // Matches: "my cogs is $22", "cogs is 21", "cost is $20", "my cost is 21 dollars"
  const cogsPatterns = [
    /\b(?:my\s+)?(?:cogs?|cost)\s+(?:is|are)\s+\$?([\d,]+\.?\d*)/i,
    /\b(?:cogs?|cost)\s+of\s+\$?([\d,]+\.?\d*)/i,
    /\$?([\d,]+\.?\d*)\s+(?:for\s+)?(?:cogs?|cost)/i,
  ];

  for (const pattern of cogsPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(value) && value > 0) {
        // Validate: COGS should be less than selling price
        if (sellingPrice !== null && value >= sellingPrice) {
          result.validationError = `COGS ($${value.toFixed(2)}) cannot be greater than or equal to selling price ($${sellingPrice.toFixed(2)})`;
          return result;
        }
        result.cogs = value;
        break;
      }
    }
  }

  // Pattern 2: FBA fee detection
  // Matches: "fba fee is $9.40", "fba fees are 8.50", "fulfillment fee $9"
  const fbaFeePatterns = [
    /\b(?:fba|fulfillment)\s+fee(?:s)?\s+(?:is|are)\s+\$?([\d,]+\.?\d*)/i,
    /\b(?:fba|fulfillment)\s+fee(?:s)?\s+of\s+\$?([\d,]+\.?\d*)/i,
    /\$?([\d,]+\.?\d*)\s+(?:for\s+)?(?:fba|fulfillment)\s+fee(?:s)?/i,
  ];

  for (const pattern of fbaFeePatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(value) && value > 0 && value < 100) { // Reasonable FBA fee range
        result.fbaFee = value;
        break;
      }
    }
  }

  // Pattern 3: Fulfillment model detection
  // Matches: "I ship FBM", "fulfillment is FBA", "I use FBA"
  const fulfillmentPatterns = [
    /\b(?:i\s+)?(?:ship|fulfill|use)\s+(?:with\s+)?(fba|fbm)\b/i,
    /\b(?:fulfillment\s+is|fulfillment\s+model\s+is)\s+(fba|fbm)\b/i,
  ];

  for (const pattern of fulfillmentPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const model = match[1].toUpperCase();
      if (model === 'FBA' || model === 'FBM') {
        result.fulfillmentModel = model as 'FBA' | 'FBM';
        break;
      }
    }
  }

  // Return null if no overrides detected
  if (result.cogs === undefined && result.fbaFee === undefined && result.fulfillmentModel === undefined) {
    return null;
  }

  return result;
}
