/**
 * PPC Indicators Computation
 * 
 * Computes heuristic PPC indicators from Page-1 market data.
 * Data-first approach: only uses actual Rainforest data, no speculation.
 */

import { ParsedListing } from "./keywordMarket";

export interface PPCIndicators {
  sponsored_pct: number; // 0-100, percentage of listings that are sponsored
  sponsored_count: number;
  review_barrier: number | null; // Median reviews of top 10 organic listings
  price_competition: number | null; // (p90 - p10) / avg_price
  dominance: number; // Top brand share (0-100), same as dominance_score
  ad_intensity_label: "Low" | "Medium" | "High";
  signals: string[]; // Max 3 signal bullets explaining the intensity
  source: "heuristic_v1";
}

/**
 * Compute PPC indicators from Page-1 listings
 * 
 * @param listings - All Page-1 listings (sponsored + organic)
 * @param totalListings - Total Page-1 listings count
 * @param sponsoredCount - Count of sponsored listings
 * @param dominanceScore - Top brand share percentage (0-100)
 * @param avgPrice - Average price of all listings
 * @returns PPC indicators with ad intensity assessment
 */
export function computePPCIndicators(
  listings: ParsedListing[],
  totalListings: number,
  sponsoredCount: number,
  dominanceScore: number,
  avgPrice: number | null
): PPCIndicators {
  // Calculate sponsored_pct
  const sponsored_pct = totalListings > 0 
    ? Math.round((sponsoredCount / totalListings) * 100)
    : 0;

  // Calculate review_barrier: median reviews of top 10 organic listings
  const organicListings = listings
    .filter(l => !l.appearsSponsored) // Use appearsSponsored (ASIN-level), NOT is_sponsored
    .sort((a, b) => (a.position || 999) - (b.position || 999)) // Sort by organic rank
    .slice(0, 10); // Top 10 organic

  const organicReviews = organicListings
    .map(l => l.reviews)
    .filter((r): r is number => r !== null && r !== undefined && r > 0);

  let review_barrier: number | null = null;
  if (organicReviews.length > 0) {
    const sorted = [...organicReviews].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    review_barrier = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  // Calculate price_competition: (p90 - p10) / avg_price
  let price_competition: number | null = null;
  if (avgPrice !== null && avgPrice > 0 && listings.length >= 10) {
    const prices = listings
      .map(l => l.price)
      .filter((p): p is number => p !== null && p !== undefined && p > 0);

    if (prices.length >= 10) {
      const sorted = [...prices].sort((a, b) => a - b);
      const p10Index = Math.floor(prices.length * 0.1);
      const p90Index = Math.floor(prices.length * 0.9);
      const p10 = sorted[p10Index];
      const p90 = sorted[p90Index];
      
      if (p10 && p90 && p90 > p10) {
        price_competition = (p90 - p10) / avgPrice;
      }
    }
  }

  // Determine sponsored density (low/med/high)
  let sponsoredDensity: "Low" | "Medium" | "High";
  if (sponsored_pct >= 50) {
    sponsoredDensity = "High";
  } else if (sponsored_pct >= 25) {
    sponsoredDensity = "Medium";
  } else {
    sponsoredDensity = "Low";
  }

  // Determine ad intensity label based on heuristics
  // Factors: sponsored_pct, review_barrier, price_competition, dominance
  let ad_intensity_label: "Low" | "Medium" | "High";
  const signals: string[] = [];

  // Heuristic scoring approach
  let intensityScore = 0;

  // Factor 1: Sponsored density (0-3 points)
  if (sponsored_pct >= 50) {
    intensityScore += 3;
    signals.push(`High sponsored density (${sponsored_pct}% of listings)`);
  } else if (sponsored_pct >= 25) {
    intensityScore += 2;
    signals.push(`Moderate sponsored density (${sponsored_pct}% of listings)`);
  } else if (sponsored_pct > 0) {
    intensityScore += 1;
  }

  // Factor 2: Review barrier (high reviews = harder to compete organically = more ads)
  if (review_barrier !== null) {
    if (review_barrier >= 5000) {
      intensityScore += 2;
      if (signals.length < 3) {
        signals.push(`High review barrier (${Math.round(review_barrier).toLocaleString()} median reviews in top 10)`);
      }
    } else if (review_barrier >= 1000) {
      intensityScore += 1;
      if (signals.length < 3 && sponsored_pct < 25) {
        signals.push(`Moderate review barrier (${Math.round(review_barrier).toLocaleString()} median reviews)`);
      }
    }
  }

  // Factor 3: Price competition (tight price range = competitive = likely more ads)
  if (price_competition !== null) {
    if (price_competition < 0.3) {
      // Tight price range indicates high competition
      intensityScore += 1;
      if (signals.length < 3) {
        signals.push(`Tight price competition (${(price_competition * 100).toFixed(0)}% spread)`);
      }
    }
  }

  // Factor 4: Brand dominance (high dominance = established players = likely heavy ad spend)
  if (dominanceScore >= 40) {
    intensityScore += 1;
    if (signals.length < 3 && sponsored_pct < 50) {
      signals.push(`High brand dominance (${dominanceScore}% top brand share)`);
    }
  }

  // Determine final label based on score
  if (intensityScore >= 4) {
    ad_intensity_label = "High";
  } else if (intensityScore >= 2) {
    ad_intensity_label = "Medium";
  } else {
    ad_intensity_label = "Low";
  }

  // If no signals were added but we have data, add a default signal
  if (signals.length === 0 && totalListings > 0) {
    signals.push(`Sponsored density: ${sponsored_pct}%`);
  }

  // Limit to max 3 signals
  const finalSignals = signals.slice(0, 3);

  return {
    sponsored_pct,
    sponsored_count: sponsoredCount,
    review_barrier,
    price_competition,
    dominance: dominanceScore,
    ad_intensity_label,
    signals: finalSignals,
    source: "heuristic_v1",
  };
}

