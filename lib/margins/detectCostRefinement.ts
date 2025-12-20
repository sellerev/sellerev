/**
 * Cost Refinement Detection
 * 
 * Lightweight intent detector for cost refinements (COGS and FBA fees).
 * Uses regex + numeric extraction - no OpenAI calls.
 */

interface CostRefinement {
  cogs?: number | null;
  fbaFee?: number | null;
  validationError?: string;
}

/**
 * Detect cost refinement intents in user message
 * 
 * Detects patterns like:
 * - "My COGS is $21"
 * - "COGS is 18"
 * - "$9 fees"
 * - "FBA is 10.50"
 * - "use $22 COGS"
 * - "update fees to $8"
 * 
 * @param message - User's chat message
 * @param sellingPrice - Current selling price (for validation)
 * @returns Detected refinements or null
 */
export function detectCostRefinement(
  message: string,
  sellingPrice: number | null
): CostRefinement | null {
  const normalized = message.toLowerCase().trim();
  const result: CostRefinement = {};

  // Pattern 1: COGS detection
  const cogsPatterns = [
    /\b(?:my\s+)?(?:cogs?|cost)\s+(?:is|are|:)\s+\$?([\d,]+\.?\d*)/i,
    /\b(?:cogs?|cost)\s+of\s+\$?([\d,]+\.?\d*)/i,
    /\$?([\d,]+\.?\d*)\s+(?:for\s+)?(?:cogs?|cost)/i,
    /\b(?:use|set|update)\s+\$?([\d,]+\.?\d*)\s+(?:for\s+)?(?:cogs?|cost)/i,
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
  const fbaFeePatterns = [
    /\b(?:fba|fulfillment)\s+fee(?:s)?\s+(?:is|are|:)\s+\$?([\d,]+\.?\d*)/i,
    /\b(?:fba|fulfillment)\s+fee(?:s)?\s+of\s+\$?([\d,]+\.?\d*)/i,
    /\$?([\d,]+\.?\d*)\s+(?:for\s+)?(?:fba|fulfillment)\s+fee(?:s)?/i,
    /\b(?:use|set|update)\s+\$?([\d,]+\.?\d*)\s+(?:for\s+)?(?:fba|fulfillment)\s+fee(?:s)?/i,
    /\b(?:fba|fees?)\s+(?:is|are|:)\s+\$?([\d,]+\.?\d*)/i,
  ];

  for (const pattern of fbaFeePatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(value) && value > 0 && value < 100) { // Reasonable FBA fee range
        // Validate: FBA fee should be less than selling price
        if (sellingPrice !== null && value >= sellingPrice) {
          result.validationError = `FBA fees ($${value.toFixed(2)}) cannot be greater than or equal to selling price ($${sellingPrice.toFixed(2)})`;
          return result;
        }
        result.fbaFee = value;
        break;
      }
    }
  }

  // Return null if no refinements detected
  if (result.cogs === undefined && result.fbaFee === undefined && !result.validationError) {
    return null;
  }

  return result;
}
