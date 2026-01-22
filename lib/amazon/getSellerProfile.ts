/**
 * Fetch seller account profile from SP-API
 * 
 * Uses the /sellers/v1/marketplaceParticipations endpoint to get seller account information.
 * This endpoint returns marketplace IDs and participation status.
 * 
 * Note: Seller display name is not directly available from this endpoint.
 * We'll use marketplace info for now, and can enhance with seller_id later if needed.
 */

import { getSpApiAccessToken } from "@/lib/spapi/auth";
import { createHash, createHmac } from "crypto";

interface MarketplaceParticipation {
  marketplace: {
    id: string;
    name: string;
    countryCode: string;
  };
  participation: {
    isParticipating: boolean;
    hasSuspendedListings: boolean;
  };
}

interface SellerProfileResponse {
  payload: MarketplaceParticipation[];
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
 * Fetch seller profile from SP-API
 * 
 * @param refreshToken - OAuth refresh token
 * @param userId - User ID for token caching
 * @returns Seller display name and marketplace IDs, or null if unavailable
 */
export async function getSellerProfile(
  refreshToken: string,
  userId?: string
): Promise<{ sellerDisplayName: string | null; marketplaceIds: string[] } | null> {
  try {
    // Get access token
    const accessToken = await getSpApiAccessToken({
      refreshToken,
      userId,
    });

    // Get AWS credentials
    const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      console.warn("AWS credentials not configured for seller profile fetch");
      return null;
    }

    // Use US marketplace endpoint (default)
    const endpoint = "https://sellingpartnerapi-na.amazon.com";
    const host = "sellingpartnerapi-na.amazon.com";
    const path = "/sellers/v1/marketplaceParticipations";
    const region = "us-east-1";

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

    // Fetch seller profile
    const response = await fetch(`${endpoint}${path}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("Failed to fetch seller profile:", response.status, errorText);
      return null;
    }

    const data: SellerProfileResponse = await response.json();

    if (!data.payload || data.payload.length === 0) {
      console.warn("Seller profile response has no marketplace participations");
      return null;
    }

    // Extract marketplace IDs
    const marketplaceIds = data.payload
      .filter((p) => p.participation.isParticipating)
      .map((p) => p.marketplace.id);

    // For seller display name, we'll construct a friendly name from marketplace info
    // The marketplaceParticipations endpoint doesn't return a storefront name directly
    // We'll use the first participating marketplace name as a display identifier
    const firstMarketplace = data.payload.find((p) => p.participation.isParticipating);
    const sellerDisplayName = firstMarketplace?.marketplace?.name 
      ? `${firstMarketplace.marketplace.name} Seller` 
      : null;

    return {
      sellerDisplayName,
      marketplaceIds,
    };
  } catch (error) {
    console.error("Error fetching seller profile:", error);
    return null;
  }
}

