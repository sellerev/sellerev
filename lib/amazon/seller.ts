/**
 * Amazon Seller Information
 * 
 * Fetches seller storefront information from SP-API Sellers API v1.
 * Uses the marketplaceParticipations endpoint to get store name and marketplace data.
 */

import { getSpApiAccessToken } from "@/lib/spapi/auth";
import { createHash, createHmac } from "crypto";

interface MarketplaceParticipation {
  marketplace: {
    id: string;
    name: string;
    countryCode: string;
    domainName?: string;
  };
  participation: {
    isParticipating: boolean;
    hasSuspendedListings?: boolean;
  };
  storeName?: string; // Store name for this marketplace
}

interface MarketplaceParticipationsResponse {
  payload: MarketplaceParticipation[];
  storeName?: string; // Store name may be at root level
  errors?: Array<{
    code: string;
    message: string;
    details?: string;
  }>;
}

export interface SellerInfo {
  storeName: string;
  marketplaces: {
    marketplaceId: string;
    countryCode: string;
    domainName: string;
    isParticipating: boolean;
  }[];
  primaryMarketplace?: {
    marketplaceId: string;
    countryCode: string;
    domainName: string;
    name: string;
  };
}

/**
 * Get SP-API endpoint for marketplace
 * The Sellers API is available on all regional endpoints, but we'll use NA as default
 */
function getEndpointForMarketplace(marketplaceId?: string): { endpoint: string; host: string; region: string } {
  // For marketplaceParticipations, we can use any regional endpoint
  // The endpoint returns all marketplaces the seller participates in
  // Default to NA endpoint
  const defaultEndpoint = "https://sellingpartnerapi-na.amazon.com";
  const defaultHost = "sellingpartnerapi-na.amazon.com";
  const defaultRegion = "us-east-1";

  // If we have a marketplace ID, we could route to the appropriate endpoint
  // But since this endpoint returns all marketplaces, using NA is fine
  return {
    endpoint: defaultEndpoint,
    host: defaultHost,
    region: defaultRegion,
  };
}

/**
 * Create AWS SigV4 signed request for SP-API
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

/**
 * Get marketplace participations from SP-API
 * 
 * @param refreshToken - OAuth refresh token
 * @param userId - User ID for token caching (optional)
 * @param retryOnExpired - Whether to retry once if token is expired (default: true)
 * @returns Seller info with store name and marketplace data, or null if unavailable
 */
export async function getMarketplaceParticipations(
  refreshToken: string,
  userId?: string,
  retryOnExpired: boolean = true
): Promise<SellerInfo | null> {
  try {
    // Get access token
    let accessToken: string;
    try {
      accessToken = await getSpApiAccessToken({
        refreshToken,
        userId,
      });
    } catch (error) {
      // If token refresh fails and we haven't retried, try once more
      if (retryOnExpired && error instanceof Error && error.message.includes("token")) {
        console.log("Token refresh failed, retrying once...");
        // Clear cache and retry
        accessToken = await getSpApiAccessToken({
          refreshToken,
          userId,
        });
      } else {
        throw error;
      }
    }

    // Get AWS credentials
    const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      console.warn("AWS credentials not configured for seller info fetch");
      return null;
    }

    // Get endpoint configuration
    const { endpoint, host, region } = getEndpointForMarketplace();
    const path = "/sellers/v1/marketplaceParticipations";

    // Create signed request
    const { headers } = await createSignedRequest({
      method: "GET",
      host,
      path,
      queryString: "",
      body: "",
      accessToken,
      awsAccessKeyId,
      awsSecretAccessKey,
      region,
    });

    // Fetch marketplace participations
    const response = await fetch(`${endpoint}${path}`, {
      method: "GET",
      headers,
    });

    // Handle 401 (unauthorized) - token might be expired, retry once
    if (response.status === 401 && retryOnExpired) {
      console.log("Received 401, token may be expired. Retrying once with fresh token...");
      // Force a fresh token by calling getSpApiAccessToken again (cache will be checked/refreshed)
      // Pass retryOnExpired: false to prevent infinite retry loops
      return getMarketplaceParticipations(refreshToken, userId, false);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("Failed to fetch marketplace participations:", response.status, errorText);
      return null;
    }

    const data: MarketplaceParticipationsResponse = await response.json();

    return normalizeSellerInfo(data);
  } catch (error) {
    console.error("Error fetching marketplace participations:", error);
    return null;
  }
}

/**
 * Normalize seller info from API response
 */
function normalizeSellerInfo(data: MarketplaceParticipationsResponse): SellerInfo | null {
  // Handle errors in response
  if (data.errors && data.errors.length > 0) {
    console.warn("API returned errors:", data.errors);
    // Continue processing if we have payload, but log the errors
  }

  // Handle empty payload
  if (!data.payload || data.payload.length === 0) {
    console.warn("Marketplace participations response has no payload");
    return null;
  }

  // Filter to only participating marketplaces
  const participating = data.payload.filter((p) => p.participation.isParticipating);

  if (participating.length === 0) {
    console.warn("No participating marketplaces found");
    return null;
  }

  // Get preferred marketplace ID from env (if set)
  const preferredMarketplaceId = process.env.SP_API_MARKETPLACE_ID;

  // Find preferred marketplace or default to first participating
  let primaryMarketplace = participating.find(
    (p) => p.marketplace.id === preferredMarketplaceId
  );

  if (!primaryMarketplace) {
    primaryMarketplace = participating[0];
  }

  // Extract storeName - it may be at root level, participation level, or shared across all
  // Check root level first, then participation level, then fallback
  const storeName = data.storeName ||
                    primaryMarketplace.storeName || 
                    participating.find((p) => p.storeName)?.storeName ||
                    primaryMarketplace.marketplace.name || // Fallback to marketplace name
                    "Amazon Seller"; // Final fallback

  // Build normalized marketplaces array
  const marketplaces = participating.map((p) => ({
    marketplaceId: p.marketplace.id,
    countryCode: p.marketplace.countryCode,
    domainName: p.marketplace.domainName || p.marketplace.name,
    isParticipating: p.participation.isParticipating,
  }));

  return {
    storeName,
    marketplaces,
    primaryMarketplace: {
      marketplaceId: primaryMarketplace.marketplace.id,
      countryCode: primaryMarketplace.marketplace.countryCode,
      domainName: primaryMarketplace.marketplace.domainName || primaryMarketplace.marketplace.name,
      name: primaryMarketplace.marketplace.name,
    },
  };
}

