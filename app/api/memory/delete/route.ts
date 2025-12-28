import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * Delete a memory
 * POST /api/memory/delete
 * 
 * Body: { key: string }
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
    const { key } = body;

    if (!key) {
      return NextResponse.json(
        { ok: false, error: "key is required" },
        { status: 400, headers: res.headers }
      );
    }

    const { deleteMemory } = await import("@/lib/ai/sellerMemoryStore");
    
    await deleteMemory(supabase, user.id, key);

    return NextResponse.json(
      { ok: true },
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Error deleting memory:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to delete memory",
      },
      { status: 500, headers: res.headers }
    );
  }
}
