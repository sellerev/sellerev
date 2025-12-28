/**
 * Market Aggregates - Deterministic Calculations
 * 
 * Always returns values, never null/undefined.
 * H10-style: hard data always renders.
 */

import { ParsedListing } from "./keywordMarket";

/**
 * Compute average reviews from listings
 * 
 * Rules:
 * - Includes ALL listings (sponsored included, like H10)
 * - Only filters out null/undefined/0 reviews
 * - Always returns a number (0 if no valid reviews)
 */
export function computeAvgReviews(listings: ParsedListing[]): number {
  const valid: number[] = listings
    .map(l => l.reviews)
    .filter((r): r is number => typeof r === 'number' && r > 0);
  
  if (!valid.length) return 0;
  
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}
