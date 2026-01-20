/**
 * Brand Frequency Resolution Utility
 * 
 * CRITICAL: Never deletes brands - only updates brand_status.
 * Preserves all detected brands in raw_brand field.
 * 
 * Rules for brand_status classification:
 * - 'canonical': Brand appears 2+ times OR has metadata source OR controls >= 3% revenue
 * - 'low_confidence': Brand exists but doesn't meet canonical criteria
 * - 'variant': Detected variant (e.g., "Callaway Golf Mens" -> normalized to "Callaway")
 * - 'unknown': No brand string exists
 * 
 * This is a logic-only fix that uses existing data - no API calls.
 */

import { ParsedListing, BrandResolution } from "./keywordMarket";

export function resolveBrandFrequency(listings: ParsedListing[]): ParsedListing[] {
  // Step 1: Group listings by raw_brand (from brand_resolution or fallback to brand field)
  const brandMap = new Map<string, ParsedListing[]>();

  for (const listing of listings) {
    // Get raw_brand from brand_resolution if available, otherwise fallback to brand field
    const rawBrand = listing.brand_resolution?.raw_brand ?? listing.brand;
    
    if (!rawBrand || typeof rawBrand !== 'string') continue;

    const brand = rawBrand.trim();
    if (!brand) continue;

    if (!brandMap.has(brand)) {
      brandMap.set(brand, []);
    }

    brandMap.get(brand)!.push(listing);
  }

  // Step 2: Calculate total page-1 revenue for revenue share calculation
  // Use est_monthly_revenue if available, otherwise estimate from price
  const totalPage1Revenue = listings.reduce((sum, listing) => {
    if (listing.est_monthly_revenue !== null && listing.est_monthly_revenue !== undefined) {
      return sum + (listing.est_monthly_revenue || 0);
    }
    // Fallback: estimate revenue from price if revenue not available
    // Use a conservative estimate (assume low units for single-ASIN brands)
    if (listing.price !== null && listing.price > 0) {
      // Estimate ~50 units/month for single-ASIN brands (conservative)
      return sum + (listing.price * 50);
    }
    return sum;
  }, 0);

  // Step 3: Determine canonical brands (for status classification)
  // A brand is canonical if ANY of these are true:
  // 1) It appears 2+ times (frequency indicates it's real), OR
  // 2) Any listing has it from metadata enrichment (API source is authoritative), OR
  // 3) Brand controls >= 3% of total page-1 revenue (revenue-based fallback)
  const canonicalBrands = new Set<string>();

  for (const [brand, items] of brandMap.entries()) {
    // Check 1: Frequency >= 2
    if (items.length >= 2) {
      canonicalBrands.add(brand);
      continue;
    }

    // Check 2: Metadata source (SP-API or Rainforest API)
    const hasMetadataSource = items.some(
      (listing) => {
        const source = listing.brand_resolution?.brand_source;
        return source === 'sp_api' || source === 'rainforest';
      }
    );
    if (hasMetadataSource) {
      canonicalBrands.add(brand);
      continue;
    }

    // Check 3: Revenue share >= 3%
    if (totalPage1Revenue > 0) {
      const brandRevenue = items.reduce((sum, listing) => {
        if (listing.est_monthly_revenue !== null && listing.est_monthly_revenue !== undefined) {
          return sum + (listing.est_monthly_revenue || 0);
        }
        // Fallback: estimate from price
        if (listing.price !== null && listing.price > 0) {
          return sum + (listing.price * 50);
        }
        return sum;
      }, 0);

      const brandRevenueSharePct = (brandRevenue / totalPage1Revenue) * 100;
      
      if (brandRevenueSharePct >= 3.0) {
        canonicalBrands.add(brand);
        continue;
      }
    }
  }

  // Step 4: Update brand_status for all listings (NEVER delete brands)
  for (const listing of listings) {
    // Get or create brand_resolution
    let brandResolution = listing.brand_resolution;
    
    // If no brand_resolution exists, create one from brand field (backward compatibility)
    if (!brandResolution) {
      const rawBrand = listing.brand;
      if (rawBrand && typeof rawBrand === 'string' && rawBrand.trim().length > 0) {
        brandResolution = {
          raw_brand: rawBrand.trim(),
          normalized_brand: rawBrand.trim(), // Default to raw_brand if no normalization
          brand_status: 'low_confidence',
          brand_source: 'fallback'
        };
      } else {
        brandResolution = {
          raw_brand: null,
          normalized_brand: null,
          brand_status: 'unknown',
          brand_source: 'fallback'
        };
      }
    }

    // Update brand_status based on canonical check
    if (brandResolution.raw_brand && typeof brandResolution.raw_brand === 'string') {
      const rawBrand = brandResolution.raw_brand.trim();
      if (canonicalBrands.has(rawBrand)) {
        // Brand is canonical - keep existing status if already canonical, otherwise mark as canonical
        if (brandResolution.brand_status !== 'canonical') {
          brandResolution.brand_status = 'canonical';
        }
      } else {
        // Brand exists but doesn't meet canonical criteria - mark as low_confidence
        // Only update if currently unknown (preserve variant status if already set)
        if (brandResolution.brand_status === 'unknown') {
          brandResolution.brand_status = 'low_confidence';
        }
      }
    }

    // Update listing with brand_resolution
    listing.brand_resolution = brandResolution;
    // Also update brand field for backward compatibility (use raw_brand)
    listing.brand = brandResolution.raw_brand;
  }

  // Log resolution results
  const lowConfidenceBrands = Array.from(brandMap.keys()).filter(
    (b) => !canonicalBrands.has(b)
  );

  // Calculate revenue-based validation stats
  const revenueBasedBrands = Array.from(brandMap.entries())
    .filter(([brand, items]) => {
      if (items.length >= 2 || items.some((listing) => {
        const source = listing.brand_resolution?.brand_source;
        return source === 'sp_api' || source === 'rainforest';
      })) {
        return false; // Already counted in frequency/metadata
      }
      if (totalPage1Revenue > 0) {
        const brandRevenue = items.reduce((sum, listing) => {
          if (listing.est_monthly_revenue !== null && listing.est_monthly_revenue !== undefined) {
            return sum + (listing.est_monthly_revenue || 0);
          }
          if (listing.price !== null && listing.price > 0) {
            return sum + (listing.price * 50);
          }
          return sum;
        }, 0);
        const brandRevenueSharePct = (brandRevenue / totalPage1Revenue) * 100;
        return brandRevenueSharePct >= 3.0;
      }
      return false;
    })
    .map(([brand]) => brand);

  console.log("🧠 BRAND_FREQUENCY_RESOLUTION", {
    totalListings: listings.length,
    totalBrandsBefore: brandMap.size,
    canonicalBrandsCount: canonicalBrands.size,
    lowConfidenceBrandsCount: lowConfidenceBrands.length,
    totalPage1Revenue: Math.round(totalPage1Revenue),
    revenueBasedBrandsCount: revenueBasedBrands.length,
    revenueBasedBrands: revenueBasedBrands.slice(0, 5),
    canonicalBrands: Array.from(canonicalBrands).slice(0, 10),
    lowConfidenceBrands: lowConfidenceBrands.slice(0, 10),
    message: "Brands preserved - only status updated (no brands deleted)",
  });

  return listings;
}

