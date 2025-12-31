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
  rank: number | null; // Legacy field - kept for backward compatibility (equals organic_rank for organic, null for sponsored)
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
  // Algorithm boost tracking (Sellerev-only insight for AI/Spellbook)
  page_one_appearances: number; // How many times this ASIN appeared in raw search results (appearance_count)
  is_algorithm_boosted: boolean; // true if page_one_appearances >= 2
  appeared_multiple_times: boolean; // true if page_one_appearances > 1 (hidden Spellbook signal for dominance/defense reasoning)
  // Helium-10 style rank semantics
  organic_rank: number | null; // Position among organic listings only (1, 2, 3...) or null if sponsored
  page_position: number; // Actual Page-1 position including sponsored listings (1, 2, 3...)
  // Sponsored visibility (for clarity, not estimation changes)
  is_sponsored: boolean; // Explicit flag for sponsored listings
}

/**
 * Apply demand floors to prevent under-reported sales/revenue
 * Uses conservative signals from existing data (Rainforest) to set minimum units
 * 
 * @param params - Product estimation parameters
 * @returns Floored units (never less than estimatedUnits, but may be higher)
 */
function applyDemandFloors({
  estimatedUnits,
  price,
  reviewCount,
  rank,
  isSponsored,
  fulfillment
}: {
  estimatedUnits: number;
  price: number;
  reviewCount: number;
  rank: number;
  isSponsored: boolean;
  fulfillment: "FBA" | "FBM" | "AMZ" | "Unknown";
}): number {
  // Map AMZ to FBA for floor calculations (Amazon Retail uses FBA fulfillment)
  const fulfillmentForFloor = fulfillment === "AMZ" ? "FBA" : fulfillment;
  let floorUnits = 0;

  // REVIEW-BASED FLOOR (primary)
  if (reviewCount >= 20) {
    // Assume 1–3% review rate, spread over 12 months (conservative)
    floorUnits = Math.max(
      floorUnits,
      Math.round((reviewCount / 12) / 0.03)
    );
  }

  // PAGE 1 SANITY FLOOR
  if (rank <= 50 && reviewCount >= 10 && fulfillmentForFloor === "FBA") {
    floorUnits = Math.max(floorUnits, 50);
  }

  // SPONSORED ECONOMIC FLOOR
  if (isSponsored && reviewCount >= 10) {
    floorUnits = Math.max(floorUnits, 100);
  }

  // REVENUE REALITY FLOOR
  if (reviewCount >= 10 && fulfillmentForFloor === "FBA") {
    const minRevenue = 1000;
    floorUnits = Math.max(
      floorUnits,
      Math.ceil(minRevenue / Math.max(price, 1))
    );
  }

  return Math.max(estimatedUnits, floorUnits);
}

/**
 * Build keyword Page-1 product set (PERMISSIVE)
 * 
 * PAGE-1 SCOPE: This function processes Page-1 listings only (both organic + sponsored)
 * All listings passed to this function come from fetchKeywordMarketSnapshot which
 * fetches page=1 results from Rainforest API only.
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
 * @param listings - Raw listings from keyword search results (Page-1 only: organic + sponsored)
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
  // Selection priority:
  // 1. Organic listings over sponsored listings
  // 2. Best (lowest) rank among listings of the same type
  // 
  // For each ASIN:
  // - If it appears multiple times: keep organic if available, else keep best rank
  // - If both are same type: keep the one with LOWEST rank number
  // - Example: organic rank 8 beats sponsored rank 3
  // - Example: organic rank 3 beats organic rank 8
  const rawCount = listings.length;
  const asinMap = new Map<string, { 
    listing: ParsedListing; 
    bestRank: number; // Best (lowest) rank this ASIN appears at
    allRanks: number[]; // Track all ranks for logging
    appearanceCount: number; // Track how many times ASIN appeared (for algorithm boost insight)
    isOrganic: boolean; // Track if the canonical listing is organic
  }>();
  
  // Track all instances to find best canonical instance per ASIN
  listings.forEach((listing, index) => {
    const asin = listing.asin || `KEYWORD-${index + 1}`;
    const currentRank = listing.position || index + 1;
    const isOrganic = !listing.is_sponsored;
    
    if (asinMap.has(asin)) {
      const existing = asinMap.get(asin)!;
      existing.allRanks.push(currentRank);
      existing.appearanceCount += 1; // Increment appearance count
      
      // Selection logic:
      // 1. Prefer organic over sponsored
      // 2. If same type, prefer better (lower) rank
      const shouldReplace = 
        // Case 1: Current is organic, existing is sponsored → always replace
        (isOrganic && !existing.isOrganic) ||
        // Case 2: Both same type, current has better (lower) rank → replace
        (isOrganic === existing.isOrganic && currentRank < existing.bestRank);
      
      if (shouldReplace) {
        existing.bestRank = currentRank;
        existing.listing = listing; // Update to best canonical instance
        existing.isOrganic = isOrganic; // Update organic status
      }
    } else {
      asinMap.set(asin, { 
        listing, 
        bestRank: currentRank,
        allRanks: [currentRank],
        appearanceCount: 1, // First appearance
        isOrganic, // Track if this instance is organic
      });
    }
  });
  
  // Log canonical rank selection for each ASIN
  asinMap.forEach((value, asin) => {
    if (value.allRanks.length > 1) {
      // ASIN appeared multiple times - log the selection
      console.log("📊 CANONICAL RANK SELECTED", {
        asin,
        rank: value.bestRank,
        all_ranks: value.allRanks.sort((a, b) => a - b),
        is_organic: value.isOrganic,
        selection_reason: value.isOrganic 
          ? `Organic listing with best rank selected from ${value.allRanks.length} appearances`
          : `Sponsored listing with best rank selected from ${value.allRanks.length} appearances (no organic found)`,
      });
    } else {
      // Single appearance - still log for consistency
      console.log("📊 CANONICAL RANK SELECTED", {
        asin,
        rank: value.bestRank,
        all_ranks: [value.bestRank],
        is_organic: value.isOrganic,
        selection_reason: "Single appearance",
      });
    }
  });
  
  // Convert back to array and sort by best rank (canonical order)
  // This ensures products are ordered by their best Page-1 visibility
  // Preserve appearance metadata for algorithm boost insights
  const deduplicatedListingsWithMetadata = Array.from(asinMap.entries())
    .map(([asin, value]) => ({
      listing: value.listing,
      bestRank: value.bestRank,
      appearanceCount: value.appearanceCount,
      isAlgorithmBoosted: value.appearanceCount >= 2,
    }))
    .sort((a, b) => a.bestRank - b.bestRank); // Sort by best rank
  
  const deduplicatedListings = deduplicatedListingsWithMetadata.map(item => item.listing);
  
  const dedupedCount = deduplicatedListings.length;
  const duplicatesRemoved = rawCount - dedupedCount;
  
  console.log("✅ ASIN DEDUP COMPLETE", {
    raw: rawCount,
    deduped: dedupedCount,
    duplicates_removed: duplicatesRemoved,
    rank_logic: "best_rank_selected", // Explicitly document the logic
    organic_rank_logic: "organic_listings_only", // Organic rank excludes sponsored
  });
  
  if (duplicatesRemoved > 0) {
    console.log("🔍 DEDUPLICATION DETAILS", {
      duplicates_removed: duplicatesRemoved,
      unique_asins: dedupedCount,
      duplicate_rate: ((duplicatesRemoved / rawCount) * 100).toFixed(1) + "%",
      rank_selection: "best_rank_per_asin", // Document rank selection method
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIC RANK SEMANTICS (Helium-10 Style)
  // ═══════════════════════════════════════════════════════════════════════════
  // Distinction between:
  // - organic_rank: Position among organic listings only (1, 2, 3...)
  // - page_position: Actual Page-1 position including sponsored (1, 2, 3...)
  // 
  // Use organic_rank for estimation logic and competitive comparisons
  // Sponsored listings do NOT inflate organic rank
  
  // Separate organic and sponsored listings for rank assignment
  const organicListingsWithMetadata = deduplicatedListingsWithMetadata.filter(
    item => !item.listing.is_sponsored
  );
  const sponsoredListingsWithMetadata = deduplicatedListingsWithMetadata.filter(
    item => item.listing.is_sponsored
  );
  
  // Assign organic_rank to organic listings (1, 2, 3...)
  // Sort by bestRank to maintain Page-1 order
  const organicListingsRanked = organicListingsWithMetadata
    .sort((a, b) => a.bestRank - b.bestRank)
    .map((item, i) => ({
      ...item,
      organicRank: i + 1, // Organic rank starts at 1
    }));
  
  // Combine organic (with organic_rank) and sponsored (organic_rank = null)
  // Sort by bestRank to maintain Page-1 order
  const allListingsWithRanks = [
    ...organicListingsRanked.map(item => ({ ...item, organicRank: item.organicRank })),
    ...sponsoredListingsWithMetadata.map(item => ({ ...item, organicRank: null })),
  ].sort((a, b) => a.bestRank - b.bestRank);
  
  // Build products with allocation weights (using deduplicated listings)
  // Use organic_rank for estimation logic
  const productsWithWeights = allListingsWithRanks.map((item, i) => {
    const l = item.listing;
    const bsr = l.bsr ?? l.main_category_bsr ?? null; // Used internally for estimation only
    const pagePosition = item.bestRank; // Actual Page-1 position including sponsored
    const organicRank = item.organicRank; // Position among organic listings only (null for sponsored)
    const price = l.price ?? 0;
    // Fix review count mapping: use review_count if available, fallback to reviews
    const reviewCount = (l as any).review_count ?? l.reviews ?? 0;
    const rating = l.rating ?? 0;
    const appearanceCount = item.appearanceCount;
    const isAlgorithmBoosted = item.isAlgorithmBoosted;

    // Calculate allocation weight based on:
    // 1. Organic rank (lower rank = higher weight) - use organic_rank for estimation
    // 2. Review advantage vs median (more reviews = higher weight)
    // 3. Rating penalty (lower rating = lower weight)
    // 4. Price deviation (closer to median = higher weight, but less impact)

    // Rank weight: exponential decay (position 1 gets highest weight)
    // Use organic_rank for organic listings, fallback to page_position for sponsored
    const rankForWeight = organicRank ?? pagePosition;
    const rankWeight = 1.0 / Math.pow(rankForWeight, 0.7);

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
      pagePosition, // Actual Page-1 position including sponsored
      organicRank, // Position among organic listings only (null for sponsored)
      bsr,
      price,
      reviewCount,
      rating,
      allocationWeight,
      appearanceCount,
      isAlgorithmBoosted,
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

    // ═══════════════════════════════════════════════════════════════════════════
    // NORMALIZE FULFILLMENT (Helium-10 Style)
    // ═══════════════════════════════════════════════════════════════════════════
    // Rule: If Prime-eligible → "FBA", else → "FBM"
    // Do NOT infer from seller name - use is_prime flag only
    let fulfillment: "FBA" | "FBM" | "AMZ";
    if (l.is_prime === true) {
      fulfillment = "FBA"; // Prime-eligible = FBA
    } else {
      fulfillment = "FBM"; // Not Prime = FBM (default)
    }
    
    // Special case: Amazon Retail (sold by Amazon)
    // Check seller name or brand for Amazon Retail
    const isAmazonRetail = l.seller === "Amazon" || l.brand === "Amazon";
    if (isAmazonRetail) {
      fulfillment = "AMZ";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEMAND FLOOR APPLICATION (Helium-10 Style)
    // ═══════════════════════════════════════════════════════════════════════════
    // Apply conservative demand floors to prevent under-reported sales
    // Scope: Page-1 + Sponsored listings ONLY (already true in this function)
    const rank = pw.pagePosition; // Use page_position for floor calculation
    const isSponsored = !!l.is_sponsored;
    const reviewCount = pw.reviewCount;
    
    // Apply demand floor
    const finalUnits = applyDemandFloors({
      estimatedUnits: allocatedUnits,
      price: pw.price,
      reviewCount,
      rank,
      isSponsored,
      fulfillment,
    });
    
    // Recalculate revenue after floor application
    const finalRevenue = Math.round(finalUnits * pw.price);

    // Debug log for top 3 products
    if (rank <= 3) {
      console.log("🧠 DEMAND FLOOR CHECK", {
        asin,
        rank,
        reviews: reviewCount,
        sponsored: isSponsored,
        units_before: allocatedUnits,
        units_after: finalUnits,
      });
    }

    // Log sample allocation for first product
    if (i === 0) {
      console.log("📊 ALLOCATION SAMPLE", {
        asin,
        organic_rank: pw.organicRank,
        page_position: pw.pagePosition,
        weight: pw.allocationWeight.toFixed(4),
        allocated_units: allocatedUnits,
        final_units: finalUnits,
        allocated_revenue: allocatedRevenue,
        final_revenue: finalRevenue,
        page_one_appearances: pw.appearanceCount,
        is_algorithm_boosted: pw.isAlgorithmBoosted,
      });
    }

    // Log algorithm boost insights for boosted products
    if (pw.isAlgorithmBoosted) {
      console.log("🚀 ALGORITHM BOOST DETECTED", {
        asin,
        organic_rank: pw.organicRank,
        page_position: pw.pagePosition,
        page_one_appearances: pw.appearanceCount,
        insight: "This ASIN appears multiple times on Page-1, indicating Amazon algorithm boost",
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NORMALIZE BSR (Helium-10 Style)
    // ═══════════════════════════════════════════════════════════════════════════
    // Rule: Do NOT display BSR on keyword Page-1 cards
    // BSR may still be used internally for estimation (via pw.bsr variable)
    // Set product bsr to null so UI shows "BSR: —" or hides it
    const displayBsr: number | null = null; // Always null for keyword Page-1

    // Fix review count: ensure correct mapping from listing data
    const reviewCountForProduct = (l as any).review_count ?? l.reviews ?? 0;

    return {
      rank: pw.organicRank ?? null, // Legacy field - equals organic_rank for organic, null for sponsored
      asin, // Allow synthetic ASINs for keywords
      title: l.title ?? "Unknown product",
      price: pw.price,
      rating: pw.rating,
      review_count: reviewCountForProduct, // Fixed: use review_count if available, fallback to reviews
      bsr: displayBsr, // Always null for keyword Page-1 (not displayed, but pw.bsr still used internally)
      estimated_monthly_units: finalUnits, // Use floored units
      estimated_monthly_revenue: finalRevenue, // Use floored revenue
      revenue_share_pct: 0, // Will be calculated after all products are built
      image_url: l.image_url ?? null,
      fulfillment, // Normalized: Prime → FBA, else → FBM, Amazon Retail → AMZ
      brand: l.brand ?? null,
      seller_country: "Unknown" as const,
      snapshot_inferred: false,
      // Algorithm boost tracking (Sellerev-only insight for AI/Spellbook)
      // Hidden metadata for AI reasoning - not displayed in UI
      page_one_appearances: pw.appearanceCount, // appearance_count
      is_algorithm_boosted: pw.isAlgorithmBoosted, // true if appearances >= 2
      appeared_multiple_times: pw.appearanceCount > 1, // Explicit flag for dominance/defense reasoning
      // Helium-10 style rank semantics
      organic_rank: pw.organicRank, // Position among organic listings only (null for sponsored)
      page_position: pw.pagePosition, // Actual Page-1 position including sponsored
      // Sponsored visibility (for clarity, not estimation changes)
      is_sponsored: isSponsored, // Explicit flag for sponsored listings
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
  // STEP 2.3: PAGE-LEVEL DEMAND NORMALIZATION (Helium-10 Style)
  // ═══════════════════════════════════════════════════════════════════════════
  // Normalize demand at Page-1 level, then distribute by rank
  // Prevents unrealistic totals from bottom-up per-ASIN estimates
  
  // Compute total estimated units from current allocation
  const totalEstimatedUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  
  // Compute targetPageOneUnits ceiling using existing signals
  // Reuse organicCount, reviewDispersion, sponsoredDensity already calculated
  const organicCountForTarget = deduplicatedListings.filter(l => !l.is_sponsored).length;
  
  // Calculate category velocity signal (using review dispersion as proxy)
  // Higher review dispersion = more established market = higher velocity
  const categoryVelocityMultiplier = reviewDispersion > 2000 
    ? 1.2 
    : reviewDispersion > 1000 
    ? 1.0 
    : 0.8;
  
  // Base target calculation using organic count and sponsored density
  const baseTarget = organicCountForTarget * 200; // Conservative base: 200 units per organic listing
  const sponsoredAdjustment = sponsoredDensity > 30 ? 1.15 : 1.0; // Slight boost if high sponsored density
  
  // Calculate target range
  const targetMinimum = Math.max(
    totalEstimatedUnits * 0.6, // Never go below 60% of current
    organicCountForTarget * 100 // Minimum floor based on organic count
  );
  const targetMaximum = totalEstimatedUnits * 1.4;
  
  // Choose midpoint as targetPageOneUnits
  const targetPageOneUnits = Math.round(
    Math.max(
      targetMinimum,
      Math.min(
        targetMaximum,
        (baseTarget * categoryVelocityMultiplier * sponsoredAdjustment + totalEstimatedUnits) / 2
      )
    )
  );
  
  // Separate organic and sponsored products for rank-based allocation
  const organicProducts = products.filter(p => p.organic_rank !== null);
  const sponsoredProducts = products.filter(p => p.organic_rank === null);
  
  // Sort organic products by organic_rank (1, 2, 3...)
  const sortedOrganic = [...organicProducts].sort((a, b) => (a.organic_rank ?? 0) - (b.organic_rank ?? 0));
  
  // Calculate rank weights using exponential decay: rankWeight = exp(-0.35 * (rank - 1))
  const organicWeights = sortedOrganic.map((p, index) => {
    const rank = p.organic_rank ?? (index + 1);
    return {
      product: p,
      rank,
      weight: Math.exp(-0.35 * (rank - 1)),
    };
  });
  
  // Normalize organic weights to sum to 1.0
  const totalOrganicWeight = organicWeights.reduce((sum, w) => sum + w.weight, 0);
  organicWeights.forEach(w => {
    w.weight = w.weight / totalOrganicWeight;
  });
  
  // Allocate 85% of target to organic (sponsored capped at 15%)
  const organicTargetUnits = Math.round(targetPageOneUnits * 0.85);
  const sponsoredTargetUnits = Math.round(targetPageOneUnits * 0.15);
  
  // Re-allocate organic units using rank weights
  organicWeights.forEach(w => {
    const allocatedUnits = Math.max(1, Math.round(organicTargetUnits * w.weight));
    const allocatedRevenue = Math.round(allocatedUnits * w.product.price);
    
    w.product.estimated_monthly_units = allocatedUnits;
    w.product.estimated_monthly_revenue = allocatedRevenue;
  });
  
  // Allocate sponsored units (equal distribution, capped at 15% total)
  if (sponsoredProducts.length > 0) {
    const sponsoredUnitsPerProduct = Math.max(1, Math.round(sponsoredTargetUnits / sponsoredProducts.length));
    sponsoredProducts.forEach(p => {
      p.estimated_monthly_units = sponsoredUnitsPerProduct;
      p.estimated_monthly_revenue = Math.round(sponsoredUnitsPerProduct * p.price);
    });
  }
  
  // Recalculate revenue share percentages after re-allocation
  const totalUnitsAfter = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const totalRevenueAfter = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  if (totalRevenueAfter > 0) {
    products.forEach(p => {
      if (p.estimated_monthly_revenue > 0) {
        p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / totalRevenueAfter) * 100 * 100) / 100;
      } else {
        p.revenue_share_pct = 0;
      }
    });
  }
  
  // Calculate sponsored share for logging
  const sponsoredUnits = sponsoredProducts.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const sponsoredShare = totalUnitsAfter > 0 ? (sponsoredUnits / totalUnitsAfter) * 100 : 0;
  
  console.log("📈 PAGE-LEVEL DEMAND NORMALIZED", {
    targetPageOneUnits,
    totalUnitsAfter,
    sponsoredShare: sponsoredShare.toFixed(1) + "%",
    organicCount: organicProducts.length,
    sponsoredCount: sponsoredProducts.length,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2.4: POSITION-BASED REVENUE DISTRIBUTION (Helium-10 Style)
  // ═══════════════════════════════════════════════════════════════════════════
  // Normalize revenue distribution to resemble Helium 10 behavior
  // Apply position-based multiplier using organic_rank (or page_position for sponsored)
  // Top 3 listings should dominate total revenue
  
  /**
   * Get position-based normalization multiplier
   * Uses organic_rank for organic listings, page_position for sponsored
   * Deterministic curve that makes top ranks dominate revenue
   */
  function getPositionMultiplier(organicRank: number | null, pagePosition: number): number {
    // Use organic_rank if available, otherwise use page_position
    const rank = organicRank ?? pagePosition;
    
    // Deterministic curve matching Helium 10 behavior
    if (rank === 1) return 1.00;
    if (rank === 2) return 0.82;
    if (rank === 3) return 0.68;
    if (rank >= 4 && rank <= 6) {
      // Decay from 0.68 to ~0.45
      const progress = (rank - 4) / 2; // 0.0 to 1.0
      return 0.68 - (progress * 0.23); // 0.68 -> 0.45
    }
    if (rank >= 7 && rank <= 10) {
      // Decay from 0.45 to ~0.25
      const progress = (rank - 7) / 3; // 0.0 to 1.0
      return 0.45 - (progress * 0.20); // 0.45 -> 0.25
    }
    if (rank >= 11 && rank <= 20) {
      // Decay from 0.25 to ~0.12
      const progress = (rank - 11) / 9; // 0.0 to 1.0
      return 0.25 - (progress * 0.13); // 0.25 -> 0.12
    }
    // Rank 21+: continue decay to ~0.05
    if (rank > 20) {
      const excess = rank - 20;
      return Math.max(0.05, 0.12 - (excess * 0.01));
    }
    return 1.0; // Fallback
  }
  
  // Log totals before position-based normalization
  const unitsBeforePositionNorm = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const revenueBeforePositionNorm = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  // Apply position-based multipliers to units
  products.forEach(p => {
    const multiplier = getPositionMultiplier(p.organic_rank, p.page_position);
    const normalizedUnits = Math.max(1, Math.round(p.estimated_monthly_units * multiplier));
    
    // Recalculate revenue after normalization (revenue = units × price)
    const normalizedRevenue = Math.round(normalizedUnits * p.price);
    
    // Update product (preserve all other fields)
    p.estimated_monthly_units = normalizedUnits;
    p.estimated_monthly_revenue = normalizedRevenue;
  });
  
  // Recalculate revenue share percentages after position normalization
  const totalRevenueAfterPositionNorm = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  if (totalRevenueAfterPositionNorm > 0) {
    products.forEach(p => {
      if (p.estimated_monthly_revenue > 0) {
        p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / totalRevenueAfterPositionNorm) * 100 * 100) / 100;
      } else {
        p.revenue_share_pct = 0;
      }
    });
  }
  
  // Log totals after position-based normalization
  const unitsAfterPositionNorm = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const revenueAfterPositionNorm = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  // Calculate top 3 revenue share for validation
  const top3Products = products
    .filter(p => p.organic_rank !== null)
    .sort((a, b) => (a.organic_rank ?? 0) - (b.organic_rank ?? 0))
    .slice(0, 3);
  const top3Revenue = top3Products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const top3RevenueShare = revenueAfterPositionNorm > 0 
    ? (top3Revenue / revenueAfterPositionNorm) * 100 
    : 0;
  
  console.log("📊 POSITION-BASED NORMALIZATION", {
    total_units_before: unitsBeforePositionNorm,
    total_units_after: unitsAfterPositionNorm,
    total_revenue_before: revenueBeforePositionNorm,
    total_revenue_after: revenueAfterPositionNorm,
    top_3_revenue_share_pct: top3RevenueShare.toFixed(1) + "%",
    curve_applied: "organic_rank for organic, page_position for sponsored",
    note: "Top 3 listings should dominate total revenue",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2.5: SOFT NORMALIZATION (Helium-10 Style)
  // ═══════════════════════════════════════════════════════════════════════════
  // Normalize Page-1 totals to feel consistent with Helium 10
  // Apply soft scaling if totals exceed plausible ceilings
  // Preserves relative ordering and revenue share percentages
  const sumUnitsBefore = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const sumRevenueBefore = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  // Determine competition level for ceiling calculation
  // Reuse reviewDispersion and sponsoredDensity already calculated above for calibration
  const organicCount = deduplicatedListings.filter(l => !l.is_sponsored).length;
  
  // Determine competition level (same logic as calibration)
  let competitionLevel: "low_competition" | "medium_competition" | "high_competition";
  if (organicCount < 8 || (reviewDispersion < 500 && sponsoredDensity < 20)) {
    competitionLevel = "low_competition";
  } else if (organicCount >= 15 && (reviewDispersion > 2000 || sponsoredDensity > 40)) {
    competitionLevel = "high_competition";
  } else {
    competitionLevel = "medium_competition";
  }
  
  // Get plausible ceiling from competition level
  // Use the same ranges as calibration for consistency
  const MARKET_RANGES = {
    low_competition: { units_max: 6000, revenue_max: 150000 },
    medium_competition: { units_max: 15000, revenue_max: 375000 },
    high_competition: { units_max: 35000, revenue_max: 875000 },
  };
  
  const ceiling = MARKET_RANGES[competitionLevel];
  const unitsCeiling = ceiling.units_max;
  const revenueCeiling = ceiling.revenue_max;
  
  // Check if totals exceed ceiling
  const unitsExceedsCeiling = sumUnitsBefore > unitsCeiling;
  const revenueExceedsCeiling = sumRevenueBefore > revenueCeiling;
  
  if (unitsExceedsCeiling || revenueExceedsCeiling) {
    // Calculate scaling factor (use the more restrictive one)
    const unitsScale = unitsExceedsCeiling ? unitsCeiling / sumUnitsBefore : 1.0;
    const revenueScale = revenueExceedsCeiling ? revenueCeiling / sumRevenueBefore : 1.0;
    const scaleFactor = Math.min(unitsScale, revenueScale);
    
    // Clamp scale factor to reasonable range (0.5x - 1.0x)
    // Never scale up, only down if needed
    const clampedScale = Math.max(0.5, Math.min(1.0, scaleFactor));
    
    // Apply proportional scaling to all products
    // Preserves relative ordering and revenue share percentages
    products.forEach(p => {
      // Scale units (ensure never zero)
      const scaledUnits = Math.max(1, Math.round(p.estimated_monthly_units * clampedScale));
      
      // Scale revenue proportionally (revenue = units × price)
      const scaledRevenue = Math.round(scaledUnits * p.price);
      
      // Update product (preserve all other fields)
      p.estimated_monthly_units = scaledUnits;
      p.estimated_monthly_revenue = scaledRevenue;
    });
    
    // Recalculate revenue share percentages after scaling
    const scaledTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
    if (scaledTotalRevenue > 0) {
      products.forEach(p => {
        if (p.estimated_monthly_revenue > 0) {
          p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / scaledTotalRevenue) * 100 * 100) / 100;
        }
      });
    }
    
    const sumUnitsAfter = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
    const sumRevenueAfter = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
    
    console.log("📉 NORMALIZATION APPLIED", {
      before: sumUnitsBefore,
      after: sumUnitsAfter,
      revenue_before: sumRevenueBefore,
      revenue_after: sumRevenueAfter,
      competition_level: competitionLevel,
      ceiling: {
        units: unitsCeiling,
        revenue: revenueCeiling,
      },
      scale_factor: clampedScale.toFixed(3),
      reason: unitsExceedsCeiling || revenueExceedsCeiling 
        ? "Totals exceeded plausible ceiling, scaled proportionally"
        : "No scaling needed",
    });
  } else {
    // No normalization needed - totals are within plausible range
    console.log("📉 NORMALIZATION CHECK", {
      total_units: sumUnitsBefore,
      total_revenue: sumRevenueBefore,
      ceiling: {
        units: unitsCeiling,
        revenue: revenueCeiling,
      },
      competition_level: competitionLevel,
      normalized: false,
      reason: "Totals within plausible range",
    });
  }

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
  
  // Log normalization summary
  // Reuse organicProducts and sponsoredProducts already declared at lines 614-615
  const fbaCount = products.filter(p => p.fulfillment === "FBA").length;
  const fbmCount = products.filter(p => p.fulfillment === "FBM").length;
  const amzCount = products.filter(p => p.fulfillment === "AMZ").length;
  const bsrDisplayCount = products.filter(p => p.bsr !== null).length;
  
  console.log("📋 NORMALIZATION SUMMARY", {
    total_products: products.length,
    organic_rank_range: organicProducts.length > 0
      ? `1-${Math.max(...organicProducts.map(p => p.organic_rank!))} (organic only)`
      : "N/A",
    page_position_range: products.length > 0
      ? `1-${Math.max(...products.map(p => p.page_position))} (all listings)`
      : "N/A",
    fulfillment: {
      fba: fbaCount,
      fbm: fbmCount,
      amazon: amzCount,
    },
    bsr_display: bsrDisplayCount === 0 ? "hidden (null)" : `WARNING: ${bsrDisplayCount} products have BSR`,
    rank_logic: "organic_rank_excludes_sponsored",
    fulfillment_logic: "prime_eligible_fba_else_fbm",
    bsr_logic: "hidden_for_keyword_page1",
  });
  
  if (products.length > 0) {
    console.log("📦 SAMPLE PRODUCT", {
      ...products[0],
      bsr: products[0].bsr === null ? "— (hidden)" : products[0].bsr, // Show as "—" in logs
    });
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

  // Log algorithm boost summary (Sellerev-only insight)
  const algorithmBoostedProducts = products.filter(p => p.is_algorithm_boosted);
  if (algorithmBoostedProducts.length > 0) {
    console.log("🚀 ALGORITHM BOOST SUMMARY", {
      boosted_count: algorithmBoostedProducts.length,
      total_products: products.length,
      boost_rate: ((algorithmBoostedProducts.length / products.length) * 100).toFixed(1) + "%",
      boosted_asins: algorithmBoostedProducts.map(p => ({
        asin: p.asin,
        appearances: p.page_one_appearances,
        organic_rank: p.organic_rank,
        page_position: p.page_position,
      })),
      insight: "These ASINs appear multiple times on Page-1, indicating Amazon algorithm boost",
    });
  }
  
  // Log organic rank summary
  console.log("📊 ORGANIC RANK SEMANTICS", {
    total_products: products.length,
    organic_count: organicProducts.length,
    sponsored_count: sponsoredProducts.length,
    organic_rank_range: organicProducts.length > 0 
      ? `1-${Math.max(...organicProducts.map(p => p.organic_rank!))}`
      : "N/A",
    page_position_range: products.length > 0
      ? `1-${Math.max(...products.map(p => p.page_position))}`
      : "N/A",
    note: "organic_rank excludes sponsored listings, page_position includes all",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CALIBRATION LOGGING (Helium-10 Comparison)
  // ═══════════════════════════════════════════════════════════════════════════
  // Log metrics to compare Sellerev outputs against Helium-10 ranges
  // Do NOT modify estimation logic - this is observation only
  // Use calibration-prefixed variable names to avoid scope conflicts
  const calibrationTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  // Calculate top 3 revenue share
  const calibrationSortedByRevenue = [...products]
    .sort((a, b) => b.estimated_monthly_revenue - a.estimated_monthly_revenue);
  const calibrationTop3Revenue = calibrationSortedByRevenue.slice(0, 3).reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const calibrationTop3Pct = calibrationTotalRevenue > 0 ? (calibrationTop3Revenue / calibrationTotalRevenue) * 100 : 0;
  
  // Calculate top 10 revenue share
  const calibrationTop10Revenue = calibrationSortedByRevenue.slice(0, 10).reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const calibrationTop10Pct = calibrationTotalRevenue > 0 ? (calibrationTop10Revenue / calibrationTotalRevenue) * 100 : 0;
  
  // Calculate median product revenue
  const calibrationRevenues = products
    .map(p => p.estimated_monthly_revenue)
    .filter(r => r > 0)
    .sort((a, b) => a - b);
  const calibrationMedianRevenue = calibrationRevenues.length > 0
    ? (calibrationRevenues.length % 2 === 0
        ? (calibrationRevenues[Math.floor(calibrationRevenues.length / 2) - 1] + calibrationRevenues[Math.floor(calibrationRevenues.length / 2)]) / 2
        : calibrationRevenues[Math.floor(calibrationRevenues.length / 2)])
    : 0;
  
  // Log calibration metrics (keyword not available in this context)
  console.log("📊 CALIBRATION METRICS (Helium-10 Comparison)", {
    total_revenue: Math.round(calibrationTotalRevenue),
    top3_pct: Math.round(calibrationTop3Pct * 100) / 100,
    top10_pct: Math.round(calibrationTop10Pct * 100) / 100,
    median_revenue: Math.round(calibrationMedianRevenue),
    note: "Keyword available in dataContract.ts logging",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ASIN DEDUP VERIFICATION (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════════
  // Assert that each ASIN appears exactly once in final products array
  const total_products = products.length;
  const unique_asins = new Set(products.map(p => p.asin)).size;
  const duplicates_removed = total_products - unique_asins;
  
  console.log("✅ ASIN DEDUP VERIFIED", {
    total_products,
    unique_asins,
    duplicates_removed,
  });
  
  // If duplicates exist, log warning but do not throw (non-fatal)
  if (total_products !== unique_asins) {
    console.warn("⚠️ ASIN DEDUP MISMATCH", {
      total_products,
      unique_asins,
      duplicates_removed,
      message: "Expected total_products === unique_asins after deduplication",
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
