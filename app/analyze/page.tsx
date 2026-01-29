import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeRisks } from "@/lib/analyze/normalizeRisks";
import type { AnalysisResponse, RiskLevel } from "@/types/analysis";
import AnalyzeForm from "./AnalyzeForm";

interface AnalyzePageProps {
  searchParams: Promise<{ run?: string }>;
}

/**
 * Analyze Page - Server Component
 * 
 * Handles:
 * - Authentication check
 * - Seller profile validation
 * - Loading existing analysis if `run` query param is provided
 * 
 * The `run` param allows restoring a previous analysis from history,
 * enabling continuity for chat conversations and URL-based persistence.
 */
export default async function AnalyzePage({ searchParams }: AnalyzePageProps) {
  const supabase = await createClient();
  const params = await searchParams;

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  // Check if seller profile exists
  const { data: profile } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  // If an analysis run ID is provided, load it from the database
  let initialAnalysis: AnalysisResponse | null = null;
  let initialMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (params.run) {
    // Fetch the analysis run
    const { data: analysisRun } = await supabase
      .from("analysis_runs")
      .select("*")
      .eq("id", params.run)
      .eq("user_id", user.id) // Security: ensure user owns this analysis
      .single();

    if (analysisRun) {
      // Transform database record to match AnalysisResponse interface
      const response = analysisRun.response as Record<string, unknown>;
      
      // Define explicit Risks shape
      type NormalizedRisks = {
        competition: RiskLevel;
        pricing: RiskLevel;
        differentiation: RiskLevel;
        operations: RiskLevel;
      };
      
      // Force the normalizeRisks return type
      const normalizedRisks: NormalizedRisks = normalizeRisks(
        response.risks as Record<string, { level: string; explanation: string }> | undefined
      );
      
      // Extract page_one_listings and products from response (these fields exist in stored JSON)
      // Fallback: response.listings for older or API-returned shape
      const pageOneListings = Array.isArray(response.page_one_listings)
        ? response.page_one_listings
        : Array.isArray(response.products)
        ? response.products
        : Array.isArray(response.listings)
        ? response.listings
        : [];
      const products = Array.isArray(response.products) ? response.products : pageOneListings;
      
      // Extract aggregates if present
      const aggregatesRaw = response.aggregates_derived_from_page_one;
      const aggregates = (aggregatesRaw && typeof aggregatesRaw === 'object' && !Array.isArray(aggregatesRaw))
        ? {
            avg_price: (aggregatesRaw as Record<string, unknown>).avg_price as number,
            avg_rating: ((aggregatesRaw as Record<string, unknown>).avg_rating as number | null | undefined) ?? null,
            avg_rating_source: ((aggregatesRaw as Record<string, unknown>).avg_rating_source ?? null) as 'observed' | 'estimated' | null,
            avg_bsr: (aggregatesRaw as Record<string, unknown>).avg_bsr as number | null,
            total_monthly_units_est: (aggregatesRaw as Record<string, unknown>).total_monthly_units_est as number,
            total_monthly_revenue_est: (aggregatesRaw as Record<string, unknown>).total_monthly_revenue_est as number,
            page1_product_count: (aggregatesRaw as Record<string, unknown>).page1_product_count as number,
          }
        : undefined;
      
      // Extract market_snapshot, preserving listings array if present
      const marketSnapshotRaw = response.market_snapshot;
      let marketSnapshot: AnalysisResponse['market_snapshot'] | undefined = undefined;
      
      if (marketSnapshotRaw && typeof marketSnapshotRaw === 'object' && !Array.isArray(marketSnapshotRaw)) {
        const snapshot = marketSnapshotRaw as Record<string, unknown>;
        marketSnapshot = {
          keyword: snapshot.keyword as string,
          avg_price: snapshot.avg_price as number | null,
          avg_reviews: snapshot.avg_reviews as number | null,
          avg_rating: snapshot.avg_rating as number | null,
          total_page1_listings: snapshot.total_page1_listings as number,
          sponsored_count: snapshot.sponsored_count as number,
          dominance_score: snapshot.dominance_score as number,
          total_page1_brands: (snapshot as any).total_page1_brands ?? null,
          brand_stats: (snapshot as any).brand_stats ?? null,
          representative_asin: snapshot.representative_asin as string | null | undefined,
          fba_fees: snapshot.fba_fees ? (snapshot.fba_fees as {
            total_fee: number | null;
            source: "sp_api" | "estimated";
            asin_used: string;
            price_used: number;
          }) : undefined,
          // Preserve listings array if present (DO NOT strip it)
          // Type assertion: listings structure is flexible, matches type definition with [key: string]: unknown
          listings: Array.isArray(snapshot.listings) ? (snapshot.listings as any) : undefined,
        };
      }
      
      // Null-safe fallbacks for AI-disabled runs (no decision in response)
      const verdict = response.decision && typeof response.decision === "object" ? (response.decision as { verdict?: string }).verdict : undefined;
      const decision = (verdict && ["GO", "CAUTION", "NO_GO"].includes(verdict))
        ? (response.decision as { verdict: "GO" | "CAUTION" | "NO_GO"; confidence: number })
        : { verdict: "GO" as const, confidence: 0 };
      const executiveSummary = typeof response.executive_summary === "string" ? response.executive_summary : "Market data loaded.";
      const reasoning = (response.reasoning && typeof response.reasoning === "object")
        ? (response.reasoning as { primary_factors: string[]; seller_context_impact: string })
        : { primary_factors: [], seller_context_impact: "" };
      const recommendedActions = (response.recommended_actions && typeof response.recommended_actions === "object")
        ? (response.recommended_actions as { must_do: string[]; should_do: string[]; avoid: string[] })
        : { must_do: [], should_do: [], avoid: [] };
      const assumptionsAndLimits = Array.isArray(response.assumptions_and_limits) ? response.assumptions_and_limits : [];

      // Ensure initialAnalysis is explicitly typed
      initialAnalysis = {
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
        // Include market data if available (from rainforest_data column)
        market_data: analysisRun.rainforest_data as Record<string, unknown> | undefined,
        // Include keyword market snapshot with listings array preserved
        market_snapshot: marketSnapshot,
        // Extract canonical Page-1 listings (CRITICAL: these contain estimated_monthly_revenue and estimated_monthly_units)
        page_one_listings: pageOneListings.length > 0 ? pageOneListings as AnalysisResponse['page_one_listings'] : undefined,
        // Extract products array (same as page_one_listings, kept for backward compatibility)
        products: products.length > 0 ? products as AnalysisResponse['products'] : undefined,
        // Extract aggregates if present
        aggregates_derived_from_page_one: aggregates,
      } as AnalysisResponse;

      // Fetch chat history for this analysis
      const { data: chatMessages } = await supabase
        .from("analysis_messages")
        .select("role, content")
        .eq("analysis_run_id", params.run)
        .order("created_at", { ascending: true });

      if (chatMessages && chatMessages.length > 0) {
        initialMessages = chatMessages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));
      }

      console.log("HISTORY_VIEW_LOADED", {
        analysisRunId: analysisRun.id,
        products_count:
          (initialAnalysis.page_one_listings?.length ??
            initialAnalysis.products?.length ??
            0),
        messages_count: initialMessages.length,
        used_db_only: true,
      });
    }
  }

  return (
    <AnalyzeForm
      initialAnalysis={initialAnalysis}
      initialMessages={initialMessages}
    />
  );
}
