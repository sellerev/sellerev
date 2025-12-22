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
  position: number; // Organic rank (1-indexed position on Page 1)
  brand: string | null;
  image_url: string | null; // Rainforest search_results[].image
  bsr: number | null; // Best Seller Rank (if available from Rainforest)
  fulfillment: "FBA" | "FBM" | "Amazon" | null; // Fulfillment type (if available)
  est_monthly_revenue?: number | null; // 30-day revenue estimate (modeled)
  est_monthly_units?: number | null; // 30-day units estimate (modeled)
  revenue_confidence?: "low" | "medium"; // Confidence level for revenue estimate
}

export interface KeywordMarketSnapshot {
  keyword: string;
  avg_price: number | null;
  avg_reviews: number | null;
  avg_rating: number | null;
  avg_bsr: number | null; // Average Best Seller Rank
  total_page1_listings: number; // Only Page 1 listings
  sponsored_count: number;
  dominance_score: number; // 0-100, % of listings belonging to top brand
  fulfillment_mix: {
    fba: number; // % of listings fulfilled by Amazon (FBA)
    fbm: number; // % of listings merchant fulfilled (FBM)
    amazon: number; // % of listings sold by Amazon
  } | null;
  representative_asin?: string | null; // Optional representative ASIN for fee estimation
  // 30-Day Revenue Estimates (modeled, not exact)
  est_total_monthly_revenue_min?: number | null;
  est_total_monthly_revenue_max?: number | null;
  est_total_monthly_units_min?: number | null;
  est_total_monthly_units_max?: number | null;
  // Search volume estimation (modeled, not exact)
  search_demand?: {
    search_volume_range: string; // e.g., "10k–20k"
    search_volume_confidence: "low" | "medium";
  } | null;
  // Competitive Pressure Index (CPI) - seller-context aware, 0-100
  // Computed once per analysis, cached, immutable
  cpi?: {
    score: number; // 0-100
    label: string; // "Low — structurally penetrable" | "Moderate — requires differentiation" | "High — strong incumbents" | "Extreme — brand-locked"
    breakdown: {
      review_dominance: number; // 0-30 points
      brand_concentration: number; // 0-25 points
      sponsored_saturation: number; // 0-20 points
      price_compression: number; // 0-15 points
      seller_fit_modifier: number; // -10 to +10 points
    };
  } | null;
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
 * Safely parses BSR (Best Seller Rank).
 */
function parseBSR(item: any): number | null {
  // Try various BSR field names from Rainforest API
  if (item.bsr !== undefined && item.bsr !== null) {
    const parsed = parseInt(item.bsr.toString().replace(/,/g, ""), 10);
    return isNaN(parsed) ? null : parsed;
  }
  if (item.best_seller_rank !== undefined && item.best_seller_rank !== null) {
    const parsed = parseInt(item.best_seller_rank.toString().replace(/,/g, ""), 10);
    return isNaN(parsed) ? null : parsed;
  }
  if (item.rank !== undefined && item.rank !== null) {
    const parsed = parseInt(item.rank.toString().replace(/,/g, ""), 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Safely parses fulfillment type (FBA/FBM/Amazon).
 */
function parseFulfillment(item: any): "FBA" | "FBM" | "Amazon" | null {
  // Try various fulfillment field names from Rainforest API
  if (item.fulfillment) {
    const fulfillment = item.fulfillment.toString().toUpperCase();
    if (fulfillment.includes("FBA") || fulfillment.includes("FULFILLED BY AMAZON")) {
      return "FBA";
    }
    if (fulfillment.includes("FBM") || fulfillment.includes("MERCHANT")) {
      return "FBM";
    }
    if (fulfillment.includes("AMAZON")) {
      return "Amazon";
    }
  }
  if (item.is_amazon) {
    return "Amazon";
  }
  if (item.is_prime) {
    // Prime usually means FBA, but not always
    return "FBA";
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
    
    // Extract search_information.total_results for search volume estimation
    // total_results is typically a string like "50,000 results" or number
    const searchInformation = raw.search_information || {};
    let totalResults: number | null = null;
    if (searchInformation.total_results) {
      const totalResultsStr = searchInformation.total_results.toString();
      const match = totalResultsStr.match(/([\d,]+)/);
      if (match) {
        totalResults = parseInt(match[1].replace(/,/g, ''), 10);
        if (isNaN(totalResults)) totalResults = null;
      }
    }

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
      const position = item.position ?? index + 1; // Organic rank (1-indexed)
      const bsr = parseBSR(item);
      const fulfillment = parseFulfillment(item);
      
      // Extract brand: try item.brand first, then infer from title
      let brand = item.brand ?? null;
      if (!brand && title) {
        brand = inferBrandFromTitle(title);
      }

      // Extract image URL from Rainforest search_results[].image
      const image_url = item.image ?? null;

      return {
        asin,
        title,
        price,
        rating,
        reviews,
        is_sponsored,
        position,
        brand,
        image_url,
        bsr,
        fulfillment,
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

    // Average BSR (only over listings with BSR)
    const listingsWithBSR = validListings.filter((l) => l.bsr !== null && l.bsr !== undefined);
    const avg_bsr =
      listingsWithBSR.length > 0
        ? listingsWithBSR.reduce((sum, l) => sum + (l.bsr ?? 0), 0) / listingsWithBSR.length
        : null;

    // Fulfillment mix calculation
    let fulfillmentMix: { fba: number; fbm: number; amazon: number } | null = null;
    if (validListings.length > 0) {
      let fbaCount = 0;
      let fbmCount = 0;
      let amazonCount = 0;
      
      validListings.forEach((l) => {
        if (l.fulfillment === "FBA") fbaCount++;
        else if (l.fulfillment === "FBM") fbmCount++;
        else if (l.fulfillment === "Amazon") amazonCount++;
      });
      
      const totalWithFulfillment = fbaCount + fbmCount + amazonCount;
      if (totalWithFulfillment > 0) {
        fulfillmentMix = {
          fba: Math.round((fbaCount / totalWithFulfillment) * 100),
          fbm: Math.round((fbmCount / totalWithFulfillment) * 100),
          amazon: Math.round((amazonCount / totalWithFulfillment) * 100),
        };
      }
    }

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
      avg_bsr: avg_bsr !== null ? Math.round(avg_bsr) : null,
      total_page1_listings,
      sponsored_count,
      dominance_score,
      fulfillment_mix: fulfillmentMix,
    };

    // Estimate revenue and units for each listing (30-day estimates)
    const revenueEstimator = await import("./revenueEstimator");
    const { estimateListingRevenueWithUnits, aggregateRevenueEstimates } = revenueEstimator;
    
    const listingsWithEstimates: ParsedListing[] = validListings.map((listing) => {
      if (listing.price === null || listing.price <= 0) {
        return {
          ...listing,
          est_monthly_revenue: null,
          est_monthly_units: null,
          revenue_confidence: "low",
        };
      }
      
      const estimate = estimateListingRevenueWithUnits(
        listing.price,
        listing.position,
        avg_price,
        keyword
      );
      
      return {
        ...listing,
        est_monthly_revenue: estimate.est_monthly_revenue,
        est_monthly_units: estimate.est_monthly_units,
        revenue_confidence: estimate.revenue_confidence,
      };
    });

    // Aggregate total revenue and units estimates
    // Always calculate aggregates, even if some listings have null estimates
    const revenueEstimates = listingsWithEstimates
      .filter(l => l.est_monthly_revenue !== null && l.est_monthly_revenue !== undefined)
      .map(l => ({
        est_monthly_revenue: l.est_monthly_revenue!,
        est_monthly_units: l.est_monthly_units || 0,
        revenue_confidence: l.revenue_confidence || "low",
      }));
    
    // Always return aggregates (even if empty array, will return 0s)
    const aggregated = revenueEstimates.length > 0
      ? aggregateRevenueEstimates(revenueEstimates)
      : {
          total_revenue_min: 0,
          total_revenue_max: 0,
          total_units_min: 0,
          total_units_max: 0,
        };
    
    // Estimate search volume (always returns a value, never null)
    const searchVolumeEstimator = await import("./searchVolumeEstimator");
    const searchVolume = searchVolumeEstimator.estimateSearchVolume(
      totalResults,
      total_page1_listings,
      avg_reviews,
      sponsored_count,
      keyword
    );
    
    const snapshotWithEstimates: KeywordMarketSnapshot = {
      ...snapshot,
      est_total_monthly_revenue_min: aggregated.total_revenue_min > 0 ? aggregated.total_revenue_min : null,
      est_total_monthly_revenue_max: aggregated.total_revenue_max > 0 ? aggregated.total_revenue_max : null,
      est_total_monthly_units_min: aggregated.total_units_min > 0 ? aggregated.total_units_min : null,
      est_total_monthly_units_max: aggregated.total_units_max > 0 ? aggregated.total_units_max : null,
      search_demand: {
        search_volume_range: searchVolume.search_volume_range,
        search_volume_confidence: searchVolume.search_volume_confidence,
      },
    };

    return {
      snapshot: snapshotWithEstimates,
      listings: listingsWithEstimates,
    };
  } catch (error) {
    console.error("Error fetching keyword market snapshot:", error);
    return null;
  }
}

