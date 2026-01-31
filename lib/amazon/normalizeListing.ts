/**
 * Normalize listing data from various sources (Rainforest API, legacy formats)
 * Ensures consistent field names and types across the application
 */

import { BrandResolution, ParsedListing } from "./keywordMarket";

// NOTE: ParsedListing interface is defined in keywordMarket.ts
// This file exports normalizeListing function that returns ParsedListing
// The interface is imported/exported from keywordMarket.ts to avoid duplication

/**
 * Extracts main category BSR from product data (handles various formats)
 * CRITICAL: Uses main category BSR (index 0 of bestsellers_rank array), NOT subcategories
 */
function extractMainCategoryBSR(raw: any): { rank: number; category: string } | null {
  // CRITICAL: Use main category BSR (index 0), NOT subcategory
  // Try bestsellers_rank array first (Rainforest API format)
  if (raw.bestsellers_rank && Array.isArray(raw.bestsellers_rank) && raw.bestsellers_rank.length > 0) {
    const mainBSR = raw.bestsellers_rank[0];
    if (mainBSR.rank !== undefined && mainBSR.rank !== null) {
      const rank = parseInt(mainBSR.rank.toString().replace(/,/g, ""), 10);
      if (!isNaN(rank) && rank > 0) {
        const category = mainBSR.category || mainBSR.Category || mainBSR.category_name || null;
        return {
          rank,
          category: category || 'default'
        };
      }
    }
  }
  
  // Fallback: use main_category_bsr if already extracted
  if (raw.main_category_bsr !== undefined && raw.main_category_bsr !== null) {
    const rank = parseInt(raw.main_category_bsr.toString().replace(/,/g, ""), 10);
    if (!isNaN(rank) && rank > 0) {
      return {
        rank,
        category: raw.main_category || 'default'
      };
    }
  }
  
  // Legacy fallback: try direct bsr field
  if (raw.bsr !== undefined && raw.bsr !== null) {
    const rank = parseInt(raw.bsr.toString().replace(/,/g, ""), 10);
    if (!isNaN(rank) && rank > 0) {
      return {
        rank,
        category: raw.main_category || raw.category || 'default'
      };
    }
  }
  
  return null;
}

/**
 * Extracts brand from title locally (NO API CALLS)
 * Same logic as in keywordMarket.ts
 */
function extractBrandFromTitle(title: string | null): string | null {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return null;
  }

  // Common brand name patterns and normalizations
  const brandNormalizations: Record<string, string> = {
    'amazon basics': 'Amazon Basics',
    'amazonbasics': 'Amazon Basics',
    'bella': 'BELLA',
    'chefman': 'Chefman',
    'cuisinart': 'Cuisinart',
    'hamilton beach': 'Hamilton Beach',
    'instant pot': 'Instant Pot',
    'kitchenaid': 'KitchenAid',
    'ninja': 'Ninja',
    'oster': 'Oster',
    'presto': 'Presto',
    'sunbeam': 'Sunbeam',
  };

  // Pattern 1: First 1-3 capitalized words before common separators
  const pattern1 = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/);
  if (pattern1) {
    const candidate = pattern1[1].trim();
    // Normalize if known brand
    const normalized = brandNormalizations[candidate.toLowerCase()];
    if (normalized) {
      return normalized;
    }
    // Return as-is if it looks like a brand (2-3 words max, all capitalized start)
    if (candidate.split(/\s+/).length <= 3) {
      return candidate;
    }
  }

  // Pattern 2: All caps brand at start (e.g., "BESIGN", "FERVINOW")
  const pattern2 = title.match(/^([A-Z]{2,}(?:\s+[A-Z]{2,})?)/);
  if (pattern2) {
    return pattern2[1].trim();
  }

  return null;
}

/**
 * Normalizes a raw listing object from any source into a consistent ParsedListing format
 * 🚨 COST OPTIMIZATION: Extracts brand from title locally (NO API CALLS)
 */
export function normalizeListing(raw: any): ParsedListing {
  // Extract main category BSR (preferred method)
  const mainBSRData = extractMainCategoryBSR(raw);
  const main_category_bsr = mainBSRData ? mainBSRData.rank : null;
  const main_category = mainBSRData ? mainBSRData.category : null;
  
  // Legacy bsr field (for backward compatibility)
  const bsr = main_category_bsr ?? raw.bsr ?? raw.BSR ?? raw.best_seller_rank ?? raw.rank ?? null;
  
  // Extract title
  const title = raw.title ?? raw.Title ?? "";
  
  // 🚨 COST OPTIMIZATION: Extract brand from title locally if brand field is missing
  // CRITICAL: Always preserve raw_brand - never delete brands
  const explicitBrand = raw.brand ?? raw.Brand ?? null;
  const inferredBrand = title ? extractBrandFromTitle(title) : null;
  const brand = explicitBrand || inferredBrand;
  
  // Create brand_resolution structure
  const brand_resolution: BrandResolution = brand ? {
    raw_brand: brand, // ALWAYS preserve original brand string
    normalized_brand: brand, // Default to raw_brand (normalization can happen later)
    brand_status: explicitBrand ? 'canonical' : 'low_confidence', // Explicit brand is canonical, inferred is low_confidence
    brand_source: explicitBrand ? 'rainforest' : 'title_parse'
  } : {
    raw_brand: null,
    normalized_brand: null,
    brand_status: 'unknown',
    brand_source: 'fallback'
  };
  
  // Extract raw fields for presentation fallback (preserve if they exist)
  const raw_title = raw.raw_title ?? null;
  const raw_image_url = raw.raw_image_url ?? null;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FULFILLMENT NORMALIZATION: Never defaults to FBM, uses UNKNOWN if missing
  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 CANONICAL FULFILLMENT INFERENCE (SERP-based market analysis)
  // Rules: SP-API authoritative → Rainforest inferred → UNKNOWN (NEVER defaults to FBM)
  // This is market-level inference, not checkout accuracy.
  // If raw already has fulfillment with source/confidence, use it
  let fulfillment: "FBA" | "FBM" | "UNKNOWN" = raw.fulfillment === "FBA" || raw.fulfillment === "FBM" 
    ? raw.fulfillment 
    : null;
  let fulfillmentSource: 'sp_api' | 'rainforest_inferred' | 'unknown' = raw.fulfillmentSource || 'unknown';
  let fulfillmentConfidence: 'high' | 'medium' | 'low' = raw.fulfillmentConfidence || 'low';
  
  // If fulfillment is not already set, infer from Rainforest signals
  if (!fulfillment || fulfillment === null) {
    // Use the new inference function if available (from keywordMarket.ts)
    // Otherwise, use simplified inference
    if (raw.is_prime === true) {
      fulfillment = "FBA";
      fulfillmentSource = 'rainforest_inferred';
      fulfillmentConfidence = 'medium'; // is_prime alone is medium confidence
    } else if (raw.delivery) {
      const deliveryTagline = raw.delivery?.tagline || "";
      const deliveryText = raw.delivery?.text || raw.delivery?.message || "";
      const deliveryStr = (deliveryTagline + " " + deliveryText).toLowerCase();
      
      // Strong FBA indicators
      if (
        deliveryStr.includes("prime") ||
        deliveryStr.includes("get it") ||
        deliveryStr.includes("shipped by amazon") ||
        deliveryStr.includes("fulfilled by amazon") ||
        deliveryStr.includes("ships from amazon")
      ) {
        fulfillment = "FBA";
        fulfillmentSource = 'rainforest_inferred';
        fulfillmentConfidence = 'medium';
      }
      // Explicit FBM indicators
      else if (
        deliveryStr.includes("ships from") && 
        !deliveryStr.includes("amazon") &&
        (deliveryTagline || deliveryText)
      ) {
        fulfillment = "FBM";
        fulfillmentSource = 'rainforest_inferred';
        fulfillmentConfidence = 'medium';
      }
    }
    
    // Check explicit fulfillment fields
    if (!fulfillment && (raw.fba === true || raw.is_fba === true || raw.fulfillment_type === "FBA")) {
      fulfillment = "FBA";
      fulfillmentSource = 'rainforest_inferred';
      fulfillmentConfidence = 'high';
    } else if (!fulfillment && raw.fulfillment_type === "FBM") {
      fulfillment = "FBM";
      fulfillmentSource = 'rainforest_inferred';
      fulfillmentConfidence = 'high';
    }
  }
  
  // Fallback to UNKNOWN if still not set (NEVER default to FBM)
  if (!fulfillment || fulfillment === null) {
    fulfillment = "UNKNOWN";
    fulfillmentSource = 'unknown';
    fulfillmentConfidence = 'low';
  }
  
  // Extract sponsored fields
  // 🔒 CANONICAL SPONSORED DETECTION (NORMALIZED AT INGEST)
  // MANDATORY: Persist isSponsored through normalization
  // Do not drop or rename this field
  const isSponsored = raw.isSponsored ?? 
    (raw.sponsored === true ? true : undefined) ?? 
    raw.is_sponsored ?? 
    raw.IsSponsored ?? 
    false;
  const sponsoredPosition = isSponsored ? (raw.sponsored_position ?? raw.ad_position ?? null) : null;
  const sponsoredSource: 'rainforest_serp' | 'organic_serp' = raw.sponsored_source ?? (isSponsored ? 'rainforest_serp' : 'organic_serp');
  
  // Extract position (required field)
  const position = raw.position ?? raw.organic_rank ?? raw.Position ?? 0;
  
  // Extract image_url (required field): always string | null; coerce object with .link
  let image_url: string | null = null;
  const rawImage = raw.image_url ?? raw.image ?? raw.Image ?? raw.images?.[0] ?? null;
  if (typeof rawImage === "string" && rawImage.trim().length > 0) {
    image_url = rawImage.trim();
  } else if (rawImage && typeof rawImage === "object" && "link" in rawImage && typeof (rawImage as any).link === "string") {
    const link = (rawImage as any).link.trim();
    if (link.length > 0) image_url = link;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIME ELIGIBILITY MAPPING (PRESERVE FROM RAW OR INFER FROM is_prime)
  // ═══════════════════════════════════════════════════════════════════════════
  // Preserve primeEligible and fulfillment_status if already set, otherwise infer from is_prime
  const primeEligible = raw.primeEligible !== undefined 
    ? raw.primeEligible 
    : (raw.is_prime === true);
  const fulfillmentStatus: 'PRIME' | 'NON_PRIME' = raw.fulfillment_status 
    ? raw.fulfillment_status 
    : (primeEligible ? 'PRIME' : 'NON_PRIME');

  return {
    asin: raw.asin ?? raw.ASIN ?? "",
    title,
    price: raw.price?.value ?? raw.price ?? raw.Price ?? null,
    rating: raw.rating ?? raw.Rating ?? null,
    reviews: raw.reviews?.count ?? raw.reviews ?? raw.Reviews ?? raw.review_count ?? null,
    image_url, // Required field: use image_url, not image
    bsr, // DEPRECATED: use main_category_bsr
    main_category_bsr, // Main category BSR (top-level category only)
    main_category, // Main category name
    fulfillment,
    fulfillmentSource,
    fulfillmentConfidence,
    primeEligible, // Prime eligibility (from is_prime heuristic)
    fulfillment_status: fulfillmentStatus, // 'PRIME' | 'NON_PRIME' (heuristic, not FBA guarantee)
    // Canonical sponsored status: Use isSponsored if available, otherwise normalize from is_sponsored
    isSponsored,
    is_sponsored: isSponsored, // DEPRECATED: Use isSponsored instead. Kept for backward compatibility.
    sponsored_position: sponsoredPosition, // Required field
    sponsored_source: sponsoredSource, // Required field
    position, // Required field: organic rank (1-indexed position on Page 1)
    organic_rank: raw.organic_rank ?? raw.position ?? raw.Position ?? null, // Legacy field
    // ASIN-level sponsored aggregation (if available, otherwise default to instance-level)
    // CRITICAL: appearsSponsored is ASIN-level property, not instance-level
    appearsSponsored: typeof raw.appearsSponsored === 'boolean' 
      ? raw.appearsSponsored 
      : (raw.isSponsored ?? (raw.sponsored === true ? true : undefined) ?? raw.is_sponsored ?? raw.IsSponsored ?? false),
    sponsoredPositions: Array.isArray(raw.sponsoredPositions) ? raw.sponsoredPositions : [],
    brand, // DEPRECATED: Use brand_resolution.raw_brand instead
    brand_resolution, // Brand resolution structure (preserves all brands)
    // Preserve raw fields for presentation fallback
    raw_title,
    raw_image_url,
  } as ParsedListing & { raw_title?: string | null; raw_image_url?: string | null };
}
