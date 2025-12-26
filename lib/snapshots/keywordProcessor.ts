/**
 * Keyword Processing Pipeline
 * 
 * Processes keywords from queue using Rainforest API.
 * This is the ONLY place where Rainforest API is called.
 */

import { extractMainCategoryBSR } from '../amazon/keywordMarket';
import { estimateMonthlySalesFromBSR } from '../revenue/bsr-calculator';
import { batchFetchBsrWithBackoff, bulkLookupBsrCache, bulkUpsertBsrCache } from '../amazon/asinBsrCache';
import { calculateMarketSnapshot, ProductEstimate } from '../amazon/bsrToUnits';

function parsePrice(item: any): number | null {
  if (item.price?.value) {
    const parsed = parseFloat(item.price.value);
    return isNaN(parsed) ? null : parsed;
  }
  if (item.price?.raw) {
    const parsed = parseFloat(item.price.raw);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof item.price === "number") {
    return isNaN(item.price) ? null : item.price;
  }
  if (typeof item.price === "string") {
    const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ""));
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Calculate demand level based on total market units
 */
function calculateDemandLevel(totalUnits: number): 'high' | 'medium' | 'low' | 'very_low' {
  if (totalUnits >= 300_000) return 'high';
  if (totalUnits >= 100_000) return 'medium';
  if (totalUnits >= 30_000) return 'low';
  return 'very_low';
}

/**
 * Process a single keyword through the pipeline
 * 
 * Step 1: Rainforest Search (1 credit)
 * Step 2: BSR Fetch (1 credit MAX, batched)
 * Step 3: Units & Revenue Estimation
 * Step 4: Snapshot Calculation
 * Step 5: Persist Results
 */
export async function processKeyword(
  supabase: any,
  keyword: string,
  marketplace: string = 'amazon.com'
): Promise<{
  success: boolean;
  error?: string;
  snapshot?: any;
  products?: any[];
}> {
  const rainforestApiKey = process.env.RAINFOREST_API_KEY;
  
  if (!rainforestApiKey) {
    return {
      success: false,
      error: 'Rainforest API key not configured',
    };
  }

  try {
    // STEP 1: Rainforest Search (1 credit)
    const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=${marketplace}&search_term=${encodeURIComponent(keyword)}&page=1`;
    
    const searchResponse = await fetch(apiUrl, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!searchResponse.ok) {
      return {
        success: false,
        error: `Search API error: ${searchResponse.status}`,
      };
    }

    const searchData = await searchResponse.json();

    if (searchData.error) {
      return {
        success: false,
        error: `Search API error: ${searchData.error}`,
      };
    }

    // Extract search results from all possible locations
    const allResultArrays: any[][] = [];
    if (Array.isArray(searchData.search_results) && searchData.search_results.length > 0) {
      allResultArrays.push(searchData.search_results);
    }
    if (Array.isArray(searchData.organic_results) && searchData.organic_results.length > 0) {
      allResultArrays.push(searchData.organic_results);
    }
    if (Array.isArray(searchData.results) && searchData.results.length > 0) {
      allResultArrays.push(searchData.results);
    }

    const searchResults = allResultArrays.flat().filter((item: any) => item.asin && !item.sponsored);
    const top49Asins = searchResults.slice(0, 49);

    if (top49Asins.length === 0) {
      return {
        success: false,
        error: 'No ASINs found in search results',
      };
    }

    const page1Asins = top49Asins.map((item: any) => item.asin);

    // STEP 2: BSR Fetch (1 credit MAX, batched)
    const cacheMap = supabase ? await bulkLookupBsrCache(supabase, page1Asins) : new Map();
    const missingAsins = page1Asins.filter(asin => !cacheMap.has(asin));

    const bsrDataMap: Record<string, { rank: number; category: string; price: number | null }> = {};

    // Populate from cache
    for (const [asin, cacheEntry] of cacheMap.entries()) {
      if (cacheEntry.main_category_bsr !== null && cacheEntry.main_category_bsr >= 1) {
        bsrDataMap[asin] = {
          rank: cacheEntry.main_category_bsr,
          category: cacheEntry.main_category || 'default',
          price: cacheEntry.price,
        };
      }
    }

    // Batch fetch missing ASINs (ONE REQUEST)
    if (missingAsins.length > 0) {
      try {
        const batchData = await batchFetchBsrWithBackoff(
          rainforestApiKey,
          missingAsins,
          keyword
        );

        if (batchData) {
          let products: any[] = [];
          
          if (Array.isArray(batchData)) {
            products = batchData;
          } else if (batchData.products && Array.isArray(batchData.products)) {
            products = batchData.products;
          } else if (batchData.product) {
            products = Array.isArray(batchData.product) ? batchData.product : [batchData.product];
          } else if (batchData.asin || batchData.title) {
            products = [batchData];
          }

          const freshEntries: Array<{
            asin: string;
            main_category: string | null;
            main_category_bsr: number | null;
            price: number | null;
          }> = [];

          for (const productData of products) {
            const product = productData?.product || productData;
            if (!product || !product.asin) continue;

            const asin = product.asin;
            const bsrData = extractMainCategoryBSR(product);
            const price = parsePrice(product);

            if (bsrData && bsrData.rank >= 1) {
              bsrDataMap[asin] = {
                rank: bsrData.rank,
                category: bsrData.category,
                price: price,
              };

              freshEntries.push({
                asin,
                main_category: bsrData.category,
                main_category_bsr: bsrData.rank,
                price: price,
              });
            } else {
              freshEntries.push({
                asin,
                main_category: null,
                main_category_bsr: null,
                price: price,
              });
            }
          }

          // Upsert to cache
          if (supabase && freshEntries.length > 0) {
            await bulkUpsertBsrCache(supabase, freshEntries);
          }
        }
      } catch (error) {
        console.error('Batch BSR fetch failed:', error);
        // Continue with cached data only
      }
    }

    // STEP 3: Units & Revenue Estimation
    const productEstimates: ProductEstimate[] = [];
    const keywordProducts: Array<{
      keyword: string;
      asin: string;
      rank: number;
      price: number | null;
      main_category: string | null;
      main_category_bsr: number | null;
      estimated_monthly_units: number | null;
      estimated_monthly_revenue: number | null;
    }> = [];

    for (let i = 0; i < top49Asins.length; i++) {
      const item = top49Asins[i];
      const asin = item.asin;
      const price = parsePrice(item) || bsrDataMap[asin]?.price || null;
      const bsrData = bsrDataMap[asin];

      if (!bsrData || !bsrData.rank || bsrData.rank < 1 || !price || price <= 0) {
        // Exclude from estimates but still save product record
        keywordProducts.push({
          keyword,
          asin,
          rank: i + 1,
          price,
          main_category: bsrData?.category || null,
          main_category_bsr: bsrData?.rank || null,
          estimated_monthly_units: null,
          estimated_monthly_revenue: null,
        });
        continue;
      }

      // Calculate units and revenue
      const category = bsrData.category || 'default';
      const monthlyUnits = estimateMonthlySalesFromBSR(bsrData.rank, category);
      const monthlyRevenue = monthlyUnits * price;

      productEstimates.push({
        asin,
        bsr: bsrData.rank,
        price,
        monthlyUnits,
        monthlyRevenue,
      });

      keywordProducts.push({
        keyword,
        asin,
        rank: i + 1,
        price,
        main_category: bsrData.category,
        main_category_bsr: bsrData.rank,
        estimated_monthly_units: monthlyUnits,
        estimated_monthly_revenue: Math.round(monthlyRevenue * 100) / 100,
      });
    }

    // STEP 4: Snapshot Calculation with Dynamic Dampening
    const productCount = productEstimates.length;
    
    // Apply dynamic dampening per product based on product count (prevents inflated totals)
    // This replaces the fixed 0.65 multiplier - we use product-count based dampening instead
    const productCountDampening =
      productCount > 40 ? 0.75 :
      productCount > 30 ? 0.85 :
      1.0;

    // Apply dampening per product before summing (replaces fixed 0.65 market dampening)
    const productDampenedEstimates = productEstimates.map(p => ({
      ...p,
      monthlyUnits: Math.round(p.monthlyUnits * productCountDampening),
      monthlyRevenue: Math.round(p.monthlyRevenue * productCountDampening * 100) / 100,
    }));

    // Calculate market snapshot (bypasses MARKET_DAMPENING_MULTIPLIER since we already applied product-count dampening)
    // We'll calculate totals manually to avoid double-dampening
    const validProducts = productDampenedEstimates.filter(p => 
      p.bsr > 0 && p.price > 0 && p.monthlyUnits > 0 && p.monthlyRevenue > 0
    );

    if (validProducts.length === 0) {
      return {
        success: false,
        error: 'No valid product estimates after dampening',
      };
    }

    const totalUnits = validProducts.reduce((sum, p) => sum + p.monthlyUnits, 0);
    const totalRevenue = validProducts.reduce((sum, p) => sum + p.monthlyRevenue, 0);
    const totalBsr = validProducts.reduce((sum, p) => sum + p.bsr, 0);
    const totalPrice = validProducts.reduce((sum, p) => sum + p.price, 0);

    // Demand level based on total units (not avg per product)
    const demandLevel = calculateDemandLevel(totalUnits);

    // Calculate average price from products
    const productsWithPrice = keywordProducts.filter(p => p.price !== null && p.price > 0);
    const avgPrice = productsWithPrice.length > 0
      ? productsWithPrice.reduce((sum, p) => sum + (p.price || 0), 0) / productsWithPrice.length
      : (totalPrice / validProducts.length);

    const snapshot = {
      keyword: keyword.toLowerCase().trim(),
      marketplace,
      total_monthly_units: totalUnits,
      total_monthly_revenue: Math.round(totalRevenue * 100) / 100,
      average_bsr: Math.round(totalBsr / validProducts.length),
      average_price: avgPrice ? Math.round(avgPrice * 100) / 100 : null,
      product_count: validProducts.length,
      demand_level: demandLevel,
      refresh_priority: 5, // Default, will be updated by refresh strategy based on search count
    };

    return {
      success: true,
      snapshot,
      products: keywordProducts,
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

