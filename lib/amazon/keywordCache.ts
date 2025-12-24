/**
 * Keyword Analysis Cache
 * 
 * Aggressively caches keyword analysis results to control costs.
 * Cache key: analyze:keyword:${keyword}:${marketplace}
 * TTL: 24 hours
 * 
 * Cached data:
 * - Page-1 listings
 * - Aggregates (avg_price, avg_reviews, etc.)
 * - Search volume estimate
 * - Fulfillment mix
 */

import { KeywordMarketData } from "./keywordMarket";

export interface CachedKeywordAnalysis {
  keyword: string;
  marketplace: string;
  listings: KeywordMarketData['listings'];
  snapshot: KeywordMarketData['snapshot'];
  cached_at: string; // ISO timestamp
  expires_at: string; // ISO timestamp (cached_at + 24h)
}

const CACHE_TTL_HOURS = 24;

/**
 * Generate cache key for keyword analysis
 */
export function getCacheKey(keyword: string, marketplace: string = "US"): string {
  const normalizedKeyword = keyword.toLowerCase().trim();
  return `analyze:keyword:${normalizedKeyword}:${marketplace}`;
}

/**
 * Check if cached data is still valid
 */
export function isCacheValid(cached: CachedKeywordAnalysis): boolean {
  const expiresAt = new Date(cached.expires_at);
  const now = new Date();
  return now < expiresAt;
}

/**
 * Store keyword analysis in cache
 */
export async function cacheKeywordAnalysis(
  supabase: any,
  keyword: string,
  marketplace: string,
  data: KeywordMarketData
): Promise<void> {
  const cacheKey = getCacheKey(keyword, marketplace);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);
  
  const cached: CachedKeywordAnalysis = {
    keyword: keyword.toLowerCase().trim(),
    marketplace,
    listings: data.listings,
    snapshot: data.snapshot,
    cached_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  
  try {
    await supabase
      .from("keyword_analysis_cache")
      .upsert({
        cache_key: cacheKey,
        data: cached,
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: "cache_key",
      });
  } catch (error) {
    console.error("Failed to cache keyword analysis:", error);
    // Don't throw - caching is non-critical
  }
}

/**
 * Retrieve cached keyword analysis
 */
export async function getCachedKeywordAnalysis(
  supabase: any,
  keyword: string,
  marketplace: string = "US"
): Promise<KeywordMarketData | null> {
  const cacheKey = getCacheKey(keyword, marketplace);
  
  try {
    const { data, error } = await supabase
      .from("keyword_analysis_cache")
      .select("data, expires_at")
      .eq("cache_key", cacheKey)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    const cached = data.data as CachedKeywordAnalysis;
    
    // Check if cache is still valid
    if (!isCacheValid(cached)) {
      // Cache expired - delete it
      await supabase
        .from("keyword_analysis_cache")
        .delete()
        .eq("cache_key", cacheKey);
      return null;
    }
    
    // Return cached data
    return {
      snapshot: cached.snapshot,
      listings: cached.listings,
    };
  } catch (error) {
    console.error("Failed to retrieve cached keyword analysis:", error);
    return null;
  }
}
