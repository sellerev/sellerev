import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import crypto from "crypto";
import { consumeCredits } from "@/lib/credits/sellerCredits";

/**
 * ASIN Enrichment API Endpoint
 * 
 * Provides lazy, on-demand ASIN enrichment using Rainforest API.
 * 
 * ARCHITECTURAL RULES:
 * - Market Snapshot and Page-1 revenue totals remain unchanged
 * - Refined data is scoped to the specific ASIN only
 * - Never affects brand moat calculations
 * - Refined data is a refinement layer only
 */

interface EnrichRequestBody {
  asin: string;
  analysisRunId: string;
  currentPrice?: number; // Price from the listing card (for revenue calculation)
  creditConfirmed?: boolean; // Explicit user confirmation before charging credits
}

interface RefinedUnitsRange {
  min: number;
  max: number;
}

type EnrichmentStatus = "ready" | "pending" | "insufficient_data";
type UnitsSource = "bought_last_month" | "bsr_curve";

// In-memory cache (per server instance)
// Key: `${marketplace}:${asin}`
const MEMORY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const memoryCache = new Map<string, { expiresAt: number; payload: any }>();
const inflight = new Map<string, Promise<any>>();

interface EnrichResponse {
  success: boolean;
  error?: string;
  status?: EnrichmentStatus;
  stale?: boolean;
  credits_charged?: 0 | 1;
  served_from_cache?: boolean;
  cache_age_seconds?: number | null;
  signals_used?: Array<"bought_last_month" | "bsr" | "price" | "reviews" | "rating">;
  data_timestamp?: string | null;
  data?: {
    refined_units_range: RefinedUnitsRange;
    refined_estimated_revenue: number;
    current_price: number;
    current_bsr: number | null;
    review_count: number | null;
    fulfillment_type: string | null;
    data_source: "rainforest_bought_last_month" | "bsr_curve";
    confidence: "high" | "medium" | "low";
    expires_at?: string | null;
  };
}

/**
 * Parses bought_last_month from Rainforest API response
 * Can be a range (e.g., "1,000-5,000") or a single value
 */
function parseBoughtLastMonth(product: any): RefinedUnitsRange | null {
  const bought = product.bought_last_month;
  
  if (!bought) {
    return null;
  }
  
  // If it's a string, try to parse as range
  if (typeof bought === "string") {
    const cleaned = bought.replace(/,/g, "").trim();
    
    // Check for range format (e.g., "1000-5000" or "1,000-5,000")
    const rangeMatch = cleaned.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
      const min = parseInt(rangeMatch[1], 10);
      const max = parseInt(rangeMatch[2], 10);
      if (!isNaN(min) && !isNaN(max) && min >= 0 && max >= min) {
        return { min, max };
      }
    }
    
    // Try to parse as single number
    const single = parseInt(cleaned, 10);
    if (!isNaN(single) && single >= 0) {
      // Use ±20% range for single values
      return {
        min: Math.floor(single * 0.8),
        max: Math.ceil(single * 1.2),
      };
    }
  }
  
  // If it's a number
  if (typeof bought === "number" && bought >= 0) {
    // Use ±20% range for single values
    return {
      min: Math.floor(bought * 0.8),
      max: Math.ceil(bought * 1.2),
    };
  }
  
  // Check for range object
  if (typeof bought === "object" && bought !== null) {
    const min = typeof bought.min === "number" ? bought.min : null;
    const max = typeof bought.max === "number" ? bought.max : null;
    
    if (min !== null && max !== null && min >= 0 && max >= min) {
      return { min, max };
    }
    
    if (min !== null && min >= 0) {
      return { min, max: Math.ceil(min * 1.2) };
    }
    
    if (max !== null && max >= 0) {
      return { min: Math.floor(max * 0.8), max };
    }
  }
  
  return null;
}

/**
 * Determines confidence level based on data quality
 */
function determineConfidence(
  unitsRange: RefinedUnitsRange | null,
  price: number | null,
  bsr: number | null
): "high" | "medium" | "low" {
  if (!unitsRange || !price) {
    return "low";
  }
  
  // High confidence: has units range and BSR
  if (bsr !== null && bsr > 0) {
    return "high";
  }
  
  // Medium confidence: has units range but no BSR
  if (unitsRange.min > 0 || unitsRange.max > 0) {
    return "medium";
  }
  
  return "low";
}

function nowIso() {
  return new Date().toISOString();
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt) < new Date();
}

function isOlderThanHours(ts: string | null | undefined, hours: number): boolean {
  if (!ts) return true;
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  return new Date(ts) < cutoff;
}

function getMemory(cacheKey: string) {
  const entry = memoryCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function setMemory(cacheKey: string, payload: any) {
  memoryCache.set(cacheKey, { expiresAt: Date.now() + MEMORY_TTL_MS, payload });
}

function secondsSince(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

export async function POST(req: NextRequest) {
  let res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    // 1. Authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // 2. Parse request body
    const body: EnrichRequestBody = await req.json();
    const { asin, analysisRunId, currentPrice, creditConfirmed } = body;
    const marketplace = "US";

    if (!asin || !analysisRunId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: asin, analysisRunId" },
        { status: 400, headers: res.headers }
      );
    }

    // Validate ASIN format
    const cleanAsin = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(cleanAsin)) {
      return NextResponse.json(
        { success: false, error: "Invalid ASIN format" },
        { status: 400, headers: res.headers }
      );
    }

    const cacheKey = `${marketplace}:${cleanAsin}`;

    // 0) In-memory cache (fastest)
    const mem = getMemory(cacheKey);
    if (mem) {
      // Ensure required cache metadata exists (older payloads)
      if (mem && typeof mem === "object") {
        mem.served_from_cache = true;
        mem.credits_charged = 0;
        mem.cache_age_seconds = secondsSince(mem.data_timestamp ?? null);
      }
      return NextResponse.json(mem, { headers: res.headers });
    }

    // Helper: Background refresh (best-effort, never awaited; never charges user credits)
    const refreshInBackground = (reason: string) => {
      if (inflight.has(cacheKey)) return;
      const promise = (async () => {
        try {
          const rainforestApiKey = process.env.RAINFOREST_API_KEY;
          if (!rainforestApiKey) return;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20000); // background max 20s
          const rainforestResponse = await fetch(
            `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=product&amazon_domain=amazon.com&asin=${cleanAsin}`,
            { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal }
          );
          clearTimeout(timeout);

          if (!rainforestResponse.ok) return;
          const raw = await rainforestResponse.json();
          const product = raw?.product;
          if (!product) return;

          const unitsRangeFromBought = parseBoughtLastMonth(product);

          // Price
          let price = currentPrice || null;
          if (!price) {
            if (product.price?.value) price = parseFloat(product.price.value);
            else if (product.price?.raw) price = parseFloat(product.price.raw);
          }

          // BSR + category
          let bsr: number | null = null;
          let mainCategory: string | null = null;
          if (product.bestsellers_rank && Array.isArray(product.bestsellers_rank) && product.bestsellers_rank.length > 0) {
            const firstRank = product.bestsellers_rank[0];
            if (firstRank.rank !== undefined && firstRank.rank !== null) {
              const parsed = parseInt(firstRank.rank.toString().replace(/,/g, ""), 10);
              bsr = isNaN(parsed) || parsed <= 0 ? null : parsed;
            }
            mainCategory = typeof firstRank.category === "string" && firstRank.category.trim().length > 0
              ? firstRank.category.trim()
              : null;
          }

          // Reviews
          let reviewCount: number | null = null;
          if (product.reviews_total !== undefined && product.reviews_total !== null) {
            const parsed = parseInt(product.reviews_total.toString().replace(/,/g, ""), 10);
            reviewCount = isNaN(parsed) || parsed < 0 ? null : parsed;
          }

          // Rating (0-5)
          let rating: number | null = null;
          if (product.rating !== undefined && product.rating !== null) {
            const parsed = parseFloat(product.rating.toString());
            rating = isNaN(parsed) || parsed < 0 || parsed > 5 ? null : parsed;
          }

          // Fulfillment
          let fulfillmentType: string | null = null;
          if (product.fulfillment?.is_prime === true || product.fulfillment?.type === "prime") fulfillmentType = "FBA";
          else if (product.fulfillment?.type === "amazon") fulfillmentType = "Amazon";
          else fulfillmentType = "FBM";

          // Compute best-available units source
          let unitsSource: UnitsSource | null = null;
          let unitsRange: RefinedUnitsRange | null = null;
          let refinedRevenue = 0;
          let confidence: "high" | "medium" | "low" = "low";

          const signalsUsed: EnrichResponse["signals_used"] = [];
          if (price && price > 0) signalsUsed.push("price");
          if (reviewCount !== null) signalsUsed.push("reviews");
          if (rating !== null) signalsUsed.push("rating");
          if (bsr !== null) signalsUsed.push("bsr");

          if (unitsRangeFromBought && price && price > 0) {
            unitsSource = "bought_last_month";
            unitsRange = unitsRangeFromBought;
            const avgUnits = (unitsRange.min + unitsRange.max) / 2;
            refinedRevenue = avgUnits * price;
            confidence = "high";
            signalsUsed.unshift("bought_last_month");
          } else if (bsr && price && price > 0) {
            const { estimateMonthlySalesFromBSR } = await import("@/lib/revenue/bsr-calculator");
            const units = estimateMonthlySalesFromBSR(bsr, mainCategory || "default");
            // Skip if units estimation failed (null)
            if (units === null) {
              return; // insufficient; don't cache junk
            }
            unitsSource = "bsr_curve";
            unitsRange = { min: units, max: units };
            refinedRevenue = units * price;
            confidence = "medium";
          } else {
            return; // insufficient; don't cache junk
          }

          const payloadHash = crypto
            .createHash("sha256")
            .update(JSON.stringify(product))
            .digest("hex");

          // Upsert global caches
          await supabase.from("asin_bsr_cache").upsert({
            asin: cleanAsin,
            main_category: mainCategory,
            main_category_bsr: bsr,
            price: price,
            brand: typeof product.brand === "string" ? product.brand : null,
            last_fetched_at: nowIso(),
            source: "rainforest",
          }, { onConflict: "asin" });

          // New global signals table (24h TTL)
          const expiresAtGlobal = new Date();
          expiresAtGlobal.setHours(expiresAtGlobal.getHours() + 24);

          await supabase.from("asin_sales_signals").upsert({
            asin: cleanAsin,
            marketplace,
            fetched_at: nowIso(),
            expires_at: expiresAtGlobal.toISOString(),
            source: "rainforest_product",
            bsr,
            top_category: mainCategory,
            bought_last_month_raw: product.bought_last_month ?? null,
            price,
            rating,
            ratings_total: product.reviews_total ? parseInt(product.reviews_total.toString().replace(/,/g, ""), 10) : null,
            computed_monthly_units: Math.round((unitsRange!.min + unitsRange!.max) / 2),
            computed_monthly_revenue: refinedRevenue,
            confidence,
            signals_used: signalsUsed || [],
            raw_payload_hash: payloadHash,
          }, { onConflict: "asin,marketplace" });

          // Daily history snapshot (one per day)
          await supabase.from("asin_sales_signals_history").upsert({
            asin: cleanAsin,
            marketplace,
            snapshot_date: new Date().toISOString().slice(0, 10),
            fetched_at: nowIso(),
            source: "rainforest_product",
            bsr,
            top_category: mainCategory,
            bought_last_month_raw: product.bought_last_month ?? null,
            price,
            rating,
            ratings_total: product.reviews_total ? parseInt(product.reviews_total.toString().replace(/,/g, ""), 10) : null,
            computed_monthly_units: Math.round((unitsRange!.min + unitsRange!.max) / 2),
            computed_monthly_revenue: refinedRevenue,
            confidence,
            signals_used: signalsUsed || [],
            raw_payload_hash: payloadHash,
            user_id: user.id,
            analysis_run_id: analysisRunId,
          }, { onConflict: "asin,marketplace,snapshot_date" });

          // Upsert per-user per-analysis cache (24h) for immediate UX
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + 24);
          await supabase.from("asin_refinement_cache").upsert({
            user_id: user.id,
            asin: cleanAsin,
            analysis_run_id: analysisRunId,
            refined_units_range: unitsRange,
            refined_estimated_revenue: refinedRevenue,
            current_price: price,
            current_bsr: bsr,
            review_count: reviewCount,
            fulfillment_type: fulfillmentType,
            data_source: unitsSource === "bought_last_month" ? "rainforest_bought_last_month" : "bsr_curve",
            confidence,
            expires_at: expiresAt.toISOString(),
          }, { onConflict: "user_id,asin,analysis_run_id" });

          // Update in-memory cache for fast subsequent calls on this instance
          const readyPayload: EnrichResponse = {
            success: true,
            status: "ready",
            stale: false,
            signals_used: signalsUsed as any,
            data_timestamp: nowIso(),
            data: {
              refined_units_range: unitsRange!,
              refined_estimated_revenue: refinedRevenue,
              current_price: price || 0,
              current_bsr: bsr,
              review_count: reviewCount,
              fulfillment_type: fulfillmentType,
              data_source: unitsSource === "bought_last_month" ? "rainforest_bought_last_month" : "bsr_curve",
              confidence,
              expires_at: expiresAt.toISOString(),
            },
          };
          setMemory(cacheKey, readyPayload);

          console.log(`[ASINEnrich] Background refresh complete for ${cleanAsin}`, { reason });
        } catch (e) {
          // Silent fail
          console.warn(`[ASINEnrich] Background refresh failed for ${cleanAsin}`, {
            reason,
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          inflight.delete(cacheKey);
        }
      })();
      inflight.set(cacheKey, promise);
    };

    // 3. Check per-user cache (return immediately even if stale)
    const { data: cachedRows, error: cacheError } = await supabase
      .from("asin_refinement_cache")
      .select("*")
      .eq("user_id", user.id)
      .eq("asin", cleanAsin)
      .eq("analysis_run_id", analysisRunId)
      .order("created_at", { ascending: false })
      .limit(1);

    const cached = Array.isArray(cachedRows) && cachedRows.length > 0 ? cachedRows[0] : null;
    if (cached && !cacheError) {
      const stale = isExpired(cached.expires_at);
      if (stale) refreshInBackground("user_cache_stale");

      const dataTimestamp = cached.created_at || null;
      const dataSource = (cached.data_source as any) === "bsr_curve" ? "bsr_curve" : "rainforest_bought_last_month";
      const signalsUsed: EnrichResponse["signals_used"] =
        dataSource === "bsr_curve" ? ["bsr", "price"] : ["bought_last_month", "price"];

      return NextResponse.json((() => {
          const payload: EnrichResponse = {
          success: true,
          status: "ready",
          stale,
          credits_charged: 0,
          served_from_cache: true,
          cache_age_seconds: secondsSince(dataTimestamp),
          signals_used: signalsUsed,
          data_timestamp: dataTimestamp,
          data: {
            refined_units_range: cached.refined_units_range as RefinedUnitsRange,
            refined_estimated_revenue: parseFloat(cached.refined_estimated_revenue.toString()),
            current_price: cached.current_price ? parseFloat(cached.current_price.toString()) : currentPrice || 0,
            current_bsr: cached.current_bsr,
            review_count: cached.review_count,
            fulfillment_type: cached.fulfillment_type,
            data_source: dataSource,
            confidence: cached.confidence as "high" | "medium" | "low",
            expires_at: cached.expires_at,
          },
          };
          setMemory(cacheKey, payload);
          return payload;
        })(), { headers: res.headers });
    }

    // 3b. Check GLOBAL cache (per-ASIN, per-marketplace, 24h TTL via expires_at)
    try {
      const { data: globalRows, error: globalErr } = await supabase
        .from("asin_sales_signals")
        .select("asin,marketplace,fetched_at,expires_at,source,bsr,top_category,bought_last_month_raw,price,rating,ratings_total,computed_monthly_units,computed_monthly_revenue,confidence,signals_used,raw_payload_hash")
        .eq("asin", cleanAsin)
        .eq("marketplace", marketplace)
        .order("fetched_at", { ascending: false })
        .limit(1);

      const row = Array.isArray(globalRows) && globalRows.length > 0 ? globalRows[0] : null;
      if (row && !globalErr) {
        const stale = isExpired(row.expires_at);
        if (stale) refreshInBackground("global_cache_stale");

        console.log(`[ASINEnrich] Global cache hit for ${cleanAsin}`);

        // Also populate per-user per-analysis cache for UX consistency (24h)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await supabase.from("asin_refinement_cache").upsert({
          user_id: user.id,
          asin: cleanAsin,
          analysis_run_id: analysisRunId,
          refined_units_range: { min: row.computed_monthly_units, max: row.computed_monthly_units },
          refined_estimated_revenue: row.computed_monthly_revenue,
          current_price: row.price ?? currentPrice ?? 0,
          current_bsr: row.bsr,
          review_count: row.ratings_total ?? null,
          fulfillment_type: null,
          data_source: Array.isArray(row.signals_used) && row.signals_used.includes("bought_last_month")
            ? "rainforest_bought_last_month"
            : "bsr_curve",
          confidence: row.confidence,
          expires_at: expiresAt.toISOString(),
        }, {
          onConflict: "user_id,asin,analysis_run_id",
        });

        const signalsUsed = (row.signals_used || []) as any;
        const dataSource =
          Array.isArray(row.signals_used) && row.signals_used.includes("bought_last_month")
            ? "rainforest_bought_last_month"
            : "bsr_curve";

        const payload: EnrichResponse = {
            success: true,
            status: "ready",
            stale,
            credits_charged: 0,
            served_from_cache: true,
            cache_age_seconds: secondsSince(row.fetched_at || null),
            signals_used: signalsUsed,
            data_timestamp: row.fetched_at || null,
            data: {
              refined_units_range: { min: row.computed_monthly_units, max: row.computed_monthly_units },
              refined_estimated_revenue: parseFloat(row.computed_monthly_revenue.toString()),
              current_price: row.price ? parseFloat(row.price.toString()) : currentPrice || 0,
              current_bsr: row.bsr,
              review_count: row.ratings_total ?? null,
              fulfillment_type: null,
              data_source: dataSource,
              confidence: row.confidence as "high" | "medium" | "low",
              expires_at: expiresAt.toISOString(),
            },
          };
        setMemory(cacheKey, payload);
        return NextResponse.json(payload, { headers: res.headers });
      }
    } catch (e) {
      // Table might not exist yet in some environments; fail open.
      console.warn("[ASINEnrich] Global cache lookup skipped:", e instanceof Error ? e.message : String(e));
    }

    // 4. Live provider fetch (Rainforest) with in-flight dedupe and <5s perceived performance.
    // Only charge credits when THIS request triggers a new provider call.
    const existingInflight = inflight.get(cacheKey);
    if (!existingInflight) {
      // Require explicit user confirmation before charging credits
      if (body.creditConfirmed !== true) {
        return NextResponse.json(
          {
            success: false,
            error: "confirmation_required",
            message: "This will use 1 credit to fetch live Amazon data. Continue?",
            requires_confirmation: true,
          },
          { status: 200, headers: res.headers }
        );
      }

      // Charge 1 credit because we're about to initiate a paid provider call
      const charged = await consumeCredits(
        user.id,
        1,
        "asin_enrich_provider_call",
        { asins: [cleanAsin], analysis_run_id: analysisRunId, provider: "rainforest_product" },
        supabase
      );
      if (!charged) {
        return NextResponse.json(
          { success: false, error: "Insufficient credits" },
          { status: 402, headers: res.headers }
        );
      }

      const promise = (async (): Promise<EnrichResponse> => {
        const rainforestApiKey = process.env.RAINFOREST_API_KEY;
        if (!rainforestApiKey) {
          return { success: false, error: "Rainforest API key not configured" };
        }

        console.log(`[ASINEnrich] Live fetch start for ${cleanAsin}`);

        const rainforestResponse = await fetch(
          `https://api.rainforestapi.com/request?api_key=${rainforestApiKey}&type=product&amazon_domain=amazon.com&asin=${cleanAsin}`,
          { method: "GET", headers: { Accept: "application/json" } }
        );

        if (!rainforestResponse.ok) {
          return { success: true, status: "pending", credits_charged: 1, served_from_cache: false, cache_age_seconds: null, data_timestamp: null };
        }

        const raw = await rainforestResponse.json();
        const product = raw?.product;
        if (!product) {
          return { success: true, status: "pending", credits_charged: 1, served_from_cache: false, cache_age_seconds: null, data_timestamp: null };
        }

    // 5. Extract and parse data
    const unitsRangeFromBought = parseBoughtLastMonth(product);
    
    // Use current price from listing if provided, otherwise try to parse from product
    let price = currentPrice || null;
    if (!price) {
      if (product.price?.value) {
        price = parseFloat(product.price.value);
      } else if (product.price?.raw) {
        price = parseFloat(product.price.raw);
      }
    }

    // Parse BSR
    let bsr: number | null = null;
    let mainCategory: string | null = null;
    if (product.bestsellers_rank && Array.isArray(product.bestsellers_rank) && product.bestsellers_rank.length > 0) {
      const firstRank = product.bestsellers_rank[0];
      if (firstRank.rank !== undefined && firstRank.rank !== null) {
        const parsed = parseInt(firstRank.rank.toString().replace(/,/g, ""), 10);
        bsr = isNaN(parsed) || parsed <= 0 ? null : parsed;
      }
      mainCategory = typeof firstRank.category === "string" && firstRank.category.trim().length > 0
        ? firstRank.category.trim()
        : null;
    }

    // Parse review count
    let reviewCount: number | null = null;
    if (product.reviews_total !== undefined && product.reviews_total !== null) {
      const parsed = parseInt(product.reviews_total.toString().replace(/,/g, ""), 10);
      reviewCount = isNaN(parsed) || parsed < 0 ? null : parsed;
    }

    // Parse fulfillment type
    // 🔒 STRICT RULE: DO NOT infer FBA from is_prime (Prime ≠ FBA)
    // Only use explicit fulfillment data from SP-API or Rainforest
    let fulfillmentType: string | null = null;
    if (product.fulfillment?.type === "amazon") {
      fulfillmentType = "Amazon";
    } else if (product.fulfillment?.type === "FBA" || product.fulfillment?.is_fba === true) {
      fulfillmentType = "FBA";
    } else if (product.fulfillment?.type === "FBM") {
      fulfillmentType = "FBM";
    }
    // If fulfillment cannot be determined, leave as null (honest and credible)

    // 6. Compute "best available signal" (Helium-10-like)
    // Priority:
    // 1) bought_last_month (highest confidence)
    // 2) BSR curve (fallback)
    // 3) insufficient (no guessing)
    const signalsUsed: NonNullable<EnrichResponse["signals_used"]> = [];
    if (price && price > 0) signalsUsed.push("price");
    if (reviewCount !== null) signalsUsed.push("reviews");
    if (bsr !== null) signalsUsed.push("bsr");

    let unitsSource: UnitsSource | null = null;
    let unitsRange: RefinedUnitsRange | null = null;
    let refinedRevenue = 0;
    let confidence: "high" | "medium" | "low" = "low";

    if (unitsRangeFromBought && price && price > 0) {
      unitsSource = "bought_last_month";
      unitsRange = unitsRangeFromBought;
      const avgUnits = (unitsRange.min + unitsRange.max) / 2;
      refinedRevenue = avgUnits * price;
      confidence = "high";
      signalsUsed.unshift("bought_last_month");
    } else if (bsr && price && price > 0) {
      const { estimateMonthlySalesFromBSR } = await import("@/lib/revenue/bsr-calculator");
      const units = estimateMonthlySalesFromBSR(bsr, mainCategory || "default");
      unitsSource = "bsr_curve";
      unitsRange = { min: units, max: units };
      refinedRevenue = units * price;
      confidence = "medium";
    } else {
      // No guessing: return insufficient, but still refresh caches in background for next click
      const payload: EnrichResponse = {
        success: true,
        status: "insufficient_data",
        credits_charged: 1,
        served_from_cache: false,
        cache_age_seconds: null,
        signals_used: signalsUsed,
        data_timestamp: nowIso(),
        data: undefined,
      };
      return payload;
    }

    // Ensure we have a consistent range for downstream storage
    const effectiveUnitsRange = unitsRange;
    if (!effectiveUnitsRange) {
      const payload: EnrichResponse = {
        success: true,
        status: "insufficient_data",
        stale: false,
        credits_charged: 1,
        served_from_cache: false,
        cache_age_seconds: null,
        signals_used: signalsUsed,
        data_timestamp: nowIso(),
        data: undefined,
      };
      return payload;
    }

    // 6b. Upsert into global caches (learning foundation)
    // - asin_bsr_cache (existing): BSR + category + price (+ brand if available)
    // - asin_sales_signal_cache (new): bought_last_month-derived units range + revenue + BSR + reviews + price
    try {
      // asin_bsr_cache
      await supabase.from("asin_bsr_cache").upsert({
        asin: cleanAsin,
        main_category: mainCategory,
        main_category_bsr: bsr,
        price: price,
        brand: typeof product.brand === "string" ? product.brand : null,
        last_fetched_at: new Date().toISOString(),
        source: "rainforest",
      }, { onConflict: "asin" });

      // asin_sales_signal_cache (only if we have unitsRange + price to avoid junk rows)
      if (effectiveUnitsRange && price) {
        await supabase.from("asin_sales_signal_cache").upsert({
          asin: cleanAsin,
          marketplace: "US",
          refined_units_range: effectiveUnitsRange,
          refined_estimated_revenue: refinedRevenue,
          current_price: price,
          current_bsr: bsr,
          review_count: reviewCount,
          fulfillment_type: fulfillmentType,
          data_source: unitsSource === "bought_last_month" ? "rainforest_bought_last_month" : "bsr_curve",
          confidence: confidence,
          last_fetched_at: new Date().toISOString(),
        }, { onConflict: "asin,marketplace" });
      }
    } catch (e) {
      console.warn("[ASINEnrich] Global cache upsert skipped:", e instanceof Error ? e.message : String(e));
    }

    // 7. Cache the result (24-hour expiry)
    if (effectiveUnitsRange && price) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await supabase.from("asin_refinement_cache").upsert({
        user_id: user.id,
        asin: cleanAsin,
        analysis_run_id: analysisRunId,
        refined_units_range: effectiveUnitsRange,
        refined_estimated_revenue: refinedRevenue,
        current_price: price,
        current_bsr: bsr,
        review_count: reviewCount,
        fulfillment_type: fulfillmentType,
        data_source: unitsSource === "bought_last_month" ? "rainforest_bought_last_month" : "bsr_curve",
        confidence: confidence,
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: "user_id,asin,analysis_run_id",
      });

      console.log(`[ASINEnrich] Cached refined data for ${cleanAsin} (confidence: ${confidence})`);
    }

    // 8. Return response
    const expiresAt = effectiveUnitsRange && price 
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
      : null;
    
    const response: EnrichResponse = {
      success: true,
      status: "ready",
      stale: false,
      credits_charged: 1,
      served_from_cache: false,
      cache_age_seconds: 0,
      signals_used: signalsUsed,
      data_timestamp: nowIso(),
      data: {
        refined_units_range: effectiveUnitsRange,
        refined_estimated_revenue: refinedRevenue,
        current_price: price || 0,
        current_bsr: bsr,
        review_count: reviewCount,
        fulfillment_type: fulfillmentType,
        data_source: unitsSource === "bought_last_month" ? "rainforest_bought_last_month" : "bsr_curve",
        confidence: confidence,
        expires_at: expiresAt,
      },
    };

        setMemory(cacheKey, response);
        return response;
      })().finally(() => {
        inflight.delete(cacheKey);
      });

      inflight.set(cacheKey, promise);
    }

    const inflightPromise = inflight.get(cacheKey)!;

    // Wait up to ~4.8s to return a ready response; otherwise return pending immediately.
    try {
      const result = await Promise.race([
        inflightPromise,
        new Promise<EnrichResponse>((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                status: "pending",
                credits_charged: existingInflight ? 0 : 1,
                served_from_cache: false,
                cache_age_seconds: null,
                data_timestamp: null,
              }),
            4800
          )
        ),
      ]);

      // If we got a ready response from inflight, but this request didn't initiate the call, don't charge again.
      if (existingInflight && result.credits_charged === 1) {
        result.credits_charged = 0;
      }
      return NextResponse.json(result, { headers: res.headers });
    } catch (e) {
      return NextResponse.json(
        { success: true, status: "pending", credits_charged: 0, served_from_cache: false, cache_age_seconds: null, data_timestamp: null },
        { headers: res.headers }
      );
    }
  } catch (error) {
    console.error("[ASINEnrich] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: res.headers }
    );
  }
}

