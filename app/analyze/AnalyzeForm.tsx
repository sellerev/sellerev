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
    avg_bsr?: number | null;
    total_page1_listings: number; // Only Page 1 listings
    sponsored_count: number;
    dominance_score: number; // 0-100, % of listings belonging to top brand
    fulfillment_mix?: {
      fba: number;
      fbm: number;
      amazon: number;
    } | null;
    representative_asin?: string | null; // Optional representative ASIN for fee estimation
    // Page 1 product listings (for data-first display)
    listings?: Array<{
      asin: string | null;
      title: string | null;
      price: number | null;
      rating: number | null;
      reviews: number | null;
      bsr?: number | null;
      organic_rank?: number | null;
      fulfillment?: "FBA" | "FBM" | "Amazon" | null;
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
 * Extracts from listings if fulfillment field is available
 */
function calculateFulfillmentMix(listings: Array<any>): {
  fba: number;
  fbm: number;
  amazon: number;
} {
  if (!listings || listings.length === 0) {
    return { fba: 0, fbm: 0, amazon: 0 };
  }
  
  let fbaCount = 0;
  let fbmCount = 0;
  let amazonCount = 0;
  
  listings.forEach((l: any) => {
    const fulfillment = l.fulfillment || l.Fulfillment;
    if (fulfillment === "FBA") fbaCount++;
    else if (fulfillment === "FBM") fbmCount++;
    else if (fulfillment === "Amazon") amazonCount++;
  });
  
  const totalWithFulfillment = fbaCount + fbmCount + amazonCount;
  if (totalWithFulfillment === 0) {
    return { fba: 0, fbm: 0, amazon: 0 };
  }
  
  return {
    fba: Math.round((fbaCount / totalWithFulfillment) * 100),
    fbm: Math.round((fbmCount / totalWithFulfillment) * 100),
    amazon: Math.round((amazonCount / totalWithFulfillment) * 100),
  };
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
  
  // Selected listing state (for AI context)
  const [selectedListing, setSelectedListing] = useState<any | null>(null);
  
  // Selected competitor state (for ASIN mode)
  const [selectedCompetitor, setSelectedCompetitor] = useState<any | null>(null);

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
        {/* LEFT COLUMN: MARKET DATA & PRODUCTS (~70%)                      */}
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
                  Ready to Search
                </h2>
                <p className="text-gray-500 text-sm">
                  Enter a product keyword above to see Page 1 results with market intelligence.
                  Click any product to ask questions about it.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* KEYWORD MODE: Interactive Amazon-style search */}
              {analysisMode === 'KEYWORD' && analysis.market_snapshot ? (
                <>
                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* MARKET SNAPSHOT ROW - Raw Metrics Only                    */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {(() => {
                    const snapshot = analysis.market_snapshot;
                    const searchVolume = snapshot.search_demand?.search_volume_range ?? null;
                    const fulfillmentMix = snapshot.fulfillment_mix;
                    
                    return (
                      <div className="bg-white border rounded-lg p-4 mb-6">
                        <div className="mb-2 text-xs text-gray-500">
                          <span className="font-medium">Note:</span> Metrics labeled "(est.)" are modeled estimates, not Amazon-reported data.
                        </div>
                        <div className="grid grid-cols-8 gap-4 text-sm">
                          {/* Search Volume */}
                          <div>
                            <div className="text-xs text-gray-500 mb-0.5">Search Volume</div>
                            <div className="font-semibold text-gray-900">
                              {searchVolume ? `${searchVolume} (est.)` : "Not available"}
                            </div>
                          </div>
                      {/* Page-1 Listings */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Page-1 Listings</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot.total_page1_listings || 0}
                        </div>
                      </div>
                      {/* Avg Price */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Avg Price</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot.avg_price !== null ? formatCurrency(snapshot.avg_price) : "Not available"}
                        </div>
                      </div>
                      {/* Avg Reviews */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Avg Reviews</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot.avg_reviews !== null ? snapshot.avg_reviews.toLocaleString() : "Not available"}
                        </div>
                      </div>
                      {/* Avg Rating */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Avg Rating</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot.avg_rating !== null && typeof snapshot.avg_rating === 'number' && !isNaN(snapshot.avg_rating)
                            ? `${snapshot.avg_rating.toFixed(1)} ★`
                            : "Not available"}
                        </div>
                      </div>
                      {/* Brand Dominance */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Brand Dominance</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot.dominance_score !== undefined && snapshot.dominance_score !== null
                            ? `${Math.round(snapshot.dominance_score)}%`
                            : "Not available"}
                        </div>
                      </div>
                      {/* Fulfillment Mix */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Fulfillment Mix</div>
                        <div className="font-semibold text-gray-900">
                          {fulfillmentMix
                            ? `FBA ${fulfillmentMix.fba}% / FBM ${fulfillmentMix.fbm}%${fulfillmentMix.amazon > 0 ? ` / Amazon ${fulfillmentMix.amazon}%` : ''}`
                            : "Not available"}
                        </div>
                      </div>
                      {/* Sponsored Count */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Sponsored</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot.sponsored_count !== undefined ? snapshot.sponsored_count : 0}
                        </div>
                      </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* PAGE 1 RESULTS - Amazon-Style Grid                          */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {(() => {
                const snapshot = analysis.market_snapshot;
                const listings = snapshot.listings || [];
                
                // Normalize listings
                const normalizedListings = [...listings]
                  .filter((l: any) => l && (l.asin || l.ASIN) && (l.title || l.Title))
                  .map((l: any) => ({
                    asin: l.asin || l.ASIN || "",
                    title: l.title || l.Title || "",
                    brand: l.brand || l.Brand || null,
                    price: l.price || l.Price || null,
                    rating: l.rating || l.Rating || null,
                    reviews: l.reviews || l.Reviews || l.review_count || null,
                    bsr: l.bsr || l.BSR || null,
                    organic_rank: l.organic_rank || l.position || l.Position || null,
                    fulfillment: l.fulfillment || l.Fulfillment || null,
                    image: l.image || l.image_url || l.Image || null,
                    is_sponsored: l.is_sponsored || l.IsSponsored || false,
                  }));
                
                return (
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Page 1 Results</h2>
                    {selectedListing && (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="text-sm text-blue-900">
                          <span className="font-medium">Selected:</span> {selectedListing.title || selectedListing.asin}
                        </div>
                        <div className="text-xs text-blue-700 mt-1">
                          Ask questions about this product in the chat
                        </div>
                      </div>
                    )}
                    {normalizedListings.length === 0 ? (
                      <div className="p-8 text-center bg-white border rounded-lg">
                        <p className="text-gray-500">No products found</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {normalizedListings.map((listing: any, idx: number) => {
                          const isSelected = selectedListing?.asin === listing.asin;
                          const imageUrl = listing.image || listing.image_url || null;
                          
                          return (
                            <div
                              key={`${listing.asin}-${idx}`}
                              onClick={() => setSelectedListing(isSelected ? null : listing)}
                              className={`bg-white border-2 rounded-lg p-4 cursor-pointer transition-all hover:shadow-lg ${
                                isSelected 
                                  ? 'ring-2 ring-blue-500 border-blue-500 shadow-md' 
                                  : 'border-gray-200 hover:border-gray-400'
                              }`}
                            >
                              {/* Image */}
                              <div className="mb-3 flex justify-center">
                                {imageUrl ? (
                                  <img
                                    src={imageUrl}
                                    alt={listing.title || "Product"}
                                    className="w-32 h-32 object-contain"
                                    loading="lazy"
                                    onError={(e) => {
                                      const img = e.target as HTMLImageElement;
                                      img.style.display = 'none';
                                      const placeholder = img.parentElement?.querySelector('.img-placeholder');
                                      if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
                                    }}
                                  />
                                ) : null}
                                <div className="img-placeholder w-32 h-32 bg-gray-100 rounded flex items-center justify-center" style={{ display: imageUrl ? 'none' : 'flex' }}>
                                  <span className="text-xs text-gray-400">No image</span>
                                </div>
                              </div>
                              
                              {/* Title (2 lines max) */}
                              <h3 className="text-sm font-medium text-gray-900 mb-2 line-clamp-2 min-h-[2.5rem]">
                                {listing.title || "—"}
                              </h3>
                              
                              {/* Price */}
                              <div className="mb-2">
                                <span className="text-lg font-semibold text-gray-900">
                                  {listing.price !== null && listing.price !== undefined
                                    ? formatCurrency(listing.price)
                                    : "Price not available"}
                                </span>
                              </div>
                              
                              {/* Rating + Reviews */}
                              <div className="mb-2 flex items-center gap-2">
                                {listing.rating !== null && typeof listing.rating === 'number' && !isNaN(listing.rating) ? (
                                  <>
                                    <span className="text-yellow-400">★</span>
                                    <span className="text-sm text-gray-700">{listing.rating.toFixed(1)}</span>
                                  </>
                                ) : null}
                                {listing.reviews !== null && listing.reviews !== undefined ? (
                                  <span className="text-xs text-gray-500">
                                    ({listing.reviews.toLocaleString()})
                                  </span>
                                ) : null}
                              </div>
                              
                              {/* BSR */}
                              {listing.bsr !== null && listing.bsr !== undefined && (
                                <div className="mb-2 text-xs text-gray-500">
                                  BSR: #{listing.bsr.toLocaleString()}
                                </div>
                              )}
                              
                              {/* Badges */}
                              <div className="flex flex-wrap gap-1 mt-2">
                                {listing.is_sponsored && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                    Sponsored
                                  </span>
                                )}
                                {listing.fulfillment && (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                    listing.fulfillment === 'FBA' ? 'bg-blue-100 text-blue-800' :
                                    listing.fulfillment === 'FBM' ? 'bg-gray-100 text-gray-800' :
                                    'bg-yellow-100 text-yellow-800'
                                  }`}>
                                    {listing.fulfillment}
                                  </span>
                                )}
                                {listing.organic_rank !== null && listing.organic_rank !== undefined && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                    Rank #{listing.organic_rank}
                                  </span>
                                )}
                              </div>
                              
                              {/* ASIN */}
                              <div className="mt-2 text-xs text-gray-400">
                                {listing.asin}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  );
                })()}
                </>
              ) : analysisMode === 'ASIN' ? (
                /* ASIN MODE: Product-Centric Competitive Analysis */
                <>
                  {analysisMode === 'ASIN' && analysis.asin_snapshot && (() => {
                    const asinData = analysis.asin_snapshot;
                    const marketSnapshot = analysis.market_snapshot;
                    const page1Listings = marketSnapshot?.listings || [];
                    const inputAsin = analysis.input_value;
                    
                    // Find the ASIN in Page-1 listings to get image/title
                    const asinListing = page1Listings.find((l: any) => 
                      (l.asin || l.ASIN || l.asin) === inputAsin
                    ) as any;
                    
                    // Calculate percentiles if available
                    const pricePercentile = asinData.position_vs_page1?.price_percentile ?? null;
                    const reviewPercentile = asinData.position_vs_page1?.review_percentile ?? null;
                    
                    return (
                      <>
                        {/* ─────────────────────────────────────────────────────────── */}
                        {/* PINNED ASIN CARD - Always Visible                        */}
                        {/* ─────────────────────────────────────────────────────────── */}
                        <div className="bg-white border-2 border-blue-500 rounded-xl p-6 shadow-lg mb-6">
                          <div className="flex items-start gap-6">
                            {/* Product Image */}
                            <div className="flex-shrink-0">
                              {((asinListing as any)?.image || (asinListing as any)?.image_url) ? (
                                <img
                                  src={(asinListing as any).image || (asinListing as any).image_url}
                                  alt={(asinListing as any)?.title || (asinListing as any)?.Title || inputAsin}
                                  className="w-48 h-48 object-contain rounded-lg border border-gray-200"
                                />
                              ) : (
                                <div className="w-48 h-48 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                                  <span className="text-sm text-gray-400">No image</span>
                                </div>
                              )}
                            </div>
                            
                            {/* Product Details */}
                            <div className="flex-1">
                              <div className="mb-2">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  Target ASIN
                                </span>
                              </div>
                              
                              <h1 className="text-2xl font-bold text-gray-900 mb-3">
                                {(asinListing as any)?.title || (asinListing as any)?.Title || inputAsin}
                              </h1>
                              
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                {/* Price */}
                                <div>
                                  <div className="text-xs text-gray-500 mb-1">Price</div>
                                  <div className="text-xl font-semibold text-gray-900">
                                    {asinData.price !== null && typeof asinData.price === 'number'
                                      ? formatCurrency(asinData.price)
                                      : "Not available"}
                                  </div>
                                  {pricePercentile !== null && (
                                    <div className="text-xs text-gray-500 mt-1">
                                      {pricePercentile <= 25 ? "Lower 25%" : pricePercentile <= 50 ? "Lower 50%" : pricePercentile <= 75 ? "Upper 50%" : "Upper 25%"} vs Page-1
                                    </div>
                                  )}
                                </div>
                                
                                {/* Rating */}
                                <div>
                                  <div className="text-xs text-gray-500 mb-1">Rating</div>
                                  <div className="text-xl font-semibold text-gray-900">
                                    {asinData.rating !== null && typeof asinData.rating === 'number' && !isNaN(asinData.rating)
                                      ? `${asinData.rating.toFixed(1)} ★`
                                      : "Not available"}
                                  </div>
                                </div>
                                
                                {/* Reviews */}
                                <div>
                                  <div className="text-xs text-gray-500 mb-1">Reviews</div>
                                  <div className="text-xl font-semibold text-gray-900">
                                    {asinData.reviews !== null && typeof asinData.reviews === 'number'
                                      ? asinData.reviews.toLocaleString()
                                      : "Not available"}
                                  </div>
                                  {reviewPercentile !== null && (
                                    <div className="text-xs text-gray-500 mt-1">
                                      {reviewPercentile >= 75 ? "Top 25%" : reviewPercentile >= 50 ? "Top 50%" : reviewPercentile >= 25 ? "Bottom 50%" : "Bottom 25%"} vs Page-1
                                    </div>
                                  )}
                                </div>
                                
                                {/* BSR */}
                                <div>
                                  <div className="text-xs text-gray-500 mb-1">BSR</div>
                                  <div className="text-xl font-semibold text-gray-900">
                                    {asinData.bsr !== null && typeof asinData.bsr === 'number'
                                      ? `#${asinData.bsr.toLocaleString()}`
                                      : "Not available"}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex flex-wrap gap-2">
                                {asinData.fulfillment && (
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${
                                    asinData.fulfillment === 'FBA' ? 'bg-blue-100 text-blue-800' :
                                    asinData.fulfillment === 'FBM' ? 'bg-gray-100 text-gray-800' :
                                    'bg-yellow-100 text-yellow-800'
                                  }`}>
                                    {asinData.fulfillment}
                                  </span>
                                )}
                                {asinData.brand_owner && (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                    {asinData.brand_owner}
                                  </span>
                                )}
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                  {inputAsin}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* ─────────────────────────────────────────────────────────── */}
                        {/* PAGE-1 COMPETITOR GRID                                    */}
                        {/* ─────────────────────────────────────────────────────────── */}
                        <div className="mb-6">
                          <h2 className="text-xl font-semibold text-gray-900 mb-4">Page 1 Competitors</h2>
                          {selectedCompetitor && (
                            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                              <div className="text-sm text-blue-900">
                                <span className="font-medium">Selected competitor:</span> {selectedCompetitor.title || selectedCompetitor.asin}
                              </div>
                              <div className="text-xs text-blue-700 mt-1">
                                Ask questions about this competitor in the chat
                              </div>
                            </div>
                          )}
                          
                          {page1Listings.length === 0 ? (
                            <div className="p-8 text-center bg-white border rounded-lg">
                              <p className="text-gray-500">No competitors found</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {page1Listings
                                .filter((l: any) => l && (l.asin || l.ASIN) && (l.title || l.Title))
                                .sort((a: any, b: any) => {
                                  // Sort by organic rank (1-indexed, lower = better)
                                  const rankA = a.organic_rank || a.position || a.Position || 999;
                                  const rankB = b.organic_rank || b.position || b.Position || 999;
                                  return rankA - rankB;
                                })
                                .map((l: any) => {
                                  const listingAsin = l.asin || l.ASIN || "";
                                  const isTargetAsin = listingAsin === inputAsin;
                                  const isSelected = selectedCompetitor?.asin === listingAsin;
                                  
                                  return (
                                    <div
                                      key={listingAsin}
                                      onClick={() => !isTargetAsin && setSelectedCompetitor(isSelected ? null : l)}
                                      className={`bg-white border-2 rounded-lg p-4 cursor-pointer transition-all hover:shadow-md ${
                                        isTargetAsin
                                          ? 'border-blue-500 bg-blue-50'
                                          : isSelected
                                          ? 'border-blue-400 border-dashed'
                                          : 'border-gray-200 hover:border-gray-300'
                                      }`}
                                    >
                                      <div className="flex items-center gap-4">
                                        {/* Image */}
                                        <div className="flex-shrink-0">
                                          {l.image || l.image_url ? (
                                            <img
                                              src={l.image || l.image_url}
                                              alt={l.title || listingAsin}
                                              className="w-20 h-20 object-contain rounded border border-gray-200"
                                            />
                                          ) : (
                                            <div className="w-20 h-20 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                                              <span className="text-xs text-gray-400">IMG</span>
                                            </div>
                                          )}
                                        </div>
                                        
                                        {/* Details */}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-start justify-between gap-2 mb-1">
                                            <h3 className="text-sm font-medium text-gray-900 line-clamp-2 flex-1">
                                              {l.title || l.Title || listingAsin}
                                            </h3>
                                            {isTargetAsin && (
                                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 flex-shrink-0">
                                                Target
                                              </span>
                                            )}
                                          </div>
                                          
                                          <div className="flex items-center gap-4 text-sm">
                                            {/* Price */}
                                            <div>
                                              <span className="text-gray-900 font-semibold">
                                                {l.price || l.Price ? formatCurrency(l.price || l.Price) : "Not available"}
                                              </span>
                                            </div>
                                            
                                            {/* Rating + Reviews */}
                                            {(l.rating || l.Rating) && (
                                              <div className="flex items-center gap-1">
                                                <span className="text-yellow-400">★</span>
                                                <span className="text-gray-700">{typeof (l.rating || l.Rating) === 'number' ? (l.rating || l.Rating).toFixed(1) : l.rating || l.Rating}</span>
                                                {l.reviews || l.Reviews ? (
                                                  <span className="text-gray-500 text-xs">
                                                    ({typeof (l.reviews || l.Reviews) === 'number' ? (l.reviews || l.Reviews).toLocaleString() : l.reviews || l.Reviews})
                                                  </span>
                                                ) : null}
                                              </div>
                                            )}
                                            
                                            {/* BSR */}
                                            {(l.bsr || l.BSR) && (
                                              <div className="text-gray-600 text-xs">
                                                BSR: #{typeof (l.bsr || l.BSR) === 'number' ? (l.bsr || l.BSR).toLocaleString() : l.bsr || l.BSR}
                                              </div>
                                            )}
                                          </div>
                                          
                                          {/* Badges */}
                                          <div className="flex flex-wrap gap-1 mt-2">
                                            {l.is_sponsored || l.IsSponsored ? (
                                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                                Sponsored
                                              </span>
                                            ) : null}
                                            {l.fulfillment || l.Fulfillment ? (
                                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                (l.fulfillment || l.Fulfillment) === 'FBA' ? 'bg-blue-100 text-blue-800' :
                                                (l.fulfillment || l.Fulfillment) === 'FBM' ? 'bg-gray-100 text-gray-800' :
                                                'bg-yellow-100 text-yellow-800'
                                              }`}>
                                                {l.fulfillment || l.Fulfillment}
                                              </span>
                                            ) : null}
                                            {l.organic_rank || l.position || l.Position ? (
                                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                                Rank #{l.organic_rank || l.position || l.Position}
                                              </span>
                                            ) : null}
                                          </div>
                                          
                                          {/* ASIN */}
                                          <div className="mt-1 text-xs text-gray-400">
                                            {listingAsin}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                  
                  {/* ASIN mode fallback: render even if asin_snapshot is missing */}
                  {analysisMode === 'ASIN' && !analysis.asin_snapshot && (
                    <div className="bg-white border rounded-xl p-6 shadow-sm">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold text-gray-900 mb-1">
                          ASIN Analysis
                        </h2>
                        <p className="text-xs text-gray-500">
                          Product data unavailable
                        </p>
                      </div>
                      <div className="text-sm text-gray-500 text-center py-4">
                        ASIN data unavailable — analysis proceeding with available information
                      </div>
                    </div>
                  )}
                </>
              ) : null}
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
          selectedListing={analysisMode === 'KEYWORD' ? selectedListing : null}
          selectedCompetitor={analysisMode === 'ASIN' ? selectedCompetitor : null}
        />
      </div>
    </div>
  );
}
