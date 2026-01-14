"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ChatSidebar, { ChatMessage } from "./ChatSidebar";
import { normalizeListing } from "@/lib/amazon/normalizeListing";
import BrandMoatBlock from "./BrandMoatBlock";
import { ProductCard } from "@/app/components/ProductCard";
import SearchBar from "@/app/components/SearchBar";

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
  // Canonical Page-1 array (explicit for UI - ensures UI, aggregates, and cards all derive from ONE canonical Page-1 array)
  page_one_listings?: Array<{
    rank: number | null; // null for sponsored listings
    asin: string;
    title: string | null; // From Rainforest SEARCH response - null if truly missing
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: "FBA" | "FBM" | "AMZ";
    // brand removed (Phase 4: brand not in public product types)
    seller_country?: "US" | "CN" | "Other" | "Unknown"; // Optional - may be missing in stored data
    [key: string]: unknown; // Allow additional fields
  }>;
  
  // Aggregates derived from canonical Page-1 array (explicit for UI)
  aggregates_derived_from_page_one?: {
    avg_price: number;
    avg_rating: number;
    avg_bsr: number | null;
    total_monthly_units_est: number;
    total_monthly_revenue_est: number;
    page1_product_count: number;
  };
  
  // Products array (same as page_one_listings, kept for backward compatibility)
  products?: Array<{
    rank: number | null; // null for sponsored listings
    asin: string;
    title: string | null; // From Rainforest SEARCH response - null if truly missing
    image_url: string | null;
    price: number;
    rating: number;
    review_count: number;
    bsr: number | null;
    estimated_monthly_units: number;
    estimated_monthly_revenue: number;
    revenue_share_pct: number;
    fulfillment: "FBA" | "FBM" | "AMZ";
    // brand removed (Phase 4: brand not in public product types)
    seller_country?: "US" | "CN" | "Other" | "Unknown"; // Optional - may be missing in stored data
    [key: string]: unknown; // Allow additional fields
  }>;
  
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
  brand_moat?: {
    moat_strength: "strong" | "moderate" | "weak" | "none";
    total_brands_count: number;
    top_brand_revenue_share_pct: number;
    top_3_brands_revenue_share_pct: number;
    brand_breakdown?: Array<{
      brand: string;
      asin_count: number;
      total_revenue: number;
      revenue_share_pct: number;
    }>;
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
      // brand removed (Phase 4: brand not in public product types)
      image_url?: string | null;
      est_monthly_revenue?: number | null;
      est_monthly_units?: number | null;
      revenue_confidence?: "low" | "medium";
    }>;
    est_total_monthly_revenue_min?: number | null;
    est_total_monthly_revenue_max?: number | null;
    est_total_monthly_units_min?: number | null;
    est_total_monthly_units_max?: number | null;
    // Top 5 Brands Revenue Control
    top_5_brand_revenue_share_pct?: number | null; // % of total page-1 revenue controlled by top 5 brands
    top_5_brands?: Array<{
      brand: string;
      revenue: number;
      revenue_share_pct: number;
    }> | null; // Top 5 brands with revenue breakdown
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
  // ROUTER
  // ─────────────────────────────────────────────────────────────────────────
  const router = useRouter();

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
  
  // Store the actual analysisRunId (UUID) from API response for chat
  // This is separate from analysis.analysis_run_id which may be snapshot_id for Tier-1
  const [analysisRunIdForChat, setAnalysisRunIdForChat] = useState<string | null>(
    initialAnalysis?.analysis_run_id || null
  );
  // Track if current analysis is estimated (Tier-1) vs snapshot (Tier-2)
  const [isEstimated, setIsEstimated] = useState(false);
  const [snapshotType, setSnapshotType] = useState<"estimated" | "snapshot">("snapshot");
  // Track Tier-2 refinement status (from ui_hints)
  const [showRefiningBadge, setShowRefiningBadge] = useState(false);
  const [nextUpdateExpectedSec, setNextUpdateExpectedSec] = useState<number | null>(null);

  // Per-ASIN lazy refinement cache (client-side overlay; server caches in asin_refinement_cache)
  type AsinRefinementOverlay = {
    refined_units_range: { min: number; max: number };
    refined_estimated_revenue: number;
    current_price: number;
    current_bsr: number | null;
    confidence: "high" | "medium" | "low";
    expires_at?: string | null;
    data_source?: "rainforest_bought_last_month" | "bsr_curve";
    signals_used?: string[];
    data_timestamp?: string | null;
    stale?: boolean;
    served_from_cache?: boolean;
    cache_age_seconds?: number | null;
    credits_charged?: 0 | 1;
  };
  const [asinRefinements, setAsinRefinements] = useState<Record<string, AsinRefinementOverlay>>({});
  const [asinRefineStatus, setAsinRefineStatus] = useState<Record<string, "idle" | "loading" | "refined" | "error">>({});

  // Credit confirmation modal (UI-only gate before any Rainforest-triggering call)
  const [creditConfirm, setCreditConfirm] = useState<{
    open: boolean;
    asins: string[];
    cost: number;
    onConfirm: (() => void) | null;
  }>({ open: false, asins: [], cost: 0, onConfirm: null });

  const requestCreditConfirmation = useCallback((opts: {
    asins: string[];
    cost: number;
    onConfirm: () => void;
  }) => {
    setCreditConfirm({ open: true, asins: opts.asins, cost: opts.cost, onConfirm: opts.onConfirm });
  }, []);

  const refineAsinEstimates = useCallback(async (asin: string, currentPrice: number) => {
    if (!asin || !analysisRunIdForChat) return;
    if (asinRefineStatus[asin] === "loading") return;

    setAsinRefineStatus((prev) => ({ ...prev, [asin]: "loading" }));
    try {
      const res = await fetch("/api/asin/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin,
          analysisRunId: analysisRunIdForChat,
          currentPrice,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Refine failed (${res.status})`);
      }

      const status = (json.status as "ready" | "pending" | "insufficient_data" | undefined) || "ready";
      if (status !== "ready") {
        // If provider is slow, backend may return pending and refresh in background.
        // Do a single quick retry to improve perceived performance.
        if (status === "pending") {
          setTimeout(() => {
            // Best effort retry; no await
            refineAsinEstimates(asin, currentPrice);
          }, 1500);
          return;
        }
        throw new Error(json?.error || "Insufficient data");
      }

      const data = json.data as AsinRefinementOverlay | undefined;
      if (!data) throw new Error("Refine failed (missing data)");

      // Attach response metadata for future UI/analytics use
      const overlay: AsinRefinementOverlay = {
        ...data,
        data_source: json?.data?.data_source,
        signals_used: json?.signals_used,
        data_timestamp: json?.data_timestamp ?? null,
        stale: !!json?.stale,
        served_from_cache: !!json?.served_from_cache,
        cache_age_seconds: typeof json?.cache_age_seconds === "number" ? json.cache_age_seconds : null,
        credits_charged: json?.credits_charged === 1 ? 1 : 0,
      };

      setAsinRefinements((prev) => ({ ...prev, [asin]: overlay }));
      setAsinRefineStatus((prev) => ({ ...prev, [asin]: "refined" }));
    } catch (e) {
      console.error("ASIN_REFINE_FAILED", { asin, error: e instanceof Error ? e.message : String(e) });
      setAsinRefineStatus((prev) => ({ ...prev, [asin]: "error" }));
    }
  }, [analysisRunIdForChat, asinRefineStatus]);

  // UI-only gate: always confirm before triggering /api/asin/enrich (Rainforest-backed)
  const requestLoadSalesData = useCallback((asin: string, currentPrice: number) => {
    // Avoid double-confirm when already loading/refined
    const status = asinRefineStatus[asin];
    if (status === "loading") return;
    if (status === "refined") {
      // Reload still requires confirmation (explicit credit safety)
    }
    requestCreditConfirmation({
      asins: [asin],
      cost: 1,
      onConfirm: () => refineAsinEstimates(asin, currentPrice),
    });
  }, [asinRefineStatus, requestCreditConfirmation, refineAsinEstimates]);


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
  // Multi-ASIN selection state (replaces single selectedListing)
  const [selectedAsins, setSelectedAsins] = useState<string[]>([]);
  
  // Helper: Get selected listing objects from selectedAsins
  // CRITICAL: Use exact ASIN matching - selectedAsins is the single source of truth
  const getSelectedListings = () => {
    if (!analysis?.page_one_listings || selectedAsins.length === 0) return [];
    return analysis.page_one_listings.filter((listing: any) => {
      const listingAsin = listing.asin || null;
      return listingAsin && selectedAsins.includes(listingAsin);
    });
  };
  
  // Helper: Get single selected listing (for backward compatibility with ChatSidebar)
  // CRITICAL: Only return a listing if exactly 1 ASIN is selected
  const selectedListing = selectedAsins.length === 1 
    ? (analysis?.page_one_listings || []).find((listing: any) => {
        const listingAsin = listing.asin || normalizeListing(listing).asin || null;
        return listingAsin === selectedAsins[0];
      }) || null
    : null;
  
  // Sort state for Page 1 Results (default to rank to preserve Amazon order)
  const [sortBy, setSortBy] = useState<"rank" | "price-asc" | "price-desc" | "revenue-desc" | "units-desc" | "reviews-desc" | "rating-desc">("rank");
  
  // Filter state for Page 1 Results
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedFulfillment, setSelectedFulfillment] = useState<Set<"FBA" | "FBM">>(new Set());
  const [sponsoredFilter, setSponsoredFilter] = useState<"only" | "exclude" | null>(null);
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const brandDropdownRef = useRef<HTMLDivElement>(null);

  // Chat sidebar resizing and collapsing state
  const [sidebarWidth, setSidebarWidth] = useState(420); // Default width
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarResizeRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS: Sync props to state when URL changes (page refresh or navigation)
  // ─────────────────────────────────────────────────────────────────────────

  // Load sidebar width and collapsed state from localStorage on mount
  useEffect(() => {
    const savedWidth = localStorage.getItem("chatSidebarWidth");
    const savedCollapsed = localStorage.getItem("chatSidebarCollapsed");
    
    if (savedWidth) {
      const width = parseInt(savedWidth, 10);
      if (width >= 360 && width <= 620) {
        setSidebarWidth(width);
      }
    }
    
    if (savedCollapsed === "true") {
      setIsSidebarCollapsed(true);
    }
  }, []);

  // Save sidebar width and collapsed state to localStorage when they change
  useEffect(() => {
    localStorage.setItem("chatSidebarWidth", sidebarWidth.toString());
    localStorage.setItem("chatSidebarCollapsed", isSidebarCollapsed.toString());
  }, [sidebarWidth, isSidebarCollapsed]);
  
  // Close brand dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (brandDropdownRef.current && !brandDropdownRef.current.contains(event.target as Node)) {
        setBrandDropdownOpen(false);
      }
    };
    
    if (brandDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [brandDropdownOpen]);

  // Sync initialAnalysis prop to state when analysis_run_id changes
  // This handles URL navigation between different analyses (browser back/forward, refresh, direct URL entry)
  // Note: When creating new analysis via router.replace(), props won't change, so state is updated directly in analyze()
  useEffect(() => {
    // Sync analysis state when initialAnalysis prop changes (indicates URL navigation or refresh)
    if (initialAnalysis) {
      setAnalysis(normalizeAnalysis(initialAnalysis));
      setInputValue(initialAnalysis.input_value || "");
      setIsEstimated(false);
      setSnapshotType("snapshot");
      setChatMessages(initialMessages);
      // Reset sort to default (Amazon rank) when new analysis loads
      setSortBy("rank");
      // Reset filters when new analysis loads
      setSelectedBrands(new Set());
      setSelectedFulfillment(new Set());
      setSponsoredFilter(null);
      setBrandDropdownOpen(false);
    } else {
      // No initialAnalysis means no run param - reset to blank state
      // Only reset if we currently have an analysis loaded (avoid resetting on initial mount)
      if (analysis !== null) {
        setAnalysis(null);
        setInputValue("");
      setIsEstimated(false);
      setSnapshotType("snapshot");
      setShowRefiningBadge(false);
      setNextUpdateExpectedSec(null);
      setChatMessages([]);
      setSortBy("rank");
      // Reset filters when resetting to blank state
      setSelectedBrands(new Set());
      setSelectedFulfillment(new Set());
      setSponsoredFilter(null);
      setBrandDropdownOpen(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnalysis?.analysis_run_id]); // Sync when analysis_run_id changes (different analysis loaded)

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
    setAnalysisRunIdForChat(null); // Clear analysisRunId for chat
    setChatMessages([]); // Clear previous chat
    setIsEstimated(false); // Reset estimated flag
    setSnapshotType("snapshot"); // Reset snapshot type
    setShowRefiningBadge(false); // Reset refinement badge
    setNextUpdateExpectedSec(null); // Reset update timer
    setSortBy("rank"); // Reset sort to default (Amazon rank)
    // Reset filters when new analysis starts
    setSelectedBrands(new Set());
    setSelectedFulfillment(new Set());
    setSponsoredFilter(null);
    setBrandDropdownOpen(false);

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
        has_snapshot: !!data.snapshot,
        has_snapshot_id: !!data.snapshot?.snapshot_id,
        has_decision: !!data.decision,
        tier: data.tier,
        error: data.error 
      });

      // Handle queued response (status: "queued") - keyword is being processed
      // CHECK THIS FIRST before error checks, since 202 is a valid success response
      if (data.status === "queued" || res.status === 202) {
        console.log("ANALYZE_QUEUED", {
          status: data.status,
          message: data.message,
          keyword: data.keyword,
        });
        setError(data.message || "Analysis queued. Ready in ~5–10 minutes.");
        setLoading(false);
        return;
      }

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

      // ═══════════════════════════════════════════════════════════════════════════
      // TIER-1 SNAPSHOT RESPONSE HANDLING (NEW)
      // ═══════════════════════════════════════════════════════════════════════════
      // Check for Tier-1 snapshot response (new contract)
      if (data.snapshot && data.snapshot.snapshot_id) {
        const snapshot = data.snapshot;
        const snapshotId = snapshot.snapshot_id;
        // Use analysisRunId if available (for chat), otherwise fall back to snapshot_id
        const analysisRunId = data.analysisRunId || snapshotId;
        
        console.log("TIER1_SNAPSHOT_RECEIVED", {
          snapshot_id: snapshotId,
          analysisRunId: analysisRunId,
          product_count: snapshot.products?.length || 0,
          show_refining_badge: data.ui_hints?.show_refining_badge || false,
        });

        // Store Tier-2 refinement hints
        setShowRefiningBadge(data.ui_hints?.show_refining_badge || false);
        setNextUpdateExpectedSec(data.ui_hints?.next_update_expected_sec || null);

        // Transform Tier-1 snapshot to AnalysisResponse format
        // Convert Tier1Product[] to page_one_listings format
        const pageOneListings = (snapshot.products || []).map((p: any) => ({
          rank: p.organic_rank,
          asin: p.asin,
          title: p.title,
          image_url: p.image_url,
          price: p.price || 0,
          rating: p.rating,
          review_count: p.review_count,
          bsr: null, // Tier-1 doesn't include BSR
          estimated_monthly_units: p.estimated_monthly_units || 0,
          estimated_monthly_revenue: p.estimated_monthly_revenue || 0,
          revenue_share_pct: snapshot.aggregates?.total_page1_revenue 
            ? (p.estimated_monthly_revenue || 0) / snapshot.aggregates.total_page1_revenue * 100
            : 0,
          fulfillment: p.fulfillment || "Unknown",
          brand: p.brand,
          seller_country: "Unknown" as const,
        }));

        // Build market_snapshot from Tier-1 aggregates
        const marketSnapshot = {
          keyword: snapshot.keyword,
          avg_price: snapshot.aggregates?.avg_price || null,
          avg_reviews: snapshot.aggregates?.avg_reviews || null,
          avg_rating: snapshot.aggregates?.avg_rating || null,
          total_page1_listings: snapshot.products?.length || 0,
          sponsored_count: snapshot.products?.filter((p: any) => p.is_sponsored).length || 0,
          dominance_score: 0, // Tier-2 will compute this
          listings: pageOneListings,
        };

        // Create AnalysisResponse with analysisRunId (UUID) for chat compatibility
        // Use analysisRunId if available (for chat API), otherwise use snapshot_id as fallback
        const analysisData: AnalysisResponse = {
          analysis_run_id: analysisRunId, // Use analysisRunId (UUID) for chat, snapshot_id as fallback
          created_at: snapshot.created_at || new Date().toISOString(),
          input_type: "keyword",
          input_value: inputValue.trim(),
          // Tier-1 doesn't have AI decision yet - create placeholder
          decision: {
            verdict: "CAUTION" as const,
            confidence: 0.5,
          },
          executive_summary: "Market analysis in progress. Refining accuracy...",
          reasoning: {
            primary_factors: ["Initial market snapshot available"],
            seller_context_impact: "Analysis refining in background",
          },
          risks: {
            competition: { level: "Medium" as const, explanation: "Analysis refining" },
            pricing: { level: "Medium" as const, explanation: "Analysis refining" },
            differentiation: { level: "Medium" as const, explanation: "Analysis refining" },
            operations: { level: "Medium" as const, explanation: "Analysis refining" },
          },
          recommended_actions: {
            must_do: [],
            should_do: [],
            avoid: [],
          },
          assumptions_and_limits: ["Initial snapshot - refinement in progress"],
          market_snapshot: marketSnapshot,
          page_one_listings: pageOneListings,
          products: pageOneListings,
          aggregates_derived_from_page_one: {
            avg_price: snapshot.aggregates?.avg_price || 0,
            avg_rating: snapshot.aggregates?.avg_rating || 0,
            avg_bsr: null,
            total_monthly_units_est: snapshot.aggregates?.total_page1_units || 0,
            total_monthly_revenue_est: snapshot.aggregates?.total_page1_revenue || 0,
            page1_product_count: snapshot.products?.length || 0,
          },
        };

        console.log("TIER1_ANALYSIS_CREATED", {
          snapshot_id: snapshotId,
          analysisRunId: analysisRunId,
          product_count: pageOneListings.length,
        });

        // Store the actual analysisRunId (UUID) for chat
        setAnalysisRunIdForChat(analysisRunId);

        // Store estimated flag and snapshot type
        setIsEstimated(false); // Tier-1 is real data, not estimated
        setSnapshotType("snapshot");

        // Normalize and set analysis
        setAnalysis(normalizeAnalysis(analysisData));
        setError(null);

        // Update URL with snapshot_id for persistence
        // Use snapshot_id instead of run_id
        router.replace(`/analyze?snapshot=${snapshotId}`, { scroll: false });

        setLoading(false);
        return; // Early return - Tier-1 is complete
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // LEGACY RESPONSE HANDLING (OLD CONTRACT)
      // ═══════════════════════════════════════════════════════════════════════════
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

      // Legacy: Check for analysisRunId (old contract)
      if (!data.analysisRunId) {
        console.error("ANALYZE_MISSING_RUN_ID", { data });
        setError("Analysis failed to produce a snapshot or run ID");
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
        // Extract canonical Page-1 products from decision (final authority)
        page_one_listings: data.decision.page_one_listings ?? [],
        products: data.decision.products ?? [],
        aggregates_derived_from_page_one: data.decision.aggregates_derived_from_page_one,
      };
      
      console.log("ANALYZE_SUCCESS", { 
        analysisRunId: data.analysisRunId,
        has_analysis: !!analysisData,
        estimated: data.estimated || false,
        dataSource: data.dataSource || 'snapshot',
      });

      // Store the actual analysisRunId (UUID) for chat
      if (data.analysisRunId) {
        setAnalysisRunIdForChat(data.analysisRunId);
      }

      // Store estimated flag and snapshot type for UI badges
      setIsEstimated(data.estimated === true || data.dataSource === 'estimated');
      setSnapshotType(data.snapshotType === 'estimated' ? 'estimated' : 'snapshot');

      // Normalize and set analysis
      setAnalysis(normalizeAnalysis(analysisData));
      setError(null);

      // Update URL with the new analysis run ID for persistence (legacy contract)
      // Use replace() to avoid adding to history stack
      if (data.analysisRunId) {
        router.replace(`/analyze?run=${data.analysisRunId}`, { scroll: false });
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Analysis failed";
      console.error("ANALYZE_EXCEPTION", { error: errorMessage, exception: e });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SIDEBAR RESIZE HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // When dragging left (negative diff), increase width. When dragging right (positive diff), decrease width.
      const diff = startX - moveEvent.clientX;
      const newWidth = Math.max(360, Math.min(620, startWidth + diff));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [sidebarWidth]);

  const handleToggleCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

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
    <div className="h-full bg-[#F7F9FC] flex flex-col">
      {/* Credit confirmation modal (UI-only gate before any Rainforest-triggering call) */}
      {creditConfirm.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-gray-200 shadow-xl p-5">
            <div className="text-sm font-semibold text-gray-900 mb-2">
              Confirm credit usage
            </div>
            <div className="text-sm text-gray-700 leading-relaxed">
              This will use <span className="font-medium">{creditConfirm.cost}</span>{" "}
              Seller Credit{creditConfirm.cost === 1 ? "" : "s"} to load live product data for{" "}
              {creditConfirm.asins.length === 1 ? (
                <span className="font-mono font-medium">{creditConfirm.asins[0]}</span>
              ) : (
                <>
                  <span className="font-medium">{creditConfirm.asins.length}</span> ASINs
                </>
              )}
              . Continue?
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreditConfirm({ open: false, asins: [], cost: 0, onConfirm: null })}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const fn = creditConfirm.onConfirm;
                  setCreditConfirm({ open: false, asins: [], cost: 0, onConfirm: null });
                  fn?.();
                }}
                className="px-3 py-2 text-sm font-medium text-white bg-[#3B82F6] rounded-lg hover:bg-[#2563EB]"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MAIN CONTENT: TWO-COLUMN FLEXBOX LAYOUT                             */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden bg-[#F7F9FC] flex" style={{ minHeight: 0 }}>
        {/* ─────────────────────────────────────────────────────────────── */}
        {/* LEFT COLUMN: MARKET DATA & PRODUCTS (SCROLLABLE)                 */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-[#F7F9FC]" style={{ minHeight: 0 }}>
          {/* ─────────────────────────────────────────────────────────────── */}
          {/* SEARCH BAR (IN MAIN CONTENT - SCROLLS WITH CONTENT)             */}
          {/* ─────────────────────────────────────────────────────────────── */}
          <div className="bg-white px-6 py-6 border-b border-gray-200">
            <SearchBar
              inputValue={inputValue}
              onInputChange={(value) => {
                setInputValue(value);
                setInputError(null);
              }}
              onAnalyze={analyze}
              loading={loading}
              readOnly={readOnly}
              inputError={inputError}
            />

            {/* Global Error */}
            {error && (
              <div className="mt-4">
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
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
              </div>
            )}

            {/* Read-only banner */}
            {readOnly && (
              <div className="mt-4">
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-blue-700 text-sm">
                    Viewing saved analysis. Chat is available for follow-up questions.
                  </p>
                </div>
              </div>
            )}
          </div>

          {!analysis ? (
            /* PRE-ANALYSIS STATE */
            <div className="flex items-center justify-center min-h-[calc(100vh-16rem)] py-20 px-6">
              <div className="text-center max-w-md">
                <div className="w-20 h-20 mx-auto mb-6 bg-gray-100/60 backdrop-blur-sm rounded-full flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-gray-400"
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
                <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                  Ready to Search
                </h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  Enter a product keyword above to see Page 1 results with market intelligence.
                  Click any product to ask questions about it.
                </p>
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 space-y-6">
              {/* KEYWORD ANALYSIS: Interactive Amazon-style search */}
              {analysis.market_snapshot ? (
                <>
                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* UNIFIED MARKET SNAPSHOT (CANONICAL - ONE ONLY)              */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {(() => {
                    const snapshot = analysis.market_snapshot;
                    
                    // ═══════════════════════════════════════════════════════════════════════════
                    // UI MUST NOT SECOND-GUESS DATA
                    // Always use canonical Page-1 listings when available
                    // ═══════════════════════════════════════════════════════════════════════════
                    let pageOneListings: any[] = [];
                    
                    // Priority 1: Use canonical page_one_listings (EXPLICIT check - prevent empty array overwrite)
                    if (analysis.page_one_listings && Array.isArray(analysis.page_one_listings) && analysis.page_one_listings.length > 0) {
                      pageOneListings = analysis.page_one_listings;
                    }
                    // Priority 2: Use products (same as page_one_listings, different field name)
                    else if (analysis.products && Array.isArray(analysis.products) && analysis.products.length > 0) {
                      pageOneListings = analysis.products;
                    }
                    // Priority 3: Fallback to snapshot listings (for backward compatibility only)
                    else if (snapshot?.listings && Array.isArray(snapshot.listings) && snapshot.listings.length > 0) {
                      pageOneListings = snapshot.listings;
                    }
                    // CRITICAL: Do NOT assign empty array if pageOneListings already has data (prevent data loss on re-render)
                    // If none of the above match, pageOneListings remains empty [] (intentional)
                    
                    // Normalize listings to calculate metrics
                    // CRITICAL: Do NOT filter out listings without titles - title is optional
                    // Only require ASIN (which is required for all listings)
                    const normalizedListings = pageOneListings
                      .filter((l: any) => {
                        // Only filter out listings without ASIN (ASIN is required)
                        const asin = l.asin || normalizeListing(l).asin;
                        return asin && asin.trim().length > 0;
                      })
                      .map((l: any) => ({
                        ...normalizeListing(l),
                        // Preserve title and image_url from original listing (may be empty, that's ok)
                        title: l.title || normalizeListing(l).title || null, // Never fabricate placeholders
                        image_url: l.image_url || l.image || normalizeListing(l).image || null,
                        est_monthly_revenue: l.est_monthly_revenue ?? l.estimated_monthly_revenue ?? null,
                        est_monthly_units: l.est_monthly_units ?? l.estimated_monthly_units ?? null,
                      }));
                    
                    // Calculate metrics from canonical Page-1 array (NOT snapshot)
                    // Use aggregates_derived_from_page_one if available, otherwise calculate from pageOneListings
                    const aggregates = analysis.aggregates_derived_from_page_one;
                    const page1Count = aggregates?.page1_product_count ?? normalizedListings.length;
                    const keyword = snapshot?.keyword ?? analysis.input_value ?? "";
                    
                    // CRITICAL: Use aggregates from canonical Page-1 array (guaranteed to be numeric when listings exist)
                    // If listings exist, aggregates must always be numeric (never "Estimating...")
                    // HARD INVARIANT: If page_one_listings.length > 0, snapshot MUST resolve (never "Estimating...")
                    // Use pageOneListings (raw) for hasListings check, not normalizedListings (which may be filtered)
                    const hasListings = pageOneListings.length > 0;
                    
                    // Log error if invariant is violated
                    if (pageOneListings.length > 0 && !hasListings) {
                      console.error("🔴 HARD INVARIANT VIOLATION: page_one_listings.length > 0 but hasListings is false", {
                        page_one_listings_length: pageOneListings.length,
                        normalized_listings_length: normalizedListings.length,
                      });
                    }
                    
                    // Average Price - always numeric when listings exist
                    const avgPrice = hasListings 
                      ? (aggregates?.avg_price ?? (normalizedListings.filter((l: any) => l.price > 0).length > 0
                          ? normalizedListings.reduce((sum: number, l: any) => sum + (l.price || 0), 0) / normalizedListings.filter((l: any) => l.price > 0).length
                          : 0))
                      : 0;
                    
                    // Average BSR - use aggregates or calculate from listings (null is valid when no BSRs available)
                    const bsrListings = normalizedListings.filter((l: any) => l.bsr !== null && l.bsr !== undefined && l.bsr > 0);
                    const avgBSR = hasListings
                      ? (aggregates?.avg_bsr ?? (bsrListings.length > 0
                          ? Math.round(bsrListings.reduce((sum: number, l: any) => sum + (l.bsr || 0), 0) / bsrListings.length)
                          : null))
                      : null;
                    
                    // Monthly Units - SUM from page-one products (EXPLICIT: estimated_monthly_units only)
                    // Use the actual pageOneListings array (canonical source) - SAME source as cards
                    // Do NOT use snapshot aggregates, legacy fields, or calculated values
                    const monthlyUnits = hasListings && pageOneListings.length > 0
                      ? pageOneListings.reduce((sum: number, product: any) => {
                          // EXPLICIT: Only use estimated_monthly_units field - no fallbacks
                          const units = product.estimated_monthly_units;
                          // Include ALL numeric values (including 0) - only exclude null/undefined
                          if (typeof units === 'number') {
                            return sum + units; // Include 0 values too
                          }
                          return sum; // Skip null/undefined
                        }, 0)
                      : null;
                    
                    // Monthly Revenue - SUM from page-one products (EXPLICIT: estimated_monthly_revenue only)
                    // Use the actual pageOneListings array (canonical source) - SAME source as cards
                    // Do NOT use snapshot aggregates, legacy fields, or calculated values
                    const monthlyRevenue = hasListings && pageOneListings.length > 0
                      ? pageOneListings.reduce((sum: number, product: any) => {
                          // EXPLICIT: Only use estimated_monthly_revenue field - no fallbacks
                          const revenue = product.estimated_monthly_revenue;
                          // Include ALL numeric values (including 0) - only exclude null/undefined
                          if (typeof revenue === 'number') {
                            return sum + revenue; // Include 0 values too
                          }
                          return sum; // Skip null/undefined
                        }, 0)
                      : null;
                    
                    // Average Rating - calculate from page_one_listings (canonical products) or aggregates
                    let avgRating = 0;
                    if (hasListings) {
                      // Priority 1: Use aggregates.avg_rating (from canonical products)
                      if (aggregates?.avg_rating && aggregates.avg_rating > 0) {
                        avgRating = aggregates.avg_rating;
                      } else {
                        // Priority 2: Calculate from page_one_listings (they have rating field directly)
                        const ratingsList = pageOneListings.filter((l: any) => l.rating !== null && l.rating !== undefined && l.rating > 0);
                        if (ratingsList.length > 0) {
                          avgRating = ratingsList.reduce((sum: number, l: any) => sum + (l.rating || 0), 0) / ratingsList.length;
                        }
                      }
                    }
                    
                    // Brand count from snapshot (must reflect Page-1 listings reality)
                    // Prefer brand_stats.page1_brand_count, fallback to legacy total_page1_brands.
                    const page1BrandCount =
                      (snapshot as any)?.brand_stats?.page1_brand_count ??
                      (snapshot as any)?.total_page1_brands ??
                      null;
                    const top5BrandSharePct = (snapshot as any)?.top_5_brand_revenue_share_pct ?? null;
                    
                    // Search Volume
                    let searchVolume: string = "Estimating…";
                    if (snapshot?.search_volume && typeof snapshot.search_volume === 'object') {
                      const sv = snapshot.search_volume as { min: number; max: number };
                      const minK = sv.min >= 1000 ? Math.round(sv.min / 1000) : sv.min;
                      const maxK = sv.max >= 1000 ? Math.round(sv.max / 1000) : sv.max;
                      searchVolume = `${minK}${sv.min >= 1000 ? 'k' : ''}–${maxK}${sv.max >= 1000 ? 'k' : ''}`;
                    } else if (snapshot?.search_demand?.search_volume_range) {
                      searchVolume = snapshot.search_demand.search_volume_range;
                    }
                    
                    return (
                      <div className="bg-white border rounded-lg p-6">
                        {/* Tier-2 Refinement Badge (non-blocking) */}
                        {showRefiningBadge && (
                          <div className="mb-4 flex items-center gap-2">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200 animate-pulse">
                              Refining
                            </span>
                            <span className="text-xs text-gray-600">
                              Refining market accuracy in background{nextUpdateExpectedSec ? ` (${nextUpdateExpectedSec}s)` : ""}...
                            </span>
                          </div>
                        )}
                        {/* Data Source Badge */}
                        {snapshotType === "estimated" ? (
                          <div className="mb-4 flex items-center gap-2">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                              Estimated
                            </span>
                            <span className="text-xs text-gray-600">
                              Initial estimates based on Page-1 visibility and listing position. Refining with live Amazon category data.
                            </span>
                          </div>
                        ) : (
                          <div className="mb-4 flex items-center gap-2">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                              Live
                            </span>
                            <span className="text-xs text-gray-600">
                              Calculated using live Amazon category rankings.
                            </span>
                          </div>
                        )}
                        
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Market Snapshot</h2>
                        
                        {/* Canonical Metrics - Exact Order */}
                        <div className="grid grid-cols-3 gap-6">
                          {/* 1. Keyword */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Keyword</div>
                            <div className="text-lg font-semibold text-gray-900">{keyword || "—"}</div>
                          </div>
                          
                          {/* 2. Number of Products */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Number of Products</div>
                            <div className="text-lg font-semibold text-gray-900">{page1Count}</div>
                          </div>
                          
                          {/* 3. Brands on Page 1 */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Page-1 Brands</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {page1BrandCount !== null 
                                ? `Page-1 contains ${page1BrandCount} ${page1BrandCount === 1 ? 'brand' : 'brands'}`
                                : "—"}
                            </div>
                          </div>
                          
                          {/* 4. Average Price */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Average Price</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {hasListings && avgPrice > 0 ? formatCurrency(avgPrice) : (pageOneListings.length > 0 ? formatCurrency(avgPrice || 0) : "Estimating…")}
                            </div>
                          </div>
                          
                          {/* 5. Monthly Units */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Monthly Units</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {monthlyUnits !== null && monthlyUnits !== undefined
                                ? (monthlyUnits === 0 ? "0" : monthlyUnits.toLocaleString())
                                : "—"}
                            </div>
                          </div>
                          
                          {/* 6. Monthly Revenue */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Monthly Revenue</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {monthlyRevenue !== null && monthlyRevenue !== undefined
                                ? (monthlyRevenue === 0 ? "$0.00" : formatCurrency(monthlyRevenue))
                                : "—"}
                            </div>
                          </div>
                          
                          {/* 7. Average Rating */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Average Rating</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {hasListings && !isNaN(avgRating) && avgRating > 0 
                                ? `${avgRating.toFixed(1)} ★` 
                                : "Estimating…"}
                            </div>
                          </div>
                          
                          {/* 8. Top 5 Brands Control */}
                          {top5BrandSharePct !== null && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Top 5 Brands Control</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {top5BrandSharePct.toFixed(1)}%
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ─────────────────────────────────────────────────────────── */}
                  {/* BRAND MOAT BLOCK                                            */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {analysis.brand_moat && (
                    <BrandMoatBlock
                      moat_strength={analysis.brand_moat.moat_strength}
                      total_brands_count={analysis.brand_moat.total_brands_count}
                      top_brand_revenue_share_pct={analysis.brand_moat.top_brand_revenue_share_pct}
                      top_3_brands_revenue_share_pct={analysis.brand_moat.top_3_brands_revenue_share_pct}
                      brand_breakdown={analysis.brand_moat.brand_breakdown || []}
                      onBrandHover={(brand) => {
                        // Optional: Highlight listings with matching brand
                        // This can be implemented later if needed
                      }}
                    />
                  )}

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
                  {/* PAGE 1 RESULTS - Amazon-Style Grid                          */}
                  {/* ─────────────────────────────────────────────────────────── */}
                  {(() => {
                    // ═══════════════════════════════════════════════════════════════════════════
                    // UI IS DUMB RENDERER - NO BLOCKING GUARDS
                    // ═══════════════════════════════════════════════════════════════════════════
                    // Canonical Page-1 is final authority - render whatever is available
                    
                    const snapshot = analysis.market_snapshot;
                    
                    // ═══════════════════════════════════════════════════════════════════════════
                    // STABLE SOURCE: Use single canonical source to prevent data loss on re-render
                    // MUST match Market Snapshot section priority logic exactly
                    // Priority: page_one_listings > products > snapshot.listings
                    // ═══════════════════════════════════════════════════════════════════════════
                    // Use stable source - EXACT SAME LOGIC as Market Snapshot section above
                    let pageOneListings: any[] = [];
                    
                    // Priority 1: Use canonical page_one_listings (EXPLICIT check - prevent empty array overwrite)
                    if (analysis.page_one_listings && Array.isArray(analysis.page_one_listings) && analysis.page_one_listings.length > 0) {
                      pageOneListings = analysis.page_one_listings;
                    }
                    // Priority 2: Use products (same as page_one_listings, different field name)
                    else if (analysis.products && Array.isArray(analysis.products) && analysis.products.length > 0) {
                      pageOneListings = analysis.products;
                    }
                    // Priority 3: Fallback to snapshot listings (for backward compatibility only)
                    else if (snapshot?.listings && Array.isArray(snapshot.listings) && snapshot.listings.length > 0) {
                      pageOneListings = snapshot.listings;
                    }
                    // CRITICAL: Do NOT assign empty array if pageOneListings already has data (prevent data loss on re-render)
                    // If none of the above match, pageOneListings remains empty [] (intentional)
                
                    // Sort listings based on selected sort option
                    // Create a derived sorted array (do NOT mutate original)
                    const sortedListings = [...pageOneListings].sort((a: any, b: any) => {
                      switch (sortBy) {
                        case "rank":
                          // Default: preserve Amazon order using page_position
                          const aPos = a.page_position ?? a.organic_rank ?? 999;
                          const bPos = b.page_position ?? b.organic_rank ?? 999;
                          return aPos - bPos;
                        
                        case "price-asc":
                          // Price: Low → High
                          const aPrice = a.price ?? 0;
                          const bPrice = b.price ?? 0;
                          if (aPrice === bPrice) {
                            // Tie-breaker: use rank
                            const aPos2 = a.page_position ?? a.organic_rank ?? 999;
                            const bPos2 = b.page_position ?? b.organic_rank ?? 999;
                            return aPos2 - bPos2;
                          }
                          return aPrice - bPrice;
                        
                        case "price-desc":
                          // Price: High → Low
                          const aPrice2 = a.price ?? 0;
                          const bPrice2 = b.price ?? 0;
                          if (aPrice2 === bPrice2) {
                            // Tie-breaker: use rank
                            const aPos3 = a.page_position ?? a.organic_rank ?? 999;
                            const bPos3 = b.page_position ?? b.organic_rank ?? 999;
                            return aPos3 - bPos3;
                          }
                          return bPrice2 - aPrice2;
                        
                        case "revenue-desc":
                          // Monthly Revenue: High → Low
                          const aRev = a.estimated_monthly_revenue ?? 0;
                          const bRev = b.estimated_monthly_revenue ?? 0;
                          if (aRev === bRev) {
                            // Tie-breaker: use rank
                            const aPos4 = a.page_position ?? a.organic_rank ?? 999;
                            const bPos4 = b.page_position ?? b.organic_rank ?? 999;
                            return aPos4 - bPos4;
                          }
                          return bRev - aRev;
                        
                        case "units-desc":
                          // Monthly Units: High → Low
                          const aUnits = a.estimated_monthly_units ?? 0;
                          const bUnits = b.estimated_monthly_units ?? 0;
                          if (aUnits === bUnits) {
                            // Tie-breaker: use rank
                            const aPos5 = a.page_position ?? a.organic_rank ?? 999;
                            const bPos5 = b.page_position ?? b.organic_rank ?? 999;
                            return aPos5 - bPos5;
                          }
                          return bUnits - aUnits;
                        
                        case "reviews-desc":
                          // Reviews: High → Low
                          const aReviews = a.review_count ?? a.reviews ?? 0;
                          const bReviews = b.review_count ?? b.reviews ?? 0;
                          if (aReviews === bReviews) {
                            // Tie-breaker: use rank
                            const aPos6 = a.page_position ?? a.organic_rank ?? 999;
                            const bPos6 = b.page_position ?? b.organic_rank ?? 999;
                            return aPos6 - bPos6;
                          }
                          return bReviews - aReviews;
                        
                        case "rating-desc":
                          // Rating: High → Low
                          const aRating = a.rating ?? 0;
                          const bRating = b.rating ?? 0;
                          if (aRating === bRating) {
                            // Tie-breaker: use rank
                            const aPos7 = a.page_position ?? a.organic_rank ?? 999;
                            const bPos7 = b.page_position ?? b.organic_rank ?? 999;
                            return aPos7 - bPos7;
                          }
                          return bRating - aRating;
                        
                        default:
                          // Fallback to rank
                          const aPosDefault = a.page_position ?? a.organic_rank ?? 999;
                          const bPosDefault = b.page_position ?? b.organic_rank ?? 999;
                          return aPosDefault - bPosDefault;
                      }
                    });
                    
                    // Extract brands from listings with counts for filter dropdown
                    // Normalize brand names (trim, lowercase) for grouping
                    const brandCounts = new Map<string, { normalized: string; display: string; count: number }>();
                    pageOneListings.forEach((listing: any) => {
                      const brand = listing.brand;
                      let brandKey: string;
                      let brandDisplay: string;
                      
                      if (brand === null || brand === undefined || brand.trim() === '') {
                        brandKey = "unknown";
                        brandDisplay = "Unknown";
                      } else {
                        brandDisplay = brand.trim();
                        brandKey = brandDisplay.toLowerCase();
                      }
                      
                      if (!brandCounts.has(brandKey)) {
                        brandCounts.set(brandKey, { normalized: brandKey, display: brandDisplay, count: 0 });
                      }
                      const entry = brandCounts.get(brandKey)!;
                      entry.count += 1;
                    });
                    
                    // Convert to array and sort by count (descending), then by name
                    const brandsList = Array.from(brandCounts.values()).sort((a, b) => {
                      if (b.count !== a.count) {
                        return b.count - a.count;
                      }
                      return a.display.localeCompare(b.display);
                    });
                    
                    // Apply filters to sorted listings
                    // Filtering composes with sorting (filter after sort)
                    let filteredListings = sortedListings.filter((listing: any) => {
                      // Brand filter
                      if (selectedBrands.size > 0) {
                        const listingBrand = listing.brand;
                        let brandKey: string;
                        
                        if (listingBrand === null || listingBrand === undefined || listingBrand.trim() === '') {
                          brandKey = "unknown";
                        } else {
                          brandKey = listingBrand.trim().toLowerCase();
                        }
                        
                        if (!selectedBrands.has(brandKey)) {
                          return false;
                        }
                      }
                      
                      // Fulfillment filter
                      if (selectedFulfillment.size > 0) {
                        const fulfillment = listing.fulfillment === "AMZ" 
                          ? "AMZ" 
                          : (listing.fulfillment === "FBA" 
                            ? "FBA" 
                            : (listing.fulfillment === "FBM" ? "FBM" : "FBM"));
                        
                        // Always include AMZ items regardless of filter
                        if (fulfillment === "AMZ") {
                          // AMZ always passes through
                        } else if (fulfillment === "FBA" || fulfillment === "FBM") {
                          // Filter FBA/FBM items based on selection
                          if (!selectedFulfillment.has(fulfillment as "FBA" | "FBM")) {
                            return false;
                          }
                        }
                      }
                      
                      // Sponsored filter
                      if (sponsoredFilter !== null) {
                        const isSponsored = listing.is_sponsored ?? listing.sponsored ?? false;
                        if (sponsoredFilter === "only" && !isSponsored) {
                          return false;
                        }
                        if (sponsoredFilter === "exclude" && isSponsored) {
                          return false;
                        }
                      }
                      
                      return true;
                    });
                    
                    // Check if any filters are active
                    const hasActiveFilters = selectedBrands.size > 0 || selectedFulfillment.size > 0 || sponsoredFilter !== null;
                    
                    // Helper function to clear all filters
                    const clearFilters = () => {
                      setSelectedBrands(new Set());
                      setSelectedFulfillment(new Set());
                      setSponsoredFilter(null);
                      setBrandDropdownOpen(false);
                    };
                
                return (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold text-gray-900">Page 1 Results</h2>
                      <div className="flex items-center gap-3">
                        {/* Filters Section */}
                        {pageOneListings.length > 0 && (
                          <div className="flex items-center gap-3 flex-wrap">
                            {/* Brand Filter - Button with dropdown */}
                            <div className="relative" ref={brandDropdownRef}>
                              <button
                                type="button"
                                onClick={() => setBrandDropdownOpen(!brandDropdownOpen)}
                                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex items-center gap-1.5"
                              >
                                <span>Brand</span>
                                {selectedBrands.size > 0 && (
                                  <span className="bg-blue-500 text-white rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                                    {selectedBrands.size}
                                  </span>
                                )}
                                <svg className={`w-3 h-3 transition-transform ${brandDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {brandDropdownOpen && (
                                <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-300 rounded shadow-lg max-h-64 overflow-y-auto min-w-[200px]">
                                  <div className="p-2 space-y-1">
                                    {brandsList.map((brand) => (
                                      <label key={brand.normalized} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-xs">
                                        <input
                                          type="checkbox"
                                          checked={selectedBrands.has(brand.normalized)}
                                          onChange={(e) => {
                                            const newSelected = new Set(selectedBrands);
                                            if (e.target.checked) {
                                              newSelected.add(brand.normalized);
                                            } else {
                                              newSelected.delete(brand.normalized);
                                            }
                                            setSelectedBrands(newSelected);
                                          }}
                                          className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <span className="flex-1 text-gray-900">{brand.display}</span>
                                        <span className="text-gray-500 text-[10px]">({brand.count})</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            {/* Fulfillment Filter */}
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedFulfillment.has("FBA")}
                                  onChange={(e) => {
                                    const newSelected = new Set(selectedFulfillment);
                                    if (e.target.checked) {
                                      newSelected.add("FBA");
                                    } else {
                                      newSelected.delete("FBA");
                                    }
                                    setSelectedFulfillment(newSelected);
                                  }}
                                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span>FBA</span>
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedFulfillment.has("FBM")}
                                  onChange={(e) => {
                                    const newSelected = new Set(selectedFulfillment);
                                    if (e.target.checked) {
                                      newSelected.add("FBM");
                                    } else {
                                      newSelected.delete("FBM");
                                    }
                                    setSelectedFulfillment(newSelected);
                                  }}
                                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span>FBM</span>
                              </label>
                            </div>
                            
                            {/* Sponsored Filter */}
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                  type="radio"
                                  name="sponsored-filter"
                                  checked={sponsoredFilter === "only"}
                                  onChange={() => setSponsoredFilter(sponsoredFilter === "only" ? null : "only")}
                                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 focus:ring-blue-500"
                                />
                                <span>Sponsored only</span>
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                  type="radio"
                                  name="sponsored-filter"
                                  checked={sponsoredFilter === "exclude"}
                                  onChange={() => setSponsoredFilter(sponsoredFilter === "exclude" ? null : "exclude")}
                                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 focus:ring-blue-500"
                                />
                                <span>Exclude sponsored</span>
                              </label>
                            </div>
                            
                            {/* Clear Filters Button */}
                            {hasActiveFilters && (
                              <button
                                type="button"
                                onClick={clearFilters}
                                className="text-xs text-gray-600 hover:text-gray-900 underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                              >
                                Clear filters
                              </button>
                            )}
                            
                            {/* Sort Dropdown */}
                            <div className="flex items-center gap-2">
                              <label htmlFor="sort-select" className="text-xs text-gray-500 font-medium">
                                Sort:
                              </label>
                              <select
                                id="sort-select"
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              >
                                <option value="rank">Amazon Rank</option>
                                <option value="price-asc">Price: Low → High</option>
                                <option value="price-desc">Price: High → Low</option>
                                <option value="revenue-desc">Monthly Revenue: High → Low</option>
                                <option value="units-desc">Monthly Units: High → Low</option>
                                <option value="reviews-desc">Reviews: High → Low</option>
                                <option value="rating-desc">Rating: High → Low</option>
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mb-3 text-xs text-gray-500 italic">
                      Product cards hide sales estimates until you click “Load Sales Data” on a specific ASIN.
                    </div>
                    {/* Selection Count Indicator */}
                    {selectedAsins.length > 0 && (
                      <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between">
                        <div className="text-sm text-gray-900">
                          <span className="font-medium">
                            {selectedAsins.length === 1 
                              ? "1 product selected" 
                              : `${selectedAsins.length} products selected`}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedAsins([])}
                          className="text-xs text-gray-600 hover:text-gray-900 underline"
                        >
                          Clear selection
                        </button>
                      </div>
                    )}
                    {/* Product Cards Grid - auto-fill with minmax */}
                    <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                      {filteredListings.map((listing: any, idx: number) => {
                          // Extract ASIN FIRST - this is the single source of truth for this listing
                          const asin = listing.asin || normalizeListing(listing).asin || null;
                          
                          // CRITICAL: Use the extracted asin for selection check (must match what we store)
                          const isSelected = asin !== null && selectedAsins.includes(asin);
                          
                          // Extract image URL with fallback - preserve from stable source
                          const imageUrl = listing.image_url ?? listing.image ?? null;
                          // Rank = Page-1 position (use page_position if available, else use array index + 1 for display)
                          // Note: When sorted, we still show the original page_position for rank display
                          const rank = listing.page_position ?? listing.organic_rank ?? (idx + 1);
                          // Fulfillment from canonical product (map AMZ → FBA, default to FBM if null)
                          const fulfillment = listing.fulfillment === "AMZ" 
                            ? "AMZ" 
                            : (listing.fulfillment === "FBA" 
                              ? "FBA" 
                              : (listing.fulfillment === "FBM" ? "FBM" : "FBM"));
                          
                          // Extract data with safe defaults - map from canonical product fields
                          // Title: preserve null if missing (don't fallback to "Product Title")
                          const title = listing.title || null;
                          // Brand removed (Phase 3: brands not displayed at product level)
                          
                          // ═══════════════════════════════════════════════════════════════════════════
                          // STEP 3: Log final product card data (first 5 cards)
                          // ═══════════════════════════════════════════════════════════════════════════
                          if (idx < 5) {
                            console.log("🔵 FINAL PRODUCT CARD DATA", {
                              index: idx,
                              asin: asin,
                              listing_keys: Object.keys(listing),
                            });
                          }
                          // Price: must be > 0 to display
                          const price = listing.price ?? 0;
                          // Rating: can be 0 (ProductCard handles this)
                          const rating = listing.rating ?? 0;
                          // Reviews: page_one_listings uses review_count, ProductCard expects reviews prop
                          const reviews = listing.review_count ?? listing.reviews ?? 0;
                          
                          // Revenue and units: EXPLICIT extraction - ONLY use estimated_monthly_revenue/estimated_monthly_units
                          // Do NOT use legacy fields (revenue, units, est_monthly_revenue, est_monthly_units)
                          // Explicit check: preserve value if it exists (including 0), set null if undefined/null
                          const monthlyRevenueRaw = (listing as any).estimated_monthly_revenue;
                          // Only show estimates AFTER enrichment returns.
                          // Do NOT pass modeled snapshot estimates into cards (blank until enriched).
                          const refinement = asin ? asinRefinements[asin] : undefined;
                          const isEnriched = asin ? (asinRefineStatus[asin] === "refined" && !!refinement) : false;
                          const refinedAvgUnits = isEnriched && refinement?.refined_units_range
                            ? Math.round((refinement.refined_units_range.min + refinement.refined_units_range.max) / 2)
                            : null;
                          const monthlyRevenue = isEnriched ? (refinement?.refined_estimated_revenue ?? null) : null;
                          const monthlyUnits = isEnriched ? refinedAvgUnits : null;
                          
                          // Sponsored: check both fields
                          const isSponsored = listing.is_sponsored ?? listing.sponsored ?? false;
                          
                          return (
                            <ProductCard
                              key={`${asin || idx}-${idx}`}
                              rank={rank}
                              title={title}
                              // brand removed (Phase 3: brands not displayed at product level)
                              price={price}
                              rating={rating}
                              reviews={reviews}
                              monthlyRevenue={monthlyRevenue}
                              monthlyUnits={monthlyUnits}
                              onRefineEstimates={
                                asin && price > 0
                                  ? () => requestLoadSalesData(asin, price)
                                  : undefined
                              }
                              refineStatus={asin ? (asinRefineStatus[asin] ?? "idle") : "idle"}
                              refineMeta={asin ? asinRefinements[asin] : undefined}
                              fulfillment={fulfillment as "FBA" | "FBM" | "AMZ"}
                              isSponsored={isSponsored}
                              imageUrl={imageUrl}
                              asin={asin}
                              isSelected={isSelected}
                              onSelect={(e) => {
                                // CRITICAL: Use the extracted asin (not listing.asin) for consistency
                                if (!asin) return;

                                const isMulti =
                                  ("metaKey" in e && e.metaKey) ||
                                  ("ctrlKey" in e && e.ctrlKey) ||
                                  ("shiftKey" in e && e.shiftKey);

                                if (isMulti) {
                                  // Multi-select toggle
                                  if (isSelected) {
                                    setSelectedAsins(prev => prev.filter(selectedAsin => selectedAsin !== asin));
                                  } else {
                                    setSelectedAsins(prev => [...prev, asin]);
                                  }
                                  return;
                                }

                                // Default click: single-select toggle
                                if (isSelected && selectedAsins.length === 1) {
                                  setSelectedAsins([]);
                                } else {
                                  setSelectedAsins([asin]);
                                }

                                // Clear focus after mouse click to avoid stuck focus styles
                                if ("currentTarget" in e) {
                                  (e.currentTarget as HTMLElement).blur?.();
                                }
                              }}
                            />
                          );
                        })}
                    </div>
                  </div>
                  );
                  })()}

                </>
              ) : null}
            </div>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* RIGHT COLUMN: AI CHAT SIDEBAR (RESIZABLE, SCROLLS INTERNALLY)   */}
        {/* AI Copilot is always available - fixed within app shell        */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div 
          className={`relative border-l border-gray-200 bg-white flex flex-col transition-all duration-[250ms] ease-in-out ${
            isSidebarCollapsed ? 'pointer-events-none overflow-hidden' : 'overflow-hidden'
          }`}
          style={{ 
            minHeight: 0,
            width: isSidebarCollapsed ? 0 : sidebarWidth,
            minWidth: isSidebarCollapsed ? 0 : sidebarWidth,
            maxWidth: isSidebarCollapsed ? 0 : sidebarWidth,
            opacity: isSidebarCollapsed ? 0 : 1,
          }}
        >
          {/* Resize handle - only visible when not collapsed */}
          {!isSidebarCollapsed && (
            <div
              ref={sidebarResizeRef}
              onMouseDown={handleResizeStart}
              className={`absolute left-0 top-0 bottom-0 cursor-col-resize transition-all z-10 group ${
                isResizing ? 'bg-blue-500' : 'bg-transparent hover:bg-gray-300'
              }`}
              style={{
                marginLeft: '-4px',
                width: '8px',
              }}
              title="Drag to resize"
            >
              {/* Hover indicator dot */}
              {!isResizing && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 bg-gray-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          )}
          <ChatSidebar
            analysisRunId={analysisRunIdForChat}
            snapshotId={analysis?.analysis_run_id || null}
            initialMessages={chatMessages}
            onMessagesChange={setChatMessages}
            marketSnapshot={analysis?.market_snapshot || null}
            analysisMode={analysisMode}
            selectedListing={selectedListing ? {
              ...selectedListing,
              // Include enriched data if available for this ASIN
            } : null}
            selectedAsins={selectedAsins} // Single source of truth - ChatSidebar should use this
            onSelectedAsinsChange={setSelectedAsins}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleCollapse}
          />
        </div>
      </div>
      
      {/* Collapsed Chat Chevron - small icon in top-right edge when collapsed */}
      {isSidebarCollapsed && (
        <button
          onClick={handleToggleCollapse}
          className="fixed right-0 top-16 z-50 bg-white border-l border-t border-b border-gray-200 rounded-l-lg px-2 py-2 shadow-sm hover:shadow-md transition-all duration-200 hover:bg-gray-50"
          aria-label="Expand chat sidebar"
          title="Expand chat"
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
      )}
    </div>
  );
}
