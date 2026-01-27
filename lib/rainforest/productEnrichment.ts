/**
 * Rainforest API Product Enrichment
 * Fetches product details including customers_say, summarization_attributes, and variants
 */

export interface RainforestProductEnrichment {
  asin: string;
  customers_say: {
    themes: Array<{ label: string; sentiment: 'positive' | 'negative'; mentions?: number }>;
    snippets?: Array<{ text: string; sentiment: 'positive' | 'negative' }>;
  } | null;
  summarization_attributes: Record<string, { rating: number; count?: number }> | null;
  variants: {
    child_asins?: string[];
    parent_asin?: string;
    variation_theme?: string;
  } | null;
  errors: string[];
}

/**
 * Fetch Rainforest product data for enrichment (customers_say, summarization_attributes, variants)
 */
export async function getRainforestProductEnrichment(
  asin: string,
  amazonDomain: string = "amazon.com",
  userId?: string
): Promise<RainforestProductEnrichment | null> {
  const startTime = Date.now();
  const rainforestApiKey = process.env.RAINFOREST_API_KEY;
  
  if (!rainforestApiKey) {
    console.warn("RAINFOREST_API_KEY not configured");
    return null;
  }
  
  try {
    // Build request URL with include_summarization_attributes=true
    // Request only needed fields to reduce payload
    const params = new URLSearchParams({
      api_key: rainforestApiKey,
      type: "product",
      amazon_domain: amazonDomain,
      asin: asin,
      include_summarization_attributes: "true",
      // Request only needed fields if supported
      fields: "product.customers_say,product.summarization_attributes,product.variants,product.title",
    });
    
    const apiUrl = `https://api.rainforestapi.com/request?${params.toString()}`;
    
    console.log("RAINFOREST_PRODUCT_ENRICHMENT_REQUEST", {
      asin,
      amazon_domain: amazonDomain,
      start_time: new Date().toISOString(),
      include_summarization_attributes: true,
    });
    
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    
    const duration = Date.now() - startTime;
    const httpStatus = response.status;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("RAINFOREST_PRODUCT_ENRICHMENT_ERROR", {
        asin,
        http_status: httpStatus,
        error: errorText.substring(0, 200),
        duration_ms: duration,
      });
      return {
        asin,
        customers_say: null,
        summarization_attributes: null,
        variants: null,
        errors: [`HTTP ${httpStatus}: ${errorText.substring(0, 100)}`],
      };
    }
    
    const data = await response.json();
    
    if (data.error) {
      console.error("RAINFOREST_PRODUCT_ENRICHMENT_API_ERROR", {
        asin,
        error: data.error,
        duration_ms: duration,
      });
      return {
        asin,
        customers_say: null,
        summarization_attributes: null,
        variants: null,
        errors: [data.error],
      };
    }
    
    const product = data.product || {};
    
    // Extract customers_say (themes + sentiment snippets)
    let customers_say: RainforestProductEnrichment['customers_say'] = null;
    if (product.customers_say) {
      const themes: Array<{ label: string; sentiment: 'positive' | 'negative'; mentions?: number }> = [];
      const snippets: Array<{ text: string; sentiment: 'positive' | 'negative' }> = [];
      
      // Parse customers_say structure (varies by API version)
      if (Array.isArray(product.customers_say)) {
        for (const item of product.customers_say) {
          if (item.theme || item.label) {
            themes.push({
              label: item.theme || item.label || '',
              sentiment: item.sentiment === 'positive' ? 'positive' : 'negative',
              mentions: typeof item.mentions === 'number' ? item.mentions : undefined,
            });
          }
          if (item.text || item.snippet) {
            snippets.push({
              text: item.text || item.snippet || '',
              sentiment: item.sentiment === 'positive' ? 'positive' : 'negative',
            });
          }
        }
      } else if (typeof product.customers_say === 'object') {
        // Handle object structure
        if (product.customers_say.themes) {
          themes.push(...(product.customers_say.themes || []));
        }
        if (product.customers_say.snippets) {
          snippets.push(...(product.customers_say.snippets || []));
        }
      }
      
      if (themes.length > 0 || snippets.length > 0) {
        customers_say = { themes, ...(snippets.length > 0 ? { snippets } : {}) };
      }
    }
    
    // Extract summarization_attributes (attribute ratings)
    let summarization_attributes: Record<string, { rating: number; count?: number }> | null = null;
    if (product.summarization_attributes && typeof product.summarization_attributes === 'object') {
      summarization_attributes = {};
      for (const [key, value] of Object.entries(product.summarization_attributes)) {
        if (value && typeof value === 'object' && 'rating' in value) {
          summarization_attributes[key] = {
            rating: typeof value.rating === 'number' ? value.rating : 0,
            count: typeof value.count === 'number' ? value.count : undefined,
          };
        }
      }
      if (Object.keys(summarization_attributes).length === 0) {
        summarization_attributes = null;
      }
    }
    
    // Extract variants (child/parent relationships)
    let variants: RainforestProductEnrichment['variants'] = null;
    if (product.variants) {
      const childAsins = Array.isArray(product.variants) 
        ? product.variants.map((v: any) => v.asin || v).filter(Boolean)
        : (product.variants.child_asins || []);
      
      const parentAsin = product.variants.parent_asin || product.parent_asin || null;
      const variationTheme = product.variants.variation_theme || product.variation_theme || null;
      
      if (childAsins.length > 0 || parentAsin || variationTheme) {
        variants = {
          ...(childAsins.length > 0 ? { child_asins: childAsins } : {}),
          ...(parentAsin ? { parent_asin: parentAsin } : {}),
          ...(variationTheme ? { variation_theme: variationTheme } : {}),
        };
      }
    }
    
    console.log("RAINFOREST_PRODUCT_ENRICHMENT_SUCCESS", {
      asin,
      http_status: httpStatus,
      duration_ms: duration,
      has_customers_say: !!customers_say,
      customers_say_themes_count: customers_say?.themes?.length || 0,
      has_summarization_attributes: !!summarization_attributes,
      summarization_attributes_count: summarization_attributes ? Object.keys(summarization_attributes).length : 0,
      has_variants: !!variants,
    });
    
    return {
      asin,
      customers_say,
      summarization_attributes,
      variants,
      errors: [],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("RAINFOREST_PRODUCT_ENRICHMENT_EXCEPTION", {
      asin,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    });
    return {
      asin,
      customers_say: null,
      summarization_attributes: null,
      variants: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

