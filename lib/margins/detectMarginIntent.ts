/**
 * PART H: Margin Intent Detection
 * 
 * Detects when user wants to estimate margins or refine costs.
 * Used to trigger margin calculation and cost refinement loop.
 */

/**
 * Detect margin-related intents in user message
 * 
 * Intents:
 * 1) ESTIMATE MARGINS: "estimate margins", "what are margins", "profitability", "can this make money"
 * 2) USER OVERRIDES COSTS: Detected by parseCostOverrides (separate function)
 * 
 * @param message - User's chat message
 * @returns Intent type or null
 */
export function detectMarginIntent(message: string): 'estimate_margins' | 'override_costs' | null {
  const normalized = message.toLowerCase().trim();

  // Intent 1: Estimate margins
  const estimatePatterns = [
    /\b(?:estimate|calculate|show|what\s+are|tell\s+me\s+about)\s+(?:the\s+)?(?:margins?|profitability|profit)\b/i,
    /\b(?:can\s+this|does\s+this|will\s+this)\s+(?:make|earn|generate)\s+(?:money|profit)\b/i,
    /\bis\s+(?:this|it)\s+(?:profitable|profitable)\b/i,
    /\b(?:margin|profit)\s+(?:estimate|calculation|breakdown)\b/i,
  ];

  for (const pattern of estimatePatterns) {
    if (pattern.test(normalized)) {
      return 'estimate_margins';
    }
  }

  // Intent 2: Override costs (detected by parseCostOverrides, but we can hint here)
  // This is handled separately by parseCostOverrides function
  // We return null here and let parseCostOverrides handle it

  return null;
}
