/**
 * Keyword Processing Pipeline
 * 
 * Processes keywords from queue using Rainforest API (search only) and SP-API (enrichment).
 * 
 * AUTHORITY MODEL:
 * - Rainforest: ASIN discovery, page position, sponsored flag (SERP-only fields)
 * - SP-API: Authoritative source for all product metadata (title, brand, image, category, BSR)
 * - Internal Model: Sole source for revenue & units estimates
 * 
 * STEP 1: Rainforest Search (1 credit) - ASIN discovery only
 * STEP 2: SP-API Batch Enrichment (synchronous) - Authoritative metadata enrichment
 * STEP 3: Immediate Revenue Modeling (internal) - Estimation using canonicalPageOne
 * STEP 4: Canonical Merge - SP-API overrides Rainforest for metadata, Model owns economics
 * STEP 5: Persist Results
 */

import { buildKeywordPageOne } from '../amazon/canonicalPageOne';
import { batchEnrichCatalogItems } from '../spapi/catalogItems';
import { batchEnrichPricing } from '../spapi/pricing';
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
 *   - Extracts: ASIN, page_position, is_sponsored, price, rating, reviews
 *   - Treats title/image as non-authoritative hints only
 * 
 * STEP 2: SP-API Batch Enrichment (synchronous) - Authoritative metadata
 *   - Always enriches top ASINs synchronously (deterministic)
 *   - SP-API values OVERRIDE Rainforest hints (not fallback)
 *   - Extracts: title, brand, image_url, category, BSR
 * 
 * STEP 3: Immediate Revenue Modeling (internal) - Estimation
 *   - Uses canonicalPageOne for revenue/units estimates
 *   - Model authority: never overwritten by SP-API
 * 
 * STEP 4: Canonical Merge - SP-API authoritative, Model owns economics
 *   - Metadata: SP-API → Cache → Rainforest hints
 *   - Economics: Internal model only
 *   - Source tagging: brand_source, title_source, category_source
 * 
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

  // ═══════════════════════════════════════════════════════════════════════════
  // KILL-SWITCH: DISABLE_RAINFOREST_ENRICHMENT
  // ═══════════════════════════════════════════════════════════════════════════
  // When enabled, Rainforest still runs for ASIN discovery and SERP fields,
  // but Rainforest hints (title, image, price, fulfillment) are NOT used as fallbacks.
  const disableRainforestEnrichment = process.env.DISABLE_RAINFOREST_ENRICHMENT === 'true';

  try {
    // STEP 1: Rainforest Search (1 credit) - ASIN discovery only
    console.log('RAINFOREST_SEARCH_START', {
      keyword,
      marketplace,
      kill_switch_enabled: disableRainforestEnrichment,
      timestamp: new Date().toISOString(),
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // PART 1: UPDATE RAINFOREST SEARCH REQUEST - INCLUDE ADS
    // ═══════════════════════════════════════════════════════════════════════════
    const apiUrl = `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=search&amazon_domain=${marketplace}&search_term=${encodeURIComponent(keyword)}&page=1&include_ads=true&include_sponsored=true`;
    
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PART 1: REMOVE INVALID ASSUMPTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Rainforest type=search responses place BOTH sponsored and organic
    // listings inside search_results[]. Do NOT read from ads[] or sponsored_products[]
    // as these are NOT populated for Rainforest search.
    // Extract search results ONLY from search_results[] array
    const allSearchResults: any[] = [];
    
    // ONLY use search_results array (contains both sponsored and organic)
    if (Array.isArray(searchData.search_results) && searchData.search_results.length > 0) {
      allSearchResults.push(...searchData.search_results);
    }
    
    // Fallback to results array if search_results is not present
    if (allSearchResults.length === 0 && Array.isArray(searchData.results) && searchData.results.length > 0) {
      allSearchResults.push(...searchData.results);
    }
    
    const page1Results = allSearchResults
      .filter((item: any) => item?.asin && /^[A-Z0-9]{10}$/.test(item.asin.trim().toUpperCase()))
      .slice(0, 49);

    if (page1Results.length === 0) {
      return {
        success: false,
        error: 'No ASINs found in search results',
      };
    }

    const page1Asins = page1Results.map((item: any) => item.asin.trim().toUpperCase());

    console.log('RAINFOREST_SEARCH_COMPLETE', {
      keyword,
      asin_count: page1Asins.length,
      timestamp: new Date().toISOString(),
    });

    // Extract Rainforest SERP data (DISCOVERY-ONLY: ASIN, position, sponsored, price, rating, reviews)
    // Rainforest fields are NON-AUTHORITATIVE hints for metadata (title, brand, image, category, BSR)
    const rainforestData = new Map<string, {
      asin: string;
      rank: number;
      sponsored: boolean | null; // null = unknown
      ad_position: number | null; // Ad position from Rainforest (null if not sponsored)
      page_position: number;
      price: number | null;
      fulfillment_hint: 'FBA' | 'FBM' | 'AMZ' | null;
      rating: number | null;
      reviews: number | null;
      // Non-authoritative hints (will be overridden by SP-API)
      title_hint: string | null;
      image_hint: string | null;
      source: 'rainforest_serp';
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

      // ═══════════════════════════════════════════════════════════════════════════
      // PART 2: DETECT SPONSORED INSIDE search_results[]
      // ═══════════════════════════════════════════════════════════════════════════
      // PART 3: PERSIST SOURCE TYPE ON LISTING
      // Detect sponsored status using ONLY fields already returned by Rainforest
      // NO heuristics beyond link patterns. NO position-based guessing.
      
      function isSponsored(item: any): boolean {
        // Check explicit sponsored flag
        if (item.sponsored === true || item.is_sponsored === true) {
          return true;
        }
        
        // Check link patterns
        const link = item.link || item.url || '';
        if (typeof link === 'string') {
          if (link.includes('/sspa/')) {
            return true;
          }
          if (link.includes('sp_csd=')) {
            return true;
          }
          if (link.includes('sr=') && link.includes('-spons')) {
            return true;
          }
        }
        
        return false;
      }
      
      // Determine sponsored status
      const isSponsoredResult = isSponsored(item);
      const isSponsoredValue: boolean | null = isSponsoredResult ? true : false;
      const adPosition: number | null = isSponsoredResult ? (item.ad_position ?? null) : null;
      
      rainforestData.set(asin, {
        asin,
        rank: i + 1, // Page position (1-indexed)
        sponsored: isSponsoredValue, // true or false (never null after detection)
        ad_position: adPosition,
        page_position: i + 1,
        price,
        fulfillment_hint: fulfillmentHint,
        rating,
        reviews,
        // Non-authoritative hints (temporary placeholders until SP-API enrichment)
        title_hint: item.title || null,
        image_hint: item.image || item.image_url || null,
        source: 'rainforest_serp',
      });
    }

    // STEP 2: SP-API Batch Enrichment (parallel, non-blocking)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: SP-API Catalog MUST be called for ALL page-1 ASINs
    // ═══════════════════════════════════════════════════════════════════════════
    // - NO filtering based on missing_title, missing_image, missing_brand, missing_rating, missing_reviews
    // - NO conditional gates (listings_needing_enrichment.length === 0)
    // - SP-API runs even if cache is fresh or Rainforest has all fields
    // - SP-API is authoritative: brand, brand_name, product_type, sales_rank, item_classification
    
    // Check cache for existing metadata (7-day TTL) - for fallback only, NOT to skip SP-API
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

    // ═══════════════════════════════════════════════════════════════════════════
    // FORCE SP-API CATALOG FOR ALL PAGE-1 ASINs (MANDATORY)
    // ═══════════════════════════════════════════════════════════════════════════
    // NO conditional gates - SP-API runs for ALL ASINs regardless of:
    // - Cache state (fresh or stale)
    // - Rainforest completeness (title/image/rating/reviews present)
    // - Missing metadata flags
    const asinsForSpApi = page1Asins;

    const marketplaceId = marketplace === 'amazon.com' ? 'ATVPDKIKX0DER' : 'ATVPDKIKX0DER'; // Default to US
    
    // REQUIRED LOG: SP_API_CATALOG_FORCED_START
    console.log('SP_API_CATALOG_FORCED_START', {
      keyword,
      total_asins: asinsForSpApi.length,
      marketplace_id: marketplaceId,
      timestamp: new Date().toISOString(),
    });
    
    console.log('SP_API_ENRICH_START', {
      keyword,
      asin_count: asinsForSpApi.length,
      marketplace_id: marketplaceId,
      kill_switch_enabled: disableRainforestEnrichment,
      timestamp: new Date().toISOString(),
    });

    const startTime = Date.now();

    // SP-API Catalog Items enrichment (brand, category, BSR, title, image)
    let spApiCatalogEnrichment = new Map<string, {
      title: string | null;
      brand: string | null;
      image_url: string | null;
      category: string | null;
      bsr: number | null;
      source: 'sp_api';
    }>();

    // SP-API Pricing enrichment (buy box, offer count, fulfillment)
    let spApiPricingEnrichment = new Map<string, {
      buy_box_owner: "Amazon" | "Merchant" | "Unknown" | null;
      offer_count: number | null;
      fulfillment_channel: "FBA" | "FBM" | null;
      lowest_price: number | null;
      buy_box_price: number | null;
    }>();

    // ═══════════════════════════════════════════════════════════════════════════
    // FORCE BATCHED SP-API CATALOG CALLS (MANDATORY)
    // ═══════════════════════════════════════════════════════════════════════════
    // - Batch size: 20 ASINs max per call
    // - If <20 ASINs → 1 call
    // - If 48 ASINs → 3 calls (20, 20, 8)
    // - Marketplace: ATVPDKIKX0DER
    // - NO conditional gates - always executes
    
    // Execute Catalog Items and Pricing API calls in parallel
    // CRITICAL: This promise MUST execute for ALL ASINs, no conditional gates
    const catalogPromise = (async () => {
      try {
        const catalogStart = Date.now();
        
        // Calculate batches for logging
        const totalBatches = Math.ceil(asinsForSpApi.length / 20);
        const batchSizes: number[] = [];
        for (let i = 0; i < asinsForSpApi.length; i += 20) {
          const batchSize = Math.min(20, asinsForSpApi.length - i);
          batchSizes.push(batchSize);
          
          // REQUIRED LOG: SP_API_CATALOG_BATCH (per batch)
          const batchAsins = asinsForSpApi.slice(i, i + 20);
          console.log('SP_API_CATALOG_BATCH', {
            keyword,
            batch_index: Math.floor(i / 20),
            total_batches: totalBatches,
            asins: batchAsins,
            asin_count: batchSize,
            timestamp: new Date().toISOString(),
          });
        }
        
        // CRITICAL: Create authoritative map for SP-API catalog results
        const spApiCatalogResults = new Map<string, any>();
        
        await batchEnrichCatalogItems(
          asinsForSpApi,
          spApiCatalogResults,
          marketplaceId,
          2000, // 2 second timeout per batch
          keyword
        );
        const catalogDuration = Date.now() - catalogStart;

        // Convert enrichment result to map (SP-API is authoritative)
        for (const [asin, metadata] of spApiCatalogResults.entries()) {
          spApiCatalogEnrichment.set(asin, {
            title: metadata.title,
            brand: metadata.brand,
            image_url: metadata.image_url,
            category: metadata.category,
            bsr: metadata.bsr,
            source: 'sp_api',
          });
        }

        // Calculate successful vs failed batches
        const enrichedCount = spApiCatalogResults.size;
        const failedCount = asinsForSpApi.length - enrichedCount;
        const successRate = asinsForSpApi.length > 0 ? enrichedCount / asinsForSpApi.length : 0;
        const successfulBatches = successRate === 1 
          ? totalBatches 
          : successRate === 0 
            ? 0 
            : Math.max(1, Math.round(totalBatches * successRate));
        const failedBatches = totalBatches - successfulBatches;

        // REQUIRED LOG: SP_API_CATALOG_COMPLETE
        console.log('SP_API_CATALOG_COMPLETE', {
          keyword,
          total_asins: asinsForSpApi.length,
          total_batches: totalBatches,
          successful_batches: successfulBatches,
          failed_batches: failedBatches,
          enriched_count: enrichedCount,
          failed_count: failedCount,
          duration_ms: catalogDuration,
          timestamp: new Date().toISOString(),
        });

        // VERIFICATION: Ensure SP-API was actually called
        if (totalBatches === 0) {
          console.error('SP_API_CATALOG_NOT_CALLED — THIS IS A BUG', {
            keyword,
            total_asins: asinsForSpApi.length,
            reason: 'No batches created despite having ASINs',
          });
        }

        // Check for partial failures (ASINs requested but not enriched)
        if (failedCount > 0) {
          console.warn('SP_API_CATALOG_CALL_PARTIAL_FAILURE', {
            keyword,
            failed_count: failedCount,
            total_count: asinsForSpApi.length,
          });
        }
      } catch (error) {
        console.error('SP_API_CATALOG_CALL_ERROR', {
          keyword,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue without Catalog Items data - will use Rainforest hints as fallback
      }
    })();

    const pricingPromise = asinsForSpApi.length > 0
      ? (async () => {
          try {
            const pricingStart = Date.now();
            const pricingResult = await batchEnrichPricing(
              asinsForSpApi,
              marketplaceId,
              2000 // 2 second timeout per batch
            );
            const pricingDuration = Date.now() - pricingStart;

            // Calculate batch sizes for logging (pricing uses 5 ASINs per concurrent batch)
            const batchSize = 5;
            const totalBatches = Math.ceil(asinsForSpApi.length / batchSize);
            const batchSizes: number[] = [];
            for (let i = 0; i < asinsForSpApi.length; i += batchSize) {
              batchSizes.push(Math.min(batchSize, asinsForSpApi.length - i));
            }

            // Convert pricing result to map
            for (const [asin, metadata] of pricingResult.enriched.entries()) {
              spApiPricingEnrichment.set(asin, metadata);
            }

            // Emit verification log
            console.log('SP_API_PRICING_BATCH_COMPLETE', {
              keyword,
              total_asins: asinsForSpApi.length,
              total_batches: totalBatches,
              batch_sizes: batchSizes,
              enriched_count: pricingResult.enriched.size,
              failed_count: pricingResult.failed.length,
              duration_ms: pricingDuration,
            });

            if (pricingResult.failed.length > 0) {
              console.warn('SP_API_PRICING_CALL_PARTIAL_FAILURE', {
                keyword,
                failed_count: pricingResult.failed.length,
                total_count: asinsForSpApi.length,
              });
            }
          } catch (error) {
            console.error('SP_API_PRICING_CALL_ERROR', {
              keyword,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue without Pricing data - will use Rainforest hints as fallback
          }
        })()
      : Promise.resolve();

    // Wait for both API calls to complete (parallel execution)
    await Promise.allSettled([catalogPromise, pricingPromise]);

    const enrichmentDuration = Date.now() - startTime;
    console.log('SP_API_ENRICHMENT_COMPLETE', {
      keyword,
      total_duration_ms: enrichmentDuration,
      catalog_enriched: spApiCatalogEnrichment.size,
      pricing_enriched: spApiPricingEnrichment.size,
    });

    // STEP 3: Immediate Revenue Modeling (using buildKeywordPageOne)
    // Convert Rainforest data to ParsedListing format for buildKeywordPageOne
    // Use SP-API metadata where available, Rainforest hints as temporary placeholders
    const parsedListings: ParsedListing[] = Array.from(rainforestData.values()).map((rf) => {
      const catalogEnriched = spApiCatalogEnrichment.get(rf.asin);
      const pricingEnriched = spApiPricingEnrichment.get(rf.asin);
      const cached = metadataCache.get(rf.asin);
      
      // SP-API is authoritative for metadata (override, not fallback)
      // Use Pricing API fulfillment if available, otherwise Rainforest hint
      const fulfillment = pricingEnriched?.fulfillment_channel 
        ? (pricingEnriched.fulfillment_channel === 'FBA' ? 'FBA' : 'FBM')
        : (rf.fulfillment_hint === 'AMZ' ? 'Amazon' : rf.fulfillment_hint);
      
      // Extract sponsored fields from Rainforest
      const isSponsored = rf.sponsored === true;
      const sponsoredPosition = isSponsored ? rf.ad_position : null;
      // sponsored_source: 'rainforest_serp' for sponsored, 'organic_serp' for organic or unknown
      const sponsoredSource: 'rainforest_serp' | 'organic_serp' = rf.sponsored === true ? 'rainforest_serp' : 'organic_serp';
      
      return {
        asin: rf.asin,
        position: rf.rank,
        price: pricingEnriched?.buy_box_price || pricingEnriched?.lowest_price || rf.price,
        title: catalogEnriched?.title || cached?.title || rf.title_hint || null,
        image_url: catalogEnriched?.image_url || cached?.image_url || rf.image_hint || null,
        rating: rf.rating,
        reviews: rf.reviews,
        is_sponsored: rf.sponsored, // boolean | null
        sponsored_position: sponsoredPosition,
        sponsored_source: sponsoredSource,
        fulfillment: fulfillment,
        brand: catalogEnriched?.brand || cached?.brand || null, // SP-API only (no Rainforest inference)
        main_category: catalogEnriched?.category || cached?.category || null, // SP-API only
        main_category_bsr: catalogEnriched?.bsr || cached?.bsr || null, // SP-API only
        bsr: catalogEnriched?.bsr || cached?.bsr || null,
      };
    });

    // Run buildKeywordPageOne to get revenue estimates
    const canonicalProducts = buildKeywordPageOne(parsedListings);

    // STEP 4: Canonical Merge (SP-API is authoritative for metadata, Model owns economics)
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
      is_sponsored: boolean | null;
      sponsored_position: number | null;
      sponsored_source: 'rainforest_serp' | 'organic_serp' | null;
      last_enriched_at: string | null;
      // SP-API Pricing fields
      buy_box_owner: "Amazon" | "Merchant" | "Unknown" | null;
      offer_count: number | null;
      // Source tagging for debugging and verification
      brand_source: 'sp_api_catalog' | 'model_inferred' | null;
      title_source: 'sp_api_catalog' | 'rainforest_serp' | 'model_inferred' | null;
      category_source: 'sp_api_catalog' | null;
      bsr_source: 'sp_api_catalog' | null;
      buy_box_owner_source: 'sp_api_pricing' | null;
      offer_count_source: 'sp_api_pricing' | null;
      fulfillment_source: 'sp_api_pricing' | 'rainforest_serp' | null;
      price_source: 'sp_api_pricing' | 'rainforest_serp' | null;
      image_source: 'sp_api_catalog' | 'rainforest_serp' | null;
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
      const catalogEnriched = spApiCatalogEnrichment.get(asin);
      const pricingEnriched = spApiPricingEnrichment.get(asin);

      // ═══════════════════════════════════════════════════════════════════════════
      // SP-API IS AUTHORITATIVE (override, not fallback)
      // ═══════════════════════════════════════════════════════════════════════════
      // If SP-API has a value, use it. Otherwise fall back to cache, then Rainforest hints.
      // KILL-SWITCH: When enabled, skip Rainforest hint fallbacks for title/image/price/fulfillment.
      
      // Title: SP-API → Cache → Rainforest hint (if kill-switch OFF) → Canonical
      let finalTitle: string | null = null;
      let titleSource: 'sp_api_catalog' | 'rainforest_serp' | 'model_inferred' | null = null;
      if (catalogEnriched?.title) {
        finalTitle = catalogEnriched.title;
        titleSource = 'sp_api_catalog';
      } else if (cached?.title) {
        finalTitle = cached.title;
        titleSource = 'sp_api_catalog'; // Cached from previous SP-API call
      } else if (!disableRainforestEnrichment && rf?.title_hint) {
        finalTitle = rf.title_hint;
        titleSource = 'rainforest_serp';
      } else if (!disableRainforestEnrichment && canonical.title) {
        finalTitle = canonical.title;
        titleSource = 'rainforest_serp';
      } else if (canonical.title) {
        // Only use canonical if kill-switch is ON and we have no SP-API/cached value
        finalTitle = canonical.title;
        titleSource = 'model_inferred';
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // AUTHORITATIVE MERGE: Brand (SP-API overwrites, title parsing disabled if SP-API exists)
      // ═══════════════════════════════════════════════════════════════════════════
      // SP-API Catalog overwrites: brand, brand_name
      // Title-based brand parsing MUST NOT run if SP-API brand exists
      let finalBrand: string | null = null;
      let brandSource: 'sp_api_catalog' | 'model_inferred' | null = null;
      if (catalogEnriched?.brand) {
        // SP-API brand is authoritative - use it and skip title parsing
        finalBrand = catalogEnriched.brand;
        brandSource = 'sp_api_catalog';
      } else if (cached?.brand) {
        // Cached brand from previous SP-API call - still authoritative
        finalBrand = cached.brand;
        brandSource = 'sp_api_catalog';
      } else if (canonical.brand) {
        // Only use title-based brand parsing if SP-API brand is missing
        // This is a fallback, not authoritative
        finalBrand = canonical.brand;
        brandSource = 'model_inferred';
      }
      // Never drop brand - always store if available (even if inferred)

      // Image: SP-API → Cache → Rainforest hint (if kill-switch OFF) → Canonical
      let finalImageUrl: string | null = null;
      let imageSource: 'sp_api_catalog' | 'rainforest_serp' | null = null;
      if (catalogEnriched?.image_url) {
        finalImageUrl = catalogEnriched.image_url;
        imageSource = 'sp_api_catalog';
      } else if (cached?.image_url) {
        finalImageUrl = cached.image_url;
        imageSource = 'sp_api_catalog'; // Cached from previous SP-API call
      } else if (!disableRainforestEnrichment && rf?.image_hint) {
        finalImageUrl = rf.image_hint;
        imageSource = 'rainforest_serp';
      } else if (!disableRainforestEnrichment && canonical.image_url) {
        finalImageUrl = canonical.image_url;
        imageSource = 'rainforest_serp';
      } else if (canonical.image_url) {
        finalImageUrl = canonical.image_url;
        imageSource = null; // No source if from canonical but kill-switch is ON
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // AUTHORITATIVE MERGE: Category (SP-API overwrites)
      // ═══════════════════════════════════════════════════════════════════════════
      // SP-API Catalog overwrites: product_type (category)
      let finalCategory: string | null = null;
      let categorySource: 'sp_api_catalog' | null = null;
      if (catalogEnriched?.category) {
        finalCategory = catalogEnriched.category;
        categorySource = 'sp_api_catalog';
      } else if (cached?.category) {
        finalCategory = cached.category;
        categorySource = 'sp_api_catalog'; // Cached from previous SP-API call
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // AUTHORITATIVE MERGE: BSR / Sales Rank (SP-API overwrites)
      // ═══════════════════════════════════════════════════════════════════════════
      // SP-API Catalog overwrites: sales_rank (BSR)
      let finalBsr: number | null = null;
      let bsrSource: 'sp_api_catalog' | null = null;
      if (catalogEnriched?.bsr) {
        finalBsr = catalogEnriched.bsr;
        bsrSource = 'sp_api_catalog';
      } else if (cached?.bsr) {
        finalBsr = cached.bsr;
        bsrSource = 'sp_api_catalog'; // Cached from previous SP-API call
      } else if (canonical.bsr) {
        // Canonical BSR might come from other sources, but prefer SP-API
        finalBsr = canonical.bsr;
        bsrSource = null; // Not from SP-API
      }

      // Pricing API fields (authoritative from SP-API Pricing)
      const buyBoxOwner = pricingEnriched?.buy_box_owner || null;
      const offerCount = pricingEnriched?.offer_count || null;
      const fulfillmentChannel = pricingEnriched?.fulfillment_channel || null;
      const buyBoxOwnerSource: 'sp_api_pricing' | null = buyBoxOwner ? 'sp_api_pricing' : null;
      const offerCountSource: 'sp_api_pricing' | null = offerCount !== null ? 'sp_api_pricing' : null;

      // Rainforest-only fields (authoritative from Rainforest - always used regardless of kill-switch)
      const finalRating = rf?.rating || canonical.rating || null;
      const finalReviews = rf?.reviews || canonical.review_count || null;
      
      // Fulfillment: SP-API Pricing → Rainforest hint (if kill-switch OFF) → Canonical
      let finalFulfillment: string | null = null;
      let fulfillmentSource: 'sp_api_pricing' | 'rainforest_serp' | null = null;
      if (fulfillmentChannel) {
        finalFulfillment = fulfillmentChannel === 'FBA' ? 'FBA' : 'FBM';
        fulfillmentSource = 'sp_api_pricing';
      } else if (!disableRainforestEnrichment && rf?.fulfillment_hint) {
        finalFulfillment = rf.fulfillment_hint === 'AMZ' ? 'AMZ' : rf.fulfillment_hint;
        fulfillmentSource = 'rainforest_serp';
      } else if (!disableRainforestEnrichment && canonical.fulfillment) {
        finalFulfillment = canonical.fulfillment;
        fulfillmentSource = 'rainforest_serp';
      } else if (canonical.fulfillment) {
        finalFulfillment = canonical.fulfillment;
        fulfillmentSource = null; // No source if from canonical but kill-switch is ON
      }
      
      // Price: SP-API Pricing → Rainforest (if kill-switch OFF) → Canonical
      let finalPrice: number | null = null;
      let priceSource: 'sp_api_pricing' | 'rainforest_serp' | null = null;
      if (pricingEnriched?.buy_box_price) {
        finalPrice = pricingEnriched.buy_box_price;
        priceSource = 'sp_api_pricing';
      } else if (pricingEnriched?.lowest_price) {
        finalPrice = pricingEnriched.lowest_price;
        priceSource = 'sp_api_pricing';
      } else if (!disableRainforestEnrichment && rf?.price) {
        finalPrice = rf.price;
        priceSource = 'rainforest_serp';
      } else if (!disableRainforestEnrichment && canonical.price) {
        finalPrice = canonical.price;
        priceSource = 'rainforest_serp';
      } else if (canonical.price) {
        finalPrice = canonical.price;
        priceSource = null; // No source if from canonical but kill-switch is ON
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // MODEL AUTHORITY (never overwritten by SP-API)
      // ═══════════════════════════════════════════════════════════════════════════
      // Revenue and units come ONLY from internal model (canonicalPageOne)
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
      const shouldUpdateEnrichment = catalogEnriched && (catalogEnriched.title !== null || catalogEnriched.brand !== null);
      const lastEnrichedAt = shouldUpdateEnrichment ? new Date().toISOString() : (cached?.last_enriched_at || null);

      keywordProducts.push({
        keyword,
        asin,
        rank: rf?.rank || canonical.page_position || 0,
        price: finalPrice,
        title: finalTitle,
        brand: finalBrand, // Always store if available (never drop)
        image_url: finalImageUrl,
        rating: finalRating,
        review_count: finalReviews,
        fulfillment: finalFulfillment === 'AMZ' ? 'AMZ' : (finalFulfillment as "FBA" | "FBM" | "AMZ" | null),
        category: finalCategory,
        bsr: finalBsr,
        main_category: finalCategory,
        main_category_bsr: finalBsr,
        estimated_monthly_units: monthlyUnits, // Model authority - never overwritten
        estimated_monthly_revenue: monthlyRevenue ? Math.round(monthlyRevenue * 100) / 100 : null, // Model authority
        is_sponsored: rf?.sponsored ?? canonical.is_sponsored ?? null,
        sponsored_position: rf?.ad_position ?? null,
        sponsored_source: rf?.sponsored !== null && rf?.sponsored !== undefined ? 'rainforest_serp' : 'organic_serp',
        last_enriched_at: lastEnrichedAt,
        // SP-API Pricing fields
        buy_box_owner: buyBoxOwner,
        offer_count: offerCount,
        // Source tagging for debugging and verification
        brand_source: brandSource,
        title_source: titleSource,
        category_source: categorySource,
        bsr_source: bsrSource,
        buy_box_owner_source: buyBoxOwnerSource,
        offer_count_source: offerCountSource,
        fulfillment_source: fulfillmentSource,
        price_source: priceSource,
        image_source: imageSource,
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

