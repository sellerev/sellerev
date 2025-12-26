"use client";

import { useState } from "react";
import ChatSidebar, { ChatMessage } from "./ChatSidebar";
import { normalizeListing } from "@/lib/amazon/normalizeListing";
import FeasibilityCalculator from "./FeasibilityCalculator";

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
    page1_count?: number; // Locked contract field (alternative to total_page1_listings)
    sponsored_count: number;
    dominance_score: number; // 0-100, % of listings belonging to top brand
    search_volume?: { min: number; max: number } | null; // Locked contract field
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
    // PPC Indicators - heuristic assessment of advertising intensity
    ppc?: {
      sponsored_pct: number; // 0-100
      ad_intensity_label: "Low" | "Medium" | "High";
      signals: string[]; // Max 3 signal bullets
      source: "heuristic_v1";
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
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────


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

  // Input state - pre-populate if loading from history (keyword-only)
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
  
  // Sort state for Page 1 Results (default to revenue descending)
  const [sortBy, setSortBy] = useState<"revenue" | "units" | "bsr" | "reviews" | "price">("revenue");

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const validateInput = (): boolean => {
    setInputError(null);

    if (!inputValue.trim()) {
      setInputError("Please enter a keyword to search");
      return false;
    }

    // Check if input looks like an ASIN
    const asinPattern = /^B0[A-Z0-9]{8}$/i;
    if (asinPattern.test(inputValue.trim())) {
      setInputError("Analyze currently supports keyword search only.");
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
      console.log("ANALYZE_REQUEST_START", { inputValue: inputValue.trim() });

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_type: "keyword",
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

      // STEP 7: Never block on errors - always render with best available data
      // Only show errors for actual failures (500), not missing data (which uses fallbacks)
      if (!res.ok || (!data.success && res.status >= 500)) {
        const errorMsg = data.error || "Analysis failed";
        const errorDetails = data.details || "";
        const errorStack = data.stack || "";
        
        // Log full error details to console for debugging
        console.error("ANALYZE_ERROR", { 
          error: errorMsg, 
          details: errorDetails,
          stack: errorStack,
          status: res.status,
          data 
        });
        
        // Display user-friendly error message (limit length, exclude stack traces)
        let displayError = errorMsg;
        if (errorDetails && !errorDetails.includes("at ") && !errorDetails.includes("Error:")) {
          // Only include details if it's not a stack trace and not too long
          const truncatedDetails = errorDetails.length > 200 
            ? errorDetails.substring(0, 200) + "..." 
            : errorDetails;
          displayError = `${errorMsg}: ${truncatedDetails}`;
        }
        
        setError(displayError);
        setLoading(false);
        return;
      }
      
      // Handle partial data (status: "partial") - still render, just show notice
      // Store status for UI to display appropriate messaging
      const isPartialData = data.status === "partial" || data.data_quality?.fallback_used;
      if (isPartialData) {
        console.log("PARTIAL_DATA_DETECTED", {
          status: data.status,
          data_quality: data.data_quality,
        });
        // Don't set error - just log. UI will show "best available data" message
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
      
      // PART G: Extract margin_snapshot from decision (first-class feature)
      const marginSnapshot = data.decision.margin_snapshot || null;
      
      const analysisData: AnalysisResponse = {
        analysis_run_id: data.analysisRunId,
        created_at: new Date().toISOString(),
        input_type: "keyword",
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

  // Analysis is always keyword-only
  const analysisMode: 'KEYWORD' | null = analysis ? 'KEYWORD' : null;


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
            {/* Keyword Input Field */}
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Search Keyword
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
                placeholder="Search any Amazon keyword…"
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
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-red-700 text-sm font-medium">Analysis Error</p>
                  <p className="text-red-600 text-sm mt-1">{error}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-red-400 hover:text-red-600 flex-shrink-0"
                  aria-label="Dismiss error"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
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
              {/* KEYWORD ANALYSIS: Interactive Amazon-style search */}
              {analysis.market_snapshot ? (
                <>
                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* MARKET SNAPSHOT ROW - Raw Metrics Only                    */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {(() => {
                    const snapshot = analysis.market_snapshot;
                    const page1Count = snapshot?.page1_count ?? snapshot?.total_page1_listings ?? 0;
                    const hasListings = page1Count > 0;
                    // Check if we have real listings (not fallback)
                    const hasRealListings = hasListings && (snapshot?.listings?.length || 0) > 0;
                    
                    // Use locked contract format: search_volume { min, max } or fallback to search_demand
                    let searchVolume: string | null = null;
                    if (snapshot?.search_volume && typeof snapshot.search_volume === 'object') {
                      const sv = snapshot.search_volume as { min: number; max: number };
                      const minK = sv.min >= 1000 ? Math.round(sv.min / 1000) : sv.min;
                      const maxK = sv.max >= 1000 ? Math.round(sv.max / 1000) : sv.max;
                      searchVolume = `${minK}${sv.min >= 1000 ? 'k' : ''}–${maxK}${sv.max >= 1000 ? 'k' : ''}`;
                    } else if (snapshot?.search_demand?.search_volume_range) {
                      searchVolume = snapshot.search_demand.search_volume_range;
                    }
                    
                    const fulfillmentMix = snapshot?.fulfillment_mix;
                    
                    return (
                      <div className="bg-white border rounded-lg p-4 mb-6">
                        {!hasRealListings && (
                          <div className="mb-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded border border-amber-200">
                            <span className="font-medium">Showing best available market data:</span> No Page-1 listings found. Metrics below are estimated using category defaults.
                          </div>
                        )}
                        <div className="mb-2 text-xs text-gray-500">
                          <span className="font-medium">Note:</span> Metrics labeled "(est.)" are modeled estimates, not Amazon-reported data.
                        </div>
                        <div className="grid grid-cols-8 gap-4 text-sm">
                          {/* Search Volume - ALWAYS show (Step 3) */}
                          <div>
                            <div className="text-xs text-gray-500 mb-0.5">Search Volume</div>
                            <div className="font-semibold text-gray-900">
                              {searchVolume 
                                ? `${searchVolume} (est.)`
                                : "12k–18k (est.)"} {/* Always show fallback, never "Not available" */}
                            </div>
                          </div>
                      {/* Page-1 Listings */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Page-1 Listings</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot?.page1_count ?? snapshot?.total_page1_listings ?? 0}
                        </div>
                      </div>
                      {/* Avg Price */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Avg Price</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot?.avg_price !== null && snapshot?.avg_price !== undefined 
                            ? formatCurrency(snapshot.avg_price) 
                            : "Not available"}
                        </div>
                      </div>
                      {/* Avg Reviews - ALWAYS show (Step 4) */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Avg Reviews</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot?.avg_reviews !== undefined && snapshot?.avg_reviews !== null && snapshot.avg_reviews > 0
                            ? snapshot.avg_reviews.toLocaleString()
                            : "<10 (new market)"} {/* Always show, never "Not available" */}
                        </div>
                      </div>
                      {/* Avg Rating */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Avg Rating</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot?.avg_rating !== null && snapshot?.avg_rating !== undefined && typeof snapshot.avg_rating === 'number' && !isNaN(snapshot.avg_rating)
                            ? `${snapshot.avg_rating.toFixed(1)} ★`
                            : "Not available"}
                        </div>
                      </div>
                      {/* Brand Dominance */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Brand Dominance</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot?.dominance_score !== undefined && snapshot?.dominance_score !== null
                            ? `${Math.round(snapshot.dominance_score)}%`
                            : "Not available"}
                        </div>
                      </div>
                      {/* Fulfillment Mix - ALWAYS show when listings exist */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">
                          Fulfillment Mix
                          <span 
                            className="ml-1 cursor-help text-gray-400"
                            title="Shows how competitors fulfill orders. FBA-heavy markets favor Prime-eligible sellers."
                          >
                            ⓘ
                          </span>
                        </div>
                        <div className="font-semibold text-gray-900">
                          {fulfillmentMix
                            ? `FBA ${fulfillmentMix.fba}% · FBM ${fulfillmentMix.fbm}% · Amazon ${fulfillmentMix.amazon}%`
                            : "FBA 65% · FBM 25% · Amazon 10% (est.)"} {/* Always show, never "Not available" */}
                        </div>
                      </div>
                      {/* Sponsored Count */}
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Sponsored</div>
                        <div className="font-semibold text-gray-900">
                          {snapshot?.sponsored_count !== undefined ? snapshot.sponsored_count : 0}
                        </div>
                      </div>
                        </div>
                      </div>
                  );
                })()}

                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* PPC INDICATORS PANEL                                        */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {(() => {
                    const snapshot = analysis.market_snapshot;
                    const ppc = snapshot?.ppc;
                    
                    if (!ppc) {
                      return null; // Don't show panel if PPC data not available
                    }

                    // Determine sponsored density label
                    const sponsoredDensityLabel = ppc.sponsored_pct >= 50 
                      ? "High" 
                      : ppc.sponsored_pct >= 25 
                        ? "Medium" 
                        : "Low";

                    // Color coding for intensity labels
                    const intensityColor = ppc.ad_intensity_label === "High" 
                      ? "text-red-700 bg-red-50 border-red-200"
                      : ppc.ad_intensity_label === "Medium"
                        ? "text-amber-700 bg-amber-50 border-amber-200"
                        : "text-green-700 bg-green-50 border-green-200";

                    const densityColor = sponsoredDensityLabel === "High"
                      ? "text-red-700 bg-red-50 border-red-200"
                      : sponsoredDensityLabel === "Medium"
                        ? "text-amber-700 bg-amber-50 border-amber-200"
                        : "text-green-700 bg-green-50 border-green-200";

                    return (
                      <div className="bg-white border rounded-lg p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">PPC Indicators</h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Sponsored Density */}
                          <div>
                            <div className="text-sm text-gray-600 mb-2">Sponsored Density</div>
                            <div className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-sm font-medium ${densityColor}`}>
                              {sponsoredDensityLabel} ({ppc.sponsored_pct}%)
                            </div>
                            <div className="text-xs text-gray-500 mt-2">
                              {snapshot?.sponsored_count || 0} of {snapshot?.total_page1_listings || 0} listings are sponsored
                            </div>
                          </div>

                          {/* Likely Ad Intensity */}
                          <div>
                            <div className="text-sm text-gray-600 mb-2">Likely Ad Intensity</div>
                            <div className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-sm font-medium ${intensityColor}`}>
                              {ppc.ad_intensity_label}
                            </div>
                            <div className="text-xs text-gray-500 mt-2 italic">
                              Heuristic assessment based on market signals
                            </div>
                          </div>
                        </div>

                        {/* Signals */}
                        {ppc.signals && ppc.signals.length > 0 && (
                          <div className="mt-4 pt-4 border-t">
                            <div className="text-sm font-medium text-gray-700 mb-2">Key Signals:</div>
                            <ul className="space-y-1.5">
                              {ppc.signals.map((signal, idx) => (
                                <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                                  <span className="text-gray-400 mt-0.5">•</span>
                                  <span>{signal}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Disclaimer */}
                        <div className="mt-4 pt-4 border-t">
                          <div className="text-xs text-gray-500 italic">
                            Note: These indicators are heuristic estimates based on Page-1 data. 
                            Actual CPC costs vary and are not provided without a calibrated model.
                            Source: {ppc.source}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* MARKET SNAPSHOT HERO SECTION (REVENUE-DRIVEN)               */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {(() => {
                    const snapshot = analysis.market_snapshot;
                    const listings = snapshot.listings || [];
                    
                    // Normalize listings using helper, preserving revenue fields
                    const normalizedListings = [...listings]
                      .filter((l: any) => {
                        const normalized = normalizeListing(l);
                        return normalized.asin && normalized.title;
                      })
                      .map((l: any) => ({
                        ...normalizeListing(l),
                        // Preserve revenue estimation fields from raw listing
                        est_monthly_revenue: l.est_monthly_revenue ?? null,
                        est_monthly_units: l.est_monthly_units ?? null,
                        revenue_confidence: l.revenue_confidence ?? "low",
                      }));
                    
                    // Calculate total 30-day Page-1 revenue
                    const totalRevenue = normalizedListings
                      .map((l: any) => l.est_monthly_revenue)
                      .filter((r): r is number => r !== null && r !== undefined)
                      .reduce((sum, r) => sum + r, 0) || snapshot.est_total_monthly_revenue_min || null;
                    
                    // Calculate total 30-day Page-1 units
                    const totalUnits = normalizedListings
                      .map((l: any) => l.est_monthly_units)
                      .filter((u): u is number => u !== null && u !== undefined)
                      .reduce((sum, u) => sum + u, 0) || snapshot.est_total_monthly_units_min || null;
                    
                    // Calculate average BSR from listings with BSR
                    const bsrListings = normalizedListings.filter((l: any) => l.bsr !== null && l.bsr !== undefined);
                    const avgBSR = bsrListings.length > 0
                      ? Math.round(bsrListings.reduce((sum: number, l: any) => sum + (l.bsr || 0), 0) / bsrListings.length)
                      : snapshot.avg_bsr || null;
                    
                    const avgPrice = snapshot.avg_price;
                    
                    // Calculate top-10 revenue (sort by revenue, take top 10, sum)
                    const sortedByRevenue = [...normalizedListings]
                      .filter((l: any) => l.est_monthly_revenue !== null && l.est_monthly_revenue !== undefined)
                      .sort((a: any, b: any) => (b.est_monthly_revenue || 0) - (a.est_monthly_revenue || 0));
                    const top10Revenue = sortedByRevenue
                      .slice(0, 10)
                      .reduce((sum: number, l: any) => sum + (l.est_monthly_revenue || 0), 0);
                    const top10RevenueShare = totalRevenue && totalRevenue > 0
                      ? Math.round((top10Revenue / totalRevenue) * 100)
                      : null;
                    
                    // Calculate review barrier (average reviews of top 10 by revenue)
                    const top10ByRevenue = sortedByRevenue.slice(0, 10);
                    const top10Reviews = top10ByRevenue
                      .map((l: any) => l.reviews)
                      .filter((r): r is number => r !== null && r !== undefined && r > 0);
                    const reviewBarrier = top10Reviews.length > 0
                      ? Math.round(top10Reviews.reduce((sum, r) => sum + r, 0) / top10Reviews.length)
                      : null;
                    
                    return (
                      <div className="bg-white border rounded-lg p-6 mb-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Market Snapshot (Page 1)</h2>
                        
                        {/* Hero Metrics Row */}
                        <div className="grid grid-cols-4 gap-6 mb-4">
                          {/* 30-Day Page-1 Revenue */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">30-Day Page-1 Revenue</div>
                            <div className="text-2xl font-semibold text-gray-900">
                              {totalRevenue !== null ? formatCurrency(totalRevenue) : "—"}
                            </div>
                          </div>
                          
                          {/* 30-Day Page-1 Units */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">30-Day Page-1 Units</div>
                            <div className="text-2xl font-semibold text-gray-900">
                              {totalUnits !== null ? totalUnits.toLocaleString() : "—"}
                            </div>
                          </div>
                          
                          {/* Avg BSR */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Avg BSR</div>
                            <div className="text-2xl font-semibold text-gray-900">
                              {avgBSR !== null ? `#${avgBSR.toLocaleString()}` : "—"}
                            </div>
                          </div>
                          
                          {/* Avg Price */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Avg Price</div>
                            <div className="text-2xl font-semibold text-gray-900">
                              {avgPrice !== null ? formatCurrency(avgPrice) : "—"}
                            </div>
                          </div>
                        </div>
                        
                        {/* Footer note */}
                        <div className="text-xs text-gray-500 mt-2">
                          Estimates based on Page-1 BSR sales modeling
                        </div>
                        
                        {/* Market Concentration Sub-Row */}
                        <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t">
                          {/* Top-10 Revenue */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Top-10 Revenue</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {top10Revenue > 0 ? formatCurrency(top10Revenue) : "—"}
                            </div>
                          </div>
                          
                          {/* Top-10 Revenue Share */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Top-10 Revenue Share</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {top10RevenueShare !== null ? `${top10RevenueShare}%` : "—"}
                            </div>
                          </div>
                          
                          {/* Review Barrier */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Review Barrier</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {reviewBarrier !== null ? reviewBarrier.toLocaleString() : "—"}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">avg reviews (top 10 by revenue)</div>
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
                    
                    // Normalize listings using helper, preserving revenue fields
                    const normalizedListings = [...listings]
                      .filter((l: any) => {
                        const normalized = normalizeListing(l);
                        return normalized.asin && normalized.title;
                      })
                      .map((l: any) => ({
                        ...normalizeListing(l),
                        // Preserve revenue estimation fields from raw listing
                        est_monthly_revenue: l.est_monthly_revenue ?? null,
                        est_monthly_units: l.est_monthly_units ?? null,
                        revenue_confidence: l.revenue_confidence ?? "low",
                      }));
                    
                    // Calculate total revenue for share calculation
                    const totalRevenue = normalizedListings
                      .map((l: any) => l.est_monthly_revenue)
                      .filter((r): r is number => r !== null && r !== undefined)
                      .reduce((sum, r) => sum + r, 0) || snapshot.est_total_monthly_revenue_min || 0;
                    
                    // Sort listings - default to revenue descending
                    const sortedListings = [...normalizedListings].sort((a: any, b: any) => {
                      switch (sortBy) {
                        case "revenue":
                          const aRev = a.est_monthly_revenue ?? 0;
                          const bRev = b.est_monthly_revenue ?? 0;
                          return bRev - aRev;
                        case "units":
                          const aUnits = a.est_monthly_units ?? 0;
                          const bUnits = b.est_monthly_units ?? 0;
                          return bUnits - aUnits;
                        case "bsr":
                          const aBsr = a.bsr ?? 999999;
                          const bBsr = b.bsr ?? 999999;
                          return aBsr - bBsr; // Lower BSR is better
                        case "reviews":
                          const aRevCount = a.reviews ?? 0;
                          const bRevCount = b.reviews ?? 0;
                          return bRevCount - aRevCount;
                        case "price":
                          const aPrice = a.price ?? 0;
                          const bPrice = b.price ?? 0;
                          return bPrice - aPrice;
                        default:
                          return 0;
                      }
                    });
                
                return (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold text-gray-900">Page 1 Results</h2>
                      <div className="flex items-center gap-3">
                        {normalizedListings.length === 0 && (
                          <div className="text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded border border-amber-200">
                            No Page 1 listings returned — market data estimated
                          </div>
                        )}
                        {normalizedListings.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Sort by:</span>
                            <select
                              value={sortBy}
                              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                              className="text-sm border border-gray-300 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-black"
                            >
                              <option value="revenue">Revenue</option>
                              <option value="units">Units</option>
                              <option value="bsr">BSR</option>
                              <option value="reviews">Reviews</option>
                              <option value="price">Price</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
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
                        <p className="text-gray-500 mb-2">No Page 1 listings returned</p>
                        <p className="text-sm text-amber-600">Market data shown above is estimated</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {sortedListings.map((listing, idx: number) => {
                          const isSelected = selectedListing?.asin === listing.asin;
                          const imageUrl = listing.image;
                          
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
                                {listing.title}
                              </h3>
                              
                              {/* Price */}
                              <div className="mb-2">
                                <span className="text-lg font-semibold text-gray-900">
                                  {listing.price !== null ? formatCurrency(listing.price) : "Price not available"}
                                </span>
                              </div>
                              
                              {/* Rating + Reviews */}
                              <div className="mb-2 flex items-center gap-2">
                                {listing.rating !== null ? (
                                  <>
                                    <span className="text-yellow-400">★</span>
                                    <span className="text-sm text-gray-700">{listing.rating.toFixed(1)}</span>
                                  </>
                                ) : null}
                                {listing.reviews !== null ? (
                                  <span className="text-xs text-gray-500">
                                    ({listing.reviews.toLocaleString()})
                                  </span>
                                ) : null}
                              </div>
                              
                              {/* BSR */}
                              {listing.bsr !== null && (
                                <div className="mb-2 text-xs text-gray-500">
                                  BSR: #{listing.bsr.toLocaleString()}
                                </div>
                              )}
                              
                              {/* Revenue Block */}
                              {(() => {
                                const listingWithRevenue = listing as any;
                                const revenue = listingWithRevenue.est_monthly_revenue;
                                const units = listingWithRevenue.est_monthly_units;
                                const revenueShare = revenue !== null && totalRevenue > 0
                                  ? ((revenue / totalRevenue) * 100).toFixed(1)
                                  : null;
                                
                                if (revenue === null && units === null) {
                                  return null; // Hide block if both revenue and units are missing
                                }
                                
                                return (
                                  <div className="mt-3 pt-3 border-t border-gray-200 bg-gray-50 rounded -mx-4 px-4 py-3">
                                    {/* Est. Monthly Revenue - bold, largest text */}
                                    <div className="mb-1.5">
                                      <div className="text-xs text-gray-500 mb-0.5">Est. Monthly Revenue</div>
                                      <div className="text-xl font-bold text-gray-900">
                                        {revenue !== null ? formatCurrency(revenue) : "—"}
                                      </div>
                                    </div>
                                    
                                    {/* Est. Monthly Units */}
                                    {units !== null && (
                                      <div className="mb-1.5">
                                        <div className="text-xs text-gray-500 mb-0.5">Est. Monthly Units</div>
                                        <div className="text-sm font-semibold text-gray-700">
                                          {units.toLocaleString()}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Share of Page Revenue */}
                                    {revenueShare !== null && (
                                      <div>
                                        <div className="text-xs text-gray-500 mb-0.5">Share of Page Revenue</div>
                                        <div className="text-sm font-semibold text-gray-700">
                                          {revenueShare}%
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              
                              {/* Badges */}
                              <div className="flex flex-wrap gap-1 mt-2">
                                {listing.sponsored && (
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
                                {listing.organic_rank !== null && (
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

                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* FEASIBILITY CALCULATOR                                     */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  <FeasibilityCalculator
                    defaultPrice={analysis.market_snapshot?.avg_price || null}
                    categoryHint={null} // TODO: Extract category from keyword if available
                    representativeAsin={analysis.market_snapshot?.representative_asin || null}
                  />
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
          selectedListing={selectedListing}
        />
      </div>
    </div>
  );
}
