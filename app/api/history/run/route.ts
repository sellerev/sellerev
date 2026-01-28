import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

export async function GET(req: NextRequest) {
  const res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    const analysisRunId = req.nextUrl.searchParams.get("analysisRunId");

    if (!analysisRunId) {
      return NextResponse.json(
        { error: "Missing analysisRunId query parameter" },
        { status: 400, headers: res.headers }
      );
    }

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // Load analysis run (DB-only, no enrichment/analyze)
    const { data: analysisRun, error: runError } = await supabase
      .from("analysis_runs")
      .select(
        "id, user_id, input_type, input_value, created_at, response, rainforest_data"
      )
      .eq("id", analysisRunId)
      .eq("user_id", user.id)
      .single();

    if (runError || !analysisRun) {
      return NextResponse.json(
        { error: "Analysis run not found" },
        { status: 404, headers: res.headers }
      );
    }

    // Load chat messages for this run
    const { data: messages, error: messagesError } = await supabase
      .from("analysis_messages")
      .select("id, role, content, created_at")
      .eq("analysis_run_id", analysisRunId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json(
        { error: "Failed to load messages" },
        { status: 500, headers: res.headers }
      );
    }

    const response = analysisRun.response as Record<string, unknown>;
    const products =
      (Array.isArray(response.page_one_listings)
        ? (response.page_one_listings as any[])
        : Array.isArray(response.products)
        ? (response.products as any[])
        : []) || [];

    console.log("HISTORY_VIEW_LOADED", {
      analysisRunId: analysisRun.id,
      products_count: products.length,
      messages_count: messages?.length ?? 0,
      used_db_only: true,
    });

    return NextResponse.json(
      {
        analysis_run: {
          id: analysisRun.id,
          input_type: analysisRun.input_type,
          input_value: analysisRun.input_value,
          created_at: analysisRun.created_at,
          response: analysisRun.response,
          rainforest_data: analysisRun.rainforest_data,
        },
        messages: messages || [],
      },
      { status: 200, headers: res.headers }
    );
  } catch (error) {
    console.error("HISTORY_VIEW_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: res.headers }
    );
  }
}

