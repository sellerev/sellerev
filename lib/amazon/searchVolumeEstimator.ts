/**
 * Keyword Search Volume Estimation (H10-Style, Deterministic)
 * 
 * ALWAYS returns a value when Page-1 listings exist.
 * Never returns null, undefined, or "Not available".
 * 
 * Core Heuristic (H10-style, deterministic):
 * - Base volume: page1Listings.length * 1800
 * - Review multiplier: <100 → 0.7x, 100–500 → 1.0x, 500–1500 → 1.3x, 1500+ → 1.6x
 * - Sponsored pressure: >30% sponsored → +20%
 * - Category multiplier: Electronics/Home → 1.1–1.3x, Niche → 0.8–1.0x
 * 
 * Output: Always returns a range (min, max) with confidence level
 */

import { ParsedListing } from "./keywordMarket";

export interface SearchVolumeEstimate {
  min: number;
  max: number;
  confidence: 'low' | 'medium';
}

/**
 * Estimate search volume using H10-style deterministic heuristics
 * 
 * @param page1Listings - Array of Page-1 listings (required)
 * @param sponsoredCount - Number of sponsored listings
 * @param avgReviews - Average review count across listings
 * @param category - Optional category string for multiplier
 * @returns Always returns a range (never null)
 */
export function estimateSearchVolume({
  page1Listings,
  sponsoredCount,
  avgReviews,
  category
}: {
  page1Listings: ParsedListing[];
  sponsoredCount: number;
  avgReviews: number;
  category?: string;
}): { min: number; max: number; confidence: 'low' | 'medium' } {
  // Base volume: page1Listings.length * 1800
  const base = page1Listings.length * 1800;
  
  // Review multiplier
  let reviewMultiplier = 1.0;
  if (avgReviews < 100) {
    reviewMultiplier = 0.7;
  } else if (avgReviews >= 100 && avgReviews < 500) {
    reviewMultiplier = 1.0;
  } else if (avgReviews >= 500 && avgReviews < 1500) {
    reviewMultiplier = 1.3;
  } else {
    reviewMultiplier = 1.6;
  }
  
  // Sponsored pressure: >30% sponsored → +20%
  const totalListings = page1Listings.length;
  const sponsoredRatio = totalListings > 0 ? sponsoredCount / totalListings : 0;
  const sponsoredMultiplier = sponsoredRatio > 0.3 ? 1.2 : 1.0;
  
  // Category multiplier
  let categoryMultiplier = 1.0;
  if (category) {
    const normalizedCategory = category.toLowerCase();
    if (/electronic|home|kitchen/i.test(normalizedCategory)) {
      // Electronics / Home → 1.1–1.3x (randomize slightly for range)
      categoryMultiplier = 1.2;
    } else {
      // Niche categories → 0.8–1.0x
      categoryMultiplier = 0.9;
    }
  }
  
  // Apply all multipliers
  const estimatedVolume = base * reviewMultiplier * sponsoredMultiplier * categoryMultiplier;
  
  // Always return a range: min = round(base * 0.7), max = round(base * 1.3)
  const min = Math.round(estimatedVolume * 0.7);
  const max = Math.round(estimatedVolume * 1.3);
  
  // Confidence: low if category unknown, medium otherwise
  const confidence: 'low' | 'medium' = category ? 'medium' : 'low';
  
  return { min, max, confidence };
}
