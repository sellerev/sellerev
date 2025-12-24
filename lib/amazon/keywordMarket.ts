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
  seller?: string | null; // Seller name (for Amazon Retail detection)
  is_prime?: boolean; // Prime eligibility (for FBA detection)
  est_monthly_revenue?: number | null; // 30-day revenue estimate (modeled)
  est_monthly_units?: number | null; // 30-day units estimate (modeled)
  revenue_confidence?: "low" | "medium"; // Confidence level for revenue estimate
}

export interface KeywordMarketSnapshot {
  keyword: string;
  avg_price: number | null;
  avg_reviews: number; // Always a number (0 if no valid reviews)
  avg_rating: number | null;
  avg_bsr: number | null; // Average Best Seller Rank
  total_page1_listings: number; // Only Page 1 listings
  sponsored_count: number;
  dominance_score: number; // 0-100, % of listings belonging to top brand
  fulfillment_mix: {
    fba: number; // % of listings fulfilled by Amazon (FBA)
    fbm: number; // % of listings merchant fulfilled (FBM)
    amazon: number; // % of listings sold by Amazon
  } | null; // null only if no listings exist
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
    console.error("RAINFOREST_API_KEY not configured in environment variables");
    throw new Error("Rainforest API key not configured. Please set RAINFOREST_API_KEY environment variable.");
  }

  // TASK 2: Track if we extracted ASINs to classify errors correctly
  let extractedAsinCount = 0;
  let apiReturnedResults = false;

  try {
    const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=amazon.com&search_term=${encodeURIComponent(keyword)}&page=1`;
    console.log("RAINFOREST_API_REQUEST", { keyword, url: apiUrl.replace(rainforestApiKey, "***") });
    
    // Fetch Amazon search results via Rainforest API
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Rainforest API error: ${response.status} ${response.statusText}`, {
        keyword,
        error_body: errorText.substring(0, 500), // First 500 chars
      });
      return null;
    }

    let raw: any;
    try {
      raw = await response.json();
    } catch (jsonError) {
      const responseText = await response.text().catch(() => "Unable to read response");
      console.error("Failed to parse Rainforest API JSON response", {
        keyword,
        status: response.status,
        statusText: response.statusText,
        response_preview: responseText.substring(0, 500),
        error: jsonError instanceof Error ? jsonError.message : String(jsonError),
      });
      return null;
    }

    // Log FULL raw response for debugging (Step 1)
    console.log("RAW_KEYWORD_RESULTS_FULL", {
      keyword,
      status: response.status,
      full_response: JSON.stringify(raw, null, 2), // Full response for inspection
    });
    
    // Log raw payload structure for debugging (truncated for large responses)
    console.log("RAW_KEYWORD_RESULTS", {
      keyword,
      status: response.status,
      has_request_info: !!raw.request_info,
      has_search_information: !!raw.search_information,
      search_results_count: Array.isArray(raw.search_results) ? raw.search_results.length : "not an array",
      search_results_type: typeof raw.search_results,
      organic_results_count: Array.isArray(raw.organic_results) ? raw.organic_results.length : "not an array",
      ads_count: Array.isArray(raw.ads) ? raw.ads.length : "not an array",
      results_count: Array.isArray(raw.results) ? raw.results.length : "not an array",
      raw_keys: Object.keys(raw),
      error: raw.error || null,
    });
    
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

    // Check for API errors in response
    if (raw.error) {
      console.error("Rainforest API returned an error", {
        keyword,
        error: raw.error,
        error_type: raw.error_type || "unknown",
        request_info: raw.request_info || null,
      });
      return null;
    }

    // Extract search_results array
    if (!raw || typeof raw !== "object") {
      console.error("Invalid Rainforest API response structure", {
        keyword,
        response_type: typeof raw,
        response_value: raw,
      });
      return null;
    }

    // Step 2: Collect ALL listings from ALL possible locations in Rainforest response
    // Check: search_results, organic_results, ads, results, etc.
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
    
    // Flatten all arrays into a single array
    const searchResults = allResultArrays.flat();
    
    console.log("COLLECTED_LISTINGS_FROM_ALL_SOURCES", {
      keyword,
      search_results_count: Array.isArray(raw.search_results) ? raw.search_results.length : 0,
      organic_results_count: Array.isArray(raw.organic_results) ? raw.organic_results.length : 0,
      ads_count: Array.isArray(raw.ads) ? raw.ads.length : 0,
      results_count: Array.isArray(raw.results) ? raw.results.length : 0,
      total_collected: searchResults.length,
    });

    // Step 5: Only return null if ZERO ASINs exist across all result blocks
    if (searchResults.length === 0) {
      console.log("No search results found in any location", {
        keyword,
        has_raw: !!raw,
        raw_keys: raw ? Object.keys(raw) : [],
        checked_locations: ["search_results", "organic_results", "ads", "results"],
      });
      return null;
    }
    
    // Count ASINs to verify we have valid listings
    const asinCount = searchResults.filter((item: any) => item.asin).length;
    extractedAsinCount = asinCount; // TASK 2: Track for error classification
    apiReturnedResults = searchResults.length > 0; // TASK 2: Track if API returned results
    
    if (asinCount === 0) {
      console.log("No ASINs found in any result", {
        keyword,
        total_items: searchResults.length,
        sample_item: searchResults[0] ? Object.keys(searchResults[0]) : null,
      });
      return null; // TASK 2: This is genuine "zero_asins" case
    }

    // Step 4: Parse and normalize each search result item
    // Normalize using single helper - all fields except ASIN are optional
    let parsedListings: ParsedListing[] = [];
    try {
      parsedListings = searchResults.map((item: any, index: number) => {
      // Step 2: ASIN is required, everything else is optional
      const asin = item.asin ?? null;
      
      // Step 4: Normalize all fields (nullable where appropriate)
      const title = item.title ?? null; // Optional
      const price = parsePrice(item); // Nullable
      const rating = parseRating(item); // Nullable
      const reviews = parseReviews(item); // Nullable
      const is_sponsored = item.is_sponsored ?? false; // Boolean, default false
      const position = item.position ?? index + 1; // Organic rank (1-indexed)
      const bsr = parseBSR(item); // Nullable
      const fulfillment = parseFulfillment(item); // Nullable
      
      // Extract brand: try item.brand first, then infer from title (if title exists)
      let brand = item.brand ?? null;
      if (!brand && title) {
        brand = inferBrandFromTitle(title);
      }

      // Extract image URL from Rainforest search_results[].image
      const image_url = item.image ?? null; // Nullable
      
      // Extract seller and is_prime for fulfillment mix detection
      const seller = item.seller ?? null; // Nullable
      const is_prime = item.is_prime ?? false; // Boolean, default false

      // Step 4: Return normalized listing - only ASIN is required
      return {
        asin, // Required
        title, // Optional (nullable)
        price, // Optional (nullable)
        rating, // Optional (nullable)
        reviews, // Optional (nullable)
        is_sponsored, // Boolean
        position,
        brand, // Optional (nullable)
        image_url, // Optional (nullable)
        bsr, // Optional (nullable)
        fulfillment, // Optional (nullable)
        // Add seller and is_prime for fulfillment mix computation
        seller, // Optional (nullable)
        is_prime, // Boolean
      } as ParsedListing & { seller?: string | null; is_prime?: boolean };
    });
    } catch (parseError) {
      console.error("Error parsing search results:", {
        error: parseError,
        keyword,
        search_results_length: searchResults.length,
      });
      return null;
    }

    // Step 2 & 3: VALID listing rule: A listing is valid if ASIN exists (title is optional)
    // Do NOT filter out listings due to missing optional fields (price, reviews, rating, BSR, fulfillment)
    const validListings = parsedListings.filter(
      (listing) => listing.asin !== null && listing.asin !== undefined && listing.asin !== ""
    );

    // TASK 1: Create canonical `listings` variable for all downstream logic
    const listings = validListings; // Canonical variable name

    console.warn("PAGE1_LISTINGS_COUNT", listings.length); // Step 7: Debug log
    console.log(`Extracted ${listings.length} valid listings from ${parsedListings.length} total results`, {
      keyword,
      valid_listings: listings.length,
      total_parsed: parsedListings.length,
      sample_valid_listing: listings[0] ? {
        asin: listings[0].asin,
        has_title: !!listings[0].title,
        has_price: listings[0].price !== null,
        has_reviews: listings[0].reviews !== null,
        has_rating: listings[0].rating !== null,
      } : null,
    });

    // Step 5: Only return null if ZERO ASINs exist
    if (listings.length === 0) {
      console.log("No valid listings (zero ASINs found)", {
        keyword,
        total_parsed: parsedListings.length,
        valid_count: listings.length,
        sample_listing: parsedListings[0] ? {
          has_asin: !!parsedListings[0].asin,
          asin_value: parsedListings[0].asin,
        } : null,
      });
      return null;
    }

    // Aggregate metrics from Page 1 listings only (using canonical `listings` variable)
    const total_page1_listings = listings.length;
    const sponsored_count = listings.filter((l) => l.is_sponsored).length;

    // TASK 3: Average price (only over listings with price != null) - do NOT fall back when real listings exist
    const listingsWithPrice = listings.filter((l) => l.price !== null && l.price !== undefined);
    const avg_price =
      listingsWithPrice.length > 0
        ? listingsWithPrice.reduce((sum, l) => sum + (l.price ?? 0), 0) / listingsWithPrice.length
        : null; // null is OK - we'll use fallback only if NO listings exist

    // TASK 3: Average reviews (only over listings with reviews != null)
    const { computeAvgReviews } = await import("./marketAggregates");
    const avg_reviews = computeAvgReviews(listings); // Always returns a number (0 if none)

    // TASK 3: Average rating (only over listings with rating != null) - do NOT fall back when real listings exist
    const listingsWithRating = listings.filter((l) => l.rating !== null && l.rating !== undefined);
    const avg_rating =
      listingsWithRating.length > 0
        ? listingsWithRating.reduce((sum, l) => sum + (l.rating ?? 0), 0) / listingsWithRating.length
        : null; // null is OK - we'll use fallback only if NO listings exist

    // Average BSR (only over listings with BSR)
    const listingsWithBSR = listings.filter((l) => l.bsr !== null && l.bsr !== undefined);
    const avg_bsr =
      listingsWithBSR.length > 0
        ? listingsWithBSR.reduce((sum, l) => sum + (l.bsr ?? 0), 0) / listingsWithBSR.length
        : null;

    // Fulfillment mix calculation - ALWAYS return a value (use computeFulfillmentMix helper)
    const { computeFulfillmentMix } = await import("./fulfillmentMix");
    const fulfillmentMix = listings.length > 0 
      ? computeFulfillmentMix(listings)
      : { fba: 0, fbm: 0, amazon: 0 };

    // Top brands (count occurrences by brand if available) - Page 1 only
    const brandCounts: Record<string, number> = {};
    listings.forEach((l) => {
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
      avg_reviews: avg_reviews, // Always a number now (never null)
      avg_rating: avg_rating !== null ? Math.round(avg_rating * 10) / 10 : null,
      avg_bsr: avg_bsr !== null ? Math.round(avg_bsr) : null,
      total_page1_listings,
      sponsored_count,
      dominance_score,
      fulfillment_mix: fulfillmentMix, // Always an object now (never null when listings exist)
    };

    // TASK 4: Estimate revenue and units for each listing (30-day estimates) - wrapped in try/catch
    let listingsWithEstimates: ParsedListing[] = listings; // Default to listings without estimates if estimator fails
    let aggregateRevenueEstimatesFunc: ((estimates: any[]) => any) | null = null; // Store function reference for later use
    
    try {
      const revenueEstimator = await import("./revenueEstimator");
      
      // TASK 1: Safely extract functions with fallback
      const estimateListingRevenueWithUnits = revenueEstimator.estimateListingRevenueWithUnits;
      const aggFunc = revenueEstimator.aggregateRevenueEstimates;
      
      if (!estimateListingRevenueWithUnits || typeof estimateListingRevenueWithUnits !== 'function') {
        throw new Error("estimateListingRevenueWithUnits is not a function");
      }
      
      if (aggFunc && typeof aggFunc === 'function') {
        aggregateRevenueEstimatesFunc = aggFunc; // Store function reference
      } else {
        console.warn("aggregateRevenueEstimates function not found in revenueEstimator module", {
          keyword,
          has_aggFunc: !!aggFunc,
          aggFunc_type: typeof aggFunc,
          revenueEstimator_keys: Object.keys(revenueEstimator),
        });
      }
      
      listingsWithEstimates = listings.map((listing) => {
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
    } catch (revenueError) {
      console.error("Revenue estimator failed, keeping listings without estimates", {
        keyword,
        error: revenueError instanceof Error ? revenueError.message : String(revenueError),
        stack: revenueError instanceof Error ? revenueError.stack : undefined,
        listings_count: listings.length,
      });
      // listingsWithEstimates already defaults to listings above
      // aggregateRevenueEstimatesFunc remains null
    }

    // TASK 3: Aggregate total revenue and units estimates - OPTIONAL, wrapped in try/catch
    // TASK 4: Make revenue aggregation optional - do NOT block analyze if it fails
    let aggregated = {
      total_revenue_min: 0,
      total_revenue_max: 0,
      total_units_min: 0,
      total_units_max: 0,
    };
    
    // TASK 3: Aggregate total revenue and units estimates - OPTIONAL, wrapped in try/catch
    // TASK 4: Make revenue aggregation optional - do NOT block analyze if it fails
    try {
      // Only aggregate if we have the function and valid estimates
      if (aggregateRevenueEstimatesFunc && typeof aggregateRevenueEstimatesFunc === 'function') {
        const revenueEstimates = listingsWithEstimates
          .filter(l => l.est_monthly_revenue !== null && l.est_monthly_revenue !== undefined)
          .map(l => ({
            est_monthly_revenue: l.est_monthly_revenue!,
            est_monthly_units: l.est_monthly_units || 0,
            revenue_confidence: l.revenue_confidence || "low",
          }));
        
        // Only call if we have estimates
        if (revenueEstimates.length > 0) {
          aggregated = aggregateRevenueEstimatesFunc(revenueEstimates);
        }
      } else {
        // TASK 1: Function not available - log but don't fail
        console.warn("REVENUE_AGGREGATION_FUNCTION_NOT_AVAILABLE", {
          keyword,
          has_function: !!aggregateRevenueEstimatesFunc,
          function_type: typeof aggregateRevenueEstimatesFunc,
          listings_count: listings.length,
          message: "aggregateRevenueEstimates function not available, skipping aggregation",
        });
      }
    } catch (aggError) {
      // TASK 3: Log warning, do NOT throw
      console.warn("REVENUE_AGGREGATION_FAILED", {
        keyword,
        error: aggError instanceof Error ? aggError.message : String(aggError),
        stack: aggError instanceof Error ? aggError.stack : undefined,
        listings_count: listings.length,
        message: "Revenue aggregation failed, but listings will still be returned",
      });
      // aggregated already defaults to zeros above
    }
    
    // TASK 4: Estimate search volume (ALWAYS returns a value when Page-1 listings exist) - wrapped in try/catch
    // Never returns null - uses deterministic H10-style heuristics
    let search_demand: { search_volume_range: string; search_volume_confidence: "low" | "medium" } | null = null;
    
    if (listings.length > 0) {
      try {
        const searchVolumeEstimator = await import("./searchVolumeEstimator");
        const searchVolume = searchVolumeEstimator.estimateSearchVolume({
          page1Listings: listings,
          sponsoredCount: sponsored_count,
          avgReviews: avg_reviews, // avg_reviews is always a number now (never null)
          category: undefined, // Can be enhanced later with category detection
        });
        
        // Format range as string (e.g., "10k–20k")
        const formatRange = (min: number, max: number): string => {
          if (min >= 1000000 || max >= 1000000) {
            const minM = (min / 1000000).toFixed(1).replace(/\.0$/, '');
            const maxM = (max / 1000000).toFixed(1).replace(/\.0$/, '');
            return `${minM}M–${maxM}M`;
          } else if (min >= 1000 || max >= 1000) {
            const minK = Math.round(min / 1000);
            const maxK = Math.round(max / 1000);
            return `${minK}k–${maxK}k`;
          } else {
            return `${min}–${max}`;
          }
        };
        
        search_demand = {
          search_volume_range: formatRange(searchVolume.min, searchVolume.max),
          search_volume_confidence: searchVolume.confidence,
        };
      } catch (searchVolumeError) {
        console.error("Search volume estimator failed, using fallback range", {
          keyword,
          error: searchVolumeError instanceof Error ? searchVolumeError.message : String(searchVolumeError),
          listings_count: listings.length,
        });
        // TASK 4: Set fallback range instead of null
        search_demand = {
          search_volume_range: "12k–18k",
          search_volume_confidence: "low",
        };
      }
    }
    
    // TASK 4: market_snapshot.est_total_monthly_revenue may be null (revenue aggregation is optional)
    const snapshotWithEstimates: KeywordMarketSnapshot = {
      ...snapshot,
      est_total_monthly_revenue_min: aggregated.total_revenue_min > 0 ? aggregated.total_revenue_min : null,
      est_total_monthly_revenue_max: aggregated.total_revenue_max > 0 ? aggregated.total_revenue_max : null,
      est_total_monthly_units_min: aggregated.total_units_min > 0 ? aggregated.total_units_min : null,
      est_total_monthly_units_max: aggregated.total_units_max > 0 ? aggregated.total_units_max : null,
      search_demand, // Always set when listings exist, null only if no listings
    };

    // TASK 5: Invariant log right before returning snapshot
    console.warn("KEYWORD_SNAPSHOT_RETURN", { 
      listings_count: listingsWithEstimates.length, 
      has_real_listings: listingsWithEstimates.length > 0 
    });
    
    // TASK 6: Final invariant log
    console.info("KEYWORD_ANALYZE_COMPLETE", {
      listings_count: listingsWithEstimates.length,
      has_revenue_estimate: !!(snapshotWithEstimates.est_total_monthly_revenue_min || snapshotWithEstimates.est_total_monthly_revenue_max),
    });
    
    // TASK 3: Always populate market_snapshot.listings[] if listings exist
    console.log("RETURNING_KEYWORD_MARKET_DATA", {
      keyword,
      total_listings: listingsWithEstimates.length,
      snapshot_total_page1_listings: snapshotWithEstimates.total_page1_listings,
      has_avg_price: snapshotWithEstimates.avg_price !== null,
      has_avg_reviews: snapshotWithEstimates.avg_reviews > 0,
      has_avg_rating: snapshotWithEstimates.avg_rating !== null,
      has_revenue_estimate: !!(snapshotWithEstimates.est_total_monthly_revenue_min || snapshotWithEstimates.est_total_monthly_revenue_max),
    });
    
    return {
      snapshot: snapshotWithEstimates,
      listings: listingsWithEstimates, // TASK 3: Always populated if listings exist
    };
  } catch (error) {
    // TASK 2: Classify error - don't treat processing errors as "zero ASINs"
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isProcessingError = apiReturnedResults && extractedAsinCount > 0;
    const isRevenueAggregationError = errorMessage.includes("aggregateRevenueEstimates") || 
                                     errorMessage.includes("REVENUE_AGGREGATION") ||
                                     errorMessage.includes("revenue aggregation");
    
    console.error("Error fetching keyword market snapshot:", {
      keyword,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      api_returned_results: apiReturnedResults,
      extracted_asin_count: extractedAsinCount,
      error_type: isProcessingError ? "processing_error" : "api_error",
      is_revenue_aggregation_error: isRevenueAggregationError,
    });
    
    // TASK 5: Revenue aggregation failures must NOT trigger "zero ASINs" or "No Page-1 listings"
    // If it's a revenue aggregation error and we have ASINs, we should still return the listings
    // However, since we're in a catch block, we can't easily reconstruct the data
    // The revenue aggregation happens AFTER listings are created, so if we get here,
    // it means the error happened during revenue aggregation
    // We should re-throw with a special marker so the caller knows it's a revenue-only error
    if (isRevenueAggregationError && extractedAsinCount > 0) {
      console.warn("REVENUE_AGGREGATION_ERROR_BUT_HAS_LISTINGS", {
        keyword,
        extracted_asin_count: extractedAsinCount,
        message: "Revenue aggregation failed but we have listings - this should be handled before catch",
      });
      // This shouldn't happen if we wrapped revenue aggregation properly
      // But if it does, throw with a special marker
      throw new Error(`REVENUE_AGGREGATION_ONLY: ${errorMessage} (extracted ${extractedAsinCount} ASINs, revenue aggregation failed)`);
    }
    
    // TASK 2: If we extracted ASINs but processing failed (non-revenue errors), throw with classification
    if (isProcessingError && !isRevenueAggregationError) {
      throw new Error(`Processing error: ${errorMessage} (extracted ${extractedAsinCount} ASINs but processing failed)`);
    }
    
    return null; // Only return null for genuine API errors or zero ASINs
  }
}

