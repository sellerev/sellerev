/**
 * Normalize listing data from various sources (Rainforest API, legacy formats)
 * Ensures consistent field names and types across the application
 */

export interface ParsedListing {
  asin: string;
  title: string;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  image: string | null;
  bsr: number | null;
  fulfillment: "FBA" | "FBM" | "Amazon" | null;
  sponsored: boolean;
  organic_rank: number | null;
  brand: string | null;
}

/**
 * Normalizes a raw listing object from any source into a consistent ParsedListing format
 */
export function normalizeListing(raw: any): ParsedListing {
  return {
    asin: raw.asin ?? raw.ASIN ?? "",
    title: raw.title ?? raw.Title ?? "",
    price: raw.price?.value ?? raw.price ?? raw.Price ?? null,
    rating: raw.rating ?? raw.Rating ?? null,
    reviews: raw.reviews?.count ?? raw.reviews ?? raw.Reviews ?? raw.review_count ?? null,
    image: raw.image ?? raw.image_url ?? raw.Image ?? raw.images?.[0] ?? null,
    bsr: raw.bsr ?? raw.BSR ?? raw.best_seller_rank ?? raw.rank ?? null,
    fulfillment: raw.fulfillment ?? raw.Fulfillment ?? null,
    sponsored: !!raw.is_sponsored ?? !!raw.IsSponsored ?? false,
    organic_rank: raw.organic_rank ?? raw.position ?? raw.Position ?? null,
    brand: raw.brand ?? raw.Brand ?? null,
  };
}
