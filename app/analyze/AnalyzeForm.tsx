"use client";

import { useState } from "react";
import ChatSidebar, { ChatMessage } from "./ChatSidebar";

/**
 * Sellerev Analyze Page - Core Product Component
 * 
 * This is the most important page in the application.
 * 
 * ARCHITECTURE:
 * - Two-column layout: 70% analysis blocks, 30% persistent chat
 * - Pre-analysis state: Input only
 * - Post-analysis state: All blocks + chat visible
 * 
 * DATA FLOW:
 * - Analysis calls /api/analyze (AI + optional Rainforest data)
 * - Chat calls /api/chat (grounded to this analysis only)
 * - All data persisted to analysis_runs table
 * 
 * ANTI-HALLUCINATION:
 * - Market data displayed BEFORE AI interpretation
 * - Chat cannot fetch new data
 * - Verdicts cannot silently change
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

interface RiskLevel {
  level: "Low" | "Medium" | "High";
  explanation: string;
}

interface AnalysisResponse {
  analysis_run_id: string;
  created_at: string;
  input_type: "asin" | "keyword";
  input_value: string;
  decision: {
    verdict: "GO" | "CAUTION" | "NO_GO";
    confidence: number;
  };
  executive_summary: string;
  reasoning: {
    primary_factors: string[];
    seller_context_impact: string;
  };
  risks: {
    competition: RiskLevel;
    pricing: RiskLevel;
    differentiation: RiskLevel;
    operations: RiskLevel;
  };
  recommended_actions: {
    must_do: string[];
    should_do: string[];
    avoid: string[];
  };
  assumptions_and_limits: string[];
  // Optional: Market data (from keyword aggregation or ASIN analysis)
  market_data?: {
    average_price?: number;
    price_min?: number;
    price_max?: number;
    review_count_avg?: number;
    average_rating?: number;
    competitor_count?: number;
    top_asins?: string[];
    data_fetched_at?: string;
  };
  // Optional: Aggregated keyword market snapshot (when input_type === "keyword")
  // Matches KeywordMarketSnapshot from lib/amazon/keywordMarket.ts
  market_snapshot?: {
    keyword: string;
    total_results_estimate: number | null;
    total_listings: number;
    sponsored_count: number;
    avg_price: number | null;
    avg_reviews: number | null;
    top_brands: Array<{ brand: string; count: number }>;
    dominance_score: number | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isValidASIN(value: string): boolean {
  // ASIN format: 10 alphanumeric characters, typically starting with B0
  const asinPattern = /^[A-Z0-9]{10}$/i;
  return asinPattern.test(value.trim());
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface AnalyzeFormProps {
  // Initial analysis to display (when loading from history)
  initialAnalysis?: AnalysisResponse | null;
  // Initial chat messages (when loading from history)
  initialMessages?: ChatMessage[];
  // Read-only mode: disables input bar and analyze button
  // Used when viewing historical analyses
  readOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZATION HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes analysis data: ensures market_snapshot is always an object or null, never an array.
 * Extracts from decision.market_snapshot or response.market_snapshot if needed.
 */
function normalizeAnalysis(analysisData: AnalysisResponse | null): AnalysisResponse | null {
  if (!analysisData) return null;
  
  // Normalize market_snapshot: extract from response.market_snapshot or use existing
  // Ensure it's an object, not an array, or null
  let normalizedSnapshot = null;
  if (analysisData.market_snapshot) {
    if (typeof analysisData.market_snapshot === 'object' && !Array.isArray(analysisData.market_snapshot)) {
      normalizedSnapshot = analysisData.market_snapshot;
    }
  } else if ((analysisData as any).response?.market_snapshot) {
    const snapshot = (analysisData as any).response.market_snapshot;
    if (typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      normalizedSnapshot = snapshot;
    }
  }
  
  return {
    ...analysisData,
    market_snapshot: normalizedSnapshot,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function AnalyzeForm({
  initialAnalysis = null,
  initialMessages = [],
  readOnly = false,
}: AnalyzeFormProps) {
  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────

  // Input state - pre-populate if loading from history
  const [inputType, setInputType] = useState<"asin" | "keyword">(
    initialAnalysis?.input_type || "keyword"
  );
  const [inputValue, setInputValue] = useState(
    initialAnalysis?.input_value || ""
  );
  const [inputError, setInputError] = useState<string | null>(null);

  // Analysis state - initialize with provided analysis if available, normalized
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(
    normalizeAnalysis(initialAnalysis)
  );

  // Chat messages state (synced with ChatSidebar)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialMessages);

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const validateInput = (): boolean => {
    setInputError(null);

    if (!inputValue.trim()) {
      setInputError("Please enter a value to analyze");
      return false;
    }

    if (inputType === "asin" && !isValidASIN(inputValue)) {
      setInputError("Please enter a valid ASIN (10 alphanumeric characters)");
      return false;
    }

    return true;
  };

  const analyze = async () => {
    if (!validateInput()) return;

    setLoading(true);
    setError(null);
    setAnalysis(null);
    setChatMessages([]); // Clear previous chat

    try {
      // Map UI input type to API input type
      // UI shows "Keyword" but API expects "idea"
      const apiInputType = inputType === "keyword" ? "idea" : "asin";

      console.log("ANALYZE_REQUEST_START", { apiInputType, inputValue: inputValue.trim() });

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_type: apiInputType,
          input_value: inputValue.trim(),
        }),
      });

      const data = await res.json();
      console.log("ANALYZE_RESPONSE", { 
        status: res.status, 
        ok: res.ok, 
        success: data.success, 
        has_analysisRunId: !!data.analysisRunId,
        has_decision: !!data.decision,
        error: data.error 
      });

      if (!res.ok || !data.success) {
        const errorMsg = data.error || "Analysis failed";
        console.error("ANALYZE_ERROR", { error: errorMsg, data });
        setError(errorMsg);
        setLoading(false);
        return;
      }

      if (!data.analysisRunId) {
        console.error("ANALYZE_MISSING_RUN_ID", { data });
        setError("Analysis completed but no run ID returned");
        setLoading(false);
        return;
      }

      if (!data.decision) {
        console.error("ANALYZE_MISSING_DECISION", { data });
        setError("Analysis completed but no decision data returned");
        setLoading(false);
        return;
      }

      // Transform response to match AnalysisResponse interface
      // data.decision already contains: decision, executive_summary, reasoning, risks, recommended_actions, assumptions_and_limits, numbers_used, market_snapshot
      
      // Normalize market_snapshot: extract from decision.market_snapshot and ensure it's an object or null
      // Never assume arrays - snapshot is always an object with the new structure
      const marketSnapshot = data.decision.market_snapshot || null;
      
      const analysisData: AnalysisResponse = {
        analysis_run_id: data.analysisRunId,
        created_at: new Date().toISOString(),
        input_type: inputType,
        input_value: inputValue.trim(),
        decision: data.decision.decision,
        executive_summary: data.decision.executive_summary,
        reasoning: data.decision.reasoning,
        risks: data.decision.risks,
        recommended_actions: data.decision.recommended_actions,
        assumptions_and_limits: data.decision.assumptions_and_limits,
        market_snapshot: marketSnapshot && typeof marketSnapshot === 'object' && !Array.isArray(marketSnapshot) 
          ? marketSnapshot 
          : null,
        market_data: data.decision.market_data,
      };

      console.log("ANALYZE_SUCCESS", { 
        analysisRunId: data.analysisRunId,
        has_analysis: !!analysisData 
      });

      // Normalize and set analysis
      setAnalysis(normalizeAnalysis(analysisData));
      setError(null);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Analysis failed";
      console.error("ANALYZE_EXCEPTION", { error: errorMessage, exception: e });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // UI HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  const getVerdictStyles = (verdict: string) => {
    switch (verdict) {
      case "GO":
        return {
          badge: "bg-green-100 text-green-800 border-green-300",
          text: "text-green-700",
        };
      case "CAUTION":
        return {
          badge: "bg-yellow-100 text-yellow-800 border-yellow-300",
          text: "text-yellow-700",
        };
      case "NO_GO":
        return {
          badge: "bg-red-100 text-red-800 border-red-300",
          text: "text-red-700",
        };
      default:
        return {
          badge: "bg-gray-100 text-gray-800 border-gray-300",
          text: "text-gray-700",
        };
    }
  };

  const getRiskLevelStyles = (level: string) => {
    switch (level) {
      case "Low":
        return "bg-green-50 border-green-200 text-green-700";
      case "Medium":
        return "bg-yellow-50 border-yellow-200 text-yellow-700";
      case "High":
        return "bg-red-50 border-red-200 text-red-700";
      default:
        return "bg-gray-50 border-gray-200 text-gray-700";
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* BLOCK 1: INPUT BAR (TOP - FULL WIDTH)                               */}
      {/* In readOnly mode: inputs and button are disabled                    */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="border-b bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex gap-3 items-end">
            {/* Input Type Toggle */}
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Type
              </label>
              <div className={`flex border rounded-lg overflow-hidden ${readOnly ? "opacity-60" : ""}`}>
                <button
                  type="button"
                  className={`flex-1 py-2 px-3 text-sm font-medium transition-colors ${
                    inputType === "asin"
                      ? "bg-black text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  } ${readOnly ? "cursor-not-allowed" : ""}`}
                  onClick={() => !readOnly && setInputType("asin")}
                  disabled={loading || readOnly}
                >
                  ASIN
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 px-3 text-sm font-medium transition-colors ${
                    inputType === "keyword"
                      ? "bg-black text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  } ${readOnly ? "cursor-not-allowed" : ""}`}
                  onClick={() => !readOnly && setInputType("keyword")}
                  disabled={loading || readOnly}
                >
                  Keyword
                </button>
              </div>
            </div>

            {/* Input Field */}
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {inputType === "asin" ? "Amazon ASIN" : "Product Keyword"}
              </label>
              <input
                type="text"
                className={`w-full border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent ${
                  inputError ? "border-red-300" : "border-gray-300"
                } ${readOnly ? "bg-gray-50 cursor-not-allowed" : ""}`}
                value={inputValue}
                onChange={(e) => {
                  if (!readOnly) {
                    setInputValue(e.target.value);
                    setInputError(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading && !readOnly) {
                    analyze();
                  }
                }}
                disabled={loading || readOnly}
                placeholder={
                  inputType === "asin"
                    ? "e.g., B0CHX3PNKD"
                    : "e.g., yoga mat, wireless earbuds"
                }
                readOnly={readOnly}
              />
              {inputError && (
                <p className="text-red-600 text-xs mt-1">{inputError}</p>
              )}
            </div>

            {/* Analyze Button - Hidden in readOnly mode */}
            {readOnly ? (
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg text-sm text-gray-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                View Only
              </div>
            ) : (
              <button
                className="bg-black text-white rounded-lg px-8 py-2 font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={analyze}
                disabled={loading || !inputValue.trim()}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Analyzing...
                  </span>
                ) : (
                  "Analyze"
                )}
              </button>
            )}
          </div>

          {/* Global Error */}
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Read-only banner */}
          {readOnly && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-blue-700 text-sm">
                Viewing saved analysis. Chat is available for follow-up questions.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MAIN CONTENT: TWO-COLUMN LAYOUT                                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─────────────────────────────────────────────────────────────── */}
        {/* LEFT COLUMN: ANALYSIS BLOCKS (~70%)                             */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ width: "70%" }}
        >
          {!analysis ? (
            /* PRE-ANALYSIS STATE */
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md px-4">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Ready to Analyze
                </h2>
                <p className="text-gray-500 text-sm">
                  Enter an ASIN or product keyword above to receive a
                  conservative, data-grounded analysis with clear
                  recommendations.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6 max-w-4xl">
              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* POST-ANALYSIS STATE: LOCKED VISUAL HIERARCHY                  */}
              {/* Order: Decision → Market → Summary → Risks → Actions → Limits */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* Defensive invariant: ensure analysis and decision exist */}
              {!analysis || !analysis.decision ? null : (
              <>
              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 2: DECISION HEADER (HIGHEST PRIORITY)                 */}
              {/* - Verdict badge (GO / CAUTION / NO_GO)                      */}
              {/* - Confidence percentage                                     */}
              {/* - One-line interpretation                                   */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4 mb-3">
                  <span
                    className={`px-5 py-2 rounded-lg border-2 font-bold text-lg ${
                      getVerdictStyles(analysis.decision.verdict).badge
                    }`}
                  >
                    {analysis.decision.verdict === "NO_GO"
                      ? "NO GO"
                      : analysis.decision.verdict}
                  </span>
                  <div>
                    <span className="text-2xl font-bold">
                      {analysis.decision.confidence}%
                    </span>
                    <span className="text-gray-500 ml-2">confidence</span>
                  </div>
                </div>
                {/* One-line interpretation */}
                <p className={`text-sm font-medium ${getVerdictStyles(analysis.decision.verdict).text}`}>
                  {analysis.decision.verdict === "GO" &&
                    "This product shows potential for your seller profile."}
                  {analysis.decision.verdict === "CAUTION" &&
                    "Proceed carefully — review risks before committing."}
                  {analysis.decision.verdict === "NO_GO" &&
                    "Not recommended for your current seller stage."}
                </p>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 3: MARKET SNAPSHOT                                    */}
              {/* - 4 compact stat cards (2x2 grid)                           */}
              {/* - Uses market_snapshot for keywords, market_data for ASINs */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Market Snapshot
                  </h2>
                  {analysis.market_data?.data_fetched_at && (
                    <span className="text-xs text-gray-400">
                      Updated {formatTimeAgo(analysis.market_data.data_fetched_at)}
                    </span>
                  )}
                </div>

                {/* Check for keyword market snapshot first, then fall back to market_data */}
                {analysis.market_snapshot ? (
                  <div className="grid grid-cols-2 gap-3">
                    {/* Card 1: Price Band */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Price Band</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.avg_price !== null && analysis.market_snapshot.avg_price !== undefined
                          ? formatCurrency(analysis.market_snapshot.avg_price)
                          : "—"}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        {analysis.market_snapshot.avg_price !== null && analysis.market_snapshot.avg_price !== undefined
                          ? `Avg: ${formatCurrency(analysis.market_snapshot.avg_price)}`
                          : "Price data unavailable"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {analysis.market_snapshot.avg_price !== null && analysis.market_snapshot.avg_price !== undefined
                          ? analysis.market_snapshot.avg_price < 20 ? "Budget" : analysis.market_snapshot.avg_price < 50 ? "Mid-range" : "Premium"
                          : "Unknown"}
                      </div>
                    </div>
                    {/* Card 2: Review Barrier */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Review Barrier</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.avg_reviews !== null && analysis.market_snapshot.avg_reviews !== undefined
                          ? analysis.market_snapshot.avg_reviews.toLocaleString()
                          : "—"}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        {analysis.market_snapshot.avg_reviews !== null && analysis.market_snapshot.avg_reviews !== undefined
                          ? `Avg reviews: ${analysis.market_snapshot.avg_reviews.toLocaleString()}`
                          : "Review data unavailable"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {analysis.market_snapshot.avg_reviews !== null && analysis.market_snapshot.avg_reviews !== undefined
                          ? analysis.market_snapshot.avg_reviews > 2000
                            ? "High barrier"
                            : analysis.market_snapshot.avg_reviews > 500
                            ? "Moderate"
                            : "Low"
                          : "Unknown"}
                      </div>
                    </div>
                    {/* Card 3: Brand Control */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Brand Control</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.dominance_score !== null && analysis.market_snapshot.dominance_score !== undefined
                          ? `Top brand: ${analysis.market_snapshot.dominance_score}%`
                          : "—"}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        Competitors: {analysis.market_snapshot.total_listings} listings
                        {analysis.market_snapshot.sponsored_count > 0 && ` • ${analysis.market_snapshot.sponsored_count} sponsored`}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {analysis.market_snapshot.dominance_score !== null && analysis.market_snapshot.dominance_score !== undefined
                          ? analysis.market_snapshot.dominance_score >= 35 ? "Concentrated" : "Fragmented"
                          : "Unknown"}
                      </div>
                    </div>
                    {/* Card 4: Market Size */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Market Size</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.total_listings} listings
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        {analysis.market_snapshot.total_results_estimate !== null
                          ? `~${analysis.market_snapshot.total_results_estimate.toLocaleString()} total results`
                          : "Page 1 analysis"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {analysis.market_snapshot.total_listings >= 20
                          ? "Large market"
                          : analysis.market_snapshot.total_listings >= 10
                          ? "Medium"
                          : "Small"}
                      </div>
                    </div>
                  </div>
                ) : analysis.market_data &&
                  Object.keys(analysis.market_data).length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {/* Card 1: Average Price */}
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Avg Price</div>
                      <div className="text-lg font-semibold">
                        {analysis.market_data.average_price !== undefined
                          ? formatCurrency(analysis.market_data.average_price)
                          : "—"}
                      </div>
                    </div>
                    {/* Card 2: Avg Rating */}
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Avg Rating</div>
                      <div className="text-lg font-semibold">
                        {analysis.market_data.average_rating !== undefined
                          ? `${analysis.market_data.average_rating.toFixed(1)} ★`
                          : "—"}
                      </div>
                    </div>
                    {/* Card 3: Review Count */}
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Avg Reviews</div>
                      <div className="text-lg font-semibold">
                        {analysis.market_data.review_count_avg !== undefined
                          ? analysis.market_data.review_count_avg.toLocaleString()
                          : "—"}
                      </div>
                    </div>
                    {/* Card 4: Competitors */}
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Competitors</div>
                      <div className="text-lg font-semibold">
                        {analysis.market_data.competitor_count !== undefined
                          ? analysis.market_data.competitor_count
                          : "—"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-200">
                    <p className="text-gray-500 text-xs">
                      {analysis.input_type === "keyword"
                        ? "Insufficient market data for this keyword."
                        : "No market data available for this analysis."}
                    </p>
                  </div>
                )}
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 4: EXECUTIVE SUMMARY                                  */}
              {/* - 1-2 paragraphs                                            */}
              {/* - Natural language explanation                              */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  Executive Summary
                </h2>
                <p className="text-gray-700 leading-relaxed">
                  {analysis.executive_summary}
                </p>
                {/* Seller context impact as secondary paragraph */}
                {analysis.reasoning?.seller_context_impact && (
                  <p className="text-gray-600 text-sm mt-3 pt-3 border-t">
                    <span className="font-medium">For your seller profile: </span>
                    {analysis.reasoning.seller_context_impact}
                  </p>
                )}
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 5: RISK BREAKDOWN                                     */}
              {/* - 2x2 grid                                                  */}
              {/* - Competition, Pricing, Differentiation, Operations         */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Risk Breakdown
                </h2>

                <div className="grid grid-cols-2 gap-3">
                  {(
                    Object.entries(analysis.risks) as [
                      string,
                      RiskLevel
                    ][]
                  ).map(([category, risk]) => (
                    <div
                      key={category}
                      className={`border rounded-lg p-3 ${getRiskLevelStyles(
                        risk.level
                      )}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-medium capitalize text-sm">{category}</h3>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded ${
                            risk.level === "Low"
                              ? "bg-green-100"
                              : risk.level === "Medium"
                              ? "bg-yellow-100"
                              : "bg-red-100"
                          }`}
                        >
                          {risk.level}
                        </span>
                      </div>
                      <p className="text-xs opacity-90">{risk.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 6: RECOMMENDED ACTIONS                                */}
              {/* - Must do / Should do / Avoid                               */}
              {/* - Bullet lists                                              */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Recommended Actions
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Must Do */}
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full" />
                      Must Do
                    </h3>
                    {analysis.recommended_actions.must_do.length > 0 ? (
                      <ul className="space-y-2">
                        {analysis.recommended_actions.must_do.map(
                          (action, idx) => (
                            <li
                              key={idx}
                              className="text-sm text-green-700 flex items-start gap-2"
                            >
                              <span className="text-green-400 mt-0.5">✓</span>
                              {action}
                            </li>
                          )
                        )}
                      </ul>
                    ) : (
                      <p className="text-sm text-green-600 italic">
                        No critical actions required
                      </p>
                    )}
                  </div>

                  {/* Should Do */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-500 rounded-full" />
                      Should Do
                    </h3>
                    {analysis.recommended_actions.should_do.length > 0 ? (
                      <ul className="space-y-2">
                        {analysis.recommended_actions.should_do.map(
                          (action, idx) => (
                            <li
                              key={idx}
                              className="text-sm text-blue-700 flex items-start gap-2"
                            >
                              <span className="text-blue-400 mt-0.5">→</span>
                              {action}
                            </li>
                          )
                        )}
                      </ul>
                    ) : (
                      <p className="text-sm text-blue-600 italic">
                        No additional recommendations
                      </p>
                    )}
                  </div>

                  {/* Avoid */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h3 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-red-500 rounded-full" />
                      Avoid
                    </h3>
                    {analysis.recommended_actions.avoid.length > 0 ? (
                      <ul className="space-y-2">
                        {analysis.recommended_actions.avoid.map(
                          (action, idx) => (
                            <li
                              key={idx}
                              className="text-sm text-red-700 flex items-start gap-2"
                            >
                              <span className="text-red-400 mt-0.5">✕</span>
                              {action}
                            </li>
                          )
                        )}
                      </ul>
                    ) : (
                      <p className="text-sm text-red-600 italic">
                        No specific warnings
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 7: ASSUMPTIONS & LIMITS (COLLAPSIBLE)                 */}
              {/* - Low visual priority                                       */}
              {/* - Sets expectations and protects trust                      */}
              {/* ─────────────────────────────────────────────────────────── */}
              <details className="bg-gray-50 border rounded-xl shadow-sm group">
                <summary className="px-6 py-4 cursor-pointer list-none flex items-center justify-between hover:bg-gray-100 rounded-xl transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500">⚠</span>
                    <h2 className="text-sm font-medium text-gray-700">
                      Assumptions & Limits
                    </h2>
                    <span className="text-xs text-gray-400">
                      ({analysis.assumptions_and_limits.length} items)
                    </span>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-400 transform group-open:rotate-180 transition-transform"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-6 pb-4">
                  <p className="text-xs text-gray-500 mb-3">
                    This analysis is based on available data. The following limitations apply:
                  </p>
                  <ul className="space-y-2">
                    {analysis.assumptions_and_limits.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-gray-600 text-sm"
                      >
                        <span className="text-gray-400 mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>

              {/* Spacer for scrolling past chat sidebar */}
              <div className="h-8" />
              </>
              )}
            </div>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* RIGHT COLUMN: AI CHAT SIDEBAR (~30%)                            */}
        {/* BLOCK 10: This is the PRODUCT, not a helper                     */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <ChatSidebar
          analysisRunId={analysis?.analysis_run_id || null}
          initialMessages={chatMessages}
          onMessagesChange={setChatMessages}
        />
      </div>
    </div>
  );
}
