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
 * Persist media (images) to asin_media
 */
async function persistMedia(
  supabase: any,
  asin: string,
  item: any
): Promise<number> {
  try {
    const images = item?.images || [];
    const primaryImage = images?.[0]?.images?.[0]?.link ||
                        images?.[0]?.link ||
                        item?.summaries?.[0]?.images?.[0]?.link ||
                        null;

    const additionalImages: string[] = [];
    
    // Extract from images array
    if (Array.isArray(images)) {
      for (const imageSet of images) {
        if (Array.isArray(imageSet?.images)) {
          for (const img of imageSet.images) {
            if (img?.link && typeof img.link === "string" && img.link.trim()) {
              const imgUrl = img.link.trim();
              if (imgUrl !== primaryImage) {
                additionalImages.push(imgUrl);
              }
            }
          }
        }
      }
    }

    // Extract from attributes (other_image_url_2, other_image_url_3, etc.)
    const attributes = item?.attributes || {};
    for (let i = 2; i <= 10; i++) {
      const attrKey = `other_image_url_${i}`;
      const imageUrl = attributes[attrKey]?.[0]?.value;
      if (typeof imageUrl === "string" && imageUrl.trim() && imageUrl.trim() !== primaryImage) {
        additionalImages.push(imageUrl.trim());
      }
    }

    const totalImages = (primaryImage ? 1 : 0) + additionalImages.length;

    await supabase
      .from("asin_media")
      .upsert({
        asin: asin.toUpperCase(),
        primary_image_url: typeof primaryImage === "string" ? primaryImage.trim() : null,
        additional_images: additionalImages.slice(0, 10), // Limit to 10 additional images
        last_enriched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "asin",
      });

    return totalImages;
  } catch (error) {
    console.warn("MEDIA_PERSIST_ERROR", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Persist relationships to asin_relationships
 */
async function persistRelationships(
  supabase: any,
  asin: string,
  item: any
): Promise<number> {
  try {
    const relationships = item?.relationships || [];
    
    let parentAsin: string | null = null;
    let variationTheme: string | null = null;
    let isParent = false;

    if (Array.isArray(relationships)) {
      for (const rel of relationships) {
        // Check for parent relationship
        if (rel?.type === "VARIATION" && rel?.parentIdentifiers) {
          const parent = rel.parentIdentifiers?.[0]?.identifier;
          if (typeof parent === "string" && parent.trim()) {
            parentAsin = parent.trim().toUpperCase();
          }
        }

        // Check for variation theme
        if (rel?.variationTheme) {
          variationTheme = typeof rel.variationTheme === "string" 
            ? rel.variationTheme.trim() 
            : null;
        }

        // Check if this ASIN is a parent (has variations)
        if (rel?.type === "VARIATION" && rel?.childIdentifiers) {
          const children = rel.childIdentifiers || [];
          const hasChildren = children.some((child: any) => {
            const childAsin = child?.identifier;
            return typeof childAsin === "string" && childAsin.trim().toUpperCase() !== asin.toUpperCase();
          });
          if (hasChildren) {
            isParent = true;
          }
        }
      }
    }

    const hasRelationship = parentAsin !== null || variationTheme !== null || isParent;

    await supabase
      .from("asin_relationships")
      .upsert({
        asin: asin.toUpperCase(),
        parent_asin: parentAsin,
        variation_theme: variationTheme,
        is_parent: isParent,
        last_enriched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "asin",
      });

    return hasRelationship ? 1 : 0;
  } catch (error) {
    console.warn("RELATIONSHIPS_PERSIST_ERROR", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Ingest SP-API Catalog Item into Supabase
 * Returns counts of attributes, classifications, images, and relationships written
 */
export async function ingestCatalogItem(
  supabase: any,
  asin: string,
  item: any,
  marketplaceId: string = "ATVPDKIKX0DER"
): Promise<{
  asin: string;
  attributes_written: number;
  classifications_written: number;
  images_written: number;
  relationships_written: number;
  skipped_due_to_cache: boolean;
}> {
  if (!supabase || !asin || !item) {
    return { 
      asin: asin || 'unknown',
      attributes_written: 0, 
      classifications_written: 0, 
      images_written: 0,
      relationships_written: 0,
      skipped_due_to_cache: true 
    };
  }

  // Check if should skip (enriched within 24h)
  const skipped = await shouldSkipEnrichment(supabase, asin);
  if (skipped) {
    // Log skipped ASIN
    console.log("CATALOG_INGESTION_SUMMARY", {
      asin: asin.toUpperCase(),
      attributes_written: 0,
      classifications_written: 0,
      images_written: 0,
      relationships_written: 0,
      skipped_due_to_cache: true,
    });
    return { 
      asin: asin.toUpperCase(),
      attributes_written: 0, 
      classifications_written: 0,
      images_written: 0,
      relationships_written: 0,
      skipped_due_to_cache: true 
    };
  }

  try {
    // Persist core identity
    await persistAsinCore(supabase, asin, item, marketplaceId);

    // Persist attributes
    const attributesWritten = await persistAttributes(supabase, asin, item, marketplaceId);

    // Persist classifications
    const classificationsWritten = await persistClassifications(supabase, asin, item, marketplaceId);

    // Persist media (images)
    const imagesWritten = await persistMedia(supabase, asin, item);

    // Persist relationships
    const relationshipsWritten = await persistRelationships(supabase, asin, item);

    const result = {
      asin: asin.toUpperCase(),
      attributes_written: attributesWritten,
      classifications_written: classificationsWritten,
      images_written: imagesWritten,
      relationships_written: relationshipsWritten,
      skipped_due_to_cache: false,
    };

    // Log single structured log per ASIN
    console.log("CATALOG_INGESTION_SUMMARY", result);

    return result;
  } catch (error) {
    console.error("CATALOG_INGESTION_ERROR", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    return { 
      asin: asin.toUpperCase(),
      attributes_written: 0, 
      classifications_written: 0,
      images_written: 0,
      relationships_written: 0,
      skipped_due_to_cache: false 
    };
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
  total_images_written: number;
  total_relationships_written: number;
  total_skipped: number;
  results: Array<{
    asin: string;
    attributes_written: number;
    classifications_written: number;
    images_written: number;
    relationships_written: number;
    skipped_due_to_cache: boolean;
  }>;
}> {
  let totalAttributesWritten = 0;
  let totalClassificationsWritten = 0;
  let totalImagesWritten = 0;
  let totalRelationshipsWritten = 0;
  let totalSkipped = 0;
  const results: Array<{
    asin: string;
    attributes_written: number;
    classifications_written: number;
    images_written: number;
    relationships_written: number;
    skipped_due_to_cache: boolean;
  }> = [];

  for (const { asin, item } of items) {
    const result = await ingestCatalogItem(supabase, asin, item, marketplaceId);
    totalAttributesWritten += result.attributes_written;
    totalClassificationsWritten += result.classifications_written;
    totalImagesWritten += result.images_written;
    totalRelationshipsWritten += result.relationships_written;
    if (result.skipped_due_to_cache) totalSkipped++;
    results.push(result);
  }

  return {
    total_attributes_written: totalAttributesWritten,
    total_classifications_written: totalClassificationsWritten,
    total_images_written: totalImagesWritten,
    total_relationships_written: totalRelationshipsWritten,
    total_skipped: totalSkipped,
    results,
  };
}

