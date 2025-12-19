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
 * - Seller-context aware (considers seller stage/experience)
 * - NOT an AI opinion (pure calculation)
 * 
 * CPI RANGES:
 * - 0-30: Low pressure (opportunity zone)
 * - 31-60: Moderate pressure
 * - 61-80: High pressure
 * - 81-100: Extreme / brand-locked
 */

import { ParsedListing } from "./keywordMarket";

type SellerStage = "new" | "existing" | "scaling";

interface CPIContext {
  listings: ParsedListing[];
  sellerStage: SellerStage;
  sellerExperienceMonths: number | null;
}

interface CPICalculation {
  cpi: number; // 0-100
  components: {
    reviewBarrierScore: number; // 0-40 points
    sponsoredCompetitionScore: number; // 0-25 points
    brandDominanceScore: number; // 0-20 points
    listingDensityScore: number; // 0-15 points
  };
  sellerContextModifier: number; // Multiplier based on seller experience
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
      cpi: 0,
      components: {
        reviewBarrierScore: 0,
        sponsoredCompetitionScore: 0,
        brandDominanceScore: 0,
        listingDensityScore: 0,
      },
      sellerContextModifier: 1.0,
      explanation: "No Page 1 listings available",
    };
  }

  // Component 1: Review Barrier Score (0-40 points)
  // Higher average reviews = higher pressure
  const listingsWithReviews = listings.filter(l => l.reviews !== null && l.reviews > 0);
  const avgReviews = listingsWithReviews.length > 0
    ? listingsWithReviews.reduce((sum, l) => sum + (l.reviews ?? 0), 0) / listingsWithReviews.length
    : 0;
  
  let reviewBarrierScore = 0;
  if (avgReviews >= 10000) {
    reviewBarrierScore = 40; // Extreme barrier
  } else if (avgReviews >= 5000) {
    reviewBarrierScore = 30; // High barrier
  } else if (avgReviews >= 2000) {
    reviewBarrierScore = 20; // Moderate barrier
  } else if (avgReviews >= 500) {
    reviewBarrierScore = 10; // Low barrier
  } else {
    reviewBarrierScore = 0; // Minimal barrier
  }

  // Component 2: Sponsored Competition Score (0-25 points)
  // More sponsored listings = higher pressure (indicates paid competition)
  const sponsoredCount = listings.filter(l => l.is_sponsored).length;
  const sponsoredPercentage = (sponsoredCount / listings.length) * 100;
  
  let sponsoredCompetitionScore = 0;
  if (sponsoredPercentage >= 50) {
    sponsoredCompetitionScore = 25; // Extreme paid competition
  } else if (sponsoredPercentage >= 30) {
    sponsoredCompetitionScore = 18; // High paid competition
  } else if (sponsoredPercentage >= 15) {
    sponsoredCompetitionScore = 12; // Moderate paid competition
  } else if (sponsoredPercentage >= 5) {
    sponsoredCompetitionScore = 6; // Low paid competition
  } else {
    sponsoredCompetitionScore = 0; // Minimal paid competition
  }

  // Component 3: Brand Dominance Score (0-20 points)
  // Higher brand concentration = harder to break in
  const brandCounts: Record<string, number> = {};
  listings.forEach(l => {
    if (l.brand) {
      brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
    }
  });
  
  const topBrands = Object.entries(brandCounts)
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count);
  
  const topBrandDominance = topBrands.length > 0 && listings.length > 0
    ? (topBrands[0].count / listings.length) * 100
    : 0;
  
  let brandDominanceScore = 0;
  if (topBrandDominance >= 60) {
    brandDominanceScore = 20; // Extreme dominance (brand-locked)
  } else if (topBrandDominance >= 40) {
    brandDominanceScore = 15; // High dominance
  } else if (topBrandDominance >= 25) {
    brandDominanceScore = 10; // Moderate dominance
  } else if (topBrandDominance >= 15) {
    brandDominanceScore = 5; // Low dominance
  } else {
    brandDominanceScore = 0; // Minimal dominance
  }

  // Component 4: Listing Density Score (0-15 points)
  // More listings on Page 1 = more competition
  const totalListings = listings.length;
  
  let listingDensityScore = 0;
  if (totalListings >= 40) {
    listingDensityScore = 15; // Very crowded
  } else if (totalListings >= 25) {
    listingDensityScore = 10; // Crowded
  } else if (totalListings >= 15) {
    listingDensityScore = 6; // Moderate density
  } else if (totalListings >= 8) {
    listingDensityScore = 3; // Low density
  } else {
    listingDensityScore = 0; // Minimal density
  }

  // Calculate base CPI (0-100)
  const baseCPI = reviewBarrierScore + sponsoredCompetitionScore + brandDominanceScore + listingDensityScore;

  // Seller Context Modifier
  // New sellers face higher effective pressure (multiplier > 1.0)
  // Experienced sellers face lower effective pressure (multiplier < 1.0)
  let sellerContextModifier = 1.0;
  
  if (sellerStage === "new") {
    // New sellers: 1.2x multiplier (20% harder)
    sellerContextModifier = 1.2;
  } else if (sellerStage === "existing") {
    // Existing sellers: 0.9x multiplier (10% easier)
    sellerContextModifier = 0.9;
  } else if (sellerStage === "scaling") {
    // Scaling sellers: 0.8x multiplier (20% easier)
    sellerContextModifier = 0.8;
  }
  
  // Additional experience-based adjustment
  if (sellerExperienceMonths !== null && sellerExperienceMonths > 0) {
    if (sellerExperienceMonths >= 24) {
      sellerContextModifier *= 0.85; // Very experienced: 15% easier
    } else if (sellerExperienceMonths >= 12) {
      sellerContextModifier *= 0.95; // Experienced: 5% easier
    }
  }

  // Apply modifier and clamp to 0-100
  const finalCPI = Math.min(100, Math.max(0, Math.round(baseCPI * sellerContextModifier)));

  // Generate explanation
  const explanation = generateCPIExplanation(
    finalCPI,
    {
      reviewBarrierScore,
      sponsoredCompetitionScore,
      brandDominanceScore,
      listingDensityScore,
    },
    avgReviews,
    sponsoredPercentage,
    topBrandDominance,
    totalListings,
    sellerStage
  );

  return {
    cpi: finalCPI,
    components: {
      reviewBarrierScore,
      sponsoredCompetitionScore,
      brandDominanceScore,
      listingDensityScore,
    },
    sellerContextModifier,
    explanation,
  };
}

/**
 * Generate human-readable explanation of CPI calculation
 */
function generateCPIExplanation(
  cpi: number,
  components: {
    reviewBarrierScore: number;
    sponsoredCompetitionScore: number;
    brandDominanceScore: number;
    listingDensityScore: number;
  },
  avgReviews: number,
  sponsoredPercentage: number,
  topBrandDominance: number,
  totalListings: number,
  sellerStage: SellerStage
): string {
  const pressureLevel = cpi <= 30 ? "Low" : cpi <= 60 ? "Moderate" : cpi <= 80 ? "High" : "Extreme";
  
  const parts: string[] = [];
  parts.push(`CPI: ${cpi} (${pressureLevel} pressure)`);
  
  if (components.reviewBarrierScore > 0) {
    parts.push(`Review barrier: ${Math.round(avgReviews).toLocaleString()} avg reviews (${components.reviewBarrierScore} pts)`);
  }
  
  if (components.sponsoredCompetitionScore > 0) {
    parts.push(`Paid competition: ${Math.round(sponsoredPercentage)}% sponsored (${components.sponsoredCompetitionScore} pts)`);
  }
  
  if (components.brandDominanceScore > 0) {
    parts.push(`Brand control: ${Math.round(topBrandDominance)}% top brand (${components.brandDominanceScore} pts)`);
  }
  
  if (components.listingDensityScore > 0) {
    parts.push(`Page 1 density: ${totalListings} listings (${components.listingDensityScore} pts)`);
  }
  
  if (sellerStage === "new") {
    parts.push(`Seller context: New seller (1.2x modifier applied)`);
  }
  
  return parts.join(" | ");
}
