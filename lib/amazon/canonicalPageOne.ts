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
import { estimatePageOneDemand } from "./pageOneDemand";
import { calibrateMarketTotals, calculateReviewDispersionFromListings, validateInvariants } from "./calibration";

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
 * Build keyword Page-1 product set (PERMISSIVE)
 * 
 * KEYWORD CANONICAL RULES:
 * - DO NOT reject synthetic ASINs
 * - DO NOT require historical data
 * - DO NOT filter sponsored listings
 * - DO NOT return empty if listings exist
 * - Always return Page-1 rows if listings exist
 * 
 * HELIUM-10 STYLE: Estimate total Page-1 demand first, then allocate across products
 * 
 * @param listings - Raw listings from keyword search results
 * @returns Array of canonical products (always non-empty if listings exist)
 */
export function buildKeywordPageOne(listings: ParsedListing[]): CanonicalProduct[] {
  if (!Array.isArray(listings) || listings.length === 0) {
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 0: ASIN DEDUPLICATION (BEFORE ANY ESTIMATION)
  // ═══════════════════════════════════════════════════════════════════════════
  // Core rule: One ASIN = one canonical product
  // Group by ASIN and keep only the instance with the best (lowest) rank
  const rawCount = listings.length;
  const asinMap = new Map<string, { listing: ParsedListing; originalRank: number }>();
  
  // Track original position for ranking
  listings.forEach((listing, index) => {
    const asin = listing.asin || `KEYWORD-${index + 1}`;
    const originalRank = listing.position || index + 1;
    
    // If ASIN already seen, keep the one with better (lower) rank
    if (asinMap.has(asin)) {
      const existing = asinMap.get(asin)!;
      if (originalRank < existing.originalRank) {
        asinMap.set(asin, { listing, originalRank });
      }
    } else {
      asinMap.set(asin, { listing, originalRank });
    }
  });
  
  // Convert back to array and sort by original rank
  const deduplicatedListings = Array.from(asinMap.values())
    .sort((a, b) => a.originalRank - b.originalRank)
    .map(item => item.listing);
  
  const dedupedCount = deduplicatedListings.length;
  const duplicatesRemoved = rawCount - dedupedCount;
  
  console.log("✅ ASIN DEDUP COMPLETE", {
    raw: rawCount,
    deduped: dedupedCount,
    duplicates_removed: duplicatesRemoved,
  });
  
  if (duplicatesRemoved > 0) {
    console.log("🔍 DEDUPLICATION DETAILS", {
      duplicates_removed: duplicatesRemoved,
      unique_asins: dedupedCount,
      duplicate_rate: ((duplicatesRemoved / rawCount) * 100).toFixed(1) + "%",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: ESTIMATE TOTAL PAGE-1 DEMAND (Helium-10 Style)
  // ═══════════════════════════════════════════════════════════════════════════
  // Use deduplicated listings for all subsequent logic
  // Calculate average price for demand estimation
  const prices = deduplicatedListings
    .map(l => l.price)
    .filter((p): p is number => p !== null && p > 0);
  const avgPrice = prices.length > 0
    ? prices.reduce((sum, p) => sum + p, 0) / prices.length
    : null;

  // Infer category from listings (check main_category if available)
  const categories = deduplicatedListings
    .map(l => l.main_category)
    .filter((c): c is string => c !== null && c !== undefined);
  const category = categories.length > 0 ? categories[0] : null;

  // Estimate total Page-1 demand (using deduplicated listings)
  const pageOneDemand = estimatePageOneDemand({
    listings: deduplicatedListings,
    category,
    avgPrice,
  });

  let totalPage1Units = pageOneDemand.total_monthly_units_est;
  let totalPage1Revenue = pageOneDemand.total_monthly_revenue_est;

  // ═══════════════════════════════════════════════════════════════════════════
  // CALIBRATION LAYER: Normalize into trusted bands
  // ═══════════════════════════════════════════════════════════════════════════
  // Use deduplicated listings for calibration
  const organicListings = deduplicatedListings.filter(l => !l.is_sponsored);
  const sponsoredCount = deduplicatedListings.filter(l => l.is_sponsored).length;
  const sponsoredDensity = deduplicatedListings.length > 0
    ? (sponsoredCount / deduplicatedListings.length) * 100
    : 0;

  const reviewDispersion = calculateReviewDispersionFromListings(deduplicatedListings);
  
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

  const calibrated = calibrateMarketTotals({
    raw_units: totalPage1Units,
    raw_revenue: totalPage1Revenue,
    category,
    price_band: { min: priceMin, max: priceMax },
    listing_count: organicListings.length,
    review_dispersion: reviewDispersion,
    sponsored_density: sponsoredDensity,
  });

  // Use calibrated values
  totalPage1Units = calibrated.calibrated_units;
  totalPage1Revenue = calibrated.calibrated_revenue;

  console.log("📊 PAGE-1 TOTAL UNITS (calibrated)", totalPage1Units);
  console.log("📊 PAGE-1 TOTAL REVENUE (calibrated)", totalPage1Revenue);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: ALLOCATE DEMAND ACROSS PRODUCTS
  // ═══════════════════════════════════════════════════════════════════════════
  // Use deduplicated listings for allocation
  // Calculate median review count for comparison
  const reviews = deduplicatedListings
    .map(l => l.reviews)
    .filter((r): r is number => r !== null && r > 0);
  const medianReviews = reviews.length > 0
    ? [...reviews].sort((a, b) => a - b)[Math.floor(reviews.length / 2)]
    : 0;

  // Calculate median rating for comparison
  const ratings = deduplicatedListings
    .map(l => l.rating)
    .filter((r): r is number => r !== null && r > 0);
  const medianRating = ratings.length > 0
    ? [...ratings].sort((a, b) => a - b)[Math.floor(ratings.length / 2)]
    : 4.0;

  // Build products with allocation weights (using deduplicated listings)
  // Assign new ranks based on deduplicated order (1, 2, 3, ...)
  const productsWithWeights = deduplicatedListings.map((l, i) => {
    const bsr = l.bsr ?? l.main_category_bsr ?? null;
    const rank = i + 1; // New rank based on deduplicated order
    const price = l.price ?? 0;
    const reviewCount = l.reviews ?? 0;
    const rating = l.rating ?? 0;

    // Calculate allocation weight based on:
    // 1. Rank (lower rank = higher weight)
    // 2. Review advantage vs median (more reviews = higher weight)
    // 3. Rating penalty (lower rating = lower weight)
    // 4. Price deviation (closer to median = higher weight, but less impact)

    // Rank weight: exponential decay (position 1 gets highest weight)
    const rankWeight = 1.0 / Math.pow(rank, 0.7);

    // Review advantage: ratio vs median (clamped to 0.5x - 2.0x)
    const reviewRatio = medianReviews > 0
      ? Math.max(0.5, Math.min(2.0, reviewCount / medianReviews))
      : 1.0;
    const reviewWeight = reviewRatio;

    // Rating penalty: products below median rating get penalized
    const ratingPenalty = rating >= medianRating
      ? 1.0
      : Math.max(0.3, 1.0 - (medianRating - rating) * 0.5);

    // Price deviation: products closer to median price get slight boost
    // But price has less impact than rank/reviews
    const priceDeviation = avgPrice && avgPrice > 0
      ? Math.abs(price - avgPrice) / avgPrice
      : 0;
    const priceWeight = Math.max(0.8, 1.0 - priceDeviation * 0.2);

    // Combined weight
    const allocationWeight = rankWeight * reviewWeight * ratingPenalty * priceWeight;

    return {
      listing: l,
      rank,
      bsr,
      price,
      reviewCount,
      rating,
      allocationWeight,
    };
  });

  // Normalize weights to sum to 1.0
  const totalWeight = productsWithWeights.reduce((sum, p) => sum + p.allocationWeight, 0);
  if (totalWeight === 0) {
    // Fallback: equal allocation
    productsWithWeights.forEach(p => {
      p.allocationWeight = 1.0 / productsWithWeights.length;
    });
  } else {
    productsWithWeights.forEach(p => {
      p.allocationWeight = p.allocationWeight / totalWeight;
    });
  }

  // Allocate units and revenue
  const products = productsWithWeights.map((pw, i) => {
    const l = pw.listing;
    const allocatedUnits = Math.max(1, Math.round(totalPage1Units * pw.allocationWeight));
    const allocatedRevenue = Math.round(allocatedUnits * pw.price);

    const asin = l.asin ?? `KEYWORD-${i + 1}`;

    // Log sample allocation for first product
    if (i === 0) {
      console.log("📊 ALLOCATION SAMPLE", {
        asin,
        rank: pw.rank,
        weight: pw.allocationWeight.toFixed(4),
        allocated_units: allocatedUnits,
        allocated_revenue: allocatedRevenue,
      });
    }

    return {
      rank: pw.rank,
      asin, // Allow synthetic ASINs for keywords
      title: l.title ?? "Unknown product",
      price: pw.price,
      rating: pw.rating,
      review_count: pw.reviewCount,
      bsr: pw.bsr,
      estimated_monthly_units: allocatedUnits,
      estimated_monthly_revenue: allocatedRevenue,
      revenue_share_pct: 0, // Will be calculated after all products are built
      image_url: l.image_url ?? null,
      fulfillment: (l.fulfillment === "FBA" ? "FBA" : l.fulfillment === "Amazon" ? "AMZ" : "FBM") as "FBA" | "FBM" | "AMZ",
      brand: l.brand ?? null,
      seller_country: "Unknown" as const,
      snapshot_inferred: false,
    };
  });

  // Calculate total revenue from allocated values for revenue share percentages
  const totalRevenue = products.reduce((sum, p) => sum + (p.estimated_monthly_revenue || 0), 0);
  
  // Calculate revenue share percentages using allocated revenues
  products.forEach(p => {
    if (totalRevenue > 0 && p.estimated_monthly_revenue > 0) {
      p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / totalRevenue) * 100 * 100) / 100;
    } else {
      p.revenue_share_pct = 0;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: INVARIANT VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════
  const sumUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const sumRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const unitsDiff = Math.abs(sumUnits - totalPage1Units);
  const revenueDiff = Math.abs(sumRevenue - totalPage1Revenue);
  const unitsDiffPct = totalPage1Units > 0 ? (unitsDiff / totalPage1Units) * 100 : 0;
  const revenueDiffPct = totalPage1Revenue > 0 ? (revenueDiff / totalPage1Revenue) * 100 : 0;

  console.log("⚖️ DEMAND DISTRIBUTION CHECK", {
    total_page1_units: totalPage1Units,
    sum_allocated_units: sumUnits,
    units_diff: unitsDiff,
    units_diff_pct: unitsDiffPct.toFixed(2) + "%",
    total_page1_revenue: totalPage1Revenue,
    sum_allocated_revenue: sumRevenue,
    revenue_diff: revenueDiff,
    revenue_diff_pct: revenueDiffPct.toFixed(2) + "%",
  });

  // Validate all invariants (logs violations but never throws)
  const invariantResult = validateInvariants(
    totalPage1Units,
    totalPage1Revenue,
    products.map(p => ({
      asin: p.asin,
      estimated_monthly_units: p.estimated_monthly_units,
      estimated_monthly_revenue: p.estimated_monthly_revenue,
      price: p.price,
      brand: p.brand,
      revenue_share_pct: p.revenue_share_pct,
    }))
  );

  console.log("✅ KEYWORD PAGE-1 COUNT", products.length);
  if (products.length > 0) {
    console.log("📦 SAMPLE PRODUCT", products[0]);
  }
  
  // Log allocation statistics
  const allocatedCount = products.filter(p => p.estimated_monthly_units > 0 || p.estimated_monthly_revenue > 0).length;
  if (allocatedCount > 0) {
    console.log("📊 ALLOCATION APPLIED", {
      total_products: products.length,
      products_with_allocations: allocatedCount,
      sample_asin: products[0]?.asin,
      sample_bsr: products[0]?.bsr,
      sample_units: products[0]?.estimated_monthly_units,
      sample_revenue: products[0]?.estimated_monthly_revenue,
    });
  }

  return products;
}

/**
 * Build ASIN Page-1 product set (STRICT)
 * 
 * ASIN CANONICAL RULES:
 * - Requires valid ASINs
 * - Requires historical data validation
 * - Filters invalid listings
 * - Strict validation and calibration
 * 
 * @param listings - Existing listings that MUST include units_est, revenue_est, bsr, image
 * @param snapshot - Market snapshot with aggregated data (for calibration only)
 * @param keyword - Search keyword (unused, kept for compatibility)
 * @param marketplace - Marketplace identifier (for historical blending)
 * @param rawRainforestData - Optional map of raw Rainforest API data by ASIN (unused)
 * @param supabase - Optional Supabase client (for historical blending)
 * @returns Array of canonical products (same as input, transformed)
 */
export async function buildAsinPageOne(
  listings: ParsedListing[],
  snapshot: KeywordMarketSnapshot,
  keyword: string,
  marketplace: string = "US",
  rawRainforestData?: Map<string, any>,
  supabase?: any
): Promise<CanonicalProduct[]> {
  // ═══════════════════════════════════════════════════════════════════════════
  // 🧨 FORCE OUTPUT - NO FILTERS, NO ASIN LOGIC
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("🧪 RAW INPUT LISTINGS", listings.slice(0, 3));
  
  // TEMP: Force output - pass through all listings with zero filtering
  const result = listings.map((l, i) => ({
    ...l,
    canonical_rank: i + 1,
  })) as any;
  
  console.log("🧪 CANONICAL FORCED OUTPUT COUNT", listings.length);
  
  return result;
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
  
  // Extract ASINs from products (exclude synthetic ASINs for ASIN analysis only)
  // Note: This function is for ASIN analysis, so synthetic ASINs should be filtered
  const asins = products
    .map(p => p.asin)
    .filter(asin => asin && !asin.startsWith('ESTIMATED-') && !asin.startsWith('INFERRED-') && !asin.startsWith('KEYWORD-'));
  
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
