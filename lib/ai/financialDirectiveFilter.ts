/**
 * Financial Directive Filter
 * 
 * Detects and rewrites financial directive patterns in AI responses.
 * Ensures the model never gives personalized investment directives.
 */

/**
 * Check for financial directive patterns and rewrite to neutral alternatives
 * 
 * @param message - The AI assistant message to check
 * @returns Object with sanitized message and whether any patterns were detected
 */
export function sanitizeFinancialDirectives(message: string): {
  sanitized: string;
  detected: boolean;
  patterns: string[];
} {
  const patterns: string[] = [];
  let sanitized = message;
  let detected = false;

  // Pattern 1: "you should invest" variations (with amounts)
  const investAmountPatterns = [
    /you should invest\s+\$?[\d,]+(?:\.\d+)?/gi,
    /you should put in\s+\$?[\d,]+(?:\.\d+)?/gi,
    /you should allocate\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i recommend investing\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i recommend you invest\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i suggest investing\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i suggest you invest\s+\$?[\d,]+(?:\.\d+)?/gi,
  ];

  // Pattern 2: "spend $" variations
  const spendPatterns = [
    /you should spend\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i recommend spending\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i suggest spending\s+\$?[\d,]+(?:\.\d+)?/gi,
    /consider spending\s+\$?[\d,]+(?:\.\d+)?/gi,
  ];

  // Pattern 3: "borrow" / "take a loan" variations (with amounts)
  const borrowAmountPatterns = [
    /you should borrow\s+\$?[\d,]+(?:\.\d+)?/gi,
    /take a loan of\s+\$?[\d,]+(?:\.\d+)?/gi,
    /take out a loan of\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i recommend borrowing\s+\$?[\d,]+(?:\.\d+)?/gi,
    /i suggest borrowing\s+\$?[\d,]+(?:\.\d+)?/gi,
  ];

  // Pattern 4: "put in $" variations (with amounts, without "you should")
  const putInAmountPatterns = [
    /put in\s+\$?[\d,]+(?:\.\d+)?/gi,
    /put\s+\$?[\d,]+(?:\.\d+)?\s+into/gi,
  ];

  // Check all amount-based patterns first
  const allAmountPatterns = [
    ...investAmountPatterns,
    ...spendPatterns,
    ...borrowAmountPatterns,
    ...putInAmountPatterns,
  ];

  const neutralReplacement = "If you have a budget in mind, we can model scenarios at different spend levels";

  for (const pattern of allAmountPatterns) {
    if (pattern.test(sanitized)) {
      detected = true;
      patterns.push(pattern.source);
      
      // Replace with neutral alternative
      sanitized = sanitized.replace(pattern, neutralReplacement);
    }
  }

  // Also check for general directive patterns (without specific amounts)
  // Only match if not already replaced by amount patterns
  const generalDirectivePatterns = [
    /\byou should invest\b/gi,
    /\byou should borrow\b/gi,
    /\byou should take out a loan\b/gi,
    /\bi recommend you invest\b/gi,
    /\bi recommend you borrow\b/gi,
    /\bi suggest you invest\b/gi,
    /\bi suggest you borrow\b/gi,
  ];

  for (const pattern of generalDirectivePatterns) {
    if (pattern.test(sanitized) && !sanitized.includes(neutralReplacement)) {
      detected = true;
      patterns.push(pattern.source);
      
      // Replace with neutral alternative
      sanitized = sanitized.replace(
        pattern,
        "Consider modeling scenarios at different budget levels"
      );
    }
  }

  // Clean up duplicate replacements and extra whitespace
  const replacement1 = "If you have a budget in mind, we can model scenarios at different spend levels";
  const replacement2 = "Consider modeling scenarios at different budget levels";
  
  // Remove consecutive duplicate replacements
  sanitized = sanitized
    .replace(new RegExp(`(${replacement1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\.?\\s*\\1`, 'gi'), replacement1)
    .replace(new RegExp(`(${replacement2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\.?\\s*\\2`, 'gi'), replacement2)
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/\n\n\n+/g, "\n\n") // Clean up extra newlines
    .trim();

  return {
    sanitized,
    detected,
    patterns,
  };
}

