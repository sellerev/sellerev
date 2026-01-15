/**
 * SP-API FBA Fees Fetching
 * 
 * Fetches detailed Amazon FBA fulfillment fees for a given ASIN using SP-API.
 * Uses GetMyFeesEstimateForASIN endpoint to get fulfillment_fee and referral_fee separately.
 * 
 * Gracefully returns nulls if fee API fails - does not throw on partial failures.
 */

import { createHmac, createHash } from "crypto";
import { getSpApiAccessToken } from "./auth";

export interface FbaFeesResult {
  fulfillment_fee: number | null;
  referral_fee: number | null;
  total_fba_fees: number | null;
  currency: "USD";
  // Optional debug metadata to help distinguish auth vs throttling vs other failures
  debug?: {
    http_status?: number;
    request_id?: string | null;
    rate_limit?: string | null;
  };
}

/**
 * Get FBA fees for an ASIN using Amazon SP-API
 * 
 * Uses GetMyFeesEstimateForASIN endpoint which provides detailed fee breakdown.
 * 
 * Required environment variables:
 * - SP_API_CLIENT_ID: LWA client ID
 * - SP_API_CLIENT_SECRET: LWA client secret
 * - SP_API_REFRESH_TOKEN: OAuth refresh token
 * - SP_API_AWS_ACCESS_KEY_ID: AWS access key for SigV4
 * - SP_API_AWS_SECRET_ACCESS_KEY: AWS secret key for SigV4
 * 
 * @param params.asin - Amazon ASIN
 * @param params.price - Selling price in USD (use avg page 1 price)
 * @param params.marketplaceId - Marketplace ID (default: ATVPDKIKX0DER for US)
 * @returns Promise<FbaFeesResult> Normalized fee breakdown
 */
export async function getFbaFees({
  asin,
  price,
  marketplaceId = "ATVPDKIKX0DER", // US marketplace
}: {
  asin: string;
  price: number;
  marketplaceId?: string;
}): Promise<FbaFeesResult> {
  const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;

  // If credentials not configured, return nulls gracefully
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    return {
      fulfillment_fee: null,
      referral_fee: null,
      total_fba_fees: null,
      currency: "USD",
    };
  }

  try {
    // Get access token
    const accessToken = await getSpApiAccessToken();

    // Determine endpoint based on marketplace
    const endpoint = getEndpointForMarketplace(marketplaceId);
    const host = new URL(endpoint).hostname;
    // Correct endpoint path for FBA fees (matches FBA calculator)
    const path = `/products/fees/v0/items/${asin}/feesEstimate`;

    // Prepare request body (matches FBA calculator format)
    const requestBody = JSON.stringify({
      FeesEstimateRequest: {
        MarketplaceId: marketplaceId,
        IsAmazonFulfilled: true, // CRITICAL: Must be true for FBA fees
        PriceToEstimateFees: {
          ListingPrice: {
            Amount: price,
            CurrencyCode: "USD",
          },
          Shipping: {
            CurrencyCode: "USD",
            Amount: 0.00, // Default shipping (can be adjusted if needed)
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
        OptionalFulfillmentProgram: "FBA_CORE", // Specify FBA Core program
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
      region: getRegionForMarketplace(marketplaceId),
    });

    // Make request
    const response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: signedRequest.headers,
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      // Log error but don't throw - return nulls gracefully
      const requestId =
        response.headers.get("x-amzn-requestid") ||
        response.headers.get("x-amz-request-id") ||
        response.headers.get("x-amzn-RequestId") ||
        null;
      const rateLimit =
        response.headers.get("x-amzn-ratelimit-limit") ||
        response.headers.get("x-amzn-RateLimit-Limit") ||
        null;
      console.error("SP-API getFbaFees failed", {
        status: response.status,
        requestId,
        rateLimit,
        body: errorText,
      });
      return {
        fulfillment_fee: null,
        referral_fee: null,
        total_fba_fees: null,
        currency: "USD",
        debug: { http_status: response.status, request_id: requestId, rate_limit: rateLimit },
      };
    }

    const data = await response.json();

    // Extract fees from response
    const fees = extractFees(data);

    return {
      fulfillment_fee: fees.fulfillmentFee,
      referral_fee: fees.referralFee,
      total_fba_fees: fees.totalFee,
      currency: "USD",
    };
  } catch (error) {
    // Log error but don't throw - return nulls gracefully
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`SP-API getFbaFees error: ${errorMessage}`);
    return {
      fulfillment_fee: null,
      referral_fee: null,
      total_fba_fees: null,
      currency: "USD",
    };
  }
}

/**
 * Extract fulfillment fee, referral fee, and total fee from SP-API response
 * 
 * SP-API response structure (for FBA fees):
 * FeesEstimateResult.FeesEstimate.FeeDetailList[] contains individual fee breakdowns
 * - FeeType: "FBAFulfillmentFee" -> fulfillment_fee
 * - FeeType: "ReferralFee" -> referral_fee
 * - FeeType: "VariableClosingFee" -> may be included
 * - TotalFeesEstimate.Amount -> total_fba_fees
 * 
 * Note: Response may have multiple entries (one per fulfillment program).
 * We use the first valid FeesEstimate.
 */
function extractFees(data: any): {
  fulfillmentFee: number | null;
  referralFee: number | null;
  totalFee: number | null;
} {
  try {
    // Handle array response (multiple fulfillment programs)
    const feesEstimateResult = data?.FeesEstimateResult;
    if (!feesEstimateResult) {
      return {
        fulfillmentFee: null,
        referralFee: null,
        totalFee: null,
      };
    }

    // Get FeesEstimate (may be array or single object)
    let feesEstimate;
    if (Array.isArray(feesEstimateResult)) {
      // Multiple estimates - use first one
      feesEstimate = feesEstimateResult[0]?.FeesEstimate;
    } else {
      feesEstimate = feesEstimateResult.FeesEstimate;
    }

    if (!feesEstimate) {
      return {
        fulfillmentFee: null,
        referralFee: null,
        totalFee: null,
      };
    }

    // Extract total fee
    const totalFee = feesEstimate.TotalFeesEstimate?.Amount
      ? parseFloat(feesEstimate.TotalFeesEstimate.Amount)
      : null;

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

      // Match FBA fulfillment fee (may have variations)
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
      fulfillmentFee,
      referralFee,
      totalFee,
    };
  } catch (error) {
    console.error("Error extracting fees from SP-API response:", error);
    return {
      fulfillmentFee: null,
      referralFee: null,
      totalFee: null,
    };
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












