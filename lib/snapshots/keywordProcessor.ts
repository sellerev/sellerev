/**
 * Keyword Processing Pipeline
 * 
 * Processes keywords from queue using Rainforest API (search only) and SP-API (enrichment).
 * 
 * STEP 1: Rainforest Search (1 credit) - ASIN discovery
 * STEP 2: SP-API Batch Enrichment (parallel) - Metadata enrichment
 * STEP 3: Immediate Revenue Modeling (internal) - Estimation
 * STEP 4: Canonical Merge - Priority: Rainforest → SP-API → Estimators
 * STEP 5: Persist Results
 */

import { buildKeywordPageOne } from '../amazon/canonicalPageOne';
import { batchEnrichCatalogItems } from '../spapi/catalogItems';
import type { ParsedListing } from '../amazon/keywordMarket';

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
 * STEP 1: Rainforest Search (1 credit) - ASIN discovery only
 * STEP 2: SP-API Batch Enrichment (parallel) - Metadata enrichment (title, brand, image, category, BSR)
 * STEP 3: Immediate Revenue Modeling (internal) - Estimation using canonicalPageOne
 * STEP 4: Canonical Merge - Priority: Rainforest → SP-API → Estimators
 * STEP 5: Persist Results
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
    if (Array.isArray(searchData.ads) && searchData.ads.length > 0) {
      allResultArrays.push(searchData.ads);
    }

    // Extract ALL results (organic + sponsored) for Page-1 analysis
    const allSearchResults = allResultArrays.flat();
    const page1Results = allSearchResults
      .filter((item: any) => item.asin && /^[A-Z0-9]{10}$/.test(item.asin.trim().toUpperCase()))
      .slice(0, 49);

    if (page1Results.length === 0) {
      return {
        success: false,
        error: 'No ASINs found in search results',
      };
    }

    const page1Asins = page1Results.map((item: any) => item.asin.trim().toUpperCase());

    // Extract Rainforest SERP data (rank, sponsored, page position, price, fulfillment hints)
    const rainforestData = new Map<string, {
      asin: string;
      rank: number;
      sponsored: boolean;
      page_position: number;
      price: number | null;
      fulfillment_hint: 'FBA' | 'FBM' | 'AMZ' | null;
      title: string | null;
      image_url: string | null;
      rating: number | null;
      reviews: number | null;
    }>();

    for (let i = 0; i < page1Results.length; i++) {
      const item = page1Results[i];
      const asin = item.asin.trim().toUpperCase();
      const price = parsePrice(item);
      
      // Extract fulfillment hint from Rainforest data
      let fulfillmentHint: 'FBA' | 'FBM' | 'AMZ' | null = null;
      if (item.is_prime === true || item.isPrime === true) {
        fulfillmentHint = 'FBA';
      } else if (item.fulfillment === 'FBA' || item.fulfillment === 'FBM' || item.fulfillment === 'AMZ') {
        fulfillmentHint = item.fulfillment;
      } else if (item.delivery?.text?.toLowerCase().includes('prime')) {
        fulfillmentHint = 'FBA';
      }

      // Extract rating and reviews from Rainforest SERP
      let rating: number | null = null;
      if (item.rating) {
        const ratingValue = typeof item.rating === 'number' ? item.rating : parseFloat(item.rating);
        if (!isNaN(ratingValue) && ratingValue >= 0 && ratingValue <= 5) {
          rating = ratingValue;
        }
      }

      let reviews: number | null = null;
      if (item.reviews?.count) {
        const reviewCount = typeof item.reviews.count === 'number' 
          ? item.reviews.count 
          : parseInt(item.reviews.count.toString().replace(/,/g, ''), 10);
        if (!isNaN(reviewCount) && reviewCount >= 0) {
          reviews = reviewCount;
        }
      }

      rainforestData.set(asin, {
        asin,
        rank: i + 1, // Page position (1-indexed)
        sponsored: item.sponsored === true || item.is_sponsored === true,
        page_position: i + 1,
        price,
        fulfillment_hint: fulfillmentHint,
        title: item.title || null,
        image_url: item.image || item.image_url || null,
        rating,
        reviews,
      });
    }

    // STEP 2: SP-API Batch Enrichment (parallel, non-blocking)
    // Check cache for existing metadata (7-day TTL)
    const metadataCache = new Map<string, {
      title: string | null;
      brand: string | null;
      image_url: string | null;
      category: string | null;
      bsr: number | null;
      last_enriched_at: string | null;
    }>();

    if (supabase) {
      const { data: cachedProducts } = await supabase
        .from('keyword_products')
        .select('asin, title, brand, image_url, category, bsr, last_enriched_at')
        .in('asin', page1Asins);

      if (cachedProducts) {
        for (const product of cachedProducts) {
          const asin = product.asin?.trim().toUpperCase();
          if (!asin) continue;

          // Check if metadata is still fresh (7 days)
          const lastEnriched = product.last_enriched_at 
            ? new Date(product.last_enriched_at).getTime() 
            : 0;
          const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

          if (lastEnriched > sevenDaysAgo) {
            metadataCache.set(asin, {
              title: product.title || null,
              brand: product.brand || null,
              image_url: product.image_url || null,
              category: product.category || null,
              bsr: product.bsr || null,
              last_enriched_at: product.last_enriched_at,
            });
          }
        }
      }
    }

    // Determine which ASINs need enrichment
    const asinsNeedingEnrichment = page1Asins.filter(asin => !metadataCache.has(asin));

    // SP-API batch enrichment (non-blocking, fails gracefully)
    let spApiEnrichment = new Map<string, {
      title: string | null;
      brand: string | null;
      image_url: string | null;
      category: string | null;
      bsr: number | null;
    }>();

    if (asinsNeedingEnrichment.length > 0) {
      try {
        const marketplaceId = marketplace === 'amazon.com' ? 'ATVPDKIKX0DER' : 'ATVPDKIKX0DER'; // Default to US
        const enrichmentResult = await batchEnrichCatalogItems(
          asinsNeedingEnrichment,
          marketplaceId,
          4000 // 4 second timeout
        );

        // Convert enrichment result to map
        for (const [asin, metadata] of enrichmentResult.enriched.entries()) {
          spApiEnrichment.set(asin, {
            title: metadata.title,
            brand: metadata.brand,
            image_url: metadata.image_url,
            category: metadata.category,
            bsr: metadata.bsr,
          });
        }

        if (enrichmentResult.failed.length > 0) {
          console.warn('SP-API enrichment partially failed', {
            keyword,
            failed_count: enrichmentResult.failed.length,
            total_count: asinsNeedingEnrichment.length,
          });
        }
      } catch (error) {
        console.warn('SP-API enrichment failed (non-blocking)', {
          keyword,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue without SP-API data - will use Rainforest data only
      }
    }

    // STEP 3: Immediate Revenue Modeling (using buildKeywordPageOne)
    // Convert Rainforest data to ParsedListing format for buildKeywordPageOne
    const parsedListings: ParsedListing[] = Array.from(rainforestData.values()).map((rf) => ({
      asin: rf.asin,
      position: rf.rank,
      price: rf.price,
      title: rf.title,
      image_url: rf.image_url,
      rating: rf.rating,
      reviews: rf.reviews,
      is_sponsored: rf.sponsored,
      fulfillment: rf.fulfillment_hint === 'AMZ' ? 'Amazon' : rf.fulfillment_hint,
      brand: null, // Will be enriched from SP-API
      main_category: null, // Will be enriched from SP-API
      main_category_bsr: null, // Will be enriched from SP-API
      bsr: null,
    }));

    // Run buildKeywordPageOne to get revenue estimates
    const canonicalProducts = buildKeywordPageOne(parsedListings);

    // STEP 4: Canonical Merge (Priority: Rainforest → SP-API → Estimators)
    const keywordProducts: Array<{
      keyword: string;
      asin: string;
      rank: number;
      price: number | null;
      title: string | null;
      brand: string | null;
      image_url: string | null;
      rating: number | null;
      review_count: number | null;
      fulfillment: string | null;
      category: string | null;
      bsr: number | null;
      main_category: string | null;
      main_category_bsr: number | null;
      estimated_monthly_units: number | null;
      estimated_monthly_revenue: number | null;
      is_sponsored: boolean;
      last_enriched_at: string | null;
    }> = [];

    const productEstimates: Array<{
      asin: string;
      bsr: number;
      price: number;
      monthlyUnits: number;
      monthlyRevenue: number;
    }> = [];

    for (const canonical of canonicalProducts) {
      const asin = canonical.asin;
      const rf = rainforestData.get(asin);
      const cached = metadataCache.get(asin);
      const enriched = spApiEnrichment.get(asin);

      // Merge priority: Rainforest → SP-API → Estimators
      const finalTitle = rf?.title || enriched?.title || cached?.title || canonical.title || null;
      const finalBrand = enriched?.brand || cached?.brand || canonical.brand || null;
      const finalImageUrl = rf?.image_url || enriched?.image_url || cached?.image_url || canonical.image_url || null;
      const finalCategory = enriched?.category || cached?.category || null;
      const finalBsr = enriched?.bsr || cached?.bsr || canonical.bsr || null;
      const finalRating = rf?.rating || canonical.rating || null;
      const finalReviews = rf?.reviews || canonical.review_count || null;
      const finalFulfillment = rf?.fulfillment_hint || canonical.fulfillment || null;
      const finalPrice = rf?.price || canonical.price || null;

      // Use canonical estimates (from canonicalPageOne)
      const monthlyUnits = canonical.estimated_monthly_units || null;
      const monthlyRevenue = canonical.estimated_monthly_revenue || null;

      if (monthlyUnits && monthlyRevenue && finalPrice) {
        productEstimates.push({
          asin,
          bsr: finalBsr || 0,
          price: finalPrice,
          monthlyUnits,
          monthlyRevenue,
        });
      }

      // Determine if we need to update last_enriched_at
      const shouldUpdateEnrichment = enriched && enriched.title !== null;
      const lastEnrichedAt = shouldUpdateEnrichment ? new Date().toISOString() : (cached?.last_enriched_at || null);

      keywordProducts.push({
        keyword,
        asin,
        rank: rf?.rank || canonical.page_position || 0,
        price: finalPrice,
        title: finalTitle,
        brand: finalBrand,
        image_url: finalImageUrl,
        rating: finalRating,
        review_count: finalReviews,
        fulfillment: finalFulfillment === 'AMZ' ? 'AMZ' : (finalFulfillment as "FBA" | "FBM" | "AMZ" | null),
        category: finalCategory,
        bsr: finalBsr,
        main_category: finalCategory,
        main_category_bsr: finalBsr,
        estimated_monthly_units: monthlyUnits,
        estimated_monthly_revenue: monthlyRevenue ? Math.round(monthlyRevenue * 100) / 100 : null,
        is_sponsored: rf?.sponsored || canonical.is_sponsored || false,
        last_enriched_at: lastEnrichedAt,
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

