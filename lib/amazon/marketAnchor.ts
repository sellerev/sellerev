/**
 * Market Anchor Cache
 * 
 * Stores canonical market anchors (total demand + rank distribution) for keywords.
 * Cache key: keyword:{marketplace}:{normalized_keyword}:market_anchor
 * TTL: 24 hours
 * 
 * Market anchors are computed once from page-1 signals and reused for stable totals.
 */

import { CanonicalProduct } from "./canonicalPageOne";

export interface RankDistribution {
  // Rank buckets: percentage of total market units per rank range
  rank_1: number; // Percentage for rank 1
  rank_2_3: number; // Percentage for ranks 2-3 combined
  rank_4_10: number; // Percentage for ranks 4-10
  rank_11_20: number; // Percentage for ranks 11-20
  rank_21_plus: number; // Percentage for ranks 21+
  sponsored: number; // Percentage for sponsored listings
}

export interface MarketAnchor {
  estimated_market_units: number; // Total monthly units for Page-1
  estimated_market_revenue: number; // Total monthly revenue for Page-1
  rank_distribution: RankDistribution; // Percent per rank bucket (sums to 100%)
  computed_at: string; // ISO timestamp when anchor was computed
  expires_at: string; // ISO timestamp when anchor expires
}

const CACHE_TTL_HOURS = 24;
const MARKET_ANCHOR_CACHE_PREFIX = "keyword";
const MARKET_ANCHOR_CACHE_SUFFIX = "market_anchor";

/**
 * Generate cache key for market anchor
 * Format: keyword:{marketplace}:{normalized_keyword}:market_anchor
 */
export function getMarketAnchorCacheKey(
  keyword: string,
  marketplace: string = "US"
): string {
  const normalizedKeyword = keyword.toLowerCase().trim();
  return `${MARKET_ANCHOR_CACHE_PREFIX}:${marketplace}:${normalizedKeyword}:${MARKET_ANCHOR_CACHE_SUFFIX}`;
}

/**
 * Retrieve cached market anchor
 */
export async function getCachedMarketAnchor(
  supabase: any,
  keyword: string,
  marketplace: string = "US"
): Promise<{
  anchor: MarketAnchor | null;
  source: "cache" | "computed";
  age_seconds: number;
}> {
  const cacheKey = getMarketAnchorCacheKey(keyword, marketplace);
  
  try {
    const { data: cacheRow, error } = await supabase
      .from("keyword_analysis_cache")
      .select("data, expires_at, created_at")
      .eq("cache_key", cacheKey)
      .single();
    
    if (error || !cacheRow) {
      return { anchor: null, source: "computed", age_seconds: 0 };
    }
    
    const now = new Date();
    const expiresAt = new Date(cacheRow.expires_at);
    
    // Check if cache is expired
    if (now >= expiresAt) {
      return { anchor: null, source: "computed", age_seconds: 0 };
    }
    
    // Extract market anchor from cache data
    // The cache.data may contain the anchor directly or in a nested structure
    const cachedData = cacheRow.data as any;
    const anchor: MarketAnchor = cachedData.market_anchor || cachedData;
    
    // Validate anchor structure
    if (!anchor.estimated_market_units || !anchor.rank_distribution) {
      return { anchor: null, source: "computed", age_seconds: 0 };
    }
    
    const createdAt = new Date(cacheRow.created_at || anchor.computed_at);
    const ageMs = now.getTime() - createdAt.getTime();
    const ageSeconds = Math.floor(ageMs / 1000);
    
    return { anchor, source: "cache", age_seconds: ageSeconds };
  } catch (error) {
    console.error("Failed to retrieve cached market anchor:", error);
    return { anchor: null, source: "computed", age_seconds: 0 };
  }
}

/**
 * Store market anchor in cache
 */
export async function cacheMarketAnchor(
  supabase: any,
  keyword: string,
  marketplace: string,
  anchor: Omit<MarketAnchor, "computed_at" | "expires_at">
): Promise<void> {
  const cacheKey = getMarketAnchorCacheKey(keyword, marketplace);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);
  
  const anchorWithTimestamps: MarketAnchor = {
    ...anchor,
    computed_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  
  try {
    await supabase
      .from("keyword_analysis_cache")
      .upsert({
        cache_key: cacheKey,
        data: { market_anchor: anchorWithTimestamps },
        expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
      }, {
        onConflict: "cache_key",
      });
  } catch (error) {
    console.error("Failed to cache market anchor:", error);
    // Don't throw - caching is non-critical
  }
}

/**
 * Compute rank distribution from allocation weights pattern
 * Uses exponential decay pattern: exp(-0.45 * (rank - 1))
 * Organic gets 85% of total, sponsored gets 15%
 */
export function computeRankDistribution(organicCount: number, sponsoredCount: number): RankDistribution {
  const EXPONENTIAL_DECAY_CONSTANT = -0.45;
  const ORGANIC_SHARE = 0.85;
  const SPONSORED_SHARE = 0.15;
  
  // Compute weights for each organic rank
  const rankWeights: number[] = [];
  for (let rank = 1; rank <= organicCount; rank++) {
    rankWeights.push(Math.exp(EXPONENTIAL_DECAY_CONSTANT * (rank - 1)));
  }
  
  // Normalize weights to sum to 1.0
  const totalWeight = rankWeights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights = rankWeights.map(w => w / totalWeight);
  
  // Aggregate into rank buckets
  let rank1Percent = 0;
  let rank2_3Percent = 0;
  let rank4_10Percent = 0;
  let rank11_20Percent = 0;
  let rank21_plusPercent = 0;
  
  normalizedWeights.forEach((weight, index) => {
    const rank = index + 1;
    const percent = weight * ORGANIC_SHARE * 100;
    
    if (rank === 1) {
      rank1Percent = percent;
    } else if (rank >= 2 && rank <= 3) {
      rank2_3Percent += percent;
    } else if (rank >= 4 && rank <= 10) {
      rank4_10Percent += percent;
    } else if (rank >= 11 && rank <= 20) {
      rank11_20Percent += percent;
    } else if (rank >= 21) {
      rank21_plusPercent += percent;
    }
  });
  
  return {
    rank_1: rank1Percent,
    rank_2_3: rank2_3Percent,
    rank_4_10: rank4_10Percent,
    rank_11_20: rank11_20Percent,
    rank_21_plus: rank21_plusPercent,
    sponsored: SPONSORED_SHARE * 100,
  };
}

/**
 * Get rank bucket for a given organic rank
 */
export function getRankBucket(rank: number | null): keyof RankDistribution {
  if (rank === null) {
    return "sponsored";
  }
  
  if (rank === 1) return "rank_1";
  if (rank >= 2 && rank <= 3) return "rank_2_3";
  if (rank >= 4 && rank <= 10) return "rank_4_10";
  if (rank >= 11 && rank <= 20) return "rank_11_20";
  return "rank_21_plus";
}

/**
 * Compute market anchor from page-1 signals
 * This should be called once per keyword and cached
 */
export function computeMarketAnchor(
  marketDemandEstimate: number,
  avgPrice: number,
  organicCount: number,
  sponsoredCount: number
): Omit<MarketAnchor, "computed_at" | "expires_at"> {
  const rankDistribution = computeRankDistribution(organicCount, sponsoredCount);
  const estimatedMarketRevenue = Math.round(marketDemandEstimate * avgPrice);
  
  return {
    estimated_market_units: marketDemandEstimate,
    estimated_market_revenue: estimatedMarketRevenue,
    rank_distribution: rankDistribution,
  };
}

