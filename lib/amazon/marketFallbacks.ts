/**
 * Market Data Fallbacks
 * 
 * Provides fallback values when Rainforest API returns no results.
 * Ensures the UI always has data to render, even if estimated.
 */

import { KeywordMarketSnapshot, KeywordMarketData, ParsedListing } from "./keywordMarket";

/**
 * Builds a fallback market snapshot when Rainforest returns no results.
 * Uses category medians, cached data, or global defaults.
 */
export function buildFallbackMarketSnapshot(
  keyword: string,
  category?: string | null
): KeywordMarketSnapshot {
  // Category-based defaults (can be enhanced with cached medians later)
  const categoryDefaults: Record<string, { avgPrice: number; avgReviews: number }> = {
    "Home & Kitchen": { avgPrice: 25.0, avgReviews: 250 },
    "Electronics": { avgPrice: 45.0, avgReviews: 180 },
    "Sports & Outdoors": { avgPrice: 30.0, avgReviews: 200 },
    "Health & Personal Care": { avgPrice: 20.0, avgReviews: 300 },
    "Beauty & Personal Care": { avgPrice: 18.0, avgReviews: 350 },
  };

  // Default to Home & Kitchen if category unknown
  const defaults = categoryDefaults[category || ""] || categoryDefaults["Home & Kitchen"];

  return {
    keyword,
    avg_price: defaults.avgPrice,
    avg_reviews: defaults.avgReviews, // Always a number
    avg_rating: 4.2, // Typical Amazon average
    avg_bsr: null,
    total_page1_listings: 0,
    sponsored_count: 0,
    dominance_score: 0,
    fulfillment_mix: {
      fba: 65, // Default distribution
      fbm: 25,
      amazon: 10,
    },
  };
}

/**
 * Builds a complete KeywordMarketData with fallback snapshot and empty listings.
 */
export function buildFallbackKeywordMarketData(
  keyword: string,
  category?: string | null
): KeywordMarketData {
  return {
    snapshot: buildFallbackMarketSnapshot(keyword, category),
    listings: [],
  };
}

/**
 * Estimates search volume using modeled fallback when no real data exists.
 * Helium-10 style: always returns a range, never null.
 */
export function estimateSearchVolumeFallback(
  page1Count: number,
  category?: string | null
): { min: number; max: number; source: "modeled"; confidence: "low" | "medium" } {
  // Base volume calculation
  const base = page1Count > 0 ? page1Count * 1500 : 12000;

  // Category multipliers (adjust base volume by category)
  const categoryMultipliers: Record<string, number> = {
    "Electronics": 1.3,
    "Home & Kitchen": 1.0,
    "Sports & Outdoors": 0.9,
    "Health & Personal Care": 1.2,
    "Beauty & Personal Care": 1.4,
  };

  const multiplier = categoryMultipliers[category || ""] || 1.0;
  const estimatedVolume = Math.round(base * multiplier);

  // Return range (70% to 130% of estimate)
  return {
    min: Math.round(estimatedVolume * 0.7),
    max: Math.round(estimatedVolume * 1.3),
    source: "modeled",
    confidence: category ? "medium" : "low",
  };
}
