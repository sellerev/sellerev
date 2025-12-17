"use client";

import { useState, useRef, useEffect } from "react";

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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
  // Optional: Rainforest market data (when available)
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
// SUGGESTED QUESTIONS (shown after analysis)
// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "Help me calculate potential margins",
  "What would change this verdict?",
  "Compare to the top competitor",
  "Explain the main risks in detail",
  "What differentiation strategies could work?",
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface AnalyzeFormProps {
  // Initial analysis to display (when loading from history)
  initialAnalysis?: AnalysisResponse | null;
  // Initial chat messages (when loading from history)
  initialMessages?: ChatMessage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function AnalyzeForm({
  initialAnalysis = null,
  initialMessages = [],
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

  // Analysis state - initialize with provided analysis if available
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(
    initialAnalysis
  );

  // Chat state - initialize with provided messages if available
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────────────────────

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatLoading]);

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
    setMessages([]); // Clear previous chat

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_type: inputType,
          input_value: inputValue.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setAnalysis(data.data);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Analysis failed";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async (messageOverride?: string) => {
    const messageToSend = messageOverride || chatInput.trim();
    if (!messageToSend || !analysis) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: messageToSend,
    };

    setMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_run_id: analysis.analysis_run_id,
          message: messageToSend,
          history: messages, // Send conversation history
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Chat failed");
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.data.message,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Chat failed";
      // Add error message to chat
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${errorMessage}. Please try again.`,
        },
      ]);
    } finally {
      setChatLoading(false);
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
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="border-b bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex gap-3 items-end">
            {/* Input Type Toggle */}
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Type
              </label>
              <div className="flex border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className={`flex-1 py-2 px-3 text-sm font-medium transition-colors ${
                    inputType === "asin"
                      ? "bg-black text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                  onClick={() => setInputType("asin")}
                  disabled={loading}
                >
                  ASIN
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 px-3 text-sm font-medium transition-colors ${
                    inputType === "keyword"
                      ? "bg-black text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                  onClick={() => setInputType("keyword")}
                  disabled={loading}
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
                }`}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setInputError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) {
                    analyze();
                  }
                }}
                disabled={loading}
                placeholder={
                  inputType === "asin"
                    ? "e.g., B0CHX3PNKD"
                    : "e.g., yoga mat, wireless earbuds"
                }
              />
              {inputError && (
                <p className="text-red-600 text-xs mt-1">{inputError}</p>
              )}
            </div>

            {/* Analyze Button */}
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
          </div>

          {/* Global Error */}
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
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
            /* POST-ANALYSIS STATE: ALL BLOCKS */
            <div className="p-6 space-y-6 max-w-4xl">
              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 3: DECISION HEADER (ABOVE THE FOLD)                   */}
              {/* Verdict does not change unless explicitly revised in chat   */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-4 mb-4">
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
                <p className="text-sm text-gray-500 italic">
                  Decision support, not a guarantee
                </p>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 2: MARKET SNAPSHOT (DATA-FIRST)                       */}
              {/* Shows exact data the AI is using - builds trust             */}
              {/* NO revenue estimates, NO sales projections                  */}
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

                {analysis.market_data &&
                Object.keys(analysis.market_data).length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {analysis.market_data.average_price !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-1">
                          Average Price
                        </div>
                        <div className="text-lg font-semibold">
                          {formatCurrency(analysis.market_data.average_price)}
                        </div>
                      </div>
                    )}

                    {(analysis.market_data.price_min !== undefined ||
                      analysis.market_data.price_max !== undefined) && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-1">
                          Price Range
                        </div>
                        <div className="text-lg font-semibold">
                          {analysis.market_data.price_min !== undefined
                            ? formatCurrency(analysis.market_data.price_min)
                            : "—"}{" "}
                          –{" "}
                          {analysis.market_data.price_max !== undefined
                            ? formatCurrency(analysis.market_data.price_max)
                            : "—"}
                        </div>
                      </div>
                    )}

                    {analysis.market_data.review_count_avg !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-1">
                          Avg Reviews
                        </div>
                        <div className="text-lg font-semibold">
                          {analysis.market_data.review_count_avg.toLocaleString()}
                        </div>
                      </div>
                    )}

                    {analysis.market_data.average_rating !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-1">
                          Avg Rating
                        </div>
                        <div className="text-lg font-semibold">
                          {analysis.market_data.average_rating.toFixed(1)} ★
                        </div>
                      </div>
                    )}

                    {analysis.market_data.competitor_count !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-1">
                          Competitors
                        </div>
                        <div className="text-lg font-semibold">
                          {analysis.market_data.competitor_count}
                        </div>
                      </div>
                    )}

                    {analysis.market_data.top_asins &&
                      analysis.market_data.top_asins.length > 0 && (
                        <div className="bg-gray-50 rounded-lg p-3 col-span-2 md:col-span-1">
                          <div className="text-xs text-gray-500 mb-1">
                            Top ASINs
                          </div>
                          <div className="text-sm font-mono">
                            {analysis.market_data.top_asins
                              .slice(0, 3)
                              .join(", ")}
                          </div>
                        </div>
                      )}
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <p className="text-gray-500 text-sm">
                      No market data available for this analysis.
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      AI reasoning is based on general market knowledge.
                    </p>
                  </div>
                )}
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 4: EXECUTIVE SUMMARY                                  */}
              {/* Explains WHY the verdict exists                             */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  Executive Summary
                </h2>
                <p className="text-gray-700 leading-relaxed">
                  {analysis.executive_summary}
                </p>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 5: REASONING (PRIMARY FACTORS)                        */}
              {/* Exposes decision logic with seller context impact           */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Reasoning
                </h2>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-600 mb-2">
                      Primary Factors
                    </h3>
                    <ul className="space-y-2">
                      {analysis.reasoning.primary_factors.map((factor, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-gray-400 mt-1">•</span>
                          <span className="text-gray-700">{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-3 border-t">
                    <h3 className="text-sm font-medium text-gray-600 mb-2">
                      Seller Context Impact
                    </h3>
                    <p className="text-gray-700 bg-blue-50 border border-blue-100 rounded-lg p-3">
                      {analysis.reasoning.seller_context_impact}
                    </p>
                  </div>
                </div>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 6: RISK BREAKDOWN (GRID)                              */}
              {/* Fixed categories: Competition, Pricing, Differentiation,    */}
              {/* Operations. No numeric scoring, no hidden weighting.        */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Risk Breakdown
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(
                    Object.entries(analysis.risks) as [
                      string,
                      RiskLevel
                    ][]
                  ).map(([category, risk]) => (
                    <div
                      key={category}
                      className={`border rounded-lg p-4 ${getRiskLevelStyles(
                        risk.level
                      )}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium capitalize">{category}</h3>
                        <span
                          className={`text-xs font-bold px-2 py-1 rounded ${
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
                      <p className="text-sm opacity-90">{risk.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 7: RECOMMENDED ACTIONS                                */}
              {/* Three columns: Must Do, Should Do, Avoid                    */}
              {/* Actions realistic for seller stage, no generic advice       */}
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
              {/* BLOCK 8: ASSUMPTIONS & LIMITS (MANDATORY)                   */}
              {/* Sets expectations and protects trust                        */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  Assumptions & Limits
                </h2>
                <p className="text-xs text-gray-500 mb-4">
                  This analysis is based on available data. The following
                  limitations apply:
                </p>

                <ul className="space-y-2">
                  {analysis.assumptions_and_limits.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-gray-600 text-sm"
                    >
                      <span className="text-amber-500 mt-0.5">⚠</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 9: DATA SOURCES FOOTER                                */}
              {/* Reinforces credibility                                      */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-gray-100 border rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-600 mb-3">
                  Data Sources
                </h3>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    {analysis.market_data &&
                    Object.keys(analysis.market_data).length > 0 ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-400">○</span>
                    )}
                    <span
                      className={
                        analysis.market_data &&
                        Object.keys(analysis.market_data).length > 0
                          ? "text-gray-700"
                          : "text-gray-400"
                      }
                    >
                      Rainforest market data
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✓</span>
                    <span className="text-gray-700">Seller profile context</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">○</span>
                    <span className="text-gray-400">
                      Amazon SP-API not connected
                    </span>
                  </div>
                </div>
              </div>

              {/* Spacer for scrolling past chat sidebar */}
              <div className="h-8" />
            </div>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* RIGHT COLUMN: AI CHAT SIDEBAR (~30%)                            */}
        {/* BLOCK 10: This is the PRODUCT, not a helper                     */}
        {/* - Always visible after analysis                                 */}
        {/* - Anchored to this analysis only                                */}
        {/* - Cannot fetch new data, cannot invent metrics                  */}
        {/* - Cannot silently override verdict                              */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div
          className="border-l bg-white flex flex-col"
          style={{ width: "30%", minWidth: "320px" }}
        >
          {/* Chat Header */}
          <div className="p-4 border-b bg-gray-50">
            <h2 className="font-semibold text-gray-900">AI Assistant</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {analysis
                ? "Ask questions about this analysis"
                : "Complete an analysis to start chatting"}
            </p>
          </div>

          {/* Chat Messages Area */}
          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50"
          >
            {!analysis ? (
              /* Pre-analysis: Show capabilities */
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto mb-3 bg-gray-200 rounded-full flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">
                  The AI assistant will help you:
                </p>
                <ul className="text-xs text-gray-400 mt-2 space-y-1">
                  <li>• Explain the verdict</li>
                  <li>• Run what-if scenarios</li>
                  <li>• Calculate margins</li>
                  <li>• Compare competitors</li>
                </ul>
              </div>
            ) : messages.length === 0 ? (
              /* Post-analysis, no messages yet: Show suggested questions */
              <div className="space-y-3">
                <p className="text-xs text-gray-500 text-center">
                  Suggested questions:
                </p>
                {SUGGESTED_QUESTIONS.map((question, idx) => (
                  <button
                    key={idx}
                    className="w-full text-left text-sm p-3 bg-white border rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-700"
                    onClick={() => sendChatMessage(question)}
                    disabled={chatLoading}
                  >
                    {question}
                  </button>
                ))}
              </div>
            ) : (
              /* Chat messages */
              <>
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-black text-white ml-6"
                        : "bg-white border mr-6"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium mb-1 ${
                        msg.role === "user" ? "text-gray-300" : "text-gray-500"
                      }`}
                    >
                      {msg.role === "user" ? "You" : "Sellerev"}
                    </div>
                    <div
                      className={`text-sm whitespace-pre-wrap ${
                        msg.role === "user" ? "" : "text-gray-700"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {/* Loading indicator */}
                {chatLoading && (
                  <div className="bg-white border rounded-lg p-3 mr-6">
                    <div className="text-xs font-medium mb-1 text-gray-500">
                      Sellerev
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                      <span
                        className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <span
                        className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </div>
                  </div>
                )}

                {/* Scroll anchor */}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* Chat Input */}
          <div className="p-4 border-t bg-white">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !chatLoading && chatInput.trim() && analysis) {
                    sendChatMessage();
                  }
                }}
                placeholder={analysis ? "Ask about the analysis..." : "Run an analysis first"}
                disabled={!analysis || chatLoading}
              />
              <button
                className="bg-black text-white rounded-lg px-4 py-2 font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={() => sendChatMessage()}
                disabled={!analysis || !chatInput.trim() || chatLoading}
              >
                Send
              </button>
            </div>
            {analysis && (
              <p className="text-xs text-gray-400 mt-2 text-center">
                Chat is grounded to this analysis only
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
