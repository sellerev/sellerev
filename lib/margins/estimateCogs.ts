/**
 * COGS Assumption Engine
 * 
 * Estimates Cost of Goods Sold (COGS) ranges based on sourcing model and category.
 * Internal assumptions - DO NOT expose these rules in UI.
 */

type SourcingModel =
  | "private_label"
  | "wholesale_arbitrage"
  | "retail_arbitrage"
  | "dropshipping"
  | "not_sure";

export interface CogsEstimate {
  cogs_min: number;
  cogs_max: number;
  confidence: "low" | "medium";
}

/**
 * Estimate COGS range based on sourcing model and category
 * 
 * @param avg_price - Average selling price
 * @param category - Product category (optional)
 * @param sourcing_model - Seller's sourcing model from seller_profiles
 * @returns COGS estimate with min/max range and confidence
 */
export function estimateCogs({
  avg_price,
  category,
  sourcing_model,
}: {
  avg_price: number;
  category?: string | null;
  sourcing_model: SourcingModel;
}): CogsEstimate {
  let percentMin: number;
  let percentMax: number;
  let confidence: "low" | "medium" = "medium";

  switch (sourcing_model) {
    case "private_label":
      // Category-specific adjustments
      const normalizedCategory = category?.toLowerCase().trim() || "";
      
      if (normalizedCategory.includes("electronic")) {
        // Electronics: 30–45%
        percentMin = 30;
        percentMax = 45;
      } else if (
        normalizedCategory.includes("home") ||
        normalizedCategory.includes("kitchen") ||
        normalizedCategory.includes("household")
      ) {
        // Simple home goods: 20–30%
        percentMin = 20;
        percentMax = 30;
      } else {
        // Default: 25–35%
        percentMin = 25;
        percentMax = 35;
      }
      break;

    case "wholesale_arbitrage":
    case "retail_arbitrage":
      // Wholesale / Arbitrage: 55–75%
      percentMin = 55;
      percentMax = 75;
      break;

    case "dropshipping":
      // Dropshipping: 70–85%
      percentMin = 70;
      percentMax = 85;
      break;

    case "not_sure":
    default:
      // Not sure: 40–60% with low confidence
      percentMin = 40;
      percentMax = 60;
      confidence = "low";
      break;
  }

  // Compute dollar values from percentages
  const cogs_min = (avg_price * percentMin) / 100;
  const cogs_max = (avg_price * percentMax) / 100;

  return {
    cogs_min,
    cogs_max,
    confidence,
  };
}
