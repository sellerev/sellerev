/**
 * Keyword Market Aggregation Service
 * 
 * Fetches Amazon search results via Rainforest API and computes
 * aggregated market signals for keyword-based analyses.
 * 
 * STRICT RULES:
 * - DO NOT invent data
 * - ALL data must come from Amazon search results
 * - If data cannot be computed, omit it (do NOT fake it)
 */

interface Listing {
  price: number;
  review_count: number;
  rating: number;
  brand: string;
  asin: string;
}

export interface KeywordMarketSnapshot {
  avg_price: number;
  min_price: number;
  max_price: number;
  avg_reviews: number;
  review_density: number; // % of listings with > 1000 reviews
  competitor_count: number; // listings.length
  brand_concentration: number; // % share of top brand
}

export interface KeywordMarketData {
  snapshot: KeywordMarketSnapshot;
  listings: Listing[];
}

/**
 * Fetches Amazon search results for a keyword and computes aggregated market signals.
 * 
 * @param keyword - The search keyword
 * @returns KeywordMarketSnapshot if valid data exists, null otherwise
 */
export async function fetchKeywordMarketSnapshot(
  keyword: string
): Promise<KeywordMarketData | null> {
  const rainforestApiKey = process.env.RAINFOREST_API_KEY;
  
  if (!rainforestApiKey) {
    console.warn("RAINFOREST_API_KEY not configured");
    return null;
  }

  try {
    // Fetch Amazon search results via Rainforest API
    const response = await fetch(
      `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=amazon.com&search_term=${encodeURIComponent(keyword)}&page=1`,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`Rainforest API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // Extract organic listings (ignore sponsored if possible)
    const searchResults = data.search_results || [];
    const organicListings = searchResults
      .filter((item: any) => {
        // Filter out sponsored listings if possible
        return !item.sponsored && item.price && item.reviews && item.rating;
      })
      .slice(0, 10); // Top 10 organic listings

    // Need at least 5 valid listings
    if (organicListings.length < 5) {
      return null;
    }

    // Extract per listing data
    const listings: Listing[] = organicListings
      .map((item: any) => {
        // Parse price (handle various formats)
        let price = 0;
        if (item.price?.value) {
          price = parseFloat(item.price.value);
        } else if (typeof item.price === "number") {
          price = item.price;
        } else if (typeof item.price === "string") {
          price = parseFloat(item.price.replace(/[^0-9.]/g, ""));
        }

        // Parse review count
        let reviewCount = 0;
        if (item.reviews?.total) {
          reviewCount = parseInt(item.reviews.total.toString().replace(/,/g, ""), 10);
        } else if (typeof item.reviews === "number") {
          reviewCount = item.reviews;
        }

        // Parse rating
        let rating = 0;
        if (item.rating) {
          rating = parseFloat(item.rating.toString());
        }

        // Extract brand
        const brand = item.brand || item.manufacturer || "Unknown";

        // Extract ASIN
        const asin = item.asin || "";

        // Only include listings with valid price and ASIN
        if (price > 0 && asin) {
          return {
            price,
            review_count: reviewCount,
            rating: isNaN(rating) ? 0 : rating,
            brand: brand.toString(),
            asin: asin.toString(),
          };
        }
        return null;
      })
      .filter((item: Listing | null): item is Listing => item !== null);

    // Need at least 5 valid listings after filtering
    if (listings.length < 5) {
      return null;
    }

    // Compute aggregated signals
    const prices = listings.map((l) => l.price).filter((p) => p > 0);
    const reviews = listings.map((l) => l.review_count).filter((r) => r >= 0);
    const ratings = listings.map((l) => l.rating).filter((r) => r > 0);

    if (prices.length === 0) {
      return null;
    }

    // Average price
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;

    // Min/Max price
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    // Average reviews
    const avgReviews = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r, 0) / reviews.length
      : 0;

    // Review density (% with > 1000 reviews)
    const highReviewCount = listings.filter((l) => l.review_count > 1000).length;
    const reviewDensity = Math.round((highReviewCount / listings.length) * 100);

    // Competitor count
    const competitorCount = listings.length;

    // Brand concentration (% share of top brand)
    const brandCounts: Record<string, number> = {};
    listings.forEach((l) => {
      brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
    });
    const topBrand = Object.entries(brandCounts).reduce((a, b) =>
      b[1] > a[1] ? b : a
    );
    const brandConcentration = Math.round((topBrand[1] / listings.length) * 100);

    const snapshot: KeywordMarketSnapshot = {
      avg_price: Math.round(avgPrice * 100) / 100, // Round to 2 decimals
      min_price: Math.round(minPrice * 100) / 100,
      max_price: Math.round(maxPrice * 100) / 100,
      avg_reviews: Math.round(avgReviews),
      review_density: reviewDensity,
      competitor_count: competitorCount,
      brand_concentration: brandConcentration,
    };

    return {
      snapshot,
      listings,
    };
  } catch (error) {
    console.error("Error fetching keyword market snapshot:", error);
    return null;
  }
}
