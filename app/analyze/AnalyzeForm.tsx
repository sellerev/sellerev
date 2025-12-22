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
  confidence_downgrades?: string[]; // Reasons why confidence was reduced
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
  // Represents Page 1 results only
  margin_snapshot?: {
    mode: "ASIN" | "KEYWORD";
    confidence_tier: "ESTIMATED" | "REFINED" | "EXACT";
    confidence_reason: string;
    assumed_price: number;
    price_source: "asin_price" | "page1_avg" | "fallback";
    estimated_cogs_min: number | null;
    estimated_cogs_max: number | null;
    cogs_source: "assumption_engine" | "user_override" | "exact";
    estimated_fba_fee: number | null;
    fba_fee_source: "sp_api" | "category_estimate" | "unknown";
    net_margin_min_pct: number | null;
    net_margin_max_pct: number | null;
    breakeven_price_min: number | null;
    breakeven_price_max: number | null;
    assumptions: string[];
  };
  market_snapshot?: {
    keyword: string;
    avg_price: number | null;
    avg_reviews: number | null;
    avg_rating: number | null;
    total_page1_listings: number; // Only Page 1 listings
    sponsored_count: number;
    dominance_score: number; // 0-100, % of listings belonging to top brand
    representative_asin?: string | null; // Optional representative ASIN for fee estimation
    // Page 1 product listings (for data-first display)
    listings?: Array<{
      asin: string | null;
      title: string | null;
      price: number | null;
      rating: number | null;
      reviews: number | null;
      is_sponsored: boolean;
      position: number;
      brand: string | null;
      image_url?: string | null;
      est_monthly_revenue?: number | null;
      est_monthly_units?: number | null;
      revenue_confidence?: "low" | "medium";
    }>;
    est_total_monthly_revenue_min?: number | null;
    est_total_monthly_revenue_max?: number | null;
    est_total_monthly_units_min?: number | null;
    est_total_monthly_units_max?: number | null;
    // Search volume estimation (modeled, not exact)
    search_demand?: {
      search_volume_range: string; // e.g., "10k–20k"
      search_volume_confidence: "low" | "medium";
    } | null;
    // Competitive Pressure Index (CPI) - seller-context aware, 0-100
    // Computed once per analysis, cached, immutable
    cpi?: {
      score: number; // 0-100
      label: string; // "Low — structurally penetrable" | "Moderate — requires differentiation" | "High — strong incumbents" | "Extreme — brand-locked"
      breakdown: {
        review_dominance: number; // 0-30 points
        brand_concentration: number; // 0-25 points
        sponsored_saturation: number; // 0-20 points
        price_compression: number; // 0-15 points
        seller_fit_modifier: number; // -10 to +10 points
      };
    } | null;
    // FBA fee estimate (from SP-API or estimated)
    // New structure (from resolveFbaFees):
    fba_fees?: {
      fulfillment_fee: number | null;
      referral_fee: number | null;
      total_fba_fees: number | null;
      source: "amazon";
    } | {
      // Legacy structure (for backward compatibility with keyword analysis)
      total_fee: number | null;
      source: "sp_api" | "estimated";
      asin_used: string;
      price_used: number;
    } | null;
    // Margin snapshot (calculated from COGS assumptions and FBA fees)
    margin_snapshot?: {
      selling_price: number;
      cogs_assumed_low: number;
      cogs_assumed_high: number;
      fba_fees: number | null;
      net_margin_low_pct: number;
      net_margin_high_pct: number;
      breakeven_price_low: number;
      breakeven_price_high: number;
      confidence: "estimated" | "refined";
      source: "assumption_engine" | "amazon_fees";
    } | null;
  } | null;
  // Optional: User-refined costs (added after initial analysis)
  cost_overrides?: {
    cogs: number | null;
    fba_fees: number | null;
    last_updated: string; // ISO timestamp
    source: "user";
  };
  // Optional: ASIN-specific product data (when input_type === "asin")
  asin_snapshot?: {
    asin: string;
    price: number | null;
    rating: number | null;
    reviews: number | null;
    bsr: number | null; // Primary category BSR
    fulfillment: "FBA" | "FBM" | "Amazon" | null;
    brand_owner: "Amazon" | "Brand" | "Unknown" | null;
    // Relative positioning vs Page 1 (percentiles)
    position_vs_page1?: {
      price_percentile: number | null; // 0-100, lower = cheaper
      review_percentile: number | null; // 0-100, higher = more reviews
      rating_percentile: number | null; // 0-100, higher = better rating
      brand_context: string | null; // "Brand-led niche" | "Fragmented niche"
    } | null;
    // ASIN Competitive Pressure Score (1-10, replaces CPI for ASIN)
    pressure_score?: {
      score: number; // 1-10
      label: "Low" | "Moderate" | "High";
      explanation: string;
    } | null;
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

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || typeof value !== 'number' || isNaN(value)) {
    return "—";
  }
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
// MARKET SNAPSHOT INTERPRETATIONS
// ─────────────────────────────────────────────────────────────────────────────


/**
 * Estimate monthly revenue for a product based on price and reviews
 * Uses a conservative heuristic: reviews as proxy for demand
 */
function estimateMonthlyRevenue(price: number | null, reviews: number | null): number | null {
  if (price === null || price <= 0) return null;
  if (reviews === null || reviews <= 0) return null;
  
  // Conservative estimate: assume ~1-2% conversion rate from reviews to monthly sales
  // Scale by review count (more reviews = more sales)
  const estimatedMonthlyUnits = Math.max(10, Math.floor(reviews * 0.01));
  return price * estimatedMonthlyUnits;
}

/**
 * Calculate average BSR from listings (if available)
 * Currently returns null as BSR not in ParsedListing interface
 */
function calculateAvgBSR(listings: Array<any>): number | null {
  // BSR not available in current ParsedListing structure
  // Return null as specified in requirements
  return null;
}

/**
 * Calculate 30-day revenue estimate (sum of all page-1 product revenues)
 */
function calculate30DayRevenue(listings: Array<{ price: number | null; reviews: number | null }>): number | null {
  const revenues = listings
    .map(l => estimateMonthlyRevenue(l.price, l.reviews))
    .filter((r): r is number => r !== null);
  
  if (revenues.length === 0) return null;
  return revenues.reduce((sum, r) => sum + r, 0);
}

/**
 * Calculate 30-day units sold estimate (sum of all page-1 product units)
 */
function calculate30DayUnits(listings: Array<{ price: number | null; reviews: number | null }>): number | null {
  const units = listings
    .map(l => {
      if (l.reviews === null || l.reviews <= 0) return null;
      return Math.max(10, Math.floor(l.reviews * 0.01));
    })
    .filter((u): u is number => u !== null);
  
  if (units.length === 0) return null;
  return units.reduce((sum, u) => sum + u, 0);
}

/**
 * Calculate fulfillment mix (FBA / FBM / Amazon %)
 * Currently simplified as fulfillment data not in ParsedListing
 */
function calculateFulfillmentMix(listings: Array<any>): {
  fba: number;
  fbm: number;
  amazon: number;
} {
  // Placeholder - fulfillment data not available in current structure
  // Return defaults for now (will show "—" in UI)
  return { fba: 0, fbm: 0, amazon: 0 };
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
  
  // PART G: margin_snapshot is already at top level, no normalization needed
  
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

  // Handler for margin snapshot updates from chat (Part G structure)
  const handleMarginSnapshotUpdate = (updatedSnapshot: AnalysisResponse['margin_snapshot']) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      
      return {
        ...prev,
        margin_snapshot: updatedSnapshot,
      };
    });
  };

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
      // FIX FRONTEND STATE: Ensure listings are preserved
      // Check for market_snapshot from keywordMarket (new structure at top level) or decision.market_snapshot
      const keywordMarketSnapshot = (data as any).market_snapshot;
      const decisionMarketSnapshot = data.decision.market_snapshot || null;
      const preservedMarketSnapshot = keywordMarketSnapshot || decisionMarketSnapshot;
      
      // Preserve listings array if it exists - do NOT strip it
      if (preservedMarketSnapshot && typeof preservedMarketSnapshot === 'object' && !Array.isArray(preservedMarketSnapshot)) {
        // Ensure listings array is preserved
        if (!preservedMarketSnapshot.listings || !Array.isArray(preservedMarketSnapshot.listings)) {
          // Try to get listings from products (contract structure) or legacy listings
          if ((data as any).products && Array.isArray((data as any).products)) {
            preservedMarketSnapshot.listings = (data as any).products;
          } else if (decisionMarketSnapshot && (decisionMarketSnapshot as any).listings) {
            preservedMarketSnapshot.listings = (decisionMarketSnapshot as any).listings;
          } else {
            preservedMarketSnapshot.listings = [];
          }
        }
      }
      
      // Extract asin_snapshot from decision if present
      const asinSnapshot = data.decision.asin_snapshot || null;
      
      // PART G: Extract margin_snapshot from decision (first-class feature)
      const marginSnapshot = data.decision.margin_snapshot || null;
      
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
        market_snapshot: preservedMarketSnapshot && typeof preservedMarketSnapshot === 'object' && !Array.isArray(preservedMarketSnapshot) 
          ? preservedMarketSnapshot 
          : null,
        market_data: data.decision.market_data,
        asin_snapshot: asinSnapshot && typeof asinSnapshot === 'object' && !Array.isArray(asinSnapshot) && asinSnapshot !== null
          ? asinSnapshot
          : null,
        margin_snapshot: marginSnapshot && typeof marginSnapshot === 'object' && !Array.isArray(marginSnapshot) && marginSnapshot !== null
          ? marginSnapshot
          : undefined,
      };
      
      // Log market snapshot counts for debugging
      console.log("UI_MARKET_SNAPSHOT_COUNTS", {
        listings: analysisData?.market_snapshot?.listings?.length || 0,
        sponsored: analysisData?.market_snapshot?.sponsored_count || 0,
        total: analysisData?.market_snapshot?.total_page1_listings || 0,
      });

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
  // ANALYSIS MODE DERIVATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Derive analysis mode from input_type
   * - input_type === 'asin' → analysisMode = 'ASIN'
   * - input_type === 'keyword' → analysisMode = 'KEYWORD'
   */
  const analysisMode: 'ASIN' | 'KEYWORD' | null = analysis 
    ? (analysis.input_type === 'asin' ? 'ASIN' : 'KEYWORD')
    : null;

  // Defensive assertion: Ensure analysisMode matches input_type
  if (analysis && process.env.NODE_ENV === 'development') {
    const expectedMode = analysis.input_type === 'asin' ? 'ASIN' : 'KEYWORD';
    if (analysisMode !== expectedMode) {
      console.error('Analysis mode mismatch:', { 
        input_type: analysis.input_type, 
        analysisMode, 
        expectedMode 
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UI HELPERS
  // ─────────────────────────────────────────────────────────────────────────


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
              {/* POST-ANALYSIS STATE: DATA-FIRST LAYOUT                        */}
              {/* Order: Page-1 Data → Decision → Summary → Risks → Actions → Limits */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* Defensive invariant: ensure analysis and decision exist */}
              {!analysis || !analysis.decision ? null : (
              <>
              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* KEYWORD MODE UI STRUCTURE (DATA-FIRST)                         */}
              {/* ────────────────────────────────────────────────────────────── */}
              {/* DATA-FIRST UI ORDER (NO OPINIONS):                           */}
              {/* 1. MARKET SCOPE HEADER (Marketplace, Search Type, Input)     */}
              {/* 2. TOP METRICS BAR (Revenue, Units, Price, Rating, etc.)     */}
              {/* 3. PAGE-1 PRODUCTS TABLE (Always visible, immutable)         */}
              {/* 4. MARKET BREAKDOWN (Descriptive only - no interpretations) */}
              {/* 5. MARGIN SNAPSHOT (Clearly labeled as estimated)          */}
              {/* ────────────────────────────────────────────────────────────── */}
              {/* PART B — SQP INTEGRATION ROADMAP (DOCUMENTED, NOT BUILT YET): */}
              {/* ────────────────────────────────────────────────────────────── */}
              {/* SQP (Search Query Performance) will integrate when:           */}
              {/* - Seller connects SP-API                                      */}
              {/* - Amazon approves Search Query Performance scope              */}
              {/*                                                               */}
              {/* SQP will REPLACE (data source swap, UI stays identical):      */}
              {/* - search_volume_range (from searchVolumeEstimator)            */}
              {/* - search_volume_confidence (demand confidence)                */}
              {/*                                                               */}
              {/* SQP will NOT replace (these remain unchanged):                */}
              {/* - CPI (Competitive Pressure Index)                            */}
              {/* - Brand dominance                                             */}
              {/* - Review moat                                                 */}
              {/*                                                               */}
              {/* RULE: Do not block keyword analysis if SQP is unavailable.    */}
              {/*       Fallback to current searchVolumeEstimator logic.        */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              
              {/* ─────────────────────────────────────────────────────────── */}
              {/* SECTION 1: TOP SUMMARY BAR (KEYWORD MODE)                    */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === 'KEYWORD' && analysis.market_snapshot && (() => {
                const snapshot = analysis.market_snapshot;
                const listings = snapshot.listings || [];
                
                // Use aggregated revenue/units estimates from snapshot (computed in backend)
                const total30DayRevenueMin = snapshot.est_total_monthly_revenue_min ?? null;
                const total30DayRevenueMax = snapshot.est_total_monthly_revenue_max ?? null;
                const total30DayUnitsMin = snapshot.est_total_monthly_units_min ?? null;
                const total30DayUnitsMax = snapshot.est_total_monthly_units_max ?? null;
                
                const avgPrice = snapshot.avg_price;
                const avgRating = snapshot.avg_rating;
                const searchVolume = snapshot.search_demand?.search_volume_range ?? null;
                const searchVolumeConfidence = snapshot.search_demand?.search_volume_confidence ?? null;
                
                return (
                  <div className="bg-white border rounded-xl p-6 shadow-sm">
                    <div className="grid grid-cols-7 gap-4">
                      {/* Market Label */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">Market</div>
                        <div className="text-lg font-semibold text-gray-900">
                          Amazon.com (US)
                        </div>
                      </div>
                      {/* Search Volume (est.) */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1 flex items-center justify-center gap-1">
                          Search Volume (est.)
                          <div className="relative group">
                            <svg 
                              className="w-3 h-3 text-gray-400 cursor-help" 
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 w-64 text-center">
                              Estimated using Page-1 saturation and category benchmarks. Not Amazon-reported.
                            </div>
                          </div>
                        </div>
                        <div className="text-lg font-semibold text-gray-900">
                          {searchVolume || "—"}
                        </div>
                      </div>
                      {/* 30-Day Revenue (est.) - Range */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">30-Day Revenue (est.)</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {total30DayRevenueMin !== null && total30DayRevenueMax !== null
                            ? `${formatCurrency(total30DayRevenueMin)}–${formatCurrency(total30DayRevenueMax)}`
                            : "—"}
                        </div>
                      </div>
                      {/* 30-Day Units Sold (est.) - Range */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">30-Day Units Sold (est.)</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {total30DayUnitsMin !== null && total30DayUnitsMax !== null
                            ? `${total30DayUnitsMin.toLocaleString()}–${total30DayUnitsMax.toLocaleString()}`
                            : "—"}
                        </div>
                      </div>
                      {/* Avg Price */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">Avg Price</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {avgPrice !== null ? formatCurrency(avgPrice) : "—"}
                        </div>
                      </div>
                      {/* Avg Rating */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">Avg Rating</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {avgRating !== null && typeof avgRating === 'number' && !isNaN(avgRating)
                            ? `${avgRating.toFixed(1)} ★`
                            : "—"}
                        </div>
                      </div>
                      {/* Confidence % */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">Confidence</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {analysis?.decision?.confidence !== undefined && analysis.decision.confidence !== null
                            ? `${analysis.decision.confidence}%`
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ─────────────────────────────────────────────────────────── */}
              {/* SECTION 2: PAGE-1 PRODUCTS TABLE (PRIMARY SURFACE - ALWAYS VISIBLE) */}
              {/* ─────────────────────────────────────────────────────────── */}
              {/* ENFORCE DATA-FIRST RENDER ORDER: Table must render in KEYWORD mode */}
              {analysisMode === 'KEYWORD' && analysis.market_snapshot && (() => {
                const snapshot = analysis.market_snapshot;
                const listings = snapshot.listings || [];
                
                // HARD UI ASSERTION: If KEYWORD mode AND market_snapshot exists AND listings length > 0, table MUST render
                if (analysisMode === 'KEYWORD' && snapshot && listings.length > 0) {
                  // Table will render below - this is just the assertion
                } else if (analysisMode === 'KEYWORD' && snapshot && listings.length === 0) {
                  // Empty state - still render table
                }
                
                // Use revenue estimates from backend (already computed in keywordMarket.ts)
                // Sort by estimated revenue (desc)
                // FIX FILTERING: Minimal acceptance rule - accept if asin + title exist
                // Price/rating/reviews/image can be null
                const listingsWithRevenue = [...listings]
                  .filter((l: any) => {
                    // Minimal acceptance: asin + title required
                    // Everything else can be null
                    return l && (l.asin || l.ASIN) && (l.title || l.Title);
                  })
                  .map((l: any) => ({
                    // Normalize field names (handle both new contract and legacy)
                    asin: l.asin || l.ASIN || "",
                    title: l.title || l.Title || "",
                    brand: l.brand || l.Brand || null,
                    price: l.price || l.Price || null,
                    rating: l.rating || l.Rating || null,
                    reviews: l.reviews || l.Reviews || l.review_count || null,
                    image: l.image || l.image_url || l.Image || null,
                    is_sponsored: l.is_sponsored || l.IsSponsored || false,
                    revenue_est: l.revenue_est || l.est_monthly_revenue || null,
                    units_est: l.units_est || l.est_monthly_units || null,
                    revenue_share: l.revenue_share || null,
                  }))
                  .sort((a: any, b: any) => {
                    const revA = a.revenue_est || 0;
                    const revB = b.revenue_est || 0;
                    return revB - revA;
                  });
                
                // Use aggregated totals from snapshot, or calculate from listings as fallback
                const totalPage1RevenueMin = snapshot.est_total_monthly_revenue_min ?? null;
                const totalPage1RevenueMax = snapshot.est_total_monthly_revenue_max ?? null;
                const totalPage1Revenue = totalPage1RevenueMax ?? 
                  listingsWithRevenue
                    .map((l: any) => l.revenue_est || l.est_monthly_revenue)
                    .filter((r): r is number => r !== null && r !== undefined)
                    .reduce((sum: number, r: number) => sum + r, 0);
                
                // Calculate revenue share for each listing
                const listingsWithShare = listingsWithRevenue.map((listing: any) => {
                  const revenue = listing.revenue_est || listing.est_monthly_revenue || 0;
                  const revenueShare = revenue && totalPage1Revenue && totalPage1Revenue > 0
                    ? (revenue / totalPage1Revenue) * 100
                    : 0;
                  return { ...listing, revenueShare };
                });
                
                return (
                  <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b bg-gray-50">
                      <h2 className="text-lg font-semibold text-gray-900">Page-1 Products</h2>
                      <p className="text-xs text-gray-500 mt-1">Sorted by estimated revenue</p>
                    </div>
                    <div className="overflow-x-auto">
                      {listingsWithShare.length === 0 ? (
                        <div className="p-8 text-center">
                          <p className="font-semibold text-gray-900 mb-2">
                            No Page-1 products parsed.
                          </p>
                          <p className="text-sm text-gray-600">
                            This usually means parsing/filtering removed all results. See console KEYWORD_SNAPSHOT_EMPTY.
                          </p>
                        </div>
                      ) : (
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rating</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Reviews</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Est. Monthly Revenue</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue Share</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {listingsWithShare.slice(0, 48).map((listing: any, idx: number) => {
                              // Get image from new structure (image) or legacy (image_url)
                              const imageUrl = listing.image || listing.image_url || null;
                              
                              return (
                                <tr key={`${listing.asin || 'unknown'}-${idx}`} className="hover:bg-gray-50">
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-3 min-w-[300px]">
                                      {/* Product image - use Next/Image if available, otherwise plain img */}
                                      {imageUrl ? (
                                        <img
                                          src={imageUrl}
                                          alt={listing.title || "Product image"}
                                          className="w-12 h-12 object-cover rounded flex-shrink-0"
                                          loading="lazy"
                                          onError={(e) => {
                                            // Replace with placeholder on error
                                            const img = e.target as HTMLImageElement;
                                            const placeholder = document.createElement('div');
                                            placeholder.className = 'w-12 h-12 bg-gray-200 rounded flex items-center justify-center flex-shrink-0';
                                            placeholder.innerHTML = '<span class="text-xs text-gray-400">IMG</span>';
                                            img.replaceWith(placeholder);
                                          }}
                                        />
                                      ) : (
                                        <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                                          <span className="text-xs text-gray-400">IMG</span>
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">
                                          {listing.title || "—"}
                                        </div>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                          {listing.asin || "—"}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-900">
                                    {listing.price !== null && listing.price !== undefined ? formatCurrency(listing.price) : "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-900">
                                    {listing.rating !== null && typeof listing.rating === 'number' && !isNaN(listing.rating)
                                      ? `${listing.rating.toFixed(1)} ★`
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-900">
                                    {listing.reviews !== null && listing.reviews !== undefined
                                      ? listing.reviews.toLocaleString()
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                                    {listing.revenue_est !== null && listing.revenue_est !== undefined
                                      ? `${formatCurrency(listing.revenue_est)} (est.)`
                                      : listing.est_monthly_revenue !== null && listing.est_monthly_revenue !== undefined
                                      ? `${formatCurrency(listing.est_monthly_revenue)} (est.)`
                                      : "—"}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                                    <div className="flex items-center justify-end gap-2">
                                      <span>{listing.revenueShare > 0 ? `${listing.revenueShare.toFixed(1)}%` : "—"}</span>
                                      {listing.revenueShare > 0 && (
                                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                          <div 
                                            className="h-full bg-blue-600 rounded-full"
                                            style={{ width: `${Math.min(listing.revenueShare, 100)}%` }}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              {/* HARD UI ASSERTION: Log if table should render but doesn't */}
              {analysisMode === 'KEYWORD' && analysis.market_snapshot && (() => {
                const listingsLen = analysis.market_snapshot?.listings?.length || 0;
                if (listingsLen > 0) {
                  // Table should render above - this assertion runs after render
                  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
                    // Check if table element exists in DOM (deferred check)
                    setTimeout(() => {
                      const tableExists = document.querySelector('table');
                      if (!tableExists && listingsLen > 0) {
                        console.error("UI_TABLE_NOT_RENDERED_BUG", {
                          analysisMode,
                          listingsLen,
                          hasMarketSnapshot: !!analysis.market_snapshot,
                        });
                      }
                    }, 100);
                  }
                }
                return null;
              })()}

              {/* ─────────────────────────────────────────────────────────── */}
              {/* KEYWORD MODE: MARKET BREAKDOWN                              */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === 'KEYWORD' && analysis.market_snapshot && (() => {
                const snapshot = analysis.market_snapshot;
                const listings = snapshot.listings || [];
                const fulfillmentMix = calculateFulfillmentMix(listings);
                
                // Calculate brand dominance (top brand %)
                const brandCounts: Record<string, number> = {};
                listings.forEach(l => {
                  if (l.brand) {
                    brandCounts[l.brand] = (brandCounts[l.brand] || 0) + 1;
                  }
                });
                const topBrands = Object.entries(brandCounts)
                  .map(([brand, count]) => ({ brand, count }))
                  .sort((a, b) => b.count - a.count);
                const brandDominance = topBrands.length > 0 && listings.length > 0
                  ? (topBrands[0].count / listings.length) * 100
                  : snapshot.dominance_score || 0;
                
                return (
                  <div className="bg-white border rounded-xl p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Market Breakdown</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {/* Brand Dominance */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Brand Dominance</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {brandDominance > 0 ? `${Math.round(brandDominance)}%` : "—"}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Top brand % share on Page-1
                        </div>
                      </div>
                      {/* Fulfillment Mix */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Fulfillment Mix</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {fulfillmentMix.fba > 0 || fulfillmentMix.fbm > 0 
                            ? `FBA ${fulfillmentMix.fba}% / FBM ${fulfillmentMix.fbm}%`
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          FBA / FBM / Amazon %
                        </div>
                      </div>
                      {/* Page-1 Density */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Page-1 Density</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {snapshot.total_page1_listings || 0}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Count of Page-1 listings
                        </div>
                      </div>
                      {/* Sponsored Presence */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Sponsored Presence</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {snapshot.sponsored_count !== undefined && snapshot.sponsored_count !== null
                            ? `${snapshot.sponsored_count}`
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Sponsored listings on Page-1
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ─────────────────────────────────────────────────────────── */}
              {/* ASIN MODE: ASIN SNAPSHOT (SINGLE-PRODUCT COMPETITIVE ANALYSIS) */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === 'ASIN' && analysis.asin_snapshot && (() => {
                // Defensive assert: ASIN mode must never reference Page-1 averages for display
                // (Note: margin_snapshot may use avg_price for calculations, but ASIN snapshot display should use ASIN-specific data)
                if (process.env.NODE_ENV === 'development') {
                  if (analysis.market_snapshot && 
                      (analysis.market_snapshot.avg_price !== null || 
                       analysis.market_snapshot.avg_reviews !== null ||
                       analysis.market_snapshot.dominance_score !== undefined)) {
                    // This is acceptable for margin calculations, but ASIN snapshot display should not reference these
                    // Only warn if we're trying to display Page-1 averages in ASIN mode
                  }
                }
                
                const asinData = analysis.asin_snapshot;
                const pressure = asinData.pressure_score;
                
                
                
                return (
                  <div className="bg-white border rounded-xl p-6 shadow-sm">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">
                        ASIN Snapshot
                      </h2>
                      <p className="text-xs text-gray-500">
                        Product data for this ASIN
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Review Count */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Review Count</div>
                        <div className="text-lg font-semibold text-gray-900 mb-1">
                          {asinData.reviews !== null && typeof asinData.reviews === 'number'
                            ? asinData.reviews.toLocaleString()
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          Total reviews for this ASIN
                        </div>
                      </div>
                      
                      {/* Rating Strength */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Rating Strength</div>
                        <div className="text-lg font-semibold text-gray-900 mb-1">
                          {asinData.rating !== null && typeof asinData.rating === 'number' && !isNaN(asinData.rating)
                            ? `${asinData.rating.toFixed(1)} ★`
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          Average rating for this ASIN
                        </div>
                      </div>
                      
                      {/* Price */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Price</div>
                        <div className="text-lg font-semibold text-gray-900 mb-1">
                          {asinData.price !== null && typeof asinData.price === 'number'
                            ? formatCurrency(asinData.price)
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          Current selling price
                        </div>
                      </div>
                      
                      {/* Brand Owner */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Brand Owner</div>
                        <div className="text-lg font-semibold text-gray-900 mb-1">
                          {asinData.brand_owner || "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          Seller type for this ASIN
                        </div>
                      </div>
                      
                      {/* Additional Core Metrics */}
                      {asinData.bsr !== null && (
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                          <div className="text-xs text-gray-500 mb-1">BSR</div>
                          <div className="text-lg font-semibold text-gray-900">
                            #{asinData.bsr.toLocaleString()}
                          </div>
                        </div>
                      )}
                      
                      {asinData.fulfillment && (
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                          <div className="text-xs text-gray-500 mb-1">Fulfillment</div>
                          <div className="text-lg font-semibold text-gray-900">
                            {asinData.fulfillment}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              {/* ASIN mode fallback: render even if asin_snapshot is missing */}
              {analysisMode === 'ASIN' && !analysis.asin_snapshot && (
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">
                      ASIN Snapshot
                    </h2>
                    <p className="text-xs text-gray-500">
                      Single-product competitive analysis for displacement targeting
                    </p>
                  </div>
                  <div className="text-sm text-gray-500 text-center py-4">
                    ASIN data unavailable — analysis proceeding with available information
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* SECTION 2: DECISION & INTERPRETATION (AFTER DATA)              */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              
              {/* ─────────────────────────────────────────────────────────── */}
              {/* MARKET SCOPE HEADER (Data Only - No Opinions)              */}
              {/* ─────────────────────────────────────────────────────────── */}
              <div className="bg-white border rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {analysisMode === "KEYWORD" ? "Keyword Analysis" : "ASIN Analysis"}
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Marketplace: Amazon.com – United States
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Search Type</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">
                      {analysisMode === "KEYWORD" ? "Keyword" : "ASIN"}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Input</div>
                    <div className="text-sm font-medium text-gray-900 mt-0.5">
                      {analysis.input_value}
                    </div>
                  </div>
                </div>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* SECTION 4: MARKET BREAKDOWN (Descriptive Only - No Opinions) */}
              {/* - Brand dominance %, Page-1 density, Fulfillment mix, Price band */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === "KEYWORD" && analysis.market_snapshot && (
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">
                    Market Breakdown
                  </h2>
                  <p className="text-xs text-gray-500">
                    Descriptive metrics from Page 1 results
                  </p>
                </div>

                {/* Market Snapshot: Use ONLY cached data from analysis.market_snapshot (normalized from response.market_snapshot) */}
                {/* No re-fetching, no recomputation - all values come from cached analysis data */}
                {analysis.market_snapshot ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                    {/* Card 1: Price Band */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Price Band</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.avg_price !== null && 
                         analysis.market_snapshot.avg_price !== undefined &&
                         typeof analysis.market_snapshot.avg_price === 'number' &&
                         !isNaN(analysis.market_snapshot.avg_price)
                          ? formatCurrency(analysis.market_snapshot.avg_price)
                          : "—"}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        {analysis.market_snapshot.avg_price !== null && analysis.market_snapshot.avg_price !== undefined
                          ? "Average price on Page 1"
                          : "Insufficient Page 1 data"}
                      </div>
                    </div>
                    {/* Card 2: Average Reviews */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Average Reviews</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.avg_reviews !== null && 
                         analysis.market_snapshot.avg_reviews !== undefined &&
                         typeof analysis.market_snapshot.avg_reviews === 'number' &&
                         !isNaN(analysis.market_snapshot.avg_reviews)
                          ? analysis.market_snapshot.avg_reviews.toLocaleString()
                          : "—"}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        {analysis.market_snapshot.avg_reviews !== null && analysis.market_snapshot.avg_reviews !== undefined
                          ? "Average review count on Page 1"
                          : "Insufficient Page 1 data"}
                      </div>
                    </div>
                    {/* Card 3: Average Rating */}
                    {analysis.market_snapshot.avg_rating !== null &&
                     analysis.market_snapshot.avg_rating !== undefined &&
                     !isNaN(analysis.market_snapshot.avg_rating) && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Average Rating</div>
                        <div className="text-lg font-semibold text-gray-900 mb-0.5">
                          {analysis.market_snapshot.avg_rating !== null &&
                           analysis.market_snapshot.avg_rating !== undefined &&
                           typeof analysis.market_snapshot.avg_rating === 'number' &&
                           !isNaN(analysis.market_snapshot.avg_rating)
                            ? `${analysis.market_snapshot.avg_rating.toFixed(1)} ★`
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600 mb-1">
                          Minimum rating to compete
                        </div>
                      </div>
                    )}
                    {/* Card 4: Brand Dominance */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Brand Dominance</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.dominance_score !== undefined && 
                         analysis.market_snapshot.dominance_score !== null &&
                         typeof analysis.market_snapshot.dominance_score === 'number' &&
                         !isNaN(analysis.market_snapshot.dominance_score)
                          ? `Top brand: ${Math.round(analysis.market_snapshot.dominance_score)}%`
                          : "—"}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        {analysis.market_snapshot.dominance_score !== undefined && 
                         analysis.market_snapshot.dominance_score !== null &&
                         typeof analysis.market_snapshot.dominance_score === 'number'
                          ? `Top brand holds ${Math.round(analysis.market_snapshot.dominance_score)}% of Page-1 listings`
                          : "Insufficient Page 1 data"}
                      </div>
                    </div>
                    {/* Card 6: Page-1 Density */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Page-1 Density</div>
                      <div className="text-lg font-semibold text-gray-900 mb-0.5">
                        {analysis.market_snapshot.total_page1_listings !== undefined &&
                         analysis.market_snapshot.total_page1_listings !== null &&
                         typeof analysis.market_snapshot.total_page1_listings === 'number' &&
                         analysis.market_snapshot.total_page1_listings > 0
                          ? `${analysis.market_snapshot.total_page1_listings} listings`
                          : "—"}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">
                        {analysis.market_snapshot.total_page1_listings !== undefined &&
                         analysis.market_snapshot.total_page1_listings !== null &&
                         typeof analysis.market_snapshot.total_page1_listings === 'number' &&
                         analysis.market_snapshot.total_page1_listings > 0
                          ? "Total listings on Page 1"
                          : "Insufficient Page 1 data"}
                      </div>
                    </div>
                    {/* Card 7: Sponsored Listings */}
                    {analysis.market_snapshot.sponsored_count !== undefined && 
                     analysis.market_snapshot.sponsored_count !== null && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Sponsored Listings</div>
                        <div className="text-lg font-semibold text-gray-900 mb-0.5">
                          {typeof analysis.market_snapshot.sponsored_count === 'number' &&
                           analysis.market_snapshot.sponsored_count > 0
                            ? `${analysis.market_snapshot.sponsored_count} sponsored`
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600 mb-1">
                          {typeof analysis.market_snapshot.sponsored_count === 'number' &&
                           analysis.market_snapshot.sponsored_count > 0
                            ? `${analysis.market_snapshot.sponsored_count} sponsored listings on Page 1`
                            : "Insufficient Page 1 data"}
                        </div>
                      </div>
                    )}
                    {/* Card 8: Fulfillment Cost (est.) */}
                    {analysis.market_snapshot?.fba_fees && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Fulfillment Cost (est.)</div>
                        <div className="text-lg font-semibold text-gray-900 mb-0.5">
                          {(() => {
                            // Support both new and legacy structures
                            const fees = analysis.market_snapshot.fba_fees;
                            const totalFee = 'total_fba_fees' in fees && fees.total_fba_fees !== null
                              ? fees.total_fba_fees
                              : 'total_fee' in fees && fees.total_fee !== null
                              ? fees.total_fee
                              : null;
                            return totalFee !== null && 
                                   totalFee !== undefined && 
                                   typeof totalFee === 'number' && 
                                   !isNaN(totalFee)
                              ? formatCurrency(totalFee) 
                              : "—";
                          })()}
                        </div>
                        <div className="text-xs text-gray-600 mb-1">
                          {(() => {
                            const fees = analysis.market_snapshot.fba_fees;
                            const hasFee = ('total_fba_fees' in fees && fees.total_fba_fees !== null) ||
                                          ('total_fee' in fees && fees.total_fee !== null);
                            return hasFee ? "FBA fee per unit" : "Insufficient Page 1 data";
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                    {/* CPI is displayed above - no separate verdict needed */}
                  </>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-4 text-center border border-gray-200">
                    <div className="text-lg font-semibold text-gray-900 mb-1">—</div>
                    <p className="text-gray-600 text-xs">
                      Insufficient Page 1 data
                    </p>
                  </div>
                )}
              </div>
              )}

              {/* ─────────────────────────────────────────────────────────── */}
              {/* SECTION 5: MARGIN SNAPSHOT (ESTIMATED)                      */}
              {/* - Always displayed (calculated if missing)                   */}
              {/* - Shows confidence badge (High/Medium/Low)                  */}
              {/* - Labeled as "Estimated"                                    */}
              {/* ─────────────────────────────────────────────────────────── */}
              {(() => {
                // PART G: Get margin snapshot from analysis.margin_snapshot (first-class feature)
                const marginSnapshot = analysis.margin_snapshot;
                const isAsinMode = analysisMode === 'ASIN';
                
                // Margin snapshot should always exist (built deterministically)
                if (!marginSnapshot) {
                  return (
                    <div className="bg-white border rounded-xl p-6 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">
                          Margin Snapshot (Estimated)
                        </h2>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          Data Unavailable
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 text-center py-4">
                        <div className="mb-2">
                          {isAsinMode 
                            ? "Margin estimate will be available shortly" 
                            : "Insufficient data to estimate"}
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          {isAsinMode
                            ? "This ASIN margin estimate uses assumptions based on your sourcing model and the listing price."
                            : "This estimate is based on typical cost structures for your sourcing model. Actual margins depend on supplier and logistics."}
                        </p>
                      </div>
                    </div>
                  );
                }
                
                // PART G: Use new data contract fields
                const confidenceTier = marginSnapshot.confidence_tier;
                const confidenceReason = marginSnapshot.confidence_reason;
                
                const confidenceBadgeStyles = {
                  EXACT: "bg-green-100 text-green-800",
                  REFINED: "bg-blue-100 text-blue-800",
                  ESTIMATED: "bg-yellow-100 text-yellow-800",
                };
                
                const confidenceLabels = {
                  EXACT: "Exact",
                  REFINED: "Refined",
                  ESTIMATED: "Estimated",
                };
                
                return (
                  <div className="bg-white border rounded-xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Margin Snapshot
                      </h2>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${confidenceBadgeStyles[confidenceTier]}`}>
                        {confidenceLabels[confidenceTier]}
                      </span>
                    </div>
                    {(() => {
                      const snapshot = marginSnapshot;
                      const assumedPrice = snapshot.assumed_price;
                      const cogsMin = snapshot.estimated_cogs_min;
                      const cogsMax = snapshot.estimated_cogs_max;
                      const fbaFee = snapshot.estimated_fba_fee;
                      
                      // Handle both old structure (net_margin_min_pct/max_pct) and new contract (estimated_net_margin_pct_range)
                      let marginMin: number | null | undefined = null;
                      let marginMax: number | null | undefined = null;
                      
                      const snapshotAny = snapshot as any;
                      
                      if ('estimated_net_margin_pct_range' in snapshotAny && Array.isArray(snapshotAny.estimated_net_margin_pct_range)) {
                        // New contract structure (keyword mode)
                        marginMin = snapshotAny.estimated_net_margin_pct_range[0];
                        marginMax = snapshotAny.estimated_net_margin_pct_range[1];
                      } else if ('net_margin_min_pct' in snapshotAny && 'net_margin_max_pct' in snapshotAny) {
                        // Old structure (backward compatibility)
                        marginMin = snapshotAny.net_margin_min_pct;
                        marginMax = snapshotAny.net_margin_max_pct;
                      } else if ('net_margin_pct' in snapshotAny && typeof snapshotAny.net_margin_pct === 'number') {
                        // ASIN mode (single value)
                        marginMin = snapshotAny.net_margin_pct;
                        marginMax = snapshotAny.net_margin_pct;
                      }
                      
                      // Handle both old structure (breakeven_price_min/max) and new contract (breakeven_price_range)
                      let breakevenMin: number | null | undefined = null;
                      let breakevenMax: number | null | undefined = null;
                      
                      if ('breakeven_price_range' in snapshotAny && Array.isArray(snapshotAny.breakeven_price_range)) {
                        // New contract structure (keyword mode)
                        breakevenMin = snapshotAny.breakeven_price_range[0];
                        breakevenMax = snapshotAny.breakeven_price_range[1];
                      } else if ('breakeven_price_min' in snapshotAny && 'breakeven_price_max' in snapshotAny) {
                        // Old structure (backward compatibility)
                        breakevenMin = snapshotAny.breakeven_price_min;
                        breakevenMax = snapshotAny.breakeven_price_max;
                      } else if ('breakeven_price' in snapshotAny && typeof snapshotAny.breakeven_price === 'number') {
                        // ASIN mode (single value)
                        breakevenMin = snapshotAny.breakeven_price;
                        breakevenMax = snapshotAny.breakeven_price;
                      }
                      
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-4">
                            {/* Selling Price */}
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <div className="text-xs text-gray-500 mb-1">Selling Price</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {assumedPrice !== null && assumedPrice > 0
                                  ? formatCurrency(assumedPrice)
                                  : "—"}
                              </div>
                            </div>

                            {/* Estimated COGS Range */}
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <div className="text-xs text-gray-500 mb-1">Estimated COGS Range</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {cogsMin !== null && cogsMax !== null
                                  ? `${formatCurrency(cogsMin)}–${formatCurrency(cogsMax)}`
                                  : "—"}
                              </div>
                            </div>

                            {/* Estimated FBA Fees */}
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <div className="text-xs text-gray-500 mb-1">Estimated FBA Fees</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {fbaFee !== null && fbaFee > 0
                                  ? formatCurrency(fbaFee)
                                  : "—"}
                              </div>
                              <div className="text-[10px] text-gray-500 mt-1">
                                {fbaFee === null
                                  ? "Not available"
                                  : snapshot.fba_fee_source === "sp_api"
                                  ? "Amazon SP-API"
                                  : "Estimated"}
                              </div>
                            </div>

                            {/* Net Margin Range */}
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <div className="text-xs text-gray-500 mb-1">Net Margin Range</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {marginMin != null && marginMax != null && 
                                 typeof marginMin === 'number' && typeof marginMax === 'number'
                                  ? `${marginMin.toFixed(1)}%–${marginMax.toFixed(1)}%`
                                  : "—"}
                              </div>
                            </div>

                            {/* Breakeven Price Range */}
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 md:col-span-2">
                              <div className="text-xs text-gray-500 mb-1">Breakeven Price Range</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {breakevenMin != null && breakevenMax != null &&
                                 typeof breakevenMin === 'number' && typeof breakevenMax === 'number'
                                  ? `${formatCurrency(breakevenMin)}–${formatCurrency(breakevenMax)}`
                                  : "—"}
                              </div>
                            </div>
                          </div>
                          {/* Assumptions Disclosure */}
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <p className="text-xs text-gray-500 mb-2">
                              Estimates only. Based on typical cost assumptions.
                            </p>
                            {snapshot.assumptions && snapshot.assumptions.length > 0 && (
                              <ul className="text-xs text-gray-500 space-y-1">
                                {snapshot.assumptions.map((assumption, idx) => (
                                  <li key={idx}>• {assumption}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                );
              })()}


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
                      ({analysis.assumptions_and_limits?.length || 0} items)
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
                    {analysis.assumptions_and_limits && Array.isArray(analysis.assumptions_and_limits) && analysis.assumptions_and_limits.length > 0 ? (
                      analysis.assumptions_and_limits.map((item, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-gray-600 text-sm"
                        >
                          <span className="text-gray-400 mt-0.5">•</span>
                          {item}
                        </li>
                      ))
                    ) : (
                      <li className="text-gray-500 text-sm italic">No assumptions or limits specified</li>
                    )}
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
        {/* RIGHT COLUMN: AI CHAT SIDEBAR (ALWAYS VISIBLE - SPELLBOOK STYLE) */}
        {/* AI Copilot is always available - no expand/collapse, no special sections */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <ChatSidebar
          analysisRunId={analysis?.analysis_run_id || null}
          initialMessages={chatMessages}
          onMessagesChange={setChatMessages}
          marketSnapshot={analysis?.market_snapshot || null}
          analysisMode={analysisMode}
        />
      </div>
    </div>
  );
}
