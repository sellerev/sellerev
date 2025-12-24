import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * Confirm a pending memory (user clicked "Save it")
 * POST /api/memory/confirm
 * 
 * Body: { pendingMemoryId: string, confidence?: 'medium' | 'high' }
 */
export async function POST(req: NextRequest) {
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
    const body = await req.json();
    const { pendingMemoryId, confidence = 'medium' } = body;

    if (!pendingMemoryId) {
      return NextResponse.json(
        { ok: false, error: "pendingMemoryId is required" },
        { status: 400, headers: res.headers }
      );
    }

    const { confirmPendingMemory } = await import("@/lib/ai/sellerMemoryStore");
    
    await confirmPendingMemory(supabase, user.id, pendingMemoryId, confidence);

    return NextResponse.json(
      { ok: true },
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Error confirming memory:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to confirm memory",
      },
      { status: 500, headers: res.headers }
    );
  }
}
