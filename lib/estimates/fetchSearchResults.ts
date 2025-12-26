/**
 * Fetches Amazon search results from Rainforest API (type=search)
 * Used for Tier-1 instant estimates
 */

export interface SearchResultProduct {
  position: number;
  price: number;
  asin?: string;
  title?: string;
  rating?: number;
  reviews?: number;
  image_url?: string;
  is_sponsored?: boolean;
}

/**
 * Fetches search results from Rainforest API
 * Returns products with position and price for instant estimates
 */
export async function fetchSearchResults(
  keyword: string
): Promise<SearchResultProduct[]> {
  const rainforestApiKey = process.env.RAINFOREST_API_KEY;

  if (!rainforestApiKey) {
    console.error("RAINFOREST_API_KEY not configured");
    throw new Error("Rainforest API key not configured");
  }

  try {
    const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=amazon.com&search_term=${encodeURIComponent(keyword)}&page=1`;
    
    console.log("INSTANT_ESTIMATE_SEARCH_REQUEST", {
      keyword,
      url: apiUrl.replace(rainforestApiKey, "***"),
    });

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Rainforest search API error: ${response.status}`, {
        keyword,
        error_body: errorText.substring(0, 500),
      });
      throw new Error(`Search API error: ${response.status}`);
    }

    const raw = await response.json();

    // Check for API errors in response
    if (raw.error) {
      console.error("Rainforest API returned an error", {
        keyword,
        error: raw.error,
      });
      throw new Error(`Search API error: ${raw.error}`);
    }

    // Extract search_results from all possible locations
    const allResultArrays: any[][] = [];

    if (Array.isArray(raw.search_results) && raw.search_results.length > 0) {
      allResultArrays.push(raw.search_results);
    }
    if (Array.isArray(raw.organic_results) && raw.organic_results.length > 0) {
      allResultArrays.push(raw.organic_results);
    }
    if (Array.isArray(raw.ads) && raw.ads.length > 0) {
      allResultArrays.push(raw.ads);
    }
    if (Array.isArray(raw.results) && raw.results.length > 0) {
      allResultArrays.push(raw.results);
    }

    const searchResults = allResultArrays.flat();

    if (searchResults.length === 0) {
      console.log("INSTANT_ESTIMATE_NO_RESULTS", { keyword });
      return [];
    }

    // Parse results into SearchResultProduct format
    const products: SearchResultProduct[] = [];

    for (let i = 0; i < searchResults.length; i++) {
      const item = searchResults[i];
      const position = i + 1; // 1-indexed position

      // Parse price
      let price: number = 0;
      if (item.price?.value) {
        price = parseFloat(item.price.value) || 0;
      } else if (item.price?.raw) {
        price = parseFloat(item.price.raw) || 0;
      } else if (typeof item.price === "number") {
        price = item.price || 0;
      } else if (typeof item.price === "string") {
        price = parseFloat(item.price.replace(/[^0-9.]/g, "")) || 0;
      }

      // Only include products with valid prices
      if (price > 0) {
        products.push({
          position,
          price,
          asin: item.asin || undefined,
          title: item.title || undefined,
          rating: item.rating ? parseFloat(item.rating.toString()) : undefined,
          reviews: item.reviews?.count
            ? parseInt(item.reviews.count.toString().replace(/,/g, ""), 10)
            : undefined,
          image_url: item.image || undefined,
          is_sponsored: item.is_sponsored || item.sponsored || false,
        });
      }
    }

    console.log("INSTANT_ESTIMATE_SEARCH_RESULTS", {
      keyword,
      total_results: searchResults.length,
      products_with_price: products.length,
    });

    return products;
  } catch (error) {
    console.error("INSTANT_ESTIMATE_SEARCH_ERROR", {
      keyword,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

