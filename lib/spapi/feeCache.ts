/**
 * FBA Fee Cache
 * 
 * Caches SP-API fee estimates in Supabase to reduce API calls.
 * Cache entries are valid for 24 hours.
 */

import { createApiClient } from "@/lib/supabase/server-api";
import { FbaFeesEstimateResult } from "./fees";

const CACHE_TTL_HOURS = 24;

interface FeeCacheEntry {
  marketplace_id: string;
  asin: string;
  price: number;
  total_fee: number | null;
  source: "sp_api" | "estimated";
  created_at: string;
}

/**
 * Get cached FBA fee estimate if available and fresh (< 24h)
 * 
 * @param marketplaceId - Marketplace ID (default: ATVPDKIKX0DER for US)
 * @param asin - Amazon ASIN
 * @param price - Selling price
 * @returns Cached fee estimate or null if not found/expired
 */
export async function getCachedFee(
  marketplaceId: string,
  asin: string,
  price: number
): Promise<FbaFeesEstimateResult | null> {
  try {
    const supabase = await createApiClient();
    
    // Calculate cutoff time (24 hours ago)
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - CACHE_TTL_HOURS);
    
    // Round price to 2 decimal places for consistent comparison
    const roundedPrice = parseFloat(price.toFixed(2));
    
    const { data, error } = await supabase
      .from("fee_cache")
      .select("total_fee, source, created_at")
      .eq("marketplace_id", marketplaceId)
      .eq("asin", asin.toUpperCase())
      .eq("price", roundedPrice)
      .gte("created_at", cutoffTime.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    // Return cached result
    return {
      total_fee: data.total_fee,
      source: data.source as "sp_api" | "estimated",
      asin_used: asin.toUpperCase(),
      price_used: price,
    };
  } catch (error) {
    // Fail silently - cache miss is not an error
    return null;
  }
}

/**
 * Cache FBA fee estimate result
 * 
 * @param marketplaceId - Marketplace ID
 * @param asin - Amazon ASIN
 * @param price - Selling price
 * @param feeResult - Fee estimate result to cache
 */
export async function setCachedFee(
  marketplaceId: string,
  asin: string,
  price: number,
  feeResult: FbaFeesEstimateResult
): Promise<void> {
  try {
    const supabase = await createApiClient();
    
    // Upsert cache entry (replace if exists for same marketplace/asin/price)
    // Round price to 2 decimal places for consistent storage
    const roundedPrice = parseFloat(price.toFixed(2));
    
    const { error } = await supabase
      .from("fee_cache")
      .upsert(
        {
          marketplace_id: marketplaceId,
          asin: asin.toUpperCase(),
          price: roundedPrice,
          total_fee: feeResult.total_fee,
          source: feeResult.source,
          created_at: new Date().toISOString(),
        },
        {
          onConflict: "marketplace_id,asin,price",
        }
      );
    
    if (error) {
      // Log but don't throw - caching failure shouldn't break the flow
      console.error("Failed to cache fee estimate:", error);
    }
  } catch (error) {
    // Fail silently - caching is best effort
    console.error("Error caching fee estimate:", error);
  }
}

