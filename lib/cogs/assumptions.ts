/**
 * COGS Assumption Engine
 * 
 * Estimates Cost of Goods Sold (COGS) ranges based on sourcing model and category.
 * Used for margin calculations when exact COGS is not available.
 */

export interface CogsRangeEstimate {
  low: number;
  high: number;
  percent_range: [number, number];
  confidence: "low" | "medium" | "high";
  source: "assumption_model";
}

type SourcingModel = 
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

type Category = 
  | "electronics"
  | "home_kitchen"
  | "default";

/**
 * Estimate COGS range based on sourcing model and category
 * 
 * @param params.sourcing_model - Seller's sourcing model
 * @param params.category - Product category (optional, affects Private Label ranges)
 * @param params.avg_price - Average selling price (used to compute dollar values)
 * @returns COGS range estimate with confidence level
 */
export function estimateCogsRange({
  sourcing_model,
  category,
  avg_price,
}: {
  sourcing_model: SourcingModel;
  category?: string | null;
  avg_price: number;
}): CogsRangeEstimate {
  // Normalize category for Private Label logic
  const normalizedCategory = normalizeCategory(category);
  
  let percentLow: number;
  let percentHigh: number;
  let confidence: "low" | "medium" | "high" = "medium";

  // Determine COGS percentage range based on sourcing model
  switch (sourcing_model) {
    case "private_label":
      // Category-specific adjustments for Private Label
      if (normalizedCategory === "electronics") {
        percentLow = 30;
        percentHigh = 45;
      } else if (normalizedCategory === "home_kitchen") {
        percentLow = 20;
        percentHigh = 30;
      } else {
        // Default Private Label range
        percentLow = 25;
        percentHigh = 35;
      }
      confidence = "medium";
      break;

    case "wholesale_arbitrage":
      percentLow = 55;
      percentHigh = 75;
      confidence = "medium";
      break;

    case "retail_arbitrage":
      percentLow = 60;
      percentHigh = 80;
      confidence = "medium";
      break;

    case "dropshipping":
      percentLow = 70;
      percentHigh = 85;
      confidence = "medium";
      break;

    case "not_sure":
    default:
      percentLow = 40;
      percentHigh = 65;
      confidence = "low";
      break;
  }

  // Compute dollar values from percentages (preserve precision)
  const low = (avg_price * percentLow) / 100;
  const high = (avg_price * percentHigh) / 100;

  return {
    low,
    high,
    percent_range: [percentLow, percentHigh],
    confidence,
    source: "assumption_model",
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
    normalized.includes("camera")
  ) {
    return "electronics";
  }

  // Home & Kitchen variations
  if (
    normalized.includes("home") ||
    normalized.includes("kitchen") ||
    normalized.includes("household") ||
    normalized.includes("cookware") ||
    normalized.includes("appliance") ||
    normalized.includes("decor")
  ) {
    return "home_kitchen";
  }

  return "default";
}
