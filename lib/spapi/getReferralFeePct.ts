/**
 * Get referral fee percentage by category
 * 
 * Extracts the referral fee percentage from category-based heuristics.
 * Used to default referral_fee_pct in FeasibilityCalculator.
 */

/**
 * Get referral fee percentage for a category
 * @param category - Product category name
 * @returns Referral fee percentage (8-17%)
 */
export function getReferralFeePctByCategory(category: string | null | undefined): number {
  if (!category) {
    return 15; // Default: 15%
  }

  const normalizedCategory = category.toLowerCase().trim();

  if (
    normalizedCategory.includes("electronics") ||
    normalizedCategory.includes("tech") ||
    normalizedCategory.includes("computer")
  ) {
    return 8; // Electronics: 8%
  } else if (
    normalizedCategory.includes("beauty") ||
    normalizedCategory.includes("cosmetic") ||
    normalizedCategory.includes("skincare")
  ) {
    return 8.5; // Beauty: 8.5%
  } else if (
    normalizedCategory.includes("home") ||
    normalizedCategory.includes("kitchen") ||
    normalizedCategory.includes("household")
  ) {
    return 15; // Home goods: 15%
  } else if (
    normalizedCategory.includes("clothing") ||
    normalizedCategory.includes("apparel") ||
    normalizedCategory.includes("fashion")
  ) {
    return 17; // Clothing: 17%
  } else {
    return 15; // Default: 15%
  }
}

