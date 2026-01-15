/**
 * Tier-2 Async Refinement
 * 
 * TIER-2 ONLY: Heavy computations that refine Tier-1 estimates.
 * These functions run asynchronously AFTER Tier-1 response is returned.
 * 
 * DO NOT block /api/analyze - run in background worker/queue/detached promise.
 */

import { Tier1MarketSnapshot, Tier2Enrichment, Tier1Product } from "@/types/tierContracts";
import { ParsedListing } from "@/lib/amazon/keywordMarket";

/**
 * Tier-2 Refinement Context
 * 
 * Contains all data needed for refinement without re-fetching.
 */
export interface Tier2RefinementContext {
  snapshot_id: string;
  keyword: string;
  marketplace: 'US' | 'CA';
  listings: ParsedListing[];
  tier1_products: Tier1MarketSnapshot['products'];
  supabase: any;
  apiCallCounter?: { count: number; max: number };
}

/**
 * Refine Tier-1 estimates with BSR, calibration, and confidence scoring
 * 
 * TIER-2 ONLY: This function should be called asynchronously.
 * It performs:
 * - BSR fetching (limited subset)
 * - Calibration + dampening
 * - Confidence scoring
 * - Brand dominance computation
 * - Algorithm boost detection
 */
export async function refineTier2Estimates(
  context: Tier2RefinementContext
): Promise<Tier2Enrichment> {
  const { snapshot_id, keyword, listings, tier1_products, supabase, apiCallCounter } = context;
  
  console.log("🔵 TIER2_REFINEMENT_START", {
    snapshot_id,
    keyword,
    product_count: tier1_products.length,
    timestamp: new Date().toISOString(),
  });
  
  const refinements: Tier2Enrichment['refinements'] = {};
  
  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // TIER-2 STEP 1: DISABLED - BSR fetching removed (use SP-API enrichment instead)
    // ═══════════════════════════════════════════════════════════════════════════
    // BSR data should come from SP-API Catalog Items enrichment (Step 2 in keywordProcessor)
    // This prevents additional Rainforest API calls
    const bsrData = new Map<string, number>();
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIER-2 STEP 2: Run calibration + dampening models
    // ═══════════════════════════════════════════════════════════════════════════
    const calibrationResult = await runCalibration(listings, tier1_products, bsrData);
    if (calibrationResult) {
      refinements.calibrated_units = calibrationResult.calibrated_units;
      refinements.calibrated_revenue = calibrationResult.calibrated_revenue;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIER-2 STEP 3: Compute confidence score
    // ═══════════════════════════════════════════════════════════════════════════
    const confidenceResult = await computeConfidenceScore(listings, tier1_products);
    if (confidenceResult) {
      refinements.confidence_score = confidenceResult.score;
      refinements.confidence_level = confidenceResult.level;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIER-2 STEP 4: Detect algorithm boosts
    // ═══════════════════════════════════════════════════════════════════════════
    const algorithmBoosts = detectAlgorithmBoosts(listings);
    if (algorithmBoosts.length > 0) {
      refinements.algorithm_boosts = algorithmBoosts;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIER-2 STEP 5: Compute brand dominance + moat metrics
    // ═══════════════════════════════════════════════════════════════════════════
    const brandDominance = await computeBrandDominance(tier1_products);
    if (brandDominance) {
      refinements.brand_dominance = brandDominance;
    }
    
    console.log("✅ TIER2_REFINEMENT_COMPLETE", {
      snapshot_id,
      keyword,
      refinements_applied: Object.keys(refinements).length,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error("❌ TIER2_REFINEMENT_ERROR", {
      snapshot_id,
      keyword,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    // Continue with partial refinements if some steps fail
  }
  
  return {
    snapshot_id,
    tier: 'tier2',
    status: 'refined',
    refinements,
    completed_at: new Date().toISOString(),
  };
}

/**
 * DISABLED: Fetch BSR for limited subset
 * 
 * This function has been removed to prevent additional Rainforest API calls.
 * BSR data should come from SP-API Catalog Items enrichment instead.
 * 
 * @deprecated Use SP-API Catalog Items batch enrichment (Step 2 in keywordProcessor)
 */

/**
 * Run calibration + dampening models
 * 
 * TIER-2 ONLY: Uses BSR and historical data for accuracy.
 */
async function runCalibration(
  listings: ParsedListing[],
  tier1Products: Tier1MarketSnapshot['products'],
  bsrData: Map<string, number>
): Promise<{ calibrated_units: number; calibrated_revenue: number } | null> {
  try {
    // Import calibration logic
    const { calibrateMarketTotals } = await import("@/lib/amazon/calibration");
    
    // Calculate aggregates for calibration
    const totalUnits = tier1Products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
    const totalRevenue = tier1Products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
    
    // Get category from listings
    const categories = listings
      .map(l => l.main_category)
      .filter((c): c is string => c !== null && c !== undefined);
    const category = categories.length > 0 ? categories[0] : null;
    
    // Calculate price band
    const prices = listings
      .map(l => l.price)
      .filter((p): p is number => p !== null && p > 0);
    const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
    const priceMax = prices.length > 0 ? Math.max(...prices) : 0;
    
    // Run calibration
    const calibrated = calibrateMarketTotals({
      raw_units: totalUnits,
      raw_revenue: totalRevenue,
      category,
      price_band: { min: priceMin, max: priceMax },
      listing_count: tier1Products.length,
      review_dispersion: 0, // Simplified for Tier-2
      sponsored_density: (tier1Products.filter(p => p.is_sponsored).length / tier1Products.length) * 100,
    });
    
    return {
      calibrated_units: calibrated.calibrated_units,
      calibrated_revenue: calibrated.calibrated_revenue,
    };
  } catch (error) {
    console.warn("⚠️ TIER2_CALIBRATION_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Compute confidence score
 * 
 * TIER-2 ONLY: Uses review dispersion, BSR coverage, etc.
 */
async function computeConfidenceScore(
  listings: ParsedListing[],
  tier1Products: Tier1MarketSnapshot['products']
): Promise<{ score: number; level: 'low' | 'medium' | 'high' } | null> {
  try {
    // Calculate review dispersion
    const reviews = listings
      .map(l => l.reviews)
      .filter((r): r is number => r !== null && r > 0);
    
    const reviewDispersion = reviews.length > 1
      ? calculateReviewDispersion(reviews)
      : 0;
    
    // Calculate confidence score (0-100) based on market signals
    // TIER-2 ONLY: Uses review dispersion, listing count, sponsored density
    let score = 50; // Base score
    
    // Listing count contribution (more listings = higher confidence)
    if (tier1Products.length >= 15) {
      score += 20; // Strong coverage
    } else if (tier1Products.length >= 5) {
      score += 10; // Moderate coverage
    }
    
    // Review dispersion contribution (lower dispersion = higher confidence)
    const avgReviews = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r, 0) / reviews.length
      : 0;
    if (avgReviews > 0) {
      const dispersionRatio = reviewDispersion / avgReviews;
      if (dispersionRatio < 0.5) {
        score += 15; // Low dispersion = consistent market
      } else if (dispersionRatio < 1.0) {
        score += 5; // Moderate dispersion
      }
    }
    
    // Sponsored density contribution (lower = higher confidence)
    const sponsoredDensity = tier1Products.length > 0
      ? (tier1Products.filter(p => p.is_sponsored).length / tier1Products.length) * 100
      : 0;
    if (sponsoredDensity < 20) {
      score += 15; // Low sponsored = organic competition
    }
    
    // Clamp score to 0-100
    score = Math.max(0, Math.min(100, score));
    
    // Convert to level
    let level: 'low' | 'medium' | 'high' = 'low';
    if (score >= 80) {
      level = 'high';
    } else if (score >= 50) {
      level = 'medium';
    }
    
    return {
      score,
      level,
    };
  } catch (error) {
    console.warn("⚠️ TIER2_CONFIDENCE_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Calculate review dispersion (helper)
 */
function calculateReviewDispersion(reviews: number[]): number {
  if (reviews.length === 0) return 0;
  
  const mean = reviews.reduce((sum, r) => sum + r, 0) / reviews.length;
  const variance = reviews.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / reviews.length;
  
  return Math.sqrt(variance);
}

/**
 * Detect algorithm boosts
 * 
 * TIER-2 ONLY: Identifies ASINs appearing multiple times on Page-1.
 */
function detectAlgorithmBoosts(listings: ParsedListing[]): Array<{ asin: string; appearances: number }> {
  const asinCounts = new Map<string, number>();
  
  for (const listing of listings) {
    const asin = listing.asin;
    if (asin) {
      asinCounts.set(asin, (asinCounts.get(asin) || 0) + 1);
    }
  }
  
  const boosts: Array<{ asin: string; appearances: number }> = [];
  
  for (const [asin, count] of asinCounts.entries()) {
    if (count >= 2) {
      boosts.push({ asin, appearances: count });
    }
  }
  
  return boosts;
}

/**
 * Compute brand dominance + moat metrics
 * 
 * TIER-2 ONLY: Calculates brand concentration and market structure.
 */
async function computeBrandDominance(
  tier1Products: Tier1MarketSnapshot['products']
): Promise<{ top_5_brand_share_pct: number; brands: Array<{ brand: string; revenue_share_pct: number }> } | null> {
  if (tier1Products.length === 0) return null;
  
  // Calculate total revenue
  const totalRevenue = tier1Products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (totalRevenue === 0) return null;
  
  // Group by brand
  const brandRevenue = new Map<string, number>();
  
  for (const product of tier1Products) {
    const brand = product.brand || 'Unknown';
    brandRevenue.set(brand, (brandRevenue.get(brand) || 0) + product.estimated_monthly_revenue);
  }
  
  // Sort brands by revenue
  const brands = Array.from(brandRevenue.entries())
    .map(([brand, revenue]) => ({
      brand,
      revenue_share_pct: (revenue / totalRevenue) * 100,
    }))
    .sort((a, b) => b.revenue_share_pct - a.revenue_share_pct);
  
  // Calculate top 5 brand share
  const top5Revenue = brands.slice(0, 5).reduce((sum, b) => sum + b.revenue_share_pct, 0);
  
  return {
    top_5_brand_share_pct: Math.round(top5Revenue * 100) / 100,
    brands: brands.slice(0, 10), // Top 10 brands
  };
}

