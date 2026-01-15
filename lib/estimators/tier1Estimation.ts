/**
 * Tier-1 Fast Estimation
 * 
 * TIER-1 ONLY: Fast, non-BSR-based estimation for initial UI render.
 * These functions MUST complete in ≤10 seconds and do NOT depend on:
 * - BSR fetching
 * - Calibration
 * - Historical data
 * - Confidence scoring
 * 
 * Accuracy is approximate but consistent - Tier-2 will refine these estimates.
 */

import { ParsedListing } from "@/lib/amazon/keywordMarket";
import { Tier1Product } from "@/types/tierContracts";

/**
 * Fast revenue estimation based on rank and price only (NO BSR)
 * 
 * Uses exponential decay model:
 * - Rank 1 gets highest weight
 * - Rank 49 gets lowest weight
 * - Price is used as multiplier
 * 
 * This is approximate - Tier-2 will refine with BSR and calibration.
 */
function estimateRevenueFast(
  rank: number,
  price: number,
  totalMarketRevenue: number,
  totalProducts: number
): number {
  // Exponential decay: rank 1 = 1.0, rank 49 = ~0.1
  const rankWeight = 1.0 / Math.pow(rank, 0.7);
  
  // Normalize weights across all products
  // For Tier-1, we use a simple approximation
  const estimatedShare = rankWeight / totalProducts;
  
  // Allocate revenue based on share
  const estimatedRevenue = totalMarketRevenue * estimatedShare;
  
  return Math.max(0, Math.round(estimatedRevenue));
}

/**
 * Fast units estimation based on revenue and price
 */
function estimateUnitsFast(revenue: number, price: number): number {
  if (!price || price <= 0) return 0;
  return Math.max(0, Math.round(revenue / price));
}

/**
 * Estimate total Page-1 market revenue (fast heuristic)
 * 
 * Uses aggregate signals:
 * - Product count
 * - Average price
 * - Review counts (as proxy for demand)
 * 
 * This is approximate - Tier-2 will refine with BSR and calibration.
 */
function estimateTotalMarketRevenueFast(listings: ParsedListing[]): number {
  if (listings.length === 0) return 0;
  
  // Calculate average price
  const prices = listings
    .map(l => l.price)
    .filter((p): p is number => p !== null && p > 0);
  const avgPrice = prices.length > 0
    ? prices.reduce((sum, p) => sum + p, 0) / prices.length
    : 0;
  
  // Estimate based on product count and average price
  // Heuristic: ~$50k-200k per product per month for typical markets
  // This is a rough approximation - Tier-2 will refine
  const baseRevenuePerProduct = avgPrice > 0 ? avgPrice * 1000 : 50000;
  const totalRevenue = listings.length * baseRevenuePerProduct;
  
  // Apply rough calibration based on price range
  let multiplier = 1.0;
  if (avgPrice > 100) {
    multiplier = 0.6; // Higher price = lower volume
  } else if (avgPrice < 20) {
    multiplier = 1.5; // Lower price = higher volume
  }
  
  return Math.round(totalRevenue * multiplier);
}

/**
 * Build Tier-1 products from canonicalized listings
 * 
 * TIER-1 ONLY: Fast estimation without BSR or calibration.
 * Products are capped at 49 and use rank-based allocation.
 */
export function buildTier1Products(
  listings: ParsedListing[],
  maxProducts: number = 49
): Tier1Product[] {
  if (listings.length === 0) return [];
  
  // HARD CAP: Never exceed 49 products
  const cappedListings = listings.slice(0, maxProducts);
  // Hard requirement: Tier-1 products must reference real ASINs (no KEYWORD-* fallbacks).
  const validListings = cappedListings.filter((l) => {
    const asinRaw = l.asin;
    const asin = typeof asinRaw === "string" ? asinRaw.trim().toUpperCase() : "";
    return /^[A-Z0-9]{10}$/.test(asin);
  });
  
  // Estimate total market revenue (fast heuristic)
  const totalMarketRevenue = estimateTotalMarketRevenueFast(cappedListings);
  
  // Build Tier-1 products with fast estimation
  const products: Tier1Product[] = validListings.map((listing, index) => {
    const rank = index + 1; // Organic rank (1-based)
    const price = listing.price ?? 0;
    
    // Fast revenue estimation (rank-based only)
    const estimatedRevenue = estimateRevenueFast(
      rank,
      price,
      totalMarketRevenue,
      cappedListings.length
    );
    
    // Fast units estimation
    const estimatedUnits = estimateUnitsFast(estimatedRevenue, price);
    
    // Determine fulfillment (simplified for Tier-1)
    let fulfillment: 'FBA' | 'FBM' | 'Amazon' | 'Unknown' = 'Unknown';
    if (listing.is_prime === true) {
      fulfillment = 'FBA';
    } else if (listing.fulfillment) {
      fulfillment = listing.fulfillment;
    } else {
      fulfillment = 'FBM'; // Default assumption
    }
    
    // Check for Amazon Retail
    if (listing.seller === "Amazon" || listing.brand === "Amazon") {
      fulfillment = 'Amazon';
    }
    
    return {
      asin: (listing.asin as string).trim().toUpperCase(),
      // Contract requires title: string. Avoid fabricating structured placeholders; use a neutral fallback.
      title:
        typeof listing.title === "string" && listing.title.trim().length > 0
          ? listing.title.trim()
          : "Unknown product",
      brand: listing.brand || null,
      image_url: listing.image_url || null,
      price: listing.price,
      rating: listing.rating,
      review_count: listing.reviews,
      fulfillment,
      organic_rank: rank,
      page_position: listing.position || rank,
      is_sponsored: listing.is_sponsored || false,
      estimated_monthly_units: estimatedUnits,
      estimated_monthly_revenue: estimatedRevenue,
    };
  });
  
  return products;
}

/**
 * Calculate Tier-1 aggregates from products
 */
export function calculateTier1Aggregates(products: Tier1Product[]): {
  total_page1_units: number;
  total_page1_revenue: number;
  avg_price: number | null;
  avg_reviews: number | null;
  avg_rating: number | null;
} {
  if (products.length === 0) {
    return {
      total_page1_units: 0,
      total_page1_revenue: 0,
      avg_price: null,
      avg_reviews: null,
      avg_rating: null,
    };
  }
  
  const totalUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const totalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  const prices = products
    .map(p => p.price)
    .filter((p): p is number => p !== null && p > 0);
  const avgPrice = prices.length > 0
    ? prices.reduce((sum, p) => sum + p, 0) / prices.length
    : null;
  
  const reviews = products
    .map(p => p.review_count)
    .filter((r): r is number => r !== null && r > 0);
  const avgReviews = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r, 0) / reviews.length
    : null;
  
  const ratings = products
    .map(p => p.rating)
    .filter((r): r is number => r !== null && r > 0);
  const avgRating = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    : null;
  
  return {
    total_page1_units: totalUnits,
    total_page1_revenue: totalRevenue,
    avg_price: avgPrice,
    avg_reviews: avgReviews,
    avg_rating: avgRating,
  };
}

