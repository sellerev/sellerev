/**
 * COGS Assumption Engine
 * 
 * Estimates Cost of Goods Sold (COGS) ranges based on sourcing model and category.
 * Used for margin calculations when exact COGS is not available.
 * 
 * ASIN MODE RULES (single-listing margin feasibility):
 * - Private Label:
 *   - Simple home goods: 20–30% of price
 *   - Complex/electronics: 30–45%
 *   - Beauty: 25–40% (default fallback)
 * - Wholesale / Arbitrage: 55–75% of price
 * - Retail Arbitrage: 60–80% of price
 * - Dropshipping: 70–85% of price
 * - Not sure: widen range by +5% with LOW confidence
 */

export interface CogsRangeEstimate {
  low: number;
  high: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
}

type SourcingModel = 
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

type Category = 
  | "electronics"
  | "home_goods"
  | "beauty"
  | "default";

/**
 * Estimate COGS range based on sourcing model and category
 * 
 * @param params.price - Average selling price (from market_snapshot.avg_price)
 * @param params.category - Product category (derived from keyword or ASIN)
 * @param params.sourcing_model - Seller's sourcing model from seller_profiles
 * @returns COGS range estimate with confidence level and rationale
 */
export function estimateCogsRange({
  price,
  category,
  sourcing_model,
}: {
  price: number;
  category?: string | null;
  sourcing_model: SourcingModel;
}): CogsRangeEstimate {
  // Normalize category for Private Label logic
  const normalizedCategory = normalizeCategory(category);
  
  let percentLow: number;
  let percentHigh: number;
  let confidence: "low" | "medium" | "high" = "medium";
  let rationale: string;

  // Determine COGS percentage range based on sourcing model
  switch (sourcing_model) {
    case "private_label":
      // Category-specific adjustments for Private Label
      if (normalizedCategory === "electronics") {
        percentLow = 30;
        percentHigh = 45;
        rationale = "Private Label electronics typically cost 30–45% of selling price due to component costs and manufacturing complexity.";
      } else if (normalizedCategory === "home_goods") {
        percentLow = 20;
        percentHigh = 30;
        rationale = "Private Label home goods typically cost 20–30% of selling price due to lower manufacturing complexity.";
      } else if (normalizedCategory === "beauty") {
        percentLow = 25;
        percentHigh = 40;
        rationale = "Private Label beauty products typically cost 25–40% of selling price due to packaging and formulation costs.";
      } else {
        // Default Private Label range (fallback)
        percentLow = 25;
        percentHigh = 35;
        rationale = "Private Label products typically cost 25–35% of selling price (category-specific data not available).";
      }
      confidence = "medium";
      break;

    case "wholesale_arbitrage":
      // Wholesale / Arbitrage
      percentLow = 55;
      percentHigh = 75;
      confidence = "medium";
      rationale = "Wholesale/Arbitrage products typically cost 55–75% of selling price due to middleman margins and sourcing costs.";
      break;

    case "retail_arbitrage":
      // Retail Arbitrage (separate from wholesale)
      percentLow = 60;
      percentHigh = 80;
      confidence = "medium";
      rationale = "Retail Arbitrage products typically cost 60–80% of selling price due to retail markup and sourcing costs.";
      break;

    case "dropshipping":
      percentLow = 70;
      percentHigh = 85;
      confidence = "medium";
      rationale = "Dropshipping products typically cost 70–85% of selling price due to supplier margins and fulfillment fees.";
      break;

    case "not_sure":
    default:
      // Not sure: widen range by +5% (more conservative)
      percentLow = 40;
      percentHigh = 65; // Widened from 60% to 65%
      confidence = "low";
      rationale = "Estimated COGS range of 40–65% of selling price (sourcing model not specified, widened range for uncertainty).";
      break;
  }

  // Compute dollar values from percentages
  const low = (price * percentLow) / 100;
  const high = (price * percentHigh) / 100;

  return {
    low,
    high,
    confidence,
    rationale,
  };
}

/**
 * Normalize category string to known categories
 * Handles variations and case-insensitive matching
 */
function normalizeCategory(category: string | null | undefined): Category {
  if (!category) {
    return "default";
  }

  const normalized = category.toLowerCase().trim();

  // Electronics variations
  if (
    normalized.includes("electronic") ||
    normalized.includes("tech") ||
    normalized.includes("computer") ||
    normalized.includes("phone") ||
    normalized.includes("tablet") ||
    normalized.includes("audio") ||
    normalized.includes("camera") ||
    normalized.includes("gadget")
  ) {
    return "electronics";
  }

  // Home goods variations
  if (
    normalized.includes("home") ||
    normalized.includes("kitchen") ||
    normalized.includes("household") ||
    normalized.includes("cookware") ||
    normalized.includes("appliance") ||
    normalized.includes("decor") ||
    normalized.includes("furniture") ||
    normalized.includes("bedding") ||
    normalized.includes("bath")
  ) {
    return "home_goods";
  }

  // Beauty variations
  if (
    normalized.includes("beauty") ||
    normalized.includes("cosmetic") ||
    normalized.includes("skincare") ||
    normalized.includes("makeup") ||
    normalized.includes("personal care") ||
    normalized.includes("hair") ||
    normalized.includes("fragrance") ||
    normalized.includes("perfume")
  ) {
    return "beauty";
  }

  return "default";
}
