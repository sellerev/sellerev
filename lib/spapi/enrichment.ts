/**
 * SP-API Enrichment for Selected ASINs
 * 
 * Provides targeted enrichment for selected ASINs when user asks about:
 * - Variants (relationships, variationTheme)
 * - Review topics (positive/negative themes)
 * 
 * These are separate from Rainforest escalation and don't use credits.
 */

import { getSpApiAccessToken } from "./auth";
import { createHmac, createHash } from "crypto";

// Reuse createSignedRequest from seller.ts pattern
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
  const algorithm = "AWS4-HMAC-SHA256";
  
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  
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

function getEndpointForMarketplace(marketplaceId: string = "ATVPDKIKX0DER"): { endpoint: string; host: string; region: string } {
  // US marketplace
  if (marketplaceId === "ATVPDKIKX0DER") {
    return {
      endpoint: "https://sellingpartnerapi-na.amazon.com",
      host: "sellingpartnerapi-na.amazon.com",
      region: "us-east-1",
    };
  }
  // Default to US
  return {
    endpoint: "https://sellingpartnerapi-na.amazon.com",
    host: "sellingpartnerapi-na.amazon.com",
    region: "us-east-1",
  };
}

export interface CatalogEnrichment {
  asin: string;
  relationships: {
    parentAsins: string[] | null;
    childAsins: string[] | null;
    variationTheme: string | null;
  };
  summaries: {
    itemName: string | null;
    brand: string | null;
    color: string | null;
  };
  attributes: {
    color: string | null;
    [key: string]: any;
  };
}

export interface ReviewTopicsEnrichment {
  asin: string;
  topics: {
    positive: Array<{ label: string; mentions?: number | null }>;
    negative: Array<{ label: string; mentions?: number | null }>;
  };
  updated_at: string;
}

/**
 * Get catalog item enrichment (relationships, summaries, attributes)
 */
export async function getCatalogItemEnrichment(
  asin: string,
  marketplaceId: string = "ATVPDKIKX0DER",
  userId?: string
): Promise<CatalogEnrichment | null> {
  const startTime = Date.now();
  
  try {
    const accessToken = await getSpApiAccessToken({ userId });
    const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;
    
    if (!awsAccessKeyId || !awsSecretAccessKey) {
      console.warn("SP_API_ENRICHMENT: AWS credentials not configured");
      return null;
    }
    
    const { endpoint, host, region } = getEndpointForMarketplace(marketplaceId);
    const path = `/catalog/2022-04-01/items/${asin}`;
    const params = new URLSearchParams();
    params.set("marketplaceIds", marketplaceId);
    params.set("includedData", "relationships,summaries,attributes");
    const queryString = params.toString();
    
    console.log("SP_API_ENRICHMENT_REQUEST", {
      endpoint: "catalogItems",
      asin,
      marketplaceId,
      start_time: new Date().toISOString(),
    });
    
    const { headers } = await createSignedRequest({
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
      headers,
    });
    
    const duration = Date.now() - startTime;
    const httpStatus = response.status;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("SP_API_ENRICHMENT_ERROR", {
        endpoint: "catalogItems",
        asin,
        http_status: httpStatus,
        error: errorText.substring(0, 200),
        duration_ms: duration,
      });
      return null;
    }
    
    const data = await response.json();
    
    // Normalize response
    const item = data.items?.[0];
    if (!item) {
      console.warn("SP_API_ENRICHMENT: No item data returned", { asin });
      return null;
    }
    
    // Extract relationships
    const relationships = item.relationships || {};
    const parentAsins = relationships.parents?.map((p: any) => p.asin).filter(Boolean) || null;
    const childAsins = relationships.variations?.map((v: any) => v.asin).filter(Boolean) || null;
    const variationTheme = relationships.variationTheme || null;
    
    // Extract summaries
    const summaries = item.summaries?.[0] || {};
    const itemName = summaries.itemName || null;
    const brand = summaries.brand || null;
    const color = summaries.color || null;
    
    // Extract attributes
    const attributes = item.attributes || {};
    const colorAttr = attributes.color?.[0]?.value || null;
    
    console.log("SP_API_ENRICHMENT_SUCCESS", {
      endpoint: "catalogItems",
      asin,
      http_status: httpStatus,
      duration_ms: duration,
      has_parents: !!parentAsins?.length,
      has_children: !!childAsins?.length,
      has_variation_theme: !!variationTheme,
    });
    
    return {
      asin,
      relationships: {
        parentAsins: parentAsins && parentAsins.length > 0 ? parentAsins : null,
        childAsins: childAsins && childAsins.length > 0 ? childAsins : null,
        variationTheme: variationTheme || null,
      },
      summaries: {
        itemName: itemName || null,
        brand: brand || null,
        color: color || colorAttr || null,
      },
      attributes: {
        color: colorAttr || null,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("SP_API_ENRICHMENT_EXCEPTION", {
      endpoint: "catalogItems",
      asin,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    });
    return null;
  }
}

/**
 * Get review topics enrichment (positive/negative themes)
 */
export async function getReviewTopics(
  asin: string,
  marketplaceId: string = "ATVPDKIKX0DER",
  userId?: string
): Promise<ReviewTopicsEnrichment | null> {
  const startTime = Date.now();
  
  try {
    const accessToken = await getSpApiAccessToken({ userId });
    const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;
    
    if (!awsAccessKeyId || !awsSecretAccessKey) {
      console.warn("SP_API_ENRICHMENT: AWS credentials not configured");
      return null;
    }
    
    const { endpoint, host, region } = getEndpointForMarketplace(marketplaceId);
    const path = `/customerFeedback/2024-06-01/items/${asin}/reviewTopics`;
    const params = new URLSearchParams();
    params.set("marketplaceId", marketplaceId);
    const queryString = params.toString();
    
    console.log("SP_API_ENRICHMENT_REQUEST", {
      endpoint: "reviewTopics",
      asin,
      marketplaceId,
      start_time: new Date().toISOString(),
    });
    
    const { headers } = await createSignedRequest({
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
      headers,
    });
    
    const duration = Date.now() - startTime;
    const httpStatus = response.status;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("SP_API_ENRICHMENT_ERROR", {
        endpoint: "reviewTopics",
        asin,
        http_status: httpStatus,
        error: errorText.substring(0, 200),
        duration_ms: duration,
      });
      return null;
    }
    
    const data = await response.json();
    
    // Normalize response
    const topics = data.topics || [];
    const positive: Array<{ label: string; mentions?: number | null }> = [];
    const negative: Array<{ label: string; mentions?: number | null }> = [];
    
    for (const topic of topics) {
      const label = topic.label || topic.topic || null;
      const mentions = typeof topic.mentions === 'number' ? topic.mentions : null;
      const sentiment = topic.sentiment || topic.type || null;
      
      if (!label) continue;
      
      if (sentiment === 'positive' || sentiment === 'POSITIVE') {
        positive.push({ label, mentions });
      } else if (sentiment === 'negative' || sentiment === 'NEGATIVE') {
        negative.push({ label, mentions });
      }
    }
    
    console.log("SP_API_ENRICHMENT_SUCCESS", {
      endpoint: "reviewTopics",
      asin,
      http_status: httpStatus,
      duration_ms: duration,
      positive_count: positive.length,
      negative_count: negative.length,
    });
    
    return {
      asin,
      topics: {
        positive,
        negative,
      },
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("SP_API_ENRICHMENT_EXCEPTION", {
      endpoint: "reviewTopics",
      asin,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    });
    return null;
  }
}

