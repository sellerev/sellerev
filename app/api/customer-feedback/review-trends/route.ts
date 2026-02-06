import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { getItemReviewTrends } from "@/lib/spapi/customerFeedback";

const DEFAULT_MARKETPLACE = "ATVPDKIKX0DER";

/**
 * GET /api/customer-feedback/review-trends?asin=B08N5WRWNW&marketplaceId=ATVPDKIKX0DER
 *
 * Returns positive and negative review topics for the past six months (SP-API Customer Feedback).
 * Requires authenticated user with connected Amazon (Brand Analytics role).
 */
export async function GET(request: NextRequest) {
  const res = new NextResponse();
  const supabase = createApiClient(request, res);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: Object.fromEntries(res.headers.entries()) }
    );
  }

  const { searchParams } = new URL(request.url);
  const asin = searchParams.get("asin")?.trim() ?? "";
  const marketplaceId =
    (searchParams.get("marketplaceId")?.trim() || DEFAULT_MARKETPLACE);

  if (!asin || asin.length !== 10) {
    return NextResponse.json(
      { error: "Valid 10-character ASIN is required" },
      { status: 400, headers: Object.fromEntries(res.headers.entries()) }
    );
  }

  const data = await getItemReviewTrends(asin, marketplaceId, user.id);

  if (data === null) {
    return NextResponse.json(
      {
        error: "Review trends unavailable",
        detail:
          "Ensure Amazon is connected and your seller account has Brand Analytics (Customer Feedback) access.",
      },
      { status: 503, headers: Object.fromEntries(res.headers.entries()) }
    );
  }

  return NextResponse.json(data, {
    status: 200,
    headers: Object.fromEntries(res.headers.entries()),
  });
}
