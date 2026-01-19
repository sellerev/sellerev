/**
 * Competitive Pressure Index (CPI) Calculator
 * 
 * Computes a single decisive signal (0-100) that answers:
 * "How hard is Page 1 to compete on for this seller?"
 * 
 * REQUIREMENTS:
 * - Cached (computed from stored data)
 * - Reproducible (same inputs = same output)
 * - Explainable (clear formula)
 * - Seller-context aware (considers seller stage)
 * - NOT an AI opinion (pure calculation)
 * 
 * CPI RANGES:
 * - 0-30: Low pressure (opportunity zone)
 * - 31-60: Moderate pressure
 * - 61-80: High pressure
 * - 81-100: Extreme / brand-locked
 * 
 * CPI COMPONENTS (DETERMINISTIC):
 * A. Review Dominance Score (0-30)
 * B. Brand Concentration Score (0-25)
 * C. Sponsored Saturation Score (0-20)
 * D. Price Compression Score (0-15)
 * E. Seller Fit Modifier (-10 to +10)
 * Total: 0-100
 */

import { ParsedListing } from "./keywordMarket";

type SellerStage = "new" | "existing" | "scaling";

interface CPIContext {
  listings: ParsedListing[];
  sellerStage: SellerStage;
  sellerExperienceMonths: number | null;
}

interface CPICalculation {
  score: number; // 0-100
  label: string; // "Low competitive pressure" | "Moderate competitive pressure" | "High competitive pressure" | "Extreme competitive pressure"
  breakdown: {
    review_dominance: number; // 0-30 points
    brand_concentration: number; // 0-25 points
    sponsored_saturation: number; // 0-20 points
    price_compression: number; // 0-15 points
    seller_fit_modifier: number; // -10 to +10 points
  };
  explanation: string;
}

/**
 * Calculate Competitive Pressure Index from Page 1 listings
 * 
 * @param context - CPI calculation context (listings + seller profile)
 * @returns CPI calculation result with score, components, and explanation
 */
export function calculateCPI(context: CPIContext): CPICalculation {
  const { listings, sellerStage, sellerExperienceMonths } = context;
  
  // Guard: Need listings to calculate
  if (!listings || listings.length === 0) {
    return {
      score: 0,
      label: "Low competitive pressure",
      breakdown: {
        review_dominance: 0,
        brand_concentration: 0,
        sponsored_saturation: 0,
        price_compression: 0,
        seller_fit_modifier: 0,
      },
      explanation: "No Page 1 listings available",
    };
  }

  // Component A: Review Dominance Score (0-30 points)
  // top3_reviews = sum reviews of top 3 listings
  // page1_reviews = sum reviews of all page-1 listings
  // review_dominance = top3_reviews / page1_reviews
  const listingsWithReviews = listings
    .filter(l => l.reviews !== null && l.reviews !== undefined && l.reviews > 0)
    .map(l => ({ ...l, reviews: l.reviews ?? 0 }));
  
  const sortedByReviews = [...listingsWithReviews].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  const top3Reviews = sortedByReviews.slice(0, 3).reduce((sum, l) => sum + (l.reviews ?? 0), 0);
  const page1Reviews = listingsWithReviews.reduce((sum, l) => sum + (l.reviews ?? 0), 0);
  
  const reviewDominance = page1Reviews > 0 ? top3Reviews / page1Reviews : 0;
  
  let reviewDominanceScore = 0;
  if (reviewDominance > 0.55) {
    reviewDominanceScore = 30;
  } else if (reviewDominance >= 0.40) {
    reviewDominanceScore = 22;
  } else if (reviewDominance >= 0.25) {
    reviewDominanceScore = 14;
  } else if (reviewDominance > 0) {
    reviewDominanceScore = 6;
  }

  // Component B: Brand Concentration Score (0-25 points)
  // Top brand's share of Page 1 listings
  const brandCounts: Record<string, number> = {};
  listings.forEach(l => {
    if (l.brand) {
      brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
    }
  });
  
  const topBrands = Object.entries(brandCounts)
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count);
  
  const brandConcentration = topBrands.length > 0 && listings.length > 0
    ? (topBrands[0].count / listings.length) * 100
    : 0;
  
  let brandConcentrationScore = 0;
  if (brandConcentration >= 40) {
    brandConcentrationScore = 25;
  } else if (brandConcentration >= 25) {
    brandConcentrationScore = 18;
  } else if (brandConcentration >= 15) {
    brandConcentrationScore = 10;
  } else if (brandConcentration > 0) {
    brandConcentrationScore = 4;
  }

  // Component C: Sponsored Saturation Score (0-20 points)
  // sponsored_ratio = sponsored_listings / page1_listings
  const sponsoredCount = listings.filter(l => l.is_sponsored).length;
  const sponsoredRatio = listings.length > 0 ? sponsoredCount / listings.length : 0;
  const sponsoredPercentage = sponsoredRatio * 100;
  
  let sponsoredSaturationScore = 0;
  if (sponsoredPercentage >= 50) {
    sponsoredSaturationScore = 20;
  } else if (sponsoredPercentage >= 30) {
    sponsoredSaturationScore = 14;
  } else if (sponsoredPercentage >= 15) {
    sponsoredSaturationScore = 8;
  } else if (sponsoredPercentage > 0) {
    sponsoredSaturationScore = 3;
  }

  // Component D: Price Compression Score (0-15 points)
  // price_range = (p90 - p10) / avg_price
  const listingsWithPrice = listings
    .filter(l => l.price !== null && l.price !== undefined && l.price > 0)
    .map(l => l.price!);
  
  let priceCompressionScore = 0;
  if (listingsWithPrice.length >= 10) {
    // Need at least 10 prices to calculate p10 and p90
    const sortedPrices = [...listingsWithPrice].sort((a, b) => a - b);
    const p10Index = Math.floor(sortedPrices.length * 0.1);
    const p90Index = Math.floor(sortedPrices.length * 0.9);
    const p10 = sortedPrices[p10Index];
    const p90 = sortedPrices[p90Index];
    const avgPrice = listingsWithPrice.reduce((sum, p) => sum + p, 0) / listingsWithPrice.length;
    
      if (avgPrice > 0) {
        const priceRange = (p90 - p10) / avgPrice;
        const priceRangePercent = priceRange * 100;
        
        if (priceRangePercent < 15) {
          priceCompressionScore = 15; // Race to bottom
        } else if (priceRangePercent < 30) {
          priceCompressionScore = 9;
        } else {
          priceCompressionScore = 4; // ≥ 30%
        }
      }
  } else if (listingsWithPrice.length > 0) {
    // Fallback: use min/max if we have fewer than 10 prices
    const sortedPrices = [...listingsWithPrice].sort((a, b) => a - b);
    const minPrice = sortedPrices[0];
    const maxPrice = sortedPrices[sortedPrices.length - 1];
    const avgPrice = listingsWithPrice.reduce((sum, p) => sum + p, 0) / listingsWithPrice.length;
    
      if (avgPrice > 0) {
        const priceRange = (maxPrice - minPrice) / avgPrice;
        const priceRangePercent = priceRange * 100;
        
        if (priceRangePercent < 15) {
          priceCompressionScore = 15; // Race to bottom
        } else if (priceRangePercent < 30) {
          priceCompressionScore = 9;
        } else {
          priceCompressionScore = 4; // ≥ 30%
        }
      }
  }

  // Component E: Seller Fit Modifier (-10 to +10 points)
  // Additive modifier based on seller stage
  let sellerFitModifier = 0;
  if (sellerStage === "new") {
    sellerFitModifier = 10; // New sellers face higher pressure
  } else if (sellerStage === "existing") {
    sellerFitModifier = 0; // Neutral
  } else if (sellerStage === "scaling") {
    sellerFitModifier = -10; // Scaling sellers face lower pressure
  }

  // Calculate final CPI (0-100)
  const baseCPI = reviewDominanceScore + brandConcentrationScore + sponsoredSaturationScore + priceCompressionScore;
  const finalScore = Math.min(100, Math.max(0, Math.round(baseCPI + sellerFitModifier)));

  // Generate CPI label based on score
  let label: string;
  if (finalScore <= 30) {
    label = "Low — structurally penetrable";
  } else if (finalScore <= 60) {
    label = "Moderate — requires differentiation";
  } else if (finalScore <= 80) {
    label = "High — strong incumbents";
  } else {
    label = "Extreme — brand-locked";
  }

  // Generate explanation
  const explanation = generateCPIExplanation(
    finalScore,
    {
      reviewDominanceScore,
      brandConcentrationScore,
      sponsoredSaturationScore,
      priceCompressionScore,
      sellerFitModifier,
    },
    reviewDominance,
    brandConcentration,
    sponsoredPercentage,
    listings.length,
    sellerStage
  );

  return {
    score: finalScore,
    label,
    breakdown: {
      review_dominance: reviewDominanceScore,
      brand_concentration: brandConcentrationScore,
      sponsored_saturation: sponsoredSaturationScore,
      price_compression: priceCompressionScore,
      seller_fit_modifier: sellerFitModifier,
    },
    explanation,
  };
}

/**
 * Generate human-readable explanation of CPI calculation
 */
function generateCPIExplanation(
  cpi: number,
  components: {
    reviewDominanceScore: number;
    brandConcentrationScore: number;
    sponsoredSaturationScore: number;
    priceCompressionScore: number;
    sellerFitModifier: number;
  },
  reviewDominance: number,
  brandConcentration: number,
  sponsoredPercentage: number,
  totalListings: number,
  sellerStage: SellerStage
): string {
  const pressureLevel = cpi <= 30 ? "Low" : cpi <= 60 ? "Moderate" : cpi <= 80 ? "High" : "Extreme";
  
  const parts: string[] = [];
  parts.push(`CPI: ${cpi} (${pressureLevel} pressure)`);
  
  if (components.reviewDominanceScore > 0) {
    parts.push(`Review dominance: ${(reviewDominance * 100).toFixed(0)}% top 3 share (${components.reviewDominanceScore} pts)`);
  }
  
  if (components.brandConcentrationScore > 0) {
    parts.push(`Brand concentration: ${brandConcentration.toFixed(0)}% top brand (${components.brandConcentrationScore} pts)`);
  }
  
  if (components.sponsoredSaturationScore > 0) {
    parts.push(`Sponsored saturation: ${sponsoredPercentage.toFixed(0)}% sponsored (${components.sponsoredSaturationScore} pts)`);
  }
  
  if (components.priceCompressionScore > 0) {
    parts.push(`Price compression: ${components.priceCompressionScore} pts`);
  }
  
  if (components.sellerFitModifier !== 0) {
    const modifierText = components.sellerFitModifier > 0 
      ? `+${components.sellerFitModifier} (${sellerStage} seller)`
      : `${components.sellerFitModifier} (${sellerStage} seller)`;
    parts.push(`Seller fit modifier: ${modifierText}`);
  }
  
  return parts.join(" | ");
}













