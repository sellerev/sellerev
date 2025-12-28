/**
 * Keyword Market Aggregation Module
 * 
 * Computes aggregated market metrics from Amazon search results.
 * 
 * STRICT RULES:
 * - DO NOT invent data
 * - ALL metrics computed from provided listings
 * - If data cannot be computed, omit it (do NOT fake it)
 */

interface Listing {
  price: number;
  reviews: number;
  rating: number;
  brand: string;
  asin: string;
}

export interface KeywordMarketSnapshot {
  avg_price: number;
  price_range: [number, number];
  avg_reviews: number;
  median_reviews: number;
  review_density_pct: number;
  competitor_count: number;
  brand_concentration_pct: number;
  avg_rating: number;
}

/**
 * Aggregates keyword market data from listing results.
 * 
 * @param results - Array of listings with price, reviews, rating, brand, asin
 * @returns KeywordMarketSnapshot with computed metrics
 */
export function aggregateKeywordMarketData(
  results: Listing[]
): KeywordMarketSnapshot | null {
  if (!results || results.length === 0) {
    return null;
  }

  // Filter valid listings (must have price > 0)
  const validListings = results.filter((l) => l.price > 0);

  if (validListings.length < 5) {
    return null;
  }

  // Extract arrays for computation
  const prices = validListings.map((l) => l.price);
  const reviews = validListings.map((l) => l.reviews).filter((r) => r >= 0);
  const ratings = validListings.map((l) => l.rating).filter((r) => r > 0);

  // Average price
  const avgPrice =
    prices.reduce((sum, p) => sum + p, 0) / prices.length;

  // Price range [min, max]
  const priceRange: [number, number] = [
    Math.min(...prices),
    Math.max(...prices),
  ];

  // Average reviews
  const avgReviews =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r, 0) / reviews.length
      : 0;

  // Median reviews
  const sortedReviews = [...reviews].sort((a, b) => a - b);
  const medianReviews =
    sortedReviews.length > 0
      ? sortedReviews.length % 2 === 0
        ? (sortedReviews[sortedReviews.length / 2 - 1] +
            sortedReviews[sortedReviews.length / 2]) /
          2
        : sortedReviews[Math.floor(sortedReviews.length / 2)]
      : 0;

  // Review density (% with > 1000 reviews)
  const highReviewCount = validListings.filter(
    (l) => l.reviews > 1000
  ).length;
  const reviewDensityPct = Math.round(
    (highReviewCount / validListings.length) * 100
  );

  // Competitor count
  const competitorCount = validListings.length;

  // Brand concentration (% share of top brand)
  const brandCounts: Record<string, number> = {};
  validListings.forEach((l) => {
    brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
  });
  const topBrand = Object.entries(brandCounts).reduce((a, b) =>
    b[1] > a[1] ? b : a
  );
  const brandConcentrationPct = Math.round(
    (topBrand[1] / validListings.length) * 100
  );

  // Average rating
  const avgRating =
    ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
      : 0;

  return {
    avg_price: Math.round(avgPrice * 100) / 100, // Round to 2 decimals
    price_range: [
      Math.round(priceRange[0] * 100) / 100,
      Math.round(priceRange[1] * 100) / 100,
    ],
    avg_reviews: Math.round(avgReviews),
    median_reviews: Math.round(medianReviews),
    review_density_pct: reviewDensityPct,
    competitor_count: competitorCount,
    brand_concentration_pct: brandConcentrationPct,
    avg_rating: Math.round(avgRating * 10) / 10, // Round to 1 decimal
  };
}







