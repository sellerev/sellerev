import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AnalyzeForm from "./AnalyzeForm";

interface AnalyzePageProps {
  searchParams: Promise<{ id?: string }>;
}

/**
 * Analyze Page - Server Component
 * 
 * Handles:
 * - Authentication check
 * - Seller profile validation
 * - Loading existing analysis if `id` query param is provided
 * 
 * The `id` param allows restoring a previous analysis from history,
 * enabling continuity for chat conversations.
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

  // If an analysis ID is provided, load it from the database
  let initialAnalysis = null;
  let initialMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  if (params.id) {
    // Fetch the analysis run
    const { data: analysisRun } = await supabase
      .from("analysis_runs")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.id) // Security: ensure user owns this analysis
      .single();

    if (analysisRun) {
      // Transform database record to match AnalysisResponse interface
      const response = analysisRun.response as Record<string, unknown>;
      
      initialAnalysis = {
        analysis_run_id: analysisRun.id,
        created_at: analysisRun.created_at,
        input_type: analysisRun.input_type as "asin" | "keyword",
        input_value: analysisRun.input_value,
        decision: response.decision as { verdict: "GO" | "CAUTION" | "NO_GO"; confidence: number },
        executive_summary: response.executive_summary as string,
        reasoning: response.reasoning as { primary_factors: string[]; seller_context_impact: string },
        risks: response.risks as Record<string, { level: "Low" | "Medium" | "High"; explanation: string }>,
        recommended_actions: response.recommended_actions as { must_do: string[]; should_do: string[]; avoid: string[] },
        assumptions_and_limits: response.assumptions_and_limits as string[],
        // Include market data if available (from rainforest_data column)
        market_data: analysisRun.rainforest_data as Record<string, unknown> | undefined,
        // Include keyword market snapshot if available (from response.market_snapshot)
        // Represents Page 1 results only
        market_snapshot: (response.market_snapshot && typeof response.market_snapshot === 'object' && !Array.isArray(response.market_snapshot))
          ? response.market_snapshot as {
              keyword: string;
              avg_price: number | null;
              avg_reviews: number | null;
              avg_rating: number | null;
              total_page1_listings: number;
              sponsored_count: number;
              dominance_score: number; // 0-100
              representative_asin?: string | null;
              fba_fees?: {
                total_fee: number | null;
                source: "sp_api" | "estimated";
                asin_used: string;
                price_used: number;
              };
            }
          : null,
      };

      // Fetch chat history for this analysis
      const { data: chatMessages } = await supabase
        .from("analysis_messages")
        .select("role, content")
        .eq("analysis_run_id", params.id)
        .order("created_at", { ascending: true });

      if (chatMessages && chatMessages.length > 0) {
        initialMessages = chatMessages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));
      }
    }
  }

  return (
    <AnalyzeForm
      initialAnalysis={initialAnalysis}
      initialMessages={initialMessages}
    />
  );
}
