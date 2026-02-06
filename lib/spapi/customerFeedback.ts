/**
 * SP-API Customer Feedback API (Brand Analytics role)
 *
 * getItemReviewTrends: positive and negative review topics with 6-month trend metrics.
 * https://developer-docs.amazon.com/sp-api/docs/customer-feedback-api-v2024-06-01-reference
 */

import { createHmac, createHash } from "crypto";
import { getSpApiAccessToken } from "./auth";

const CUSTOMER_FEEDBACK_VERSION = "2024-06-01";

export interface ReviewTopicTrendMetric {
  startDate: string;
  endDate: string;
  /** Topic prevalence or metric value for this period (if provided by API). */
  value?: number | null;
}

export interface ReviewTopic {
  topic: string;
  trendMetrics: ReviewTopicTrendMetric[];
}

export interface ItemReviewTrendsResult {
  asin: string;
  itemName: string | null;
  marketplaceId: string;
  countryCode: string | null;
  dateRange: { startDate: string; endDate: string } | null;
  positiveTopics: ReviewTopic[];
  negativeTopics: ReviewTopic[];
  /** Raw payload for debugging; omit in production if large. */
  _raw?: unknown;
}

/**
 * Get endpoint base URL for an SP-API marketplace.
 */
function getEndpointForMarketplace(marketplaceId: string): string {
  const endpointMap: Record<string, string> = {
    ATVPDKIKX0DER: "https://sellingpartnerapi-na.amazon.com",
    A1PA6795UKMFR9: "https://sellingpartnerapi-eu.amazon.com",
    A1RKKUPIHCS9HS: "https://sellingpartnerapi-eu.amazon.com",
    A13V1IB3VIYZZH: "https://sellingpartnerapi-eu.amazon.com",
    APJ6JRA9NG5V4: "https://sellingpartnerapi-eu.amazon.com",
    A1F83G8C2ARO7P: "https://sellingpartnerapi-eu.amazon.com",
    A1VC38T7YXB528: "https://sellingpartnerapi-fe.amazon.com",
    A19VAU5U5O7RUS: "https://sellingpartnerapi-na.amazon.com",
  };
  return endpointMap[marketplaceId] || "https://sellingpartnerapi-na.amazon.com";
}

/**
 * Get AWS region for SigV4 for an SP-API marketplace.
 */
function getRegionForMarketplace(marketplaceId: string): string {
  const regionMap: Record<string, string> = {
    ATVPDKIKX0DER: "us-east-1",
    A1PA6795UKMFR9: "eu-west-1",
    A1RKKUPIHCS9HS: "eu-west-1",
    A13V1IB3VIYZZH: "eu-west-1",
    APJ6JRA9NG5V4: "eu-west-1",
    A1F83G8C2ARO7P: "eu-west-1",
    A1VC38T7YXB528: "us-west-2",
    A19VAU5U5O7RUS: "us-east-1",
  };
  return regionMap[marketplaceId] || "us-east-1";
}

/**
 * Create AWS SigV4 signed headers for SP-API (GET with empty body).
 */
async function createSignedRequest({
  method,
  host,
  path,
  queryString,
  accessToken,
  awsAccessKeyId,
  awsSecretAccessKey,
  region,
}: {
  method: string;
  host: string;
  path: string;
  queryString: string;
  accessToken: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  region: string;
}): Promise<{ headers: Record<string, string> }> {
  const service = "execute-api";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const body = "";
  const payloadHash = createHash("sha256").update(body).digest("hex");

  const canonicalUri = path;
  const canonicalQueryString = (queryString || "").trim();
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-access-token:${accessToken}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");
  const signedHeaders = "host;x-amz-access-token;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    "",
    signedHeaders,
    payloadHash,
  ].join("\n");

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

  const kDate = createHmac("sha256", `AWS4${awsSecretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
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

function normalizeTopics(arr: unknown): ReviewTopic[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((item: any) => {
    const topic = typeof item?.topic === "string" ? item.topic : "";
    const trendMetrics: ReviewTopicTrendMetric[] = [];
    const raw = item?.trendMetrics;
    if (Array.isArray(raw)) {
      for (const m of raw) {
        const dr = m?.dateRange;
        trendMetrics.push({
          startDate: typeof dr?.startDate === "string" ? dr.startDate : "",
          endDate: typeof dr?.endDate === "string" ? dr.endDate : "",
          value: typeof m?.asinMetrics?.percentageOfReviews === "number"
            ? m.asinMetrics.percentageOfReviews
            : undefined,
        });
      }
    }
    return { topic, trendMetrics };
  });
}

/**
 * Retrieve an item's positive and negative review trends for the past six months.
 * Requires SP-API Brand Analytics (Customer Feedback) role and user's Amazon connection.
 *
 * @param asin - Child ASIN (10 chars)
 * @param marketplaceId - e.g. ATVPDKIKX0DER for US
 * @param userId - Required: use this user's refresh token (Brand Analytics is per-seller)
 */
export async function getItemReviewTrends(
  asin: string,
  marketplaceId: string = "ATVPDKIKX0DER",
  userId?: string
): Promise<ItemReviewTrendsResult | null> {
  const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;

  if (!awsAccessKeyId || !awsSecretAccessKey) {
    console.warn("SP-API AWS credentials not configured, skipping getItemReviewTrends");
    return null;
  }

  let refreshToken: string | undefined;
  if (userId) {
    try {
      const { getUserAmazonRefreshToken } = await import("@/lib/amazon/getUserToken");
      refreshToken = (await getUserAmazonRefreshToken(userId)) ?? undefined;
    } catch (e) {
      console.warn("getItemReviewTrends: failed to get user refresh token", e);
    }
    if (!refreshToken) {
      console.warn("getItemReviewTrends: no Amazon connection for user");
      return null;
    }
  }

  const normalizedAsin = asin.trim().toUpperCase();
  if (normalizedAsin.length !== 10) {
    console.warn("getItemReviewTrends: invalid ASIN length", { asin: normalizedAsin });
    return null;
  }

  try {
    const accessToken = await getSpApiAccessToken(
      refreshToken ? { refreshToken, userId } : undefined
    );
    const endpoint = getEndpointForMarketplace(marketplaceId);
    const host = new URL(endpoint).hostname;
    const region = getRegionForMarketplace(marketplaceId);

    const path = `/customerFeedback/${CUSTOMER_FEEDBACK_VERSION}/items/${normalizedAsin}/reviews/trends`;
    const queryString = `marketplaceId=${encodeURIComponent(marketplaceId)}`;

    const signed = await createSignedRequest({
      method: "GET",
      host,
      path,
      queryString,
      accessToken,
      awsAccessKeyId,
      awsSecretAccessKey,
      region,
    });

    const url = `${endpoint}${path}?${queryString}`;
    const response = await fetch(url, {
      method: "GET",
      headers: signed.headers,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      console.error("SP-API getItemReviewTrends failed", {
        status: response.status,
        asin: normalizedAsin,
        marketplaceId,
        body: text.slice(0, 500),
      });
      return null;
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") return null;

    const root = (data as any).payload != null ? (data as any).payload : data;

    const positiveTopics = normalizeTopics(root?.reviewTrends?.positiveTopics ?? []);
    const negativeTopics = normalizeTopics(root?.reviewTrends?.negativeTopics ?? []);
    const dateRange = root?.dateRange;
    const result: ItemReviewTrendsResult = {
      asin: (root?.asin as string) ?? normalizedAsin,
      itemName: (root?.itemName as string) ?? null,
      marketplaceId: (root?.marketplaceId as string) ?? marketplaceId,
      countryCode: (root?.countryCode as string) ?? null,
      dateRange:
        dateRange && typeof dateRange.startDate === "string" && typeof dateRange.endDate === "string"
          ? { startDate: dateRange.startDate, endDate: dateRange.endDate }
          : null,
      positiveTopics,
      negativeTopics,
    };

    return result;
  } catch (error) {
    console.error("getItemReviewTrends error", {
      asin: asin.trim(),
      marketplaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
