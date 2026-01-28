/**
 * Rainforest API Reviews Enrichment
 * Fetches recent product reviews and extracts themes
 */

export interface RainforestReviewsEnrichment {
  asin: string;
  title: string | null;
  reviews: Array<{
    rating: number;
    title: string | null;
    text: string;
    verified_purchase: boolean | null;
    helpful_votes: number | null;
  }>;
  extracted: {
    top_complaints: Array<{ theme: string; snippet?: string }>;
    top_praise: Array<{ theme: string; snippet?: string }>;
  };
  errors: string[];
}

/**
 * Fetch Rainforest reviews data for enrichment (recent reviews, extract themes)
 */
export async function getRainforestReviewsEnrichment(
  asin: string,
  amazonDomain: string = "amazon.com",
  limit: number = 20
): Promise<RainforestReviewsEnrichment | null> {
  const startTime = Date.now();
  const rainforestApiKey = process.env.RAINFOREST_API_KEY;
  
  if (!rainforestApiKey) {
    console.warn("RAINFOREST_API_KEY not configured");
    return null;
  }
  
  try {
    // Build request URL with type=reviews
    const params = new URLSearchParams({
      api_key: rainforestApiKey,
      type: "reviews",
      amazon_domain: amazonDomain,
      asin: asin,
      // Fetch up to limit reviews (Rainforest API may have its own max)
      // Note: Rainforest API may not support limit parameter directly
    });
    
    const apiUrl = `https://api.rainforestapi.com/request?${params.toString()}`;
    
    console.log("RAINFOREST_REVIEWS_ENRICHMENT_REQUEST", {
      asin,
      amazon_domain: amazonDomain,
      limit,
      start_time: new Date().toISOString(),
    });
    
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    
    const duration = Date.now() - startTime;
    const httpStatus = response.status;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("RAINFOREST_REVIEWS_ENRICHMENT_ERROR", {
        asin,
        http_status: httpStatus,
        error: errorText.substring(0, 200),
        duration_ms: duration,
      });
      
      // Handle 503 errors specifically
      if (httpStatus === 503 || errorText.toLowerCase().includes('temporarily unavailable')) {
        return {
          asin,
          title: null,
          reviews: [],
          extracted: {
            top_complaints: [],
            top_praise: [],
          },
          errors: ["TEMPORARILY_UNAVAILABLE"],
        };
      }
      
      return {
        asin,
        title: null,
        reviews: [],
        extracted: {
          top_complaints: [],
          top_praise: [],
        },
        errors: [`HTTP ${httpStatus}: ${errorText.substring(0, 100)}`],
      };
    }
    
    const data = await response.json();
    
    if (data.error) {
      console.error("RAINFOREST_REVIEWS_ENRICHMENT_API_ERROR", {
        asin,
        error: data.error,
        duration_ms: duration,
      });
      return {
        asin,
        title: null,
        reviews: [],
        extracted: {
          top_complaints: [],
          top_praise: [],
        },
        errors: [data.error],
      };
    }
    
    // Extract reviews from response
    const reviewsData = data.reviews || [];
    const productTitle = data.product?.title || null;
    
    // Parse reviews (limit to requested number)
    const reviews = reviewsData.slice(0, limit).map((review: any) => ({
      rating: typeof review.rating === 'number' ? review.rating : 0,
      title: review.title || null,
      text: review.text || review.body || '',
      verified_purchase: review.verified_purchase === true ? true : (review.verified_purchase === false ? false : null),
      helpful_votes: typeof review.helpful_votes === 'number' ? review.helpful_votes : null,
    })).filter((r: any) => r.text && r.text.length > 0);
    
    // Extract themes from reviews
    // Simple keyword-based extraction for complaints (negative) and praise (positive)
    const complaints: Array<{ theme: string; snippet?: string }> = [];
    const praise: Array<{ theme: string; snippet?: string }> = [];
    
    // Negative keywords (common complaint themes)
    const complaintKeywords = [
      'broken', 'defective', 'damaged', 'poor quality', 'cheap', 'not working', 'stopped working',
      'waste of money', 'disappointed', 'returned', 'refund', 'doesn\'t work', "doesn't work",
      'too small', 'too large', 'uncomfortable', 'uncomfortable', 'unreliable', 'slow',
      'battery', 'charging', 'connection', 'connectivity', 'noise', 'loud', 'quiet',
      'shipping', 'packaging', 'missing', 'wrong', 'different', 'not as described'
    ];
    
    // Positive keywords (common praise themes)
    const praiseKeywords = [
      'great', 'excellent', 'amazing', 'love', 'perfect', 'high quality', 'well made',
      'works great', 'works well', 'fast', 'reliable', 'comfortable', 'comfortable',
      'good value', 'worth it', 'recommend', 'exceeded expectations', 'better than expected',
      'durable', 'sturdy', 'easy to use', 'easy setup', 'good battery', 'long battery'
    ];
    
    // Group reviews by sentiment
    const negativeReviews = reviews.filter((r: any) => r.rating <= 2);
    const positiveReviews = reviews.filter((r: any) => r.rating >= 4);
    
    // Extract complaint themes from negative reviews
    const complaintThemes = new Map<string, { count: number; snippets: string[] }>();
    for (const review of negativeReviews) {
      const text = review.text.toLowerCase();
      for (const keyword of complaintKeywords) {
        if (text.includes(keyword.toLowerCase())) {
          const existing = complaintThemes.get(keyword) || { count: 0, snippets: [] };
          existing.count++;
          if (existing.snippets.length < 2 && review.text.length > 20) {
            // Extract a short snippet (first 100 chars)
            existing.snippets.push(review.text.substring(0, 100).trim() + (review.text.length > 100 ? '...' : ''));
          }
          complaintThemes.set(keyword, existing);
        }
      }
    }
    
    // Extract praise themes from positive reviews
    const praiseThemes = new Map<string, { count: number; snippets: string[] }>();
    for (const review of positiveReviews) {
      const text = review.text.toLowerCase();
      for (const keyword of praiseKeywords) {
        if (text.includes(keyword.toLowerCase())) {
          const existing = praiseThemes.get(keyword) || { count: 0, snippets: [] };
          existing.count++;
          if (existing.snippets.length < 2 && review.text.length > 20) {
            existing.snippets.push(review.text.substring(0, 100).trim() + (review.text.length > 100 ? '...' : ''));
          }
          praiseThemes.set(keyword, existing);
        }
      }
    }
    
    // Sort by count and take top 3
    const topComplaints = Array.from(complaintThemes.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([theme, data]) => ({
        theme: theme.charAt(0).toUpperCase() + theme.slice(1),
        snippet: data.snippets[0],
      }));
    
    const topPraise = Array.from(praiseThemes.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([theme, data]) => ({
        theme: theme.charAt(0).toUpperCase() + theme.slice(1),
        snippet: data.snippets[0],
      }));
    
    console.log("RAINFOREST_REVIEWS_ENRICHMENT_SUCCESS", {
      asin,
      http_status: httpStatus,
      duration_ms: duration,
      reviews_count: reviews.length,
      top_complaints_count: topComplaints.length,
      top_praise_count: topPraise.length,
    });
    
    return {
      asin,
      title: productTitle,
      reviews,
      extracted: {
        top_complaints: topComplaints,
        top_praise: topPraise,
      },
      errors: [],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("RAINFOREST_REVIEWS_ENRICHMENT_EXCEPTION", {
      asin,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    });
    return {
      asin,
      title: null,
      reviews: [],
      extracted: {
        top_complaints: [],
        top_praise: [],
      },
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
