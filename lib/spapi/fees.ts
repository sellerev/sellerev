/**
 * SP-API FBA Fee Retrieval (MVP)
 * 
 * Fetches referral fee and fulfillment fee for an ASIN using SP-API.
 * Implements cache-first strategy with 24h TTL.
 * Falls back to category-based heuristic if SP-API fails.
 * 
 * Scope: MVP ONLY - referral fee and fulfillment fee
 * Does NOT fetch: storage fees, PPC fees
 */

import { createClient } from "@/lib/supabase/server";
import { getSpApiAccessToken } from "./auth";
import { createHmac, createHash } from "crypto";

export interface FbaFeesResult {
  referral_fee: number;
  fulfillment_fee: number;
  source: "sp_api" | "estimate";
  confidence: "high" | "medium" | "low";
}

const CACHE_TTL_HOURS = 24;

/**
 * Get FBA fees for an ASIN
 * 
 * Strategy:
 * 1. Check cache (24h TTL)
 * 2. If cache miss: Call SP-API
 * 3. If SP-API fails: Use category-based heuristic (if category/price provided)
 * 4. Cache result
 * 
 * @param asin - Amazon ASIN (required)
 * @param options - Optional parameters for fallback estimation
 * @param options.category - Product category (for fallback if SP-API fails)
 * @param options.price - Selling price (for fallback if SP-API fails)
 * @returns Promise<FbaFeesResult>
 */
export async function getFbaFees(
  asin: string,
  options?: {
    category?: string | null;
    price?: number | null;
  }
): Promise<FbaFeesResult> {
  const category = options?.category;
  const price = options?.price;
  const normalizedAsin = asin.toUpperCase().trim();
  
  try {
    const supabase = await createClient();
    
    // Step 1: Check cache (24h TTL)
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - CACHE_TTL_HOURS);
    
    const { data: cachedData, error: cacheError } = await supabase
      .from("fba_fee_cache")
      .select("referral_fee, fulfillment_fee, fetched_at")
      .eq("asin", normalizedAsin)
      .gte("fetched_at", cutoffTime.toISOString())
      .single();
    
    // Step 2: If cached and fresh, return cached result
    if (!cacheError && cachedData && cachedData.referral_fee !== null && cachedData.fulfillment_fee !== null) {
      return {
        referral_fee: parseFloat(cachedData.referral_fee.toString()),
        fulfillment_fee: parseFloat(cachedData.fulfillment_fee.toString()),
        source: "sp_api",
        confidence: "high",
      };
    }
    
    // Step 3: Cache miss - try SP-API
    const spApiResult = await fetchFeesFromSpApi(normalizedAsin, price);
    
    if (spApiResult) {
      // Step 4: Cache SP-API result
      try {
        await supabase
          .from("fba_fee_cache")
          .upsert(
            {
              asin: normalizedAsin,
              referral_fee: spApiResult.referral_fee,
              fulfillment_fee: spApiResult.fulfillment_fee,
              total_fba_fees: spApiResult.referral_fee + spApiResult.fulfillment_fee,
              currency: "USD",
              fetched_at: new Date().toISOString(),
            },
            {
              onConflict: "asin",
            }
          );
      } catch (cacheError) {
        // Log but don't throw - caching failure shouldn't block
        console.error("Failed to cache FBA fees:", cacheError);
      }
      
      return {
        ...spApiResult,
        source: "sp_api",
        confidence: "high",
      };
    }
    
    // Step 5: SP-API failed - use category-based heuristic
    if (category && price && price > 0) {
      const estimatedFees = estimateFeesByCategory(category, price);
      
      // Cache estimate (with lower confidence)
      try {
        await supabase
          .from("fba_fee_cache")
          .upsert(
            {
              asin: normalizedAsin,
              referral_fee: estimatedFees.referral_fee,
              fulfillment_fee: estimatedFees.fulfillment_fee,
              total_fba_fees: estimatedFees.referral_fee + estimatedFees.fulfillment_fee,
              currency: "USD",
              fetched_at: new Date().toISOString(),
            },
            {
              onConflict: "asin",
            }
          );
      } catch (cacheError) {
        console.error("Failed to cache estimated fees:", cacheError);
      }
      
      return {
        ...estimatedFees,
        source: "estimate",
        confidence: "low",
      };
    }
    
    // Step 6: No fallback available - return default estimate
    return {
      referral_fee: 0,
      fulfillment_fee: 0,
      source: "estimate",
      confidence: "low",
    };
  } catch (error) {
    // Log error but return fallback
    console.error(`getFbaFees error for ASIN ${asin}:`, error);
    
    // Try category-based fallback if available
    if (category && price && price > 0) {
      return {
        ...estimateFeesByCategory(category, price),
        source: "estimate",
        confidence: "low",
      };
    }
    
    // Last resort: return zeros
    return {
      referral_fee: 0,
      fulfillment_fee: 0,
      source: "estimate",
      confidence: "low",
    };
  }
}

/**
 * Fetch fees from SP-API
 * 
 * @param asin - Amazon ASIN
 * @param price - Selling price (optional, uses default if not provided)
 * @returns Promise<{ referral_fee: number, fulfillment_fee: number } | null>
 */
async function fetchFeesFromSpApi(
  asin: string,
  price?: number | null
): Promise<{ referral_fee: number; fulfillment_fee: number } | null> {
  const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;
  
  // If credentials not configured, return null
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    return null;
  }
  
  try {
    // Get access token
    const accessToken = await getSpApiAccessToken();
    
    // Use US marketplace by default
    const marketplaceId = "ATVPDKIKX0DER";
    const endpoint = "https://sellingpartnerapi-na.amazon.com";
    const host = new URL(endpoint).hostname;
    const path = `/products/fees/v0/items/${asin}/feesEstimate`;
    
    // Use provided price or default fallback
    const estimatedPrice = price && price > 0 ? price : 25.0;
    
    // Prepare request body
    const requestBody = JSON.stringify({
      FeesEstimateRequest: {
        MarketplaceId: marketplaceId,
        IsAmazonFulfilled: true,
        PriceToEstimateFees: {
          ListingPrice: {
            Amount: estimatedPrice,
            CurrencyCode: "USD",
          },
          Shipping: {
            CurrencyCode: "USD",
            Amount: 0.00,
          },
          Points: {
            PointsNumber: 0,
            PointsMonetaryValue: {
              CurrencyCode: "USD",
              Amount: 0.00,
            },
          },
        },
        Identifier: `fees-estimate-${asin}-${Date.now()}`,
        OptionalFulfillmentProgram: "FBA_CORE",
      },
    });
    
    // Create SigV4 signed request
    const signedRequest = await createSignedRequest({
      method: "POST",
      host,
      path,
      body: requestBody,
      accessToken,
      awsAccessKeyId,
      awsSecretAccessKey,
      region: "us-east-1",
    });
    
    // Make request
    const response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: signedRequest.headers,
      body: requestBody,
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`SP-API fees fetch failed: ${response.status} ${errorText}`);
      return null;
    }
    
    const data = await response.json();
    
    // Extract fees from response
    const fees = extractFeesFromResponse(data);
    
    if (fees.referral_fee === null || fees.fulfillment_fee === null) {
      return null;
    }
    
    return {
      referral_fee: fees.referral_fee,
      fulfillment_fee: fees.fulfillment_fee,
    };
  } catch (error) {
    console.error("SP-API fetch error:", error);
    return null;
  }
}

/**
 * Extract referral fee and fulfillment fee from SP-API response
 */
function extractFeesFromResponse(data: any): {
  referral_fee: number | null;
  fulfillment_fee: number | null;
} {
  try {
    const feesEstimateResult = data?.FeesEstimateResult;
    if (!feesEstimateResult) {
      return { referral_fee: null, fulfillment_fee: null };
    }
    
    // Get FeesEstimate (may be array or single object)
    let feesEstimate;
    if (Array.isArray(feesEstimateResult)) {
      feesEstimate = feesEstimateResult[0]?.FeesEstimate;
    } else {
      feesEstimate = feesEstimateResult.FeesEstimate;
    }
    
    if (!feesEstimate) {
      return { referral_fee: null, fulfillment_fee: null };
    }
    
    // Extract individual fees from FeeDetailList
    let fulfillmentFee: number | null = null;
    let referralFee: number | null = null;
    
    const feeDetailList = feesEstimate.FeeDetailList || [];
    for (const feeDetail of feeDetailList) {
      const feeType = feeDetail.FeeType;
      const amount = feeDetail.FeeAmount?.Amount
        ? parseFloat(feeDetail.FeeAmount.Amount)
        : null;
      
      if (amount === null) continue;
      
      // Match FBA fulfillment fee
      if (
        (feeType === "FBAFulfillmentFee" || 
         feeType === "FBAPerOrderFulfillmentFee" ||
         feeType === "FBAFulfillmentFeePerUnit") &&
        fulfillmentFee === null
      ) {
        fulfillmentFee = amount;
      } else if (feeType === "ReferralFee" && referralFee === null) {
        referralFee = amount;
      }
    }
    
    return {
      referral_fee: referralFee,
      fulfillment_fee: fulfillmentFee,
    };
  } catch (error) {
    console.error("Error extracting fees from SP-API response:", error);
    return { referral_fee: null, fulfillment_fee: null };
  }
}

/**
 * Estimate fees based on category (fallback when SP-API fails)
 * 
 * Category-based heuristics:
 * - Referral fee: Typically 8-15% of price (varies by category)
 * - Fulfillment fee: Typically $2-5 for standard items
 */
function estimateFeesByCategory(
  category: string,
  price: number
): { referral_fee: number; fulfillment_fee: number } {
  const normalizedCategory = category.toLowerCase().trim();
  
  // Referral fee percentage by category
  let referralPercent: number;
  
  if (
    normalizedCategory.includes("electronics") ||
    normalizedCategory.includes("tech") ||
    normalizedCategory.includes("computer")
  ) {
    referralPercent = 8; // Electronics: 8%
  } else if (
    normalizedCategory.includes("beauty") ||
    normalizedCategory.includes("cosmetic") ||
    normalizedCategory.includes("skincare")
  ) {
    referralPercent = 8.5; // Beauty: 8.5%
  } else if (
    normalizedCategory.includes("home") ||
    normalizedCategory.includes("kitchen") ||
    normalizedCategory.includes("household")
  ) {
    referralPercent = 15; // Home goods: 15%
  } else if (
    normalizedCategory.includes("clothing") ||
    normalizedCategory.includes("apparel") ||
    normalizedCategory.includes("fashion")
  ) {
    referralPercent = 17; // Clothing: 17%
  } else {
    referralPercent = 15; // Default: 15%
  }
  
  const referralFee = (price * referralPercent) / 100;
  
  // Fulfillment fee: Base on price range
  let fulfillmentFee: number;
  if (price < 10) {
    fulfillmentFee = 2.0;
  } else if (price < 25) {
    fulfillmentFee = 3.0;
  } else if (price < 50) {
    fulfillmentFee = 4.0;
  } else {
    fulfillmentFee = 5.0;
  }
  
  return {
    referral_fee: Math.round(referralFee * 100) / 100, // Round to 2 decimals
    fulfillment_fee: Math.round(fulfillmentFee * 100) / 100,
  };
}

/**
 * Create AWS SigV4 signed request
 */
async function createSignedRequest({
  method,
  host,
  path,
  body,
  accessToken,
  awsAccessKeyId,
  awsSecretAccessKey,
  region,
}: {
  method: string;
  host: string;
  path: string;
  body: string;
  accessToken: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  region: string;
}): Promise<{ headers: Record<string, string> }> {
  const service = "execute-api";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substr(0, 8);
  
  // Step 1: Create canonical request
  const canonicalUri = path;
  const canonicalQueryString = "";
  const canonicalHeaders = [
    `content-type:application/json`,
    `host:${host}`,
    `x-amz-access-token:${accessToken}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");
  
  const signedHeaders = "content-type;host;x-amz-access-token;x-amz-date";
  const payloadHash = createHash("sha256").update(body).digest("hex");
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");
  
  // Step 2: Create string to sign
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = createHash("sha256")
    .update(canonicalRequest)
    .digest("hex");
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");
  
  // Step 3: Calculate signature
  const kDate = createHmac("sha256", `AWS4${awsSecretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  
  // Step 4: Create authorization header
  const authorization = `${algorithm} Credential=${awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  return {
    headers: {
      Host: host,
      "x-amz-access-token": accessToken,
      "x-amz-date": amzDate,
      Authorization: authorization,
      "Content-Type": "application/json",
    },
  };
}






