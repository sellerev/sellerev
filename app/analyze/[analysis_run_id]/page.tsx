import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AnalyzeForm from "../AnalyzeForm";

/**
 * Analysis Detail Page - Server Component
 * 
 * Displays a specific analysis run in read-only mode.
 * 
 * BEHAVIOR:
 * - Auth-protected
 * - Fetches analysis_run by ID
 * - Ensures analysis_run.user_id === current user
 * - If not found or unauthorized → redirect to /history
 * 
 * RENDERING RULES:
 * - Reuses existing AnalyzeForm layout
 * - Input bar and analyze button are disabled (readOnly mode)
 * - Does NOT call /api/analyze
 * 
 * ENABLED:
 * - Display all analysis blocks using stored data
 * - Load ChatSidebar with existing messages
 * - Allow continued chat messages
 * 
 * DISABLED:
 * - Creating a new analysis
 * - Editing analysis inputs
 * - Re-running AI
 */

interface AnalysisDetailPageProps {
  params: Promise<{ analysis_run_id: string }>;
}

export default async function AnalysisDetailPage({ params }: AnalysisDetailPageProps) {
  const supabase = await createClient();
  const { analysis_run_id } = await params;

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  // Fetch analysis_run by ID
  // SECURITY: Ensure analysis_run.user_id === current user
  const { data: analysisRun, error: analysisError } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("id", analysis_run_id)
    .eq("user_id", user.id)
    .single();

  // If not found or unauthorized → redirect to /history
  if (analysisError || !analysisRun) {
    redirect("/history");
  }

  // Transform database record to match AnalysisResponse interface
  const response = analysisRun.response as Record<string, unknown>;

  const initialAnalysis = {
    analysis_run_id: analysisRun.id,
    created_at: analysisRun.created_at,
    input_type: analysisRun.input_type as "asin" | "keyword",
    input_value: analysisRun.input_value,
    decision: response.decision as {
      verdict: "GO" | "CAUTION" | "NO_GO";
      confidence: number;
    },
    executive_summary: response.executive_summary as string,
    reasoning: response.reasoning as {
      primary_factors: string[];
      seller_context_impact: string;
    },
    risks: response.risks as Record<
      string,
      { level: "Low" | "Medium" | "High"; explanation: string }
    >,
    recommended_actions: response.recommended_actions as {
      must_do: string[];
      should_do: string[];
      avoid: string[];
    },
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
    .eq("analysis_run_id", analysis_run_id)
    .order("created_at", { ascending: true });

  const initialMessages =
    chatMessages?.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })) || [];

  return (
    <AnalyzeForm
      initialAnalysis={initialAnalysis}
      initialMessages={initialMessages}
      readOnly={true}
    />
  );
}

