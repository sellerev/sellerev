/**
 * Brand Frequency Resolution Utility
 * 
 * Removes junk brands extracted from titles (e.g., "Under Sink Organizer", "Multi")
 * while preserving real brands.
 * 
 * Rules:
 * - A brand is valid if it appears 2+ times across listings OR
 * - A brand is valid if ANY listing has it from metadata enrichment (API source)
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

  // Step 2: Determine valid brands
  // A brand is valid if:
  // - It appears 2+ times (frequency indicates it's real), OR
  // - Any listing has it from metadata enrichment (API source is authoritative)
  const validBrands = new Set<string>();

  for (const [brand, items] of brandMap.entries()) {
    const hasMetadataSource = items.some(
      (i: any) => i._debug_brand_source === "metadata"
    );

    if (items.length >= 2 || hasMetadataSource) {
      validBrands.add(brand);
    }
  }

  // Step 3: Remove invalid brands from listings
  for (const listing of listings) {
    if (listing.brand && !validBrands.has(listing.brand)) {
      listing.brand = null;
    }
  }

  // Log resolution results
  const invalidBrands = Array.from(brandMap.keys()).filter(
    (b) => !validBrands.has(b)
  );

  console.log("🧠 BRAND_FREQUENCY_RESOLUTION", {
    totalListings: listings.length,
    totalBrandsBefore: brandMap.size,
    totalBrandsAfter: validBrands.size,
    validBrands: Array.from(validBrands).slice(0, 10),
    invalidBrandsRemoved: invalidBrands.slice(0, 10),
    removedCount: invalidBrands.length,
  });

  return listings;
}

