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

import { createApiClient } from "@/lib/supabase/server-api";
import { getFbaFees, FbaFeesResult } from "./getFbaFees";

const CACHE_TTL_DAYS = 30;

/**
 * Resolve FBA fees for an ASIN with cache-first strategy
 * 
 * @param asin - Amazon ASIN
 * @param price - Selling price in USD (use avg page 1 price)
 * @returns Promise<FbaFeesResult | null> Fee breakdown or null if unavailable
 */
export async function resolveFbaFees(
  asin: string,
  price: number
): Promise<FbaFeesResult | null> {
  try {
    const supabase = await createApiClient();
    const normalizedAsin = asin.toUpperCase().trim();

    // Step 1: Check cache
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - CACHE_TTL_DAYS);

    const { data: cachedData, error: cacheError } = await supabase
      .from("fba_fee_cache")
      .select("fulfillment_fee, referral_fee, total_fba_fees, currency, fetched_at")
      .eq("asin", normalizedAsin)
      .gte("fetched_at", cutoffTime.toISOString())
      .single();

    // Step 2: If found and fresh, return cached
    if (!cacheError && cachedData) {
      return {
        fulfillment_fee: cachedData.fulfillment_fee !== null ? parseFloat(cachedData.fulfillment_fee.toString()) : null,
        referral_fee: cachedData.referral_fee !== null ? parseFloat(cachedData.referral_fee.toString()) : null,
        total_fba_fees: cachedData.total_fba_fees !== null ? parseFloat(cachedData.total_fba_fees.toString()) : null,
        currency: (cachedData.currency as "USD") || "USD",
      };
    }

    // Step 3: Cache miss or stale - fetch from SP-API
    const feesResult = await getFbaFees({
      asin: normalizedAsin,
      price,
    });

    // Step 4: Store in cache (best effort, don't block)
    try {
      await supabase
        .from("fba_fee_cache")
        .upsert(
          {
            asin: normalizedAsin,
            fulfillment_fee: feesResult.fulfillment_fee,
            referral_fee: feesResult.referral_fee,
            total_fba_fees: feesResult.total_fba_fees,
            currency: feesResult.currency,
            fetched_at: new Date().toISOString(),
          },
          {
            onConflict: "asin",
          }
        );
    } catch (cacheWriteError) {
      // Log but don't throw - caching failure shouldn't block analysis
      console.error("Failed to cache FBA fees:", cacheWriteError);
    }

    // Step 5: Return fetched values
    return feesResult;
  } catch (error) {
    // Never block analysis - return null gracefully
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`resolveFbaFees error for ASIN ${asin}: ${errorMessage}`);
    return null;
  }
}




