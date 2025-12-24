import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * Get all memories for the current user
 * GET /api/memory/list
 */
export async function GET(req: NextRequest) {
  const res = new NextResponse();
  const supabase = await createApiClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: res.headers }
    );
  }

  try {
    const { getSellerMemories } = await import("@/lib/ai/sellerMemoryStore");
    const memories = await getSellerMemories(supabase, user.id);

    return NextResponse.json(
      { ok: true, memories },
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Error fetching memories:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch memories",
      },
      { status: 500, headers: res.headers }
    );
  }
}
