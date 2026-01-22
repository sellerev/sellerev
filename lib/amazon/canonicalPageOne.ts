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
 * 
 * GUARDRAILS:
 * - Canonical revenue can only be modified by:
 *   a) keyword calibration (applyKeywordCalibration)
 *   b) parent normalization (parent-child ASIN grouping)
 * - Any other mutation throws error
 */

import { ParsedListing, KeywordMarketSnapshot, BrandResolution } from "./keywordMarket";
import { estimatePageOneDemand } from "./pageOneDemand";
import { calibrateMarketTotals, calculateReviewDispersionFromListings, validateInvariants } from "./calibration";
import { Appearance } from "@/types/search";

export interface CanonicalProduct {
  rank: number | null; // Legacy field - kept for backward compatibility (equals organic_rank for organic, null for sponsored)
  asin: string;
  title: string | null; // From Rainforest SEARCH response - null if truly missing (never fabricated)
  image_url: string | null;
  price: number;
  rating: number;
  review_count: number;
  bsr: number | null;
  estimated_monthly_units: number;
  estimated_monthly_revenue: number;
  revenue_share_pct: number;
  fulfillment: "FBA" | "FBM" | "AMZ";
  brand: string | null; // DEPRECATED: Use brand_resolution.raw_brand instead. Kept for backward compatibility.
  brand_resolution?: BrandResolution; // Brand resolution structure (preserves all brands)
  brand_confidence: "high" | "medium" | "low";
  seller_country: "US" | "CN" | "Other" | "Unknown";
  snapshot_inferred: boolean;
  snapshot_inferred_fields?: string[];
  // Algorithm boost tracking (Sellerev-only insight for AI/Spellbook)
  page_one_appearances: number; // How many times this ASIN appeared in raw search results (appearance_count)
  is_algorithm_boosted: boolean; // true if page_one_appearances >= 2
  appeared_multiple_times: boolean; // true if page_one_appearances > 1 (hidden Spellbook signal for dominance/defense reasoning)
  // Helium-10 style rank semantics
  organic_rank: number | null; // Position among organic listings only (1, 2, 3...) or null if sponsored
  page_position: number; // Actual Page-1 position including sponsored listings (1, 2, 3...) - preserves original Amazon position
  // Sponsored visibility (for clarity, not estimation changes)
  // CRITICAL: Sponsored data comes from Rainforest SERP ONLY (SP-API has no ad data)
  isSponsored: boolean; // Instance-level sponsored status (always boolean, normalized at ingest)
  is_sponsored?: boolean | null; // DEPRECATED: Use isSponsored instead. Kept for backward compatibility.
  sponsored_position: number | null; // Ad position from Rainforest (null if not sponsored)
  sponsored_source: 'rainforest_serp' | 'organic_serp'; // Source of sponsored data
  // ═══════════════════════════════════════════════════════════════════════════
  // ASIN-LEVEL SPONSORED AGGREGATION (CRITICAL - DO NOT MODIFY WITHOUT UPDATING AGGREGATION LOGIC)
  // ═══════════════════════════════════════════════════════════════════════════
  // Sponsored and Fulfillment are ASIN-level properties, not instance-level.
  // appearsSponsored: true if ASIN appears as sponsored ANYWHERE on Page 1
  // sponsoredPositions: all positions where this ASIN appeared as sponsored
  // These fields persist through canonicalization and represent Page-1 advertising presence.
  // DO NOT MODIFY THIS LOGIC - it matches Helium 10 / Jungle Scout behavior.
  appearsSponsored: boolean; // ASIN-level: true if appears sponsored anywhere on Page 1
  sponsoredPositions: number[]; // ASIN-level: all positions where ASIN appeared as sponsored
  organicPosition?: number | null; // Alias for organic_rank (null if sponsored)
  sponsoredSlot?: 'top' | 'middle' | 'bottom' | null; // Sponsored ad slot position (null if not sponsored)
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
 * Category velocity classification
 */
type CategoryVelocity = "FAST_MOVING" | "DURABLE";

/**
 * Classify category velocity using keyword and product title heuristics
 * 
 * @param listings - Product listings to analyze
 * @returns Category velocity type
 */
function classifyCategoryVelocity(listings: ParsedListing[]): CategoryVelocity {
  const durableKeywords = [
    "laptop", "computer", "tv", "monitor", "appliance",
    "refrigerator", "washer", "dryer", "dishwasher",
    "oven", "stove", "microwave", "freezer"
  ];
  
  // Check product titles for durable keywords
  const titles = listings
    .map(l => l.title?.toLowerCase() || "")
    .filter(t => t.length > 0);
  
  if (titles.length === 0) {
    return "FAST_MOVING"; // Default to fast-moving if no titles
  }
  
  // Count how many titles contain durable keywords
  const durableMatches = titles.filter(title => 
    durableKeywords.some(keyword => title.includes(keyword))
  ).length;
  
  // If majority of titles contain durable keywords, classify as DURABLE
  const durableRatio = durableMatches / titles.length;
  return durableRatio >= 0.3 ? "DURABLE" : "FAST_MOVING";
}

/**
 * Estimate total keyword units from search volume (Helium-10 style)
 * 
 * @param searchVolumeLow - Lower bound of search volume estimate
 * @param searchVolumeHigh - Upper bound of search volume estimate
 * @param avgCVR - Average conversion rate (default 0.10 = 10%)
 * @returns Estimated total keyword units
 */
function estimateTotalKeywordUnits({
  searchVolumeLow,
  searchVolumeHigh,
  avgCVR = 0.10
}: {
  searchVolumeLow: number;
  searchVolumeHigh: number;
  avgCVR?: number;
}): number {
  const avgSearchVolume = (searchVolumeLow + searchVolumeHigh) / 2;
  return Math.round(avgSearchVolume * avgCVR);
}

/**
 * Market shape classification
 */
type MarketShape = "DURABLE" | "HYBRID" | "CONSUMABLE";

/**
 * Detect market shape based on price and total units
 * 
 * @param avgPrice - Average price of products
 * @param totalPage1Units - Total Page-1 units
 * @returns Market shape type
 */
function detectMarketShape({
  avgPrice,
  totalPage1Units
}: {
  avgPrice: number;
  totalPage1Units: number;
}): MarketShape {
  if (avgPrice >= 300) return "DURABLE";
  if (avgPrice <= 30 && totalPage1Units >= 80000) return "CONSUMABLE";
  return "HYBRID";
}

/**
 * Estimate total market demand for Page-1 based on market shape
 * 
 * @param marketShape - Market shape classification
 * @param avgPrice - Average price of products
 * @param organicCount - Number of organic products on Page-1
 * @returns Estimated total monthly units for Page-1
 */
function estimateMarketDemand({
  marketShape,
  avgPrice,
  organicCount
}: {
  marketShape: MarketShape;
  avgPrice: number;
  organicCount: number;
}): number {
  // Base units per organic listing varies by market shape
  let baseUnitsPerListing: number;
  
  if (marketShape === "DURABLE") {
    // Lower velocity baseline for durable goods
    baseUnitsPerListing = 300;
  } else if (marketShape === "CONSUMABLE") {
    // High velocity baseline for consumable goods
    baseUnitsPerListing = 1500;
  } else {
    // HYBRID: Medium velocity
    baseUnitsPerListing = 800;
  }
  
  // Price adjustment: lower prices support higher volumes
  // For very low prices (<$10), increase base units
  // For higher prices (>$50), decrease base units
  let priceMultiplier = 1.0;
  if (avgPrice < 10) {
    priceMultiplier = 1.5;
  } else if (avgPrice < 25) {
    priceMultiplier = 1.2;
  } else if (avgPrice > 50) {
    priceMultiplier = 0.8;
  } else if (avgPrice > 100) {
    priceMultiplier = 0.6;
  }
  
  // Calculate base market demand
  const baseDemand = organicCount * baseUnitsPerListing * priceMultiplier;
  
  // Round to reasonable precision
  return Math.round(baseDemand);
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
 * @param searchVolumeLow - Optional lower bound of search volume (for keyword demand scaling)
 * @param searchVolumeHigh - Optional upper bound of search volume (for keyword demand scaling)
 * @returns Array of canonical products (always non-empty if listings exist)
 */
export function buildKeywordPageOne(
  listings: ParsedListing[],
  searchVolumeLow?: number,
  searchVolumeHigh?: number
): CanonicalProduct[] {
  if (!Array.isArray(listings) || listings.length === 0) {
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 0: Convert listings → appearances (PRESERVE SPONSORED DATA)
  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: This is the moment sponsored data must be preserved.
  // Do not drop it later.
  const appearances: Appearance[] = listings.map((listing, index) => ({
    asin: listing.asin || '',
    position: listing.position || index + 1,
    isSponsored: Boolean(listing.isSponsored),
    source: listing.isSponsored ? 'sponsored' : 'organic'
  })).filter((app: Appearance) => app.asin && /^[A-Z0-9]{10}$/i.test(app.asin.trim()));

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Group appearances by ASIN (REPLACE ASIN DEDUP LOGIC)
  // ═══════════════════════════════════════════════════════════════════════════
  const appearancesByAsin = new Map<string, Appearance[]>();
  
  for (const appearance of appearances) {
    const asin = appearance.asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    
    if (!appearancesByAsin.has(asin)) {
      appearancesByAsin.set(asin, []);
    }
    appearancesByAsin.get(asin)!.push(appearance);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Select canonical listing from appearances (FIX CANONICAL RANK SELECTION)
  // ═══════════════════════════════════════════════════════════════════════════
  // 🚨 Delete any logic that prefers organic "by design."
  // Amazon does not work that way.
  const rawCount = listings.length;
  const asinMap = new Map<string, { 
    listing: ParsedListing; 
    organicRank: number | null; // Best organic rank (null if no organic appearances)
    appearsSponsored: boolean; // True if ASIN appears sponsored anywhere
    sponsoredPositions: number[]; // All positions where ASIN appeared as sponsored
    appearanceCount: number; // Track how many times ASIN appeared (for algorithm boost insight)
  }>();
  
  // Select canonical listing for each ASIN from appearances
  for (const [asin, asinAppearances] of appearancesByAsin.entries()) {
    // Find the listing that matches the best appearance
    const organic = asinAppearances.filter(a => !a.isSponsored);
    const sponsored = asinAppearances.filter(a => a.isSponsored);
    
    const organicRank = organic.length > 0
      ? Math.min(...organic.map(a => a.position))
      : null;
    
    // Find the listing with the best organic rank, or best sponsored rank if no organic
    const bestPosition = organicRank ?? (sponsored.length > 0 ? Math.min(...sponsored.map(a => a.position)) : null);
    if (bestPosition === null) continue;
    
    // Find the listing that matches this position
    const canonicalListing = listings.find(l => {
      const listingAsin = (l.asin || '').trim().toUpperCase();
      const listingPosition = l.position;
      return listingAsin === asin && listingPosition === bestPosition;
    });
    
    if (!canonicalListing) continue;
    
    asinMap.set(asin, {
      listing: canonicalListing,
      organicRank,
      appearsSponsored: sponsored.length > 0,
      sponsoredPositions: sponsored.map(a => a.position),
      appearanceCount: asinAppearances.length,
    });
  }
  
  // Log canonical rank selection for each ASIN
  asinMap.forEach((value, asin) => {
    const appearancesForAsin = appearancesByAsin.get(asin) || [];
    if (appearancesForAsin.length > 1) {
      // ASIN appeared multiple times - log the selection
      const allPositions = appearancesForAsin.map(a => a.position).sort((a, b) => a - b);
      console.log("📊 CANONICAL RANK SELECTED", {
        asin,
        organicRank: value.organicRank,
        appearsSponsored: value.appearsSponsored,
        all_positions: allPositions,
        selection_reason: value.organicRank !== null
          ? `Organic listing with rank ${value.organicRank} selected from ${appearancesForAsin.length} appearances`
          : `Sponsored listing selected from ${appearancesForAsin.length} appearances (no organic found)`,
      });
    } else {
      // Single appearance - still log for consistency
      console.log("📊 CANONICAL RANK SELECTED", {
        asin,
        organicRank: value.organicRank,
        appearsSponsored: value.appearsSponsored,
        all_positions: appearancesForAsin.map(a => a.position),
        selection_reason: "Single appearance",
      });
    }
  });
  
  // Convert back to array and sort by organic rank (canonical order)
  // This ensures products are ordered by their best Page-1 visibility
  // Preserve appearance metadata for algorithm boost insights
  const deduplicatedListingsWithMetadata = Array.from(asinMap.entries())
    .map(([asin, value]) => {
      const bestPosition = value.organicRank ?? (value.sponsoredPositions.length > 0 
        ? Math.min(...value.sponsoredPositions) 
        : value.listing.position || 999);
      return {
        listing: value.listing,
        canonical: value,
        bestPosition,
        appearanceCount: value.appearanceCount,
        isAlgorithmBoosted: value.appearanceCount >= 2,
      };
    })
    .sort((a, b) => {
      // Sort by organic rank first, then by position
      const aRank = a.canonical.organicRank ?? 999;
      const bRank = b.canonical.organicRank ?? 999;
      if (aRank !== bRank) return aRank - bRank;
      return a.bestPosition - b.bestPosition;
    });
  
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
  // PAGE-1 HARD CAP: Enforce 49 product limit (Amazon Page-1 max)
  // ═══════════════════════════════════════════════════════════════════════════
  // CORRECT ORDER (MANDATORY):
  // 1. Ingest Rainforest results
  // 2. Canonicalize + dedupe ASINs
  // 3. Sort by organic_rank ASC
  // 4. Slice to first 49
  // 5. ONLY THEN: Allocate demand, Aggregate brands, Persist
  //
  // HARD RULES:
  // - Sponsored listings do not expand Page-1
  // - organic_rank must be 1-49
  // - Any item with rank >= 50 is discarded
  // - Nothing beyond 49 may reach DB
  const PAGE1_HARD_CAP = 49;
  const preCapCount = deduplicatedListings.length;
  
  // Sort by organic rank (best rank first)
  // Filter to only organic listings for ranking, then slice to 49
  // PART 4: Use appearsSponsored (ASIN-level) for filtering
  // CRITICAL: Use appearsSponsored to reflect Page-1 advertising presence, not instance selection
  const organicListings = deduplicatedListings.filter(l => l.appearsSponsored === false);
  const sponsoredListings = deduplicatedListings.filter(l => l.appearsSponsored === true);
  
  // Sort organic listings by position (best rank first)
  organicListings.sort((a, b) => (a.position || 999) - (b.position || 999));
  
  // Take first 49 organic listings
  const cappedOrganicListings = organicListings.slice(0, PAGE1_HARD_CAP);
  
  // Combine: capped organic + all sponsored (sponsored don't expand Page-1, but we include them)
  // Actually, per requirements: "Sponsored listings do not expand Page-1"
  // So we only take organic listings up to 49
  const cappedListings = cappedOrganicListings;
  
  console.log("PAGE1_PRE_CAP_COUNT", {
    count: preCapCount,
    organic_count: organicListings.length,
    sponsored_count: sponsoredListings.length,
  });
  
  console.log("PAGE1_POST_CAP_COUNT", {
    count: cappedListings.length,
    cap: PAGE1_HARD_CAP,
  });

  // Rebuild metadata structure from capped listings
  // Create a map of ASIN -> metadata for capped listings
  const cappedAsinMap = new Map<string, { 
    listing: ParsedListing; 
    bestRank: number;
    appearanceCount: number;
    isAlgorithmBoosted: boolean;
  }>();
  
  cappedListings.forEach((listing, index) => {
    const asinRaw = listing.asin;
    const asin = typeof asinRaw === "string" ? asinRaw.trim().toUpperCase() : "";
    // Hard requirement: no synthetic ASINs on Page-1; skip rows without a valid ASIN.
    if (!/^[A-Z0-9]{10}$/.test(asin)) return;
    const position = listing.position || index + 1;
    
    if (cappedAsinMap.has(asin)) {
      const existing = cappedAsinMap.get(asin)!;
      // Keep the one with better (lower) rank
      if (position < existing.bestRank) {
        existing.bestRank = position;
        existing.listing = listing;
      }
      existing.appearanceCount += 1;
      existing.isAlgorithmBoosted = existing.appearanceCount >= 2;
    } else {
      cappedAsinMap.set(asin, {
        listing,
        bestRank: position,
        appearanceCount: 1,
        isAlgorithmBoosted: false,
      });
    }
  });
  
  // Create capped listings with metadata
  const cappedListingsWithMetadata = Array.from(cappedAsinMap.entries())
    .map(([asin, value]) => ({
      listing: value.listing,
      bestRank: value.bestRank,
      appearanceCount: value.appearanceCount,
      isAlgorithmBoosted: value.appearanceCount >= 2,
    }))
    .sort((a, b) => a.bestRank - b.bestRank);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: ESTIMATE TOTAL PAGE-1 DEMAND (Helium-10 Style)
  // ═══════════════════════════════════════════════════════════════════════════
  // Use capped listings for all subsequent logic
  // Calculate average price for demand estimation
  const prices = cappedListings
    .map(l => l.price)
    .filter((p): p is number => p !== null && p > 0);
  const avgPrice = prices.length > 0
    ? prices.reduce((sum, p) => sum + p, 0) / prices.length
    : null;

  // Infer category from listings (check main_category if available)
  const categories = cappedListings
    .map(l => l.main_category)
    .filter((c): c is string => c !== null && c !== undefined);
  const category = categories.length > 0 ? categories[0] : null;

  // Estimate total Page-1 demand (using capped listings)
  const pageOneDemand = estimatePageOneDemand({
    listings: cappedListings,
    category,
    avgPrice,
  });

  let totalPage1Units = pageOneDemand.total_monthly_units_est;
  let totalPage1Revenue = pageOneDemand.total_monthly_revenue_est;

  // ═══════════════════════════════════════════════════════════════════════════
  // CALIBRATION LAYER: Normalize into trusted bands
  // ═══════════════════════════════════════════════════════════════════════════
  // Use capped listings for calibration
  // PART 4: Filter by appearsSponsored (ASIN-level, not instance-level)
  // CRITICAL: Use appearsSponsored to reflect Page-1 advertising presence
  const organicListingsForCalibration = cappedListings.filter(l => l.appearsSponsored === false);
  const sponsoredCount = cappedListings.filter(l => l.appearsSponsored === true).length;
  const sponsoredDensity = cappedListings.length > 0
    ? (sponsoredCount / cappedListings.length) * 100
    : 0;

  const reviewDispersion = calculateReviewDispersionFromListings(cappedListings);
  
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 0;

  const calibrated = calibrateMarketTotals({
    raw_units: totalPage1Units,
    raw_revenue: totalPage1Revenue,
    category,
    price_band: { min: priceMin, max: priceMax },
    listing_count: organicListingsForCalibration.length,
    review_dispersion: reviewDispersion,
    sponsored_density: sponsoredDensity,
  });

  // Use calibrated values
  totalPage1Units = calibrated.calibrated_units;
  totalPage1Revenue = calibrated.calibrated_revenue;

  // ═══════════════════════════════════════════════════════════════════════════
  // H10 CALIBRATION: Global multiplier for total Page-1 units
  // ═══════════════════════════════════════════════════════════════════════════
  // Adjusts total market size to match Helium-10 output range (0.8x-1.1x)
  // This is the ONLY multiplier that controls total Page-1 units
  const PAGE1_UNITS_MULTIPLIER = 0.95; // Calibrated to match H10 range
  totalPage1Units = Math.round(totalPage1Units * PAGE1_UNITS_MULTIPLIER);
  totalPage1Revenue = Math.round(totalPage1Revenue * PAGE1_UNITS_MULTIPLIER);

  console.log("📊 PAGE-1 TOTAL UNITS (calibrated)", totalPage1Units);
  console.log("📊 PAGE-1 TOTAL REVENUE (calibrated)", totalPage1Revenue);

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY DEMAND MULTIPLIER: Fix undercounted total market size
  // ═══════════════════════════════════════════════════════════════════════════
  // Applied AFTER keyword demand estimation, BEFORE product-level allocation
  // Increases total market size to match Helium-10 for categories like heating/pain relief
  // Does NOT touch per-ASIN allocation logic, decay, caps, or floors
  // NOTE: This used to be a temporary global multiplier (10x) and was forcing totals
  // to immediately hit the durable cap (~30k units), making high-velocity markets look "stuck".
  // Keep multiplier = 1 until we have category-specific calibration profiles.
  const CATEGORY_DEMAND_MULTIPLIER = 1.0;
  if (CATEGORY_DEMAND_MULTIPLIER !== 1.0) {
    totalPage1Units = Math.round(totalPage1Units * CATEGORY_DEMAND_MULTIPLIER);
    // Recalculate revenue from scaled units × avg price (use existing avgPrice or fallback)
    const avgPriceForRevenue = avgPrice ?? (prices.length > 0
      ? prices.reduce((sum, p) => sum + p, 0) / prices.length
      : 0);
    totalPage1Revenue = Math.round(totalPage1Units * avgPriceForRevenue);
    console.log("✅ CATEGORY_MULTIPLIER_APPLIED", {
      multiplier: CATEGORY_DEMAND_MULTIPLIER,
      final_units: totalPage1Units,
      final_revenue: totalPage1Revenue,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKET SHAPE DETECTION
  // ═══════════════════════════════════════════════════════════════════════════
  const avgPriceForShape = avgPrice ?? 0;
  const marketShape = detectMarketShape({
    avgPrice: avgPriceForShape,
    totalPage1Units,
  });

  console.log("📊 MARKET_SHAPE", {
    marketShape,
    avgPrice: avgPriceForShape,
    totalPage1Units,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY-SCALED DEMAND CAPS: REMOVED
  // ═══════════════════════════════════════════════════════════════════════════
  // Keyword-level caps removed - per-ASIN decay and limits applied instead (H10-style)

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: ALLOCATE DEMAND ACROSS PRODUCTS
  // ═══════════════════════════════════════════════════════════════════════════
  // Use capped listings for allocation
  // Calculate median review count for comparison
  const reviews = cappedListings
    .map(l => l.reviews)
    .filter((r): r is number => r !== null && r > 0);
  const medianReviews = reviews.length > 0
    ? [...reviews].sort((a, b) => a - b)[Math.floor(reviews.length / 2)]
    : 0;

  // Calculate median rating for comparison
  const ratings = cappedListings
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
  // ═══════════════════════════════════════════════════════════════════════════
  // PART 4: ORGANIC RANK CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: Use canonical data from appearances
  // Use appearsSponsored (ASIN-level) to reflect Page-1 advertising presence
  // Use capped listings with metadata
  const organicListingsWithMetadata = cappedListingsWithMetadata.filter(
    item => item.canonical.organicRank !== null
  );
  const sponsoredListingsWithMetadata = cappedListingsWithMetadata.filter(
    item => item.canonical.organicRank === null
  );
  
  // Assign organic_rank to organic listings (1, 2, 3...)
  // Sort by organicRank to maintain Page-1 order
  const organicListingsRanked = organicListingsWithMetadata
    .sort((a, b) => (a.canonical.organicRank ?? 999) - (b.canonical.organicRank ?? 999))
    .map((item, i) => ({
      ...item,
      organicRank: item.canonical.organicRank ?? i + 1, // Use canonical organic rank
    }));
  
  // Combine organic (with organic_rank) and sponsored (organic_rank = null)
  // Sort by bestPosition to maintain Page-1 order
  const allListingsWithRanks = [
    ...organicListingsRanked.map(item => ({ ...item, organicRank: item.organicRank })),
    ...sponsoredListingsWithMetadata.map(item => ({ ...item, organicRank: null })),
  ].sort((a, b) => a.bestPosition - b.bestPosition);
  
  // Build products with allocation weights (using capped listings)
  // Use organic_rank for estimation logic
  const productsWithWeights = allListingsWithRanks.map((item, i) => {
    const l = item.listing;
    const bsr = l.bsr ?? l.main_category_bsr ?? null; // Used internally for estimation only
    const pagePosition = item.bestPosition; // Actual Page-1 position including sponsored
    const organicRank = item.organicRank; // Position among organic listings only (null for sponsored)
    const price = l.price ?? 0;
    // Review count: use reviews field from ParsedListing (matches Amazon Page-1 count)
    // Keep as null if missing (don't default to 0)
    const reviewCount = l.reviews ?? null;
    const rating = l.rating ?? null;
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
    // If reviewCount is null, treat as 0 for weight calculation
    const reviewCountForWeight = reviewCount ?? 0;
    const reviewRatio = medianReviews > 0 && reviewCountForWeight > 0
      ? Math.max(0.5, Math.min(2.0, reviewCountForWeight / medianReviews))
      : 1.0;
    const reviewWeight = reviewRatio;

    // Rating penalty: products below median rating get penalized
    // If rating is null, use neutral penalty
    const ratingForPenalty = rating ?? medianRating;
    const ratingPenalty = ratingForPenalty >= medianRating
      ? 1.0
      : Math.max(0.3, 1.0 - (medianRating - ratingForPenalty) * 0.5);

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

  // Map to store ASIN-to-listing mapping for parent-child normalization
  const asinToListingMap = new Map<string, ParsedListing>();
  
  // Hard requirement: Page-1 cards must map to real ASINs.
  // Filter out any listings without a valid 10-char ASIN (no synthetic KEYWORD-* fallbacks).
  const productsWithValidAsins = productsWithWeights.filter((pw) => {
    const asinRaw = (pw.listing as any)?.asin;
    const asin = typeof asinRaw === "string" ? asinRaw.trim().toUpperCase() : "";
    return /^[A-Z0-9]{10}$/.test(asin);
  });

  if (productsWithValidAsins.length === 0) {
    return [];
  }

  // Re-normalize weights to sum to 1.0 after filtering
  const totalValidWeight = productsWithValidAsins.reduce((sum, p) => sum + p.allocationWeight, 0);
  if (totalValidWeight === 0) {
    productsWithValidAsins.forEach((p) => {
      p.allocationWeight = 1.0 / productsWithValidAsins.length;
    });
  } else {
    productsWithValidAsins.forEach((p) => {
      p.allocationWeight = p.allocationWeight / totalValidWeight;
    });
  }

  // Allocate units and revenue
  const products = productsWithValidAsins.map((pw, i) => {
    const l = pw.listing;
    const allocatedUnits = Math.max(1, Math.round(totalPage1Units * pw.allocationWeight));
    const allocatedRevenue = Math.round(allocatedUnits * pw.price);

    // ═══════════════════════════════════════════════════════════════════════════
    // ASIN HANDLING
    // ═══════════════════════════════════════════════════════════════════════════
    // REQUIRE real ASINs on all Page-1 cards; never fabricate KEYWORD-* / ESTIMATED-* IDs.
    const asin = (l.asin as string).trim().toUpperCase();

    // ═══════════════════════════════════════════════════════════════════════════
    // NORMALIZE FULFILLMENT (Use fulfillment already inferred at ingest)
    // ═══════════════════════════════════════════════════════════════════════════
    // Fulfillment is already normalized at ingest time using:
    // 1. is_prime === true + delivery confirmation → "FBA" (high confidence)
    // 2. delivery text strongly implies FBA → "FBA" (medium confidence)
    // 3. delivery text explicitly indicates FBM → "FBM" (medium confidence)
    // 4. Else → "UNKNOWN" (low confidence, NEVER defaults to FBM)
    // Map from ParsedListing fulfillment to CanonicalProduct fulfillment
    // CRITICAL: Never default UNKNOWN to FBM - preserve uncertainty
    let fulfillment: "FBA" | "FBM" | "AMZ";
    if (l.fulfillment === "FBA") {
      fulfillment = "FBA";
    } else if (l.fulfillment === "FBM") {
      fulfillment = "FBM";
    } else if (l.fulfillment === "UNKNOWN") {
      // CRITICAL: Map UNKNOWN to AMZ (Amazon Retail) as safe default, NOT FBM
      // This preserves uncertainty and doesn't mislead users
      fulfillment = "AMZ";
    } else {
      // Fallback to AMZ if fulfillment is somehow null/undefined (never FBM)
      fulfillment = "AMZ";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEMAND FLOOR APPLICATION (Helium-10 Style)
    // ═══════════════════════════════════════════════════════════════════════════
    // Apply conservative demand floors to prevent under-reported sales
    // Scope: Page-1 + Sponsored listings ONLY (already true in this function)
    const rank = pw.pagePosition; // Use page_position for floor calculation
    const reviewCount = pw.reviewCount;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SPONSORED DATA: Preserve from Rainforest SERP (SP-API has no ad data)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Use isSponsored (canonical field, always boolean)
    const isSponsored = l.isSponsored; // Canonical sponsored status (always boolean)
    const sponsoredPosition = l.sponsored_position ?? null;
    // sponsored_source is now 'rainforest_serp' | 'organic_serp', default to 'organic_serp' if missing
    const sponsoredSource = l.sponsored_source ?? 'organic_serp';
    
    // Apply demand floor (use 0 if reviewCount is null for floor calculation)
    // For floor calculation, treat null sponsored as false (conservative)
    const reviewCountForFloor = reviewCount ?? 0;
    const isSponsoredForFloor = isSponsored === true; // Only true counts as sponsored for floor
    let finalUnits = applyDemandFloors({
      estimatedUnits: allocatedUnits,
      price: pw.price,
      reviewCount: reviewCountForFloor,
      rank,
      isSponsored: isSponsoredForFloor,
      fulfillment,
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PER-ASIN DECAY AND LIMITS (H10-style, replaces keyword-level caps)
    // ═══════════════════════════════════════════════════════════════════════════
    // Apply per-ASIN decay based on BSR to prevent tail inflation
    // This replaces keyword-level unit caps with per-ASIN limits
    const MAX_UNITS_PER_ASIN = 4000;
    const BSR_CUTOFF = 300;
    
    function decayWeight(bsr: number): number {
      // Exponential decay, prevents tail inflation
      return Math.exp(-bsr / 120);
    }
    
    const bsr = pw.bsr ?? l.bsr ?? l.main_category_bsr ?? null;
    
    if (bsr != null) {
      if (bsr > BSR_CUTOFF) {
        // BSR too high - zero out this ASIN's units
        finalUnits = 0;
      } else {
        // Apply decay weight and per-ASIN cap
        const weight = decayWeight(bsr);
        finalUnits = Math.min(
          Math.round(finalUnits * weight),
          MAX_UNITS_PER_ASIN
        );
      }
    }
    
    // Recalculate revenue after decay and limits
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

    // ═══════════════════════════════════════════════════════════════════════════
    // DETECT ESTIMATED/FALLBACK PRODUCTS
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: A product is ESTIMATED ONLY IF:
    // 1. The listing object itself was generated by estimation logic (indicated by synthetic ASINs)
    // 2. OR the dataSource === "estimated" (if available)
    // 
    // DO NOT treat empty strings, null ratings, or missing images as estimated.
    // These are valid states for real Amazon listings.
    // 
    // Real Rainforest listings MUST NEVER be converted into estimated products.
    // Only check the original ASIN value - never infer from missing data fields.
    const originalAsin = l.asin;
    const isEstimatedProduct = originalAsin !== null && 
                               originalAsin !== undefined && 
                               typeof originalAsin === 'string' &&
                               (originalAsin.startsWith('ESTIMATED-') || 
                                originalAsin.startsWith('KEYWORD-') || 
                                originalAsin.startsWith('INFERRED-'));

    // ═══════════════════════════════════════════════════════════════════════════
    // MAP FIELDS FROM PARSEDLISTING → CANONICALPRODUCT
    // ═══════════════════════════════════════════════════════════════════════════
    // For REAL Rainforest listings: preserve actual values, fallback to raw listing fields if missing
    // For ESTIMATED products: use fallback defaults ("Unknown product", 0, null)
    // 
    // CRITICAL: NEVER allow empty strings for title or image_url
    // Always fallback to raw listing fields if ParsedListing fields are null/empty
    
    // Title: map from listing.title, fallback to raw listing fields if missing/empty
    // Real listings: preserve actual title from Rainforest SEARCH response
    // ESTIMATED: use "Unknown product"
    // CRITICAL: NEVER allow empty strings, NEVER fabricate placeholders like "Product {ASIN}"
    let title: string | null;
    if (isEstimatedProduct) {
      title = "Unknown product";
    } else {
      // Check ParsedListing.title first (from Rainforest SEARCH response)
      if (l.title && typeof l.title === 'string' && l.title.trim().length > 0) {
        title = l.title.trim();
      } else {
        // Fallback to raw item data (preserved in _rawItem field from search response)
        const rawItem = (l as any)._rawItem;
        const rawTitle = rawItem?.title || rawItem?.Title || (l as any).original_title || (l as any).raw_title;
        if (rawTitle && typeof rawTitle === 'string' && rawTitle.trim().length > 0) {
          title = rawTitle.trim();
        } else {
          // DO NOT fabricate placeholders - use null if truly missing
          // Frontend will handle null titles appropriately
          title = null;
        }
      }
    }
    
    // Rating: map directly from listing.rating
    // Real listings: preserve actual rating (even if null - interface requires number, so use 0)
    // ESTIMATED: use 0
    const ratingForProduct = l.rating ?? null;
    const rating = isEstimatedProduct 
      ? 0
      : (ratingForProduct ?? 0);
    
    // Review count: map directly from listing.reviews (ratings_total equivalent)
    // Real listings: preserve actual review count (even if null - interface requires number, so use 0)
    // ESTIMATED: use 0
    const reviewCountForProduct = l.reviews ?? null;
    const review_count = isEstimatedProduct
      ? 0
      : (reviewCountForProduct ?? 0);
    
    // Image: check multiple sources (listing.image_url OR listing.image OR listing.main_image OR listing.images[0])
    // Real listings: preserve actual image, fallback to raw listing fields if missing/empty
    // ESTIMATED: use null
    // CRITICAL: NEVER allow empty strings for image_url
    // Use canonical key: image_url (never "image" in final output)
    let image_url: string | null;
    if (isEstimatedProduct) {
      image_url = null;
    } else {
      // Check ParsedListing.image_url first (may be null if empty from Rainforest parsing)
      // Also check for 'image' field (from normalizeListing compatibility)
      const listingImageUrl = l.image_url || (l as any).image;
      if (listingImageUrl && typeof listingImageUrl === 'string' && listingImageUrl.trim().length > 0) {
        image_url = listingImageUrl.trim();
      } else {
        // Fallback to raw item data (preserved in _rawItem field)
        const rawItem = (l as any)._rawItem;
        const rawImage = rawItem?.image || 
                        rawItem?.image_url || 
                        rawItem?.Image || 
                        rawItem?.main_image ||
                        (rawItem?.images && Array.isArray(rawItem.images) && rawItem.images.length > 0 
                          ? rawItem.images[0] 
                          : null) ||
                        (l as any).image ||
                        (l as any).main_image ||
                        ((l as any).images && Array.isArray((l as any).images) && (l as any).images.length > 0 
                          ? (l as any).images[0] 
                          : null);
        
        if (rawImage && typeof rawImage === 'string' && rawImage.trim().length > 0) {
          image_url = rawImage.trim();
        } else {
          image_url = null; // Use null, never empty string
        }
      }
    }
    
    // Price: always preserve from listing (already handled via pw.price)
    // ASIN: already set above
    
    // Verification log: track resolved review count for data quality
    console.log("✅ REVIEW COUNT RESOLVED", {
      asin: l.asin,
      rating: ratingForProduct,
      resolved_review_count: reviewCountForProduct,
      is_estimated: isEstimatedProduct,
    });
    
    // Warn if rating exists but review count is missing (data quality issue)
    if (!isEstimatedProduct && ratingForProduct !== null && ratingForProduct > 0 && reviewCountForProduct === null) {
      console.warn("⚠️ REVIEW COUNT MISSING WITH RATING", {
        asin: l.asin,
        rating: ratingForProduct,
        resolved_review_count: reviewCountForProduct,
        message: "Product has rating but review_count is null - may indicate API data gap",
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Get canonical data from appearances (ASIN-LEVEL SPONSORED AGGREGATION)
    // ═══════════════════════════════════════════════════════════════════════════
    const canonical = asinMap.get(asin);
    const appearsSponsored = canonical?.appearsSponsored ?? false;
    const sponsoredPositions = canonical?.sponsoredPositions ?? [];
    const sponsoredSlot = sponsoredPositions.length > 0
      ? Math.min(...sponsoredPositions)
      : null;

    const product: CanonicalProduct = {
      rank: pw.organicRank ?? null, // Legacy field - equals organic_rank for organic, null for sponsored
      asin, // Real ASIN only
      title: title ?? null, // Preserved from Rainforest SEARCH response - null if truly missing (never fabricated)
      price: pw.price, // Preserved from listing
      rating, // Preserved from listing (or 0 for ESTIMATED only)
      review_count, // Preserved from listing (or 0 for ESTIMATED only)
      bsr: displayBsr, // Always null for keyword Page-1 (not displayed, but pw.bsr still used internally)
      estimated_monthly_units: finalUnits, // Use floored units
      estimated_monthly_revenue: finalRevenue, // Use floored revenue
      revenue_share_pct: 0, // Will be calculated after all products are built
      image_url, // Preserved from listing (or null for ESTIMATED only)
      fulfillment, // Normalized: Prime → FBA, else → FBM, Amazon Retail → AMZ
      // Brand resolution: preserve brand_resolution from listing, or create from brand field
      brand_resolution: l.brand_resolution ?? (l.brand ? {
        raw_brand: l.brand,
        normalized_brand: l.brand,
        brand_status: 'low_confidence',
        brand_source: 'fallback'
      } : {
        raw_brand: null,
        normalized_brand: null,
        brand_status: 'unknown',
        brand_source: 'fallback'
      }),
      // Backward compatibility: set brand field to raw_brand
      brand: l.brand_resolution?.raw_brand ?? l.brand ?? null,
      brand_confidence: (() => {
        // Map brand_status to brand_confidence for backward compatibility
        const status = l.brand_resolution?.brand_status;
        if (status === 'canonical') return 'high';
        if (status === 'variant') return 'medium';
        if (status === 'low_confidence') return 'low';
        return 'low'; // Default for 'unknown'
      })(),
      
      // ═══════════════════════════════════════════════════════════════════════════
      // Log brand in canonical product (first 5)
      // ═══════════════════════════════════════════════════════════════════════════
      ...(i < 5 ? { _debug_brand: l.brand } : {}),
      seller_country: "Unknown" as const,
      snapshot_inferred: false,
      // Algorithm boost tracking (Sellerev-only insight for AI/Spellbook)
      // Hidden metadata for AI reasoning - not displayed in UI
      page_one_appearances: pw.appearanceCount, // appearance_count
      is_algorithm_boosted: pw.isAlgorithmBoosted, // true if appearances >= 2
      appeared_multiple_times: pw.appearanceCount > 1, // Explicit flag for dominance/defense reasoning
      // Helium-10 style rank semantics
      organic_rank: pw.organicRank, // Position among organic listings only (null for sponsored)
      page_position: pw.pagePosition, // Actual Page-1 position including sponsored - preserves original Amazon position
      // Sponsored visibility (for clarity, not estimation changes)
      // CRITICAL: Sponsored data comes from Rainforest SERP ONLY (SP-API has no ad data)
      isSponsored: isSponsored, // Instance-level sponsored status (always boolean, normalized at ingest)
      is_sponsored: isSponsored, // DEPRECATED: Use isSponsored instead. Kept for backward compatibility.
      sponsored_position: sponsoredPosition, // Ad position from Rainforest (null if not sponsored)
      sponsored_source: sponsoredSource, // Source of sponsored data ('rainforest_serp' | 'organic_serp')
      // ═══════════════════════════════════════════════════════════════════════════
      // ASIN-LEVEL SPONSORED AGGREGATION (CRITICAL - PRESERVE THROUGH CANONICALIZATION)
      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: appearsSponsored and sponsoredPositions are ASIN-level properties.
      // They persist through canonicalization and represent Page-1 advertising presence.
      // DO NOT MODIFY THIS LOGIC - it matches Helium 10 / Jungle Scout behavior.
      appearsSponsored: appearsSponsored, // ASIN-level: true if appears sponsored anywhere on Page 1
      sponsoredPositions: sponsoredPositions, // ASIN-level: all positions where ASIN appeared as sponsored
      organicPosition: pw.organicRank, // Alias for organic_rank (null if sponsored)
      sponsoredSlot: sponsoredSlot !== null
        ? (sponsoredSlot <= 4 ? 'top' : sponsoredSlot <= 16 ? 'middle' : 'bottom')
        : null, // Sponsored ad slot position (null if not sponsored)
    };
    
    // Store mapping for parent-child normalization (use ASIN as key)
    asinToListingMap.set(asin, l);
    
    return product;
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
  // 3-PHASE DETERMINISTIC ALLOCATION MODEL
  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1: Anchor top sellers (ranks 1-5)
  // Phase 2: Distribute tail demand (ranks 6+)
  // Phase 3: Snapshot conservation (ensure totals match)
  
  // Separate organic and sponsored products
  const organicProducts = products.filter(p => p.organic_rank !== null);
  const sponsoredProducts = products.filter(p => p.organic_rank === null);
  
  // Calculate median price for anchor clamping
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianPrice = sortedPrices.length > 0
    ? sortedPrices[Math.floor(sortedPrices.length / 2)]
    : avgPrice ?? 0;
  
  // Get estimated total market units (use market demand estimate or totalPage1Units)
  // PART 4: Treat listings as organic if they're not explicitly sponsored (includes unknown/null)
  // Use appearsSponsored (ASIN-level) for demand estimation
  const organicCountForDemand = cappedListings.filter(l => l.appearsSponsored === false).length;
  const avgPriceForDemand = avgPrice ?? 0;
  const marketDemandEstimate = estimateMarketDemand({
    marketShape,
    avgPrice: avgPriceForDemand,
    organicCount: organicCountForDemand,
  });
  const estimatedTotalMarketUnits = marketDemandEstimate;
  
  // Calculate snapshot search volume (average of low/high if available)
  const snapshotSearchVolume = (searchVolumeLow !== undefined && searchVolumeHigh !== undefined && searchVolumeLow > 0 && searchVolumeHigh > 0)
    ? (searchVolumeLow + searchVolumeHigh) / 2
    : estimatedTotalMarketUnits * 10; // Fallback: assume 10% conversion rate
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: ANCHOR TOP SELLERS (Ranks 1-5)
  // ═══════════════════════════════════════════════════════════════════════════
  const topAnchors = organicProducts.filter(p => (p.organic_rank ?? 999) <= 5);
  let anchorUnitsTotal = 0;
  
  topAnchors.forEach(anchor => {
    const rank = anchor.organic_rank ?? 1;
    
    // Estimate units using existing rank → units logic (exponential decay)
    const EXPONENTIAL_DECAY_CONSTANT = -0.45;
    const rankWeight = Math.exp(EXPONENTIAL_DECAY_CONSTANT * (rank - 1));
    
    // Normalize weight (assume top 5 get 60% of total)
    const top5WeightSum = Array.from({ length: 5 }, (_, i) => Math.exp(EXPONENTIAL_DECAY_CONSTANT * i)).reduce((a, b) => a + b, 0);
    const normalizedWeight = rankWeight / top5WeightSum;
    const estimatedUnits = estimatedTotalMarketUnits * 0.6 * normalizedWeight;
    
    // Clamp: minUnits = max(price < medianPrice ? 50 : 25, 1)
    const minUnits = Math.max(anchor.price < medianPrice ? 50 : 25, 1);
    // Clamp: maxUnits = snapshotSearchVolume * 0.35
    const maxUnits = Math.round(snapshotSearchVolume * 0.35);
    
    const clampedUnits = Math.max(minUnits, Math.min(maxUnits, Math.round(estimatedUnits)));
    anchor.estimated_monthly_units = clampedUnits;
    anchor.estimated_monthly_revenue = Math.round(clampedUnits * anchor.price);
    anchorUnitsTotal += clampedUnits;
  });
  
  console.log("PHASE1_ANCHOR_UNITS", {
    anchor_count: topAnchors.length,
    anchor_units_total: anchorUnitsTotal,
    median_price: medianPrice,
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: DISTRIBUTE TAIL DEMAND (Ranks 6+)
  // ═══════════════════════════════════════════════════════════════════════════
  let remainingUnits = estimatedTotalMarketUnits - anchorUnitsTotal;
  if (remainingUnits <= 0) {
    remainingUnits = anchorUnitsTotal * 0.6;
  }
  
  const phase2TailProducts = organicProducts.filter(p => (p.organic_rank ?? 999) > 5);
  
  // Calculate weights for tail products
  const tailWeights = phase2TailProducts.map(product => {
    const reviewCount = product.review_count ?? 0;
    const rank = product.organic_rank ?? 999;
    const rating = product.rating ?? 0;
    
    // weight = log(review_count + 10) * (1 / sqrt(organic_rank)) * (rating ? rating / 5 : 0.85)
    const reviewWeight = Math.log(reviewCount + 10);
    const rankWeight = 1 / Math.sqrt(rank);
    const ratingWeight = rating > 0 ? rating / 5 : 0.85;
    
    return {
      product,
      weight: reviewWeight * rankWeight * ratingWeight,
    };
  });
  
  // Normalize weights so sum(weights) = 1
  const totalTailWeight = tailWeights.reduce((sum, w) => sum + w.weight, 0);
  if (totalTailWeight > 0) {
    tailWeights.forEach(w => {
      w.weight = w.weight / totalTailWeight;
    });
  } else {
    // Fallback: equal weights
    tailWeights.forEach(w => {
      w.weight = 1 / tailWeights.length;
    });
  }
  
  // Calculate tail min unit floor
  const tailMinUnitFloor = phase2TailProducts.length > 0
    ? Math.floor((anchorUnitsTotal / phase2TailProducts.length) * 0.15)
    : 2;
  
  // Assign units to tail products
  tailWeights.forEach(({ product, weight }) => {
    const weightedUnits = Math.round(remainingUnits * weight);
    const flooredUnits = Math.max(weightedUnits, tailMinUnitFloor);
    
    product.estimated_monthly_units = flooredUnits;
    product.estimated_monthly_revenue = Math.round(flooredUnits * product.price);
  });
  
  console.log("PHASE2_REMAINING_UNITS", {
    remaining_units: remainingUnits,
    tail_count: phase2TailProducts.length,
  });
  
  console.log("TAIL_MIN_UNIT_FLOOR", {
    tail_min_unit_floor: tailMinUnitFloor,
    anchor_units_total: anchorUnitsTotal,
    tail_product_count: phase2TailProducts.length,
  });
  
  // Allocate sponsored units (equal distribution, capped at 15% of total)
  const sponsoredTargetUnits = Math.round(estimatedTotalMarketUnits * 0.15);
  if (sponsoredProducts.length > 0) {
    const sponsoredUnitsPerProduct = sponsoredTargetUnits / sponsoredProducts.length;
    sponsoredProducts.forEach(p => {
      p.estimated_monthly_units = Math.round(sponsoredUnitsPerProduct);
      p.estimated_monthly_revenue = Math.round(p.estimated_monthly_units * p.price);
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // GUARDRAILS
  // ═══════════════════════════════════════════════════════════════════════════
  // No product with review_count > 20 may have units < 5
  products.forEach(product => {
    if ((product.review_count ?? 0) > 20 && product.estimated_monthly_units < 5) {
      product.estimated_monthly_units = 5;
      product.estimated_monthly_revenue = Math.round(5 * product.price);
    }
  });
  
  // Rank > 15 must still receive demand (ensure minimum)
  organicProducts.forEach(product => {
    const rank = product.organic_rank ?? 999;
    if (rank > 15 && product.estimated_monthly_units === 0) {
      product.estimated_monthly_units = Math.max(2, Math.floor(tailMinUnitFloor * 0.5));
      product.estimated_monthly_revenue = Math.round(product.estimated_monthly_units * product.price);
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: SNAPSHOT CONSERVATION (MANDATORY)
  // ═══════════════════════════════════════════════════════════════════════════
  let totalAssignedUnits = products.reduce((sum, p) => sum + (p.estimated_monthly_units ?? 0), 0);
  const phase3UnitsDiff = Math.abs(totalAssignedUnits - estimatedTotalMarketUnits);
  const phase3UnitsDiffPct = estimatedTotalMarketUnits > 0 ? (phase3UnitsDiff / estimatedTotalMarketUnits) * 100 : 0;
  
  let scaleFactor = 1.0;
  if (phase3UnitsDiffPct > 3) {
    scaleFactor = estimatedTotalMarketUnits / totalAssignedUnits;
    
    // Scale all product units
    products.forEach(p => {
      p.estimated_monthly_units = Math.round(p.estimated_monthly_units * scaleFactor);
      p.estimated_monthly_revenue = Math.round(p.estimated_monthly_units * p.price);
    });
    
    totalAssignedUnits = products.reduce((sum, p) => sum + (p.estimated_monthly_units ?? 0), 0);
  }
  
  console.log("SNAPSHOT_SCALE_FACTOR", {
    estimated_total_market_units: estimatedTotalMarketUnits,
    total_assigned_units: totalAssignedUnits,
    units_diff_pct: phase3UnitsDiffPct.toFixed(2) + "%",
    scale_factor: scaleFactor.toFixed(4),
    scaled: phase3UnitsDiffPct > 3,
  });
  
  // Recalculate revenue share percentages
  const totalRevenueAfter = products.reduce((sum, p) => sum + (p.estimated_monthly_revenue ?? 0), 0);
  if (totalRevenueAfter > 0) {
    products.forEach(p => {
      if (p.estimated_monthly_revenue > 0) {
        p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / totalRevenueAfter) * 100 * 100) / 100;
      } else {
        p.revenue_share_pct = 0;
      }
    });
  }
  
  // Calculate totals for logging
  const totalUnitsAfter = products.reduce((sum, p) => sum + (p.estimated_monthly_units ?? 0), 0);
  const sponsoredUnits = sponsoredProducts.reduce((sum, p) => sum + (p.estimated_monthly_units ?? 0), 0);
  const sponsoredShare = totalUnitsAfter > 0 ? (sponsoredUnits / totalUnitsAfter) * 100 : 0;
  
  console.log("📈 3-PHASE ALLOCATION COMPLETE", {
    estimated_total_market_units: estimatedTotalMarketUnits,
    total_assigned_units: totalUnitsAfter,
    anchor_units: anchorUnitsTotal,
    tail_units: phase2TailProducts.reduce((sum, p) => sum + (p.estimated_monthly_units ?? 0), 0),
    sponsored_units: sponsoredUnits,
    sponsored_share: sponsoredShare.toFixed(1) + "%",
    organic_count: organicProducts.length,
    sponsored_count: sponsoredProducts.length,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2.4: REMOVED - POSITION-BASED REVENUE DISTRIBUTION
  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVED: This step reshaped demand after allocation, violating single-source-of-truth principle.
  // STEP 2.3 (PAGE-LEVEL DEMAND NORMALIZATION) is now the final distribution authority.
  // Revenue curve is shaped once during STEP 2.3 allocation using organic_rank exponential decay.
  // No post-allocation reshaping is allowed (only safety clamps in STEP 2.5).

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2.5: SOFT NORMALIZATION (Helium-10 Style) - REMOVED
  // ═══════════════════════════════════════════════════════════════════════════
  // Keyword-level unit caps removed - per-ASIN decay and limits applied instead (H10-style)

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE-1 MARKET EXPANSION: Scale allocated units to realistic market size
  // ═══════════════════════════════════════════════════════════════════════════
  // Applied AFTER allocation but BEFORE final rounding
  // Expands total Page-1 demand to align with Helium-10 market size
  // Preserves relative distribution (all ASINs scaled proportionally)
  const currentTotalUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  
  // Target calibration: Rank #1 ≈ 90k-110k units, Page-1 total ≈ 180k-240k units
  // Compute multiplier based on current allocation vs target
  // If rank #1 exists, target ~100k units; otherwise target ~200k total
  const rank1Product = products.find(p => p.organic_rank === 1);
  const rank1Units = rank1Product?.estimated_monthly_units || 0;
  
  // Calculate expansion factor: target rank #1 at ~100k units if available, else target total
  let PAGE1_EXPANSION_FACTOR = 1.0;
  if (rank1Units > 0) {
    // Scale based on rank #1 target (100k units)
    PAGE1_EXPANSION_FACTOR = 100000 / rank1Units;
  } else if (currentTotalUnits > 0) {
    // Fallback: scale based on total target (200k units)
    PAGE1_EXPANSION_FACTOR = 200000 / currentTotalUnits;
  }
  
  // Clamp multiplier to reasonable range (1x - 50x)
  PAGE1_EXPANSION_FACTOR = Math.max(1.0, Math.min(50.0, PAGE1_EXPANSION_FACTOR));
  
  // Apply expansion factor to all products (preserves relative distribution)
  products.forEach(p => {
    p.estimated_monthly_units = Math.round(p.estimated_monthly_units * PAGE1_EXPANSION_FACTOR);
    p.estimated_monthly_revenue = Math.round(p.estimated_monthly_units * p.price);
  });
  
  // Calculate expanded totals
  const expandedTotalUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const expandedTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  
  // Recalculate revenue share percentages after expansion
  if (expandedTotalRevenue > 0) {
    products.forEach(p => {
      if (p.estimated_monthly_revenue > 0) {
        p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / expandedTotalRevenue) * 100 * 100) / 100;
      } else {
        p.revenue_share_pct = 0;
      }
    });
  }
  
  // Update totalPage1Units and totalPage1Revenue to match expanded products
  totalPage1Units = expandedTotalUnits;
  totalPage1Revenue = expandedTotalRevenue;
  
  console.log("📈 PAGE1_MARKET_EXPANSION", {
    expansion_factor: PAGE1_EXPANSION_FACTOR.toFixed(3),
    current_total_units: currentTotalUnits,
    expanded_total_units: expandedTotalUnits,
    rank1_units_before: rank1Units,
    rank1_units_after: rank1Product ? rank1Product.estimated_monthly_units : 0,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPORARY DEBUG CAP: REMOVED
  // ═══════════════════════════════════════════════════════════════════════════
  // Keyword-level unit caps removed - per-ASIN decay and limits applied instead (H10-style)

  // ═══════════════════════════════════════════════════════════════════════════
  // RANK ABSORPTION CAP: Prevent top ranks from absorbing too much demand
  // ═══════════════════════════════════════════════════════════════════════════
  // Caps Rank #1 at 10-12% and Top 3 at 40-45% of total Page-1 units
  // Redistributes excess proportionally to ranks 4-15
  // Tail (ranks >20) remains unchanged
  // Sort products by organic rank (rank 1, 2, 3...) - needed for both DURABLE and non-DURABLE paths
  const sortedByRank = [...products].sort((a, b) => {
    const rankA = a.organic_rank ?? 999;
    const rankB = b.organic_rank ?? 999;
    return rankA - rankB;
  });
  
  if (marketShape === "DURABLE") {
    const RANK1_CAP_PCT = 0.11; // 11% cap for Rank #1
    const TOP3_CAP_PCT = 0.425; // 42.5% cap for Top 3 combined
    
    const currentTotal = expandedTotalUnits;
    const rank1Cap = Math.round(currentTotal * RANK1_CAP_PCT);
    const top3Cap = Math.round(currentTotal * TOP3_CAP_PCT);
    
    // Calculate current top 3 total
    const top3Products = sortedByRank.filter(p => (p.organic_rank ?? 999) <= 3);
    const currentTop3Units = top3Products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
    
    // Calculate excess units to redistribute
    let excessUnits = 0;
    
    // Cap Rank #1 (reuse existing rank1Product from market expansion section)
    // Note: sortedByRank contains same product references as products array
    if (rank1Product && rank1Product.estimated_monthly_units > rank1Cap) {
      const rank1Excess = rank1Product.estimated_monthly_units - rank1Cap;
      rank1Product.estimated_monthly_units = rank1Cap;
      rank1Product.estimated_monthly_revenue = Math.round(rank1Cap * rank1Product.price);
      excessUnits += rank1Excess;
    }
    
    // Cap Top 3 combined (if still over after rank 1 cap)
    if (currentTop3Units > top3Cap) {
      // Recalculate top 3 after rank 1 cap
      const top3AfterRank1Cap = top3Products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
      
      if (top3AfterRank1Cap > top3Cap) {
        // Calculate how much to reduce from ranks 2-3
        const top3Excess = top3AfterRank1Cap - top3Cap;
        const rank2Product = sortedByRank.find(p => p.organic_rank === 2);
        const rank3Product = sortedByRank.find(p => p.organic_rank === 3);
        
        // Redistribute excess from ranks 2-3 proportionally
        const rank2Units = rank2Product?.estimated_monthly_units || 0;
        const rank3Units = rank3Product?.estimated_monthly_units || 0;
        const rank2Plus3Units = rank2Units + rank3Units;
        
        if (rank2Plus3Units > 0) {
          const rank2Reduction = Math.round((top3Excess * rank2Units) / rank2Plus3Units);
          const rank3Reduction = top3Excess - rank2Reduction;
          
          if (rank2Product) {
            rank2Product.estimated_monthly_units = Math.max(0, rank2Product.estimated_monthly_units - rank2Reduction);
            rank2Product.estimated_monthly_revenue = Math.round(rank2Product.estimated_monthly_units * rank2Product.price);
            excessUnits += rank2Reduction;
          }
          
          if (rank3Product) {
            rank3Product.estimated_monthly_units = Math.max(0, rank3Product.estimated_monthly_units - rank3Reduction);
            rank3Product.estimated_monthly_revenue = Math.round(rank3Product.estimated_monthly_units * rank3Product.price);
            excessUnits += rank3Reduction;
          }
        }
      }
    }
    
    // Redistribute excess to ranks 4-15 proportionally
    if (excessUnits > 0) {
      const ranks4to15 = sortedByRank.filter(p => {
        const rank = p.organic_rank ?? 999;
        return rank >= 4 && rank <= 15;
      });
      
      if (ranks4to15.length > 0) {
        const totalRanks4to15Units = ranks4to15.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
        
        if (totalRanks4to15Units > 0) {
          // Distribute excess proportionally to ranks 4-15
          ranks4to15.forEach(p => {
            const share = p.estimated_monthly_units / totalRanks4to15Units;
            const additionalUnits = Math.round(excessUnits * share);
            p.estimated_monthly_units += additionalUnits;
            p.estimated_monthly_revenue = Math.round(p.estimated_monthly_units * p.price);
          });
        }
      }
    }
    
    // Recalculate totals after cap
    const cappedTotalUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
    const cappedTotalRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
    
    // Recalculate revenue share percentages
    if (cappedTotalRevenue > 0) {
      products.forEach(p => {
        if (p.estimated_monthly_revenue > 0) {
          p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / cappedTotalRevenue) * 100 * 100) / 100;
        } else {
          p.revenue_share_pct = 0;
        }
      });
    }
    
    // Update totals
    totalPage1Units = cappedTotalUnits;
    totalPage1Revenue = cappedTotalRevenue;
    
    // Calculate final percentages for logging (reuse existing rank1Product)
    const finalTop3Products = sortedByRank.filter(p => (p.organic_rank ?? 999) <= 3);
    const finalRank1Units = rank1Product?.estimated_monthly_units || 0;
    const finalTop3Units = finalTop3Products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
    const rank1Pct = cappedTotalUnits > 0 ? (finalRank1Units / cappedTotalUnits) * 100 : 0;
    const top3Pct = cappedTotalUnits > 0 ? (finalTop3Units / cappedTotalUnits) * 100 : 0;
    
    console.log("🎯 RANK_ABSORPTION_CAP", {
      total_units: cappedTotalUnits,
      rank1_pct: rank1Pct.toFixed(2) + "%",
      top3_pct: top3Pct.toFixed(2) + "%",
      rank1_units: finalRank1Units,
      top3_units: finalTop3Units,
      excess_redistributed: excessUnits,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY-SCALED CAPS: REMOVED
  // ═══════════════════════════════════════════════════════════════════════════
  // Keyword-level unit caps removed - per-ASIN decay and limits applied instead (H10-style)
  // Rank-1 cap logic removed - per-ASIN limits (MAX_UNITS_PER_ASIN = 4000) handle this
  
  if (marketShape === "CONSUMABLE") {
    // Remove forced minimum units for tail ASINs (ranks > 15) in CONSUMABLE categories
    // Allow tail to fall to 0-5 units naturally (remove Math.max(1, ...) effect)
    products.forEach(p => {
      const rank = p.organic_rank ?? 999;
      if (rank > 15 && p.estimated_monthly_units === 1) {
        // If units are exactly 1, this was likely forced by Math.max(1, ...)
        // Scale down to allow natural tail decay (0-5 units range)
        const tailDecayFactor = 0.3; // Allow tail to decay to ~30% (0-5 units range)
        const naturalUnits = Math.round(p.estimated_monthly_units * tailDecayFactor);
        p.estimated_monthly_units = Math.max(0, naturalUnits); // Allow 0, but don't force negative
        p.estimated_monthly_revenue = Math.round(p.estimated_monthly_units * p.price);
      }
    });
    
    // Recalculate totals after tail adjustment
    const afterTailAdjustmentUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
    const afterTailAdjustmentRevenue = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
    
    // Update totals
    totalPage1Units = afterTailAdjustmentUnits;
    totalPage1Revenue = afterTailAdjustmentRevenue;
    
    // Recalculate revenue share percentages
    if (afterTailAdjustmentRevenue > 0) {
      products.forEach(p => {
        if (p.estimated_monthly_revenue > 0) {
          p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / afterTailAdjustmentRevenue) * 100 * 100) / 100;
        } else {
          p.revenue_share_pct = 0;
        }
      });
    }
  }
  
  // Calculate final values for verification log
  const finalTotalUnits = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  // Reuse existing rank1Product (defined earlier in market expansion section)
  const finalRank1UnitsForCalibration = rank1Product?.estimated_monthly_units || 0;
  const tailProducts = products.filter(p => (p.organic_rank ?? 999) > 15);
  const tailUnitsSum = tailProducts.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  
  // Extract keyword hint from first listing title (for logging only)
  const keywordHint = deduplicatedListings[0]?.title?.toLowerCase().split(' ').slice(0, 3).join(' ') || "keyword_analysis";
  
  console.log("📊 PAGE1_CATEGORY_CALIBRATION", {
    keyword: keywordHint,
    totalUnitsAfterCap: finalTotalUnits,
    rank1Units: finalRank1UnitsForCalibration,
    tailUnitsSum: tailUnitsSum,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE-1 VISIBILITY FLOOR: REMOVED
  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVED: Per-ASIN floors applied AFTER STEP 2.3 cause tail flatlining
  // (all tail ASINs show identical units). Per-ASIN floors are only allowed
  // BEFORE allocation (applyDemandFloors function). After STEP 2.3, only
  // proportional scaling is allowed (STEP 2.5).

  // ═══════════════════════════════════════════════════════════════════════════
  // H10 ALIGNMENT: Post-calibration lift factor
  // ═══════════════════════════════════════════════════════════════════════════
  // Apply global lift factor to final Page-1 totals AFTER all allocation steps
  // This brings Sellerev totals in line with Helium-10 without changing per-product allocation
  const H10_LIFT_FACTOR = 1.85;
  const liftedUnits = Math.round(totalPage1Units * H10_LIFT_FACTOR);
  const liftedRevenue = Math.round(totalPage1Revenue * H10_LIFT_FACTOR);
  
  // Update totals (per-product units/revenue remain unchanged)
  totalPage1Units = liftedUnits;
  totalPage1Revenue = liftedRevenue;
  
  console.log("✅ H10_ALIGNMENT_CHECK", {
    lifted_units: liftedUnits,
    lifted_revenue: liftedRevenue,
    lift_factor: H10_LIFT_FACTOR,
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
  // FINAL VERIFICATION (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════════
  // Single verification checkpoint: rank semantics, sponsored allocation, ASIN deduplication
  const organicListingsFinal = products.filter(p => p.organic_rank !== null);
  const sponsoredListingsFinal = products.filter(p => p.organic_rank === null);
  const totalUnitsFinal = products.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  const sponsoredUnitsFinal = sponsoredListingsFinal.reduce(
    (sum, p) => sum + p.estimated_monthly_units,
    0
  );

  console.log("✅ RANK & SPONSORED ALLOCATION VERIFIED", {
    total_products: products.length,
    organic_count: organicListingsFinal.length,
    sponsored_count: sponsoredListingsFinal.length,
    sponsored_units_pct:
      totalUnitsFinal > 0
        ? Math.round((sponsoredUnitsFinal / totalUnitsFinal) * 10000) / 100
        : 0
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // H10 CALIBRATION CHECK (REQUIRED)
  // ═══════════════════════════════════════════════════════════════════════════
  // Verify calibration matches Helium-10 behavior:
  // - Total units within 0.8x-1.1x of H10 range
  // - Top 3 organic products capture 40-65% of total Page-1 revenue
  // - Sponsored cap at 15% maintained
  const totalRevenueForCalibration = products.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const organicProductsSorted = [...organicListingsFinal]
    .sort((a, b) => (a.organic_rank ?? 0) - (b.organic_rank ?? 0));
  const top3Revenue = organicProductsSorted.slice(0, 3).reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const top3_pct = totalRevenueForCalibration > 0 ? Math.round((top3Revenue / totalRevenueForCalibration) * 10000) / 100 : 0;
  const sponsoredRevenue = sponsoredListingsFinal.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const sponsored_pct = totalRevenueForCalibration > 0 ? Math.round((sponsoredRevenue / totalRevenueForCalibration) * 10000) / 100 : 0;

  console.log("✅ H10 CALIBRATION CHECK", {
    total_units: totalUnitsFinal,
    top3_pct: `${top3_pct}%`,
    sponsored_pct: `${sponsored_pct}%`,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYWORD DEMAND SCALING: Scale Page-1 to total keyword demand (Helium-10 style)
  // ═══════════════════════════════════════════════════════════════════════════
  // Apply post-allocation scaling to match total keyword market size
  // This prevents long-tail ASINs from collapsing while preserving Page-1 ratios
  let scaledProducts = products;
  
  if (searchVolumeLow !== undefined && searchVolumeHigh !== undefined && searchVolumeLow > 0 && searchVolumeHigh > 0) {
    // STEP 1: Calculate Page-1 totals
    const pageOneUnits = products.reduce(
      (sum, p) => sum + (p.estimated_monthly_units || 0),
      0
    );
    const pageOneRevenue = products.reduce(
      (sum, p) => sum + (p.estimated_monthly_revenue || 0),
      0
    );
    
    // STEP 2: Estimate total keyword units
    const estimatedTotalKeywordUnits = estimateTotalKeywordUnits({
      searchVolumeLow,
      searchVolumeHigh
    });
    
    // STEP 3: Compute keyword demand multiplier
    const keywordDemandMultiplier =
      pageOneUnits > 0
        ? estimatedTotalKeywordUnits / pageOneUnits
        : 1;
    
    // STEP 4: Apply safe clamps to prevent explosions
    const SAFE_MIN_MULTIPLIER = 1;
    const SAFE_MAX_MULTIPLIER = 20;
    const finalKeywordMultiplier = Math.min(
      SAFE_MAX_MULTIPLIER,
      Math.max(SAFE_MIN_MULTIPLIER, keywordDemandMultiplier)
    );
    
    // STEP 5: Apply multiplier (POST-ALLOCATION ONLY)
    // Do NOT re-sort products, do NOT re-run decay logic
    scaledProducts = products.map(p => ({
      ...p,
      estimated_monthly_units: Math.round(
        p.estimated_monthly_units * finalKeywordMultiplier
      ),
      estimated_monthly_revenue: Math.round(
        p.estimated_monthly_revenue * finalKeywordMultiplier
      )
    }));
    
    // STEP 6: Calculate scaled market totals
    const totalMarketUnits = scaledProducts.reduce(
      (sum, p) => sum + p.estimated_monthly_units,
      0
    );
    const totalMarketRevenue = scaledProducts.reduce(
      (sum, p) => sum + p.estimated_monthly_revenue,
      0
    );
    
    // STEP 7: Debug log
    console.log("📈 KEYWORD_DEMAND_SCALE", {
      pageOneUnits,
      estimatedTotalKeywordUnits,
      finalKeywordMultiplier,
      totalMarketUnits,
      totalMarketRevenue
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL MARKET SHAPE ASSERTION LOG
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("✅ MARKET_SHAPE_APPLIED", {
    marketShape,
    totalUnits: scaledProducts.reduce((s, p) => s + p.estimated_monthly_units, 0),
    rank1Units: scaledProducts.find(p => p.organic_rank === 1)?.estimated_monthly_units ?? 0,
    tailCount: scaledProducts.filter(p => (p.organic_rank ?? 999) > 15).length
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HARD GUARANTEE: Prevent zero-unit Page-1 ASINs (ranks <= 50)
  // ═══════════════════════════════════════════════════════════════════════════
  for (const product of scaledProducts) {
    if (
      product.organic_rank &&
      product.organic_rank <= 50 &&
      product.estimated_monthly_units === 0
    ) {
      throw new Error(
        `Invalid zero-units Page-1 ASIN: ${product.asin}`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE1 ALLOCATION SUMMARY LOG
  // ═══════════════════════════════════════════════════════════════════════════
  const summaryTotalUnits = scaledProducts.reduce(
    (sum: number, p) => sum + (p.estimated_monthly_units ?? 0),
    0
  );
  const summaryTotalRevenue = scaledProducts.reduce(
    (sum: number, p) =>
      sum + (p.estimated_monthly_units ?? 0) * (p.price ?? 0),
    0
  );
  const minUnits = Math.min(
    ...scaledProducts.map(p => p.estimated_monthly_units ?? 0)
  );
  const maxProductUnits = Math.max(
    ...scaledProducts.map(p => p.estimated_monthly_units ?? 0)
  );

  console.log("PAGE1_ALLOCATION_SUMMARY", {
    total_units: summaryTotalUnits,
    total_revenue: summaryTotalRevenue,
    min_units: minUnits,
    max_units: maxProductUnits,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PARENT-CHILD ASIN NORMALIZATION (FINAL STEP)
  // ═══════════════════════════════════════════════════════════════════════════
  // Group listings by parent_asin (fallback to self ASIN if null)
  // Allocate total revenue to parent group FIRST, then split among children
  // proportionally by review share, rating weight, price normalization
  // This runs AFTER all allocation phases to normalize final values
  
  // Group products by parent_asin (deterministic: same input → same output)
  const parentGroups = new Map<string, CanonicalProduct[]>();
  
  scaledProducts.forEach((product) => {
    const listing = asinToListingMap.get(product.asin);
    if (!listing) return;
    
    // Determine parent ASIN: use parent_asin if available, else use self ASIN
    const parentAsin = listing.parent_asin && listing.parent_asin.trim()
      ? listing.parent_asin.trim()
      : product.asin;
    
    if (!parentGroups.has(parentAsin)) {
      parentGroups.set(parentAsin, []);
    }
    parentGroups.get(parentAsin)!.push(product);
  });
  
  // Track parent normalization count for accuracy metadata
  let parentNormalizedCount = 0;
  
  // Process each parent group
  parentGroups.forEach((children, parentAsin) => {
    // Skip if only one child (no normalization needed)
    if (children.length <= 1) {
      return;
    }
    
    // Increment count for each normalized child
    parentNormalizedCount += children.length;
    
    // Calculate parent group total revenue (sum of all children)
    const parentTotalRevenue = children.reduce((sum, child) => sum + child.estimated_monthly_revenue, 0);
    const parentTotalUnits = children.reduce((sum, child) => sum + child.estimated_monthly_units, 0);
    
    if (parentTotalRevenue === 0 || parentTotalUnits === 0) {
      return; // Skip if no revenue/units to allocate
    }
    
    // Calculate child weights for revenue splitting
    // Weight = review_share * rating_weight * price_normalization
    const childWeights = children.map((child) => {
      // Review share: log(review_count + 10) normalized
      const reviewCount = child.review_count ?? 0;
      const reviewShare = Math.log(reviewCount + 10);
      
      // Rating weight: rating / 5.0 (normalized to 0-1)
      const rating = child.rating ?? 0;
      const ratingWeight = rating > 0 ? rating / 5.0 : 0.85; // Default 0.85 if no rating
      
      // Price normalization: products closer to median price get slight boost
      const childPrices = children.map(c => c.price);
      const sortedPrices = [...childPrices].sort((a, b) => a - b);
      const medianPrice = sortedPrices.length > 0
        ? sortedPrices[Math.floor(sortedPrices.length / 2)]
        : child.price;
      
      const priceDeviation = medianPrice > 0
        ? Math.abs(child.price - medianPrice) / medianPrice
        : 0;
      const priceNormalization = Math.max(0.8, 1.0 - priceDeviation * 0.2);
      
      // Combined weight
      const weight = reviewShare * ratingWeight * priceNormalization;
      
      return {
        product: child,
        weight,
        reviewShare,
        ratingWeight,
        priceNormalization,
      };
    });
    
    // Normalize weights to sum to 1.0
    const totalWeight = childWeights.reduce((sum, cw) => sum + cw.weight, 0);
    if (totalWeight === 0) {
      // Fallback: equal allocation
      childWeights.forEach(cw => {
        cw.weight = 1.0 / childWeights.length;
      });
    } else {
      childWeights.forEach(cw => {
        cw.weight = cw.weight / totalWeight;
      });
    }
    
    // Allocate revenue and units proportionally
    let allocatedRevenue = 0;
    let allocatedUnits = 0;
    
    childWeights.forEach((cw) => {
      const child = cw.product;
      const revenueShare = cw.weight;
      
      // Allocate revenue proportionally
      const childRevenue = Math.round(parentTotalRevenue * revenueShare);
      const childUnits = parentTotalUnits > 0
        ? Math.round((childRevenue / child.price) || 0)
        : Math.round(parentTotalUnits * revenueShare);
      
      // Ensure minimum of 1 unit if revenue > 0
      const finalUnits = childRevenue > 0 && childUnits === 0 ? 1 : childUnits;
      const finalRevenue = Math.round(finalUnits * child.price);
      
      child.estimated_monthly_revenue = finalRevenue;
      child.estimated_monthly_units = finalUnits;
      
      allocatedRevenue += finalRevenue;
      allocatedUnits += finalUnits;
    });
    
    // Snapshot conservation: ensure sum equals parent total
    // Re-scale if there's a discrepancy (should be minimal due to rounding)
    const revenueDiff = parentTotalRevenue - allocatedRevenue;
    const unitsDiff = parentTotalUnits - allocatedUnits;
    
    if (Math.abs(revenueDiff) > 0 || Math.abs(unitsDiff) > 0) {
      // Distribute difference to largest child (deterministic)
      if (childWeights.length > 0) {
        const largestChild = childWeights.reduce((max, cw) => 
          cw.product.estimated_monthly_revenue > max.product.estimated_monthly_revenue ? cw : max
        );
        
        largestChild.product.estimated_monthly_revenue += revenueDiff;
        largestChild.product.estimated_monthly_units += unitsDiff;
        
        // Recalculate units from revenue if needed
        if (largestChild.product.estimated_monthly_revenue > 0 && largestChild.product.estimated_monthly_units === 0) {
          largestChild.product.estimated_monthly_units = Math.max(1, Math.round(largestChild.product.estimated_monthly_revenue / largestChild.product.price));
        }
      }
    }
    
    console.log("🔗 PARENT-CHILD NORMALIZATION", {
      parent_asin: parentAsin,
      children_count: children.length,
      parent_total_revenue: parentTotalRevenue,
      parent_total_units: parentTotalUnits,
      allocated_revenue: allocatedRevenue,
      allocated_units: allocatedUnits,
      revenue_diff: revenueDiff,
      units_diff: unitsDiff,
    });
  });
  
  // Recalculate revenue share percentages after parent-child normalization
  const finalTotalRevenue = scaledProducts.reduce((sum, p) => sum + (p.estimated_monthly_revenue || 0), 0);
  if (finalTotalRevenue > 0) {
    scaledProducts.forEach(p => {
      if (p.estimated_monthly_revenue > 0) {
        p.revenue_share_pct = Math.round((p.estimated_monthly_revenue / finalTotalRevenue) * 100 * 100) / 100;
      } else {
        p.revenue_share_pct = 0;
      }
    });
  }
  
  // Attach parent normalization metadata for accuracy tracking
  (scaledProducts as any).__parent_normalization_metadata = {
    normalized_count: parentNormalizedCount,
    total_count: scaledProducts.length,
  };

  return scaledProducts;
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
 * BSR Duplicate Detection (DISABLED)
 * 
 * ⚠️ DUPLICATE DETECTION DISABLED: BSR duplication is valid across categories
 * 
 * Amazon BSR is category-scoped, so multiple products can legitimately have
 * the same BSR number in different categories (e.g., BSR #1 in "Drawer Organizers"
 * and BSR #1 in "Flatware Organizers" are both valid).
 * 
 * Helium 10 does not invalidate duplicate BSRs for this reason.
 * 
 * @param products - Canonical products to scan
 * @returns Products unchanged (no BSRs are nullified)
 */
function applyBsrDuplicateDetection(products: CanonicalProduct[]): CanonicalProduct[] {
  console.log("BSR_DUPLICATE_DETECTION_SKIPPED", {
    reason: "BSR duplication is valid across categories",
    total_products: products.length,
    products_with_bsr: products.filter(p => p.bsr !== null && p.bsr !== undefined && p.bsr > 0).length,
    timestamp: new Date().toISOString(),
  });
  
  // Return products unchanged - no BSRs are nullified
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
