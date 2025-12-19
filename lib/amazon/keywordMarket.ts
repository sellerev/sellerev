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

export interface ParsedListing {
  asin: string | null;
  title: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  is_sponsored: boolean;
  position: number;
  brand: string | null;
}

export interface KeywordMarketSnapshot {
  keyword: string;
  avg_price: number | null;
  avg_reviews: number | null;
  avg_rating: number | null;
  total_page1_listings: number; // Only Page 1 listings
  sponsored_count: number;
  dominance_score: number; // 0-100, % of listings belonging to top brand
  representative_asin?: string | null; // Optional representative ASIN for fee estimation
  // Competitive Pressure Index (CPI) - seller-context aware, 0-100
  competitive_pressure_index?: number;
  cpi_components?: {
    reviewBarrierScore: number;
    sponsoredCompetitionScore: number;
    brandDominanceScore: number;
    listingDensityScore: number;
  };
  cpi_explanation?: string;
}

export interface KeywordMarketData {
  snapshot: KeywordMarketSnapshot;
  listings: ParsedListing[];
}

/**
 * Safely parses a price value from various formats.
 */
function parsePrice(item: any): number | null {
  if (item.price?.value) {
    const parsed = parseFloat(item.price.value);
    return isNaN(parsed) ? null : parsed;
  }
  if (item.price?.raw) {
    const parsed = parseFloat(item.price.raw);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof item.price === "number") {
    return isNaN(item.price) ? null : item.price;
  }
  if (typeof item.price === "string") {
    const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ""));
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Safely parses review count.
 */
function parseReviews(item: any): number | null {
  if (item.reviews?.count !== undefined) {
    const parsed = parseInt(item.reviews.count.toString().replace(/,/g, ""), 10);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof item.reviews === "number") {
    return isNaN(item.reviews) ? null : item.reviews;
  }
  return null;
}

/**
 * Safely parses rating.
 */
function parseRating(item: any): number | null {
  if (item.rating !== undefined && item.rating !== null) {
    const parsed = parseFloat(item.rating.toString());
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Attempts to infer brand from title if brand field is missing.
 */
function inferBrandFromTitle(title: string | null): string | null {
  if (!title) return null;
  // Simple heuristic: first word or two words before common separators
  const match = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  return match ? match[1] : null;
}

/**
 * Fetches Amazon search results for a keyword and computes aggregated market signals.
 * 
 * @param keyword - The search keyword
 * @returns KeywordMarketData if valid data exists, null otherwise
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

    const raw = await response.json();

    // Log raw payload for debugging
    console.log("RAW_KEYWORD_RESULTS", JSON.stringify(raw, null, 2));

    // Extract search_results array
    if (!raw || typeof raw !== "object") {
      console.error("Invalid Rainforest API response structure");
      return null;
    }

    const searchResults = raw.search_results || [];

    // 422 ONLY if search_results is empty or missing
    if (!Array.isArray(searchResults) || searchResults.length === 0) {
      console.log("No search results found");
      return null;
    }

    // Parse each search result item
    let parsedListings: ParsedListing[] = [];
    try {
      parsedListings = searchResults.map((item: any, index: number) => {
      const asin = item.asin ?? null;
      const title = item.title ?? null;
      const price = parsePrice(item);
      const rating = parseRating(item);
      const reviews = parseReviews(item);
      const is_sponsored = item.is_sponsored ?? false;
      const position = item.position ?? index + 1;
      
      // Extract brand: try item.brand first, then infer from title
      let brand = item.brand ?? null;
      if (!brand && title) {
        brand = inferBrandFromTitle(title);
      }

      return {
        asin,
        title,
        price,
        rating,
        reviews,
        is_sponsored,
        position,
        brand,
      };
    });
    } catch (parseError) {
      console.error("Error parsing search results:", parseError);
      return null;
    }

    // VALID listing rule: A listing is valid if asin exists AND title exists
    const validListings = parsedListings.filter(
      (listing) => listing.asin !== null && listing.title !== null
    );

    console.log(`Extracted ${validListings.length} valid listings from ${parsedListings.length} total results`);

    // If total_page1_listings > 0, proceed with analysis (even if avg_price or avg_reviews are null)
    if (validListings.length === 0) {
      console.log("No valid listings (missing asin or title)");
      return null;
    }

    // Aggregate metrics from Page 1 listings only
    const total_page1_listings = validListings.length;
    const sponsored_count = validListings.filter((l) => l.is_sponsored).length;

    // Average price (only over listings with price)
    const listingsWithPrice = validListings.filter((l) => l.price !== null);
    const avg_price =
      listingsWithPrice.length > 0
        ? listingsWithPrice.reduce((sum, l) => sum + (l.price ?? 0), 0) / listingsWithPrice.length
        : null;

    // Average reviews (only over listings with reviews)
    const listingsWithReviews = validListings.filter((l) => l.reviews !== null);
    const avg_reviews =
      listingsWithReviews.length > 0
        ? listingsWithReviews.reduce((sum, l) => sum + (l.reviews ?? 0), 0) / listingsWithReviews.length
        : null;

    // Average rating (only over listings with rating)
    const listingsWithRating = validListings.filter((l) => l.rating !== null);
    const avg_rating =
      listingsWithRating.length > 0
        ? listingsWithRating.reduce((sum, l) => sum + (l.rating ?? 0), 0) / listingsWithRating.length
        : null;

    // Top brands (count occurrences by brand if available) - Page 1 only
    const brandCounts: Record<string, number> = {};
    validListings.forEach((l) => {
      if (l.brand) {
        brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
      }
    });

    const top_brands = Object.entries(brandCounts)
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count);

    // Page 1 dominance score: % of Page 1 listings belonging to top brand (0-100)
    const dominance_score =
      top_brands.length > 0 && total_page1_listings > 0
        ? Math.round((top_brands[0].count / total_page1_listings) * 100)
        : 0;

    const snapshot: KeywordMarketSnapshot = {
      keyword,
      avg_price: avg_price !== null ? Math.round(avg_price * 100) / 100 : null,
      avg_reviews: avg_reviews !== null ? Math.round(avg_reviews) : null,
      avg_rating: avg_rating !== null ? Math.round(avg_rating * 10) / 10 : null,
      total_page1_listings,
      sponsored_count,
      dominance_score,
    };

    return {
      snapshot,
      listings: validListings,
    };
  } catch (error) {
    console.error("Error fetching keyword market snapshot:", error);
    return null;
  }
}

