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
  cached_at: string;
  expires_at: string;
  schema_version?: string; // If missing or !== KEYWORD_CACHE_SCHEMA_VERSION, treat as miss
}

const CACHE_TTL_HOURS = 24;
const CACHE_TTL_SECONDS = CACHE_TTL_HOURS * 60 * 60;
/** Bump when schema changes; old cache rows are treated as miss. */
export const KEYWORD_CACHE_SCHEMA_VERSION = "v3";
const DATA_CONTRACT_VERSION = KEYWORD_CACHE_SCHEMA_VERSION;

/** Marketplace ID for US (used in global cache key). */
export const MARKETPLACE_ID_US = "ATVPDKIKX0DER";
/** Amazon domain for US. */
export const AMAZON_DOMAIN_US = "amazon.com";

/**
 * Normalize keyword for cache key: trim → lowercase → collapse multiple spaces to one.
 */
export function normalizeKeywordForCacheKey(keyword: string): string {
  return (keyword || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Generate global cache key (shared across all users, 24h TTL).
 * Format: kw:v3:amazon.com:ATVPDKIKX0DER:keyword:page1:normalized_keyword
 */
export function getCacheKey(
  keyword: string,
  marketplace: string = AMAZON_DOMAIN_US,
  inputType: string = "keyword",
  page: number = 1
): string {
  const normalizedKeyword = normalizeKeywordForCacheKey(keyword);
  const domain = marketplace === "US" || marketplace === "us" ? AMAZON_DOMAIN_US : (marketplace || AMAZON_DOMAIN_US);
  const marketplaceId = domain === AMAZON_DOMAIN_US ? MARKETPLACE_ID_US : MARKETPLACE_ID_US;
  const pagePart = page === 1 ? "page1" : `page${page}`;
  return `kw:${DATA_CONTRACT_VERSION}:${domain}:${marketplaceId}:${inputType}:${pagePart}:${normalizedKeyword}`;
}

/**
 * Validate cached payload has usable listings (detect poisoned/partial cache).
 * CachedKeywordAnalysis stores { listings, snapshot }; API response shape uses page_one_listings/products/listings.
 */
export function isValidKeywordCachePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const listings =
    (payload as any).listings ??
    (payload as any).page_one_listings ??
    (payload as any).products;
  return Array.isArray(listings) && listings.length > 0;
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
 * Store keyword analysis in cache (Task 2: Add CACHE_WRITE log).
 * Only writes when data.listings has length > 0 so we never cache an empty payload as a "valid hit"
 * (avoids instant blank UI after cache-key version bump when recompute returns no products).
 */
export async function cacheKeywordAnalysis(
  supabase: any,
  keyword: string,
  marketplace: string,
  data: KeywordMarketData,
  inputType: string = "keyword",
  page: number = 1
): Promise<void> {
  const listings = data?.listings;
  const hasListings = Array.isArray(listings) && listings.length > 0;
  if (!hasListings) {
    console.log("KEYWORD_CACHE_SKIP_EMPTY", {
      key: getCacheKey(keyword, marketplace, inputType, page),
      keyword,
      reason: "listings empty or missing — not caching to avoid blank UI on next hit",
    });
    return;
  }

  const cacheKey = getCacheKey(keyword, marketplace, inputType, page);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);

  const cached: CachedKeywordAnalysis = {
    keyword: normalizeKeywordForCacheKey(keyword),
    marketplace,
    listings: data.listings,
    snapshot: data.snapshot,
    cached_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    schema_version: KEYWORD_CACHE_SCHEMA_VERSION,
  };

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
      .select("id, data, expires_at, created_at")
      .eq("cache_key", cacheKey)
      .single();

    if (error || !cacheRow) {
      console.log("KEYWORD_CACHE_MISS", { cache_key: cacheKey, reason: error ? "error" : "no_row" });
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
    if (!isValidKeywordCachePayload(cached)) {
      console.warn("KEYWORD_CACHE_POISONED", { cache_key: cacheKey, keyword });
      await supabase
        .from("keyword_analysis_cache")
        .delete()
        .eq("cache_key", cacheKey);
      return { data: null, status: "MISS", age_seconds: 0 };
    }
    const schemaVersion = cached.schema_version;
    if (schemaVersion !== KEYWORD_CACHE_SCHEMA_VERSION) {
      console.log("KEYWORD_CACHE_MISS", {
        cache_key: cacheKey,
        reason: "schema_version_mismatch",
        cached_version: schemaVersion,
        current_version: KEYWORD_CACHE_SCHEMA_VERSION,
      });
      return { data: null, status: "MISS", age_seconds: 0 };
    }

    const createdAt = new Date(cacheRow.created_at || cached.cached_at);
    const now = new Date();
    const ageMs = now.getTime() - createdAt.getTime();
    const ageSeconds = Math.floor(ageMs / 1000);
    const ttlSeconds = CACHE_TTL_SECONDS;

    console.log("KEYWORD_CACHE_HIT", {
      cache_key: cacheKey,
      created_at: cacheRow.created_at,
      expires_at: cacheRow.expires_at,
      schema_version: KEYWORD_CACHE_SCHEMA_VERSION,
    });

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
          cached_at: cached.cached_at,
          expires_at: cached.expires_at,
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
          cached_at: cached.cached_at,
          expires_at: cached.expires_at,
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

/**
 * Invalidate (delete) keyword analysis cache row for a keyword/marketplace.
 * Use to clear poisoned or stale cache (e.g. "food warming mat").
 * Server-only; requires Supabase client with service role or delete policy.
 */
export async function invalidateKeywordCache(
  supabase: any,
  keyword: string,
  marketplace: string = "US",
  inputType: string = "keyword",
  page: number = 1
): Promise<{ deleted: boolean; cache_key: string }> {
  const cacheKey = getCacheKey(keyword, marketplace, inputType, page);
  const { error } = await supabase
    .from("keyword_analysis_cache")
    .delete()
    .eq("cache_key", cacheKey);
  if (error) {
    console.error("KEYWORD_CACHE_INVALIDATE_ERROR", { cache_key: cacheKey, error: error.message });
    return { deleted: false, cache_key: cacheKey };
  }
  console.log("KEYWORD_CACHE_INVALIDATED", { cache_key: cacheKey, keyword, marketplace });
  return { deleted: true, cache_key: cacheKey };
}
