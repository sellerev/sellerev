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
 * 
 * 🔒 STRICT RULE: Rainforest does NOT guarantee fulfillment data.
 * Only return fulfillment if explicitly provided.
 * DO NOT infer fulfillment from is_prime (Prime ≠ FBA).
 */
function parseFulfillment(item: any): "FBA" | "FBM" | "Amazon" | null {
  // Check if sold by Amazon (explicit field)
  if (item.buybox_winner?.type === "Amazon") {
    return "Amazon";
  }
  
  // Check explicit fulfillment fields (if provided by Rainforest or SP-API)
  if (item.fulfillment === "FBA" || item.fulfillment_type === "FBA" || item.fba === true || item.is_fba === true) {
    return "FBA";
  }
  
  if (item.fulfillment === "FBM" || item.fulfillment_type === "FBM") {
    return "FBM";
  }
  
  // ❌ DO NOT infer from is_prime - Prime ≠ FBA
  // ❌ DO NOT parse availability.raw - not guaranteed
  
  // Return null if fulfillment cannot be determined
  // This is honest and credible - UI will show "Unknown" or Prime badge only
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
 * Enriches ASIN brand data lazily (non-blocking).
 * 
 * Rules:
 * - If brand already exists in asin_bsr_cache → return immediately
 * - Otherwise: Call Rainforest product API, extract brand, save to DB
 * - Fails silently (logs only) - never throws, never blocks caller
 * 
 * @param asin - The Amazon ASIN
 * @param supabase - Supabase client for database operations
 * @returns Promise<void> - Always resolves, never rejects
 */
export async function enrichAsinBrandIfMissing(
  asin: string,
  supabase: any,
  apiCallBudget?: { count: number; max: number }
): Promise<void> {
  try {
    // Validate ASIN format
    const cleanAsin = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
      console.warn(`[BrandEnrichment] Invalid ASIN format: ${asin}`);
      return;
    }

    // Check if brand already exists in cache
    const { data: existing, error: checkError } = await supabase
      .from("asin_bsr_cache")
      .select("brand")
      .eq("asin", cleanAsin)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = no rows found (expected if ASIN not in cache yet)
      console.warn(`[BrandEnrichment] Error checking cache for ${cleanAsin}:`, checkError.message);
      return;
    }

    // If brand exists (and is not null), return immediately
    if (existing && existing.brand) {
      return; // Brand already cached, no action needed
    }

    // Brand missing → fetch from Rainforest API
    const rainforestApiKey = process.env.RAINFOREST_API_KEY;
    if (!rainforestApiKey) {
      console.warn(`[BrandEnrichment] RAINFOREST_API_KEY not configured`);
      return;
    }

    // 🚨 API SAFETY LIMIT: Respect shared budget (prevents runaway background enrichment)
    if (apiCallBudget && apiCallBudget.count >= apiCallBudget.max) {
      console.warn("🚨 ENRICHMENT_SKIPPED_DUE_TO_BUDGET", {
        enrichment_type: "brand",
        asin: cleanAsin,
        current_count: apiCallBudget.count,
        max_allowed: apiCallBudget.max,
        remaining_budget: apiCallBudget.max - apiCallBudget.count,
        message: "Brand enrichment skipped - API call budget exhausted",
      });
      return;
    }

    // Increment counter before API call
    if (apiCallBudget) {
      apiCallBudget.count++;
    }

    // Call Rainforest product API
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
      console.warn(`[BrandEnrichment] Rainforest API error for ${cleanAsin}: ${response.status}`);
      return;
    }

    const raw = await response.json();

    // Extract brand from product data
    if (!raw || typeof raw !== "object" || !raw.product) {
      console.warn(`[BrandEnrichment] Invalid Rainforest response for ${cleanAsin}`);
      return;
    }

    const product = raw.product;
    const brand = product.brand || product.by_line?.name || null;

    // If brand is missing from API, log and return (fail silently)
    if (!brand || typeof brand !== "string" || brand.trim().length === 0) {
      console.log(`[BrandEnrichment] Brand not available for ${cleanAsin}`);
      return;
    }

    // Normalize brand name (trim, basic cleanup)
    const normalizedBrand = brand.trim();

    // Save brand to asin_bsr_cache
    // Use upsert: if ASIN exists, update brand; if not, insert new row
    const { error: upsertError } = await supabase
      .from("asin_bsr_cache")
      .upsert(
        {
          asin: cleanAsin,
          brand: normalizedBrand,
          last_fetched_at: new Date().toISOString(),
          source: "rainforest",
        },
        {
          onConflict: "asin",
        }
      );

    if (upsertError) {
      console.warn(`[BrandEnrichment] Failed to save brand for ${cleanAsin}:`, upsertError.message);
      return;
    }

    console.log(`[BrandEnrichment] ✅ Enriched brand for ${cleanAsin}: ${normalizedBrand}`);
  } catch (error) {
    // Fail silently - log only
    console.warn(`[BrandEnrichment] Error enriching brand for ${asin}:`, error instanceof Error ? error.message : String(error));
  }
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
