/**
 * Rainforest API Product Enrichment
 * Fetches product details including customers_say, summarization_attributes, and variants
 */

export interface RainforestProductEnrichment {
  asin: string;
  title: string | null;
  customers_say: {
    themes?: Array<{ label: string; sentiment: 'positive' | 'negative'; mentions?: number }>;
    snippets?: Array<{ text: string; sentiment: 'positive' | 'negative' }>;
  } | null;
  summarization_attributes: Record<string, { rating: number; count?: number }> | null;
  variants: {
    child_asins?: string[];
    parent_asin?: string;
    variation_theme?: string;
  } | null;
  extracted: {
    top_complaints: string[];
    top_praise: string[];
    attribute_signals: Array<{ name: string; value: string }>;
  };
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
        title: null,
        customers_say: null,
        summarization_attributes: null,
        variants: null,
        extracted: {
          top_complaints: [],
          top_praise: [],
          attribute_signals: [],
        },
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
        title: null,
        customers_say: null,
        summarization_attributes: null,
        variants: null,
        extracted: {
          top_complaints: [],
          top_praise: [],
          attribute_signals: [],
        },
        errors: [data.error],
      };
    }
    
    const product = data.product || {};
    
    // Extract title
    const title = product.title || null;
    
    // Extract customers_say (themes + sentiment snippets)
    let customers_say: RainforestProductEnrichment['customers_say'] = null;
    const topComplaints: string[] = [];
    const topPraise: string[] = [];
    
    if (product.customers_say) {
      const themes: Array<{ label: string; sentiment: 'positive' | 'negative'; mentions?: number }> = [];
      const snippets: Array<{ text: string; sentiment: 'positive' | 'negative' }> = [];
      
      // Parse customers_say structure (varies by API version)
      if (Array.isArray(product.customers_say)) {
        for (const item of product.customers_say) {
          if (item.theme || item.label) {
            const themeLabel = item.theme || item.label || '';
            const sentiment = item.sentiment === 'positive' ? 'positive' : 'negative';
            themes.push({
              label: themeLabel,
              sentiment,
              mentions: typeof item.mentions === 'number' ? item.mentions : undefined,
            });
            
            // Extract to top_complaints or top_praise
            if (sentiment === 'negative' && themeLabel) {
              topComplaints.push(themeLabel);
            } else if (sentiment === 'positive' && themeLabel) {
              topPraise.push(themeLabel);
            }
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
        if (product.customers_say.themes && Array.isArray(product.customers_say.themes)) {
          for (const theme of product.customers_say.themes) {
            const themeLabel = theme.label || theme.theme || '';
            const sentiment = theme.sentiment === 'positive' ? 'positive' : 'negative';
            themes.push({
              label: themeLabel,
              sentiment,
              mentions: typeof theme.mentions === 'number' ? theme.mentions : undefined,
            });
            
            // Extract to top_complaints or top_praise
            if (sentiment === 'negative' && themeLabel) {
              topComplaints.push(themeLabel);
            } else if (sentiment === 'positive' && themeLabel) {
              topPraise.push(themeLabel);
            }
          }
        }
        if (product.customers_say.snippets && Array.isArray(product.customers_say.snippets)) {
          snippets.push(...product.customers_say.snippets);
        }
      }
      
      if (themes.length > 0 || snippets.length > 0) {
        customers_say = { themes, ...(snippets.length > 0 ? { snippets } : {}) };
      }
    }
    
    // Extract summarization_attributes (attribute ratings)
    let summarization_attributes: Record<string, { rating: number; count?: number }> | null = null;
    const attributeSignals: Array<{ name: string; value: string }> = [];
    
    if (product.summarization_attributes && typeof product.summarization_attributes === 'object') {
      summarization_attributes = {};
      for (const [key, value] of Object.entries(product.summarization_attributes)) {
        if (value && typeof value === 'object' && 'rating' in value) {
          const valueObj = value as { rating?: unknown; count?: unknown };
          const rating = typeof valueObj.rating === 'number' ? valueObj.rating : 0;
          summarization_attributes[key] = {
            rating,
            count: typeof valueObj.count === 'number' ? valueObj.count : undefined,
          };
          
          // Extract to attribute_signals (format: "name: value")
          if (key && rating > 0) {
            attributeSignals.push({
              name: key,
              value: rating.toString(),
            });
          }
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
      has_title: !!title,
      has_customers_say: !!customers_say,
      customers_say_themes_count: customers_say?.themes?.length || 0,
      top_complaints_count: topComplaints.length,
      top_praise_count: topPraise.length,
      has_summarization_attributes: !!summarization_attributes,
      summarization_attributes_count: summarization_attributes ? Object.keys(summarization_attributes).length : 0,
      attribute_signals_count: attributeSignals.length,
      has_variants: !!variants,
    });
    
    return {
      asin,
      title,
      customers_say,
      summarization_attributes,
      variants,
      extracted: {
        top_complaints: topComplaints,
        top_praise: topPraise,
        attribute_signals: attributeSignals,
      },
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
      title: null,
      customers_say: null,
      summarization_attributes: null,
      variants: null,
      extracted: {
        top_complaints: [],
        top_praise: [],
        attribute_signals: [],
      },
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

