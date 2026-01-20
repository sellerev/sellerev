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
    // ═══════════════════════════════════════════════════════════════════════════
    // PART 1: UPDATE RAINFOREST SEARCH REQUEST - INCLUDE ADS
    // ═══════════════════════════════════════════════════════════════════════════
    const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=amazon.com&search_term=${encodeURIComponent(keyword)}&page=1&include_ads=true&include_sponsored=true`;
    
    console.log("INSTANT_ESTIMATE_SEARCH_REQUEST", {
      keyword,
      url: apiUrl.replace(rainforestApiKey, "***"),
      include_ads: true,
      include_sponsored: true,
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PART 2: PARSE SPONSORED RESULTS FROM RAINFOREST RESPONSE
    // ═══════════════════════════════════════════════════════════════════════════
    // Extract search_results from all possible locations with source tracking
    const allSearchResults: Array<{ item: any; source: 'ads' | 'sponsored_products' | 'search_results' | 'organic_results' | 'results' | 'unknown' }> = [];
    
    // Collect from ads array (sponsored)
    if (Array.isArray(raw.ads) && raw.ads.length > 0) {
      for (const item of raw.ads) {
        allSearchResults.push({ item, source: 'ads' });
      }
    }
    
    // Collect from sponsored_products array (if present)
    if (Array.isArray(raw.sponsored_products) && raw.sponsored_products.length > 0) {
      for (const item of raw.sponsored_products) {
        allSearchResults.push({ item, source: 'sponsored_products' });
      }
    }
    
    // Collect from search_results array (mixed: may contain both organic and sponsored)
    if (Array.isArray(raw.search_results) && raw.search_results.length > 0) {
      for (const item of raw.search_results) {
        allSearchResults.push({ item, source: 'search_results' });
      }
    }
    
    // Collect from organic_results array (organic)
    if (Array.isArray(raw.organic_results) && raw.organic_results.length > 0) {
      for (const item of raw.organic_results) {
        allSearchResults.push({ item, source: 'organic_results' });
      }
    }
    
    // Collect from results array (fallback, unknown classification)
    if (Array.isArray(raw.results) && raw.results.length > 0) {
      for (const item of raw.results) {
        allSearchResults.push({ item, source: 'results' });
      }
    }

    const searchResults = allSearchResults;

    if (searchResults.length === 0) {
      console.log("INSTANT_ESTIMATE_NO_RESULTS", { keyword });
      return [];
    }

    // Parse results into SearchResultProduct format
    const products: SearchResultProduct[] = [];

    for (let i = 0; i < searchResults.length; i++) {
      const entry = searchResults[i];
      const item = entry.item;
      const sourceBlock = entry.source;
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

      // ═══════════════════════════════════════════════════════════════════════════
      // PART 2: PARSE SPONSORED RESULTS FROM RAINFOREST RESPONSE
      // ═══════════════════════════════════════════════════════════════════════════
      // Extract sponsored status using strict priority order
      let isSponsored: boolean | null = null;
      
      // Priority 1: Check explicit is_sponsored flag
      if (item.is_sponsored === true) {
        isSponsored = true;
      }
      // Priority 2: Check badge_text for "Sponsored" (case-insensitive)
      else if (item.badge_text && typeof item.badge_text === 'string' && item.badge_text.toLowerCase().includes('sponsored')) {
        isSponsored = true;
      }
      // Priority 3: Check if ad_position is defined (indicates sponsored)
      else if (item.ad_position !== undefined && item.ad_position !== null) {
        isSponsored = true;
      }
      // Priority 4: Check source block (ads or sponsored_products)
      else if (sourceBlock === 'ads' || sourceBlock === 'sponsored_products') {
        isSponsored = true;
      }
      // Priority 5: Check if from search_results (treat as organic)
      else if (sourceBlock === 'search_results') {
        isSponsored = false;
      }
      // Priority 6: Check organic_results (explicitly organic)
      else if (sourceBlock === 'organic_results') {
        isSponsored = false;
      }
      // Fallback: Unknown
      else {
        isSponsored = null;
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
          is_sponsored: isSponsored === true, // Convert to boolean for interface (true or false, never null)
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

