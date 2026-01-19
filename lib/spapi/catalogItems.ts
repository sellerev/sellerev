/**
 * SP-API Catalog Items Batch Enrichment
 * 
 * Fetches product metadata (title, brand, image, category, BSR) from SP-API Catalog Items API v2022-04-01.
 * Supports batch requests (max 20 ASINs per request) with parallel execution.
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
import { normalizeCatalogItem, extractBSRData } from "./catalogNormalize";
import { bulkPersistCatalogRecords, bulkLookupCatalogCache, isCatalogDataFresh } from "./catalogPersist";
import type { AsinCatalogRecord } from "./catalogModels";

export interface CatalogItemMetadata {
  asin: string;
  title: string | null;
  brand: string | null;
  image_url: string | null;
  category: string | null;
  bsr: number | null;
}

export interface BatchEnrichmentResult {
  enriched: Map<string, CatalogItemMetadata>;
  failed: string[];
  errors: Array<{ asin: string; error: string }>;
}

/**
 * Batch enrich ASINs with SP-API Catalog Items metadata
 * 
 * @param asins - Array of ASINs to enrich (max 49, will be batched into groups of 20)
 * @param marketplaceId - Marketplace ID (default: ATVPDKIKX0DER for US)
 * @param timeoutMs - Request timeout in milliseconds (default: 4000)
 * @returns Promise<BatchEnrichmentResult> Enrichment results with metadata map
 */
export async function batchEnrichCatalogItems(
  asins: string[],
  spApiCatalogResults: Map<string, any>,
  marketplaceId: string = "ATVPDKIKX0DER",
  timeoutMs: number = 4000,
  keyword?: string,
  supabase?: any,
  ingestionMetrics?: { 
    totalAttributesWritten: { value: number };
    totalClassificationsWritten: { value: number };
    totalImagesWritten: { value: number };
    totalRelationshipsWritten: { value: number };
    totalSkippedDueToCache: { value: number };
  }
): Promise<void> {
  if (!asins || asins.length === 0) {
    return;
  }

  // Check credentials
  const awsAccessKeyId = process.env.SP_API_AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.SP_API_AWS_SECRET_ACCESS_KEY;

  if (!awsAccessKeyId || !awsSecretAccessKey) {
    console.warn("SP-API credentials not configured, skipping catalog enrichment");
    return;
  }

  // Batch ASINs into groups of 20 (SP-API limit)
  const batches: string[][] = [];
  const batchSizes: number[] = [];
  for (let i = 0; i < asins.length; i += 20) {
    const batch = asins.slice(i, i + 20);
    batches.push(batch);
    batchSizes.push(batch.length);
  }

  const totalBatches = batches.length;
  const totalStartTime = Date.now();

  // Execute batches in parallel with timeout
  // CRITICAL: Pass spApiCatalogResults directly so it's mutated in place
  const batchPromises = batches.map((batch, batchIndex) =>
    fetchBatchWithTimeout(batch, marketplaceId, timeoutMs, awsAccessKeyId, awsSecretAccessKey, batchIndex, totalBatches, keyword, supabase, ingestionMetrics, spApiCatalogResults)
  );

  await Promise.allSettled(batchPromises);

  // Emit batch summary log
  const totalDuration = Date.now() - totalStartTime;
  const avgDuration = totalBatches > 0 ? Math.round(totalDuration / totalBatches) : 0;
  
  console.log('SP_API_BATCH_COMPLETE', {
    endpoint_name: 'catalogItems',
    keyword: keyword || 'unknown',
    total_asins: asins.length,
    total_batches: totalBatches,
    batch_sizes: batchSizes,
    enriched_count: spApiCatalogResults.size,
    total_duration_ms: totalDuration,
    avg_duration_ms: avgDuration,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Fetch a batch of ASINs with timeout
 */
async function fetchBatchWithTimeout(
  asins: string[],
  marketplaceId: string,
  timeoutMs: number,
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  batchIndex: number,
  totalBatches: number,
  keyword?: string,
  supabase?: any,
  ingestionMetrics?: { 
    totalAttributesWritten: { value: number };
    totalClassificationsWritten: { value: number };
    totalImagesWritten: { value: number };
    totalRelationshipsWritten: { value: number };
    totalSkippedDueToCache: { value: number };
  },
  spApiCatalogResults?: Map<string, any>
): Promise<void> {
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("SP-API batch request timeout")), timeoutMs);
  });

  const fetchPromise = fetchBatch(asins, marketplaceId, awsAccessKeyId, awsSecretAccessKey, batchIndex, totalBatches, keyword, supabase, ingestionMetrics, spApiCatalogResults);

  return Promise.race([fetchPromise, timeoutPromise]);
}

/**
 * Fetch a single batch of ASINs (max 20)
 */
async function fetchBatch(
  asins: string[],
  marketplaceId: string,
  awsAccessKeyId: string,
  awsSecretAccessKey: string,
  batchIndex: number,
  totalBatches: number,
  keyword?: string,
  supabase?: any,
  ingestionMetrics?: { 
    totalAttributesWritten: { value: number };
    totalClassificationsWritten: { value: number };
    totalImagesWritten: { value: number };
    totalRelationshipsWritten: { value: number };
    totalSkippedDueToCache: { value: number };
  },
  spApiCatalogResults?: Map<string, any>
): Promise<void> {
  if (!spApiCatalogResults) {
    throw new Error("spApiCatalogResults map must be provided");
  }
  
  const normalizeAsin = (a: string) => a.trim().toUpperCase();
  let didExtractAnyBsr = false;
  const startTime = Date.now();
  
  // Track enrichment signals (independent of items.length or enriched map)
  let spApiResponded = false;
  let hasAnyEnrichment = false;

  try {
    const accessToken = await getSpApiAccessToken();
    const endpoint = getEndpointForMarketplace(marketplaceId);
    const host = new URL(endpoint).hostname;
    const region = getRegionForMarketplace(marketplaceId);

    // Build query parameters
    const params = new URLSearchParams();
    params.set("marketplaceIds", marketplaceId);
    params.set("identifiersType", "ASIN");
    params.set("identifiers", asins.join(","));
    params.set("includedData", "attributes,identifiers,images,summaries,salesRanks,relationships,classifications,dimensions,productTypes");
    const queryString = params.toString();

    const path = "/catalog/2022-04-01/items";
    
    // REQUIRED LOG: SP_API_CATALOG_REQUEST_SENT
    console.log('SP_API_CATALOG_REQUEST_SENT', {
      keyword: keyword || 'unknown',
      asins: asins,
      batch_index: batchIndex,
      total_batches: totalBatches,
      http_status: null, // Not available yet
      x_amzn_requestid: null, // Not available yet
      x_amzn_ratelimit_limit: null, // Not available yet
      duration_ms: null, // Not available yet
      timestamp: new Date().toISOString(),
    });
    
    // Log request
    logSpApiEvent({
      event_type: 'SP_API_REQUEST',
      endpoint_name: 'catalogItems',
      api_version: '2022-04-01',
      method: 'GET',
      path,
      query_params: queryString,
      marketplace_id: marketplaceId,
      asin_count: asins.length,
      asins: asins.slice(0, 20), // Log first 20 ASINs
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
      
      // Log error
      logSpApiEvent({
        event_type: 'SP_API_ERROR',
        endpoint_name: 'catalogItems',
        api_version: '2022-04-01',
        method: 'GET',
        path,
        query_params: queryString,
        marketplace_id: marketplaceId,
        asin_count: asins.length,
        http_status: response.status,
        duration_ms: duration,
        request_id: headers.request_id,
        rate_limit_limit: headers.rate_limit_limit,
        rate_limit_remaining: headers.rate_limit_remaining,
        error: errorText.substring(0, 500),
        batch_index: batchIndex,
        total_batches: totalBatches,
      });

      // HTTP error - return void, no data added to map
      return;
    }

    const data = await response.json();
    
    // Track that SP-API responded successfully (HTTP 200)
    spApiResponded = true;

    // REQUIRED LOG: SP_API_CATALOG_RESPONSE_RECEIVED
    console.log('SP_API_CATALOG_RESPONSE_RECEIVED', {
      keyword: keyword || 'unknown',
      asins: asins,
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
      endpoint_name: 'catalogItems',
      api_version: '2022-04-01',
      method: 'GET',
      path,
      query_params: queryString,
      marketplace_id: marketplaceId,
      asin_count: asins.length,
      http_status: response.status,
      duration_ms: duration,
      request_id: headers.request_id,
      rate_limit_limit: headers.rate_limit_limit,
      rate_limit_remaining: headers.rate_limit_remaining,
      batch_index: batchIndex,
      total_batches: totalBatches,
    });

    // Parse response (SP-API returns items array)
    // CRITICAL: SP-API can return valid data even if items.length === 0
    // Success is determined by: HTTP 200 + presence of any ingested data, NOT items.length
    const items = data?.items || [];
    const normalizedRecords: AsinCatalogRecord[] = [];
    
    // Track enrichment signals (independent of items.length)
    let hasBsrExtracted = false;
    let hasAttributes = false;
    let hasImages = false;
    
    for (const item of items) {
      const asin = item?.asin || item?.identifiers?.marketplaceIdentifiers?.[0]?.identifier;
      if (!asin) continue;

      // Normalize to canonical model
      const normalizedRecord = normalizeCatalogItem(item, asin);
      if (normalizedRecord) {
        normalizedRecords.push(normalizedRecord);
      }

      // Extract BSR for backward compatibility (existing code expects this)
      const bsrData = extractBSRData(item);
      const bsr = bsrData.primary_rank;
      
      // Check if item has salesRanks (BSR data) - counts as enriched for keyword mode
      const hasSalesRanks = Array.isArray(item?.salesRanks) && item.salesRanks.length > 0;
      const hasClassificationRanks = hasSalesRanks && item.salesRanks.some((sr: any) => 
        Array.isArray(sr?.classificationRanks) && sr.classificationRanks.length > 0
      );
      const hasDisplayGroupRanks = hasSalesRanks && item.salesRanks.some((sr: any) => 
        sr?.displayGroupRanks && Array.isArray(sr.displayGroupRanks) && sr.displayGroupRanks.length > 0
      );
      
      // Item is enriched if it has BSR data (classificationRanks OR displayGroupRanks)
      // OR if it has other enrichment data (attributes, images, summaries)
      const hasBSRData = hasClassificationRanks || hasDisplayGroupRanks || (bsr !== null && bsr > 0);
      const hasOtherData = extractTitle(item) || extractBrand(item) || extractImageUrl(item);
      const isEnriched = hasBSRData || hasOtherData;
      
      // Track enrichment signals (for success determination)
      if (hasBSRData) {
        hasBsrExtracted = true;
        hasAnyEnrichment = true;
      }
      if (hasOtherData) {
        hasAttributes = true;
        hasAnyEnrichment = true;
      }
      if (extractImageUrl(item)) {
        hasImages = true;
        hasAnyEnrichment = true;
      }
      
      const metadata: CatalogItemMetadata = {
        asin,
        title: extractTitle(item),
        brand: extractBrand(item),
        image_url: extractImageUrl(item),
        category: extractCategory(item),
        bsr,
      };

      // CRITICAL: Always add to enriched if BSR was extracted, even if other data is missing
      // BSR is the most important enrichment data and must be preserved
      const shouldAddToEnriched = isEnriched || (bsr !== null && bsr > 0);
      if (shouldAddToEnriched) {
        result.set(asin, metadata);
        
        // Debug log for BSR extraction - log immediately when BSR is found and added
        if (bsr !== null && bsr > 0) {
          console.log("🔵 SP_API_BSR_EXTRACTED", {
            asin,
            bsr,
            primary_category: bsrData.primary_category,
            root_rank: bsrData.root_rank,
            has_salesRanks: Array.isArray(item?.salesRanks) && item.salesRanks.length > 0,
            salesRanks_count: item?.salesRanks?.length || 0,
            has_classificationRanks: Array.isArray(item?.salesRanks?.[0]?.classificationRanks) && item.salesRanks[0].classificationRanks.length > 0,
            classificationRanks_count: item?.salesRanks?.[0]?.classificationRanks?.length || 0,
            added_to_enriched: true,
            result_map_size: result.size,
          });
          hasBsrExtracted = true; // Track that BSR was extracted
        }
      } else if (bsr !== null && bsr > 0) {
        // Log warning if BSR was extracted but NOT added (should never happen with our fix)
        console.warn("⚠️ BSR_EXTRACTED_BUT_NOT_ADDED", {
          asin,
          bsr,
          isEnriched,
          bsr_check: bsr !== null && bsr > 0,
          shouldAddToEnriched,
        });
      }
    }

    // Persist normalized records to database (non-blocking)
    if (supabase && normalizedRecords.length > 0) {
      bulkPersistCatalogRecords(supabase, normalizedRecords).catch((error) => {
        console.error("CATALOG_PERSISTENCE_ERROR", {
          keyword: keyword || 'unknown',
          error: error instanceof Error ? error.message : String(error),
          record_count: normalizedRecords.length,
          message: "Failed to persist catalog records - continuing without persistence",
        });
      });
    }

    // Ingest raw SP-API data to new tables (asin_core, asin_attribute_kv, asin_classifications)
    // CRITICAL: Ingestion success determined by actual data written, NOT items.length
    // SP-API can return valid data (salesRanks, attributes) even if items.length === 0
    if (supabase && items.length > 0) {
      const { bulkIngestCatalogItems } = await import("./catalogIngest");
      const ingestItems = items
        .map((item: any) => {
          const asin = item?.asin || item?.identifiers?.marketplaceIdentifiers?.[0]?.identifier;
          return asin ? { asin, item } : null;
        })
        .filter((item: { asin: string; item: any } | null): item is { asin: string; item: any } => item !== null);

      if (ingestItems.length > 0) {
        // Await ingestion to collect metrics synchronously
        try {
          const ingestionResult = await bulkIngestCatalogItems(supabase, ingestItems, marketplaceId);
          
          // Track actual data written (determines enrichment success)
          if (ingestionResult.total_attributes_written > 0) {
            hasAttributes = true;
            hasAnyEnrichment = true;
          }
          if (ingestionResult.total_classifications_written > 0) {
            hasAnyEnrichment = true;
          }
          if (ingestionResult.total_images_written > 0) {
            hasImages = true;
            hasAnyEnrichment = true;
          }
          
          // Individual ASIN logs are already logged in ingestCatalogItem()
          // Log batch summary (optional, for debugging)
          console.log("CATALOG_INGESTION_BATCH_SUMMARY", {
            keyword: keyword || 'unknown',
            batch_index: batchIndex,
            asin_count: ingestItems.length,
            total_attributes_written: ingestionResult.total_attributes_written,
            total_classifications_written: ingestionResult.total_classifications_written,
            total_images_written: ingestionResult.total_images_written,
            total_relationships_written: ingestionResult.total_relationships_written,
            total_skipped: ingestionResult.total_skipped,
            enrichment_success: hasAnyEnrichment, // Track actual enrichment success
          });
          
          // Aggregate metrics for keyword-level summary
          if (ingestionMetrics) {
            ingestionMetrics.totalAttributesWritten.value += ingestionResult.total_attributes_written;
            ingestionMetrics.totalClassificationsWritten.value += ingestionResult.total_classifications_written;
            ingestionMetrics.totalImagesWritten.value += ingestionResult.total_images_written;
            ingestionMetrics.totalRelationshipsWritten.value += ingestionResult.total_relationships_written;
            ingestionMetrics.totalSkippedDueToCache.value += ingestionResult.total_skipped;
          }
        } catch (error) {
          console.error("CATALOG_INGESTION_ERROR", {
            keyword: keyword || 'unknown',
            batch_index: batchIndex,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to ingest catalog items - continuing without ingestion",
          });
        }
      }
    }
    
    // CRITICAL: Enrichment success determined by actual data written/signals, NOT items.length
    // If we have any enrichment signals (BSR, attributes, images), enrichment was successful
    // This handles cases where items.length === 0 but salesRanks/attributes were processed
    // Note: Enrichment signals tracked above will be used for success determination
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Log error
    logSpApiEvent({
      event_type: 'SP_API_ERROR',
      endpoint_name: 'catalogItems',
      api_version: '2022-04-01',
      method: 'GET',
      path: '/catalog/2022-04-01/items',
      marketplace_id: marketplaceId,
      asin_count: asins.length,
      duration_ms: duration,
      error: error instanceof Error ? error.message : String(error),
      batch_index: batchIndex,
      total_batches: totalBatches,
    });
  }
}

/**
 * Extract title from SP-API Catalog Item
 */
function extractTitle(item: any): string | null {
  // Try multiple paths for title
  const title =
    item?.attributes?.item_name?.[0]?.value ||
    item?.attributes?.title?.[0]?.value ||
    item?.summaries?.[0]?.itemName ||
    item?.title ||
    null;

  if (typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }

  return null;
}

/**
 * Extract brand from SP-API Catalog Item
 */
function extractBrand(item: any): string | null {
  // Try multiple paths for brand
  const brand =
    item?.attributes?.brand?.[0]?.value ||
    item?.attributes?.manufacturer?.[0]?.value ||
    item?.attributes?.brand_name?.[0]?.value ||
    item?.summaries?.[0]?.brandName ||
    item?.brand ||
    null;

  if (typeof brand === "string" && brand.trim().length > 0) {
    return normalizeBrand(brand.trim());
  }

  return null;
}

/**
 * Extract primary image URL from SP-API Catalog Item
 */
function extractImageUrl(item: any): string | null {
  // Try images array (primary image first)
  const images = item?.images || [];
  if (Array.isArray(images) && images.length > 0) {
    const primaryImage = images[0];
    const imageUrl =
      primaryImage?.images?.[0]?.url ||
      primaryImage?.variant?.[0]?.images?.[0]?.url ||
      primaryImage?.url ||
      null;

    if (typeof imageUrl === "string" && imageUrl.trim().length > 0) {
      return imageUrl.trim();
    }
  }

  // Try attributes path
  const imageUrl =
    item?.attributes?.main_product_image_locator?.[0]?.value ||
    item?.attributes?.other_image_url_1?.[0]?.value ||
    null;

  if (typeof imageUrl === "string" && imageUrl.trim().length > 0) {
    return imageUrl.trim();
  }

  return null;
}

/**
 * Extract category from SP-API Catalog Item
 */
function extractCategory(item: any): string | null {
  // Try browse classification
  const browseClassification =
    item?.attributes?.product_type_name?.[0]?.value ||
    item?.attributes?.item_type_name?.[0]?.value ||
    item?.summaries?.[0]?.websiteDisplayGroup ||
    null;

  if (typeof browseClassification === "string" && browseClassification.trim().length > 0) {
    return browseClassification.trim();
  }

  return null;
}

/**
 * Extract BSR from SP-API Catalog Item
 * Robust extraction: finds best (lowest) rank from classificationRanks, fallbacks to displayRank/rank
 */
function extractBSR(item: any): number | null {
  // Try salesRanks array with classification ranks
  const salesRanks = item?.salesRanks || [];
  if (Array.isArray(salesRanks) && salesRanks.length > 0) {
    // Check all salesRank entries for classificationRanks
    for (const salesRank of salesRanks) {
      const classificationRanks = salesRank?.classificationRanks || [];
      if (Array.isArray(classificationRanks) && classificationRanks.length > 0) {
        // Find all valid ranks from classificationRanks
        const validRanks = classificationRanks
          .map((cr: any) => cr?.rank)
          .filter((rank: any): rank is number => typeof rank === "number" && rank > 0);
        
        if (validRanks.length > 0) {
          // Return the smallest (best) rank
          return Math.min(...validRanks);
        }
      }
    }
    
    // Fallback 1: Try displayRank from first salesRank
    if (salesRanks[0]?.displayRank && typeof salesRanks[0].displayRank === "number" && salesRanks[0].displayRank > 0) {
      return salesRanks[0].displayRank;
    }
    
    // Fallback 2: Try direct rank property from first salesRank
    if (salesRanks[0]?.rank && typeof salesRanks[0].rank === "number" && salesRanks[0].rank > 0) {
      return salesRanks[0].rank;
    }
  }

  return null;
}

/**
 * Normalize brand name (lightweight)
 */
function normalizeBrand(brand: string): string {
  return brand
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

