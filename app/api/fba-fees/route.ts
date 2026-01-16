import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { getFbaFees } from "@/lib/spapi/getFbaFees";

/**
 * API endpoint to fetch FBA fees for an ASIN
 * Used by FeasibilityCalculator to get SP-API fees
 */

// Helper: referral fee estimate by category
function estimateReferralPct(categoryHint: string | null): { pct: number; label: string } {
  if (!categoryHint) return { pct: 15, label: "Default (15%)" };
  const c = categoryHint.toLowerCase();
  if (c.includes("electronics") || c.includes("computer") || c.includes("tech")) return { pct: 8, label: "Electronics (8%)" };
  if (c.includes("beauty") || c.includes("cosmetic") || c.includes("skincare")) return { pct: 8.5, label: "Beauty (8.5%)" };
  if (c.includes("clothing") || c.includes("apparel") || c.includes("fashion")) return { pct: 17, label: "Clothing (17%)" };
  if (c.includes("home") || c.includes("kitchen") || c.includes("household")) return { pct: 15, label: "Home (15%)" };
  return { pct: 15, label: "Default (15%)" };
}

// Helper: fulfillment fee estimate using size/weight if present, otherwise rough bucket
function estimateFulfillmentFee(
  weightKg: number | null,
  dimsCm: { length?: number | null; width?: number | null; height?: number | null } | null,
  categoryHint: string | null,
  price: number
): { fee: number; confidence: "low" | "medium"; label: string } {
  const l = dimsCm?.length ?? null;
  const w = dimsCm?.width ?? null;
  const h = dimsCm?.height ?? null;
  const maxDim = Math.max(l || 0, w || 0, h || 0);

  if (
    (typeof weightKg === "number" && weightKg > 0) ||
    maxDim > 0
  ) {
    // Small/standard
    if ((weightKg === null || weightKg < 0.45) && (maxDim === 0 || maxDim < 45.72)) {
      return { fee: 7.5, confidence: "medium", label: "Small/standard (estimated)" };
    }
    // Oversize/home goods
    if (
      (weightKg !== null && weightKg > 9.07) ||
      maxDim > 45.72 ||
      (categoryHint && /furniture|appliance|oversized/i.test(categoryHint))
    ) {
      return { fee: 10.0, confidence: "medium", label: "Oversize/home goods (estimated)" };
    }
    return { fee: 8.5, confidence: "medium", label: "Large standard (estimated)" };
  }

  // No size/weight — fallback on simple price bucket (low confidence)
  const f = price < 10 ? 2.0 : price < 25 ? 3.0 : price < 50 ? 4.0 : 5.0;
  return { fee: f, confidence: "low", label: "Fulfillment fee (low-confidence estimate)" };
}

export async function POST(request: NextRequest) {
  let res = new NextResponse();
  const supabase = createApiClient(request, res);

  // Parse body first so we can use values in catch block if needed
  let body: any = {};
  let price: number = 25; // Default fallback price
  let marketplace: string = "ATVPDKIKX0DER";
  
  try {
    body = await request.json();
    price = body?.price || 25;
    marketplace = body?.marketplace || "ATVPDKIKX0DER";
  } catch (parseError) {
    // If body parsing fails, we'll use defaults in catch block
  }

  // Get user ID for per-user token (optional - will fallback to env token if not available)
  let userId: string | undefined;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id;
  } catch {
    // Non-blocking - will use env token if user not available
  }

  try {
    // Fast-fail diagnostics: if SP-API env vars are missing, we can't possibly return an exact quote.
    // This helps distinguish "config missing" from transient SP-API failures.
    const requiredEnv = [
      "SP_API_CLIENT_ID",
      "SP_API_CLIENT_SECRET",
      "SP_API_REFRESH_TOKEN",
      "SP_API_AWS_ACCESS_KEY_ID",
      "SP_API_AWS_SECRET_ACCESS_KEY",
    ] as const;
    const missingEnv = requiredEnv.filter((k) => !process.env[k]);

    const {
      asin,
      category = null,
      weight_kg = null,
      dims_cm = null,
    } = body || {};

    if (!asin || typeof asin !== "string") {
      return NextResponse.json(
        { error: "ASIN is required" },
        { status: 400 }
      );
    }

    if (!price || typeof price !== "number" || price <= 0) {
      return NextResponse.json(
        { error: "Valid price is required" },
        { status: 400 }
      );
    }

    const referral = estimateReferralPct(typeof category === "string" ? category : null);
    const fulfillmentEst = estimateFulfillmentFee(
      typeof weight_kg === "number" ? weight_kg : null,
      (dims_cm && typeof dims_cm === "object") ? dims_cm : null,
      typeof category === "string" ? category : null,
      price
    );

    const estimated = {
      ok: true as const,
      source: "estimated" as const,
      confidence: fulfillmentEst.confidence,
      marketplace,
      referral_fee: Math.round(((price * referral.pct) / 100) * 100) / 100,
      fulfillment_fee: Math.round(fulfillmentEst.fee * 100) / 100,
      total_amazon_fees: 0, // computed below
      estimate_basis: {
        referral: referral.label,
        fulfillment: fulfillmentEst.label,
      },
    };
    estimated.total_amazon_fees = Math.round((estimated.referral_fee + estimated.fulfillment_fee) * 100) / 100;

    // Always compute estimated fees first (estimate-first approach)
    // If SP-API not configured, return estimate immediately
    if (missingEnv.length > 0) {
      return NextResponse.json(
        {
          ok: true,
          source: "estimated",
          confidence_label: "Estimated",
          marketplace,
          referral_fee: estimated.referral_fee,
          fulfillment_fee: estimated.fulfillment_fee,
          total_amazon_fees: estimated.total_amazon_fees,
          net_margin: null, // Will be computed by caller if COGS present
        },
        { status: 200 }
      );
    }

    // Cache lookup (30d TTL) — only use if complete
    // CRITICAL: Cache key is (asin, price, marketplace) - fees vary by price
    const supabase = await createClient();
    const normalizedAsin = asin.toUpperCase().trim();
    const normalizedMarketplace = typeof marketplace === "string" ? marketplace : "ATVPDKIKX0DER";
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - 30);
    const { data: cachedData, error: cacheError } = await supabase
      .from("fba_fee_cache")
      .select("fulfillment_fee, referral_fee, total_fba_fees, currency, fetched_at")
      .eq("asin", normalizedAsin)
      .eq("price", price)
      .eq("marketplace", normalizedMarketplace)
      .gte("fetched_at", cutoffTime.toISOString())
      .single();

    if (!cacheError && cachedData && cachedData.fulfillment_fee !== null && cachedData.referral_fee !== null) {
      const fulfillment_fee = parseFloat(cachedData.fulfillment_fee.toString());
      const referral_fee = parseFloat(cachedData.referral_fee.toString());
      const total_amazon_fees = Math.round((fulfillment_fee + referral_fee) * 100) / 100;
      return NextResponse.json(
        {
          ok: true,
          source: "sp_api",
          confidence_label: "Amazon Quote",
          marketplace,
          referral_fee,
          fulfillment_fee,
          total_amazon_fees,
          net_margin: null, // Will be computed by caller if COGS present
        },
        { status: 200 }
      );
    }

    // SP-API attempt (single attempt, no retries)
    let feesResult: { fulfillment_fee: number | null; referral_fee: number | null; total_fba_fees?: number | null; currency?: string } | null = null;
    try {
      const spApiResult = await getFbaFees({
        asin: normalizedAsin,
        price,
        marketplaceId: typeof marketplace === "string" ? marketplace : "ATVPDKIKX0DER",
        userId,
      });
      
      // Only use SP-API result if both fees are available
      if (spApiResult.fulfillment_fee !== null && spApiResult.referral_fee !== null) {
        feesResult = spApiResult;
      }
      // If SP-API fails or returns null, silently fall through to estimate (never surface error)
    } catch (spApiError) {
      // Silently fall through to estimate - never show SP-API failures to user
      console.log(`[FBA_FEES] SP-API unavailable for ${normalizedAsin}, using estimate`);
    }

    // If SP-API succeeded, cache and return
    if (feesResult && feesResult.fulfillment_fee !== null && feesResult.referral_fee !== null) {

    // Cache exact result (best-effort)
    // CRITICAL: Cache key is (asin, price, marketplace) - fees vary by price
    try {
      await supabase
        .from("fba_fee_cache")
        .upsert(
          {
            asin: normalizedAsin,
            price: price,
            marketplace: normalizedMarketplace,
            fulfillment_fee: feesResult.fulfillment_fee,
            referral_fee: feesResult.referral_fee,
            total_fba_fees: feesResult.total_fba_fees,
            currency: feesResult.currency,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "asin,price,marketplace" }
        );
    } catch (e) {
      console.error("Failed to cache FBA fees (non-blocking):", e);
    }

      const fulfillment_fee = feesResult.fulfillment_fee;
      const referral_fee = feesResult.referral_fee;
      const total_amazon_fees = Math.round((fulfillment_fee + referral_fee) * 100) / 100;
      
      // Cache exact result (best-effort)
      try {
        await supabase
          .from("fba_fee_cache")
          .upsert(
            {
              asin: normalizedAsin,
              price: price,
              marketplace: normalizedMarketplace,
              fulfillment_fee: feesResult.fulfillment_fee,
              referral_fee: feesResult.referral_fee,
              total_fba_fees: feesResult.total_fba_fees || total_amazon_fees,
              currency: feesResult.currency || "USD",
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "asin,price,marketplace" }
          );
      } catch (e) {
        console.error("Failed to cache FBA fees (non-blocking):", e);
      }
      
      return NextResponse.json(
        {
          ok: true,
          source: "sp_api",
          confidence_label: "Amazon Quote",
          marketplace,
          referral_fee,
          fulfillment_fee,
          total_amazon_fees,
          net_margin: null, // Will be computed by caller if COGS present
        },
        { status: 200 }
      );
    }

    // SP-API unavailable or failed - return estimate (never show error to user)
    return NextResponse.json(
      {
        ok: true,
        source: "estimated",
        confidence_label: "Estimated",
        marketplace,
        referral_fee: estimated.referral_fee,
        fulfillment_fee: estimated.fulfillment_fee,
        total_amazon_fees: estimated.total_amazon_fees,
        net_margin: null, // Will be computed by caller if COGS present
      },
      { status: 200 }
    );
  } catch (error) {
    // Never fail - always return estimate on any error
    console.error("FBA fees API error:", error);
    
    // Use parsed price if available, otherwise use default
    const fallbackPrice = (typeof price === "number" && price > 0) ? price : 25;
    
    const referral = estimateReferralPct(null);
    const fulfillmentEst = estimateFulfillmentFee(null, null, null, fallbackPrice);
    const referral_fee = Math.round(((fallbackPrice * referral.pct) / 100) * 100) / 100;
    const fulfillment_fee = Math.round(fulfillmentEst.fee * 100) / 100;
    const total_amazon_fees = Math.round((referral_fee + fulfillment_fee) * 100) / 100;
    
    return NextResponse.json(
      {
        ok: true,
        source: "estimated",
        confidence_label: "Estimated",
        marketplace: typeof marketplace === "string" ? marketplace : "ATVPDKIKX0DER",
        referral_fee,
        fulfillment_fee,
        total_amazon_fees,
        net_margin: null,
      },
      { status: 200 }
    );
  }
}

