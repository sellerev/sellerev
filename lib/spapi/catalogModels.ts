/**
 * Canonical ASIN Catalog Data Models
 * 
 * Normalized structures for persisting SP-API Catalog Items data.
 * These models separate concerns for better queryability and AI reasoning.
 */

/**
 * ASIN Core - Essential product identification
 */
export interface AsinCore {
  asin: string;
  title: string | null;
  brand: string | null;
  manufacturer: string | null;
  model_number: string | null;
  product_type: string | null; // Product type name (e.g., "COFFEE_MAKER")
  last_enriched_at: Date;
}

/**
 * ASIN Market - Sales performance and positioning
 */
export interface AsinMarket {
  asin: string;
  primary_category: string | null;
  primary_rank: number | null; // BSR from primary classification
  root_category: string | null;
  root_rank: number | null; // BSR from root category if different
  last_enriched_at: Date;
}

/**
 * ASIN Attributes - Buyer-facing, comparable attributes
 */
export interface AsinAttributes {
  asin: string;
  bullet_points: string[]; // Array of bullet points
  special_features: string[]; // Array of special features
  dimensions: {
    length?: number | null;
    width?: number | null;
    height?: number | null;
    unit?: string | null; // "IN" or "CM"
  } | null;
  weight: {
    value?: number | null;
    unit?: string | null; // "OZ" or "LB" or "G" or "KG"
  } | null;
  connectivity: string[] | null; // e.g., ["Bluetooth", "Wi-Fi"]
  resolution: string | null; // e.g., "1920x1080"
  power_consumption: string | null; // e.g., "110V", "220V"
  included_components: string[] | null; // What's included in the box
  color: string | null;
  material: string | null;
  size: string | null;
  last_enriched_at: Date;
}

/**
 * ASIN Media - Images and visual assets
 */
export interface AsinMedia {
  asin: string;
  primary_image_url: string | null;
  additional_images: string[]; // Array of image URLs
  last_enriched_at: Date;
}

/**
 * ASIN Relationships - Parent/child/variation structure
 */
export interface AsinRelationships {
  asin: string;
  parent_asin: string | null; // Parent ASIN if this is a variation
  variation_theme: string | null; // e.g., "Color", "Size", "Color-Size"
  is_parent: boolean; // true if this ASIN has variations
  last_enriched_at: Date;
}

/**
 * Complete ASIN catalog record (all components)
 */
export interface AsinCatalogRecord {
  core: AsinCore;
  market: AsinMarket;
  attributes: AsinAttributes;
  media: AsinMedia;
  relationships: AsinRelationships;
}

/**
 * Buyer-facing attribute keys to extract from SP-API
 * These are attributes that help buyers compare products
 */
export const BUYER_FACING_ATTRIBUTES = new Set([
  'bullet_point',
  'special_feature',
  'item_dimensions',
  'package_dimensions',
  'item_weight',
  'package_weight',
  'connectivity_type',
  'resolution',
  'power_source',
  'voltage',
  'included_components',
  'color',
  'material_type',
  'size',
  'style',
  'pattern',
  'capacity',
  'wattage',
  'screen_size',
  'display_type',
  'battery_life',
  'operating_system',
  'processor_type',
  'memory_size',
  'storage_capacity',
  'camera_resolution',
  'max_zoom',
  'water_resistance',
  'compatible_devices',
  'features',
  'whats_included',
]);

/**
 * Attributes to ignore (regulatory, internal, non-comparable)
 */
export const IGNORED_ATTRIBUTES = new Set([
  'part_number',
  'model',
  'ean',
  'upc',
  'gtin',
  'legal_disclaimer',
  'warranty',
  'certification',
  'compliance',
  'regulatory_compliance',
  'country_of_origin',
  'unspc_code',
  'external_testing_certification',
  'safety_warning',
  'recyclable',
  'batteries_required',
  'battery_composition',
  'battery_energy_content',
  'supplier_declared_dg_hz_regulation1',
  'supplier_declared_dg_hz_regulation2',
  'item_type_name',
  'product_type',
]);

