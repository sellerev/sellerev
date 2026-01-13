/**
 * Brand Frequency Resolution Utility
 * 
 * Removes junk brands extracted from titles (e.g., "Under Sink Organizer", "Multi")
 * while preserving real brands.
 * 
 * Rules:
 * - A brand is valid if it appears 2+ times across listings OR
 * - A brand is valid if ANY listing has it from metadata enrichment (API source) OR
 * - A brand is valid if it controls >= 3% of total page-1 revenue (revenue-based fallback)
 * - Invalid brands are removed (set to null)
 * 
 * This is a logic-only fix that uses existing data - no API calls.
 */

import { ParsedListing } from "./keywordMarket";

export function resolveBrandFrequency(listings: ParsedListing[]): ParsedListing[] {
  // Step 1: Group listings by brand
  const brandMap = new Map<string, ParsedListing[]>();

  for (const listing of listings) {
    if (!listing.brand) continue;

    const brand = listing.brand.trim();
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

  // Step 3: Determine valid brands
  // A brand is valid if ANY of these are true:
  // 1) It appears 2+ times (frequency indicates it's real), OR
  // 2) Any listing has it from metadata enrichment (API source is authoritative), OR
  // 3) Brand controls >= 3% of total page-1 revenue (revenue-based fallback)
  const validBrands = new Set<string>();

  for (const [brand, items] of brandMap.entries()) {
    // Check 1: Frequency >= 2
    if (items.length >= 2) {
      validBrands.add(brand);
      continue;
    }

    // Check 2: Metadata source
    const hasMetadataSource = items.some(
      (i: any) => i._debug_brand_source === "metadata"
    );
    if (hasMetadataSource) {
      validBrands.add(brand);
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
        validBrands.add(brand);
        continue;
      }
    }
  }

  // Step 4: Remove invalid brands from listings
  for (const listing of listings) {
    if (listing.brand && !validBrands.has(listing.brand)) {
      listing.brand = null;
    }
  }

  // Log resolution results
  const invalidBrands = Array.from(brandMap.keys()).filter(
    (b) => !validBrands.has(b)
  );

  // Calculate revenue-based validation stats
  const revenueBasedBrands = Array.from(brandMap.entries())
    .filter(([brand, items]) => {
      if (items.length >= 2 || items.some((i: any) => i._debug_brand_source === "metadata")) {
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
    totalBrandsAfter: validBrands.size,
    totalPage1Revenue: Math.round(totalPage1Revenue),
    revenueBasedBrandsCount: revenueBasedBrands.length,
    revenueBasedBrands: revenueBasedBrands.slice(0, 5),
    validBrands: Array.from(validBrands).slice(0, 10),
    invalidBrandsRemoved: invalidBrands.slice(0, 10),
    removedCount: invalidBrands.length,
  });

  return listings;
}

