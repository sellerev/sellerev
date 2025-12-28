import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * Reject a pending memory (user clicked "Don't save")
 * POST /api/memory/reject
 * 
 * Body: { pendingMemoryId: string }
 */
export async function POST(req: NextRequest) {
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
    const body = await req.json();
    const { pendingMemoryId } = body;

    if (!pendingMemoryId) {
      return NextResponse.json(
        { ok: false, error: "pendingMemoryId is required" },
        { status: 400, headers: res.headers }
      );
    }

    const { rejectPendingMemory } = await import("@/lib/ai/sellerMemoryStore");
    
    await rejectPendingMemory(supabase, user.id, pendingMemoryId);

    return NextResponse.json(
      { ok: true },
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Error rejecting memory:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to reject memory",
      },
      { status: 500, headers: res.headers }
    );
  }
}
