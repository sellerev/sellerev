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

