/**
 * Rainforest API Product Enrichment
 * Fetches product details including customers_say, summarization_attributes, variants,
 * top_reviews, and rating_breakdown. Also computes lightweight review themes directly
 * from the product page to minimize reliance on type=reviews.
 */

import {
  buildReviewThemesFromProduct,
  ProductReviewSignals,
  ReviewThemeSource,
} from "./reviewThemesFromProduct";

export interface RainforestProductEnrichment {
  asin: string;
  title: string | null;
  customers_say: {
    themes?: Array<{ label: string; sentiment: 'positive' | 'negative'; mentions?: number }>;
    snippets?: Array<{ text: string; sentiment: 'positive' | 'negative' }>;
  } | null;
  summarization_attributes: Record<string, { rating: number; count?: number }> | null;
  top_reviews?: Array<{
    rating: number;
    title: string | null;
    text: string;
    verified_purchase: boolean | null;
    date: string | null;
  }> | null;
  rating_breakdown?: Record<string, { percentage?: number; count?: number }> | null;
  variants: {
    child_asins?: string[];
    parent_asin?: string;
    variation_theme?: string;
  } | null;
  extracted: {
    top_complaints: Array<{ theme: string; evidence?: string }>;
    top_praise: Array<{ theme: string; evidence?: string }>;
    review_themes_source?: ReviewThemeSource | null;
    attribute_signals: Array<{ name: string; value: string }>;
    // Catalog fallback fields (for when SP-API is empty or missing fields)
    feature_bullets?: string[] | string | null;
    description?: string | null;
    attributes?: Record<string, any> | null;
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
      fields: "product.customers_say,product.summarization_attributes,product.variants,product.title,product.feature_bullets,product.description,product.attributes",
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
    let customers_say: RainforestProductEnrichment["customers_say"] = null;
    
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
            
            // Themes themselves are carried through customers_say;
            // final top_complaints/top_praise are computed later via helper.
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
            
            // Themes themselves are carried through customers_say;
            // final top_complaints/top_praise are computed later via helper.
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
    
    // Extract top_reviews (representative reviews on PDP)
    let topReviews: RainforestProductEnrichment["top_reviews"] = null;
    const rawTopReviews = product.top_reviews || product.representative_reviews || null;
    if (Array.isArray(rawTopReviews) && rawTopReviews.length > 0) {
      topReviews = rawTopReviews
        .map((r: any) => ({
          rating: typeof r.rating === "number" ? r.rating : 0,
          title: (r.title || r.review_title || null) as string | null,
          text: (r.body || r.text || r.review_text || "").trim(),
          verified_purchase:
            r.verified_purchase === true
              ? true
              : r.verified_purchase === false
              ? false
              : null,
          date: (r.date || r.review_date || null) as string | null,
        }))
        .filter((r: any) => r.text && r.text.length > 0);
      if (topReviews.length === 0) {
        topReviews = null;
      }
    }

    // Extract rating_breakdown (percentage/count per star)
    let ratingBreakdown: RainforestProductEnrichment["rating_breakdown"] = null;
    if (product.rating_breakdown && typeof product.rating_breakdown === "object") {
      ratingBreakdown = {};
      for (const [key, value] of Object.entries(product.rating_breakdown)) {
        if (!value || typeof value !== "object") continue;
        const v = value as { percentage?: unknown; count?: unknown };
        const pct = typeof v.percentage === "number" ? v.percentage : undefined;
        const count = typeof v.count === "number" ? v.count : undefined;
        if (pct !== undefined || count !== undefined) {
          ratingBreakdown[key] = { ...(pct !== undefined ? { percentage: pct } : {}), ...(count !== undefined ? { count } : {}) };
        }
      }
      if (Object.keys(ratingBreakdown).length === 0) {
        ratingBreakdown = null;
      }
    }

    // Extract feature_bullets and description (for catalog fallback)
    const featureBullets = product.feature_bullets || product.bullet_points || null;
    const description = product.description || product.product_description || null;
    const productAttributes = product.attributes || product.specifications || null;

    // Build deterministic review themes from product-level signals
    const reviewSignals: ProductReviewSignals = {
      customers_say,
      summarization_attributes,
      top_reviews: topReviews,
      rating_breakdown: ratingBreakdown,
    };
    const reviewThemes = buildReviewThemesFromProduct(reviewSignals);
    
    console.log("RAINFOREST_PRODUCT_ENRICHMENT_SUCCESS", {
      asin,
      http_status: httpStatus,
      duration_ms: duration,
      has_title: !!title,
      has_customers_say: !!customers_say,
      customers_say_themes_count: customers_say?.themes?.length || 0,
      top_complaints_count: reviewThemes.top_complaints.length,
      top_praise_count: reviewThemes.top_praise.length,
      has_summarization_attributes: !!summarization_attributes,
      summarization_attributes_count: summarization_attributes ? Object.keys(summarization_attributes).length : 0,
      attribute_signals_count: attributeSignals.length,
      has_top_reviews: !!topReviews,
      top_reviews_count: topReviews?.length || 0,
      has_rating_breakdown: !!ratingBreakdown,
      has_variants: !!variants,
      has_feature_bullets: !!featureBullets,
      has_description: !!description,
      has_attributes: !!productAttributes,
      review_themes_source_used: reviewThemes.source_used || null,
    });
    
    return {
      asin,
      title,
      customers_say,
      summarization_attributes,
      top_reviews: topReviews,
      rating_breakdown: ratingBreakdown,
      variants,
      extracted: {
        top_complaints: reviewThemes.top_complaints,
        top_praise: reviewThemes.top_praise,
        review_themes_source: reviewThemes.source_used,
        attribute_signals: attributeSignals,
        // Include catalog fields for fallback use
        feature_bullets: featureBullets,
        description: description,
        attributes: productAttributes,
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

