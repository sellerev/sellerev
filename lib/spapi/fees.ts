/**
 * SP-API FBA Fees Estimation
 * 
 * Fetches FBA fee estimates from Amazon SP-API using SigV4 signing.
 * Falls back gracefully if SP-API is unavailable.
 */

import { createHmac, createHash } from "crypto";
import { getSpApiAccessToken } from "./auth";

export interface FbaFeesEstimateResult {
  total_fee: number | null;
  source: "sp_api" | "estimated";
  asin_used: string;
  price_used: number;
}

/**
 * Get FBA fees estimate for an ASIN using Amazon SP-API
 * 
 * Required environment variables:
 * - SP_API_CLIENT_ID: LWA client ID
 * - SP_API_CLIENT_SECRET: LWA client secret
 * - SP_API_REFRESH_TOKEN: OAuth refresh token
 * - SP_API_AWS_ACCESS_KEY_ID: AWS access key for SigV4
 * - SP_API_AWS_SECRET_ACCESS_KEY: AWS secret key for SigV4
 * - SP_API_ROLE_ARN: IAM role ARN (if using role assumption)
 * 
 * @param params.asin - Amazon ASIN
 * @param params.price - Selling price in USD
 * @param params.marketplaceId - Marketplace ID (default: ATVPDKIKX0DER for US)
 * @returns Promise<FbaFeesEstimateResult>
 */
export async function getFbaFeesEstimateForAsin({
  asin,
  price,
  marketplaceId = "ATVPDKIKX0DER", // US marketplace
}: {
  asin: string;
  price: number;
  marketplaceId?: string;
}): Promise<FbaFeesEstimateResult> {
  const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;
  const roleArn = process.env.SP_API_ROLE_ARN;

  // If credentials not configured, return estimated fallback
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    return {
      total_fee: null,
      source: "estimated",
      asin_used: asin,
      price_used: price,
    };
  }

  try {
    // Get access token
    const accessToken = await getSpApiAccessToken();

    // Determine endpoint based on marketplace
    const endpoint = getEndpointForMarketplace(marketplaceId);
    const host = new URL(endpoint).hostname;
    const path = `/fees/v0/items/${asin}/feesEstimate`;

    // Prepare request body
    const requestBody = JSON.stringify({
      FeesEstimateRequest: {
        MarketplaceId: marketplaceId,
        PriceToEstimateFees: {
          ListingPrice: {
            Amount: price,
            CurrencyCode: "USD",
          },
        },
        Identifier: `fees-estimate-${asin}-${Date.now()}`,
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
      // Log error but don't throw - return estimated fallback
      console.error(`SP-API fees estimate failed: ${response.status} ${errorText}`);
      return {
        total_fee: null,
        source: "estimated",
        asin_used: asin,
        price_used: price,
      };
    }

    const data = await response.json();

    // Extract total fee from response
    // SP-API response structure: FeesEstimateResult.FeesEstimate.TotalFeesEstimate.Amount
    const totalFee = extractTotalFee(data);

    return {
      total_fee: totalFee,
      source: "sp_api",
      asin_used: asin,
      price_used: price,
    };
  } catch (error) {
    // Log error but don't throw - return estimated fallback
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`SP-API fees estimate error: ${errorMessage}`);
    return {
      total_fee: null,
      source: "estimated",
      asin_used: asin,
      price_used: price,
    };
  }
}

/**
 * Extract total fee from SP-API response
 */
function extractTotalFee(data: any): number | null {
  try {
    const feesEstimate =
      data?.FeesEstimateResult?.FeesEstimate?.TotalFeesEstimate;
    if (feesEstimate?.Amount) {
      return parseFloat(feesEstimate.Amount);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get SP-API endpoint for marketplace
 */
function getEndpointForMarketplace(marketplaceId: string): string {
  // Map marketplace IDs to endpoints
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
  // Map marketplace IDs to AWS regions
  const regionMap: Record<string, string> = {
    ATVPDKIKX0DER: "us-east-1", // US
    A1PA6795UKMFR9: "eu-west-1", // DE
    A1RKKUPIHCS9HS: "eu-west-1", // ES
    A13V1IB3VIYZZH: "eu-west-1", // FR
    APJ6JRA9NG5V4: "eu-west-1", // IT
    A1F83G8C2ARO7P: "eu-west-1", // UK
    A1VC38T7YXB528: "us-west-2", // JP (uses us-west-2)
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
