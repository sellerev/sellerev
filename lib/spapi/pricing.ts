/**
 * SP-API Pricing API Integration
 * 
 * Fetches pricing data (Buy Box owner, offer count, fulfillment channel) from SP-API Pricing API.
 * Uses GetItemOffers and GetPricing endpoints.
 * 
 * Required environment variables:
 * - SP_API_CLIENT_ID
 * - SP_API_CLIENT_SECRET
 * - SP_API_REFRESH_TOKEN
 * - SP_API_AWS_ACCESS_KEY_ID
 * - SP_API_AWS_SECRET_ACCESS_KEY
 */

import { createHmac, createHash } from "crypto";
import { getSpApiAccessToken } from "./auth";
import { logSpApiEvent, extractSpApiHeaders } from "./logging";

export interface PricingMetadata {
  asin: string;
  buy_box_owner: "Amazon" | "Merchant" | "Unknown" | null;
  offer_count: number | null;
  fulfillment_channel: "FBA" | "FBM" | null;
  lowest_price: number | null;
  buy_box_price: number | null;
}

export interface BatchPricingResult {
  enriched: Map<string, PricingMetadata>;
  failed: string[];
  errors: Array<{ asin: string; error: string }>;
}

/**
 * Batch fetch pricing data for ASINs
 * 
 * @param asins - Array of ASINs to enrich (max 20 per batch)
 * @param marketplaceId - Marketplace ID (default: ATVPDKIKX0DER for US)
 * @param timeoutMs - Request timeout in milliseconds (default: 2000)
 * @param keyword - Optional keyword for logging
 * @param userId - Optional user ID to use per-user refresh token
 * @returns Promise<BatchPricingResult> Pricing results with metadata map
 */
export async function batchEnrichPricing(
  asins: string[],
  marketplaceId: string = "ATVPDKIKX0DER",
  timeoutMs: number = 2000,
  keyword?: string,
  userId?: string
): Promise<BatchPricingResult> {
  const result: BatchPricingResult = {
    enriched: new Map(),
    failed: [],
    errors: [],
  };

  if (!asins || asins.length === 0) {
    return result;
  }

  // Check credentials
  const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;

  if (!awsAccessKeyId || !awsSecretAccessKey) {
    console.warn("SP-API credentials not configured, skipping pricing enrichment");
    result.failed = [...asins];
    return result;
  }

  // FEATURE FLAG: Pricing API requires seller OAuth token
  // Skip Pricing API calls unless seller OAuth token is present
  // Developer tokens (env SP_API_REFRESH_TOKEN) will get 403 Unauthorized
  // CRITICAL: Return early - do NOT proceed to API calls if no OAuth
  let sellerOAuthToken: string | null = null;
  if (userId) {
    try {
      const { getUserAmazonRefreshToken } = await import("@/lib/amazon/getUserToken");
      sellerOAuthToken = await getUserAmazonRefreshToken(userId);
    } catch (error) {
      // User hasn't connected - no seller OAuth token available
      // CRITICAL: Return early - do NOT proceed to pricing API calls
      console.log("ℹ️ PRICING_API_SKIPPED_NO_OAUTH", {
        keyword: keyword || 'unknown',
        user_id: userId.substring(0, 8) + "...",
        message: "Pricing API requires seller OAuth token - skipping (will use Rainforest fallback)",
        timestamp: new Date().toISOString(),
      });
      result.failed = [...asins];
      result.errors = []; // Explicitly mark no errors - this is an intentional skip
      return result; // EARLY RETURN - pricing code below will NOT execute
    }
  }

  if (!sellerOAuthToken) {
    // CRITICAL: Return early - do NOT proceed to pricing API calls
    console.log("ℹ️ PRICING_API_SKIPPED_NO_OAUTH", {
      keyword: keyword || 'unknown',
      message: "Pricing API requires seller OAuth token - no userId or token found, skipping (will use Rainforest fallback)",
      timestamp: new Date().toISOString(),
    });
    result.failed = [...asins];
    result.errors = []; // Explicitly mark no errors - this is an intentional skip
    return result; // EARLY RETURN - pricing code below will NOT execute
  }

  // Batch ASINs into groups of 20 (SP-API hard limit)
  const batchSize = 20; // SP-API maximum batch size
  const batches: string[][] = [];
  const batchSizes: number[] = [];
  for (let i = 0; i < asins.length; i += batchSize) {
    const batch = asins.slice(i, i + batchSize);
    batches.push(batch);
    batchSizes.push(batch.length);
  }

  const totalBatches = batches.length;
  const totalStartTime = Date.now();

  // Execute batches in parallel with timeout
  const batchPromises = batches.map((batch, batchIndex) =>
    fetchPricingBatchWithTimeout(batch, marketplaceId, timeoutMs, awsAccessKeyId, awsSecretAccessKey, batchIndex, totalBatches, keyword, userId)
  );

  const batchResults = await Promise.allSettled(batchPromises);

  // Aggregate results
  for (let i = 0; i < batchResults.length; i++) {
    const batchResult = batchResults[i];
    const batch = batches[i];

    if (batchResult.status === "fulfilled") {
      const batchData = batchResult.value;
      for (const [asin, metadata] of batchData.entries()) {
        result.enriched.set(asin, metadata);
      }
    } else {
      // Mark all ASINs in failed batch as failed
      for (const asin of batch) {
        result.failed.push(asin);
        result.errors.push({
          asin,
          error: batchResult.reason?.message || "Batch request failed",
        });
      }
    }
  }

  // Mark any ASINs not in enriched map as failed
  for (const asin of asins) {
    if (!result.enriched.has(asin) && !result.failed.includes(asin)) {
      result.failed.push(asin);
    }
  }

  // Emit batch summary log
  const totalDuration = Date.now() - totalStartTime;
  const avgDuration = totalBatches > 0 ? Math.round(totalDuration / totalBatches) : 0;
  
  console.log('SP_API_BATCH_COMPLETE', {
    endpoint_name: 'pricing',
    total_asins: asins.length,
    total_batches: totalBatches,
    batch_sizes: batchSizes,
    enriched_count: result.enriched.size,
    failed_count: result.failed.length,
    total_duration_ms: totalDuration,
    avg_duration_ms: avgDuration,
    timestamp: new Date().toISOString(),
  });

  return result;
}

/**
 * Fetch a batch of ASINs with timeout
 */
async function fetchPricingBatchWithTimeout(
  asins: string[],
  marketplaceId: string,
  timeoutMs: number,
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  batchIndex: number,
  totalBatches: number,
  keyword?: string,
  userId?: string
): Promise<Map<string, PricingMetadata>> {
  const timeoutPromise = new Promise<Map<string, PricingMetadata>>((_, reject) => {
    setTimeout(() => reject(new Error("SP-API pricing batch request timeout")), timeoutMs);
  });

  const fetchPromise = fetchPricingBatch(asins, marketplaceId, awsAccessKeyId, awsSecretAccessKey, batchIndex, totalBatches, keyword, userId);

  return Promise.race([fetchPromise, timeoutPromise]);
}

/**
 * Fetch pricing data for a single batch of ASINs
 */
async function fetchPricingBatch(
  asins: string[],
  marketplaceId: string,
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  batchIndex: number,
  totalBatches: number,
  keyword?: string,
  userId?: string
): Promise<Map<string, PricingMetadata>> {
  const result = new Map<string, PricingMetadata>();

  try {
    // Get seller OAuth refresh token (already verified in batchEnrichPricing)
    // NOTE: Pricing API requires seller OAuth per Amazon's API design
    // Feature flag check ensures we only call this if seller OAuth token exists
    let refreshToken: string | undefined;
    if (userId) {
      try {
        const { getUserAmazonRefreshToken } = await import("@/lib/amazon/getUserToken");
        refreshToken = await getUserAmazonRefreshToken(userId) || undefined;
        if (refreshToken) {
          console.log("✅ Using user's Amazon refresh token for Pricing API", {
            user_id: userId.substring(0, 8) + "...",
            token_last4: refreshToken.substring(refreshToken.length - 4),
            keyword: keyword || 'unknown',
          });
        } else {
          // This shouldn't happen if feature flag worked, but handle gracefully
          console.warn("⚠️ Seller OAuth token not found for Pricing API, skipping batch", {
            user_id: userId.substring(0, 8) + "...",
            keyword: keyword || 'unknown',
          });
          return result; // Return empty result, will fallback to Rainforest data
        }
      } catch (error) {
        console.warn("Failed to get seller OAuth token for Pricing API, skipping batch:", error);
        return result; // Return empty result, will fallback to Rainforest data
      }
    } else {
      // This shouldn't happen if feature flag worked, but handle gracefully
      console.warn("⚠️ No userId provided to Pricing API, skipping batch", {
        keyword: keyword || 'unknown',
      });
      return result; // Return empty result, will fallback to Rainforest data
    }

    if (!refreshToken) {
      // This shouldn't happen if feature flag worked, but handle gracefully
      console.warn("No seller OAuth token available for Pricing API, skipping batch");
      return result; // Return empty result, will fallback to Rainforest data
    }

    const accessToken = await getSpApiAccessToken(
      refreshToken ? { refreshToken, userId } : undefined
    );
    const endpoint = getEndpointForMarketplace(marketplaceId);
    const host = new URL(endpoint).hostname;
    const region = getRegionForMarketplace(marketplaceId);

    // Use GetItemOffers for each ASIN (more reliable than GetPricing for buy box data)
    const pricingPromises = asins.map((asin) =>
      fetchItemOffers(asin, marketplaceId, endpoint, host, region, accessToken, awsAccessKeyId, awsSecretAccessKey, batchIndex, totalBatches, keyword)
    );

    const pricingResults = await Promise.allSettled(pricingPromises);

    for (let i = 0; i < pricingResults.length; i++) {
      const pricingResult = pricingResults[i];
      const asin = asins[i];

      if (pricingResult.status === "fulfilled" && pricingResult.value) {
        result.set(asin, pricingResult.value);
      }
    }
  } catch (error) {
    logSpApiEvent({
      event_type: 'SP_API_ERROR',
      endpoint_name: 'pricing',
      api_version: 'v0',
      method: 'GET',
      path: '/pricing/v0/items/{asin}/offers',
      marketplace_id: marketplaceId,
      asin_count: asins.length,
      error: error instanceof Error ? error.message : String(error),
      batch_index: batchIndex,
      total_batches: totalBatches,
    });
  }

  return result;
}

/**
 * Fetch item offers for a single ASIN using GetItemOffers
 */
async function fetchItemOffers(
  asin: string,
  marketplaceId: string,
  endpoint: string,
  host: string,
  region: string,
  accessToken: string,
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  batchIndex: number,
  totalBatches: number,
  keyword?: string
): Promise<PricingMetadata | null> {
  const path = `/pricing/v0/items/${asin}/offers`;
  const startTime = Date.now();

  // Build query parameters
  const params = new URLSearchParams();
  params.set("MarketplaceId", marketplaceId);
  params.set("ItemCondition", "New");
  params.set("CustomerType", "Consumer");
  const queryString = params.toString();

  try {
    // REQUIRED LOG: SP_API_PRICING_REQUEST_SENT
    console.log('SP_API_PRICING_REQUEST_SENT', {
      keyword: keyword || 'unknown',
      asins: [asin],
      batch_index: batchIndex,
      http_status: null, // Not available yet
      x_amzn_requestid: null, // Not available yet
      x_amzn_ratelimit_limit: null, // Not available yet
      duration_ms: null, // Not available yet
      timestamp: new Date().toISOString(),
    });
    
    // Log request
    logSpApiEvent({
      event_type: 'SP_API_REQUEST',
      endpoint_name: 'pricing',
      api_version: 'v0',
      method: 'GET',
      path,
      query_params: queryString,
      marketplace_id: marketplaceId,
      asin_count: 1,
      asins: [asin],
      batch_index: batchIndex,
      total_batches: totalBatches,
    });

    const signedRequest = await createSignedRequest({
      method: "GET",
      host,
      path,
      queryString,
      body: "",
      accessToken,
      awsAccessKeyId,
      awsSecretAccessKey,
      region,
    });

    const response = await fetch(`${endpoint}${path}?${queryString}`, {
      method: "GET",
      headers: signedRequest.headers,
    });

    const duration = Date.now() - startTime;
    const headers = extractSpApiHeaders(response.headers);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      
      // Log error with specific handling for 403 (permission denied)
      const isPermissionError = response.status === 403;
      logSpApiEvent({
        event_type: 'SP_API_ERROR',
        endpoint_name: 'pricing',
        api_version: 'v0',
        method: 'GET',
        path,
        query_params: queryString,
        marketplace_id: marketplaceId,
        asin_count: 1,
        http_status: response.status,
        duration_ms: duration,
        request_id: headers.request_id,
        rate_limit_limit: headers.rate_limit_limit,
        rate_limit_remaining: headers.rate_limit_remaining,
        error: errorText.substring(0, 500),
        batch_index: batchIndex,
        total_batches: totalBatches,
      });
      
      // Log specific message for 403 errors (permission issue)
      // Note: With feature flag, this should rarely happen (we skip if no seller OAuth)
      // But handle gracefully if it does occur
      if (isPermissionError) {
        console.error("❌ SP_API_PRICING_PERMISSION_DENIED", {
          asin,
          marketplace_id: marketplaceId,
          keyword: keyword || 'unknown',
          message: "Pricing API returned 403 - seller OAuth token may lack Pricing API permissions",
          suggestion: "Verify seller has granted Pricing API access during OAuth consent",
        });
      }
      
      return null;
    }

    const data = await response.json();

    // REQUIRED LOG: SP_API_PRICING_RESPONSE_RECEIVED
    console.log('SP_API_PRICING_RESPONSE_RECEIVED', {
      keyword: keyword || 'unknown',
      asins: [asin],
      batch_index: batchIndex,
      http_status: response.status,
      x_amzn_requestid: headers.request_id,
      x_amzn_ratelimit_limit: headers.rate_limit_limit,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    });

    // Log successful response
    logSpApiEvent({
      event_type: 'SP_API_RESPONSE',
      endpoint_name: 'pricing',
      api_version: 'v0',
      method: 'GET',
      path,
      query_params: queryString,
      marketplace_id: marketplaceId,
      asin_count: 1,
      http_status: response.status,
      duration_ms: duration,
      request_id: headers.request_id,
      rate_limit_limit: headers.rate_limit_limit,
      rate_limit_remaining: headers.rate_limit_remaining,
      batch_index: batchIndex,
      total_batches: totalBatches,
    });

    // Parse response
    const summary = data?.Summary || data?.payload?.Summary || null;
    const offers = data?.Offers || data?.payload?.Offers || [];

    if (!summary) {
      return null;
    }

    // Extract Buy Box owner
    let buyBoxOwner: "Amazon" | "Merchant" | "Unknown" | null = null;
    const buyBoxWinner = summary.BuyBoxPrices?.[0] || summary.LowestPrices?.[0];
    if (buyBoxWinner) {
      const sellerType = buyBoxWinner.LandedPrice?.ListingPrice?.CurrencyCode 
        ? (buyBoxWinner.sellerId === "ATVPDKIKX0DER" ? "Amazon" : "Merchant")
        : null;
      buyBoxOwner = sellerType || "Unknown";
    }

    // Extract offer count
    const offerCount = summary.TotalOfferCount || offers.length || null;

    // Extract fulfillment channel from Buy Box winner or lowest price
    let fulfillmentChannel: "FBA" | "FBM" | null = null;
    if (buyBoxWinner) {
      const fulfillment = buyBoxWinner.FulfillmentChannel || buyBoxWinner.fulfillmentChannel;
      if (fulfillment === "Amazon" || fulfillment === "FBA") {
        fulfillmentChannel = "FBA";
      } else if (fulfillment === "Merchant" || fulfillment === "FBM") {
        fulfillmentChannel = "FBM";
      }
    }

    // Extract prices
    const buyBoxPrice = buyBoxWinner?.LandedPrice?.Amount 
      ? parseFloat(buyBoxWinner.LandedPrice.Amount)
      : null;
    
    const lowestPrice = summary.LowestPrices?.[0]?.LandedPrice?.Amount
      ? parseFloat(summary.LowestPrices[0].LandedPrice.Amount)
      : buyBoxPrice;

    return {
      asin,
      buy_box_owner: buyBoxOwner,
      offer_count: offerCount,
      fulfillment_channel: fulfillmentChannel,
      lowest_price: lowestPrice,
      buy_box_price: buyBoxPrice,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Log error
    logSpApiEvent({
      event_type: 'SP_API_ERROR',
      endpoint_name: 'pricing',
      api_version: 'v0',
      method: 'GET',
      path,
      marketplace_id: marketplaceId,
      asin_count: 1,
      duration_ms: duration,
      error: error instanceof Error ? error.message : String(error),
      batch_index: batchIndex,
      total_batches: totalBatches,
    });
    
    return null;
  }
}

/**
 * Get SP-API endpoint for marketplace
 */
function getEndpointForMarketplace(marketplaceId: string): string {
  const endpointMap: Record<string, string> = {
    ATVPDKIKX0DER: "https://sellingpartnerapi-na.amazon.com", // US
    A1PA6795UKMFR9: "https://sellingpartnerapi-eu.amazon.com", // DE
    A1RKKUPIHCS9HS: "https://sellingpartnerapi-eu.amazon.com", // ES
    A13V1IB3VIYZZH: "https://sellingpartnerapi-eu.amazon.com", // FR
    APJ6JRA9NG5V4: "https://sellingpartnerapi-eu.amazon.com", // IT
    A1F83G8C2ARO7P: "https://sellingpartnerapi-eu.amazon.com", // UK
    A1VC38T7YXB528: "https://sellingpartnerapi-fe.amazon.com", // JP
    A19VAU5U5O7RUS: "https://sellingpartnerapi-fe.amazon.com", // CA
  };

  return endpointMap[marketplaceId] || "https://sellingpartnerapi-na.amazon.com";
}

/**
 * Get AWS region for marketplace
 */
function getRegionForMarketplace(marketplaceId: string): string {
  const regionMap: Record<string, string> = {
    ATVPDKIKX0DER: "us-east-1", // US
    A1PA6795UKMFR9: "eu-west-1", // DE
    A1RKKUPIHCS9HS: "eu-west-1", // ES
    A13V1IB3VIYZZH: "eu-west-1", // FR
    APJ6JRA9NG5V4: "eu-west-1", // IT
    A1F83G8C2ARO7P: "eu-west-1", // UK
    A1VC38T7YXB528: "us-west-2", // JP
    A19VAU5U5O7RUS: "us-east-1", // CA
  };

  return regionMap[marketplaceId] || "us-east-1";
}

/**
 * Create AWS SigV4 signed request
 */
async function createSignedRequest({
  method,
  host,
  path,
  queryString,
  body,
  accessToken,
  awsAccessKeyId,
  awsSecretAccessKey,
  region,
}: {
  method: string;
  host: string;
  path: string;
  queryString: string;
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
  const canonicalQueryString = queryString || "";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-access-token:${accessToken}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");

  const signedHeaders = "host;x-amz-access-token;x-amz-date";
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
  const stringToSign = [algorithm, amzDate, credentialScope, canonicalRequestHash].join("\n");

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
    },
  };
}

