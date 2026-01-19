/**
 * SP-API Catalog Ingestion
 * 
 * Persists SP-API Catalog Items data to Supabase tables:
 * - asin_core (core identity)
 * - asin_attribute_kv (flexible key-value attributes)
 * - asin_classifications (category hierarchy)
 * 
 * Skips duplicates if enriched within 24 hours.
 */

import type { AsinCatalogRecord } from "./catalogModels";

const ENRICHMENT_COOLDOWN_HOURS = 24;

/**
 * Check if ASIN was enriched within the last 24 hours
 */
async function shouldSkipEnrichment(
  supabase: any,
  asin: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("asin_core")
      .select("last_enriched_at")
      .eq("asin", asin.toUpperCase())
      .single();

    if (error || !data || !data.last_enriched_at) {
      return false; // Not found, should enrich
    }

    const lastEnriched = new Date(data.last_enriched_at);
    const now = new Date();
    const hoursSinceEnrichment = (now.getTime() - lastEnriched.getTime()) / (1000 * 60 * 60);

    return hoursSinceEnrichment < ENRICHMENT_COOLDOWN_HOURS;
  } catch (error) {
    console.warn("ENRICHMENT_COOLDOWN_CHECK_ERROR", {
      asin,
      error: error instanceof Error ? error.message : String(error),
      message: "Continuing with enrichment",
    });
    return false; // On error, proceed with enrichment
  }
}

/**
 * Extract productTypes from SP-API item
 */
function extractProductType(item: any): string | null {
  // Try productTypes array first
  if (Array.isArray(item?.productTypes) && item.productTypes.length > 0) {
    const productType = item.productTypes[0];
    // Could be string or object with displayName
    if (typeof productType === "string") {
      return productType;
    }
    if (productType?.displayName) {
      return productType.displayName;
    }
    if (productType?.productType) {
      return productType.productType;
    }
  }

  // Fallback to attributes
  const attributes = item?.attributes || {};
  if (attributes.product_type_name) {
    const pt = attributes.product_type_name;
    if (Array.isArray(pt) && pt.length > 0) {
      return pt[0]?.value || pt[0] || null;
    }
    if (typeof pt === "string") {
      return pt;
    }
  }

  return null;
}

/**
 * Extract manufacturer from SP-API item
 */
function extractManufacturer(item: any): string | null {
  const attributes = item?.attributes || {};
  const summaries = item?.summaries || [];
  
  // Try attributes first
  if (attributes.manufacturer) {
    const mfr = attributes.manufacturer;
    if (Array.isArray(mfr) && mfr.length > 0) {
      return mfr[0]?.value || mfr[0] || null;
    }
    if (typeof mfr === "string") {
      return mfr;
    }
  }

  if (attributes.manufacturer_name) {
    const mfr = attributes.manufacturer_name;
    if (Array.isArray(mfr) && mfr.length > 0) {
      return mfr[0]?.value || mfr[0] || null;
    }
    if (typeof mfr === "string") {
      return mfr;
    }
  }

  // Fallback to summaries
  if (summaries[0]?.manufacturer) {
    return summaries[0].manufacturer;
  }

  return null;
}

/**
 * Extract model number from SP-API item
 */
function extractModelNumber(item: any): string | null {
  const attributes = item?.attributes || {};
  
  if (attributes.model_number) {
    const model = attributes.model_number;
    if (Array.isArray(model) && model.length > 0) {
      return model[0]?.value || model[0] || null;
    }
    if (typeof model === "string") {
      return model;
    }
  }

  if (attributes.model) {
    const model = attributes.model;
    if (Array.isArray(model) && model.length > 0) {
      return model[0]?.value || model[0] || null;
    }
    if (typeof model === "string") {
      return model;
    }
  }

  return null;
}

/**
 * Stringify attribute value based on type
 */
function stringifyAttributeValue(value: any): { value: string | null; type: string } {
  if (value === null || value === undefined) {
    return { value: null, type: "string" };
  }

  if (typeof value === "string") {
    return { value, type: "string" };
  }

  if (typeof value === "number") {
    return { value: value.toString(), type: "number" };
  }

  if (typeof value === "boolean") {
    return { value: value.toString(), type: "boolean" };
  }

  if (Array.isArray(value)) {
    // Extract values from array of objects or strings
    const values = value.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item?.value) return item.value;
      return String(item);
    });
    return { value: JSON.stringify(values), type: "array" };
  }

  if (typeof value === "object") {
    return { value: JSON.stringify(value), type: "object" };
  }

  return { value: String(value), type: "string" };
}

/**
 * Persist core identity to asin_core
 */
async function persistAsinCore(
  supabase: any,
  asin: string,
  item: any,
  marketplaceId: string = "ATVPDKIKX0DER"
): Promise<void> {
  const summaries = item?.summaries || [];
  const firstSummary = summaries[0] || {};

  const title = firstSummary?.itemName || 
                item?.attributes?.item_name?.[0]?.value ||
                item?.attributes?.title?.[0]?.value ||
                null;

  const brand = firstSummary?.brandName ||
                item?.attributes?.brand?.[0]?.value ||
                item?.attributes?.brand_name?.[0]?.value ||
                null;

  const manufacturer = extractManufacturer(item);
  const modelNumber = extractModelNumber(item);
  const productType = extractProductType(item);

  const now = new Date().toISOString();

  await supabase
    .from("asin_core")
    .upsert({
      asin: asin.toUpperCase(),
      title,
      brand,
      manufacturer,
      model_number: modelNumber,
      product_type: productType,
      last_enriched_at: now,
      updated_at: now,
    }, {
      onConflict: "asin",
    });
}

/**
 * Persist all attributes to asin_attribute_kv
 */
async function persistAttributes(
  supabase: any,
  asin: string,
  item: any,
  marketplaceId: string = "ATVPDKIKX0DER"
): Promise<number> {
  const attributes = item?.attributes || {};
  let attributesWritten = 0;

  // Process all attributes
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;

    const { value: stringValue, type } = stringifyAttributeValue(value);
    if (stringValue === null) continue;

    try {
      await supabase
        .from("asin_attribute_kv")
        .upsert({
          asin: asin.toUpperCase(),
          marketplace_id: marketplaceId,
          attribute_name: key,
          attribute_value: stringValue,
          attribute_type: type,
          source: "sp_api_catalog",
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "asin,marketplace_id,attribute_name",
        });
      attributesWritten++;
    } catch (error) {
      console.warn("ATTRIBUTE_PERSIST_ERROR", {
        asin,
        attribute_name: key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return attributesWritten;
}

/**
 * Persist classifications to asin_classifications
 */
async function persistClassifications(
  supabase: any,
  asin: string,
  item: any,
  marketplaceId: string = "ATVPDKIKX0DER"
): Promise<number> {
  const classifications = item?.classifications || [];
  let classificationsWritten = 0;

  if (!Array.isArray(classifications) || classifications.length === 0) {
    return 0;
  }

  // Process each classification tree
  const promises: Promise<void>[] = [];
  
  for (const classification of classifications) {
    // Classification can be a tree structure
    const traverseClassification = (
      node: any,
      parentId: string | null = null,
      level: number = 0
    ) => {
      const classificationId = node?.classificationId || 
                               node?.id || 
                               node?.value ||
                               null;

      const classificationName = node?.displayName ||
                                 node?.name ||
                                 node?.title ||
                                 node?.value ||
                                 null;

      if (!classificationId || !classificationName) {
        return; // Skip invalid nodes
      }

      // Persist this classification
      promises.push(
        supabase
          .from("asin_classifications")
          .upsert({
            asin: asin.toUpperCase(),
            marketplace_id: marketplaceId,
            classification_id: classificationId,
            classification_name: classificationName,
            parent_classification_id: parentId,
            hierarchy_level: level,
            source: "sp_api_catalog",
            updated_at: new Date().toISOString(),
          }, {
            onConflict: "asin,marketplace_id,classification_id",
          })
          .then(() => {
            classificationsWritten++;
          })
          .catch((error: any) => {
            console.warn("CLASSIFICATION_PERSIST_ERROR", {
              asin,
              classification_id: classificationId,
              error: error instanceof Error ? error.message : String(error),
            });
          })
      );

      // Recursively process children
      const children = node?.children || node?.subClassifications || [];
      if (Array.isArray(children)) {
        for (const child of children) {
          traverseClassification(child, classificationId, level + 1);
        }
      }
    };

    traverseClassification(classification);
  }
  
  // Wait for all persistence operations to complete
  await Promise.allSettled(promises);

  // Wait a bit for async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));

  return classificationsWritten;
}

/**
 * Ingest SP-API Catalog Item into Supabase
 * Returns counts of attributes and classifications written
 */
export async function ingestCatalogItem(
  supabase: any,
  asin: string,
  item: any,
  marketplaceId: string = "ATVPDKIKX0DER"
): Promise<{
  attributes_written: number;
  classifications_written: number;
  skipped: boolean;
}> {
  if (!supabase || !asin || !item) {
    return { attributes_written: 0, classifications_written: 0, skipped: true };
  }

  // Check if should skip (enriched within 24h)
  const skipped = await shouldSkipEnrichment(supabase, asin);
  if (skipped) {
    return { attributes_written: 0, classifications_written: 0, skipped: true };
  }

  try {
    // Persist core identity
    await persistAsinCore(supabase, asin, item, marketplaceId);

    // Persist attributes
    const attributesWritten = await persistAttributes(supabase, asin, item, marketplaceId);

    // Persist classifications
    const classificationsWritten = await persistClassifications(supabase, asin, item, marketplaceId);

    return {
      attributes_written: attributesWritten,
      classifications_written: classificationsWritten,
      skipped: false,
    };
  } catch (error) {
    console.error("CATALOG_INGESTION_ERROR", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    return { attributes_written: 0, classifications_written: 0, skipped: false };
  }
}

/**
 * Bulk ingest multiple ASINs
 */
export async function bulkIngestCatalogItems(
  supabase: any,
  items: Array<{ asin: string; item: any }>,
  marketplaceId: string = "ATVPDKIKX0DER"
): Promise<{
  total_attributes_written: number;
  total_classifications_written: number;
  total_skipped: number;
  results: Array<{ asin: string; attributes_written: number; classifications_written: number; skipped: boolean }>;
}> {
  let totalAttributesWritten = 0;
  let totalClassificationsWritten = 0;
  let totalSkipped = 0;
  const results: Array<{ asin: string; attributes_written: number; classifications_written: number; skipped: boolean }> = [];

  for (const { asin, item } of items) {
    const result = await ingestCatalogItem(supabase, asin, item, marketplaceId);
    totalAttributesWritten += result.attributes_written;
    totalClassificationsWritten += result.classifications_written;
    if (result.skipped) totalSkipped++;
    results.push({ asin, ...result });
  }

  return {
    total_attributes_written: totalAttributesWritten,
    total_classifications_written: totalClassificationsWritten,
    total_skipped: totalSkipped,
    results,
  };
}

