/**
 * SP-API Catalog Items Normalization
 * 
 * Transforms raw SP-API Catalog Items API responses into canonical ASIN data models.
 * Filters attributes to buyer-facing, comparable data only.
 */

import {
  AsinCore,
  AsinMarket,
  AsinAttributes,
  AsinMedia,
  AsinRelationships,
  AsinCatalogRecord,
  BUYER_FACING_ATTRIBUTES,
  IGNORED_ATTRIBUTES,
} from "./catalogModels";

/**
 * Extract BSR data from SP-API salesRanks structure
 */
export function extractBSRData(item: any): {
  primary_category: string | null;
  primary_rank: number | null;
  root_category: string | null;
  root_rank: number | null;
} {
  const salesRanks = item?.salesRanks || [];
  if (!Array.isArray(salesRanks) || salesRanks.length === 0) {
    return {
      primary_category: null,
      primary_rank: null,
      root_category: null,
      root_rank: null,
    };
  }

  let primaryRank: number | null = null;
  let primaryCategory: string | null = null;
  let rootRank: number | null = null;
  let rootCategory: string | null = null;

  // Check all salesRank entries for classificationRanks
  for (const salesRank of salesRanks) {
    const classificationRanks = salesRank?.classificationRanks || [];
    if (Array.isArray(classificationRanks) && classificationRanks.length > 0) {
      // Get primary classification (first entry)
      const primaryClassification = classificationRanks[0];
      const primaryRankValue = primaryClassification?.rank;
      
      if (typeof primaryRankValue === "number" && primaryRankValue > 0 && !primaryRank) {
        primaryRank = primaryRankValue;
        primaryCategory = primaryClassification?.displayName || 
                         primaryClassification?.title || 
                         salesRank?.displayName ||
                         null;
      }

      // Find root category (last entry in classificationRanks, or use displayRank)
      if (classificationRanks.length > 1) {
        const rootClassification = classificationRanks[classificationRanks.length - 1];
        const rootRankValue = rootClassification?.rank;
        if (typeof rootRankValue === "number" && rootRankValue > 0 && !rootRank) {
          rootRank = rootRankValue;
          rootCategory = rootClassification?.displayName || 
                        rootClassification?.title || 
                        null;
        }
      } else if (salesRank?.displayRank && typeof salesRank.displayRank === "number" && salesRank.displayRank > 0) {
        // Use displayRank as root if only one classification
        rootRank = salesRank.displayRank;
        rootCategory = primaryCategory;
      }

      break; // Use first salesRank entry that has classificationRanks
    }
  }

  // Fallback to direct rank if no classificationRanks found
  if (!primaryRank && salesRanks[0]?.rank && typeof salesRanks[0].rank === "number" && salesRanks[0].rank > 0) {
    primaryRank = salesRanks[0].rank;
    primaryCategory = salesRanks[0]?.displayName || null;
    rootRank = primaryRank;
    rootCategory = primaryCategory;
  }

  return {
    primary_category: primaryCategory,
    primary_rank: primaryRank,
    root_category: rootCategory !== primaryCategory ? rootCategory : null,
    root_rank: rootRank !== primaryRank ? rootRank : null,
  };
}

/**
 * Extract buyer-facing attributes from SP-API attributes object
 */
export function extractBuyerFacingAttributes(item: any): AsinAttributes {
  const attributes = item?.attributes || {};
  
  // Extract bullet points
  const bulletPoints: string[] = [];
  if (attributes.bullet_point && Array.isArray(attributes.bullet_point)) {
    for (const bp of attributes.bullet_point) {
      if (bp?.value && typeof bp.value === "string" && bp.value.trim()) {
        bulletPoints.push(bp.value.trim());
      }
    }
  }

  // Extract special features
  const specialFeatures: string[] = [];
  if (attributes.special_feature && Array.isArray(attributes.special_feature)) {
    for (const sf of attributes.special_feature) {
      if (sf?.value && typeof sf.value === "string" && sf.value.trim()) {
        specialFeatures.push(sf.value.trim());
      }
    }
  }

  // Extract dimensions
  const extractDimensions = (dimObj: any): AsinAttributes['dimensions'] | null => {
    if (!dimObj || typeof dimObj !== "object") return null;
    
    const length = extractNumericValue(dimObj.length);
    const width = extractNumericValue(dimObj.width);
    const height = extractNumericValue(dimObj.height);
    const unit = dimObj.unit_of_measure || dimObj.unit || null;

    if (length === null && width === null && height === null) return null;

    return {
      length,
      width,
      height,
      unit: typeof unit === "string" ? unit : null,
    };
  };

  const dimensions = extractDimensions(attributes.item_dimensions) || 
                     extractDimensions(attributes.package_dimensions) || 
                     null;

  // Extract weight
  const extractWeight = (weightObj: any): AsinAttributes['weight'] | null => {
    if (!weightObj || typeof weightObj !== "object") return null;
    
    const value = extractNumericValue(weightObj.value || weightObj.amount);
    const unit = weightObj.unit_of_measure || weightObj.unit || null;

    if (value === null) return null;

    return {
      value,
      unit: typeof unit === "string" ? unit : null,
    };
  };

  const weight = extractWeight(attributes.item_weight) || 
                 extractWeight(attributes.package_weight) || 
                 null;

  // Extract connectivity
  const connectivity: string[] | null = (() => {
    if (attributes.connectivity_type && Array.isArray(attributes.connectivity_type)) {
      const conn = attributes.connectivity_type
        .map((c: any) => c?.value || c)
        .filter((c: string | null) => c && typeof c === "string")
        .map((c: string) => c.trim());
      return conn.length > 0 ? conn : null;
    }
    return null;
  })();

  // Extract simple string attributes
  const resolution = extractStringAttribute(attributes.resolution);
  const powerConsumption = extractStringAttribute(attributes.voltage) || 
                          extractStringAttribute(attributes.power_source);
  const color = extractStringAttribute(attributes.color);
  const material = extractStringAttribute(attributes.material_type) || 
                  extractStringAttribute(attributes.material);
  const size = extractStringAttribute(attributes.size);

  // Extract included components
  const includedComponents: string[] | null = (() => {
    const components = attributes.included_components || attributes.whats_included;
    if (Array.isArray(components)) {
      const comps = components
        .map((c: any) => c?.value || c)
        .filter((c: string | null) => c && typeof c === "string")
        .map((c: string) => c.trim());
      return comps.length > 0 ? comps : null;
    }
    return null;
  })();

  return {
    asin: "", // Will be set by caller
    bullet_points: bulletPoints,
    special_features: specialFeatures,
    dimensions,
    weight,
    connectivity,
    resolution,
    power_consumption: powerConsumption,
    included_components: includedComponents,
    color,
    material,
    size,
    last_enriched_at: new Date(),
  };
}

/**
 * Helper to extract numeric value from SP-API attribute
 */
function extractNumericValue(value: any): number | null {
  if (typeof value === "number") {
    return isNaN(value) || value <= 0 ? null : value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ""));
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }
  return null;
}

/**
 * Helper to extract string attribute from SP-API
 */
function extractStringAttribute(attr: any): string | null {
  if (!attr) return null;
  
  if (typeof attr === "string" && attr.trim()) {
    return attr.trim();
  }
  
  if (Array.isArray(attr) && attr.length > 0) {
    const firstValue = attr[0]?.value || attr[0];
    if (typeof firstValue === "string" && firstValue.trim()) {
      return firstValue.trim();
    }
  }
  
  if (attr?.value && typeof attr.value === "string" && attr.value.trim()) {
    return attr.value.trim();
  }
  
  return null;
}

/**
 * Extract media (images) from SP-API item
 */
export function extractMedia(item: any, asin: string): AsinMedia {
  // Try multiple image sources
  const primaryImage = item?.images?.[0]?.images?.[0]?.link ||
                      item?.images?.[0]?.link ||
                      item?.summaries?.[0]?.images?.[0]?.link ||
                      item?.attributes?.main_product_image_locator?.[0]?.value ||
                      item?.attributes?.other_image_url_1?.[0]?.value ||
                      null;

  const additionalImages: string[] = [];
  
  // Extract from images array
  if (Array.isArray(item?.images)) {
    for (const imageSet of item.images) {
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

  return {
    asin,
    primary_image_url: typeof primaryImage === "string" ? primaryImage.trim() : null,
    additional_images: additionalImages.slice(0, 10), // Limit to 10 additional images
    last_enriched_at: new Date(),
  };
}

/**
 * Extract relationships (parent/child/variations) from SP-API item
 */
export function extractRelationships(item: any, asin: string): AsinRelationships {
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
        // Check if any child has this ASIN as parent
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

  return {
    asin,
    parent_asin: parentAsin,
    variation_theme: variationTheme,
    is_parent: isParent,
    last_enriched_at: new Date(),
  };
}

/**
 * Normalize SP-API Catalog Item into canonical ASIN catalog record
 */
export function normalizeCatalogItem(item: any, asin: string): AsinCatalogRecord | null {
  if (!item || !asin) return null;

  // Extract core data
  const summaries = item?.summaries || [];
  const firstSummary = summaries[0] || {};
  const attributes = item?.attributes || {};

  const core: AsinCore = {
    asin: asin.toUpperCase(),
    title: extractTitle(item),
    brand: extractBrand(item),
    manufacturer: extractStringAttribute(attributes.manufacturer) ||
                  extractStringAttribute(attributes.manufacturer_name),
    model_number: extractStringAttribute(attributes.model_number) ||
                  extractStringAttribute(attributes.model),
    product_type: extractStringAttribute(attributes.product_type_name) ||
                  extractStringAttribute(item?.productType) ||
                  firstSummary?.websiteDisplayGroup ||
                  null,
    last_enriched_at: new Date(),
  };

  // Extract market data (BSR)
  const bsrData = extractBSRData(item);
  const market: AsinMarket = {
    asin: asin.toUpperCase(),
    primary_category: bsrData.primary_category,
    primary_rank: bsrData.primary_rank,
    root_category: bsrData.root_category,
    root_rank: bsrData.root_rank,
    last_enriched_at: new Date(),
  };

  // Extract attributes
  const attrs = extractBuyerFacingAttributes(item);
  attrs.asin = asin.toUpperCase();

  // Extract media
  const media = extractMedia(item, asin.toUpperCase());

  // Extract relationships
  const relationships = extractRelationships(item, asin.toUpperCase());

  return {
    core,
    market,
    attributes: attrs,
    media,
    relationships,
  };
}

/**
 * Extract title from SP-API item (reused from catalogItems.ts logic)
 */
function extractTitle(item: any): string | null {
  const summaries = item?.summaries || [];
  const attributes = item?.attributes || {};
  
  return summaries[0]?.itemName ||
         attributes?.item_name?.[0]?.value ||
         attributes?.title?.[0]?.value ||
         null;
}

/**
 * Extract brand from SP-API item (reused from catalogItems.ts logic)
 */
function extractBrand(item: any): string | null {
  const summaries = item?.summaries || [];
  const attributes = item?.attributes || {};
  
  return summaries[0]?.brandName ||
         attributes?.brand?.[0]?.value ||
         attributes?.manufacturer?.[0]?.value ||
         attributes?.brand_name?.[0]?.value ||
         null;
}

