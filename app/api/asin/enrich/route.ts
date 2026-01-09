import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * ASIN Enrichment API Endpoint
 * 
 * Provides lazy, on-demand ASIN enrichment using Rainforest API.
 * 
 * ARCHITECTURAL RULES:
 * - Market Snapshot and Page-1 revenue totals remain unchanged
 * - Refined data is scoped to the specific ASIN only
 * - Never affects brand moat calculations
 * - Refined data is a refinement layer only
 */

interface EnrichRequestBody {
  asin: string;
  analysisRunId: string;
  currentPrice?: number; // Price from the listing card (for revenue calculation)
}

interface RefinedUnitsRange {
  min: number;
  max: number;
}

interface EnrichResponse {
  success: boolean;
  error?: string;
  data?: {
    refined_units_range: RefinedUnitsRange;
    refined_estimated_revenue: number;
    current_price: number;
    current_bsr: number | null;
    review_count: number | null;
    fulfillment_type: string | null;
    data_source: "rainforest_refinement";
    confidence: "high" | "medium" | "low";
    expires_at?: string | null;
  };
}

/**
 * Parses bought_last_month from Rainforest API response
 * Can be a range (e.g., "1,000-5,000") or a single value
 */
function parseBoughtLastMonth(product: any): RefinedUnitsRange | null {
  const bought = product.bought_last_month;
  
  if (!bought) {
    return null;
  }
  
  // If it's a string, try to parse as range
  if (typeof bought === "string") {
    const cleaned = bought.replace(/,/g, "").trim();
    
    // Check for range format (e.g., "1000-5000" or "1,000-5,000")
    const rangeMatch = cleaned.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
      const min = parseInt(rangeMatch[1], 10);
      const max = parseInt(rangeMatch[2], 10);
      if (!isNaN(min) && !isNaN(max) && min >= 0 && max >= min) {
        return { min, max };
      }
    }
    
    // Try to parse as single number
    const single = parseInt(cleaned, 10);
    if (!isNaN(single) && single >= 0) {
      // Use ±20% range for single values
      return {
        min: Math.floor(single * 0.8),
        max: Math.ceil(single * 1.2),
      };
    }
  }
  
  // If it's a number
  if (typeof bought === "number" && bought >= 0) {
    // Use ±20% range for single values
    return {
      min: Math.floor(bought * 0.8),
      max: Math.ceil(bought * 1.2),
    };
  }
  
  // Check for range object
  if (typeof bought === "object" && bought !== null) {
    const min = typeof bought.min === "number" ? bought.min : null;
    const max = typeof bought.max === "number" ? bought.max : null;
    
    if (min !== null && max !== null && min >= 0 && max >= min) {
      return { min, max };
    }
    
    if (min !== null && min >= 0) {
      return { min, max: Math.ceil(min * 1.2) };
    }
    
    if (max !== null && max >= 0) {
      return { min: Math.floor(max * 0.8), max };
    }
  }
  
  return null;
}

/**
 * Determines confidence level based on data quality
 */
function determineConfidence(
  unitsRange: RefinedUnitsRange | null,
  price: number | null,
  bsr: number | null
): "high" | "medium" | "low" {
  if (!unitsRange || !price) {
    return "low";
  }
  
  // High confidence: has units range and BSR
  if (bsr !== null && bsr > 0) {
    return "high";
  }
  
  // Medium confidence: has units range but no BSR
  if (unitsRange.min > 0 || unitsRange.max > 0) {
    return "medium";
  }
  
  return "low";
}

export async function POST(req: NextRequest) {
  let res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    // 1. Authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // 2. Parse request body
    const body: EnrichRequestBody = await req.json();
    const { asin, analysisRunId, currentPrice } = body;

    if (!asin || !analysisRunId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: asin, analysisRunId" },
        { status: 400, headers: res.headers }
      );
    }

    // Validate ASIN format
    const cleanAsin = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
      return NextResponse.json(
        { success: false, error: "Invalid ASIN format" },
        { status: 400, headers: res.headers }
      );
    }

    // 3. Check cache (per-user, per-ASIN, per-analysis-run, 24-hour expiry)
    const { data: cached, error: cacheError } = await supabase
      .from("asin_refinement_cache")
      .select("*")
      .eq("user_id", user.id)
      .eq("asin", cleanAsin)
      .eq("analysis_run_id", analysisRunId)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (cached && !cacheError) {
      // Check if cache is expired
      const isExpired = cached.expires_at && new Date(cached.expires_at) < new Date();
      
      if (isExpired) {
        console.log(`[ASINEnrich] Cache expired for ${cleanAsin} (user: ${user.id}), fetching fresh data`);
        // Continue to fetch fresh data below
      } else {
        console.log(`[ASINEnrich] Cache hit for ${cleanAsin} (user: ${user.id})`);
        return NextResponse.json(
          {
            success: true,
            data: {
              refined_units_range: cached.refined_units_range as RefinedUnitsRange,
              refined_estimated_revenue: parseFloat(cached.refined_estimated_revenue.toString()),
              current_price: cached.current_price ? parseFloat(cached.current_price.toString()) : currentPrice || 0,
              current_bsr: cached.current_bsr,
              review_count: cached.review_count,
              fulfillment_type: cached.fulfillment_type,
              data_source: cached.data_source as "rainforest_refinement",
              confidence: cached.confidence as "high" | "medium" | "low",
              expires_at: cached.expires_at,
            },
          },
          { headers: res.headers }
        );
      }
    }

    // 4. Fetch from Rainforest API
    const rainforestApiKey = process.env.RAINFOREST_API_KEY;
    if (!rainforestApiKey) {
      return NextResponse.json(
        { success: false, error: "Rainforest API key not configured" },
        { status: 500, headers: res.headers }
      );
    }

    console.log(`[ASINEnrich] Fetching Rainforest data for ${cleanAsin}`);

    const rainforestResponse = await fetch(
      `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=product&amazon_domain=amazon.com&asin=${cleanAsin}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!rainforestResponse.ok) {
      console.error(`[ASINEnrich] Rainforest API error: ${rainforestResponse.status}`);
      return NextResponse.json(
        { success: false, error: "Failed to fetch ASIN data from Rainforest API" },
        { status: 500, headers: res.headers }
      );
    }

    const raw = await rainforestResponse.json();

    if (raw.error || !raw.product) {
      console.error(`[ASINEnrich] Invalid Rainforest response for ${cleanAsin}`);
      return NextResponse.json(
        { success: false, error: "Invalid data from Rainforest API" },
        { status: 500, headers: res.headers }
      );
    }

    const product = raw.product;

    // 5. Extract and parse data
    const unitsRange = parseBoughtLastMonth(product);
    
    // Use current price from listing if provided, otherwise try to parse from product
    let price = currentPrice || null;
    if (!price) {
      if (product.price?.value) {
        price = parseFloat(product.price.value);
      } else if (product.price?.raw) {
        price = parseFloat(product.price.raw);
      }
    }

    // Parse BSR
    let bsr: number | null = null;
    if (product.bestsellers_rank && Array.isArray(product.bestsellers_rank) && product.bestsellers_rank.length > 0) {
      const firstRank = product.bestsellers_rank[0];
      if (firstRank.rank !== undefined && firstRank.rank !== null) {
        const parsed = parseInt(firstRank.rank.toString().replace(/,/g, ""), 10);
        bsr = isNaN(parsed) || parsed <= 0 ? null : parsed;
      }
    }

    // Parse review count
    let reviewCount: number | null = null;
    if (product.reviews_total !== undefined && product.reviews_total !== null) {
      const parsed = parseInt(product.reviews_total.toString().replace(/,/g, ""), 10);
      reviewCount = isNaN(parsed) || parsed < 0 ? null : parsed;
    }

    // Parse fulfillment type
    let fulfillmentType: string | null = null;
    if (product.fulfillment?.is_prime === true || product.fulfillment?.type === "prime") {
      fulfillmentType = "FBA";
    } else if (product.fulfillment?.type === "amazon") {
      fulfillmentType = "Amazon";
    } else {
      fulfillmentType = "FBM";
    }

    // 6. Calculate refined revenue (use average of units range if available)
    let refinedRevenue = 0;
    if (unitsRange && price) {
      const avgUnits = (unitsRange.min + unitsRange.max) / 2;
      refinedRevenue = avgUnits * price;
    }

    // Determine confidence
    const confidence = determineConfidence(unitsRange, price, bsr);

    // 7. Cache the result (24-hour expiry)
    if (unitsRange && price) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await supabase.from("asin_refinement_cache").upsert({
        user_id: user.id,
        asin: cleanAsin,
        analysis_run_id: analysisRunId,
        refined_units_range: unitsRange,
        refined_estimated_revenue: refinedRevenue,
        current_price: price,
        current_bsr: bsr,
        review_count: reviewCount,
        fulfillment_type: fulfillmentType,
        data_source: "rainforest_refinement",
        confidence,
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: "user_id,asin,analysis_run_id",
      });

      console.log(`[ASINEnrich] Cached refined data for ${cleanAsin} (confidence: ${confidence})`);
    }

    // 8. Return response
    const expiresAt = unitsRange && price 
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
      : null;
    
    const response: EnrichResponse = {
      success: true,
      data: {
        refined_units_range: unitsRange || { min: 0, max: 0 },
        refined_estimated_revenue: refinedRevenue,
        current_price: price || 0,
        current_bsr: bsr,
        review_count: reviewCount,
        fulfillment_type: fulfillmentType,
        data_source: "rainforest_refinement",
        confidence,
        expires_at: expiresAt,
      },
    };

    return NextResponse.json(response, { headers: res.headers });
  } catch (error) {
    console.error("[ASINEnrich] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: res.headers }
    );
  }
}

