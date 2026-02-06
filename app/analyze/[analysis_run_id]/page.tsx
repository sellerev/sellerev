import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeRisks } from "@/lib/analyze/normalizeRisks";
import type { AnalysisResponse, RiskLevel } from "@/types/analysis";
import AnalyzeForm from "../AnalyzeForm";

/**
 * Analysis Detail Page - Server Component
 *
 * Displays a specific analysis run in read-only mode with full snapshot + product cards + chat.
 *
 * BEHAVIOR:
 * - Auth-protected
 * - Fetches analysis_run by ID and builds same initialAnalysis shape as /analyze?run=
 * - Ensures analysis_run.user_id === current user
 * - If not found or unauthorized → redirect to /history
 *
 * RENDERING:
 * - Reuses AnalyzeForm with full payload (snapshot, products, aggregates) so UI matches fresh Analyze.
 * - Null-safe fallbacks for AI-disabled runs (no decision in response).
 */

interface AnalysisDetailPageProps {
  params: Promise<{ analysis_run_id: string }>;
}

export default async function AnalysisDetailPage({ params }: AnalysisDetailPageProps) {
  const supabase = await createClient();
  const { analysis_run_id } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: analysisRun, error: analysisError } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("id", analysis_run_id)
    .eq("user_id", user.id)
    .single();

  if (analysisError || !analysisRun) {
    redirect("/history");
  }

  const response = analysisRun.response as Record<string, unknown> | null;
  if (!response || typeof response !== "object") {
    redirect("/history");
  }

  type NormalizedRisks = {
    competition: RiskLevel;
    pricing: RiskLevel;
    differentiation: RiskLevel;
    operations: RiskLevel;
  };
  const normalizedRisks: NormalizedRisks = normalizeRisks(
    response.risks as Record<string, { level: string; explanation: string }> | undefined
  );

  const pageOneListings = Array.isArray(response.page_one_listings)
    ? response.page_one_listings
    : Array.isArray(response.products)
    ? response.products
    : Array.isArray(response.listings)
    ? response.listings
    : [];
  const products = Array.isArray(response.products) ? response.products : pageOneListings;

  const aggregatesRaw = response.aggregates_derived_from_page_one;
  const aggregates =
    aggregatesRaw && typeof aggregatesRaw === "object" && !Array.isArray(aggregatesRaw)
      ? {
          avg_price: (aggregatesRaw as Record<string, unknown>).avg_price as number,
          avg_rating: ((aggregatesRaw as Record<string, unknown>).avg_rating as number | null | undefined) ?? null,
          avg_rating_source: ((aggregatesRaw as Record<string, unknown>).avg_rating_source ?? null) as "observed" | "estimated" | null,
          avg_bsr: (aggregatesRaw as Record<string, unknown>).avg_bsr as number | null,
          total_monthly_units_est: (aggregatesRaw as Record<string, unknown>).total_monthly_units_est as number,
          total_monthly_revenue_est: (aggregatesRaw as Record<string, unknown>).total_monthly_revenue_est as number,
          page1_product_count: (aggregatesRaw as Record<string, unknown>).page1_product_count as number,
        }
      : undefined;

  const marketSnapshotRaw = response.market_snapshot;
  let marketSnapshot: AnalysisResponse["market_snapshot"] | undefined = undefined;
  if (marketSnapshotRaw && typeof marketSnapshotRaw === "object" && !Array.isArray(marketSnapshotRaw)) {
    const snapshot = marketSnapshotRaw as Record<string, unknown>;
    marketSnapshot = {
      keyword: snapshot.keyword as string,
      avg_price: snapshot.avg_price as number | null,
      avg_reviews: snapshot.avg_reviews as number | null,
      avg_rating: snapshot.avg_rating as number | null,
      total_page1_listings: snapshot.total_page1_listings as number,
      sponsored_count: snapshot.sponsored_count as number,
      dominance_score: snapshot.dominance_score as number,
      total_page1_brands: ((snapshot as Record<string, unknown>).total_page1_brands ?? null) as number | null,
      brand_stats: ((snapshot as Record<string, unknown>).brand_stats ?? null) as {
        page1_brand_count: number;
        top_5_brand_share_pct: number;
      } | null,
      representative_asin: snapshot.representative_asin as string | null | undefined,
      fba_fees: snapshot.fba_fees
        ? (snapshot.fba_fees as {
            total_fee: number | null;
            source: "sp_api" | "estimated";
            asin_used: string;
            price_used: number;
          })
        : undefined,
      listings: Array.isArray(snapshot.listings) ? (snapshot.listings as any) : undefined,
    };
  }

  const verdict = response.decision && typeof response.decision === "object" ? (response.decision as { verdict?: string }).verdict : undefined;
  const decision =
    verdict && ["GO", "CAUTION", "NO_GO"].includes(verdict)
      ? (response.decision as { verdict: "GO" | "CAUTION" | "NO_GO"; confidence: number })
      : { verdict: "GO" as const, confidence: 0 };
  const executiveSummary =
    typeof response.executive_summary === "string" ? response.executive_summary : "Market data loaded.";
  const reasoning =
    response.reasoning && typeof response.reasoning === "object"
      ? (response.reasoning as { primary_factors: string[]; seller_context_impact: string })
      : { primary_factors: [], seller_context_impact: "" };
  const recommendedActions =
    response.recommended_actions && typeof response.recommended_actions === "object"
      ? (response.recommended_actions as { must_do: string[]; should_do: string[]; avoid: string[] })
      : { must_do: [], should_do: [], avoid: [] };
  const assumptionsAndLimits = Array.isArray(response.assumptions_and_limits) ? response.assumptions_and_limits : [];

  const initialAnalysis: AnalysisResponse = {
    analysis_run_id: analysisRun.id,
    created_at: analysisRun.created_at,
    input_type: analysisRun.input_type as "asin" | "keyword",
    input_value: analysisRun.input_value,
    decision,
    executive_summary: executiveSummary,
    reasoning,
    risks: normalizedRisks,
    recommended_actions: recommendedActions,
    assumptions_and_limits: assumptionsAndLimits,
    market_data: analysisRun.rainforest_data as Record<string, unknown> | undefined,
    market_snapshot: marketSnapshot ?? undefined,
    page_one_listings:
      pageOneListings.length > 0 ? (pageOneListings as AnalysisResponse["page_one_listings"]) : undefined,
    products: products.length > 0 ? (products as AnalysisResponse["products"]) : undefined,
    page_two_listings:
      Array.isArray(response.page_two_listings) && response.page_two_listings.length > 0
        ? (response.page_two_listings as AnalysisResponse["page_two_listings"])
        : undefined,
    aggregates_derived_from_page_one: aggregates,
  };

  const { data: chatMessages } = await supabase
    .from("analysis_messages")
    .select("role, content")
    .eq("analysis_run_id", analysis_run_id)
    .order("created_at", { ascending: true });

  const initialMessages =
    chatMessages?.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })) ?? [];

  return (
    <AnalyzeForm
      initialAnalysis={initialAnalysis}
      initialMessages={initialMessages}
      readOnly={true}
    />
  );
}
