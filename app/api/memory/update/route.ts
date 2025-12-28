import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

/**
 * Update a memory
 * POST /api/memory/update
 * 
 * Body: { key: string, value: unknown, confidence?: 'low' | 'medium' | 'high', memory_type?: string }
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
    const { key, value, confidence = 'high', memory_type } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { ok: false, error: "key and value are required" },
        { status: 400, headers: res.headers }
      );
    }

    const { updateMemory } = await import("@/lib/ai/sellerMemoryStore");
    
    await updateMemory(supabase, user.id, key, {
      value,
      confidence,
      last_confirmed_at: new Date().toISOString(),
    });

    return NextResponse.json(
      { ok: true },
      { headers: res.headers }
    );
  } catch (error) {
    console.error("Error updating memory:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to update memory",
      },
      { status: 500, headers: res.headers }
    );
  }
}
