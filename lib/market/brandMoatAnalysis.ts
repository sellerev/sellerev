/**
 * Brand Moat Analysis
 * 
 * Computes deterministic Brand Moat verdict from Page-1 data only.
 * 
 * Rules:
 * - Page-1 only (no historical inference)
 * - Deterministic output
 * - Missing brand = "UNKNOWN" (not failure)
 * - Never hallucinates brand dominance
 */

export interface BrandMoatVerdict {
  verdict: "NO_MOAT" | "SOFT_MOAT" | "HARD_MOAT";
  dominant_brand?: string;
  brand_revenue_share_pct?: number;
  page_one_slots?: number;
  top_ten_slots?: number;
  signals: {
    revenue_concentration: boolean;
    slot_control: boolean;
    review_ladder: boolean;
    price_immunity: boolean;
  };
}

export interface PageOneProduct {
  asin: string;
  brand: string | null;
  estimated_monthly_revenue: number;
  review_count: number;
  price: number;
  page_position: number; // 1-based position on Page-1
}

/**
 * Normalizes brand name (handles null, empty, UNKNOWN)
 */
function normalizeBrand(brand: string | null | undefined): string {
  if (!brand || typeof brand !== "string" || brand.trim().length === 0) {
    return "UNKNOWN";
  }
  return brand.trim();
}

/**
 * A. Brand Revenue Share
 * 
 * Groups listings by brand, sums revenue per brand, calculates % of total Page-1 revenue.
 */
function calculateBrandRevenueShare(
  products: PageOneProduct[]
): {
  brandRevenue: Record<string, number>;
  brandRevenueShare: Record<string, number>;
  totalRevenue: number;
} {
  const brandRevenue: Record<string, number> = {};
  let totalRevenue = 0;

  // Sum revenue per brand
  products.forEach((p) => {
    const brand = normalizeBrand(p.brand);
    const revenue = p.estimated_monthly_revenue || 0;

    if (!brandRevenue[brand]) {
      brandRevenue[brand] = 0;
    }
    brandRevenue[brand] += revenue;
    totalRevenue += revenue;
  });

  // Calculate % share per brand
  const brandRevenueShare: Record<string, number> = {};
  Object.keys(brandRevenue).forEach((brand) => {
    brandRevenueShare[brand] =
      totalRevenue > 0 ? (brandRevenue[brand] / totalRevenue) * 100 : 0;
  });

  return { brandRevenue, brandRevenueShare, totalRevenue };
}

/**
 * B. Brand Slot Control
 * 
 * Counts ASINs per brand on Page-1 and in top-10.
 * Top-10 slots are weighted higher (counted separately).
 */
function calculateBrandSlotControl(
  products: PageOneProduct[]
): {
  pageOneSlotsPerBrand: Record<string, number>;
  topTenSlotsPerBrand: Record<string, number>;
} {
  const pageOneSlotsPerBrand: Record<string, number> = {};
  const topTenSlotsPerBrand: Record<string, number> = {};

  products.forEach((p) => {
    const brand = normalizeBrand(p.brand);
    const position = p.page_position || 0;

    // Count all Page-1 slots
    if (!pageOneSlotsPerBrand[brand]) {
      pageOneSlotsPerBrand[brand] = 0;
    }
    pageOneSlotsPerBrand[brand] += 1;

    // Count top-10 slots separately (weighted higher)
    if (position >= 1 && position <= 10) {
      if (!topTenSlotsPerBrand[brand]) {
        topTenSlotsPerBrand[brand] = 0;
      }
      topTenSlotsPerBrand[brand] += 1;
    }
  });

  return { pageOneSlotsPerBrand, topTenSlotsPerBrand };
}

/**
 * C. Brand Review Density
 * 
 * Calculates median reviews per brand.
 * Compares top brand median vs non-brand median.
 * Detects review laddering (1 very high + multiple mid-high).
 */
function calculateBrandReviewDensity(
  products: PageOneProduct[],
  dominantBrand: string | null
): {
  medianReviewsPerBrand: Record<string, number>;
  topBrandMedianReviews: number | null;
  nonBrandMedianReviews: number | null;
  hasReviewLadder: boolean;
} {
  // Group products by brand
  const brandGroups: Record<string, PageOneProduct[]> = {};
  products.forEach((p) => {
    const brand = normalizeBrand(p.brand);
    if (!brandGroups[brand]) {
      brandGroups[brand] = [];
    }
    brandGroups[brand].push(p);
  });

  // Calculate median reviews per brand
  const medianReviewsPerBrand: Record<string, number> = {};
  Object.keys(brandGroups).forEach((brand) => {
    const reviews = brandGroups[brand]
      .map((p) => p.review_count || 0)
      .sort((a, b) => a - b);
    const mid = Math.floor(reviews.length / 2);
    medianReviewsPerBrand[brand] =
      reviews.length > 0
        ? reviews.length % 2 === 0
          ? (reviews[mid - 1] + reviews[mid]) / 2
          : reviews[mid]
        : 0;
  });

  // Calculate top brand median
  const topBrandMedianReviews =
    dominantBrand && medianReviewsPerBrand[dominantBrand]
      ? medianReviewsPerBrand[dominantBrand]
      : null;

  // Calculate non-brand median (excluding dominant brand)
  const nonBrandProducts = products.filter(
    (p) => normalizeBrand(p.brand) !== dominantBrand
  );
  const nonBrandReviews = nonBrandProducts
    .map((p) => p.review_count || 0)
    .sort((a, b) => a - b);
  const nonBrandMid = Math.floor(nonBrandReviews.length / 2);
  const nonBrandMedianReviews =
    nonBrandReviews.length > 0
      ? nonBrandReviews.length % 2 === 0
        ? (nonBrandReviews[nonBrandMid - 1] + nonBrandReviews[nonBrandMid]) / 2
        : nonBrandReviews[nonBrandMid]
      : null;

  // Detect review laddering: top brand has 1 very high review product + multiple mid-high
  // This is a heuristic: if top brand has at least 3 products, and the max review is 3x+ the median
  let hasReviewLadder = false;
  if (dominantBrand && brandGroups[dominantBrand]) {
    const dominantBrandProducts = brandGroups[dominantBrand];
    if (dominantBrandProducts.length >= 3) {
      const reviews = dominantBrandProducts.map((p) => p.review_count || 0);
      const maxReview = Math.max(...reviews);
      const median = medianReviewsPerBrand[dominantBrand] || 0;
      // If max review is 3x+ median, and there are multiple products, likely laddering
      hasReviewLadder = maxReview > 0 && median > 0 && maxReview >= median * 3;
    }
  }

  return {
    medianReviewsPerBrand,
    topBrandMedianReviews,
    nonBrandMedianReviews,
    hasReviewLadder,
  };
}

/**
 * D. Brand Price Immunity
 * 
 * Compares brand price median vs Page-1 price median.
 * Flags if brand prices ≥15% higher and still top-ranked.
 */
function calculateBrandPriceImmunity(
  products: PageOneProduct[],
  dominantBrand: string | null
): {
  brandPriceMedian: number | null;
  pageOnePriceMedian: number;
  hasPriceImmunity: boolean;
} {
  // Calculate Page-1 price median
  const allPrices = products
    .map((p) => p.price || 0)
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  const pageOneMid = Math.floor(allPrices.length / 2);
  const pageOnePriceMedian =
    allPrices.length > 0
      ? allPrices.length % 2 === 0
        ? (allPrices[pageOneMid - 1] + allPrices[pageOneMid]) / 2
        : allPrices[pageOneMid]
      : 0;

  // Calculate brand price median (if dominant brand exists)
  let brandPriceMedian: number | null = null;
  let hasPriceImmunity = false;

  if (dominantBrand) {
    const brandProducts = products.filter(
      (p) => normalizeBrand(p.brand) === dominantBrand
    );
    const brandPrices = brandProducts
      .map((p) => p.price || 0)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    const brandMid = Math.floor(brandPrices.length / 2);
    brandPriceMedian =
      brandPrices.length > 0
        ? brandPrices.length % 2 === 0
          ? (brandPrices[brandMid - 1] + brandPrices[brandMid]) / 2
          : brandPrices[brandMid]
        : null;

    // Check price immunity: brand median ≥15% higher than Page-1 median AND still top-ranked
    if (
      brandPriceMedian !== null &&
      pageOnePriceMedian > 0 &&
      brandPriceMedian >= pageOnePriceMedian * 1.15
    ) {
      // Check if brand has top-10 slots (still competitive despite higher price)
      const brandTop10Slots = brandProducts.filter(
        (p) => (p.page_position || 0) >= 1 && (p.page_position || 0) <= 10
      ).length;
      hasPriceImmunity = brandTop10Slots >= 2; // At least 2 top-10 slots despite premium pricing
    }
  }

  return { brandPriceMedian, pageOnePriceMedian, hasPriceImmunity };
}

/**
 * Analyzes Brand Moat from Page-1 products.
 * 
 * Computes deterministic verdict based on:
 * - Brand revenue share
 * - Brand slot control (Page-1 + top-10)
 * - Brand review density/laddering
 * - Brand price immunity
 * 
 * @param products - Page-1 products with brand, revenue, reviews, price, position
 * @returns Brand Moat verdict with signals
 */
export function analyzeBrandMoat(
  products: PageOneProduct[]
): BrandMoatVerdict {
  // Guard: If no products, return NO_MOAT
  if (!products || products.length === 0) {
    return {
      verdict: "NO_MOAT",
      signals: {
        revenue_concentration: false,
        slot_control: false,
        review_ladder: false,
        price_immunity: false,
      },
    };
  }

  // A. Calculate brand revenue share
  const { brandRevenueShare, brandRevenue } =
    calculateBrandRevenueShare(products);

  // Find dominant brand by revenue share
  let dominantBrand: string | null = null;
  let dominantBrandRevenueShare = 0;

  Object.keys(brandRevenueShare).forEach((brand) => {
    if (brand !== "UNKNOWN" && brandRevenueShare[brand] > dominantBrandRevenueShare) {
      dominantBrand = brand;
      dominantBrandRevenueShare = brandRevenueShare[brand];
    }
  });

  // B. Calculate brand slot control
  const { pageOneSlotsPerBrand, topTenSlotsPerBrand } =
    calculateBrandSlotControl(products);

  const dominantBrandPageOneSlots =
    dominantBrand && pageOneSlotsPerBrand[dominantBrand]
      ? pageOneSlotsPerBrand[dominantBrand]
      : 0;
  const dominantBrandTopTenSlots =
    dominantBrand && topTenSlotsPerBrand[dominantBrand]
      ? topTenSlotsPerBrand[dominantBrand]
      : 0;

  // C. Calculate brand review density
  const {
    topBrandMedianReviews,
    nonBrandMedianReviews,
    hasReviewLadder,
  } = calculateBrandReviewDensity(products, dominantBrand);

  // D. Calculate brand price immunity
  const { hasPriceImmunity } = calculateBrandPriceImmunity(
    products,
    dominantBrand
  );

  // Build signals object
  const signals = {
    revenue_concentration: dominantBrandRevenueShare >= 25, // 25%+ revenue share
    slot_control:
      dominantBrandPageOneSlots >= 5 && dominantBrandTopTenSlots >= 3, // 5+ Page-1 slots AND 3+ top-10 slots
    review_ladder: hasReviewLadder, // Review laddering detected
    price_immunity: hasPriceImmunity, // Price immunity detected
  };

  // ──────────────────────────────────────────────────────────────────────────────
  // BRAND MOAT CLASSIFICATION
  // ──────────────────────────────────────────────────────────────────────────────
  // Thresholds (hard-coded):
  // - Hard Moat: Brand revenue ≥40% OR (≥5 Page-1 ASINs AND ≥3 top-10 slots)
  // - Soft Moat: Brand revenue 25–40% OR strong review ladder without slot dominance
  // - No Moat: Everything else

  let verdict: "NO_MOAT" | "SOFT_MOAT" | "HARD_MOAT" = "NO_MOAT";

  // Hard Moat: Revenue ≥40% OR (≥5 Page-1 slots AND ≥3 top-10 slots)
  if (
    dominantBrandRevenueShare >= 40 ||
    (dominantBrandPageOneSlots >= 5 && dominantBrandTopTenSlots >= 3)
  ) {
    verdict = "HARD_MOAT";
  }
  // Soft Moat: Revenue 25–40% OR strong review ladder without slot dominance
  else if (
    (dominantBrandRevenueShare >= 25 && dominantBrandRevenueShare < 40) ||
    (hasReviewLadder && dominantBrandPageOneSlots < 5)
  ) {
    verdict = "SOFT_MOAT";
  }

  // Build verdict object
  const brandMoat: BrandMoatVerdict = {
    verdict,
    signals,
  };

  // Only include dominant brand data if moat exists
  if (verdict !== "NO_MOAT" && dominantBrand && dominantBrand !== "UNKNOWN") {
    brandMoat.dominant_brand = dominantBrand;
    brandMoat.brand_revenue_share_pct = Math.round(dominantBrandRevenueShare * 100) / 100;
    brandMoat.page_one_slots = dominantBrandPageOneSlots;
    brandMoat.top_ten_slots = dominantBrandTopTenSlots;
  }

  return brandMoat;
}

