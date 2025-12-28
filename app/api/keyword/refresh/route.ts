/**
 * Manual Keyword Refresh API
 * 
 * Allows users to request immediate refresh of a keyword snapshot.
 * Enforces per-user refresh quota and queues with high priority.
 */

import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { queueKeyword } from "@/lib/snapshots/keywordSnapshots";

// Refresh quota: X refreshes per user per day
const MAX_REFRESHES_PER_DAY = 10;

interface RefreshRequestBody {
  keyword: string;
}

export async function POST(req: NextRequest) {
  let res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    // 1. Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // 2. Parse request body
    let body: RefreshRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400, headers: res.headers }
      );
    }

    if (!body.keyword || typeof body.keyword !== "string" || body.keyword.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Keyword is required" },
        { status: 400, headers: res.headers }
      );
    }

    // 3. Check refresh quota
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: refreshCount, error: quotaError } = await supabase
      .from('keyword_queue')
      .select('id', { count: 'exact', head: true })
      .eq('requested_by', user.id)
      .eq('priority', 10) // Manual refreshes use priority 10
      .gte('created_at', today.toISOString());

    if (quotaError) {
      console.error("Failed to check refresh quota:", quotaError);
    }

    const currentRefreshCount = typeof refreshCount === 'number' ? refreshCount : 0;
    if (currentRefreshCount >= MAX_REFRESHES_PER_DAY) {
      return NextResponse.json(
        {
          success: false,
          error: `Daily refresh limit reached. You can refresh up to ${MAX_REFRESHES_PER_DAY} keywords per day.`,
          quota_remaining: 0,
        },
        { status: 429, headers: res.headers }
      );
    }

    // 4. Queue keyword with high priority (10)
    const queueId = await queueKeyword(
      supabase,
      body.keyword.trim(),
      10, // High priority for manual refresh
      user.id,
      'amazon.com'
    );

    if (!queueId) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to queue keyword for refresh",
        },
        { status: 500, headers: res.headers }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Keyword queued for refresh. Ready in ~5–10 minutes.",
        keyword: body.keyword.trim(),
        queue_id: queueId,
        quota_remaining: MAX_REFRESHES_PER_DAY - currentRefreshCount - 1,
        queued_at: new Date().toISOString(),
      },
      { status: 202, headers: res.headers } // 202 Accepted
    );

  } catch (err) {
    console.error("Keyword refresh error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: res.headers }
    );
  }
}

