/**
 * Tier-1 Snapshot Builder
 * 
 * Builds Tier-1 market snapshot from canonicalized listings.
 * This is the fast path that returns immediately (≤10s).
 */

import { ParsedListing } from "@/lib/amazon/keywordMarket";
import { Tier1MarketSnapshot, Tier1Product } from "@/types/tierContracts";
import { buildTier1Products, calculateTier1Aggregates } from "@/lib/estimators/tier1Estimation";

function normalizeBrandBucket(brand: string | null | undefined): string {
  const raw = (brand || "").trim();
  if (!raw) return "Unknown";
  const normalized = raw.toLowerCase();
  if (normalized === "unknown" || normalized === "generic" || normalized === "unbranded") {
    return "Unknown";
  }
  return normalized;
}

function isHiddenBrandBucket(bucket: string): boolean {
  return bucket === "Unknown" || bucket === "unknown" || bucket === "generic" || bucket === "unbranded";
}

function computeBrandStats(products: Tier1Product[]): { page1_brand_count: number; top_5_brand_share_pct: number } {
  // Count unique brand buckets INCLUDING Unknown/Generic (counts toward diversity)
  const buckets = new Set<string>();
  const revenueByBucket = new Map<string, number>();

  for (const p of products) {
    const bucket = normalizeBrandBucket(p.brand);
    buckets.add(bucket);
    const rev = typeof p.estimated_monthly_revenue === "number" ? p.estimated_monthly_revenue : 0;
    revenueByBucket.set(bucket, (revenueByBucket.get(bucket) || 0) + rev);
  }

  const totalRevenue = Array.from(revenueByBucket.values()).reduce((sum, r) => sum + r, 0);

  // Top-5 share: exclude "Unknown/Generic" buckets from numerator but keep them in denominator
  const top5Revenue = Array.from(revenueByBucket.entries())
    .filter(([bucket]) => !isHiddenBrandBucket(bucket))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .reduce((sum, [, rev]) => sum + rev, 0);

  const top_5_brand_share_pct = totalRevenue > 0
    ? Math.round((top5Revenue / totalRevenue) * 1000) / 10 // 1 decimal
    : 0;

  return {
    page1_brand_count: buckets.size,
    top_5_brand_share_pct,
  };
}

/**
 * Build Tier-1 snapshot from canonicalized listings
 * 
 * TIER-1 ONLY: Fast path without BSR, calibration, or confidence scoring.
 * 
 * Steps:
 * 1. Canonicalize listings (dedupe ASINs, select best rank)
 * 2. HARD CAP to top 49 organic listings
 * 3. Extract basic fields (asin, title, image, price, rating, reviews, fulfillment, brand)
 * 4. Run Tier-1 fast estimators (rank-based, no BSR)
 * 5. Build Tier-1 snapshot object
 * 
 * IMPORTANT: This function is called BEFORE full canonical builder runs.
 * It uses raw listings and does fast canonicalization + estimation.
 */
export function buildTier1Snapshot(
  listings: ParsedListing[],
  keyword: string,
  marketplace: 'US' | 'CA' = 'US',
  phase: Tier1MarketSnapshot['phase'] = 'complete'
): Tier1MarketSnapshot {
  if (listings.length === 0) {
    // Return empty snapshot if no listings
    return {
      snapshot_id: generateSnapshotId(keyword, marketplace),
      keyword,
      marketplace,
      tier: 'tier1',
      status: 'partial',
      phase,
      products: [],
      aggregates: {
        total_page1_units: 0,
        total_page1_revenue: 0,
        avg_price: null,
        avg_reviews: null,
        avg_rating: null,
      },
      created_at: new Date().toISOString(),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Canonicalize listings (dedupe ASINs, select best rank)
  // ═══════════════════════════════════════════════════════════════════════════
  const canonicalized = canonicalizeListings(listings);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: HARD CAP to top 49 organic listings
  // ═══════════════════════════════════════════════════════════════════════════
  const organicListings = canonicalized.filter(l => !l.is_sponsored);
  const cappedListings = organicListings.slice(0, 49);
  
  console.log("🔵 TIER1_CANONICALIZATION", {
    raw_count: listings.length,
    canonicalized_count: canonicalized.length,
    organic_count: organicListings.length,
    capped_count: cappedListings.length,
    keyword,
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Build Tier-1 products (fast estimation, no BSR)
  // ═══════════════════════════════════════════════════════════════════════════
  const products = buildTier1Products(cappedListings, 49);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Calculate aggregates
  // ═══════════════════════════════════════════════════════════════════════════
  const aggregates = calculateTier1Aggregates(products);

  // Brand stats computed from canonical Page-1 products (NOT UI cards)
  const brand_stats = computeBrandStats(products);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Generate snapshot ID
  // ═══════════════════════════════════════════════════════════════════════════
  const snapshot_id = generateSnapshotId(keyword, marketplace);
  
  return {
    snapshot_id,
    keyword,
    marketplace,
    tier: 'tier1',
    status: 'partial',
    phase,
    products, // HARD CAP: 49 products max
    aggregates,
    brand_stats,
    created_at: new Date().toISOString(),
  };
}

/**
 * Canonicalize listings (dedupe ASINs, select best rank)
 * 
 * TIER-1 ONLY: Fast deduplication without full canonical builder.
 */
function canonicalizeListings(listings: ParsedListing[]): ParsedListing[] {
  if (listings.length === 0) return [];
  
  // Group by ASIN, keep best (lowest) rank
  const asinMap = new Map<string, ParsedListing>();
  
  for (const listing of listings) {
    const asinRaw = listing.asin;
    const asin = typeof asinRaw === "string" ? asinRaw.trim().toUpperCase() : "";
    // Hard requirement: Tier-1 snapshot products must reference real ASINs (no KEYWORD-* fallbacks).
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const currentRank = listing.position || 999;
    
    if (asinMap.has(asin)) {
      const existing = asinMap.get(asin)!;
      const existingRank = existing.position || 999;
      
      // Keep listing with better (lower) rank
      // Prefer organic over sponsored
      const shouldReplace = 
        (!listing.is_sponsored && existing.is_sponsored) ||
        (listing.is_sponsored === existing.is_sponsored && currentRank < existingRank);
      
      if (shouldReplace) {
        asinMap.set(asin, listing);
      }
    } else {
      asinMap.set(asin, listing);
    }
  }
  
  // Convert back to array and sort by rank
  return Array.from(asinMap.values())
    .sort((a, b) => (a.position || 999) - (b.position || 999));
}

/**
 * Generate unique snapshot ID
 */
function generateSnapshotId(keyword: string, marketplace: string): string {
  const timestamp = Date.now();
  const hash = keyword.toLowerCase().replace(/\s+/g, '-').substring(0, 20);
  return `snapshot-${marketplace}-${hash}-${timestamp}`;
}

