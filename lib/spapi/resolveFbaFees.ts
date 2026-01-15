/**
 * FBA Fees Cache-First Resolver
 * 
 * Resolves FBA fees with cache-first strategy:
 * 1. Check fba_fee_cache for ASIN
 * 2. If found AND fetched_at < 30 days old → return cached fees
 * 3. If not found or stale: call getFbaFees, store in cache, return
 * 
 * Never blocks analysis if fees fail - always returns gracefully.
 */

import { createClient } from "@/lib/supabase/server";
import { getFbaFees, FbaFeesResult } from "./getFbaFees";

const CACHE_TTL_DAYS = 30;
const FAILURE_CACHE_TTL_MINUTES = 7; // Cache failures for 7 minutes to prevent retry loops

/**
 * Resolve FBA fees for an ASIN with cache-first strategy
 * 
 * @param asin - Amazon ASIN
 * @param price - Selling price in USD (use avg page 1 price)
 * @returns Promise<FbaFeesResult | null> Fee breakdown or null if unavailable
 */
export async function resolveFbaFees(
  asin: string,
  price: number,
  marketplace: string = "ATVPDKIKX0DER"
): Promise<FbaFeesResult | null> {
  try {
    const supabase = await createClient();
    const normalizedAsin = asin.toUpperCase().trim();
    const normalizedMarketplace = marketplace || "ATVPDKIKX0DER";

    // Step 1: Check failure cache (prevent retry loops)
    const failureCutoffTime = new Date();
    failureCutoffTime.setMinutes(failureCutoffTime.getMinutes() - FAILURE_CACHE_TTL_MINUTES);
    
    const { data: failureCacheData } = await supabase
      .from("fba_fee_cache")
      .select("fetched_at, fulfillment_fee, referral_fee")
      .eq("asin", normalizedAsin)
      .eq("price", price)
      .eq("marketplace", normalizedMarketplace)
      .gte("fetched_at", failureCutoffTime.toISOString())
      .single();
    
    // If we have a recent failure (null fees but recent fetch), don't retry
    if (failureCacheData && 
        failureCacheData.fulfillment_fee === null && 
        failureCacheData.referral_fee === null) {
      console.log(`[FBA_FEES] Skipping retry - recent failure cached for ${normalizedAsin} at price ${price}`);
      return null; // Return null gracefully - caller should use estimate
    }

    // Step 2: Check success cache (30d TTL)
    // CRITICAL: Cache key is (asin, price, marketplace) - fees vary by price
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - CACHE_TTL_DAYS);

    const { data: cachedData, error: cacheError } = await supabase
      .from("fba_fee_cache")
      .select("fulfillment_fee, referral_fee, total_fba_fees, currency, fetched_at")
      .eq("asin", normalizedAsin)
      .eq("price", price)
      .eq("marketplace", normalizedMarketplace)
      .gte("fetched_at", cutoffTime.toISOString())
      .single();

    // Step 3: If found and fresh, return cached ONLY if it contains a usable quote.
    // IMPORTANT: do not treat cached nulls as a hit (this can "poison" fees for 30 days).
    if (!cacheError && cachedData) {
      const cachedFulfillment =
        cachedData.fulfillment_fee !== null
          ? parseFloat(cachedData.fulfillment_fee.toString())
          : null;
      const cachedReferral =
        cachedData.referral_fee !== null
          ? parseFloat(cachedData.referral_fee.toString())
          : null;
      const cachedTotal =
        cachedData.total_fba_fees !== null
          ? parseFloat(cachedData.total_fba_fees.toString())
          : null;

      if (cachedFulfillment !== null && cachedReferral !== null) {
        return {
          fulfillment_fee: cachedFulfillment,
          referral_fee: cachedReferral,
          total_fba_fees: cachedTotal,
          currency: (cachedData.currency as "USD") || "USD",
        };
      }
      // Otherwise: fall through and retry SP-API
    }

    // Step 4: Cache miss or stale - fetch from SP-API (single attempt per request)
    const feesResult = await getFbaFees({
      asin: normalizedAsin,
      price,
      marketplaceId: normalizedMarketplace,
    });

    // Step 5: Store in cache (success OR failure) to prevent retry loops
    // CRITICAL: Cache key is (asin, price, marketplace) - fees vary by price
    // Store failures briefly (7 min) to prevent retry loops, successes for 30 days
    try {
      await supabase
        .from("fba_fee_cache")
        .upsert(
          {
            asin: normalizedAsin,
            price: price,
            marketplace: normalizedMarketplace,
            fulfillment_fee: feesResult.fulfillment_fee,
            referral_fee: feesResult.referral_fee,
            total_fba_fees: feesResult.total_fba_fees,
            currency: feesResult.currency,
            fetched_at: new Date().toISOString(),
          },
          {
            onConflict: "asin,price,marketplace",
          }
        );
    } catch (cacheWriteError) {
      // Log but don't throw - caching failure shouldn't block analysis
      console.error("Failed to cache FBA fees:", cacheWriteError);
    }

    // Step 6: Return fetched values ONLY if usable
    // If null, return null gracefully - caller should use estimate fallback
    if (feesResult.fulfillment_fee === null || feesResult.referral_fee === null) {
      // Failure is now cached (7 min TTL) to prevent retry loops
      return null;
    }
    return feesResult;
  } catch (error) {
    // Never block analysis - return null gracefully
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`resolveFbaFees error for ASIN ${asin}: ${errorMessage}`);
    return null;
  }
}










