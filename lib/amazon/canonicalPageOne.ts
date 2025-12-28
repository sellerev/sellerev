/**
 * Canonical Page-1 Builder
 * 
 * Reconstructs a deterministic Page-1 product set from available data.
 * Always returns ~20 product cards, even with 0, partial, or full listings.
 * 
 * Features:
 * - Power-law position decay for unit distribution
 * - Price tiered multipliers around avg_price
 * - Revenue normalization to snapshot totals
 * - Realistic ratings & reviews generation
 * - Tags inferred fields as snapshot_inferred
 * 
 * Does NOT depend on BSR - uses position-based math only.
 */

import { ParsedListing, KeywordMarketSnapshot } from "./keywordMarket";

export interface CanonicalProduct {
  rank: number;
  asin: string;
  title: string;
  image_url: string | null;
  price: number;
  rating: number;
  review_count: number;
  bsr: number | null;
  estimated_monthly_units: number;
  estimated_monthly_revenue: number;
  revenue_share_pct: number;
  fulfillment: "FBA" | "FBM" | "AMZ";
  brand: string | null;
  seller_country: "US" | "CN" | "Other" | "Unknown";
  snapshot_inferred: boolean; // True if field was inferred from snapshot
  snapshot_inferred_fields?: string[]; // List of fields that were inferred
}

/**
 * Build canonical Page-1 product set
 * 
 * @param listings - Raw listings (can be empty, partial, or full)
 * @param snapshot - Market snapshot with aggregated data
 * @param keyword - Search keyword
 * @param marketplace - Marketplace identifier
 * @returns Array of ~20 canonical products
 */
export function buildCanonicalPageOne(
  listings: ParsedListing[],
  snapshot: KeywordMarketSnapshot,
  keyword: string,
  marketplace: string = "US"
): CanonicalProduct[] {
  const TARGET_PRODUCT_COUNT = 20;
  
  // Get snapshot totals
  const totalUnits = snapshot.est_total_monthly_units_min ?? snapshot.est_total_monthly_units_max ?? 0;
  const totalRevenue = snapshot.est_total_monthly_revenue_min ?? snapshot.est_total_monthly_revenue_max ?? 0;
  const avgPrice = snapshot.avg_price ?? 25;
  const avgRating = snapshot.avg_rating ?? 4.2;
  const avgReviews = snapshot.avg_reviews ?? 0;
  
  // Filter organic listings only (exclude sponsored)
  const organicListings = listings.filter(l => !l.is_sponsored);
  
  // Determine how many products we need to generate
  const existingCount = organicListings.length;
  const needToGenerate = Math.max(0, TARGET_PRODUCT_COUNT - existingCount);
  
  // Build products from existing listings
  const products: CanonicalProduct[] = [];
  
  // Process existing listings (up to 20)
  for (let i = 0; i < Math.min(existingCount, TARGET_PRODUCT_COUNT); i++) {
    const listing = organicListings[i];
    const position = i + 1;
    
    // Use real data where available, infer where missing
    const inferredFields: string[] = [];
    
    const asin = listing.asin || `INFERRED-${position}`;
    if (!listing.asin) inferredFields.push('asin');
    
    const title = listing.title || `${keyword} - Product ${position}`;
    if (!listing.title) inferredFields.push('title');
    
    const image_url = listing.image_url || null;
    if (!listing.image_url) inferredFields.push('image_url');
    
    // Price: use real if available, otherwise use tiered multiplier
    let price: number;
    if (listing.price !== null && listing.price !== undefined && listing.price > 0) {
      price = listing.price;
    } else {
      price = applyPriceTierMultiplier(avgPrice, position);
      inferredFields.push('price');
    }
    
    // Rating: use real if available, otherwise generate realistic
    let rating: number;
    if (listing.rating !== null && listing.rating !== undefined && listing.rating > 0) {
      rating = listing.rating;
    } else {
      rating = generateRealisticRating(avgRating, position);
      inferredFields.push('rating');
    }
    
    // Reviews: use real if available, otherwise generate realistic
    let review_count: number;
    if (listing.reviews !== null && listing.reviews !== undefined && listing.reviews > 0) {
      review_count = listing.reviews;
    } else {
      review_count = generateRealisticReviews(avgReviews, position, rating);
      inferredFields.push('review_count');
    }
    
    // Units: calculate using power-law position decay
    const positionWeight = Math.pow(21 - position, 1.35);
    const totalWeight = calculateTotalPositionWeight(TARGET_PRODUCT_COUNT);
    const monthlyUnits = Math.round((totalUnits * positionWeight) / totalWeight);
    
    // Revenue: units × price
    const monthlyRevenue = Math.round(monthlyUnits * price * 100) / 100;
    
    // Fulfillment: use real if available, otherwise infer
    let fulfillment: "FBA" | "FBM" | "AMZ";
    if (listing.fulfillment) {
      fulfillment = listing.fulfillment === "FBA" ? "FBA" : 
                    listing.fulfillment === "Amazon" ? "AMZ" : "FBM";
    } else {
      // Infer based on position (top positions more likely FBA)
      fulfillment = position <= 5 ? "FBA" : position <= 10 ? "FBM" : "FBM";
      inferredFields.push('fulfillment');
    }
    
    // Brand: use real if available
    const brand = listing.brand || null;
    if (!listing.brand) inferredFields.push('brand');
    
    // Seller country: infer from brand or default
    let seller_country: "US" | "CN" | "Other" | "Unknown";
    if (brand) {
      const brandLower = brand.toLowerCase();
      if (brandLower.includes("cn") || brandLower.includes("china") || 
          brandLower.includes("shenzhen") || brandLower.includes("guangzhou")) {
        seller_country = "CN";
      } else {
        seller_country = "US";
      }
    } else {
      seller_country = "Unknown";
    }
    if (!listing.brand) inferredFields.push('seller_country');
    
    products.push({
      rank: position,
      asin,
      title,
      image_url,
      price,
      rating,
      review_count,
      // BSR: use real if available and not marked invalid, otherwise null
      bsr: (listing.main_category_bsr || listing.bsr) && !listing.bsr_invalid_reason
        ? (listing.main_category_bsr || listing.bsr)
        : null,
      estimated_monthly_units: monthlyUnits,
      estimated_monthly_revenue: monthlyRevenue,
      revenue_share_pct: 0, // Will be calculated after normalization
      fulfillment,
      brand,
      seller_country,
      snapshot_inferred: inferredFields.length > 0,
      snapshot_inferred_fields: inferredFields.length > 0 ? inferredFields : undefined,
    });
  }
  
  // Generate missing products if needed
  for (let i = existingCount; i < TARGET_PRODUCT_COUNT; i++) {
    const position = i + 1;
    
    // Power-law position decay
    const positionWeight = Math.pow(21 - position, 1.35);
    const totalWeight = calculateTotalPositionWeight(TARGET_PRODUCT_COUNT);
    const monthlyUnits = Math.round((totalUnits * positionWeight) / totalWeight);
    
    // Price: tiered multiplier around avg_price
    const price = applyPriceTierMultiplier(avgPrice, position);
    
    // Revenue: units × price
    const monthlyRevenue = Math.round(monthlyUnits * price * 100) / 100;
    
    // Rating: generate realistic based on position
    const rating = generateRealisticRating(avgRating, position);
    
    // Reviews: generate realistic based on position and rating
    const review_count = generateRealisticReviews(avgReviews, position, rating);
    
    // Fulfillment: infer based on position
    const fulfillment: "FBA" | "FBM" | "AMZ" = position <= 5 ? "FBA" : position <= 10 ? "FBM" : "FBM";
    
    products.push({
      rank: position,
      asin: `INFERRED-${position}`,
      title: `${keyword} - Product ${position}`,
      image_url: null,
      price,
      rating,
      review_count,
      bsr: null,
      estimated_monthly_units: monthlyUnits,
      estimated_monthly_revenue: monthlyRevenue,
      revenue_share_pct: 0, // Will be calculated after normalization
      fulfillment,
      brand: null,
      seller_country: "Unknown",
      snapshot_inferred: true,
      snapshot_inferred_fields: ['asin', 'title', 'image_url', 'price', 'rating', 'review_count', 'bsr', 'fulfillment', 'brand', 'seller_country'],
    });
  }
  
  // Normalize revenue totals to match snapshot
  const currentTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (totalRevenue > 0 && currentTotalRevenue > 0) {
    const normalizationFactor = totalRevenue / currentTotalRevenue;
    products.forEach(p => {
      p.estimated_monthly_revenue = Math.round(p.estimated_monthly_revenue * normalizationFactor * 100) / 100;
      // Recalculate units to maintain price consistency
      p.estimated_monthly_units = Math.round(p.estimated_monthly_revenue / p.price);
    });
  }
  
  // Calculate revenue share percentages
  const finalTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (finalTotalRevenue > 0) {
    products.forEach(p => {
      p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / finalTotalRevenue) * 100 * 100) / 100;
    });
  }
  
  // Apply BSR duplicate detection before returning
  return applyBsrDuplicateDetection(products);
}

/**
 * BSR Duplicate Detection
 * 
 * Scans Page-1 listings and identifies BSR values that appear ≥ 8 times.
 * For any listing with a duplicated BSR, sets bsr = null.
 * 
 * This neutralizes Rainforest API bugs where the same BSR appears across many products.
 * 
 * @param products - Canonical products to scan
 * @returns Products with duplicated BSRs nullified
 */
function applyBsrDuplicateDetection(products: CanonicalProduct[]): CanonicalProduct[] {
  // Count BSR occurrences
  const bsrCounts: Record<number, number> = {};
  
  for (const product of products) {
    const bsr = product.bsr;
    if (bsr !== null && bsr !== undefined && bsr > 0) {
      bsrCounts[bsr] = (bsrCounts[bsr] || 0) + 1;
    }
  }
  
  // Find BSRs that appear ≥ 8 times (invalid duplicates)
  const invalidBSRs = new Set<number>();
  
  for (const [bsrStr, count] of Object.entries(bsrCounts)) {
    if (count >= 8) {
      const bsr = parseInt(bsrStr, 10);
      invalidBSRs.add(bsr);
      console.log(`🔵 BSR_DUPLICATE_DETECTED: BSR ${bsr} appears ${count} times in canonical Page-1 - marking as invalid`);
    }
  }
  
  // Nullify duplicated BSRs (leave all other fields untouched)
  if (invalidBSRs.size > 0) {
    console.log("🔵 BSR_DUPLICATE_DETECTION_COMPLETE", {
      invalid_bsr_count: invalidBSRs.size,
      total_products: products.length,
      affected_products: products.filter(p => p.bsr !== null && invalidBSRs.has(p.bsr)).length,
    });
    
    return products.map(product => {
      if (product.bsr !== null && invalidBSRs.has(product.bsr)) {
        return {
          ...product,
          bsr: null, // Set bsr to null, leave all other fields untouched
        };
      }
      return product;
    });
  }
  
  return products;
}

/**
 * Calculate total position weight for normalization
 */
function calculateTotalPositionWeight(count: number): number {
  let total = 0;
  for (let i = 1; i <= count; i++) {
    total += Math.pow(21 - i, 1.35);
  }
  return total;
}

/**
 * Apply tiered price multiplier based on position
 * Top positions: premium prices
 * Mid positions: average prices
 * Lower positions: discount prices
 */
function applyPriceTierMultiplier(avgPrice: number, position: number): number {
  let multiplier: number;
  
  if (position <= 3) {
    // Top 3: premium (110-120% of average)
    multiplier = 1.1 + (position - 1) * 0.033; // 1.1, 1.133, 1.166
  } else if (position <= 7) {
    // Positions 4-7: above average (100-110% of average)
    multiplier = 1.0 + ((7 - position) / 4) * 0.1; // 1.075, 1.05, 1.025, 1.0
  } else if (position <= 12) {
    // Positions 8-12: average to below average (90-100% of average)
    multiplier = 0.9 + ((12 - position) / 5) * 0.1; // 0.98, 0.96, 0.94, 0.92, 0.9
  } else {
    // Positions 13-20: discount (80-90% of average)
    multiplier = 0.8 + ((20 - position) / 8) * 0.1; // 0.8875, 0.875, ..., 0.8
  }
  
  return Math.round(avgPrice * multiplier * 100) / 100;
}

/**
 * Generate realistic rating based on position and average
 * Top positions tend to have higher ratings
 */
function generateRealisticRating(avgRating: number, position: number): number {
  // Top positions: slightly above average
  // Lower positions: slightly below average
  let adjustment = 0;
  
  if (position <= 3) {
    adjustment = 0.15; // Top 3: +0.15
  } else if (position <= 7) {
    adjustment = 0.05; // Positions 4-7: +0.05
  } else if (position <= 12) {
    adjustment = -0.05; // Positions 8-12: -0.05
  } else {
    adjustment = -0.15; // Positions 13-20: -0.15
  }
  
  // Add small random variance (±0.1)
  const variance = (Math.random() - 0.5) * 0.2;
  const rating = Math.max(3.0, Math.min(5.0, avgRating + adjustment + variance));
  
  return Math.round(rating * 10) / 10; // Round to 1 decimal
}

/**
 * Generate realistic review count based on position, average, and rating
 * Higher ratings and top positions = more reviews
 */
function generateRealisticReviews(avgReviews: number, position: number, rating: number): number {
  // Base multiplier from position (top positions have more reviews)
  let positionMultiplier: number;
  
  if (position <= 3) {
    positionMultiplier = 1.5; // Top 3: 1.5x
  } else if (position <= 7) {
    positionMultiplier = 1.2; // Positions 4-7: 1.2x
  } else if (position <= 12) {
    positionMultiplier = 0.9; // Positions 8-12: 0.9x
  } else {
    positionMultiplier = 0.6; // Positions 13-20: 0.6x
  }
  
  // Rating boost (higher ratings = more reviews)
  const ratingBoost = rating >= 4.5 ? 1.2 : rating >= 4.0 ? 1.0 : 0.8;
  
  // Calculate base reviews
  let reviews = avgReviews * positionMultiplier * ratingBoost;
  
  // Add variance (±30%)
  const variance = (Math.random() - 0.5) * 0.6;
  reviews = reviews * (1 + variance);
  
  // Ensure minimum of 10 reviews for realistic products
  return Math.max(10, Math.round(reviews));
}

