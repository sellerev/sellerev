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
  parent_asins: string[] | null;
  child_asins: string[] | null;
  variation_theme: string | null;
  color: string | null;
  item_name: string | null;
  bullet_points: string[] | null;
  description: string | null;
  product_type: string | null;
  attributes: Record<string, any> | null;
}

export interface ReviewTopicsEnrichment {
  asin: string;
  positive_topics: Array<{ label: string; mentions?: number | null }>;
  negative_topics: Array<{ label: string; mentions?: number | null }>;
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
    // GOAL 4A: Include attributes, summaries, relationships, productTypes, images
    params.set("includedData", "relationships,summaries,attributes,productTypes,images");
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
      // PRIORITY D.10: Explicitly handle 403 Unauthorized
      const is403 = httpStatus === 403;
      console.error("SP_API_ENRICHMENT_ERROR", {
        endpoint: "catalogItems",
        asin,
        http_status: httpStatus,
        is_403_unauthorized: is403,
        error: errorText.substring(0, 200),
        duration_ms: duration,
      });
      
      // Throw error with 403 flag so caller can handle it
      if (is403) {
        throw new Error("403 Unauthorized: Catalog Items API access not authorized");
      }
      return null;
    }
    
    const data = await response.json();
    
    // DEV-ONLY: Log raw response structure for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log("SP_API_CATALOG_RAW_RESPONSE_KEYS", {
        asin,
        top_level_keys: Object.keys(data),
        payload_keys: data.payload ? Object.keys(data.payload) : null,
        payload_items_keys: data.payload?.items?.[0] ? Object.keys(data.payload.items[0]) : null,
      });
    }
    
    // Normalize response: Handle both single item and batch response shapes
    let item: any = null;
    
    // Try batch response shape first: json.payload.items[0]
    if (data.payload?.items && Array.isArray(data.payload.items) && data.payload.items.length > 0) {
      item = data.payload.items[0];
    }
    // Try single item in payload: json.payload (if it looks like an item - has asin or identifiers)
    else if (data.payload && (data.payload.asin || data.payload.identifiers || data.payload.summaries || data.payload.relationships)) {
      item = data.payload;
    }
    // Try legacy shape: data.items[0]
    else if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      item = data.items[0];
    }
    // Try direct item shape: data itself (if it looks like an item)
    else if (data.asin || data.identifiers || data.summaries || data.relationships) {
      item = data;
    }
    
    // Only mark "no item data returned" if truly no item exists
    if (!item) {
      console.warn("SP_API_ENRICHMENT: No item data returned", { 
        asin,
        response_shape: {
          has_payload: !!data.payload,
          has_payload_items: !!data.payload?.items,
          has_items: !!data.items,
          has_direct_item_fields: !!(data.asin || data.identifiers),
        }
      });
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
    
    // Extract attributes (includes bullet_points, description, etc.)
    const attributes = item.attributes || {};
    const colorAttr = attributes.color?.[0]?.value || null;
    
    // Extract bullet points from attributes
    const bulletPoints: string[] | null = attributes.bullet_point || attributes.bullet_points || null;
    const bulletPointsArray = bulletPoints 
      ? (Array.isArray(bulletPoints) ? bulletPoints : [bulletPoints]).map((bp: any) => 
          typeof bp === 'string' ? bp : (bp?.value || bp?.label || String(bp))
        ).filter(Boolean)
      : null;
    
    // Extract description from attributes
    const description = attributes.product_description?.[0]?.value 
      || attributes.description?.[0]?.value 
      || attributes.item_description?.[0]?.value 
      || null;
    
    // Extract product type from productTypes
    const productTypes = item.productTypes || [];
    const productType = productTypes.length > 0 
      ? (productTypes[0]?.productType || productTypes[0]?.displayName || null)
      : null;
    
    // Build attributes map (excluding already extracted fields)
    const attributesMap: Record<string, any> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (!['bullet_point', 'bullet_points', 'product_description', 'description', 'item_description', 'color'].includes(key)) {
        attributesMap[key] = value;
      }
    }
    
    // Check if we have variations (parent/child relationships)
    const hasVariations = !!(parentAsins?.length || childAsins?.length || variationTheme);
    
    // Log normalized item structure
    console.log("SPAPI_CATALOG_NORMALIZED_ITEM", {
      asin,
      has_title: !!itemName,
      has_bullets: !!bulletPointsArray?.length,
      has_description: !!description,
      has_variations: hasVariations,
    });
    
    console.log("SP_API_ENRICHMENT_SUCCESS", {
      endpoint: "catalogItems",
      asin,
      http_status: httpStatus,
      duration_ms: duration,
      has_parents: !!parentAsins?.length,
      has_children: !!childAsins?.length,
      has_variation_theme: !!variationTheme,
      has_bullet_points: !!bulletPointsArray?.length,
      has_description: !!description,
      has_product_type: !!productType,
    });
    
    // Normalize to flat structure with all fields
    // IMPORTANT: Return item even if bullets/description are missing - return whatever fields exist
    return {
      asin,
      parent_asins: parentAsins && parentAsins.length > 0 ? parentAsins : null,
      child_asins: childAsins && childAsins.length > 0 ? childAsins : null,
      variation_theme: variationTheme || null,
      color: color || colorAttr || null,
      item_name: itemName || null,
      bullet_points: bulletPointsArray,
      description: description,
      product_type: productType,
      attributes: Object.keys(attributesMap).length > 0 ? attributesMap : null,
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
      // PRIORITY D.10: Explicitly handle 403 Unauthorized
      const is403 = httpStatus === 403;
      console.error("SP_API_ENRICHMENT_ERROR", {
        endpoint: "reviewTopics",
        asin,
        http_status: httpStatus,
        is_403_unauthorized: is403,
        error: errorText.substring(0, 200),
        duration_ms: duration,
      });
      
      // Throw error with 403 flag so caller can handle it
      if (is403) {
        throw new Error("403 Unauthorized: Review Topics API access not authorized");
      }
      return null;
    }
    
    const data = await response.json();
    
    // Normalize response
    const topics = data.topics || [];
    const positive_topics: Array<{ label: string; mentions?: number | null }> = [];
    const negative_topics: Array<{ label: string; mentions?: number | null }> = [];
    
    for (const topic of topics) {
      const label = topic.label || topic.topic || null;
      const mentions = typeof topic.mentions === 'number' ? topic.mentions : null;
      const sentiment = topic.sentiment || topic.type || null;
      
      if (!label) continue;
      
      if (sentiment === 'positive' || sentiment === 'POSITIVE') {
        positive_topics.push({ label, mentions });
      } else if (sentiment === 'negative' || sentiment === 'NEGATIVE') {
        negative_topics.push({ label, mentions });
      }
    }
    
    console.log("SP_API_ENRICHMENT_SUCCESS", {
      endpoint: "reviewTopics",
      asin,
      http_status: httpStatus,
      duration_ms: duration,
      positive_count: positive_topics.length,
      negative_count: negative_topics.length,
    });
    
    return {
      asin,
      positive_topics,
      negative_topics,
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

