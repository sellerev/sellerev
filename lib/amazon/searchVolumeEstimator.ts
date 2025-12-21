/**
 * Keyword Search Volume Estimation (Modeled, Not Exact)
 * 
 * Estimates search volume using:
 * - Rainforest search_information.total_results
 * - Page-1 density (listings count)
 * - Avg reviews (demand proxy)
 * - Sponsored count (competition intensity)
 * - Category heuristics
 * 
 * Rules:
 * - Always output a RANGE (never single number)
 * - Never imply this is Amazon-reported data
 * - Confidence caps based on data availability
 */

export interface SearchVolumeEstimate {
  search_volume_range: string; // e.g., "10k–20k", "30k–60k", "60k–120k"
  search_volume_confidence: "low" | "medium";
}

/**
 * Category multipliers for search volume estimation
 * Different categories have different typical search volumes
 */
const CATEGORY_MULTIPLIERS: Record<string, number> = {
  electronics: 1.5, // Higher search volume
  beauty: 1.3,
  home: 1.0, // Baseline
  health: 0.9,
  default: 1.0,
};

/**
 * Infer category from keyword
 */
function inferCategory(keyword: string): string {
  const normalized = keyword.toLowerCase();
  
  if (/electronic|tech|computer|phone|tablet|headphone|speaker|smartwatch/i.test(normalized)) {
    return "electronics";
  }
  if (/beauty|cosmetic|skincare|makeup|hair|perfume|nail/i.test(normalized)) {
    return "beauty";
  }
  if (/home|kitchen|cookware|furniture|decor|bedding/i.test(normalized)) {
    return "home";
  }
  if (/fitness|health|supplement|vitamin|workout|exercise|gym/i.test(normalized)) {
    return "health";
  }
  
  return "default";
}

/**
 * Estimate search volume from Page-1 metrics
 * 
 * Base formula considers:
 * 1. total_results (if available) - broader market size
 * 2. page1_listings - Page-1 saturation
 * 3. avg_reviews - demand proxy (more reviews = more searches historically)
 * 4. sponsored_count - competition intensity (more sponsored = more searches)
 * 5. category multiplier - category-specific adjustments
 */
export function estimateSearchVolume(
  totalResults: number | null,
  page1Listings: number,
  avgReviews: number | null,
  sponsoredCount: number,
  keyword: string
): SearchVolumeEstimate {
  // Infer category
  const category = inferCategory(keyword);
  const categoryMultiplier = CATEGORY_MULTIPLIERS[category] || CATEGORY_MULTIPLIERS.default;
  
  // Base estimation factors
  let baseVolume = 0;
  
  // Factor 1: Use total_results if available (scaled down to monthly searches)
  // Amazon total_results is typically much higher than monthly searches
  // Rough heuristic: monthly searches ≈ total_results / 50 (conservative)
  if (totalResults !== null && totalResults > 0) {
    baseVolume = Math.min(totalResults / 50, 200000); // Cap at 200k to avoid outliers
  } else {
    // Factor 2: Page-1 density heuristic
    // More Page-1 listings suggests higher search volume
    // Typical range: 10-30k searches/month for well-populated Page 1
    baseVolume = page1Listings * 1500; // ~1.5k searches per Page-1 listing
  }
  
  // Factor 3: Average reviews (demand proxy)
  // Higher reviews suggest more historical searches
  let reviewMultiplier = 1.0;
  if (avgReviews !== null && avgReviews > 0) {
    // Normalize: 1000 reviews ≈ 1.0x, 10000 reviews ≈ 1.3x
    reviewMultiplier = 1.0 + (Math.log10(Math.max(avgReviews, 100)) - 2) * 0.15;
    reviewMultiplier = Math.max(0.8, Math.min(1.5, reviewMultiplier)); // Clamp 0.8-1.5x
  }
  
  // Factor 4: Sponsored count (competition intensity)
  // More sponsored ads = more competitive = likely higher search volume
  let sponsoredMultiplier = 1.0;
  if (sponsoredCount > 0 && page1Listings > 0) {
    const sponsoredRatio = sponsoredCount / page1Listings;
    // 0% sponsored → 0.9x, 50% sponsored → 1.2x, 100% sponsored → 1.5x
    sponsoredMultiplier = 0.9 + sponsoredRatio * 0.6;
  }
  
  // Apply all multipliers
  const estimatedVolume = baseVolume * categoryMultiplier * reviewMultiplier * sponsoredMultiplier;
  
  // Convert to range format (always range, never single number)
  // Ranges are ±30% around the estimate
  const minVolume = Math.round(estimatedVolume * 0.7);
  const maxVolume = Math.round(estimatedVolume * 1.3);
  
  // Format as readable string (k for thousands, M for millions)
  const formatRange = (min: number, max: number): string => {
    if (min >= 1000000 || max >= 1000000) {
      // Millions
      const minM = (min / 1000000).toFixed(1).replace(/\.0$/, '');
      const maxM = (max / 1000000).toFixed(1).replace(/\.0$/, '');
      return `${minM}M–${maxM}M`;
    } else if (min >= 1000 || max >= 1000) {
      // Thousands
      const minK = Math.round(min / 1000);
      const maxK = Math.round(max / 1000);
      return `${minK}k–${maxK}k`;
    } else {
      // Hundreds
      return `${min}–${max}`;
    }
  };
  
  const searchVolumeRange = formatRange(minVolume, maxVolume);
  
  // Confidence determination
  // Start with "medium" if we have good data
  let confidence: "low" | "medium" = "medium";
  
  // Downgrade to "low" if:
  // - total_results missing AND page1_listings < 20
  // - avg_reviews missing
  // - sponsored_count missing (but we check sponsoredCount > 0, so 0 is valid)
  if (totalResults === null && page1Listings < 20) {
    confidence = "low";
  }
  if (avgReviews === null) {
    confidence = "low";
  }
  
  // If page1 listings < 20, widen the range further (±50%)
  let finalRange = searchVolumeRange;
  if (page1Listings < 20) {
    const widerMin = Math.round(estimatedVolume * 0.5);
    const widerMax = Math.round(estimatedVolume * 1.5);
    finalRange = formatRange(widerMin, widerMax);
  }
  
  return {
    search_volume_range: finalRange,
    search_volume_confidence: confidence,
  };
}
