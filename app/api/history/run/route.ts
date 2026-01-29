import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { normalizeRisks } from "@/lib/analyze/normalizeRisks";

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

    const response = (analysisRun.response as Record<string, unknown>) || {};
    const pageOneListings = Array.isArray(response.page_one_listings)
      ? response.page_one_listings
      : Array.isArray(response.products)
      ? response.products
      : Array.isArray(response.listings)
      ? response.listings
      : [];
    const products = Array.isArray(response.products) ? response.products : pageOneListings;

    const aggregatesRaw = response.aggregates_derived_from_page_one;
    const computed_metrics =
      aggregatesRaw && typeof aggregatesRaw === "object" && !Array.isArray(aggregatesRaw)
        ? aggregatesRaw
        : null;

    const marketSnapshotRaw = response.market_snapshot;
    let snapshot: Record<string, unknown> | null = null;
    if (marketSnapshotRaw && typeof marketSnapshotRaw === "object" && !Array.isArray(marketSnapshotRaw)) {
      snapshot = marketSnapshotRaw as Record<string, unknown>;
    }

    const verdict = response.decision && typeof response.decision === "object" ? (response.decision as { verdict?: string }).verdict : undefined;
    const decision =
      verdict && ["GO", "CAUTION", "NO_GO"].includes(verdict)
        ? (response.decision as { verdict: string; confidence: number })
        : { verdict: "GO", confidence: 0 };
    const risks = normalizeRisks(response.risks as Record<string, { level: string; explanation: string }> | undefined);
    const reasoning =
      response.reasoning && typeof response.reasoning === "object"
        ? (response.reasoning as { primary_factors: string[]; seller_context_impact: string })
        : { primary_factors: [], seller_context_impact: "" };
    const recommended_actions =
      response.recommended_actions && typeof response.recommended_actions === "object"
        ? (response.recommended_actions as { must_do: string[]; should_do: string[]; avoid: string[] })
        : { must_do: [], should_do: [], avoid: [] };
    const assumptions_and_limits = Array.isArray(response.assumptions_and_limits) ? response.assumptions_and_limits : [];
    const executive_summary = typeof response.executive_summary === "string" ? response.executive_summary : "Market data loaded.";

    const payload = {
      analysis_run: {
        id: analysisRun.id,
        input_type: analysisRun.input_type,
        input_value: analysisRun.input_value,
        created_at: analysisRun.created_at,
        response: analysisRun.response,
        rainforest_data: analysisRun.rainforest_data,
      },
      snapshot,
      products,
      page_one_listings: pageOneListings,
      computed_metrics,
      page1_market_summary: snapshot,
      market_structure: response.market_structure ?? null,
      estimation_notes: response.estimation_notes ?? null,
      decision,
      executive_summary,
      reasoning,
      risks,
      recommended_actions,
      assumptions_and_limits,
      aggregates_derived_from_page_one: computed_metrics,
      market_snapshot: snapshot,
      market_data: analysisRun.rainforest_data ?? null,
      messages: messages || [],
    };

    console.log("HISTORY_VIEW_LOADED", {
      analysisRunId: analysisRun.id,
      products_count: products.length,
      messages_count: messages?.length ?? 0,
      used_db_only: true,
    });
    console.log("HISTORY_VIEW_RESPONSE_KEYS", {
      snapshot: snapshot ? Object.keys(snapshot).length : 0,
      products_length: Array.isArray(products) ? products.length : 0,
      computed_metrics: computed_metrics ? Object.keys(computed_metrics).length : 0,
      payload_keys: Object.keys(payload),
    });

    return NextResponse.json(payload, { status: 200, headers: res.headers });
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

