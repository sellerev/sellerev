/**
 * ASIN Catalog Persistence
 * 
 * Stores normalized SP-API Catalog Items data in Supabase.
 * Uses 7-day TTL cache to avoid redundant API calls.
 */

import {
  AsinCore,
  AsinMarket,
  AsinAttributes,
  AsinMedia,
  AsinRelationships,
  AsinCatalogRecord,
} from "./catalogModels";

const CATALOG_CACHE_TTL_DAYS = 7;

/**
 * Check if ASIN catalog data is still fresh (within TTL)
 */
export function isCatalogDataFresh(lastEnrichedAt: Date | string | null): boolean {
  if (!lastEnrichedAt) return false;
  
  const enrichedDate = typeof lastEnrichedAt === "string" 
    ? new Date(lastEnrichedAt) 
    : lastEnrichedAt;
  
  const ttlCutoff = new Date();
  ttlCutoff.setDate(ttlCutoff.getDate() - CATALOG_CACHE_TTL_DAYS);
  
  return enrichedDate >= ttlCutoff;
}

/**
 * Bulk lookup ASIN catalog data (check cache freshness)
 */
export async function bulkLookupCatalogCache(
  supabase: any,
  asins: string[]
): Promise<Map<string, AsinCatalogRecord>> {
  if (!supabase || !asins || asins.length === 0) {
    return new Map();
  }

  try {
    const ttlCutoff = new Date();
    ttlCutoff.setDate(ttlCutoff.getDate() - CATALOG_CACHE_TTL_DAYS);

    // Fetch all catalog tables in parallel
    const [coreData, marketData, attributesData, mediaData, relationshipsData] = await Promise.all([
      supabase
        .from("asin_core")
        .select("*")
        .in("asin", asins.map(a => a.toUpperCase()))
        .gte("last_enriched_at", ttlCutoff.toISOString()),
      
      supabase
        .from("asin_market")
        .select("*")
        .in("asin", asins.map(a => a.toUpperCase()))
        .gte("last_enriched_at", ttlCutoff.toISOString()),
      
      supabase
        .from("asin_attributes")
        .select("*")
        .in("asin", asins.map(a => a.toUpperCase()))
        .gte("last_enriched_at", ttlCutoff.toISOString()),
      
      supabase
        .from("asin_media")
        .select("*")
        .in("asin", asins.map(a => a.toUpperCase()))
        .gte("last_enriched_at", ttlCutoff.toISOString()),
      
      supabase
        .from("asin_relationships")
        .select("*")
        .in("asin", asins.map(a => a.toUpperCase()))
        .gte("last_enriched_at", ttlCutoff.toISOString()),
    ]);

    // Combine into canonical records
    const catalogMap = new Map<string, AsinCatalogRecord>();

    // Build records from fetched data
    const coreMap = new Map<string, AsinCore>();
    if (coreData.data) {
      for (const row of coreData.data) {
        coreMap.set(row.asin.toUpperCase(), {
          asin: row.asin.toUpperCase(),
          title: row.title,
          brand: row.brand,
          manufacturer: row.manufacturer,
          model_number: row.model_number,
          product_type: row.product_type,
          last_enriched_at: new Date(row.last_enriched_at),
        });
      }
    }

    // Combine all tables into complete records
    for (const asin of asins.map(a => a.toUpperCase())) {
      const core = coreMap.get(asin);
      if (!core) continue; // Skip if core data missing

      const market = marketData.data?.find((r: any) => r.asin.toUpperCase() === asin);
      const attributes = attributesData.data?.find((r: any) => r.asin.toUpperCase() === asin);
      const media = mediaData.data?.find((r: any) => r.asin.toUpperCase() === asin);
      const relationships = relationshipsData.data?.find((r: any) => r.asin.toUpperCase() === asin);

      if (market) {
        catalogMap.set(asin, {
          core,
          market: {
            asin: market.asin.toUpperCase(),
            primary_category: market.primary_category,
            primary_rank: market.primary_rank,
            root_category: market.root_category,
            root_rank: market.root_rank,
            last_enriched_at: new Date(market.last_enriched_at),
          },
          attributes: attributes ? {
            asin: attributes.asin.toUpperCase(),
            bullet_points: attributes.bullet_points || [],
            special_features: attributes.special_features || [],
            dimensions: attributes.dimensions_length || attributes.dimensions_width || attributes.dimensions_height ? {
              length: attributes.dimensions_length,
              width: attributes.dimensions_width,
              height: attributes.dimensions_height,
              unit: attributes.dimensions_unit,
            } : null,
            weight: attributes.weight_value ? {
              value: attributes.weight_value,
              unit: attributes.weight_unit,
            } : null,
            connectivity: attributes.connectivity || null,
            resolution: attributes.resolution,
            power_consumption: attributes.power_consumption,
            included_components: attributes.included_components || null,
            color: attributes.color,
            material: attributes.material,
            size: attributes.size,
            last_enriched_at: new Date(attributes.last_enriched_at),
          } : {
            asin: asin.toUpperCase(),
            bullet_points: [],
            special_features: [],
            dimensions: null,
            weight: null,
            connectivity: null,
            resolution: null,
            power_consumption: null,
            included_components: null,
            color: null,
            material: null,
            size: null,
            last_enriched_at: new Date(),
          },
          media: media ? {
            asin: media.asin.toUpperCase(),
            primary_image_url: media.primary_image_url,
            additional_images: media.additional_images || [],
            last_enriched_at: new Date(media.last_enriched_at),
          } : {
            asin: asin.toUpperCase(),
            primary_image_url: null,
            additional_images: [],
            last_enriched_at: new Date(),
          },
          relationships: relationships ? {
            asin: relationships.asin.toUpperCase(),
            parent_asin: relationships.parent_asin?.toUpperCase() || null,
            variation_theme: relationships.variation_theme,
            is_parent: relationships.is_parent || false,
            last_enriched_at: new Date(relationships.last_enriched_at),
          } : {
            asin: asin.toUpperCase(),
            parent_asin: null,
            variation_theme: null,
            is_parent: false,
            last_enriched_at: new Date(),
          },
        });
      }
    }

    return catalogMap;
  } catch (error) {
    console.error("BULK_CATALOG_CACHE_LOOKUP_ERROR", {
      error: error instanceof Error ? error.message : String(error),
      asin_count: asins.length,
    });
    return new Map();
  }
}

/**
 * Persist ASIN catalog record to database (upsert)
 */
export async function persistCatalogRecord(
  supabase: any,
  record: AsinCatalogRecord
): Promise<void> {
  if (!supabase || !record) return;

  const asin = record.core.asin.toUpperCase();
  const now = new Date().toISOString();

  try {
    // Upsert core
    await supabase
      .from("asin_core")
      .upsert({
        asin,
        title: record.core.title,
        brand: record.core.brand,
        manufacturer: record.core.manufacturer,
        model_number: record.core.model_number,
        product_type: record.core.product_type,
        last_enriched_at: now,
        updated_at: now,
      }, {
        onConflict: "asin",
      });

    // Upsert market
    await supabase
      .from("asin_market")
      .upsert({
        asin,
        primary_category: record.market.primary_category,
        primary_rank: record.market.primary_rank,
        root_category: record.market.root_category,
        root_rank: record.market.root_rank,
        last_enriched_at: now,
        updated_at: now,
      }, {
        onConflict: "asin",
      });

    // Upsert attributes
    await supabase
      .from("asin_attributes")
      .upsert({
        asin,
        bullet_points: record.attributes.bullet_points,
        special_features: record.attributes.special_features,
        dimensions_length: record.attributes.dimensions?.length || null,
        dimensions_width: record.attributes.dimensions?.width || null,
        dimensions_height: record.attributes.dimensions?.height || null,
        dimensions_unit: record.attributes.dimensions?.unit || null,
        weight_value: record.attributes.weight?.value || null,
        weight_unit: record.attributes.weight?.unit || null,
        connectivity: record.attributes.connectivity,
        resolution: record.attributes.resolution,
        power_consumption: record.attributes.power_consumption,
        included_components: record.attributes.included_components,
        color: record.attributes.color,
        material: record.attributes.material,
        size: record.attributes.size,
        last_enriched_at: now,
        updated_at: now,
      }, {
        onConflict: "asin",
      });

    // Upsert media
    await supabase
      .from("asin_media")
      .upsert({
        asin,
        primary_image_url: record.media.primary_image_url,
        additional_images: record.media.additional_images.slice(0, 10), // Limit to 10
        last_enriched_at: now,
        updated_at: now,
      }, {
        onConflict: "asin",
      });

    // Upsert relationships
    await supabase
      .from("asin_relationships")
      .upsert({
        asin,
        parent_asin: record.relationships.parent_asin?.toUpperCase() || null,
        variation_theme: record.relationships.variation_theme,
        is_parent: record.relationships.is_parent,
        last_enriched_at: now,
        updated_at: now,
      }, {
        onConflict: "asin",
      });
  } catch (error) {
    console.error("PERSIST_CATALOG_RECORD_ERROR", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fail silently - don't block keyword search if persistence fails
  }
}

/**
 * Bulk persist ASIN catalog records
 */
export async function bulkPersistCatalogRecords(
  supabase: any,
  records: AsinCatalogRecord[]
): Promise<void> {
  if (!supabase || !records || records.length === 0) return;

  try {
    // Persist all records in parallel
    await Promise.all(records.map(record => persistCatalogRecord(supabase, record)));
  } catch (error) {
    console.error("BULK_PERSIST_CATALOG_RECORDS_ERROR", {
      error: error instanceof Error ? error.message : String(error),
      record_count: records.length,
    });
  }
}

