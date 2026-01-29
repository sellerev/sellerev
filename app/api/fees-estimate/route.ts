import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { getFeesResult, type FeesResultPayload } from "@/lib/spapi/feesResult";

const DEFAULT_MARKETPLACE = "ATVPDKIKX0DER";

export type { FeesResultPayload };

export async function POST(req: NextRequest) {
  const res = new NextResponse();
  const supabase = createApiClient(req, res);

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

  let body: { asin?: string; marketplaceId?: string; price?: number; category?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: Object.fromEntries(res.headers.entries()) }
    );
  }

  const asin = typeof body.asin === "string" ? body.asin.trim() : "";
  const marketplaceId =
    typeof body.marketplaceId === "string" && body.marketplaceId.length > 0
      ? body.marketplaceId
      : DEFAULT_MARKETPLACE;
  const price = typeof body.price === "number" && body.price > 0 ? body.price : null;
  const category = typeof body.category === "string" ? body.category : null;

  if (!asin || asin.length < 10) {
    return NextResponse.json(
      { error: "Valid ASIN is required" },
      { status: 400, headers: Object.fromEntries(res.headers.entries()) }
    );
  }
  if (price === null) {
    return NextResponse.json(
      { error: "Valid price is required" },
      { status: 400, headers: Object.fromEntries(res.headers.entries()) }
    );
  }

  const payload = await getFeesResult(supabase, user.id, {
    asin,
    marketplaceId,
    price,
    category,
  });

  return NextResponse.json(payload, {
    status: 200,
    headers: Object.fromEntries(res.headers.entries()),
  });
}
