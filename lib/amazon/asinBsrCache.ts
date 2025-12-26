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
 * Batch fetch BSR data from Rainforest API with exponential backoff and deduplication
 * 
 * Rate limit handling:
 * - Retry up to 3 times on HTTP 429
 * - Exponential backoff: 1s → 2s → 4s
 * - Other errors fail fast
 * 
 * Deduplication:
 * - Prevents multiple identical batch calls from running concurrently
 * - Uses in-memory map keyed by sorted ASIN list
 * 
 * @param rainforestApiKey - Rainforest API key
 * @param asins - Array of ASINs to fetch (will be sorted for dedup key)
 * @param keyword - Keyword for logging context
 * @returns Promise resolving to batch response data
 */
export async function batchFetchBsrWithBackoff(
  rainforestApiKey: string,
  asins: string[],
  keyword: string
): Promise<any> {
  if (!asins || asins.length === 0) {
    return null;
  }

  // Create dedup key from sorted ASIN list
  const sortedAsins = [...asins].sort();
  const dedupKey = sortedAsins.join(",");

  // Check if request is already in-flight
  if (inflightRequests.has(dedupKey)) {
    console.log("BSR_INFLIGHT_DEDUP_HIT", {
      keyword,
      asin_count: asins.length,
      dedup_key: dedupKey.substring(0, 50) + (dedupKey.length > 50 ? "..." : ""),
      message: "Awaiting existing in-flight batch request",
    });
    return inflightRequests.get(dedupKey)!;
  }

  // Create the batch fetch promise with exponential backoff
  const batchPromise = (async () => {
    const maxRetries = 3;
    let retryCount = 0;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const batchAsinString = sortedAsins.join(",");
        const batchProductUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=product&amazon_domain=amazon.com&asin=${batchAsinString}`;
        
        const batchResponse = await fetch(batchProductUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
        });

        // Check for rate limit (HTTP 429)
        if (batchResponse.status === 429) {
          retryCount++;
          if (attempt < maxRetries - 1) {
            const backoffMs = 2 ** attempt * 1000; // 1s → 2s → 4s
            console.log("BSR_BATCH_RETRY_COUNT", {
              keyword,
              retry_count: retryCount,
              attempt: attempt + 1,
              max_retries: maxRetries,
              backoff_ms: backoffMs,
              status: 429,
              message: "Rate limited, applying exponential backoff",
            });
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          } else {
            // Max retries reached for rate limit
            console.error("BSR_BATCH_RATE_LIMIT_EXHAUSTED", {
              keyword,
              retry_count: retryCount,
              max_retries: maxRetries,
              asin_count: asins.length,
              message: "Rate limit retries exhausted",
            });
            throw new Error(`Rate limit exceeded after ${maxRetries} retries`);
          }
        }

        // Non-429 errors fail fast
        if (!batchResponse.ok) {
          const errorText = await batchResponse.text().catch(() => "Unable to read error response");
          console.error("BSR_BATCH_FETCH_FAILED", {
            keyword,
            status: batchResponse.status,
            statusText: batchResponse.statusText,
            asin_count: asins.length,
            attempt: attempt + 1,
            error_preview: errorText.substring(0, 200),
            message: "Non-rate-limit error, failing fast",
          });
          throw new Error(`Batch fetch failed: ${batchResponse.status} ${batchResponse.statusText}`);
        }

        // Success - parse and return
        const batchData = await batchResponse.json();
        return batchData;

      } catch (error) {
        // Only retry on rate limit errors
        if (error instanceof Error && error.message.includes("Rate limit")) {
          // Already handled in the if block above
          continue;
        }

        // Other errors fail fast
        console.error("BSR_BATCH_FETCH_EXCEPTION", {
          keyword,
          error: error instanceof Error ? error.message : String(error),
          asin_count: asins.length,
          attempt: attempt + 1,
          message: "Non-retryable error, failing fast",
        });
        throw error;
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error("Batch fetch failed after all retries");
  })();

  // Store promise in map and clean up after completion
  inflightRequests.set(dedupKey, batchPromise);
  batchPromise
    .then(() => {
      inflightRequests.delete(dedupKey);
    })
    .catch(() => {
      inflightRequests.delete(dedupKey);
    });

  return batchPromise;
}

