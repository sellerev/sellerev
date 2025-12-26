/**
 * Product Revenue Calculator
 * 
 * Calculates product-level revenue estimates from BSR and price data.
 */

import { estimateMonthlySalesFromBSR } from './bsr-calculator';

export interface ProductRevenue {
  asin: string;
  price: number;
  bsr: number;
  category: string;
  estimatedMonthlySales: number;
  estimatedMonthlyRevenue: number;
  estimatedDailySales: number;
  estimatedDailyRevenue: number;
}

/**
 * Extracts main category BSR from product data (handles various formats)
 */
function extractMainBSR(product: any): { rank: number; category: string } | null {
  // CRITICAL: Use main category BSR (index 0), NOT subcategory
  // Try bestsellers_rank array first (Rainforest API format)
  if (product.bestsellers_rank && Array.isArray(product.bestsellers_rank) && product.bestsellers_rank.length > 0) {
    const mainBSR = product.bestsellers_rank[0];
    if (mainBSR.rank !== undefined && mainBSR.rank !== null) {
      const rank = parseInt(mainBSR.rank.toString().replace(/,/g, ""), 10);
      if (!isNaN(rank) && rank > 0) {
        return {
          rank,
          category: mainBSR.category || mainBSR.Category || 'default'
        };
      }
    }
  }
  
  // Fallback: try direct bsr field (if already parsed)
  if (product.bsr !== undefined && product.bsr !== null) {
    const rank = parseInt(product.bsr.toString().replace(/,/g, ""), 10);
    if (!isNaN(rank) && rank > 0) {
      // Try to get category from product.category or default
      return {
        rank,
        category: product.category || product.main_category || 'default'
      };
    }
  }
  
  return null;
}

/**
 * Calculates revenue estimates for a single product
 * 
 * CRITICAL: Uses main category BSR (index 0), NOT subcategory
 * 
 * @param product - Product object with asin, price, bestsellers_rank array
 * @returns ProductRevenue object or null if BSR/price missing
 */
export function calculateProductRevenue(product: any): ProductRevenue | null {
  // Extract main category BSR
  const mainBSR = extractMainBSR(product);
  
  if (!mainBSR) {
    return null; // Can't calculate without BSR
  }
  
  // Extract price (handle various formats)
  const price = product.price?.value ?? product.price ?? product.Price ?? null;
  
  if (!price || price <= 0 || !isFinite(price)) {
    return null; // Can't calculate without valid price
  }
  
  const monthlySales = estimateMonthlySalesFromBSR(mainBSR.rank, mainBSR.category);
  const monthlyRevenue = monthlySales * price;
  const dailySales = Math.round(monthlySales / 30);
  const dailyRevenue = (monthlySales / 30) * price;
  
  return {
    asin: product.asin || product.ASIN || '',
    price,
    bsr: mainBSR.rank,
    category: mainBSR.category,
    estimatedMonthlySales: monthlySales,
    estimatedMonthlyRevenue: Math.round(monthlyRevenue * 100) / 100, // Round to 2 decimals
    estimatedDailySales: dailySales,
    estimatedDailyRevenue: Math.round(dailyRevenue * 100) / 100
  };
}

