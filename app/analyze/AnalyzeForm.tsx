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
    }>;
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
 * Get price interpretation (opinionated, deterministic)
 */
function getPriceInterpretation(avgPrice: number | null): string {
  if (avgPrice === null || avgPrice === undefined) return "";
  if (avgPrice < 15) return "Race-to-the-bottom pricing";
  if (avgPrice < 30) return "Tightly clustered price band";
  return "Room for premium positioning";
}

/**
 * Get review moat interpretation
 */
function getReviewBarrierInterpretation(avgReviews: number | null): string {
  if (avgReviews === null || avgReviews === undefined) return "";
  if (avgReviews < 1000) return "<1,000: Penetrable";
  if (avgReviews < 5000) return "1,000–5,000: Significant barrier";
  return "5,000+: High barrier";
}

/**
 * Get quality threshold interpretation
 */
function getQualityExpectationInterpretation(avgRating: number | null): string {
  if (avgRating === null || avgRating === undefined) return "";
  if (avgRating < 4.2) return "<4.2: Quality gap exists";
  if (avgRating < 4.7) return "4.2–4.6: Standard required";
  return "4.7+: Excellence required";
}

/**
 * Get competitive density interpretation
 */
function getCompetitionInterpretation(totalListings: number): string {
  if (totalListings < 20) return "<20: Low density";
  if (totalListings < 35) return "20–35: Moderate density";
  return "35+: High density";
}

/**
 * Get ad saturation interpretation
 */
function getPaidCompetitionInterpretation(sponsoredCount: number, totalListings: number): string {
  if (totalListings === 0) return "";
  const sponsoredRatio = sponsoredCount / totalListings;
  if (sponsoredRatio < 0.2) return "Low ad saturation";
  if (sponsoredRatio < 0.4) return "Moderate ad saturation";
  return "High ad saturation";
}

/**
 * Get CPI description based on score
 */
function getCPIDescription(score: number): string {
  if (score <= 30) {
    return "Structurally penetrable market";
  } else if (score <= 60) {
    return "Requires differentiation to compete";
  } else if (score <= 80) {
    return "Strong incumbents dominate Page 1";
  } else {
    return "Brand-locked market";
  }
}

/**
 * Calculate market pressure from avg_reviews, sponsored_count, and dominance_score
 * Returns: "Low" | "Moderate" | "High"
 */
function calculateMarketPressure(
  avgReviews: number | null,
  sponsoredCount: number,
  dominanceScore: number
): "Low" | "Moderate" | "High" {
  let pressureScore = 0;

  // Review barrier contribution (0-2 points)
  if (avgReviews !== null && avgReviews !== undefined) {
    if (avgReviews >= 5000) pressureScore += 2;
    else if (avgReviews >= 1000) pressureScore += 1;
  }

  // Sponsored competition contribution (0-2 points)
  // High sponsored count indicates paid competition pressure
  if (sponsoredCount >= 8) pressureScore += 2;
  else if (sponsoredCount >= 4) pressureScore += 1;

  // Brand dominance contribution (0-2 points)
  if (dominanceScore >= 40) pressureScore += 2;
  else if (dominanceScore >= 20) pressureScore += 1;

  // Map total score (0-6) to pressure level
  if (pressureScore <= 2) return "Low";
  if (pressureScore <= 4) return "Moderate";
  return "High";
}

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
      const marketSnapshot = data.decision.market_snapshot || null;
      
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
        market_snapshot: marketSnapshot && typeof marketSnapshot === 'object' && !Array.isArray(marketSnapshot) 
          ? marketSnapshot 
          : null,
        market_data: data.decision.market_data,
        asin_snapshot: asinSnapshot && typeof asinSnapshot === 'object' && !Array.isArray(asinSnapshot) && asinSnapshot !== null
          ? asinSnapshot
          : null,
        margin_snapshot: marginSnapshot && typeof marginSnapshot === 'object' && !Array.isArray(marginSnapshot) && marginSnapshot !== null
          ? marginSnapshot
          : undefined,
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
              {/* POST-ANALYSIS STATE: DATA-FIRST LAYOUT                        */}
              {/* Order: Page-1 Data → Decision → Summary → Risks → Actions → Limits */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* Defensive invariant: ensure analysis and decision exist */}
              {!analysis || !analysis.decision ? null : (
              <>
              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* SECTION 1: DATA SNAPSHOT (ALWAYS FIRST)                         */}
              {/* KEYWORD: Market Snapshot (Page-1 aggregation)                  */}
              {/* ASIN: ASIN Snapshot (single-product competitive analysis)      */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              
              {/* ─────────────────────────────────────────────────────────── */}
              {/* KEYWORD MODE: MARKET SNAPSHOT (PAGE-1 AGGREGATION)          */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === 'KEYWORD' && analysis.market_snapshot && (() => {
                const snapshot = analysis.market_snapshot;
                const listings = snapshot.listings || [];
                
                // Calculate metrics from listings if available, otherwise use snapshot aggregates
                const total30DayRevenue = listings.length > 0 
                  ? calculate30DayRevenue(listings)
                  : null; // Revenue calculation requires individual product data
                const total30DayUnits = listings.length > 0
                  ? calculate30DayUnits(listings)
                  : null; // Units calculation requires individual product data
                const avgBSR = listings.length > 0
                  ? calculateAvgBSR(listings)
                  : null; // BSR not available in current structure
                const avgPrice = snapshot.avg_price;
                const avgRating = snapshot.avg_rating;
                
                return (
                  <div className="bg-white border rounded-xl p-6 shadow-sm">
                    <div className="grid grid-cols-5 gap-4">
                      {/* 30-Day Revenue */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">30-Day Revenue (est.)</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {total30DayRevenue !== null ? formatCurrency(total30DayRevenue) : "—"}
                        </div>
                      </div>
                      {/* 30-Day Units */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">30-Day Units Sold (est.)</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {total30DayUnits !== null ? total30DayUnits.toLocaleString() : "—"}
                        </div>
                      </div>
                      {/* Avg BSR */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">Avg BSR</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {avgBSR !== null ? avgBSR.toLocaleString() : "—"}
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
                    </div>
                  </div>
                );
              })()}

              {/* ─────────────────────────────────────────────────────────── */}
              {/* KEYWORD MODE: PAGE-1 PRODUCT TABLE                          */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === 'KEYWORD' && analysis.market_snapshot?.listings && analysis.market_snapshot.listings.length > 0 && (() => {
                const listings = analysis.market_snapshot.listings!
                  .filter(l => l.asin && l.title) // Only valid listings
                  .map(l => ({
                    ...l,
                    estMonthlyRevenue: estimateMonthlyRevenue(l.price, l.reviews),
                  }))
                  .sort((a, b) => {
                    // Sort by revenue (desc)
                    const revA = a.estMonthlyRevenue || 0;
                    const revB = b.estMonthlyRevenue || 0;
                    return revB - revA;
                  });
                
                const totalPage1Revenue = listings
                  .map(l => l.estMonthlyRevenue)
                  .filter((r): r is number => r !== null)
                  .reduce((sum, r) => sum + r, 0);
                
                return (
                  <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b bg-gray-50">
                      <h2 className="text-lg font-semibold text-gray-900">Page-1 Products</h2>
                      <p className="text-xs text-gray-500 mt-1">Sorted by estimated revenue</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rating</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">BSR</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Est. Monthly Revenue</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue Share</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {listings.slice(0, 48).map((listing, idx) => {
                            const revenueShare = listing.estMonthlyRevenue && totalPage1Revenue > 0
                              ? (listing.estMonthlyRevenue / totalPage1Revenue) * 100
                              : 0;
                            
                            return (
                              <tr key={listing.asin || idx} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3 min-w-[300px]">
                                    {/* Placeholder for image - using text icon since image URL not in current structure */}
                                    <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                                      <span className="text-xs text-gray-400">IMG</span>
                                    </div>
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
                                  {listing.price !== null ? formatCurrency(listing.price) : "—"}
                                </td>
                                <td className="px-4 py-3 text-right text-sm text-gray-900">
                                  {listing.rating !== null && typeof listing.rating === 'number' && !isNaN(listing.rating)
                                    ? `${listing.rating.toFixed(1)} ★`
                                    : "—"}
                                </td>
                                <td className="px-4 py-3 text-right text-sm text-gray-900">
                                  {/* BSR not available in current structure */}
                                  —
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                                  {listing.estMonthlyRevenue !== null ? formatCurrency(listing.estMonthlyRevenue) : "—"}
                                </td>
                                <td className="px-4 py-3 text-right text-sm text-gray-600">
                                  {revenueShare > 0 ? `${revenueShare.toFixed(1)}%` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
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
                
                // Calculate Review Moat classification
                const getReviewMoatClassification = (reviews: number | null): string => {
                  if (reviews === null) return "Unknown";
                  if (reviews < 100) return "Weak";
                  if (reviews < 1000) return "Moderate";
                  if (reviews < 5000) return "Strong";
                  return "Extreme";
                };
                
                // Calculate Rating Strength classification
                const getRatingStrength = (rating: number | null): string => {
                  if (rating === null) return "Unknown";
                  if (rating >= 4.5) return "Excellent";
                  if (rating >= 4.0) return "Good";
                  if (rating >= 3.5) return "Fair";
                  return "Weak";
                };
                
                // Calculate Price Anchor (absolute price, not vs Page-1)
                const getPriceAnchor = (price: number | null): string => {
                  if (price === null) return "Unknown";
                  if (price < 15) return "Budget";
                  if (price < 30) return "Mid-range";
                  if (price < 50) return "Premium";
                  return "Luxury";
                };
                
                // Calculate Brand Power (from brand_owner)
                const getBrandPower = (brandOwner: string | null): string => {
                  if (brandOwner === "Amazon") return "Amazon Retail";
                  if (brandOwner === "Brand") return "Brand-Owned";
                  return "Third-Party";
                };
                
                // Calculate Displacement Difficulty (from pressure score)
                const getDisplacementDifficulty = (pressure: typeof asinData.pressure_score): string => {
                  if (!pressure) return "Unknown";
                  if (pressure.score <= 3) return "Low";
                  if (pressure.score <= 6) return "Moderate";
                  return "High";
                };
                
                return (
                  <div className="bg-white border rounded-xl p-6 shadow-sm">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">
                        ASIN Snapshot
                      </h2>
                      <p className="text-xs text-gray-500">
                        Single-product competitive analysis for displacement targeting
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Review Moat */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Review Moat</div>
                        <div className="text-lg font-semibold text-gray-900 mb-1">
                          {asinData.reviews !== null && typeof asinData.reviews === 'number'
                            ? asinData.reviews.toLocaleString()
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          {getReviewMoatClassification(asinData.reviews)} moat
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
                          {getRatingStrength(asinData.rating)} rating
                        </div>
                      </div>
                      
                      {/* Price Anchor */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Price Anchor</div>
                        <div className="text-lg font-semibold text-gray-900 mb-1">
                          {asinData.price !== null && typeof asinData.price === 'number'
                            ? formatCurrency(asinData.price)
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          {getPriceAnchor(asinData.price)} positioning
                        </div>
                      </div>
                      
                      {/* Brand Power */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Brand Power</div>
                        <div className="text-lg font-semibold text-gray-900 mb-1">
                          {asinData.brand_owner || "—"}
                        </div>
                        <div className="text-xs text-gray-600">
                          {getBrandPower(asinData.brand_owner)}
                        </div>
                      </div>
                      
                      {/* Displacement Difficulty */}
                      {pressure && (
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 md:col-span-2">
                          <div className="text-xs text-gray-500 mb-1">Displacement Difficulty</div>
                          <div className="text-lg font-semibold text-gray-900 mb-1">
                            {getDisplacementDifficulty(pressure)} — Score {pressure.score}/10
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            {pressure.explanation}
                          </div>
                        </div>
                      )}
                      
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
              {/* DECISION HEADER (VERDICT + CONFIDENCE)                       */}
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
                    {analysis.confidence_downgrades && analysis.confidence_downgrades.length > 0 && (
                      <div className="mt-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                          Reduced confidence
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Confidence downgrade explanations */}
                {analysis.confidence_downgrades && analysis.confidence_downgrades.length > 0 && (
                  <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                    <div className="font-medium mb-1">Confidence reduced due to:</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {analysis.confidence_downgrades.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* One-line interpretation */}
                <p className={`text-sm font-medium ${getVerdictStyles(analysis.decision.verdict).text}`}>
                  {analysisMode === "ASIN" ? (
                    // ASIN-specific verdict copy (competitive targeting)
                    <>
                      {analysis.decision.verdict === "GO" &&
                        "This ASIN is beatable with a differentiated offer."}
                      {analysis.decision.verdict === "CAUTION" &&
                        "This ASIN is strong but has identifiable weaknesses."}
                      {analysis.decision.verdict === "NO_GO" &&
                        "This ASIN is not a realistic competitive target for your seller profile."}
                    </>
                  ) : (
                    // KEYWORD-specific verdict copy (market decision)
                    <>
                      {analysis.decision.verdict === "GO" &&
                        "This product shows potential for your seller profile."}
                      {analysis.decision.verdict === "CAUTION" &&
                        "Proceed carefully — review risks before committing."}
                      {analysis.decision.verdict === "NO_GO" &&
                        "Not recommended for your current seller stage."}
                    </>
                  )}
                </p>
              </div>

              {/* ─────────────────────────────────────────────────────────── */}
              {/* COMPETITIVE PRESSURE INDEX (CPI) - KEYWORD ONLY             */}
              {/* - Decisive label showing competitive pressure               */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === "KEYWORD" && analysis.market_snapshot?.cpi && (
                <div className="bg-white border rounded-xl p-6 shadow-sm">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">
                      Competitive Pressure Index (CPI)
                    </h2>
                    <p className="text-xs text-gray-500">
                      Market competitiveness assessment
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="text-lg font-semibold text-gray-900">
                      {analysis.market_snapshot.cpi.label}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      CPI {analysis.market_snapshot.cpi.score} — {getCPIDescription(analysis.market_snapshot.cpi.score)}
                    </div>
                  </div>
                </div>
              )}

              {/* ─────────────────────────────────────────────────────────── */}
              {/* BLOCK 3: MARKET SNAPSHOT (KEYWORD ONLY)                     */}
              {/* - 4 compact stat cards (2x2 grid)                           */}
              {/* ─────────────────────────────────────────────────────────── */}
              {analysisMode === "KEYWORD" && analysis.market_snapshot && (
              <div className="bg-white border rounded-xl p-6 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">
                    Page 1 Market Snapshot
                  </h2>
                  <p className="text-xs text-gray-500">
                    Aggregated signals from current Page 1 results
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
                          ? "Page 1 price anchor"
                          : "Insufficient Page 1 data"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {getPriceInterpretation(analysis.market_snapshot.avg_price)}
                      </div>
                    </div>
                    {/* Card 2: Review Barrier */}
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1">Review Barrier</div>
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
                          ? "Review count you must match"
                          : "Insufficient Page 1 data"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {getReviewBarrierInterpretation(analysis.market_snapshot.avg_reviews)}
                      </div>
                    </div>
                    {/* Card 3: Quality Threshold */}
                    {analysis.market_snapshot.avg_rating !== null && 
                     analysis.market_snapshot.avg_rating !== undefined && 
                     !isNaN(analysis.market_snapshot.avg_rating) && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Quality Threshold</div>
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
                        <div className="text-[10px] text-gray-500 font-medium">
                          {getQualityExpectationInterpretation(analysis.market_snapshot.avg_rating)}
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
                          ? "Leading brand's Page 1 share"
                          : "Insufficient Page 1 data"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {analysis.market_snapshot.dominance_score !== undefined && 
                         analysis.market_snapshot.dominance_score !== null &&
                         typeof analysis.market_snapshot.dominance_score === 'number' &&
                         !isNaN(analysis.market_snapshot.dominance_score)
                          ? (analysis.market_snapshot.dominance_score >= 40
                              ? "Brand-dominated"
                              : analysis.market_snapshot.dominance_score >= 20
                              ? "Moderately concentrated"
                              : "Fragmented")
                          : ""}
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
                          ? "Competitors on Page 1"
                          : "Insufficient Page 1 data"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {analysis.market_snapshot.total_page1_listings !== undefined &&
                         analysis.market_snapshot.total_page1_listings !== null &&
                         typeof analysis.market_snapshot.total_page1_listings === 'number' &&
                         analysis.market_snapshot.total_page1_listings > 0
                          ? getCompetitionInterpretation(analysis.market_snapshot.total_page1_listings)
                          : ""}
                      </div>
                    </div>
                    {/* Card 7: Paid Pressure */}
                    {analysis.market_snapshot.sponsored_count !== undefined && 
                     analysis.market_snapshot.sponsored_count !== null && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Paid Pressure</div>
                        <div className="text-lg font-semibold text-gray-900 mb-0.5">
                          {typeof analysis.market_snapshot.sponsored_count === 'number' &&
                           analysis.market_snapshot.sponsored_count > 0
                            ? `${analysis.market_snapshot.sponsored_count} sponsored`
                            : "—"}
                        </div>
                        <div className="text-xs text-gray-600 mb-1">
                          {typeof analysis.market_snapshot.sponsored_count === 'number' &&
                           analysis.market_snapshot.sponsored_count > 0
                            ? "Paid ads on Page 1"
                            : "Insufficient Page 1 data"}
                        </div>
                        <div className="text-[10px] text-gray-500 font-medium">
                          {typeof analysis.market_snapshot.sponsored_count === 'number' &&
                           analysis.market_snapshot.sponsored_count > 0 &&
                           analysis.market_snapshot.total_page1_listings !== undefined &&
                           analysis.market_snapshot.total_page1_listings !== null &&
                           typeof analysis.market_snapshot.total_page1_listings === 'number' &&
                           analysis.market_snapshot.total_page1_listings > 0
                            ? getPaidCompetitionInterpretation(analysis.market_snapshot.sponsored_count, analysis.market_snapshot.total_page1_listings)
                            : ""}
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
              {/* BLOCK 5.5: MARGIN SNAPSHOT                                  */}
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
                      const marginMin = snapshot.net_margin_min_pct;
                      const marginMax = snapshot.net_margin_max_pct;
                      const breakevenMin = snapshot.breakeven_price_min;
                      const breakevenMax = snapshot.breakeven_price_max;
                      
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
                                {marginMin !== null && marginMax !== null
                                  ? `${marginMin.toFixed(1)}%–${marginMax.toFixed(1)}%`
                                  : "—"}
                              </div>
                            </div>

                            {/* Breakeven Price Range */}
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 md:col-span-2">
                              <div className="text-xs text-gray-500 mb-1">Breakeven Price Range</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {breakevenMin !== null && breakevenMax !== null
                                  ? `${formatCurrency(breakevenMin)}–${formatCurrency(breakevenMax)}`
                                  : "—"}
                              </div>
                            </div>
                          </div>
                          {/* Assumptions Disclosure */}
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <p className="text-xs text-gray-600 font-medium mb-2">Confidence: {confidenceReason}</p>
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
          marketSnapshot={analysis?.market_snapshot || null}
          analysisMode={analysisMode}
        />
      </div>
    </div>
  );
}
