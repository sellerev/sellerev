/**
 * Keyword Calibration System
 * 
 * Deterministic calibration layer that adjusts canonical Page-1 revenue
 * based on keyword intent archetype and Amazon category.
 * 
 * Rules:
 * - Pure function: No side effects, no external calls
 * - Preserves relative revenue distribution between products
 * - Applies single scalar multiplier to ALL products
 * - Preserves snapshot conservation (re-scales if needed)
 * - Default multiplier = 1.0 if no calibration exists
 */

import { CanonicalProduct } from "./canonicalPageOne";

export type IntentType = 'generic' | 'brand' | 'accessory' | 'replacement' | 'appliance' | 'consumable';

export interface CalibrationProfile {
  keyword: string;
  intent_type: IntentType;
  category: string;
  revenue_multiplier: number;
  units_multiplier: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CalibrationResult {
  products: CanonicalProduct[];
  calibration_applied: boolean;
  revenue_multiplier: number;
  units_multiplier: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'profile' | 'default';
}

/**
 * Infer keyword intent type from keyword text (deterministic, simple heuristics)
 * 
 * This is a simple deterministic classifier. Can be enhanced later with more sophisticated logic.
 */
function inferIntentType(keyword: string): IntentType {
  const normalized = keyword.toLowerCase().trim();
  
  // Brand keywords (contain known brand patterns or brand names)
  if (/\b(apple|samsung|sony|nike|adidas|coca.?cola|pepsi|dell|hp|lenovo|lg|samsung|philips|bosch|dyson|shark|instant.?pot|ninja|kitchenaid|cuisinart)\b/i.test(normalized)) {
    return 'brand';
  }
  
  // Replacement keywords
  if (/\b(replacement|refill|replacement for|compatible with|for [a-z]+)\b/i.test(normalized)) {
    return 'replacement';
  }
  
  // Accessory keywords
  if (/\b(accessory|case|cover|stand|holder|mount|adapter|cable|charger|protector|screen protector)\b/i.test(normalized)) {
    return 'accessory';
  }
  
  // Appliance keywords
  if (/\b(air fryer|microwave|blender|mixer|toaster|coffee maker|kettle|vacuum|washer|dryer|refrigerator|oven|stove)\b/i.test(normalized)) {
    return 'appliance';
  }
  
  // Consumable keywords
  if (/\b(paper|tissue|wipes|soap|shampoo|conditioner|toothpaste|razor|blade|filter|cartridge|ink|toner)\b/i.test(normalized)) {
    return 'consumable';
  }
  
  // Default to generic
  return 'generic';
}

/**
 * Extract category from listings (uses most common category from Page-1 listings)
 * 
 * @param products - Canonical products (may not have category directly)
 * @param listings - Original listings with main_category field
 * @returns Most common category or null
 */
function extractCategoryFromListings(listings?: Array<{ main_category?: string | null }>): string | null {
  if (!listings || listings.length === 0) {
    return null;
  }
  
  // Count category occurrences
  const categoryCounts = new Map<string, number>();
  for (const listing of listings) {
    const category = listing.main_category;
    if (category && category.trim()) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }
  
  if (categoryCounts.size === 0) {
    return null;
  }
  
  // Return most common category
  let maxCount = 0;
  let mostCommonCategory: string | null = null;
  for (const [category, count] of categoryCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonCategory = category;
    }
  }
  
  return mostCommonCategory;
}

/**
 * Apply keyword calibration to canonical products
 * 
 * CRITICAL RULES:
 * 1. Must NOT modify relative revenue distribution between products
 * 2. Must apply a single scalar multiplier to ALL products
 * 3. Must preserve snapshot conservation (re-scale if needed)
 * 
 * @param canonicalProducts - Canonical Page-1 products (source of truth)
 * @param keyword - Search keyword
 * @param category - Amazon category (optional, will be inferred from listings if not provided)
 * @param supabase - Optional Supabase client for calibration profile lookup
 * @param listings - Optional original listings for category extraction
 * @returns Calibrated products with metadata
 */
export async function applyKeywordCalibration(
  canonicalProducts: CanonicalProduct[],
  keyword: string,
  category?: string | null,
  supabase?: any,
  listings?: Array<{ main_category?: string | null }>
): Promise<CalibrationResult> {
  // Default: no calibration applied
  const defaultResult: CalibrationResult = {
    products: canonicalProducts,
    calibration_applied: false,
    revenue_multiplier: 1.0,
    units_multiplier: 1.0,
    confidence: 'low',
    source: 'default',
  };
  
  // If no products, return unchanged
  if (!canonicalProducts || canonicalProducts.length === 0) {
    return defaultResult;
  }
  
  // Extract or infer category
  let resolvedCategory = category;
  if (!resolvedCategory && listings) {
    resolvedCategory = extractCategoryFromListings(listings);
  }
  
  // If no category available, use default (no calibration)
  if (!resolvedCategory) {
    console.log("[Calibration] No category available, using default multiplier", { keyword });
    return defaultResult;
  }
  
  // Infer intent type from keyword
  const intentType = inferIntentType(keyword);
  
  // Look up calibration profile from database
  let calibrationProfile: CalibrationProfile | null = null;
  
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('keyword_calibration_profiles')
        .select('*')
        .eq('keyword', keyword.toLowerCase().trim())
        .single();
      
      if (!error && data) {
        calibrationProfile = {
          keyword: data.keyword,
          intent_type: data.intent_type as IntentType,
          category: data.category,
          revenue_multiplier: parseFloat(data.revenue_multiplier.toString()),
          units_multiplier: parseFloat(data.units_multiplier.toString()),
          confidence: data.confidence as 'high' | 'medium' | 'low',
        };
      }
    } catch (error) {
      console.warn("[Calibration] Error fetching calibration profile:", error);
    }
  }
  
  // If no profile found, use default (no calibration)
  if (!calibrationProfile) {
    console.log("[Calibration] No profile found, using default multiplier", {
      keyword,
      category: resolvedCategory,
      intent_type: intentType,
    });
    return defaultResult;
  }
  
  // Validate multipliers are reasonable (prevent extreme values)
  const revenueMultiplier = Math.max(0.1, Math.min(10.0, calibrationProfile.revenue_multiplier));
  const unitsMultiplier = Math.max(0.1, Math.min(10.0, calibrationProfile.units_multiplier));
  
  // Apply calibration: multiply ALL products by the same scalar
  // This preserves relative distribution (all products scaled proportionally)
  const calibratedProducts = canonicalProducts.map((product) => {
    // Calculate new units and revenue
    const newUnits = Math.round(product.estimated_monthly_units * unitsMultiplier);
    const newRevenue = Math.round(product.estimated_monthly_revenue * revenueMultiplier);
    
    // Preserve all other fields unchanged
    return {
      ...product,
      estimated_monthly_units: newUnits,
      estimated_monthly_revenue: newRevenue,
    };
  });
  
  // Snapshot conservation: Re-scale if total revenue/units changed significantly
  // Calculate original totals
  const originalTotalRevenue = canonicalProducts.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const originalTotalUnits = canonicalProducts.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  
  // Calculate calibrated totals
  const calibratedTotalRevenue = calibratedProducts.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0);
  const calibratedTotalUnits = calibratedProducts.reduce((sum, p) => sum + p.estimated_monthly_units, 0);
  
  // If totals are zero or very small, return calibrated products as-is
  if (originalTotalRevenue === 0 || originalTotalUnits === 0) {
    return {
      products: calibratedProducts,
      calibration_applied: true,
      revenue_multiplier: revenueMultiplier,
      units_multiplier: unitsMultiplier,
      confidence: calibrationProfile.confidence,
      source: 'profile',
    };
  }
  
  // Calculate conservation factors (should be close to 1.0 if multipliers are consistent)
  const revenueConservationFactor = originalTotalRevenue / calibratedTotalRevenue;
  const unitsConservationFactor = originalTotalUnits / calibratedTotalUnits;
  
  // If conservation factors are significantly different from 1.0, re-scale to preserve snapshot
  // This ensures the sum of calibrated products matches expected totals
  const finalProducts = calibratedProducts.map((product) => {
    // Re-scale to preserve snapshot conservation
    const conservedRevenue = Math.round(product.estimated_monthly_revenue * revenueConservationFactor);
    const conservedUnits = Math.round(product.estimated_monthly_units * unitsConservationFactor);
    
    return {
      ...product,
      estimated_monthly_units: conservedUnits,
      estimated_monthly_revenue: conservedRevenue,
    };
  });
  
  console.log("[Calibration] Applied calibration", {
    keyword,
    category: resolvedCategory,
    intent_type: intentType,
    revenue_multiplier: revenueMultiplier,
    units_multiplier: unitsMultiplier,
    confidence: calibrationProfile.confidence,
    original_total_revenue: originalTotalRevenue,
    calibrated_total_revenue: calibratedTotalRevenue,
    final_total_revenue: finalProducts.reduce((sum, p) => sum + p.estimated_monthly_revenue, 0),
    conservation_factor_revenue: revenueConservationFactor,
    conservation_factor_units: unitsConservationFactor,
  });
  
  return {
    products: finalProducts,
    calibration_applied: true,
    revenue_multiplier: revenueMultiplier,
    units_multiplier: unitsMultiplier,
    confidence: calibrationProfile.confidence,
    source: 'profile',
  };
}

