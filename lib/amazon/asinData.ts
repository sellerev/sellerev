/**
 * ASIN Data Fetching Service
 * 
 * Fetches Amazon product data for a specific ASIN via Rainforest API.
 * Used for ASIN-mode competitive targeting analyses.
 * 
 * STRICT RULES:
 * - DO NOT invent data
 * - ALL data must come from Amazon product API
 * - If required fields are missing, return null (analysis will fail)
 */

export interface AsinSnapshot {
  asin: string;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  bsr: number | null; // Primary category BSR
  fulfillment: "FBA" | "FBM" | "Amazon" | null;
  brand_owner: "Amazon" | "Brand" | "Third-Party" | null;
  brand: string | null; // Brand name
  seller_count: number | null; // Number of sellers (if available)
}

/**
 * Safely parses a price value from various formats.
 */
function parsePrice(item: any): number | null {
  if (item.price?.value) {
    const parsed = parseFloat(item.price.value);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }
  if (item.price?.raw) {
    const parsed = parseFloat(item.price.raw);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }
  if (typeof item.price === "number") {
    return isNaN(item.price) || item.price <= 0 ? null : item.price;
  }
  if (typeof item.price === "string") {
    const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ""));
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }
  return null;
}

/**
 * Safely parses review count.
 */
function parseReviews(item: any): number | null {
  if (item.reviews_total !== undefined && item.reviews_total !== null) {
    const parsed = parseInt(item.reviews_total.toString().replace(/,/g, ""), 10);
    return isNaN(parsed) || parsed < 0 ? null : parsed;
  }
  if (item.reviews?.total !== undefined && item.reviews?.total !== null) {
    const parsed = parseInt(item.reviews.total.toString().replace(/,/g, ""), 10);
    return isNaN(parsed) || parsed < 0 ? null : parsed;
  }
  if (typeof item.reviews === "number") {
    return isNaN(item.reviews) || item.reviews < 0 ? null : item.reviews;
  }
  return null;
}

/**
 * Safely parses rating.
 */
function parseRating(item: any): number | null {
  if (item.rating !== undefined && item.rating !== null) {
    const parsed = parseFloat(item.rating.toString());
    return isNaN(parsed) || parsed < 0 || parsed > 5 ? null : parsed;
  }
  if (item.reviews?.rating !== undefined && item.reviews?.rating !== null) {
    const parsed = parseFloat(item.reviews.rating.toString());
    return isNaN(parsed) || parsed < 0 || parsed > 5 ? null : parsed;
  }
  return null;
}

/**
 * Safely parses BSR (Best Seller Rank).
 */
function parseBSR(item: any): number | null {
  // BSR can be in various locations in Rainforest API response
  if (item.bestsellers_rank && Array.isArray(item.bestsellers_rank) && item.bestsellers_rank.length > 0) {
    const firstRank = item.bestsellers_rank[0];
    if (firstRank.rank !== undefined && firstRank.rank !== null) {
      const parsed = parseInt(firstRank.rank.toString().replace(/,/g, ""), 10);
      return isNaN(parsed) || parsed <= 0 ? null : parsed;
    }
  }
  if (item.bsr !== undefined && item.bsr !== null) {
    const parsed = parseInt(item.bsr.toString().replace(/,/g, ""), 10);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }
  return null;
}

/**
 * Determines fulfillment type from product data.
 */
function parseFulfillment(item: any): "FBA" | "FBM" | "Amazon" | null {
  // Check if sold by Amazon
  if (item.buybox_winner?.type === "Amazon" || item.availability?.raw?.includes("Amazon")) {
    return "Amazon";
  }
  
  // Check for FBA indicator
  if (item.fba || item.is_fba || item.fulfillment === "FBA" || item.fulfillment_type === "FBA") {
    return "FBA";
  }
  
  // Check if Prime badge indicates FBA
  if (item.is_prime) {
    return "FBA"; // Most Prime items are FBA
  }
  
  // Default to FBM if we can't determine
  if (item.fulfillment === "FBM" || item.fulfillment_type === "FBM") {
    return "FBM";
  }
  
  return null;
}

/**
 * Determines brand owner type.
 */
function parseBrandOwner(item: any, brand: string | null): "Amazon" | "Brand" | "Third-Party" | null {
  // Check if Amazon is the seller
  if (item.buybox_winner?.type === "Amazon" || item.sold_by === "Amazon.com" || item.brand === "Amazon") {
    return "Amazon";
  }
  
  // Check if brand matches seller (brand-owned)
  if (brand && item.sold_by && item.sold_by.includes(brand)) {
    return "Brand";
  }
  
  // Default to Third-Party
  if (item.sold_by && !item.sold_by.includes("Amazon")) {
    return "Third-Party";
  }
  
  return null;
}

/**
 * Parses seller count if available.
 */
function parseSellerCount(item: any): number | null {
  if (item.number_of_sellers !== undefined && item.number_of_sellers !== null) {
    const parsed = parseInt(item.number_of_sellers.toString(), 10);
    return isNaN(parsed) || parsed < 0 ? null : parsed;
  }
  return null;
}

/**
 * Fetches Amazon product data for a specific ASIN.
 * 
 * @param asin - The Amazon ASIN (10 alphanumeric characters)
 * @returns AsinSnapshot if valid data exists, null otherwise
 */
export async function fetchAsinData(asin: string): Promise<AsinSnapshot | null> {
  const rainforestApiKey = process.env.RAINFOREST_API_KEY;
  
  if (!rainforestApiKey) {
    console.warn("RAINFOREST_API_KEY not configured");
    return null;
  }

  // Validate ASIN format (10 alphanumeric characters)
  const cleanAsin = asin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
    console.error(`Invalid ASIN format: ${asin}`);
    return null;
  }

  try {
    // Fetch Amazon product data via Rainforest API
    const response = await fetch(
      `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=product&amazon_domain=amazon.com&asin=${cleanAsin}`,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`Rainforest API error for ASIN ${cleanAsin}: ${response.status} ${response.statusText}`);
      return null;
    }

    const raw = await response.json();

    // Log raw payload for debugging (truncated)
    console.log(`RAW_ASIN_DATA for ${cleanAsin}:`, JSON.stringify(raw).substring(0, 500));

    // Extract product data
    if (!raw || typeof raw !== "object" || !raw.product) {
      console.error(`Invalid Rainforest API response structure for ASIN ${cleanAsin}`);
      return null;
    }

    const product = raw.product;

    // Extract brand name
    const brand = product.brand || product.by_line?.name || null;

    // Parse all fields
    const price = parsePrice(product);
    const rating = parseRating(product);
    const reviews = parseReviews(product);
    const bsr = parseBSR(product);
    const fulfillment = parseFulfillment(product);
    const brand_owner = parseBrandOwner(product, brand);
    const seller_count = parseSellerCount(product);

    // Build snapshot
    const snapshot: AsinSnapshot = {
      asin: cleanAsin,
      price,
      rating,
      reviews,
      bsr,
      fulfillment,
      brand_owner,
      brand,
      seller_count,
    };

    // Validate that we have at least price OR rating (minimum required data)
    // Reviews can be null for new products
    if (price === null && rating === null) {
      console.error(`ASIN ${cleanAsin}: Missing both price and rating (minimum required data)`);
      return null;
    }

    return snapshot;
  } catch (error) {
    console.error(`Error fetching ASIN data for ${cleanAsin}:`, error);
    return null;
  }
}
