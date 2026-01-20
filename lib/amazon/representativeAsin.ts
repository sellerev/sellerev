/**
 * Representative ASIN Selection
 * 
 * Picks a representative ASIN from keyword search results for fee estimation.
 * Uses progressive fallback strategy to find the best candidate.
 */

import { ParsedListing } from "./keywordMarket";

/**
 * Pick a representative ASIN from keyword market listings
 * 
 * Selection rules (in priority order):
 * 1. Prefer non-sponsored listings
 * 2. Prefer rank <= 3 (top 3 positions)
 * 3. Must have ASIN
 * 4. Fallback progressively to rank <= 10
 * 5. Final fallback: first listing with ASIN
 * 6. If none found, return null
 * 
 * @param listings - Array of parsed listings from keyword search
 * @returns Representative ASIN string or null if none found
 */
export function pickRepresentativeAsin(
  listings: ParsedListing[]
): string | null {
  if (!listings || listings.length === 0) {
    return null;
  }

  // Filter to only listings with ASIN
  const listingsWithAsin = listings.filter(
    (listing) => listing.asin !== null && listing.asin !== undefined
  );

  if (listingsWithAsin.length === 0) {
    return null;
  }

  // Strategy 1: Non-sponsored, rank <= 3
  const topNonSponsored = listingsWithAsin.find(
    (listing) => !listing.is_sponsored && listing.position <= 3
  );
  if (topNonSponsored) {
    return topNonSponsored.asin!;
  }

  // Strategy 2: Non-sponsored, rank <= 10
  const midNonSponsored = listingsWithAsin.find(
    (listing) => !listing.is_sponsored && listing.position <= 10
  );
  if (midNonSponsored) {
    return midNonSponsored.asin!;
  }

  // Strategy 3: Any non-sponsored (any rank)
  const anyNonSponsored = listingsWithAsin.find(
    (listing) => !listing.is_sponsored
  );
  if (anyNonSponsored) {
    return anyNonSponsored.asin!;
  }

  // Strategy 4: Rank <= 3 (even if sponsored)
  const topSponsored = listingsWithAsin.find(
    (listing) => listing.position <= 3
  );
  if (topSponsored) {
    return topSponsored.asin!;
  }

  // Strategy 5: Rank <= 10 (even if sponsored)
  const midSponsored = listingsWithAsin.find(
    (listing) => listing.position <= 10
  );
  if (midSponsored) {
    return midSponsored.asin!;
  }

  // Final fallback: First listing with ASIN (any position, any sponsorship)
  return listingsWithAsin[0].asin!;
}














