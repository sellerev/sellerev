/**
 * ASIN BSR Cache Service
 * 
 * Manages caching of BSR (Best Seller Rank) data to minimize Rainforest API calls.
 * TTL: 48 hours
 */

export interface BsrCacheEntry {
  asin: string;
  main_category: string | null;
  main_category_bsr: number | null;
  price: number | null;
  brand: string | null;
  last_fetched_at: string;
  source: string;
}

const BSR_CACHE_TTL_HOURS = 48;

// In-flight request deduplication map (cache stampede protection)
// Key: sorted ASIN list joined by comma
// Value: Promise resolving to batch response
const inflightRequests = new Map<string, Promise<any>>();

/**
 * Bulk lookup BSR cache entries for multiple ASINs
 * Returns entries that are still fresh (within TTL)
 * 
 * @param supabase - Supabase client
 * @param asins - Array of ASINs to lookup
 * @returns Map of ASIN -> BsrCacheEntry for fresh entries
 */
export async function bulkLookupBsrCache(
  supabase: any,
  asins: string[]
): Promise<Map<string, BsrCacheEntry>> {
  if (!supabase || !asins || asins.length === 0) {
    return new Map();
  }

  try {
    // Query cache for ASINs that are still fresh (within 48 hours)
    const ttlCutoff = new Date();
    ttlCutoff.setHours(ttlCutoff.getHours() - BSR_CACHE_TTL_HOURS);

    const { data, error } = await supabase
      .from("asin_bsr_cache")
      .select("*")
      .in("asin", asins)
      .gte("last_fetched_at", ttlCutoff.toISOString());

    if (error) {
      console.error("BSR_CACHE_BULK_LOOKUP_ERROR", {
        error: error.message,
        asin_count: asins.length,
      });
      return new Map();
    }

    const cacheMap = new Map<string, BsrCacheEntry>();
    if (data) {
      for (const row of data) {
        cacheMap.set(row.asin, {
          asin: row.asin,
          main_category: row.main_category || null,
          main_category_bsr: row.main_category_bsr || null,
          price: row.price ? parseFloat(row.price) : null,
          brand: row.brand || null,
          last_fetched_at: row.last_fetched_at,
          source: row.source || "rainforest",
        });
      }
    }

    return cacheMap;
  } catch (error) {
    console.error("BSR_CACHE_BULK_LOOKUP_EXCEPTION", {
      error: error instanceof Error ? error.message : String(error),
      asin_count: asins.length,
    });
    return new Map();
  }
}

/**
 * Upsert BSR cache entries (bulk operation)
 * 
 * @param supabase - Supabase client
 * @param entries - Array of BSR cache entries to upsert
 */
export async function bulkUpsertBsrCache(
  supabase: any,
  entries: Array<{
    asin: string;
    main_category: string | null;
    main_category_bsr: number | null;
    price: number | null;
    brand?: string | null;
  }>
): Promise<void> {
  if (!supabase || !entries || entries.length === 0) {
    return;
  }

  try {
    const now = new Date().toISOString();
    const upsertData = entries.map((entry) => ({
      asin: entry.asin,
      main_category: entry.main_category,
      main_category_bsr: entry.main_category_bsr,
      price: entry.price,
      brand: entry.brand ?? null,
      last_fetched_at: now,
      source: "rainforest",
    }));

    const { error } = await supabase
      .from("asin_bsr_cache")
      .upsert(upsertData, {
        onConflict: "asin",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("BSR_CACHE_BULK_UPSERT_ERROR", {
        error: error.message,
        entry_count: entries.length,
      });
    }
  } catch (error) {
    console.error("BSR_CACHE_BULK_UPSERT_EXCEPTION", {
      error: error instanceof Error ? error.message : String(error),
      entry_count: entries.length,
    });
  }
}

/**
 * Fetch BSR data from Rainforest API using individual ASIN requests with concurrency limiting
 * 
 * CRITICAL: Rainforest API does NOT support comma-separated ASINs in batch requests
 * This function fetches each ASIN individually but processes them in parallel for speed
 * 
 * Rate limit handling:
 * - Individual ASIN failures are logged but don't stop the process
 * - Failed ASINs are skipped, successful ones are returned
 * 
 * Concurrency:
 * - Processes 5-8 ASINs concurrently to respect rate limits
 * - Uses Promise.all with batching to control parallelism
 * 
 * @param rainforestApiKey - Rainforest API key
 * @param asins - Array of ASINs to fetch
 * @param keyword - Keyword for logging context
 * @returns Promise resolving to array of product objects (same format as batch response would be)
 */
export async function batchFetchBsrWithBackoff(
  rainforestApiKey: string,
  asins: string[],
  keyword: string,
  apiCallCounter?: { count: number; max: number }
): Promise<any> {
  if (!asins || asins.length === 0) {
    return null;
  }

  // Remove duplicates and apply hard cap
  const uniqueAsins = Array.from(new Set(asins)).slice(0, 4); // 🚨 HARD CAP: Max 4 ASINs (part of 7-call budget: 1 search + 4 BSR + 2 metadata)
  
  // 🚨 API SAFETY LIMIT: Check if we've exceeded max calls
  if (apiCallCounter && apiCallCounter.count >= apiCallCounter.max) {
    const skippedCount = uniqueAsins.length;
    const remainingBudget = apiCallCounter.max - apiCallCounter.count;
    console.warn("🚨 ENRICHMENT_SKIPPED_DUE_TO_BUDGET", {
      enrichment_type: "BSR",
      keyword,
      current_count: apiCallCounter.count,
      max_allowed: apiCallCounter.max,
      remaining_budget: remainingBudget,
      asins_skipped: skippedCount,
      message: "BSR enrichment skipped - API call budget exhausted",
    });
    return null;
  }
  
  console.log("🟡 BSR_FETCH_START", {
    keyword,
    total_asins: uniqueAsins.length,
    fetch_strategy: "individual_parallel",
    api_calls_remaining: apiCallCounter ? apiCallCounter.max - apiCallCounter.count : "unlimited",
  });

  // Fetch ASINs individually with concurrency limiting
  const CONCURRENCY_LIMIT = 6; // Process 6 ASINs at a time
  const allProducts: any[] = [];
  let successfulFetches = 0;
  let failedFetches = 0;

  // Process ASINs in batches to respect rate limits
  for (let i = 0; i < uniqueAsins.length; i += CONCURRENCY_LIMIT) {
    const asinBatch = uniqueAsins.slice(i, i + CONCURRENCY_LIMIT);
    
      // Fetch this batch in parallel
      const batchPromises = asinBatch.map(async (asin) => {
        // 🚨 API SAFETY LIMIT: Check before each call
        if (apiCallCounter && apiCallCounter.count >= apiCallCounter.max) {
          const remainingBudget = apiCallCounter.max - apiCallCounter.count;
          const skippedAsins = asinBatch.filter(a => a !== asin).length + 1; // Count this ASIN + remaining in batch
          console.warn("🚨 ENRICHMENT_SKIPPED_DUE_TO_BUDGET", {
            enrichment_type: "BSR",
            asin,
            keyword,
            current_count: apiCallCounter.count,
            max_allowed: apiCallCounter.max,
            remaining_budget: remainingBudget,
            asins_skipped: skippedAsins,
            message: "BSR enrichment skipped for this ASIN - API call budget exhausted",
          });
          return null;
        }
        
        console.log("🟡 BSR_FETCH_START", { asin, keyword });
        
        // Increment counter before API call
        if (apiCallCounter) {
          apiCallCounter.count++;
        }
        
        const productUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=product&amazon_domain=amazon.com&asin=${asin}`;
        
        try {
          const response = await fetch(productUrl, {
            method: "GET",
            headers: { "Accept": "application/json" },
          });

        if (!response.ok) {
          console.error("🔴 BSR_FETCH_FAILED", {
            asin,
            keyword,
            status: response.status,
            statusText: response.statusText,
          });
          return null;
        }

        const data = await response.json();
        
        // Check for API-level errors in response
        if (data && data.error) {
          console.error("🔴 BSR_FETCH_FAILED", {
            asin,
            keyword,
            status: response.status,
            api_error: data.error,
          });
          return null;
        }
        
        // Extract product from response (Rainforest returns { product: {...} } or just product)
        const product = data?.product || data;
        if (product && product.asin) {
          console.log("🟢 BSR_FETCH_SUCCESS", {
            asin,
            keyword,
            has_bsr: !!(product.bestsellers_rank || product.bsr),
          });
          return product;
        }
        
        console.error("🔴 BSR_FETCH_FAILED", {
          asin,
          keyword,
          reason: "no_product_data",
        });
        return null;
      } catch (fetchError) {
        console.error("🔴 BSR_FETCH_FAILED", {
          asin,
          keyword,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        });
        return null;
      }
    });
    
    // Wait for this batch to complete
    const batchResults = await Promise.all(batchPromises);
    
    // Filter out null results and add to allProducts
    const validProducts = batchResults.filter((p): p is any => p !== null);
    allProducts.push(...validProducts);
    successfulFetches += validProducts.length;
    failedFetches += (batchResults.length - validProducts.length);
    
    // Log batch progress
    const batchNumber = Math.floor(i / CONCURRENCY_LIMIT) + 1;
    const totalBatches = Math.ceil(uniqueAsins.length / CONCURRENCY_LIMIT);
    console.log("🔵 BSR_BATCH_PROGRESS", {
      keyword,
      batch: `${batchNumber}/${totalBatches}`,
      successful: validProducts.length,
      failed: batchResults.length - validProducts.length,
      total_fetched: allProducts.length,
    });
  }
  
  // Log summary
  console.log("📊 FINAL_BSR_COVERAGE_PERCENT", {
    keyword,
    total: uniqueAsins.length,
    with_bsr: successfulFetches,
    failed: failedFetches,
    coverage_percent: uniqueAsins.length > 0 
      ? `${((successfulFetches / uniqueAsins.length) * 100).toFixed(1)}%`
      : "0%",
  });
  
  console.log("✅ BSR_FETCH_COMPLETE", {
    keyword,
    total_products: allProducts.length,
    timestamp: new Date().toISOString(),
  });
  
  // Return array of products (same format as batch response would be)
  // Return null if all fetches failed (to match original behavior)
  if (allProducts.length === 0) {
    return null;
  }
  
  return allProducts;
}

