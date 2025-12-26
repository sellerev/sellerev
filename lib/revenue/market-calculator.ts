/**
 * Market Revenue Calculator
 * 
 * Aggregates product-level revenue estimates into market-level metrics.
 */

import { ProductRevenue } from './product-calculator';

export interface MarketRevenue {
  totalMonthlyRevenue: number;
  totalMonthlySales: number;
  averagePrice: number;
  averageBSR: number;
  averageMonthlySales: number;
  top10Revenue: number;
  top10RevenueShare: number;
  productsAnalyzed: number;
}

/**
 * Calculates market-level revenue metrics from product revenue estimates
 * 
 * @param products - Array of ProductRevenue objects
 * @returns MarketRevenue object with aggregated metrics
 */
export function calculateMarketRevenue(products: ProductRevenue[]): MarketRevenue {
  const validProducts = products.filter(p => p.estimatedMonthlyRevenue > 0);
  
  if (validProducts.length === 0) {
    return {
      totalMonthlyRevenue: 0,
      totalMonthlySales: 0,
      averagePrice: 0,
      averageBSR: 0,
      averageMonthlySales: 0,
      top10Revenue: 0,
      top10RevenueShare: 0,
      productsAnalyzed: 0
    };
  }
  
  const totalMonthlyRevenue = validProducts.reduce(
    (sum, p) => sum + p.estimatedMonthlyRevenue,
    0
  );
  
  const totalMonthlySales = validProducts.reduce(
    (sum, p) => sum + p.estimatedMonthlySales,
    0
  );
  
  const averageBSR = validProducts.reduce((sum, p) => sum + p.bsr, 0) / validProducts.length;
  
  // Top 10 by revenue (not BSR rank)
  const top10Revenue = validProducts
    .sort((a, b) => b.estimatedMonthlyRevenue - a.estimatedMonthlyRevenue)
    .slice(0, 10)
    .reduce((sum, p) => sum + p.estimatedMonthlyRevenue, 0);
  
  const averagePrice = totalMonthlySales > 0 
    ? totalMonthlyRevenue / totalMonthlySales 
    : 0;
  
  const averageMonthlySales = totalMonthlySales / validProducts.length;
  
  const top10RevenueShare = totalMonthlyRevenue > 0
    ? (top10Revenue / totalMonthlyRevenue) * 100
    : 0;
  
  return {
    totalMonthlyRevenue: Math.round(totalMonthlyRevenue * 100) / 100,
    totalMonthlySales: Math.round(totalMonthlySales),
    averagePrice: Math.round(averagePrice * 100) / 100,
    averageBSR: Math.round(averageBSR),
    averageMonthlySales: Math.round(averageMonthlySales * 100) / 100,
    top10Revenue: Math.round(top10Revenue * 100) / 100,
    top10RevenueShare: Math.round(top10RevenueShare * 100) / 100,
    productsAnalyzed: validProducts.length
  };
}

