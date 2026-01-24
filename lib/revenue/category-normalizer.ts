/**
 * Category Normalizer for Revenue Estimation
 * 
 * Normalizes SP-API category names to stable estimation category keys.
 * Prevents display_group codes (like "wireless_display_on_website") from being used in estimation.
 */

export interface CategoryNormalizationInput {
  spCategoryName?: string | null;
  spBrowseNodeId?: string | null;
  productType?: string | null;
  fallbackKeywordCategory?: string | null;
}

export interface CategoryNormalizationResult {
  estimation_category_key: string; // e.g. "electronics_cell_phone_accessories"
  display_category_name: string;   // e.g. "Cell Phones & Accessories"
  normalization_reason: string;
}

/**
 * Normalizes category for revenue estimation
 * 
 * Rules:
 * 1. If spCategoryName includes "Cell Phone" (Cases, Bumpers, Grips, etc.), map to electronics_cell_phone_accessories
 * 2. If spCategoryName includes "Electronics" but not specific, map to electronics_general
 * 3. Else fallback to existing category key logic but DO NOT accept values ending with "_display_on_website"
 * 
 * @param input - Category normalization input
 * @returns Normalized category result
 */
export function normalizeCategoryForEstimation(
  input: CategoryNormalizationInput
): CategoryNormalizationResult {
  const { spCategoryName, spBrowseNodeId, productType, fallbackKeywordCategory } = input;
  
  // Normalize category name for matching (case-insensitive, trimmed)
  const normalizedCategoryName = spCategoryName
    ? spCategoryName.trim().toLowerCase()
    : null;

  // RULE 1: Cell Phone accessories (Cases, Bumpers, Grips, etc.)
  if (normalizedCategoryName) {
    if (
      normalizedCategoryName.includes("cell phone") ||
      normalizedCategoryName.includes("cellphone") ||
      normalizedCategoryName.includes("mobile phone") ||
      normalizedCategoryName.includes("smartphone")
    ) {
      // Check if it's a specific accessory type
      if (
        normalizedCategoryName.includes("case") ||
        normalizedCategoryName.includes("bumper") ||
        normalizedCategoryName.includes("grip") ||
        normalizedCategoryName.includes("holder") ||
        normalizedCategoryName.includes("accessory") ||
        normalizedCategoryName.includes("protector")
      ) {
        return {
          estimation_category_key: "electronics_cell_phone_accessories",
          display_category_name: "Cell Phones & Accessories",
          normalization_reason: `spCategoryName "${spCategoryName}" matched cell phone accessories pattern`,
        };
      }
    }
  }

  // RULE 2: General Electronics (but not specific subcategories)
  if (normalizedCategoryName) {
    if (
      normalizedCategoryName.includes("electronics") ||
      normalizedCategoryName.includes("electronic")
    ) {
      // Only map to general if it's not a specific subcategory we handle
      const isSpecificSubcategory =
        normalizedCategoryName.includes("cell phone") ||
        normalizedCategoryName.includes("cellphone") ||
        normalizedCategoryName.includes("mobile phone") ||
        normalizedCategoryName.includes("smartphone") ||
        normalizedCategoryName.includes("computer") ||
        normalizedCategoryName.includes("laptop") ||
        normalizedCategoryName.includes("tablet");

      if (!isSpecificSubcategory) {
        return {
          estimation_category_key: "electronics_general",
          display_category_name: "Electronics",
          normalization_reason: `spCategoryName "${spCategoryName}" matched general electronics pattern`,
        };
      }
    }
  }

  // RULE 3: Fallback to existing category key logic
  // But DO NOT accept values ending with "_display_on_website"
  if (fallbackKeywordCategory) {
    const normalizedFallback = fallbackKeywordCategory.trim().toLowerCase();
    
    // Reject display_group codes
    if (normalizedFallback.endsWith("_display_on_website")) {
      return {
        estimation_category_key: "unknown",
        display_category_name: "Unknown",
        normalization_reason: `reject_display_group_code: fallbackKeywordCategory "${fallbackKeywordCategory}" is a display_group code`,
      };
    }

    // Map common category patterns to estimation keys
    if (normalizedFallback.includes("television") || normalizedFallback.includes("tv")) {
      return {
        estimation_category_key: "electronics_tv",
        display_category_name: "Electronics",
        normalization_reason: `fallbackKeywordCategory "${fallbackKeywordCategory}" matched TV pattern`,
      };
    }
    
    if (normalizedFallback.includes("appliance")) {
      return {
        estimation_category_key: "kitchen_appliance",
        display_category_name: "Kitchen & Dining",
        normalization_reason: `fallbackKeywordCategory "${fallbackKeywordCategory}" matched appliance pattern`,
      };
    }
    
    if (normalizedFallback.includes("kitchen") || normalizedFallback.includes("dining")) {
      return {
        estimation_category_key: "kitchen_appliance",
        display_category_name: "Kitchen & Dining",
        normalization_reason: `fallbackKeywordCategory "${fallbackKeywordCategory}" matched kitchen pattern`,
      };
    }
    
    if (normalizedFallback.includes("home") || normalizedFallback.includes("decor")) {
      return {
        estimation_category_key: "home_decor",
        display_category_name: "Home & Kitchen",
        normalization_reason: `fallbackKeywordCategory "${fallbackKeywordCategory}" matched home pattern`,
      };
    }
    
    if (normalizedFallback.includes("tool")) {
      return {
        estimation_category_key: "tools",
        display_category_name: "Tools & Home Improvement",
        normalization_reason: `fallbackKeywordCategory "${fallbackKeywordCategory}" matched tools pattern`,
      };
    }
    
    if (normalizedFallback.includes("industrial")) {
      return {
        estimation_category_key: "industrial",
        display_category_name: "Industrial & Scientific",
        normalization_reason: `fallbackKeywordCategory "${fallbackKeywordCategory}" matched industrial pattern`,
      };
    }

    // Use fallback as-is if it doesn't match patterns and isn't a display_group code
    return {
      estimation_category_key: normalizedFallback,
      display_category_name: fallbackKeywordCategory,
      normalization_reason: `fallbackKeywordCategory "${fallbackKeywordCategory}" used as-is`,
    };
  }

  // No category information available
  return {
    estimation_category_key: "unknown",
    display_category_name: "Unknown",
    normalization_reason: "no_category_data_available",
  };
}

