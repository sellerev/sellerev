import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * Get pending memories for the current user
 * GET /api/memory/pending
 */
export async function GET(req: NextRequest) {
  const res = new NextResponse();
  const supabase = createApiClient(req, res);

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
    const { getPendingMemories } = await import("@/lib/ai/sellerMemoryStore");
    const pending = await getPendingMemories(supabase, user.id);

    return NextResponse.json(
      { ok: true, pending },
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Error fetching pending memories:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to fetch pending memories",
      },
      { status: 500, headers: res.headers }
    );
  }
}
