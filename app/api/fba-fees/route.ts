import { NextRequest, NextResponse } from "next/server";
import { resolveFbaFees } from "@/lib/spapi/resolveFbaFees";

/**
 * API endpoint to fetch FBA fees for an ASIN
 * Used by FeasibilityCalculator to get SP-API fees
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { asin, price } = body;

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

    // Fetch FBA fees from SP-API (with cache)
    const feesResult = await resolveFbaFees(asin, price);

    if (!feesResult) {
      return NextResponse.json(
        { fee: null, source: "estimated", reason: "sp_api_quote_unavailable" },
        { status: 200 }
      );
    }

    // Return fulfillment fee only (referral fee is handled separately in calculator)
    // FBA fee = fulfillment fee (referral is a separate Amazon fee, not part of FBA)
    const fulfillmentFee = feesResult.fulfillment_fee || null;

    // If any required component is missing, treat as unavailable (do not pretend this is an exact quote)
    if (feesResult.fulfillment_fee === null || feesResult.referral_fee === null) {
      return NextResponse.json(
        { fee: null, source: "estimated", reason: "sp_api_quote_unavailable" },
        { status: 200 }
      );
    }

    return NextResponse.json({
      fee: fulfillmentFee,
      fulfillment_fee: feesResult.fulfillment_fee,
      referral_fee: feesResult.referral_fee,
      source: "sp_api",
    });
  } catch (error) {
    console.error("FBA fees API error:", error);
    return NextResponse.json(
      { fee: null, source: "estimated", reason: "sp_api_error", error: "Failed to fetch fees" },
      { status: 200 } // Don't fail - return null so calculator can use estimate
    );
  }
}

