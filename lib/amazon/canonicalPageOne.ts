/**
 * Canonical Page-1 Builder
 * 
 * Reconstructs a deterministic Page-1 product set from available data.
 * Always returns ~49 product cards, even with 0, partial, or full listings (matching Amazon Page 1).
 * 
 * Features:
 * - Power-law position decay for unit distribution
 * - Price tiered multipliers around avg_price
 * - Revenue normalization to snapshot totals
 * - Realistic ratings & reviews generation
 * - Tags inferred fields as snapshot_inferred
 * 
 * Does NOT depend on BSR - uses position-based math only.
 */

import { ParsedListing, KeywordMarketSnapshot } from "./keywordMarket";

export interface CanonicalProduct {
  rank: number;
  asin: string;
  title: string;
  image_url: string | null;
  price: number;
  rating: number;
  review_count: number;
  bsr: number | null;
  estimated_monthly_units: number;
  estimated_monthly_revenue: number;
  revenue_share_pct: number;
  fulfillment: "FBA" | "FBM" | "AMZ";
  brand: string | null;
  seller_country: "US" | "CN" | "Other" | "Unknown";
  snapshot_inferred: boolean; // True if field was inferred from snapshot
  snapshot_inferred_fields?: string[]; // List of fields that were inferred
}

/**
 * Build canonical Page-1 product set
 * 
 * @param listings - Raw listings (can be empty, partial, or full)
 * @param snapshot - Market snapshot with aggregated data
 * @param keyword - Search keyword
 * @param marketplace - Marketplace identifier
 * @param rawRainforestData - Optional map of raw Rainforest API data by ASIN for multi-source BSR extraction
 * @returns Array of ~49 canonical products (matching Amazon Page 1)
 */
export async function buildCanonicalPageOne(
  listings: ParsedListing[],
  snapshot: KeywordMarketSnapshot,
  keyword: string,
  marketplace: string = "US",
  rawRainforestData?: Map<string, any>,
  supabase?: any
): Promise<CanonicalProduct[]> {
  const TARGET_PRODUCT_COUNT = 49; // Amazon Page 1 typically shows ~49 products
  
  // Get snapshot totals
  // CRITICAL: If snapshot totals are 0 or missing, compute them using deterministic logic
  // This ensures canonical products always have meaningful units/revenue values
  const avgPrice = snapshot.avg_price ?? 25;
  const avgRating = snapshot.avg_rating ?? 4.2;
  const avgReviews = snapshot.avg_reviews ?? 0;
  
  // Get totals from snapshot, but fallback to computation if 0 or missing
  let totalUnits = snapshot.est_total_monthly_units_min ?? snapshot.est_total_monthly_units_max ?? null;
  let totalRevenue = snapshot.est_total_monthly_revenue_min ?? snapshot.est_total_monthly_revenue_max ?? null;
  
  // Fallback: If totals are 0 or null, compute using deterministic logic (150 units per listing)
  if (totalUnits === null || totalUnits <= 0) {
    const estUnitsPerListing = 150;
    const page1Count = snapshot.total_page1_listings || TARGET_PRODUCT_COUNT;
    const computedTotalUnits = page1Count * estUnitsPerListing;
    totalUnits = Math.round(computedTotalUnits * 0.7); // Use min (70% of base)
  }
  
  // Fallback: If revenue is 0 or null, compute from units
  if (totalRevenue === null || totalRevenue <= 0) {
    totalRevenue = Math.round((totalUnits * avgPrice) * 100) / 100;
  }
  
  // Filter organic listings only (exclude sponsored)
  const organicListings = listings.filter(l => !l.is_sponsored);
  
  // Determine how many products we need to generate
  const existingCount = organicListings.length;
  const needToGenerate = Math.max(0, TARGET_PRODUCT_COUNT - existingCount);
  
  // Build products from existing listings
  const products: CanonicalProduct[] = [];
  
  // Process existing listings (up to 20)
  for (let i = 0; i < Math.min(existingCount, TARGET_PRODUCT_COUNT); i++) {
    const listing = organicListings[i];
    const position = i + 1;
    
    // Get full_listing_object if it exists (for hydration)
    const fullListingObject = (listing as any).full_listing_object || listing;
    
    // Use real data where available, infer where missing
    const inferredFields: string[] = [];
    
    const asin = listing.asin || `INFERRED-${position}`;
    if (!listing.asin) inferredFields.push('asin');
    
    const title = listing.title || `${keyword} - Product ${position}`;
    if (!listing.title) inferredFields.push('title');
    
    // Image URL: use real if available (check both 'image' and 'image_url' for compatibility), otherwise use SVG placeholder
    // HYDRATE: If null, try full_listing_object.image
    let image_url = (listing as any).image_url || (listing as any).image || null;
    if (image_url === null && fullListingObject) {
      image_url = fullListingObject.image || fullListingObject.image_url || null;
    }
    if (image_url === null) {
      image_url = getPlaceholderImageUrl(keyword, position);
      inferredFields.push('image_url');
    }
    
    // Price: use real if available, otherwise use tiered multiplier
    let price: number;
    if (listing.price !== null && listing.price !== undefined && listing.price > 0) {
      price = listing.price;
    } else {
      price = applyPriceTierMultiplier(avgPrice, position);
      inferredFields.push('price');
    }
    
    // Rating: use real if available, otherwise generate realistic
    let rating: number;
    if (listing.rating !== null && listing.rating !== undefined && listing.rating > 0) {
      rating = listing.rating;
    } else {
      rating = generateRealisticRating(avgRating, position);
      inferredFields.push('rating');
    }
    
    // Reviews: use real if available, otherwise generate realistic
    let review_count: number;
    if (listing.reviews !== null && listing.reviews !== undefined && listing.reviews > 0) {
      review_count = listing.reviews;
    } else {
      review_count = generateRealisticReviews(avgReviews, position, rating);
      inferredFields.push('review_count');
    }
    
    // Units: HYDRATE from full_listing_object.units_est if null, otherwise calculate using power-law
    let monthlyUnits: number;
    if (listing.est_monthly_units !== null && listing.est_monthly_units !== undefined && listing.est_monthly_units > 0) {
      monthlyUnits = listing.est_monthly_units;
    } else if (fullListingObject && (fullListingObject.units_est !== null && fullListingObject.units_est !== undefined && fullListingObject.units_est > 0)) {
      monthlyUnits = fullListingObject.units_est;
    } else {
      // Calculate using power-law position decay (for 49 products, use 50 - position)
      const positionWeight = Math.pow(TARGET_PRODUCT_COUNT + 1 - position, 1.35);
      const totalWeight = calculateTotalPositionWeight(TARGET_PRODUCT_COUNT);
      monthlyUnits = Math.round((totalUnits * positionWeight) / totalWeight);
      inferredFields.push('estimated_monthly_units');
    }
    
    // Revenue: HYDRATE from full_listing_object.revenue_est if null, otherwise calculate
    let monthlyRevenue: number;
    if (listing.est_monthly_revenue !== null && listing.est_monthly_revenue !== undefined && listing.est_monthly_revenue > 0) {
      monthlyRevenue = listing.est_monthly_revenue;
    } else if (fullListingObject && (fullListingObject.revenue_est !== null && fullListingObject.revenue_est !== undefined && fullListingObject.revenue_est > 0)) {
      monthlyRevenue = fullListingObject.revenue_est;
    } else {
      // Revenue: units × price
      monthlyRevenue = Math.round(monthlyUnits * price * 100) / 100;
      inferredFields.push('estimated_monthly_revenue');
    }
    
    // Fulfillment: use real if available, otherwise default to "FBA"
    let fulfillment: "FBA" | "FBM" | "AMZ";
    if (listing.fulfillment) {
      fulfillment = listing.fulfillment === "FBA" ? "FBA" : 
                    listing.fulfillment === "Amazon" ? "AMZ" : "FBM";
    } else {
      // Default to "FBA" for generated listings
      fulfillment = "FBA";
      inferredFields.push('fulfillment');
    }
    
    // Brand: use real if available
    const brand = listing.brand || null;
    if (!listing.brand) inferredFields.push('brand');
    
    // Seller country: infer from brand or default
    let seller_country: "US" | "CN" | "Other" | "Unknown";
    if (brand) {
      const brandLower = brand.toLowerCase();
      if (brandLower.includes("cn") || brandLower.includes("china") || 
          brandLower.includes("shenzhen") || brandLower.includes("guangzhou")) {
        seller_country = "CN";
      } else {
        seller_country = "US";
      }
    } else {
      seller_country = "Unknown";
    }
    if (!listing.brand) inferredFields.push('seller_country');
    
    products.push({
      rank: position,
      asin,
      title,
      image_url,
      price,
      rating,
      review_count,
      // BSR: HYDRATE from full_listing_object.bsr if null, otherwise use real if available and not marked invalid
      bsr: (() => {
        // First try listing BSR
        if ((listing.main_category_bsr || listing.bsr) && !listing.bsr_invalid_reason) {
          return (listing.main_category_bsr || listing.bsr);
        }
        // Then try full_listing_object.bsr
        if (fullListingObject && fullListingObject.bsr !== null && fullListingObject.bsr !== undefined) {
          return fullListingObject.bsr;
        }
        return null;
      })(),
      estimated_monthly_units: monthlyUnits,
      estimated_monthly_revenue: monthlyRevenue,
      revenue_share_pct: 0, // Will be calculated after normalization
      fulfillment,
      brand,
      seller_country,
      snapshot_inferred: inferredFields.length > 0,
      snapshot_inferred_fields: inferredFields.length > 0 ? inferredFields : undefined,
    });
  }
  
  // Generate missing products if needed
  for (let i = existingCount; i < TARGET_PRODUCT_COUNT; i++) {
    const position = i + 1;
    
    // Power-law position decay (for 49 products, use 50 - position)
    const positionWeight = Math.pow(TARGET_PRODUCT_COUNT + 1 - position, 1.35);
    const totalWeight = calculateTotalPositionWeight(TARGET_PRODUCT_COUNT);
    const monthlyUnits = Math.round((totalUnits * positionWeight) / totalWeight);
    
    // Price: tiered multiplier around avg_price
    const price = applyPriceTierMultiplier(avgPrice, position);
    
    // Revenue: units × price
    const monthlyRevenue = Math.round(monthlyUnits * price * 100) / 100;
    
    // Rating: generate realistic based on position (default 4.1-4.5 for generated)
    const rating = generateRealisticRating(avgRating, position);
    // Ensure rating is between 4.1-4.5 for generated listings
    const finalRating = Math.max(4.1, Math.min(4.5, rating));
    
    // Reviews: generate realistic based on position and rating (default > 20)
    const review_count = Math.max(21, generateRealisticReviews(avgReviews, position, finalRating));
    
    // Fulfillment: default to "FBA" for generated listings
    const fulfillment: "FBA" | "FBM" | "AMZ" = "FBA";
    
    // Image URL: placeholder for generated listings
    const image_url = getPlaceholderImageUrl(keyword, position);
    
    products.push({
      rank: position,
      asin: `INFERRED-${position}`,
      title: `${keyword} - Product ${position}`,
      image_url,
      price,
      rating: finalRating,
      review_count,
      bsr: null,
      estimated_monthly_units: monthlyUnits,
      estimated_monthly_revenue: monthlyRevenue,
      revenue_share_pct: 0, // Will be calculated after normalization
      fulfillment,
      brand: null,
      seller_country: "Unknown",
      snapshot_inferred: true,
      snapshot_inferred_fields: ['asin', 'title', 'image_url', 'price', 'rating', 'review_count', 'bsr', 'fulfillment', 'brand', 'seller_country'],
    });
  }
  
  // Normalize revenue totals to match snapshot
  const currentTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (totalRevenue > 0 && currentTotalRevenue > 0) {
    const normalizationFactor = totalRevenue / currentTotalRevenue;
    products.forEach(p => {
      p.estimated_monthly_revenue = Math.round(p.estimated_monthly_revenue * normalizationFactor * 100) / 100;
      // Recalculate units to maintain price consistency
      p.estimated_monthly_units = Math.round(p.estimated_monthly_revenue / p.price);
    });
  }
  
  // Calculate revenue share percentages
  const finalTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (finalTotalRevenue > 0) {
    products.forEach(p => {
      p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / finalTotalRevenue) * 100 * 100) / 100;
    });
  }
  
  // Apply BSR duplicate detection, then multi-source extraction
  const afterDuplicateDetection = applyBsrDuplicateDetection(products);
  // Extract main category from listings if available (for category matching)
  const mainCategory = listings.length > 0 && listings[0]?.main_category 
    ? listings[0].main_category 
    : null;
  const afterBsrExtraction = applyMultiSourceBsrExtraction(afterDuplicateDetection, rawRainforestData, mainCategory);
  
  // Apply Page-1 demand calibration using top BSR performance
  const afterCalibration = calibratePageOneUnits(afterBsrExtraction);
  
  // Apply ASIN-level historical blending
  const finalProducts = await blendWithAsinHistory(afterCalibration, marketplace, supabase);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HYDRATE NULL FIELDS FROM FULL_LISTING_OBJECT
  // ═══════════════════════════════════════════════════════════════════════════
  // Final hydration pass: if any canonical fields are null, try to hydrate from original listing data
  const hydratedProducts = finalProducts.map((product, index) => {
    // Find the original listing for this product (match by ASIN or position)
    const originalListing = organicListings.find(
      (l, idx) => (l.asin && l.asin === product.asin) || idx === index
    );
    
    if (!originalListing) {
      return product; // No original listing to hydrate from
    }
    
    // Get full_listing_object if it exists (for hydration)
    const fullListingObject = (originalListing as any).full_listing_object || originalListing;
    
    // Hydrate null fields from full_listing_object
    // CRITICAL: Only hydrate if the canonical field is null/undefined/0, preserving calculated values
    const hydrated: CanonicalProduct = { ...product };
    
    // Hydrate estimated_units if null or zero (indicating it was calculated/inferred)
    const needsUnitsHydration = hydrated.estimated_monthly_units === null || 
                                 hydrated.estimated_monthly_units === undefined || 
                                 hydrated.estimated_monthly_units === 0;
    
    if (needsUnitsHydration && fullListingObject) {
      // Priority: full_listing_object.units_est > originalListing.est_monthly_units
      if (fullListingObject.units_est !== null && fullListingObject.units_est !== undefined && fullListingObject.units_est > 0) {
        hydrated.estimated_monthly_units = fullListingObject.units_est;
      } else if (originalListing.est_monthly_units !== null && originalListing.est_monthly_units !== undefined && originalListing.est_monthly_units > 0) {
        hydrated.estimated_monthly_units = originalListing.est_monthly_units;
      }
    }
    
    // Hydrate estimated_revenue if null or zero (indicating it was calculated/inferred)
    const needsRevenueHydration = hydrated.estimated_monthly_revenue === null || 
                                  hydrated.estimated_monthly_revenue === undefined || 
                                  hydrated.estimated_monthly_revenue === 0;
    
    if (needsRevenueHydration && fullListingObject) {
      // Priority: full_listing_object.revenue_est > originalListing.est_monthly_revenue
      if (fullListingObject.revenue_est !== null && fullListingObject.revenue_est !== undefined && fullListingObject.revenue_est > 0) {
        hydrated.estimated_monthly_revenue = fullListingObject.revenue_est;
      } else if (originalListing.est_monthly_revenue !== null && originalListing.est_monthly_revenue !== undefined && originalListing.est_monthly_revenue > 0) {
        hydrated.estimated_monthly_revenue = originalListing.est_monthly_revenue;
      }
    }
    
    // Hydrate image_url if null (always hydrate if missing)
    if ((hydrated.image_url === null || hydrated.image_url === undefined || hydrated.image_url.startsWith('data:image/svg+xml')) && fullListingObject) {
      // Priority: full_listing_object.image > full_listing_object.image_url > originalListing fields
      if (fullListingObject.image && !fullListingObject.image.startsWith('data:image/svg+xml')) {
        hydrated.image_url = fullListingObject.image;
      } else if (fullListingObject.image_url && !fullListingObject.image_url.startsWith('data:image/svg+xml')) {
        hydrated.image_url = fullListingObject.image_url;
      } else if (originalListing.image_url && !originalListing.image_url.startsWith('data:image/svg+xml')) {
        hydrated.image_url = originalListing.image_url;
      } else if ((originalListing as any).image && !(originalListing as any).image.startsWith('data:image/svg+xml')) {
        hydrated.image_url = (originalListing as any).image;
      }
    }
    
    // Hydrate bsr if null (always hydrate if missing)
    if (hydrated.bsr === null || hydrated.bsr === undefined) {
      // Priority: full_listing_object.bsr > originalListing.main_category_bsr > originalListing.bsr
      if (fullListingObject && fullListingObject.bsr !== null && fullListingObject.bsr !== undefined) {
        hydrated.bsr = fullListingObject.bsr;
      } else if (originalListing.main_category_bsr !== null && originalListing.main_category_bsr !== undefined) {
        hydrated.bsr = originalListing.main_category_bsr;
      } else if (originalListing.bsr !== null && originalListing.bsr !== undefined) {
        hydrated.bsr = originalListing.bsr;
      }
    }
    
    return hydrated;
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — CONFIRM CANONICAL PAGE-1 OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════
  // Log the output returned from the canonical Page-1 builder
  const first5Output = hydratedProducts.slice(0, 5);
  console.log("🔍 STEP_3_CANONICAL_PAGE1_OUTPUT", {
    keyword,
    total_products: hydratedProducts.length,
    first_5_products: first5Output.map((product: CanonicalProduct, idx: number) => ({
      index: idx + 1,
      asin: product.asin || null,
      estimated_units: product.estimated_monthly_units || null,
      estimated_revenue: product.estimated_monthly_revenue || null,
      bsr: product.bsr || null,
      image_url: product.image_url || null,
    })),
    timestamp: new Date().toISOString(),
  });
  
  return hydratedProducts;
}

/**
 * BSR Duplicate Detection
 * 
 * Scans Page-1 listings and identifies BSR values that appear ≥ 8 times.
 * For any listing with a duplicated BSR, sets bsr = null.
 * 
 * This neutralizes Rainforest API bugs where the same BSR appears across many products.
 * 
 * @param products - Canonical products to scan
 * @returns Products with duplicated BSRs nullified
 */
function applyBsrDuplicateDetection(products: CanonicalProduct[]): CanonicalProduct[] {
  // Count BSR occurrences
  const bsrCounts: Record<number, number> = {};
  
  for (const product of products) {
    const bsr = product.bsr;
    if (bsr !== null && bsr !== undefined && bsr > 0) {
      bsrCounts[bsr] = (bsrCounts[bsr] || 0) + 1;
    }
  }
  
  // Find BSRs that appear ≥ 8 times (invalid duplicates)
  const invalidBSRs = new Set<number>();
  
  for (const [bsrStr, count] of Object.entries(bsrCounts)) {
    if (count >= 8) {
      const bsr = parseInt(bsrStr, 10);
      invalidBSRs.add(bsr);
      console.log(`🔵 BSR_DUPLICATE_DETECTED: BSR ${bsr} appears ${count} times in canonical Page-1 - marking as invalid`);
    }
  }
  
  // Nullify duplicated BSRs (leave all other fields untouched)
  if (invalidBSRs.size > 0) {
    console.log("🔵 BSR_DUPLICATE_DETECTION_COMPLETE", {
      invalid_bsr_count: invalidBSRs.size,
      total_products: products.length,
      affected_products: products.filter(p => p.bsr !== null && invalidBSRs.has(p.bsr)).length,
    });
    
    return products.map(product => {
      if (product.bsr !== null && invalidBSRs.has(product.bsr)) {
        return {
          ...product,
          bsr: null, // Set bsr to null, leave all other fields untouched
        };
      }
      return product;
    });
  }
  
  return products;
}

/**
 * Multi-Source BSR Extraction
 * 
 * Attempts to recover valid BSRs from multiple Rainforest API sources when BSR is null.
 * Only extracts if current BSR is null (does not override valid existing BSRs).
 * 
 * Extraction priority:
 * 1. bestsellers_rank[] (prefer category-matched entries, choose lowest rank)
 * 2. sales_rank.current_rank
 * 3. buying_choice.bestsellers_rank (number or array)
 * 
 * @param products - Canonical products (after duplicate detection)
 * @param rawRainforestData - Optional map of raw Rainforest API data by ASIN
 * @param mainCategory - Main category name for category matching
 * @returns Products with recovered BSRs where possible
 */
function applyMultiSourceBsrExtraction(
  products: CanonicalProduct[],
  rawRainforestData?: Map<string, any>,
  mainCategory?: string | null
): CanonicalProduct[] {
  // If no raw data available, return products unchanged
  if (!rawRainforestData || rawRainforestData.size === 0) {
    return products;
  }
  
  // Validation helper: BSR must be a number in range 1-300,000
  const isValidBSR = (bsr: number | null | undefined): bsr is number => {
    return typeof bsr === "number" && bsr >= 1 && bsr <= 300000;
  };
  
  let recoveredCount = 0;
  
  const result = products.map(product => {
    // Only attempt extraction if BSR is currently null
    if (product.bsr !== null) {
      return product; // Don't override valid existing BSR
    }
    
    // Get raw Rainforest data for this ASIN
    const rawData = rawRainforestData.get(product.asin);
    if (!rawData) {
      return product; // No raw data available for this ASIN
    }
    
    // Extract best BSR using multi-source priority
    const extracted = extractBestBsr(rawData, mainCategory || null);
    
    if (extracted.bsr !== null) {
      recoveredCount++;
      return {
        ...product,
        bsr: extracted.bsr, // Recovered BSR
      };
    }
    
    return product; // No valid BSR found in raw data
  });
  
  // Log recovery results if any BSRs were recovered
  if (recoveredCount > 0) {
    console.log("🔵 BSR_MULTI_SOURCE_EXTRACTION_COMPLETE", {
      recovered_count: recoveredCount,
      total_products: products.length,
    });
  }
  
  return result;
}

/**
 * Extract best BSR from raw Rainforest API data using multi-source priority
 * 
 * Priority order:
 * 1. bestsellers_rank[] (prefer category-matched, choose lowest rank)
 * 2. sales_rank.current_rank
 * 3. buying_choice.bestsellers_rank (number or array)
 * 
 * @param item - Raw Rainforest API item data
 * @param mainCategory - Main category name for category matching (optional)
 * @returns Object with bsr and main_category_bsr (both same value or null)
 */
function extractBestBsr(
  item: any,
  mainCategory: string | null
): { bsr: number | null; main_category_bsr: number | null } {
  if (!item) {
    return { bsr: null, main_category_bsr: null };
  }
  
  // Validation helper: BSR must be a number in range 1-300,000
  const isValidBSR = (bsr: number | null | undefined): bsr is number => {
    return typeof bsr === "number" && bsr >= 1 && bsr <= 300000;
  };
  
  const candidateBSRs: { rank: number; source: string; categoryMatch: boolean }[] = [];
  
  // SOURCE A: bestsellers_rank[] array (prefer category-matched entries, choose lowest rank)
  if (item.bestsellers_rank && Array.isArray(item.bestsellers_rank)) {
    for (const entry of item.bestsellers_rank) {
      if (!entry || typeof entry !== 'object') continue;
      
      const rankValue = entry.rank ?? 
                       entry.Rank ?? 
                       entry.rank_value ?? 
                       entry.value;
      
      if (rankValue !== undefined && rankValue !== null) {
        const rank = parseInt(rankValue.toString().replace(/,/g, ""), 10);
        
        if (isValidBSR(rank)) {
          const categoryStr = entry.category || 
                              entry.Category || 
                              entry.category_name || 
                              entry.name ||
                              entry.category_path ||
                              '';
          
          // Check if category matches main category (if provided)
          const categoryMatch = mainCategory 
            ? categoryStr.toLowerCase().includes(mainCategory.toLowerCase())
            : false;
          
          candidateBSRs.push({
            rank,
            source: "bestsellers_rank",
            categoryMatch,
          });
        }
      }
    }
  }
  
  // SOURCE B: sales_rank.current_rank
  if (item.sales_rank?.current_rank !== undefined && item.sales_rank.current_rank !== null) {
    const rank = parseInt(item.sales_rank.current_rank.toString().replace(/,/g, ""), 10);
    if (isValidBSR(rank)) {
      candidateBSRs.push({
        rank,
        source: "sales_rank",
        categoryMatch: false,
      });
    }
  }
  
  // SOURCE C: buying_choice.bestsellers_rank (accept number or array)
  if (item.buying_choice?.bestsellers_rank !== undefined && item.buying_choice.bestsellers_rank !== null) {
    const bcBsr = item.buying_choice.bestsellers_rank;
    
    // Handle number format
    if (typeof bcBsr === 'number') {
      const rank = parseInt(bcBsr.toString().replace(/,/g, ""), 10);
      if (isValidBSR(rank)) {
        candidateBSRs.push({
          rank,
          source: "buying_choice",
          categoryMatch: false,
        });
      }
    } 
    // Handle array format
    else if (Array.isArray(bcBsr)) {
      for (const entry of bcBsr) {
        if (!entry || typeof entry !== 'object') continue;
        const rankValue = entry.rank ?? entry.Rank ?? entry.rank_value ?? entry.value;
        if (rankValue !== undefined && rankValue !== null) {
          const rank = parseInt(rankValue.toString().replace(/,/g, ""), 10);
          if (isValidBSR(rank)) {
            candidateBSRs.push({
              rank,
              source: "buying_choice_array",
              categoryMatch: false,
            });
          }
        }
      }
    }
  }
  
  // Select best BSR: prefer category-matched, then lowest rank
  if (candidateBSRs.length === 0) {
    return { bsr: null, main_category_bsr: null };
  }
  
  // Sort: category-matched first, then by rank (lowest first)
  candidateBSRs.sort((a, b) => {
    if (a.categoryMatch && !b.categoryMatch) return -1;
    if (!a.categoryMatch && b.categoryMatch) return 1;
    return a.rank - b.rank; // Lower rank is better
  });
  
  const bestBSR = candidateBSRs[0].rank;
  return { bsr: bestBSR, main_category_bsr: bestBSR };
}

/**
 * Page-1 Demand Calibration
 * 
 * Calibrates estimated monthly units using top BSR performance.
 * Uses the top 3 BSRs to compute expected total units and adjusts all estimates proportionally.
 * 
 * Formula:
 * - expectedTotalUnits = 600000 / pow(top3AvgBsr, 0.45)
 * - factor = expectedTotalUnits / rawTotalUnits
 * - factor clamped between 0.6 and 1.4
 * 
 * @param products - Canonical products (after BSR extraction)
 * @returns Products with calibrated unit and revenue estimates
 */
function calibratePageOneUnits(products: CanonicalProduct[]): CanonicalProduct[] {
  // Select listings with valid BSRs
  const listingsWithValidBSR = products.filter(p => 
    p.bsr !== null && 
    p.bsr !== undefined && 
    p.bsr >= 1 && 
    p.bsr <= 300000
  );
  
  // Skip calibration if fewer than 3 valid BSRs
  if (listingsWithValidBSR.length < 3) {
    console.log("🔵 PAGE1_CALIBRATION_SKIPPED", {
      reason: "insufficient_valid_bsrs",
      valid_bsr_count: listingsWithValidBSR.length,
      required: 3,
    });
    return products;
  }
  
  // Sort by BSR (lower is better) and get top 3
  const sortedByBSR = [...listingsWithValidBSR].sort((a, b) => (a.bsr || 0) - (b.bsr || 0));
  const top3 = sortedByBSR.slice(0, 3);
  
  // Compute top3AvgBsr
  const top3AvgBsr = top3.reduce((sum, p) => sum + (p.bsr || 0), 0) / top3.length;
  
  // Compute expected total units using calibration formula
  const expectedTotalUnits = 600000 / Math.pow(top3AvgBsr, 0.45);
  
  // Compute raw total units (sum of all estimated units)
  const rawTotalUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  
  // Compute calibration factor
  let factor = expectedTotalUnits / rawTotalUnits;
  
  // Clamp factor between 0.6 and 1.4
  factor = Math.max(0.6, Math.min(1.4, factor));
  
  // Apply factor evenly to all products
  const calibrated = products.map(product => {
    const adjustedUnits = Math.round(product.estimated_monthly_units * factor);
    const adjustedRevenue = Math.round(adjustedUnits * product.price * 100) / 100;
    
    return {
      ...product,
      estimated_monthly_units: adjustedUnits,
      estimated_monthly_revenue: adjustedRevenue,
    };
  });
  
  // Recalculate revenue share percentages after calibration
  const finalTotalRevenue = calibrated.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (finalTotalRevenue > 0) {
    calibrated.forEach(p => {
      p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / finalTotalRevenue) * 100 * 100) / 100;
    });
  }
  
  console.log("🔵 PAGE1_CALIBRATION_COMPLETE", {
    top3_avg_bsr: Math.round(top3AvgBsr),
    expected_total_units: Math.round(expectedTotalUnits),
    raw_total_units: Math.round(rawTotalUnits),
    calibration_factor: factor.toFixed(3),
    calibrated_total_units: Math.round(calibrated.reduce((sum, p) => sum + p.estimated_monthly_units, 0)),
    calibrated_total_revenue: Math.round(calibrated.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0)),
  });
  
  return calibrated;
}

/**
 * ASIN-Level Historical Blending
 * 
 * Blends current unit estimates with historical averages from asin_history table.
 * Uses 60% current + 40% history for listings with ≥ 3 history points.
 * 
 * @param products - Canonical products (after calibration)
 * @param marketplace - Marketplace identifier
 * @param supabase - Optional Supabase client for querying history
 * @returns Products with historically blended unit and revenue estimates
 */
async function blendWithAsinHistory(
  products: CanonicalProduct[],
  marketplace: string,
  supabase?: any
): Promise<CanonicalProduct[]> {
  // Skip if no supabase client provided
  if (!supabase) {
    return products;
  }
  
  // Extract ASINs from products (exclude synthetic ASINs)
  const asins = products
    .map(p => p.asin)
    .filter(asin => asin && !asin.startsWith('ESTIMATED-') && !asin.startsWith('INFERRED-'));
  
  if (asins.length === 0) {
    return products;
  }
  
  try {
    // Query asin_history for last 45 days, grouped by ASIN
    const fortyFiveDaysAgo = new Date();
    fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);
    
    const { data: historyData, error } = await supabase
      .from('asin_history')
      .select('asin, estimated_monthly_units, recorded_at')
      .in('asin', asins)
      .gte('recorded_at', fortyFiveDaysAgo.toISOString())
      .order('recorded_at', { ascending: false });
    
    if (error) {
      // Table may not exist yet - skip gracefully
      console.log("🔵 ASIN_HISTORY_BLEND_SKIPPED", {
        reason: "query_error",
        error: error.message,
      });
      return products;
    }
    
    if (!historyData || historyData.length === 0) {
      console.log("🔵 ASIN_HISTORY_BLEND_SKIPPED", {
        reason: "no_history_data",
        asin_count: asins.length,
      });
      return products;
    }
    
    // Group by ASIN and compute average units
    const historyByAsin = new Map<string, number[]>();
    
    for (const record of historyData) {
      if (record.asin && record.estimated_monthly_units !== null && record.estimated_monthly_units !== undefined) {
        const units = typeof record.estimated_monthly_units === 'number' 
          ? record.estimated_monthly_units 
          : parseFloat(record.estimated_monthly_units);
        
        if (!isNaN(units) && units > 0) {
          if (!historyByAsin.has(record.asin)) {
            historyByAsin.set(record.asin, []);
          }
          historyByAsin.get(record.asin)!.push(units);
        }
      }
    }
    
    // Compute averages and filter to ASINs with ≥ 3 history points
    const historyAverages = new Map<string, number>();
    
    for (const [asin, unitsArray] of historyByAsin.entries()) {
      if (unitsArray.length >= 3) {
        const avg = unitsArray.reduce((sum, u) => sum + u, 0) / unitsArray.length;
        historyAverages.set(asin, avg);
      }
    }
    
    if (historyAverages.size === 0) {
      console.log("🔵 ASIN_HISTORY_BLEND_SKIPPED", {
        reason: "insufficient_history_points",
        asins_with_history: historyByAsin.size,
        required_points: 3,
      });
      return products;
    }
    
    // Blend estimates: 60% current + 40% history
    let blendedCount = 0;
    
    const blended = products.map(product => {
      const historyAvg = historyAverages.get(product.asin);
      
      if (historyAvg === undefined) {
        return product; // No history for this ASIN - leave unchanged
      }
      
      // Blend: final_units = round(0.6 * current + 0.4 * history_avg)
      const blendedUnits = Math.round(0.6 * product.estimated_monthly_units + 0.4 * historyAvg);
      const blendedRevenue = Math.round(blendedUnits * product.price * 100) / 100;
      
      blendedCount++;
      
      return {
        ...product,
        estimated_monthly_units: blendedUnits,
        estimated_monthly_revenue: blendedRevenue,
      };
    });
    
    // Recalculate revenue share percentages after blending
    const finalTotalRevenue = blended.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
    if (finalTotalRevenue > 0) {
      blended.forEach(p => {
        p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / finalTotalRevenue) * 100 * 100) / 100;
      });
    }
    
    console.log("🔵 ASIN_HISTORY_BLEND_COMPLETE", {
      blended_count: blendedCount,
      total_products: products.length,
      asins_with_history: historyAverages.size,
    });
    
    return blended;
  } catch (error) {
    // Gracefully handle any errors (table missing, etc.)
    console.log("🔵 ASIN_HISTORY_BLEND_SKIPPED", {
      reason: "exception",
      error: error instanceof Error ? error.message : String(error),
    });
    return products;
  }
}

/**
 * Calculate total position weight for normalization
 */
function calculateTotalPositionWeight(count: number): number {
  let total = 0;
  for (let i = 1; i <= count; i++) {
    total += Math.pow(count + 1 - i, 1.35);
  }
  return total;
}

/**
 * Apply tiered price multiplier based on position
 * Top positions: premium prices
 * Mid positions: average prices
 * Lower positions: discount prices
 */
function applyPriceTierMultiplier(avgPrice: number, position: number): number {
  let multiplier: number;
  
  // Tiers scaled for ~49 products: top ~10%, next ~20%, next ~30%, bottom ~40%
  if (position <= 5) {
    // Top 5: premium (110-120% of average)
    multiplier = 1.1 + ((position - 1) / 4) * 0.1; // 1.1 to 1.2
  } else if (position <= 15) {
    // Positions 6-15: above average (100-110% of average)
    multiplier = 1.0 + ((15 - position) / 10) * 0.1; // 1.1 to 1.0
  } else if (position <= 30) {
    // Positions 16-30: average to below average (90-100% of average)
    multiplier = 0.9 + ((30 - position) / 15) * 0.1; // 1.0 to 0.9
  } else {
    // Positions 31-49: discount (80-90% of average)
    multiplier = 0.8 + ((49 - position) / 19) * 0.1; // 0.9 to 0.8
  }
  
  return Math.round(avgPrice * multiplier * 100) / 100;
}

/**
 * Generate realistic rating based on position and average
 * Top positions tend to have higher ratings
 */
function generateRealisticRating(avgRating: number, position: number): number {
  // Top positions: slightly above average
  // Lower positions: slightly below average
  // Tiers scaled for ~49 products
  let adjustment = 0;
  
  if (position <= 5) {
    adjustment = 0.15; // Top 5: +0.15
  } else if (position <= 15) {
    adjustment = 0.05; // Positions 6-15: +0.05
  } else if (position <= 30) {
    adjustment = -0.05; // Positions 16-30: -0.05
  } else {
    adjustment = -0.15; // Positions 31-49: -0.15
  }
  
  // Add small random variance (±0.1)
  const variance = (Math.random() - 0.5) * 0.2;
  const rating = Math.max(3.0, Math.min(5.0, avgRating + adjustment + variance));
  
  return Math.round(rating * 10) / 10; // Round to 1 decimal
}

/**
 * Generate realistic review count based on position, average, and rating
 * Higher ratings and top positions = more reviews
 */
/**
 * Generate a placeholder image URL using SVG data URL
 * This ensures images always load without requiring external services
 */
function getPlaceholderImageUrl(keyword: string, position: number): string {
  // Create an SVG placeholder image as a data URL
  // This avoids dependency on external placeholder services
  const svg = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="300" fill="#f3f4f6"/><text x="50%" y="50%" font-family="Arial,sans-serif" font-size="14" fill="#9ca3af" text-anchor="middle" dy=".3em">No Image</text></svg>`;
  
  // Use encodeURIComponent for data URL (works in both Node.js and browser)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function generateRealisticReviews(avgReviews: number, position: number, rating: number): number {
  // Base multiplier from position (top positions have more reviews)
  // Tiers scaled for ~49 products
  let positionMultiplier: number;
  
  if (position <= 5) {
    positionMultiplier = 1.5; // Top 5: 1.5x
  } else if (position <= 15) {
    positionMultiplier = 1.2; // Positions 6-15: 1.2x
  } else if (position <= 30) {
    positionMultiplier = 0.9; // Positions 16-30: 0.9x
  } else {
    positionMultiplier = 0.6; // Positions 31-49: 0.6x
  }
  
  // Rating boost (higher ratings = more reviews)
  const ratingBoost = rating >= 4.5 ? 1.2 : rating >= 4.0 ? 1.0 : 0.8;
  
  // Calculate base reviews
  let reviews = avgReviews * positionMultiplier * ratingBoost;
  
  // Add variance (±30%)
  const variance = (Math.random() - 0.5) * 0.6;
  reviews = reviews * (1 + variance);
  
  // Ensure minimum of 10 reviews for realistic products
  return Math.max(10, Math.round(reviews));
}

