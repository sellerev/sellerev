/**
 * Tier-1 Instant Market Estimates
 * 
 * Provides immediate market estimates using ONLY Rainforest type=search data.
 * These are heuristic-based approximations that give users instant feedback
 * while accurate BSR-based snapshots are generated in the background.
 * 
 * Cost: $0 (uses data from existing search calls)
 * Deterministic: Yes (same inputs = same outputs)
 * Credibility: Conservative estimates backed by seller-forum consensus
 */

/**
 * Position-based unit estimates
 * Based on seller-forum consensus on Page-1 visibility
 */
export function estimateUnitsFromPosition(position: number): number {
  if (position <= 3) return 8000;
  if (position <= 10) return 3000;
  if (position <= 20) return 1200;
  if (position <= 30) return 500;
  return 200;
}

/**
 * Market-level dampening factor
 * Accounts for overestimation when summing position-based estimates
 * More products = more overlap = more dampening needed
 */
export function marketDampeningFactor(productCount: number): number {
  if (productCount <= 20) return 1.0;
  if (productCount <= 30) return 0.85;
  if (productCount <= 40) return 0.7;
  return 0.6;
}

/**
 * Demand level classification
 * Consistent with Tier-2 snapshot demand levels
 */
export function getDemandLevel(units: number): {
  level: string;
  color: string;
  description?: string;
} {
  if (units >= 300000) {
    return { level: "Very High", color: "green", description: "Exceptional market demand" };
  }
  if (units >= 100000) {
    return { level: "High", color: "green", description: "Strong market demand" };
  }
  if (units >= 30000) {
    return { level: "Medium", color: "yellow", description: "Moderate market demand" };
  }
  if (units >= 10000) {
    return { level: "Low", color: "orange", description: "Limited market demand" };
  }
  return { level: "Very Low", color: "red", description: "Weak market demand" };
}

/**
 * Product result from Rainforest search
 */
export interface SearchResultProduct {
  position: number;
  price: number;
  asin?: string;
  title?: string;
  rating?: number;
  reviews?: number;
  image_url?: string;
  is_sponsored?: boolean;
}

/**
 * Market estimate result
 * Matches MarketSnapshot shape for UI compatibility
 */
export interface InstantMarketEstimate {
  totalMonthlyUnits: number;
  totalMonthlyRevenue: number;
  averagePrice: number;
  productCount: number;
  demandLevel: {
    level: string;
    color: string;
    description?: string;
  };
  estimated: true;
  dataSource: "estimated";
}

/**
 * Generate Tier-1 instant market estimate from search results
 * 
 * Uses ONLY position and price data from Rainforest type=search.
 * No BSR data required - this is a heuristic approximation.
 * 
 * @param results - Products from Rainforest search (type=search)
 * @returns Instant market estimate
 */
export function estimateMarketFromSearch(
  results: SearchResultProduct[]
): InstantMarketEstimate {
  if (!results || results.length === 0) {
    // Return empty estimate
    return {
      totalMonthlyUnits: 0,
      totalMonthlyRevenue: 0,
      averagePrice: 0,
      productCount: 0,
      demandLevel: getDemandLevel(0),
      estimated: true,
      dataSource: "estimated",
    };
  }

  const productCount = results.length;

  // Calculate raw totals
  let rawUnits = 0;
  let totalPrice = 0;
  let validPrices = 0;

  for (const product of results) {
    // Estimate units from position (1-indexed)
    const position = product.position || results.indexOf(product) + 1;
    rawUnits += estimateUnitsFromPosition(position);

    // Sum prices (only valid prices)
    if (product.price && product.price > 0) {
      totalPrice += product.price;
      validPrices++;
    }
  }

  // Calculate average price
  const avgPrice = validPrices > 0 ? totalPrice / validPrices : 0;

  // Apply market dampening
  const dampening = marketDampeningFactor(productCount);
  const totalUnits = Math.round(rawUnits * dampening);

  // Calculate revenue
  const totalRevenue = Math.round(totalUnits * avgPrice);

  // Determine demand level
  const demandLevel = getDemandLevel(totalUnits);

  return {
    totalMonthlyUnits: totalUnits,
    totalMonthlyRevenue: totalRevenue,
    averagePrice: avgPrice,
    productCount,
    demandLevel,
    estimated: true,
    dataSource: "estimated",
  };
}

