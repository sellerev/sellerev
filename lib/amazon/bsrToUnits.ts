/**
 * BSR to Units/Revenue Market Snapshot Calculator
 * 
 * Converts BSR-based product estimates into market-level aggregates
 * with market dampening and demand level classification.
 * 
 * Aligned with Helium 10 behavior:
 * - Conservative, deterministic calculations
 * - Market-level dampening accounts for Page-1 click overlap
 * - Demand levels are Page-1 relative (avg units per product)
 */

/**
 * Market-level dampening factor
 * Accounts for Page-1 click overlap & demand saturation
 * Calibrated against Helium 10 snapshots
 */
const MARKET_DAMPENING_MULTIPLIER = 0.65;

export interface ProductEstimate {
  asin: string;
  bsr: number;
  price: number;
  monthlyUnits: number;
  monthlyRevenue: number;
}

export interface MarketSnapshot {
  totalMonthlyUnits: number;
  totalMonthlyRevenue: number;
  averageBsr: number;
  averagePrice: number;
  productCount: number;
  demandLevel: {
    level: string;
    color: string;
    description: string;
  };
}

/**
 * Demand level based on average units per Page-1 product
 * Mirrors how sellers interpret market strength
 * 
 * @param avgUnitsPerProduct - Average units per product (post-dampening)
 * @returns Demand level classification
 */
export function getDemandLevel(avgUnitsPerProduct: number): {
  level: string;
  color: string;
  description: string;
} {
  if (avgUnitsPerProduct >= 8000) {
    return {
      level: "High Demand",
      color: "green",
      description: "Strong Page-1 sales velocity"
    };
  }

  if (avgUnitsPerProduct >= 2500) {
    return {
      level: "Medium Demand",
      color: "yellow",
      description: "Healthy but competitive market"
    };
  }

  if (avgUnitsPerProduct >= 800) {
    return {
      level: "Low Demand",
      color: "orange",
      description: "Limited Page-1 sales velocity"
    };
  }

  return {
    level: "Very Low Demand",
    color: "red",
    description: "Weak Page-1 demand"
  };
}

/**
 * Calculates market snapshot from product-level BSR estimates
 * 
 * Applies market dampening at the aggregate level (not per-product)
 * Returns dampened totals and demand level based on avg units per product
 * 
 * @param products - Array of product estimates with BSR, price, units, revenue
 * @returns Market snapshot with dampened totals and demand level
 */
export function calculateMarketSnapshot(products: ProductEstimate[]): MarketSnapshot {
  // Filter valid products (must have BSR > 0, price > 0, units > 0)
  const validProducts = products.filter(p => 
    p.bsr > 0 && 
    p.price > 0 && 
    p.monthlyUnits > 0 && 
    p.monthlyRevenue > 0
  );

  if (validProducts.length === 0) {
    return {
      totalMonthlyUnits: 0,
      totalMonthlyRevenue: 0,
      averageBsr: 0,
      averagePrice: 0,
      productCount: 0,
      demandLevel: getDemandLevel(0)
    };
  }

  // Sum raw totals (pre-dampening)
  const totalUnits = validProducts.reduce((sum, p) => sum + p.monthlyUnits, 0);
  const totalRevenue = validProducts.reduce((sum, p) => sum + p.monthlyRevenue, 0);
  const totalBsr = validProducts.reduce((sum, p) => sum + p.bsr, 0);
  const totalPrice = validProducts.reduce((sum, p) => sum + p.price, 0);

  // Apply market dampening
  const dampenedUnits = Math.round(
    totalUnits * MARKET_DAMPENING_MULTIPLIER
  );
  const dampenedRevenue = Math.round(
    totalRevenue * MARKET_DAMPENING_MULTIPLIER
  );

  // Average units per product (post-dampening)
  const avgUnitsPerProduct = dampenedUnits / validProducts.length;

  return {
    totalMonthlyUnits: dampenedUnits,
    totalMonthlyRevenue: dampenedRevenue,
    averageBsr: Math.round(totalBsr / validProducts.length),
    averagePrice: totalPrice / validProducts.length,
    productCount: validProducts.length,
    demandLevel: getDemandLevel(avgUnitsPerProduct)
  };
}

