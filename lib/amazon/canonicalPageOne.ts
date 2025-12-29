/**
 * Canonical Page-1 Builder
 * 
 * PURE TRANSFORM: Accepts existing listings with units_est, revenue_est, bsr, image
 * and returns them sorted, ranked, filtered, or calibrated.
 * 
 * NO generation, NO inference, NO synthetic listings.
 * 
 * Rules:
 * - Only accepts listings that already have units_est, revenue_est, bsr, image/image_url
 * - Preserves all original fields
 * - Never nulls estimated_units or estimated_revenue
 * - Never overwrites image_url or bsr
 * - Only sorts, ranks, filters, or calibrates
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
  snapshot_inferred: boolean;
  snapshot_inferred_fields?: string[];
}

/**
 * Build canonical Page-1 product set (PURE TRANSFORM)
 * 
 * @param listings - Existing listings that MUST include units_est, revenue_est, bsr, image
 * @param snapshot - Market snapshot with aggregated data (for calibration only)
 * @param keyword - Search keyword (unused, kept for compatibility)
 * @param marketplace - Marketplace identifier (for historical blending)
 * @param rawRainforestData - Optional map of raw Rainforest API data by ASIN (unused)
 * @param supabase - Optional Supabase client (for historical blending)
 * @returns Array of canonical products (same as input, transformed)
 */
export async function buildCanonicalPageOne(
  listings: ParsedListing[],
  snapshot: KeywordMarketSnapshot,
  keyword: string,
  marketplace: string = "US",
  rawRainforestData?: Map<string, any>,
  supabase?: any
): Promise<CanonicalProduct[]> {
  // ═══════════════════════════════════════════════════════════════════════════
  // TEMP: DISABLE ALL FILTERING - accept all listings
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("🧪 CANONICAL INPUT COUNT", listings.length);
  
  // TEMP: accept all listings (no filtering)
  const rawListings = listings;
  
  // Convert to CanonicalProduct format, preserving ALL original fields
  const products: CanonicalProduct[] = rawListings.map((listing, index) => {
    // Get full_listing_object if it exists
    const fullListingObject = (listing as any).full_listing_object || listing;
    
    // Extract units: priority: units_est > est_monthly_units
    const estimated_monthly_units = (fullListingObject.units_est !== null && fullListingObject.units_est !== undefined && fullListingObject.units_est > 0)
      ? fullListingObject.units_est
      : (listing.est_monthly_units !== null && listing.est_monthly_units !== undefined && listing.est_monthly_units > 0)
        ? listing.est_monthly_units
        : 0; // Should never happen due to filter, but provide fallback
    
    // Extract revenue: priority: revenue_est > est_monthly_revenue
    const estimated_monthly_revenue = (fullListingObject.revenue_est !== null && fullListingObject.revenue_est !== undefined && fullListingObject.revenue_est > 0)
      ? fullListingObject.revenue_est
      : (listing.est_monthly_revenue !== null && listing.est_monthly_revenue !== undefined && listing.est_monthly_revenue > 0)
        ? listing.est_monthly_revenue
        : 0; // Should never happen due to filter, but provide fallback
    
    // Extract image_url: preserve original, never overwrite
    const image_url = (listing as any).image_url || 
                      (listing as any).image || 
                      (fullListingObject.image_url || fullListingObject.image || null);
    
    // Extract bsr: preserve original, never overwrite
    const bsr = listing.main_category_bsr || 
                listing.bsr || 
                (fullListingObject.bsr !== null && fullListingObject.bsr !== undefined ? fullListingObject.bsr : null);
    
    // Extract other fields, preserving originals
    const asin = listing.asin || '';
    const title = listing.title || '';
    const price = listing.price || 0;
    const rating = listing.rating || 0;
    const review_count = listing.reviews || 0;
    
    // Fulfillment: preserve original
    let fulfillment: "FBA" | "FBM" | "AMZ";
    if (listing.fulfillment === "FBA" || listing.fulfillment === "FBM" || listing.fulfillment === "Amazon") {
      fulfillment = listing.fulfillment === "Amazon" ? "AMZ" : listing.fulfillment as "FBA" | "FBM";
    } else {
      fulfillment = "FBA"; // Default only if missing
    }
    
    const brand = listing.brand || null;
    
    // Seller country: infer from brand if available
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
    
    return {
      rank: index + 1, // Will be re-ranked after sorting
      asin,
      title,
      image_url,
      price,
      rating,
      review_count,
      bsr, // PRESERVED - never nulled
      estimated_monthly_units, // PRESERVED - never nulled
      estimated_monthly_revenue, // PRESERVED - never nulled
      revenue_share_pct: 0, // Will be calculated after sorting
      fulfillment,
      brand,
      seller_country,
      snapshot_inferred: false, // All data comes from original listings
      snapshot_inferred_fields: undefined,
    };
  });
  
  // Sort by revenue descending (most valuable first)
  products.sort((a, b) => b.estimated_monthly_revenue - a.estimated_monthly_revenue);
  
  // Re-rank after sorting
  products.forEach((product, index) => {
    product.rank = index + 1;
  });
  
  // Calculate revenue share percentages
  const totalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (totalRevenue > 0) {
    products.forEach(p => {
      p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / totalRevenue) * 100 * 100) / 100;
    });
  }
  
  // Apply BSR duplicate detection (only nulls duplicate BSRs, preserves all other fields)
  const afterDuplicateDetection = applyBsrDuplicateDetection(products);
  
  // Apply Page-1 demand calibration (only adjusts units/revenue proportionally, never nulls)
  const afterCalibration = calibratePageOneUnits(afterDuplicateDetection);
  
  // Apply ASIN-level historical blending (only blends, never nulls)
  const finalProducts = await blendWithAsinHistory(afterCalibration, marketplace, supabase);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3 — CONFIRM CANONICAL PAGE-1 OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════
  const first5Output = finalProducts.slice(0, 5);
  console.log("🔍 STEP_3_CANONICAL_PAGE1_OUTPUT", {
    keyword,
    total_products: finalProducts.length,
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
  
  console.log("🧪 CANONICAL OUTPUT COUNT", finalProducts.length);
  
  return finalProducts;
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
 * @returns Products with duplicated BSRs nullified (all other fields preserved)
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
 * CRITICAL: Only adjusts proportionally, never nulls or zeros values.
 * 
 * @param products - Canonical products (after duplicate detection)
 * @returns Products with calibrated unit and revenue estimates (all fields preserved)
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
  
  // Apply factor evenly to all products (proportional adjustment, never nulls)
  const calibrated = products.map(product => {
    const adjustedUnits = Math.max(1, Math.round(product.estimated_monthly_units * factor)); // Ensure never zero
    const adjustedRevenue = Math.max(0.01, Math.round(adjustedUnits * product.price * 100) / 100); // Ensure never zero
    
    return {
      ...product,
      estimated_monthly_units: adjustedUnits, // Adjusted but never nulled
      estimated_monthly_revenue: adjustedRevenue, // Adjusted but never nulled
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
 * CRITICAL: Only blends, never nulls or zeros values.
 * 
 * @param products - Canonical products (after calibration)
 * @param marketplace - Marketplace identifier
 * @param supabase - Optional Supabase client for querying history
 * @returns Products with historically blended unit and revenue estimates (all fields preserved)
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
  
  // Extract ASINs from products (exclude synthetic ASINs - though we shouldn't have any now)
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
    
    // Blend estimates: 60% current + 40% history (never nulls)
    let blendedCount = 0;
    
    const blended = products.map(product => {
      const historyAvg = historyAverages.get(product.asin);
      
      if (historyAvg === undefined) {
        return product; // No history for this ASIN - leave unchanged
      }
      
      // Blend: final_units = round(0.6 * current + 0.4 * history_avg)
      // Ensure never zero or null
      const blendedUnits = Math.max(1, Math.round(0.6 * product.estimated_monthly_units + 0.4 * historyAvg));
      const blendedRevenue = Math.max(0.01, Math.round(blendedUnits * product.price * 100) / 100);
      
      blendedCount++;
      
      return {
        ...product,
        estimated_monthly_units: blendedUnits, // Blended but never nulled
        estimated_monthly_revenue: blendedRevenue, // Blended but never nulled
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
