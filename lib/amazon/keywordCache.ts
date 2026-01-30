/**
 * Keyword Analysis Cache
 * 
 * Aggressively caches keyword analysis results to control costs.
 * Cache key: analyze:${marketplace}:${input_type}:${normalized_query}:${page}:${DATA_CONTRACT_VERSION}
 * TTL: 24 hours with stale-while-revalidate
 * 
 * Cached data:
 * - Page-1 listings
 * - Aggregates (avg_price, avg_reviews, etc.)
 * - Search volume estimate
 * - Fulfillment mix
 */

import { KeywordMarketData } from "./keywordMarket";
import {
  type UsageContext,
  buildUsageIdempotencyKey,
  logUsageEvent,
} from "@/lib/usage/logUsageEvent";

export interface CachedKeywordAnalysis {
  keyword: string;
  marketplace: string;
  listings: KeywordMarketData['listings'];
  snapshot: KeywordMarketData['snapshot'];
  cached_at: string; // ISO timestamp
  expires_at: string; // ISO timestamp (cached_at + 24h)
}

const CACHE_TTL_HOURS = 24;
const CACHE_TTL_SECONDS = CACHE_TTL_HOURS * 60 * 60;
const DATA_CONTRACT_VERSION = "v1.0"; // Increment when data contract changes

/**
 * Generate cache key for keyword analysis (Task 1)
 * Format: analyze:${marketplace}:${input_type}:${normalized_query}:${page}:${DATA_CONTRACT_VERSION}
 */
export function getCacheKey(
  keyword: string, 
  marketplace: string = "US",
  inputType: string = "keyword",
  page: number = 1
): string {
  const normalizedKeyword = keyword.toLowerCase().trim();
  return `analyze:${marketplace}:${inputType}:${normalizedKeyword}:${page}:${DATA_CONTRACT_VERSION}`;
}

/**
 * Check if cached data is still valid
 * Returns: { valid: boolean, age_seconds: number, stale: boolean }
 * stale = true if age >= TTL but < TTL*2 (for stale-while-revalidate)
 */
export function getCacheStatus(cached: CachedKeywordAnalysis): {
  valid: boolean;
  age_seconds: number;
  stale: boolean;
} {
  const cachedAt = new Date(cached.cached_at);
  const expiresAt = new Date(cached.expires_at);
  const now = new Date();
  const ageMs = now.getTime() - cachedAt.getTime();
  const ageSeconds = Math.floor(ageMs / 1000);
  const ttlSeconds = CACHE_TTL_SECONDS;
  
  const valid = now < expiresAt;
  const stale = ageSeconds >= ttlSeconds && ageSeconds < ttlSeconds * 2;
  
  return { valid, age_seconds: ageSeconds, stale };
}

/**
 * Store keyword analysis in cache (Task 2: Add CACHE_WRITE log)
 */
export async function cacheKeywordAnalysis(
  supabase: any,
  keyword: string,
  marketplace: string,
  data: KeywordMarketData,
  inputType: string = "keyword",
  page: number = 1
): Promise<void> {
  const cacheKey = getCacheKey(keyword, marketplace, inputType, page);
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
  
  // Calculate payload size
  const payloadBytes = JSON.stringify(cached).length;
  
  try {
    await supabase
      .from("keyword_analysis_cache")
      .upsert({
        cache_key: cacheKey,
        data: cached,
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(), // Ensure created_at is set
      }, {
        onConflict: "cache_key",
      });
    
    // Task 2: Log CACHE_WRITE
    console.log("CACHE_WRITE", {
      key: cacheKey,
      ttl_seconds: CACHE_TTL_SECONDS,
      payload_bytes: payloadBytes,
    });
  } catch (error) {
    console.error("Failed to cache keyword analysis:", error);
    // Don't throw - caching is non-critical
  }
}

/**
 * Retrieve cached keyword analysis (Task 2 & 3: Add logging and stale-while-revalidate)
 * Returns: { data: KeywordMarketData | null, status: 'HIT' | 'MISS' | 'STALE', age_seconds: number }
 * Optional usageContext enables per-user usage logging (idempotent).
 */
export async function getCachedKeywordAnalysis(
  supabase: any,
  keyword: string,
  marketplace: string = "US",
  inputType: string = "keyword",
  page: number = 1,
  usageContext?: UsageContext | null
): Promise<{
  data: KeywordMarketData | null;
  status: 'HIT' | 'MISS' | 'STALE';
  age_seconds: number;
}> {
  const cacheKey = getCacheKey(keyword, marketplace, inputType, page);
  const endpoint = `keyword_analysis:${marketplace}:${inputType}:${page}`;

  // Task 2: Log CACHE_LOOKUP
  console.log("CACHE_LOOKUP", { key: cacheKey });

  try {
    const { data: cacheRow, error } = await supabase
      .from("keyword_analysis_cache")
      .select("data, expires_at, created_at")
      .eq("cache_key", cacheKey)
      .single();

    if (error || !cacheRow) {
      if (usageContext?.userId && usageContext?.messageId) {
        const missKey = buildUsageIdempotencyKey({
          analysisRunId: usageContext.analysisRunId ?? null,
          messageId: usageContext.messageId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          asin: null,
          endpoint,
          cache_status: "miss",
        });
        await logUsageEvent({
          userId: usageContext.userId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          endpoint,
          cache_status: "miss",
          credits_used: 0,
          keyword: keyword.trim(),
          marketplace_id: marketplace,
          meta: { table: "keyword_analysis_cache", cache_key: cacheKey },
          idempotency_key: missKey,
        });
      }
      console.log("CACHE_MISS", { key: cacheKey });
      return { data: null, status: 'MISS', age_seconds: 0 };
    }

    const cached = cacheRow.data as CachedKeywordAnalysis;
    const createdAt = new Date(cacheRow.created_at || cached.cached_at);
    const now = new Date();
    const ageMs = now.getTime() - createdAt.getTime();
    const ageSeconds = Math.floor(ageMs / 1000);
    const ttlSeconds = CACHE_TTL_SECONDS;

    // Task 3: Enforce TTL with stale-while-revalidate
    if (ageSeconds < ttlSeconds) {
      if (usageContext?.userId && usageContext?.messageId) {
        const hitKey = buildUsageIdempotencyKey({
          analysisRunId: usageContext.analysisRunId ?? null,
          messageId: usageContext.messageId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          asin: null,
          endpoint,
          cache_status: "hit",
        });
        await logUsageEvent({
          userId: usageContext.userId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          endpoint,
          cache_status: "hit",
          credits_used: 0,
          keyword: keyword.trim(),
          marketplace_id: marketplace,
          meta: { table: "keyword_analysis_cache", cache_key: cacheKey },
          idempotency_key: hitKey,
        });
      }
      console.log("CACHE_HIT", { key: cacheKey, age_seconds: ageSeconds });
      return {
        data: {
          snapshot: cached.snapshot,
          listings: cached.listings,
        },
        status: 'HIT',
        age_seconds: ageSeconds,
      };
    } else if (ageSeconds < ttlSeconds * 2) {
      if (usageContext?.userId && usageContext?.messageId) {
        const hitKey = buildUsageIdempotencyKey({
          analysisRunId: usageContext.analysisRunId ?? null,
          messageId: usageContext.messageId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          asin: null,
          endpoint,
          cache_status: "hit",
        });
        await logUsageEvent({
          userId: usageContext.userId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          endpoint,
          cache_status: "hit",
          credits_used: 0,
          keyword: keyword.trim(),
          marketplace_id: marketplace,
          meta: { table: "keyword_analysis_cache", cache_key: cacheKey, stale: true },
          idempotency_key: hitKey,
        });
      }
      console.log("CACHE_STALE", {
        key: cacheKey,
        age_seconds: ageSeconds,
        message: "Returning stale cache, triggering async refresh",
      });
      return {
        data: {
          snapshot: cached.snapshot,
          listings: cached.listings,
        },
        status: 'STALE',
        age_seconds: ageSeconds,
      };
    } else {
      if (usageContext?.userId && usageContext?.messageId) {
        const missKey = buildUsageIdempotencyKey({
          analysisRunId: usageContext.analysisRunId ?? null,
          messageId: usageContext.messageId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          asin: null,
          endpoint,
          cache_status: "miss",
        });
        await logUsageEvent({
          userId: usageContext.userId,
          provider: "cache",
          operation: "cache.keyword_analysis",
          endpoint,
          cache_status: "miss",
          credits_used: 0,
          keyword: keyword.trim(),
          marketplace_id: marketplace,
          meta: { table: "keyword_analysis_cache", cache_key: cacheKey, reason: "expired" },
          idempotency_key: missKey,
        });
      }
      await supabase
        .from("keyword_analysis_cache")
        .delete()
        .eq("cache_key", cacheKey);
      console.log("CACHE_MISS", {
        key: cacheKey,
        reason: "expired",
        age_seconds: ageSeconds,
      });
      return { data: null, status: 'MISS', age_seconds: ageSeconds };
    }
  } catch (error) {
    console.error("Failed to retrieve cached keyword analysis:", error);
    console.log("CACHE_MISS", { key: cacheKey, reason: "error" });
    return { data: null, status: 'MISS', age_seconds: 0 };
  }
}
