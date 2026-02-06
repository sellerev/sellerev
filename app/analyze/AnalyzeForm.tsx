"use client";

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ChatSidebar, { ChatMessage } from "./ChatSidebar";
import { normalizeListing } from "@/lib/amazon/normalizeListing";
import BrandMoatBlock from "./BrandMoatBlock";
import { ProductCard } from "@/app/components/ProductCard";
import { ListingsErrorBoundary } from "@/app/components/ListingsErrorBoundary";
import SearchBar from "@/app/components/SearchBar";
import { MetricSkeleton, TextSkeleton } from "./components/MetricSkeleton";
import AIThinkingMessage from "./components/AIThinkingMessage";
import ResultsLoadingState from "./components/ResultsLoadingState";
import { useAnalyzeProgress } from "./hooks/useAnalyzeProgress";
import HelpDrawer from "./components/HelpDrawer";
import { median } from "@/lib/ui/stats";

// Hard safety check: Prevent localhost calls in production
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  const originalFetch = window.fetch;
  window.fetch = function(...args: Parameters<typeof fetch>) {
    let url = '';
    const firstArg = args[0];
    if (typeof firstArg === 'string') {
      url = firstArg;
    } else if (firstArg instanceof Request) {
      url = firstArg.url;
    } else if (firstArg instanceof URL) {
      url = firstArg.toString();
    } else if (firstArg && typeof firstArg === 'object' && 'url' in firstArg) {
      url = String((firstArg as { url: unknown }).url);
    }
    if (url && (url.includes('127.0.0.1') || url.includes('localhost'))) {
      console.error('❌ Frontend is calling localhost in production:', url);
      console.assert(false, 'Frontend must not call localhost in production');
      return Promise.reject(new Error('Localhost calls forbidden in production'));
    }
    return originalFetch.apply(this, args);
  };
}

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
    avg_rating: number | null;
    avg_rating_source: 'observed' | 'estimated' | null;
    avg_bsr: number | null;
    total_monthly_units_est: number;
    total_monthly_revenue_est: number;
    page1_product_count: number;
  };
  
  // Page 2 results (display only; same search, page 2) when Rainforest max_page=2 was used
  page_two_listings?: Array<{
    asin: string;
    title: string | null;
    image_url: string | null;
    price: number | null;
    rating: number | null;
    review_count: number | null;
    position: number;
    page: number;
    is_sponsored?: boolean;
  }>;

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
      is_sponsored: boolean | null; // true = sponsored, false = organic, null = unknown
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
    // Computed totals from final listings (sum of per-product estimates)
    total_units?: number | null; // Total monthly units from all listings
    total_page1_revenue?: number | null; // Total monthly revenue from all listings
    // BSR metrics with category context
    median_bsr?: number | null; // Median BSR across all listings
    median_bsr_category?: string | null; // Most common category for median BSR listings
    top10_bsr_category?: string | null; // Most common category for top-10 listings with BSR
    median_root_bsr?: number | null; // Median root/main category BSR
    median_root_bsr_category?: string | null; // Most common root category for median root BSR
    root_bsr_sample_size?: number; // Count of listings with root BSR
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

export interface BrandAggregate {
  brand: string;
  product_count: number;
  total_units: number;
  total_revenue: number;
  market_share_pct: number;
  products: any[];
}

/**
 * Build brand aggregates from Page-1 listings: group by brand, sum units/revenue, compute market share.
 * Uses listing.brand_resolution?.raw_brand ?? listing.brand; fallback "Unknown".
 */
function buildBrandAggregates(
  listings: any[],
  getRawBrand: (listing: any) => string | null
): BrandAggregate[] {
  const byBrand = new Map<string, { products: any[]; total_units: number; total_revenue: number }>();
  for (const l of listings) {
    const brand: string = getRawBrand(l) === null ? "Unknown" : getRawBrand(l) as string;
    const units = Number((l as any).estimated_monthly_units ?? (l as any).est_monthly_units ?? 0) || 0;
    const revenue = Number((l as any).estimated_monthly_revenue ?? (l as any).est_monthly_revenue ?? 0) || 0;
    const existing = byBrand.get(brand);
    if (existing) {
      existing.products.push(l);
      existing.total_units += units;
      existing.total_revenue += revenue;
    } else {
      byBrand.set(brand, { products: [l], total_units: units, total_revenue: revenue });
    }
  }
  const totalRevenueAll = [...byBrand.values()].reduce((s, v) => s + v.total_revenue, 0);
  const result: BrandAggregate[] = [];
  byBrand.forEach((v, brand) => {
    result.push({
      brand,
      product_count: v.products.length,
      total_units: v.total_units,
      total_revenue: v.total_revenue,
      market_share_pct: totalRevenueAll > 0 ? (v.total_revenue / totalRevenueAll) * 100 : 0,
      products: v.products,
    });
  });
  return result;
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
  const searchParams = useSearchParams();

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────

  // Input state - pre-populate if loading from history (keyword-only)
  const [inputValue, setInputValue] = useState(
    initialAnalysis?.input_value || ""
  );
  const [inputError, setInputError] = useState<string | null>(null);

  // Analysis state - initialize with provided analysis if available, normalized
  // UI state model: 'initial' → cards render, skeletons visible
  //                 'enriching' → skeletons + AI-thinking copy
  //                 'complete' → skeletons removed, values locked in
  type AnalysisUIState = 'initial' | 'enriching' | 'complete';
  const [analysisUIState, setAnalysisUIState] = useState<AnalysisUIState>(
    initialAnalysis ? 'complete' : 'initial'
  );
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(
    normalizeAnalysis(initialAnalysis)
  );
  
  // Keep loading state for backward compatibility with SearchBar component
  const [loading, setLoading] = useState(false);
  // Progress bar: single source of truth (monotonic %, stage message)
  const progress = useAnalyzeProgress();
  const [renderReady, setRenderReady] = useState(false);
  const progressFinishedRef = useRef(false);
  const progressHeartbeatRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Client-side run ID generated BEFORE API call - tracks current search lifecycle
  // This is separate from backend run_id which may be reused for cached results
  const [clientRunId, setClientRunId] = useState<string | null>(null);
  // Ref to track active client_run_id for stale response detection (state updates are async)
  const activeClientRunIdRef = useRef<string | null>(null);
  // Ref guards for sync-from-initial: only sync once per distinct payload (stops infinite loop on history hydration)
  const lastSyncedRef = useRef<string | null>(null);
  const lastSyncedHashRef = useRef<string | null>(null);
  
  // Unique run ID generated on each Analyze click - used to force component remounts
  const [currentAnalysisRunId, setCurrentAnalysisRunId] = useState<string | null>(null);
  
  // Store the actual analysisRunId (UUID) from API response for chat
  // This is separate from analysis.analysis_run_id which may be snapshot_id for Tier-1
  const [analysisRunIdForChat, setAnalysisRunIdForChat] = useState<string | null>(
    initialAnalysis?.analysis_run_id || null
  );
  // When false, analysis_runs insert failed so this run is not in DB — chat would 404; disable chat UI
  const [chatAvailable, setChatAvailable] = useState<boolean>(true);
  // Track if current analysis is estimated (Tier-1) vs snapshot (Tier-2)
  const [isEstimated, setIsEstimated] = useState(false);
  const [snapshotType, setSnapshotType] = useState<"estimated" | "snapshot">("snapshot");
  const [snapshotLastUpdated, setSnapshotLastUpdated] = useState<string | null>(null); // For freshness badge
  // Track Tier-2 refinement status (from ui_hints)
  const [showRefiningBadge, setShowRefiningBadge] = useState(false);
  const [nextUpdateExpectedSec, setNextUpdateExpectedSec] = useState<number | null>(null);
  // Stale run banner (runs older than 24h): prompt for live refresh
  const [staleBannerDismissed, setStaleBannerDismissed] = useState(false);
  const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const isStale =
    readOnly &&
    !!analysis?.created_at &&
    Date.now() - new Date(analysis.created_at).getTime() > STALE_TTL_MS;



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
  const selectedAsinsRef = useRef<string[]>([]);

  const updateSelectedAsins = useCallback((next: string[]) => {
    selectedAsinsRef.current = next;
    setSelectedAsins(next);
  }, []);

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

  // View: Products (default) | Brands (table + expand)
  const [viewMode, setViewMode] = useState<"products" | "brands">("products");
  const [showPageTwoResults, setShowPageTwoResults] = useState(false);
  type BrandSortOption = "revenue-desc" | "revenue-asc" | "units-desc" | "units-asc" | "products-desc" | "products-asc" | "brand-az" | "market-share-desc" | "market-share-asc";
  const [brandSortBy, setBrandSortBy] = useState<BrandSortOption>("revenue-desc");
  const [expandedBrandRow, setExpandedBrandRow] = useState<string | null>(null);

  // Filter state for Page 1 Results
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const [selectedFulfillment, setSelectedFulfillment] = useState<Set<"PRIME" | "NON_PRIME">>(new Set());
  const [sponsoredFilter, setSponsoredFilter] = useState<"only" | "exclude" | null>(null);
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const brandDropdownRef = useRef<HTMLDivElement>(null);

  // Chat sidebar resizing and collapsing state
  const [sidebarWidth, setSidebarWidth] = useState(420); // Default width
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarResizeRef = useRef<HTMLDivElement>(null);

  // Help drawer (question launcher) and insert-into-chat
  const [helpDrawerOpen, setHelpDrawerOpen] = useState(false);
  const [questionToInsert, setQuestionToInsert] = useState<string | null>(null);

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

  // Sync initialAnalysis prop to state when analysis_run_id changes (idempotent: once per payload).
  // Handles URL navigation between analyses (browser back/forward, refresh, history click).
  // Ref guards prevent infinite loop: we only sync once per runId+payload hash; do NOT depend on analysis state.
  useEffect(() => {
    if (clientRunId) {
      console.log("FRONTEND_SKIP_SYNC_USER_ACTION", {
        client_run_id: clientRunId,
        reason: "User-triggered Analyze action - preserving state from API response, not initialAnalysis prop",
      });
      return;
    }

    if (!initialAnalysis) {
      if (lastSyncedHashRef.current !== null) {
        console.log("FRONTEND_RESET_TO_BLANK", {
          reason: "No initialAnalysis, no analysisRunIdForChat, and no valid listings",
        });
        setAnalysis(null);
        setAnalysisRunIdForChat(null);
        setInputValue("");
        setIsEstimated(false);
        setSnapshotType("snapshot");
        setShowRefiningBadge(false);
        setNextUpdateExpectedSec(null);
        setChatMessages([]);
        updateSelectedAsins([]);
        setSortBy("rank");
        setSelectedBrands(new Set());
        setSelectedFulfillment(new Set());
        setSponsoredFilter(null);
        setBrandDropdownOpen(false);
      }
      lastSyncedRef.current = null;
      lastSyncedHashRef.current = null;
      return;
    }

    const incomingRunId = initialAnalysis.analysis_run_id;
    const incomingProducts = initialAnalysis.page_one_listings || initialAnalysis.products || [];
    const incomingListingsLength = incomingProducts.length;
    const incomingKeyword = initialAnalysis.input_value ?? "";
    const incomingSnapshotKeyword = initialAnalysis.market_snapshot && typeof initialAnalysis.market_snapshot === "object" && !Array.isArray(initialAnalysis.market_snapshot)
      ? (initialAnalysis.market_snapshot as { keyword?: string }).keyword ?? ""
      : "";
    const incomingHash = `${incomingRunId}:${incomingListingsLength}:${incomingKeyword}:${incomingSnapshotKeyword}`;

    if (!incomingRunId) return;

    if (lastSyncedHashRef.current === incomingHash) {
      console.log("FRONTEND_SYNC_FROM_INITIAL_SKIPPED", {
        reason: "already_synced",
        runId: incomingRunId,
        incomingHash,
      });
      return;
    }

    const incomingHasProducts = incomingListingsLength > 0;
    const isFromHistory = !clientRunId;

    if (!incomingHasProducts && !isFromHistory) {
      return;
    }

    lastSyncedRef.current = incomingRunId;
    lastSyncedHashRef.current = incomingHash;

    console.log("FRONTEND_SYNC_FROM_INITIAL", {
      new_run_id: incomingRunId,
      has_incoming_listings: incomingHasProducts,
      incoming_count: incomingListingsLength,
      is_from_history: isFromHistory,
      reason: isFromHistory ? "History navigation - sync once" : "Different run/keyword or no current products",
    });

    const nextAnalysis = normalizeAnalysis(initialAnalysis);
    setAnalysis((prev) => {
      if (
        prev?.analysis_run_id === incomingRunId &&
        (prev?.page_one_listings?.length ?? prev?.products?.length ?? 0) === incomingListingsLength
      ) {
        return prev;
      }
      return nextAnalysis;
    });
    setAnalysisRunIdForChat(incomingRunId);
    setChatAvailable(true); // initial/URL runs are always from DB
    setInputValue(incomingKeyword);
    setIsEstimated(false);
    setSnapshotType("snapshot");
    setChatMessages(initialMessages);
    updateSelectedAsins([]);
    setSortBy("rank");
    setSelectedBrands(new Set());
    setSelectedFulfillment(new Set());
    setSponsoredFilter(null);
    setBrandDropdownOpen(false);
    setShowPageTwoResults(false);
    if (isFromHistory) {
      setAnalysisUIState("complete");
    }
  }, [initialAnalysis?.analysis_run_id, initialAnalysis?.input_value, clientRunId, updateSelectedAsins]); // Do NOT depend on analysis or analysisRunIdForChat

  // Hydrate from URL when user selects a past run from dropdown (HistoryPanel): client-side
  // navigation may not re-run the server component, so initialAnalysis can stay stale. Fetch
  // the run from the history API and apply to state so product cards and snapshot show.
  // Do NOT skip when clientRunId is set — history click should always load the selected run.
  const urlRunId = searchParams.get("run") ?? null;
  useEffect(() => {
    if (!urlRunId) return;
    if (analysis?.analysis_run_id === urlRunId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/history/run?analysisRunId=${encodeURIComponent(urlRunId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || data.error) return;

        const ar = data.analysis_run || {};
        const runId = ar.id || urlRunId;
        const list = data.page_one_listings ?? data.products ?? [];
        const listLen = list.length;
        const keyword = ar.input_value ?? "";
        const snapKeyword = data.market_snapshot?.keyword ?? data.snapshot?.keyword ?? "";
        const hash = `${runId}:${listLen}:${keyword}:${snapKeyword}`;

        lastSyncedRef.current = runId;
        lastSyncedHashRef.current = hash;

        const payloadAsAnalysis: AnalysisResponse = {
          analysis_run_id: runId,
          created_at: ar.created_at ?? new Date().toISOString(),
          input_type: (ar.input_type as "asin" | "keyword") ?? "keyword",
          input_value: keyword,
          decision: data.decision ?? { verdict: "GO" as const, confidence: 0 },
          executive_summary: data.executive_summary ?? "Market data loaded.",
          reasoning: data.reasoning ?? { primary_factors: [], seller_context_impact: "" },
          risks: data.risks ?? {
            competition: { level: "Low", explanation: "" },
            pricing: { level: "Low", explanation: "" },
            differentiation: { level: "Low", explanation: "" },
            operations: { level: "Low", explanation: "" },
          },
          recommended_actions: data.recommended_actions ?? { must_do: [], should_do: [], avoid: [] },
          assumptions_and_limits: data.assumptions_and_limits ?? [],
          market_data: data.market_data ?? undefined,
          market_snapshot: data.market_snapshot ?? data.snapshot ?? undefined,
          page_one_listings: list.length > 0 ? (list as AnalysisResponse["page_one_listings"]) : undefined,
          products: list.length > 0 ? (list as AnalysisResponse["products"]) : undefined,
          page_two_listings: Array.isArray(data.page_two_listings) && data.page_two_listings.length > 0 ? data.page_two_listings : undefined,
          aggregates_derived_from_page_one: data.aggregates_derived_from_page_one ?? data.computed_metrics ?? undefined,
        };

        if (cancelled) return;
        setClientRunId(null); // History view — no longer "pending" client run
        setShowPageTwoResults(false);
        setAnalysis(normalizeAnalysis(payloadAsAnalysis));
        setAnalysisRunIdForChat(runId);
        setChatAvailable(true); // history runs are from DB
        setInputValue(keyword);
        setChatMessages(Array.isArray(data.messages) ? data.messages.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content })) : []);
        setAnalysisUIState("complete");
        updateSelectedAsins([]);
        setSortBy("rank");
        setSelectedBrands(new Set());
        setSelectedFulfillment(new Set());
        setSponsoredFilter(null);
        setLoading(false); // Hide loader when history run is applied
      } catch (e) {
        if (!cancelled) console.error("FRONTEND_HYDRATE_FROM_URL_ERROR", e);
      }
    })();
    return () => { cancelled = true; };
  }, [urlRunId, analysis?.analysis_run_id, updateSelectedAsins]);

  // When renderReady and analysis has listings (renderable), animate progress to 100% then hide loader.
  // Do not require market_snapshot — API may return snapshot in different shape; listings are enough.
  useEffect(() => {
    const hasListings =
      (analysis?.page_one_listings?.length ?? 0) > 0 ||
      (analysis?.products?.length ?? 0) > 0;
    if (!renderReady || !hasListings || progressFinishedRef.current) return;
    progressFinishedRef.current = true;
    const timeoutId = setTimeout(() => {
      setLoading(false);
      setRenderReady(false);
      progressFinishedRef.current = false;
    }, 2500);
    progress
      .finish()
      .then(() => {
        clearTimeout(timeoutId);
        setLoading(false);
        setRenderReady(false);
        progressFinishedRef.current = false;
      })
      .catch(() => {
        clearTimeout(timeoutId);
        setLoading(false);
        setRenderReady(false);
        progressFinishedRef.current = false;
      });
    return () => clearTimeout(timeoutId);
  }, [
    renderReady,
    analysis?.page_one_listings?.length,
    analysis?.products?.length,
    progress,
  ]);

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

  // Generate UUID v4 (simple implementation)
  const generateUUID = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  /** Consume NDJSON stream from /api/analyze (stream: true); call onChunk for each line; return final 'complete' payload. */
  const consumeAnalyzeStream = async (
    res: Response,
    onChunk: (chunk: { type: string; [k: string]: unknown }) => void
  ): Promise<Record<string, unknown>> => {
    if (!res.body) throw new Error("Analyze stream has no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData: Record<string, unknown> | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { type: string; [k: string]: unknown };
          onChunk(parsed);
          if (parsed.type === "complete") finalData = parsed as unknown as Record<string, unknown>;
          if (parsed.type === "error") throw new Error(String(parsed.error ?? "Stream error"));
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim()) as { type: string; [k: string]: unknown };
        onChunk(parsed);
        if (parsed.type === "complete") finalData = parsed as unknown as Record<string, unknown>;
      } catch {
        // ignore trailing partial line
      }
    }
    if (!finalData) throw new Error("Analyze stream did not receive complete payload");
    return finalData;
  };

  /** Safe parse /api/analyze response: never blind res.json(); log and throw on empty/invalid JSON. */
  const parseAnalyzeResponse = async (res: Response): Promise<Record<string, unknown>> => {
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    console.log("ANALYZE_HTTP", {
      ok: res.ok,
      status: res.status,
      contentType,
      textLen: text.length,
      preview: text.slice(0, 200),
    });
    if (!res.ok) {
      throw new Error(`Analyze failed (${res.status}). ${text.slice(0, 200)}`);
    }
    if (text.trim().length === 0) {
      throw new Error("Analyze returned empty body (no JSON).");
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
      console.error("ANALYZE_JSON_PARSE_FAILED", { textLen: text.length, preview: text.slice(0, 300) });
      throw new Error("Analyze returned invalid JSON (truncated).");
    }
  };

  const analyze = async (options?: { isRetry?: boolean }) => {
    if (!validateInput()) return;

    const isRetry = options?.isRetry === true;

    // ═══════════════════════════════════════════════════════════════════════════
    // HARD RESET: Generate client_run_id BEFORE API call and clear ALL state (skip on retry)
    // ═══════════════════════════════════════════════════════════════════════════
    const newClientRunId = isRetry ? activeClientRunIdRef.current : generateUUID();
    if (!isRetry) {
      const newRunId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      setClientRunId(newClientRunId);
      activeClientRunIdRef.current = newClientRunId;
      setCurrentAnalysisRunId(newRunId);
      setAnalysis(null);
      setAnalysisRunIdForChat(null);
      setChatMessages([]);
      setIsEstimated(false);
      setSnapshotType("snapshot");
      setShowRefiningBadge(false);
      setNextUpdateExpectedSec(null);
      setSortBy("rank");
      setSelectedBrands(new Set());
      setSelectedFulfillment(new Set());
      setSponsoredFilter(null);
      setBrandDropdownOpen(false);
    }

    setLoading(true);
    setRenderReady(false);
    progressFinishedRef.current = false;
    progress.start();
    setAnalysisUIState('initial');
    setError(null);
    // Clear listings so loading skeleton shows (otherwise old results stay visible and skeleton never appears)
    setAnalysis((prev) =>
      prev ? { ...prev, page_one_listings: [], products: [] } : prev
    );

    try {
      progressHeartbeatRef.current.forEach((t) => clearTimeout(t));
      progressHeartbeatRef.current = [];
      progress.mark("fetching_page1");
      progressHeartbeatRef.current = [
        setTimeout(() => progress.mark("enriching_products"), 500),
        setTimeout(() => progress.mark("computing_metrics"), 1200),
        setTimeout(() => progress.mark("finalizing"), 2000),
      ];
      console.log("ANALYZE_REQUEST_START", { 
        inputValue: inputValue.trim(),
        client_run_id: newClientRunId,
      });

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_type: "keyword",
          input_value: inputValue.trim(),
          stream: true,
        }),
      });
      progress.mark("enriching_products");

      const contentType = res.headers.get("content-type") ?? "";
      const isStream = contentType.includes("application/x-ndjson") && res.body != null;

      let data: any;
      if (isStream) {
        data = await consumeAnalyzeStream(res, (chunk) => {
          if (chunk.type === "page1" && Array.isArray(chunk.page_one_listings)) {
            setAnalysis((prev) =>
              ({
                ...(prev || {}),
                page_one_listings: chunk.page_one_listings,
                products: chunk.page_one_listings,
                listings: chunk.page_one_listings,
              }) as AnalysisResponse
            );
          }
        });
      } else {
        data = await parseAnalyzeResponse(res) as any;
      }
      progress.mark("computing_metrics");
      console.log("ANALYZE_RESPONSE", { 
        status: res.status, 
        ok: res.ok, 
        success: data.success, 
        client_run_id: newClientRunId,
        backend_run_id: data.analysisRunId,
        has_analysisRunId: !!data.analysisRunId,
        has_snapshot: !!data.snapshot,
        has_snapshot_id: !!data.snapshot?.snapshot_id,
        has_decision: !!data.decision,
        tier: data.tier,
        error: data.error 
      });

      // Handle 202 "refreshing" (stampede protection): auto-retry once after 2s
      if (res.status === 202 && data.status === "refreshing") {
        if (!isRetry) {
          setError("Updating… Retrying in 2 seconds.");
          setLoading(false);
          setTimeout(() => {
            setError(null);
            analyze({ isRetry: true });
          }, 2000);
          return;
        }
      }

      // Handle queued response (status: "queued") - keyword is being processed
      if (data.status === "queued" || (res.status === 202 && data.status !== "refreshing")) {
        console.log("ANALYZE_QUEUED", {
          status: data.status,
          message: data.message,
          keyword: data.keyword,
        });
        setError(data.message || "Analysis queued. Ready in ~5–10 minutes.");
        setLoading(false);
        setAnalysisUIState('initial');
        return;
      }

      // Hard error state: missing reliable Page-1 listings must block (no fake data).
      if (!res.ok || data?.code === "PAGE1_LISTINGS_UNAVAILABLE") {
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
        setAnalysisUIState('initial');
        return;
      }

      // Tier-1 snapshot responses are intentionally not used for persistence (correctness first).
      // /api/analyze returns only fully-AI-complete runs (with `analysisRunId`) for URL/chat persistence.

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
        setAnalysisUIState('initial');
        return;
      }

      // ❗ Only error if NO listings exist - partial enrichment is valid
      // Decision is now OPTIONAL - market data is sufficient to render
      const pageOneListings = (data as any).page_one_listings || (data as any).products || (data as any).listings || [];
      const snapshot = (data as any).snapshot || (data as any).market_snapshot;
      const aggregates = (data as any).aggregates_derived_from_page_one;

      const products = Array.isArray(pageOneListings) ? pageOneListings : [];
      const withImages = products.filter((p: any) => {
        const u = p?.image_url ?? p?.image;
        return typeof u === "string" && u.trim().length > 0;
      }).length;
      const withBrand = products.filter((p: any) => (p?.brand ?? p?.brand_resolution?.raw_brand) != null).length;
      const withBSR = products.filter((p: any) => p?.bsr != null && Number.isFinite(Number(p.bsr))).length;
      console.log("ANALYZE_PAYLOAD_SHAPE", {
        keyword: inputValue?.trim?.(),
        products: products.length,
        withImages,
        withBrand,
        withBSR,
      });

      // CRITICAL: Only check if listings exist - price/revenue are optional
      // Partial BSR coverage (e.g. 40/68 ASINs) is valid and should render
      console.log("ANALYZE_RESPONSE_CHECK", {
        page_one_listings: (data as any).page_one_listings?.length || 0,
        products: (data as any).products?.length || 0,
        listings: (data as any).listings?.length || 0,
        extracted_listings: pageOneListings.length,
        has_snapshot: !!snapshot,
        has_aggregates: !!aggregates,
        success: data.success,
        warnings: (data as any).warnings,
      });
      
      if (pageOneListings.length === 0) {
        console.error("ANALYZE_NO_LISTINGS", { 
          data,
          page_one_listings_count: (data as any).page_one_listings?.length || 0,
          products_count: (data as any).products?.length || 0,
          listings_count: (data as any).listings?.length || 0,
        });
        setError("Analysis failed: no listings returned");
        setLoading(false);
        setAnalysisUIState('initial');
        return;
      }

      // ✅ Decision is OPTIONAL - check for DECISION_DATA_PENDING warning
      const warnings = (data as any).warnings || [];
      const hasDecisionPending = warnings.includes('DECISION_DATA_PENDING');
      
      if (!data.decision && hasDecisionPending) {
        console.warn("ANALYZE_MISSING_DECISION_BUT_MARKET_VALID", {
          listings: pageOneListings.length,
          has_snapshot: !!snapshot,
          has_aggregates: !!aggregates,
          warning: "DECISION_DATA_PENDING - allowing market view render",
        });
        // Continue without decision - market data is sufficient to render
      } else if (!data.decision && !hasDecisionPending) {
        // Legacy case - no warning but also no decision, allow rendering if market data exists
        console.warn("ANALYZE_MISSING_DECISION_NO_WARNING", {
          listings: pageOneListings.length,
          message: "No decision but market data exists - allowing render",
        });
        // Continue - market data is sufficient
      }

      // Transform response to match AnalysisResponse interface
      // data.decision may be null - handle gracefully
      
      // Normalize market_snapshot: extract from decision.market_snapshot and ensure it's an object or null
      // Never assume arrays - snapshot is always an object with the new structure
      // FIX FRONTEND STATE: Ensure listings are preserved
      // Check for market_snapshot from keywordMarket (new structure at top level) or decision.market_snapshot
      const keywordMarketSnapshot = (data as any).market_snapshot || snapshot;
      const decisionMarketSnapshot = data.decision?.market_snapshot || null;
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
      const marginSnapshot = data.decision?.margin_snapshot || null;
      
      const analysisData: AnalysisResponse = {
        analysis_run_id: data.analysisRunId,
        created_at: new Date().toISOString(),
        input_type: "keyword",
        input_value: inputValue.trim(),
        // Decision is optional - use null if missing
        decision: data.decision?.decision || null,
        executive_summary: data.decision?.executive_summary || "Market data loaded. Decision confidence is still processing.",
        reasoning: data.decision?.reasoning || { primary_factors: [], seller_context_impact: "" },
        risks: data.decision?.risks || {
          competition: { level: "unknown", explanation: "Analysis in progress" },
          pricing: { level: "unknown", explanation: "Analysis in progress" },
          differentiation: { level: "unknown", explanation: "Analysis in progress" },
          operations: { level: "unknown", explanation: "Analysis in progress" },
        },
        recommended_actions: data.decision?.recommended_actions || { must_do: [], should_do: [], avoid: [] },
        assumptions_and_limits: data.decision?.assumptions_and_limits || [],
        market_snapshot: preservedMarketSnapshot && typeof preservedMarketSnapshot === 'object' && !Array.isArray(preservedMarketSnapshot) 
          ? preservedMarketSnapshot 
          : null,
        margin_snapshot: marginSnapshot && typeof marginSnapshot === 'object' && !Array.isArray(marginSnapshot) && marginSnapshot !== null
          ? marginSnapshot
          : undefined,
        // Extract canonical Page-1 products from data (may be at top level or in decision)
        page_one_listings: pageOneListings.length > 0 ? pageOneListings : (data.decision?.page_one_listings ?? []),
        products: pageOneListings.length > 0 ? pageOneListings : (data.decision?.products ?? []),
        page_two_listings: Array.isArray((data as any).page_two_listings) ? (data as any).page_two_listings : undefined,
        aggregates_derived_from_page_one: aggregates || data.decision?.aggregates_derived_from_page_one,
      };
      
      console.log("ANALYZE_SUCCESS", { 
        client_run_id: newClientRunId,
        backend_run_id: data.analysisRunId,
        has_analysis: !!analysisData,
        estimated: data.estimated || false,
        dataSource: data.dataSource || 'snapshot',
        page_one_listings_count: analysisData.page_one_listings?.length || 0,
        products_count: analysisData.products?.length || 0,
        has_snapshot: !!analysisData.market_snapshot,
        has_decision: !!analysisData.decision,
      });

      // CRITICAL: Only commit state if this response matches our current client_run_id
      // This prevents stale responses from overwriting newer searches
      // Use ref for reliable synchronous check (state updates are async)
      if (activeClientRunIdRef.current !== newClientRunId) {
        console.warn("ANALYZE_STALE_RESPONSE_IGNORED", {
          expected_client_run_id: newClientRunId,
          active_client_run_id: activeClientRunIdRef.current,
          backend_run_id: data.analysisRunId,
          reason: "Response does not match active client_run_id - user started a new search",
        });
        setLoading(false);
        return; // Ignore stale response
      }

      // CRITICAL: Set analysisRunIdForChat FIRST before any state updates or router calls
      // This prevents the useEffect from clearing state when router.replace() is called
      if (data.analysisRunId) {
        setAnalysisRunIdForChat(data.analysisRunId);
      }
      setChatAvailable(data.chatAvailable !== false); // false when analysis_runs insert failed

      // Store estimated flag and snapshot type for UI badges
      setIsEstimated(data.estimated === true || data.dataSource === 'estimated');
      setSnapshotType(data.snapshotType === 'estimated' ? 'estimated' : 'snapshot');
      // Store snapshot last_updated for freshness badge
      setSnapshotLastUpdated(data.snapshot_last_updated || null);

      // CRITICAL: Set analysis state - always overwrite with new data if client_run_id matches
      // Products array is the source of truth - never block updates based on backend run ID
      setAnalysis((prev) => {
        const newAnalysis = normalizeAnalysis(analysisData);
        
        // Log the state update for debugging
        console.log("FRONTEND_STATE_UPDATE", {
          client_run_id: newClientRunId,
          backend_run_id: data.analysisRunId,
          prev_listings: prev?.page_one_listings?.length || 0,
          new_listings: newAnalysis?.page_one_listings?.length || 0,
          new_products: newAnalysis?.products?.length || 0,
          prev_has_listings: !!(prev?.page_one_listings && prev.page_one_listings.length > 0),
          new_has_listings: !!(newAnalysis?.page_one_listings && newAnalysis.page_one_listings.length > 0),
        });
        
        // CRITICAL: Analyze response ALWAYS wins - never block updates
        // Always use new analysis data, even if it has no products (backend is source of truth)
        // Hard assertion for debug (only in development)
        if (process.env.NODE_ENV === 'development') {
          const hasProducts = !!(newAnalysis?.page_one_listings && newAnalysis.page_one_listings.length > 0) ||
                              !!(newAnalysis?.products && newAnalysis.products.length > 0);
          console.assert(
            hasProducts,
            'ANALYZE_RENDER_ASSERTION: Analyze returned data but UI may fail to render',
            {
              client_run_id: newClientRunId,
              backend_run_id: data.analysisRunId,
              page_one_listings: newAnalysis?.page_one_listings?.length || 0,
              products: newAnalysis?.products?.length || 0,
              has_market_snapshot: !!newAnalysis?.market_snapshot,
            }
          );
        }
        
        // ALWAYS return new analysis - never preserve previous state
        // Backend response is the source of truth
        return newAnalysis;
      });
      setShowPageTwoResults(false);
      setError(null);
      progress.mark("finalizing");
      setRenderReady(true);
      // Clear loading when progress hits 100% (useEffect), or after 500ms fallback so UI never stays stuck
      setTimeout(() => {
        setLoading((prev) => (prev ? false : prev));
      }, 500);

      // Update UI state: transition to 'enriching' if we have listings but incomplete data
      // Transition to 'complete' when we have full data
      const hasListings = pageOneListings.length > 0;
      
      // Calculate monthly units and revenue from listings to determine state
      const calculatedMonthlyUnits = hasListings && pageOneListings.length > 0
        ? pageOneListings.reduce((sum: number, product: any) => {
            const units = product.estimated_monthly_units;
            if (typeof units === 'number') {
              return sum + units;
            }
            return sum;
          }, 0)
        : null;
      
      const calculatedMonthlyRevenue = hasListings && pageOneListings.length > 0
        ? pageOneListings.reduce((sum: number, product: any) => {
            const revenue = product.estimated_monthly_revenue;
            if (typeof revenue === 'number') {
              return sum + revenue;
            }
            return sum;
          }, 0)
        : null;
      
      const hasFullData = hasListings && 
                         (calculatedMonthlyUnits !== null && calculatedMonthlyUnits !== undefined) &&
                         (calculatedMonthlyRevenue !== null && calculatedMonthlyRevenue !== undefined);
      
      if (hasFullData) {
        setAnalysisUIState('complete');
      } else if (hasListings) {
        setAnalysisUIState('enriching');
      }

      // Update URL with the new analysis run ID for persistence (legacy contract)
      // Use replace() to avoid adding to history stack
      // CRITICAL: This happens AFTER state is set, so useEffect guard can check analysisRunIdForChat
      if (data.analysisRunId) {
        router.replace(`/analyze?run=${data.analysisRunId}`, { scroll: false });
      }
      
      // CRITICAL: Do NOT clear clientRunId here - keep it set to prevent sync overwrites
      // clientRunId will be cleared when the next search starts (which sets a new one)
      // This ensures the sync useEffect always sees clientRunId and skips overwriting state
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Analysis failed";
      console.error("ANALYZE_EXCEPTION", { 
        error: errorMessage, 
        exception: e,
        client_run_id: clientRunId,
      });
      setError(errorMessage);
      setLoading(false);
      setAnalysisUIState('initial');
    } finally {
      progressHeartbeatRef.current.forEach((t) => clearTimeout(t));
      progressHeartbeatRef.current = [];
    }
  };

  // Run live search from history (force_refresh so cache is bypassed and fresh results returned)
  const handleRerunSearch = useCallback(async () => {
    if (!analysis?.input_value || readOnly !== true) return;
    setLoading(true);
    setError(null);
    progress.start();
    progress.mark("fetching_page1");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_type: "keyword",
          input_value: analysis.input_value.trim(),
          force_refresh: true,
        }),
      });
      const data = await parseAnalyzeResponse(res) as { analysisRunId?: string; error?: string };
      if (!data.analysisRunId) {
        setError((data as any).error || "Live search failed");
        setLoading(false);
        return;
      }
      router.replace(`/analyze?run=${data.analysisRunId}`, { scroll: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Live search failed");
      setLoading(false);
    }
  }, [analysis?.input_value, readOnly, router, progress]);

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
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MAIN CONTENT: TWO-COLUMN FLEXBOX LAYOUT                             */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden bg-[#F7F9FC] flex" style={{ minHeight: 0 }}>
        {/* ─────────────────────────────────────────────────────────────── */}
        {/* LEFT COLUMN: MARKET DATA & PRODUCTS (SCROLLABLE)                 */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-[#F7F9FC] min-w-0" style={{ minHeight: 0 }}>
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
              hasResults={!!(analysis && ((analysis.page_one_listings?.length ?? 0) > 0 || (analysis.products?.length ?? 0) > 0))}
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
                  <svg className="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-blue-700 text-sm">
                    Viewing saved analysis. Chat is available for follow-up questions.
                  </p>
                </div>
              </div>
            )}

            {/* Stale run banner: run older than 24h, prompt for live search */}
            {readOnly && isStale && !staleBannerDismissed && (
              <div className="mt-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                  <p className="text-amber-800 text-sm">
                    Search results may have changed. Run a new live search?
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleRerunSearch}
                      disabled={loading}
                      className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50"
                    >
                      {loading ? "Running…" : "Run live search"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStaleBannerDismissed(true)}
                      className="px-3 py-1.5 border border-amber-300 text-amber-800 text-sm font-medium rounded-md hover:bg-amber-100"
                    >
                      Keep old results
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {loading && !analysis?.page_one_listings?.length && !analysis?.products?.length ? (
            /* Show skeleton while fetching (first search or new search after clearing listings) */
            <div className="px-6 py-6 space-y-6 relative min-w-0">
              <ResultsLoadingState percent={progress.percent} stageMessage={progress.stageMessage} />
            </div>
          ) : analysis ? (
            /* CRITICAL: ALWAYS render results when analysis exists - never block rendering */
            <div key={currentAnalysisRunId || analysis?.analysis_run_id || 'results'} className="px-6 py-6 space-y-6 relative min-w-0">
              {/* AI Thinking Message - shown when enriching (non-blocking) */}
              {analysisUIState === 'enriching' && (
                <div className="mb-4">
                  <AIThinkingMessage />
                </div>
              )}
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
                        image_url: l.image_url || normalizeListing(l).image_url || null,
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
                    
                    // Totals and avgs match current view: same brand/fulfillment/sponsored filters as product grid.
                    const getRawBrandForSnapshot = (listing: any): string | null => {
                      const rawBrand = listing.brand_resolution?.raw_brand ?? listing.brand;
                      if (rawBrand && typeof rawBrand === "string" && rawBrand.trim().length > 0) return rawBrand.trim();
                      return null;
                    };
                    const snapshotFilteredListings = pageOneListings.filter((listing: any) => {
                      if (selectedBrands.size > 0) {
                        const rawBrand = getRawBrandForSnapshot(listing);
                        const brandKey: string = rawBrand === null ? "Unknown" : rawBrand;
                        if (!selectedBrands.has(brandKey)) return false;
                      }
                      if (selectedFulfillment.size > 0) {
                        const fulfillmentStatus = listing.fulfillment_status ?? (listing.primeEligible === true || listing.is_prime === true ? "PRIME" : "NON_PRIME");
                        if (!selectedFulfillment.has(fulfillmentStatus as "PRIME" | "NON_PRIME")) return false;
                      }
                      if (sponsoredFilter !== null) {
                        const isSponsored = listing.is_sponsored;
                        if (sponsoredFilter === "only" && isSponsored !== true) return false;
                        if (sponsoredFilter === "exclude" && isSponsored === true) return false;
                      }
                      return true;
                    });
                    const snapshotCount = snapshotFilteredListings.length;
                    const totalMonthlyUnits = snapshotCount > 0
                      ? snapshotFilteredListings.reduce((sum: number, l: any) => sum + (Number(l.estimated_monthly_units ?? l.est_monthly_units ?? 0) || 0), 0)
                      : null;
                    const totalMonthlyRevenue = snapshotCount > 0
                      ? snapshotFilteredListings.reduce((sum: number, l: any) => sum + (Number(l.estimated_monthly_revenue ?? l.est_monthly_revenue ?? 0) || 0), 0)
                      : null;
                    const avgMonthlyUnits = snapshotCount > 0 && totalMonthlyUnits !== null ? totalMonthlyUnits / snapshotCount : null;
                    const avgMonthlyRevenue = snapshotCount > 0 && totalMonthlyRevenue !== null ? totalMonthlyRevenue / snapshotCount : null;
                    // Fallback to backend snapshot when no filtered listings (e.g. filters exclude all)
                    const monthlyUnits = totalMonthlyUnits ?? snapshot?.total_units ?? null;
                    const monthlyRevenue = totalMonthlyRevenue ?? snapshot?.total_page1_revenue ?? null;
                    const medianBSR = snapshot?.median_bsr ?? null;
                    const medianBsrCategory = snapshot?.median_bsr_category ?? null;
                    const medianRootBsr = snapshot?.median_root_bsr ?? null;
                    const medianRootBsrCategory = snapshot?.median_root_bsr_category ?? null;
                    const rootBsrSampleSize = snapshot?.root_bsr_sample_size ?? 0;
                    
                    // Top-10 Median BSR - calculate from top 10 by organic rank (for display)
                    const top10Listings = pageOneListings
                      .filter((l: any) => l.organic_rank !== null && l.organic_rank !== undefined)
                      .sort((a: any, b: any) => (a.organic_rank ?? Infinity) - (b.organic_rank ?? Infinity))
                      .slice(0, 10)
                      .filter((l: any) => {
                        const bsr = l.main_category_bsr ?? l.bsr;
                        return bsr !== null && bsr !== undefined && typeof bsr === 'number' && bsr > 0;
                      });
                    const top10MedianBSR = top10Listings.length > 0
                      ? median(top10Listings.map((l: any) => l.main_category_bsr ?? l.bsr))
                      : null;
                    const top10BsrCategory = snapshot?.top10_bsr_category ?? null;
                    
                    // Average Rating - calculate from page_one_listings (canonical products) or aggregates
                    // Filter to listings with numeric ratings only (typeof rating === 'number')
                    let avgRating: number | null = null;
                    if (hasListings) {
                      // Priority 1: Use aggregates.avg_rating (from canonical products)
                      if (aggregates?.avg_rating !== null && aggregates?.avg_rating !== undefined && !isNaN(aggregates.avg_rating) && aggregates.avg_rating > 0) {
                        avgRating = aggregates.avg_rating;
                      } else {
                        // Priority 2: Calculate from page_one_listings (they have rating field directly)
                        const ratingsList = pageOneListings.filter((l: any) => typeof l.rating === 'number' && !isNaN(l.rating) && l.rating > 0);
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
                        {/* Snapshot Freshness Badge */}
                        {snapshotLastUpdated && snapshotType === 'snapshot' && (
                          <div className="mb-4 flex items-center gap-2">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                              Using cached Page-1 snapshot (last updated: {formatTimeAgo(snapshotLastUpdated)})
                            </span>
                          </div>
                        )}
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
                            <div className="text-xs text-gray-500 mb-1">Brands</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {page1BrandCount !== null 
                                ? `${page1BrandCount} ${page1BrandCount === 1 ? 'brand' : 'brands'}`
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
                          
                          {/* 5. Sponsored Density (only show if sponsored_pct > 0) */}
                          {(snapshot as any)?.sponsored_pct !== null && (snapshot as any)?.sponsored_pct !== undefined && (snapshot as any)?.sponsored_pct > 0 && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Sponsored on Page 1</div>
                              <div className="text-lg font-semibold text-gray-900">
                                {(snapshot as any).sponsored_pct.toFixed(1)}%
                              </div>
                            </div>
                          )}
                          
                          {/* 6. Total Monthly Units (sum across current view; matches grid filters) */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Total Monthly Units</div>
                            {monthlyUnits !== null && monthlyUnits !== undefined ? (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25, ease: "easeOut" }}
                                className="text-lg font-semibold text-gray-900"
                              >
                                {monthlyUnits === 0 ? "0" : monthlyUnits.toLocaleString()}
                              </motion.div>
                            ) : analysisUIState !== "complete" ? (
                              <MetricSkeleton />
                            ) : (
                              <div className="text-lg font-semibold text-gray-900">—</div>
                            )}
                            {snapshotCount > 0 && (selectedBrands.size > 0 || sponsoredFilter !== null) && (
                              <div className="text-xs text-gray-400 mt-0.5">Based on {snapshotCount} visible listing{snapshotCount === 1 ? "" : "s"}</div>
                            )}
                          </div>
                          
                          {/* 7. Total Monthly Revenue (sum across current view; matches grid filters) */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Total Monthly Revenue</div>
                            {monthlyRevenue !== null && monthlyRevenue !== undefined ? (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25, ease: "easeOut" }}
                                className="text-lg font-semibold text-gray-900"
                              >
                                {monthlyRevenue === 0 ? "$0.00" : formatCurrency(monthlyRevenue)}
                              </motion.div>
                            ) : analysisUIState !== "complete" ? (
                              <MetricSkeleton />
                            ) : (
                              <div className="text-lg font-semibold text-gray-900">—</div>
                            )}
                          </div>
                          
                          {/* 8. Avg Monthly Units (per listing) */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Avg Monthly Units (per listing)</div>
                            {avgMonthlyUnits !== null && avgMonthlyUnits !== undefined ? (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25, ease: "easeOut" }}
                                className="text-lg font-semibold text-gray-900"
                              >
                                {avgMonthlyUnits === 0 ? "0" : avgMonthlyUnits.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </motion.div>
                            ) : analysisUIState !== "complete" ? (
                              <MetricSkeleton />
                            ) : (
                              <div className="text-lg font-semibold text-gray-900">—</div>
                            )}
                          </div>
                          
                          {/* 9. Avg Monthly Revenue (per listing) */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Avg Monthly Revenue (per listing)</div>
                            {avgMonthlyRevenue !== null && avgMonthlyRevenue !== undefined ? (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25, ease: "easeOut" }}
                                className="text-lg font-semibold text-gray-900"
                              >
                                {avgMonthlyRevenue === 0 ? "$0.00" : formatCurrency(avgMonthlyRevenue)}
                              </motion.div>
                            ) : analysisUIState !== "complete" ? (
                              <MetricSkeleton />
                            ) : (
                              <div className="text-lg font-semibold text-gray-900">—</div>
                            )}
                          </div>
                          
                          {/* 10. Average Rating */}
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Average Rating</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {avgRating !== null && avgRating !== undefined && !isNaN(avgRating) && avgRating > 0
                                ? `${avgRating.toFixed(1)} ★` 
                                : "Not enough rating data"}
                            </div>
                            {avgRating !== null && avgRating !== undefined && !isNaN(avgRating) && avgRating > 0 && (
                              <div className="text-xs text-gray-400 mt-0.5">
                                {(() => {
                                  // Count listings with numeric ratings
                                  const ratedListings = pageOneListings.filter((l: any) => typeof l.rating === 'number' && !isNaN(l.rating) && l.rating > 0);
                                  return ratedListings.length > 0 ? `Based on ${ratedListings.length} ${ratedListings.length === 1 ? 'listing' : 'listings'}` : null;
                                })()}
                              </div>
                            )}
                          </div>
                          
                          {/* 8. Average BSR (root category, only if enough data) */}
                          {medianRootBsr !== null && medianRootBsr !== undefined && rootBsrSampleSize >= 3 && (
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Average BSR</div>
                              <div className="text-lg font-semibold text-gray-900">
                                #{Math.round(medianRootBsr).toLocaleString()}{medianRootBsrCategory ? ` in ${medianRootBsrCategory}` : ''}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                Based on {rootBsrSampleSize} {rootBsrSampleSize === 1 ? 'listing' : 'listings'}
                              </div>
                            </div>
                          )}
                          
                          {/* 10. Top 5 Brands Control */}
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

                    // Page 2 results (display only; from same search, max_page=2)
                    const pageTwoListings = Array.isArray((analysis as any)?.page_two_listings) ? (analysis as any).page_two_listings : [];
                    
                    // CRITICAL: NO BLOCKING GUARDS - always render results when they exist
                    // Animation does NOT block rendering - it's shown as overlay if needed
                
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
                    
                    // Use page_one_brands from snapshot as single source of truth
                    // This ensures ALL page-1 brands appear in dropdown
                    const brandOptions = (snapshot as any)?.page_one_brands || [];
                    
                    // Count brands for display (only show counts if needed)
                    const brandCounts = new Map<string, number>();
                    // CRITICAL: Use brand_resolution.raw_brand if available, fallback to brand field
                    // INVARIANT: If raw_brand exists, NEVER show "Unknown"
                    // Helper function to get raw_brand with invariant check
                    const getRawBrand = (listing: any): string | null => {
                      const rawBrand = listing.brand_resolution?.raw_brand ?? listing.brand;
                      // INVARIANT ASSERTION: If raw_brand exists and is non-empty, it must be returned
                      if (rawBrand && typeof rawBrand === 'string' && rawBrand.trim().length > 0) {
                        return rawBrand.trim();
                      }
                      return null;
                    };
                    
                    pageOneListings.forEach((listing: any) => {
                      const brand = getRawBrand(listing);
                      if (brand) {
                        brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
                      }
                    });
                    
                    // Build brands list from snapshot.page_one_brands (sorted alphabetically)
                    // Only show "Unknown" if NO brand string exists at all (raw_brand is null)
                    // INVARIANT: If getRawBrand returns a string, "Unknown" must NOT be shown for that listing
                    const hasUnknownBrand = pageOneListings.some((listing: any) => {
                      return getRawBrand(listing) === null;
                    });
                    const brandsList = [
                      ...brandOptions,
                      ...(hasUnknownBrand ? ["Unknown"] : [])
                    ].sort();
                    
                    // Apply filters to sorted listings
                    // Filtering composes with sorting (filter after sort)
                    let filteredListings = sortedListings.filter((listing: any) => {
                      // Brand filter: exact match only (no normalization)
                      // CRITICAL: Use brand_resolution.raw_brand if available
                      // INVARIANT: If raw_brand exists, NEVER show "Unknown"
                      if (selectedBrands.size > 0) {
                        const listingBrand = getRawBrand(listing);
                        // INVARIANT ASSERTION: If listingBrand is not null, brandKey must be listingBrand, never "Unknown"
                        const brandKey = listingBrand === null ? "Unknown" : listingBrand;
                        
                        if (!selectedBrands.has(brandKey)) {
                          return false;
                        }
                      }
                      
                      // Fulfillment filter (Prime/Non-Prime)
                      if (selectedFulfillment.size > 0) {
                        // Use fulfillment_status if available, otherwise infer from primeEligible or is_prime
                        const fulfillmentStatus = listing.fulfillment_status 
                          ? listing.fulfillment_status 
                          : (listing.primeEligible === true || listing.is_prime === true 
                            ? 'PRIME' 
                            : 'NON_PRIME');
                        
                        // Filter based on Prime/Non-Prime selection
                        if (!selectedFulfillment.has(fulfillmentStatus as "PRIME" | "NON_PRIME")) {
                          return false;
                        }
                      }
                      
                      // Sponsored filter: exact match only (no inference)
                      // CRITICAL: Use exact is_sponsored value (true/false/null), no coercion
                      if (sponsoredFilter !== null) {
                        const isSponsored = listing.is_sponsored; // Preserve null state
                        if (sponsoredFilter === "only") {
                          // Sponsored only: show only listings with is_sponsored === true
                          if (isSponsored !== true) {
                            return false;
                          }
                        }
                        if (sponsoredFilter === "exclude") {
                          // Exclude sponsored: show all except is_sponsored === true (includes null)
                          if (isSponsored === true) {
                            return false;
                          }
                        }
                      }
                      
                      return true;
                    });

                    // Brand aggregates for Brand view (table + expand). Matches current filtered list.
                    const brandAggregatesRaw = buildBrandAggregates(filteredListings, getRawBrand);
                    const totalRevenueForShare = brandAggregatesRaw.reduce((s, b) => s + b.total_revenue, 0);
                    const totalUnitsForShare = brandAggregatesRaw.reduce((s, b) => s + b.total_units, 0);
                    const sortedBrandAggregates = [...brandAggregatesRaw].sort((a, b) => {
                      switch (brandSortBy) {
                        case "revenue-desc": return b.total_revenue - a.total_revenue;
                        case "revenue-asc": return a.total_revenue - b.total_revenue;
                        case "units-desc": return b.total_units - a.total_units;
                        case "units-asc": return a.total_units - b.total_units;
                        case "products-desc": return b.product_count - a.product_count;
                        case "products-asc": return a.product_count - b.product_count;
                        case "brand-az": return a.brand.localeCompare(b.brand);
                        case "market-share-desc": return b.market_share_pct - a.market_share_pct;
                        case "market-share-asc": return a.market_share_pct - b.market_share_pct;
                        default: return b.total_revenue - a.total_revenue;
                      }
                    });
                    if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && brandAggregatesRaw.length > 0) {
                      console.log("BRAND_AGGREGATES_BUILT", {
                        brands_count: brandAggregatesRaw.length,
                        total_revenue: totalRevenueForShare,
                        total_units: totalUnitsForShare,
                      });
                    }

                    // Check if any filters are active
                    const hasActiveFilters = selectedBrands.size > 0 || sponsoredFilter !== null; // selectedFulfillment filter is hidden for now
                    
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
                            {brandOptions.length > 0 && (
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
                                    {brandsList.length === 0 ? (
                                      <div className="text-xs text-gray-500 px-2 py-1.5">No brands available</div>
                                    ) : (
                                      brandsList.map((brand) => {
                                        const count = brandCounts.get(brand) || (brand === "Unknown" ? pageOneListings.filter((l: any) => {
                                          // INVARIANT: getRawBrand returns null only when no brand string exists
                                          return getRawBrand(l) === null;
                                        }).length : 0);
                                        return (
                                          <label key={brand} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-xs">
                                            <input
                                              type="checkbox"
                                              checked={selectedBrands.has(brand)}
                                              onChange={(e) => {
                                                const newSelected = new Set(selectedBrands);
                                                if (e.target.checked) {
                                                  newSelected.add(brand);
                                                } else {
                                                  newSelected.delete(brand);
                                                }
                                                setSelectedBrands(newSelected);
                                              }}
                                              className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                            />
                                            <span className="flex-1 text-gray-900">{brand}</span>
                                            {count > 0 && (
                                              <span className="text-gray-500 text-[10px]">({count})</span>
                                            )}
                                          </label>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              )}
                              </div>
                            )}
                            
                            {/* Fulfillment Filter (Prime/Non-Prime) - HIDDEN FOR NOW */}
                            {/* <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedFulfillment.has("PRIME")}
                                  onChange={(e) => {
                                    const newSelected = new Set(selectedFulfillment);
                                    if (e.target.checked) {
                                      newSelected.add("PRIME");
                                    } else {
                                      newSelected.delete("PRIME");
                                    }
                                    setSelectedFulfillment(newSelected);
                                  }}
                                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span>Prime</span>
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedFulfillment.has("NON_PRIME")}
                                  onChange={(e) => {
                                    const newSelected = new Set(selectedFulfillment);
                                    if (e.target.checked) {
                                      newSelected.add("NON_PRIME");
                                    } else {
                                      newSelected.delete("NON_PRIME");
                                    }
                                    setSelectedFulfillment(newSelected);
                                  }}
                                  className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span>Non-Prime</span>
                              </label>
                            </div> */}
                            
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
                            
                            {/* View Toggle: Products | Brands */}
                            <div className="flex items-center gap-1 border border-gray-300 rounded overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setViewMode("products")}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "products" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                              >
                                Products
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewMode("brands")}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "brands" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                              >
                                Brands
                              </button>
                            </div>

                            {/* Sort Dropdown — Products view */}
                            {viewMode === "products" && (
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
                            )}

                            {/* Sort Dropdown — Brand view */}
                            {viewMode === "brands" && (
                              <div className="flex items-center gap-2">
                                <label htmlFor="brand-sort-select" className="text-xs text-gray-500 font-medium">
                                  Sort:
                                </label>
                                <select
                                  id="brand-sort-select"
                                  value={brandSortBy}
                                  onChange={(e) => setBrandSortBy(e.target.value as BrandSortOption)}
                                  className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                  <option value="revenue-desc">Revenue: High → Low</option>
                                  <option value="revenue-asc">Revenue: Low → High</option>
                                  <option value="units-desc">Units: High → Low</option>
                                  <option value="units-asc">Units: Low → High</option>
                                  <option value="products-desc"># Products: High → Low</option>
                                  <option value="products-asc"># Products: Low → High</option>
                                  <option value="brand-az">Brand A → Z</option>
                                  <option value="market-share-desc">Market Share: High → Low</option>
                                  <option value="market-share-asc">Market Share: Low → High</option>
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Selection Count Indicator — Products view only */}
                    {viewMode === "products" && selectedAsins.length > 0 && (
                      <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between">
                        <div className="text-sm text-gray-900">
                          <span className="font-medium">
                            {selectedAsins.length === 1 
                              ? "1 product selected" 
                              : `${selectedAsins.length} products selected`}
                          </span>
                        </div>
                        <button
                          onClick={() => updateSelectedAsins([])}
                          className="text-xs text-gray-600 hover:text-gray-900 underline"
                        >
                          Clear selection
                        </button>
                      </div>
                    )}
                    {loading && pageOneListings.length === 0 ? (
                      <ResultsLoadingState percent={progress.percent} stageMessage={progress.stageMessage} />
                    ) : viewMode === "brands" ? (
                      /* Brand View: table with expandable rows — fits viewport, no horizontal scroll */
                      <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden bg-white min-w-0">
                        <table className="w-full table-fixed text-left text-xs sm:text-sm">
                          <colgroup>
                            <col style={{ width: "2%" }} />
                            <col style={{ width: "24%" }} />
                            <col style={{ width: "10%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "26%" }} />
                            <col style={{ width: "10%" }} />
                          </colgroup>
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="py-2 pl-2 pr-1 text-gray-500 font-medium"> </th>
                              <th className="py-2 px-1 text-gray-500 font-medium" title="Brand">Brand</th>
                              <th className="py-2 px-1 text-gray-500 font-medium text-right" title="Number of products"># of Products</th>
                              <th className="py-2 px-1 text-gray-500 font-medium text-right" title="Total monthly units">Monthly Units</th>
                              <th className="py-2 px-1 text-gray-500 font-medium text-right" title="Total monthly revenue">Revenue</th>
                              <th className="py-2 px-1 pr-2 text-gray-500 font-medium text-right" title="Market share">Share %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedBrandAggregates.map((row) => {
                              const isExpanded = expandedBrandRow === row.brand;
                              const productsInRankOrder = [...row.products].sort((a: any, b: any) => {
                                const aPos = a.page_position ?? a.organic_rank ?? 999;
                                const bPos = b.page_position ?? b.organic_rank ?? 999;
                                return aPos - bPos;
                              });
                              return (
                                <Fragment key={row.brand}>
                                  <tr
                                    className="border-b border-gray-100 hover:bg-gray-50"
                                  >
                                    <td className="py-2 pl-2 pr-1 align-top">
                                      <button
                                        type="button"
                                        onClick={() => setExpandedBrandRow(isExpanded ? null : row.brand)}
                                        className="p-0.5 rounded hover:bg-gray-200 text-gray-600"
                                        aria-label={isExpanded ? "Collapse" : "Expand"}
                                      >
                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                      </button>
                                    </td>
                                    <td className="py-2 px-1 font-medium text-gray-900 truncate align-top" title={row.brand}>{row.brand}</td>
                                    <td className="py-2 px-1 text-right text-gray-700 align-top">{row.product_count}</td>
                                    <td className="py-2 px-1 text-right text-gray-700 align-top whitespace-nowrap">
                                      {totalUnitsForShare > 0 || row.total_units > 0
                                        ? row.total_units.toLocaleString()
                                        : "—"}
                                    </td>
                                    <td className="py-2 px-1 text-right text-gray-700 align-top whitespace-nowrap">
                                      {totalRevenueForShare > 0 || row.total_revenue > 0
                                        ? formatCurrency(row.total_revenue)
                                        : "—"}
                                    </td>
                                    <td className="py-2 px-1 pr-2 text-right text-gray-700 align-top whitespace-nowrap">
                                      {totalRevenueForShare > 0 ? `${row.market_share_pct.toFixed(1)}%` : "—"}
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr key={`${row.brand}-expanded`}>
                                      <td colSpan={6} className="bg-gray-50 p-0">
                                        <div className="px-4 py-3 border-t border-gray-100">
                                          <div className="text-xs font-medium text-gray-500 mb-2">Products ({productsInRankOrder.length})</div>
                                          <div className="space-y-2">
                                            {productsInRankOrder.map((listing: any, idx: number) => {
                                              const asin = listing.asin || normalizeListing(listing).asin || null;
                                              const rank = listing.page_position ?? listing.organic_rank ?? (idx + 1);
                                              const title = listing.title || null;
                                              const price = listing.price ?? 0;
                                              const rating = listing.rating ?? 0;
                                              const reviews = listing.review_count ?? listing.reviews ?? 0;
                                              const units = (listing as any).estimated_monthly_units ?? (listing as any).est_monthly_units ?? null;
                                              const revenue = (listing as any).estimated_monthly_revenue ?? (listing as any).est_monthly_revenue ?? null;
                                              const isSponsored = listing.is_sponsored === true || listing.isSponsored === true;
                                              const imageUrl = (() => {
                                                const r = listing.image_url ?? listing.image;
                                                if (typeof r === "string" && r.trim()) return r.trim();
                                                if (r && typeof r === "object" && "link" in r && typeof (r as any).link === "string") return (r as any).link.trim() || null;
                                                return null;
                                              })();
                                              const amazonUrl = asin ? `https://www.amazon.com/dp/${asin}` : "#";
                                              return (
                                                <div
                                                  key={asin || idx}
                                                  className="py-2 px-3 bg-white border border-gray-100 rounded text-sm min-w-0"
                                                >
                                                  <div className="flex items-center gap-2 min-w-0">
                                                    <span className="w-7 h-7 flex items-center justify-center rounded bg-gray-100 text-gray-600 font-medium text-xs shrink-0">
                                                      #{rank}
                                                    </span>
                                                    {imageUrl ? (
                                                      <img src={imageUrl} alt="" className="w-9 h-9 object-contain rounded shrink-0" />
                                                    ) : (
                                                      <div className="w-9 h-9 bg-gray-100 rounded shrink-0" />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                      <div className="font-medium text-gray-900 truncate" title={title || undefined}>{title || "—"}</div>
                                                      <div className="text-xs text-gray-500 truncate">ASIN: {asin || "—"}</div>
                                                    </div>
                                                    <a
                                                      href={amazonUrl}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="text-gray-400 hover:text-gray-600 shrink-0"
                                                      aria-label="Open on Amazon"
                                                    >
                                                      <ExternalLink className="w-4 h-4" />
                                                    </a>
                                                  </div>
                                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 pl-9 text-xs text-gray-600">
                                                    <span>{price > 0 ? formatCurrency(price) : "—"}</span>
                                                    <span>{rating > 0 ? `${rating.toFixed(1)} ★` : "—"}{reviews > 0 ? ` (${reviews.toLocaleString()})` : ""}</span>
                                                    <span>{units != null ? `${units.toLocaleString()} u` : "—"}</span>
                                                    <span>{revenue != null ? formatCurrency(revenue) : "—"}</span>
                                                    {isSponsored && (
                                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Sponsored</span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* Products View: card grid — error boundary so one bad listing doesn't wipe the page */
                      <ListingsErrorBoundary>
                      <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                        <AnimatePresence mode="popLayout">
                          {(Array.isArray(filteredListings) ? filteredListings : []).map((listing: any, idx: number) => {
                            // Extract ASIN FIRST - this is the single source of truth for this listing
                            const asin = listing.asin || normalizeListing(listing).asin || null;
                            
                            // CRITICAL: Use a stable key based on ASIN (or fallback to a unique identifier)
                            // This ensures Framer Motion can properly track component lifecycle for animations
                            const stableKey = asin || `listing-${idx}-${listing.page_position || idx}`;
                            
                            // CRITICAL: Use the extracted asin for selection check (must match what we store)
                            const isSelected = asin !== null && selectedAsins.includes(asin);
                            
                            // Extract image URL with fallback - coerce to string | null (object with .link → string)
                            const imageUrl = (() => {
                              const r = listing.image_url ?? listing.image;
                              if (typeof r === "string" && r.trim()) return r.trim();
                              if (r && typeof r === "object" && "link" in r && typeof (r as any).link === "string") return (r as any).link.trim() || null;
                              return null;
                            })();
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
                            
                            // Revenue and units: ALWAYS use estimated_monthly_revenue/estimated_monthly_units from listing
                            // These are FINAL and authoritative - produced during H10-style estimation, BSR override, or rank-weighted allocation
                            // Do NOT use legacy fields (revenue, units, est_monthly_revenue, est_monthly_units)
                            // Explicit check: preserve value if it exists (including 0), set null if undefined/null
                            const monthlyRevenue = (listing as any).estimated_monthly_revenue ?? null;
                            const monthlyUnits = (listing as any).estimated_monthly_units ?? null;
                            // BSR source determines prefix (~ for estimated, no prefix for sp_api)
                            const bsrSource = (listing as any).bsr_source ?? (listing as any).bsrSource ?? null;
                            const bsr = listing.bsr ?? null;
                            const bsrContext = (listing as any).bsr_context ?? null;
                            // Subcategory and root rank (with fallbacks)
                            // Subcategory: prefer subcategory_rank, fallback to subcategory_bsr
                            const subcategoryRank = (listing as any).subcategory_rank ?? null;
                            const subcategoryBsr = (listing as any).subcategory_bsr ?? null;
                            // Subcategory name: prefer subcategory_name, fallback to category/category_from_context/primary_category
                            const subcategoryName = (listing as any).subcategory_name ?? (listing as any).subcategoryName ?? (listing as any).category ?? (listing as any).category_from_context ?? (listing as any).primary_category ?? null;
                            // Main category: read both snake_case and camelCase, with fallbacks
                            // Try mainCategoryBsr (camelCase) first, then main_category_bsr (snake_case), then fallbacks
                            const mainCategoryBsr = (listing as any).mainCategoryBsr ?? (listing as any).main_category_bsr ?? (listing as any).bsr_root ?? (listing as any).root_rank ?? null;
                            // Main category name: prefer bsr_root_category (Pet Supplies), then root_display_group, then main_category_name
                            const mainCategoryName = (listing as any).bsr_root_category ?? (listing as any).root_display_group ?? (listing as any).main_category_name ?? (listing as any).mainCategoryName ?? null;
                            
                            // 🧪 TEMP DEBUG: Log first listing to verify main category BSR
                            if (idx === 0 && asin) {
                              console.log("🧪 CARD_LISTING_SAMPLE", asin, {
                                bsr: bsr,
                                main_category_bsr: (listing as any).main_category_bsr,
                                mainCategoryBsr: (listing as any).mainCategoryBsr,
                                root_rank: (listing as any).root_rank,
                                bsr_root: (listing as any).bsr_root,
                                extracted_mainCategoryBsr: mainCategoryBsr,
                                keys: listing ? Object.keys(listing) : null,
                              });
                              
                              // #region agent log
                              if (typeof window !== 'undefined') {
                                const runId = 'b2409008-55ce-444e-a877-70d07cb89a85';
                                const envUrl = process.env.NEXT_PUBLIC_INGEST_BASE_URL;
                                const isProduction = process.env.NODE_ENV === 'production';
                                const baseUrl = envUrl || (isProduction ? '/api/ingest' : '/api/ingest');
                                const ingestUrl = `${baseUrl}/${runId}`;
                                if (!(window as any).__ingestUrlLogged) {
                                  console.log('🔍 Ingest URL resolved:', { baseUrl, ingestUrl, isProduction, hasEnvVar: !!envUrl });
                                  (window as any).__ingestUrlLogged = true;
                                }
                                fetch(ingestUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'AnalyzeForm.tsx:2135',message:'Frontend listing before prop extraction',data:{asin,bsr,listing_main_category_bsr:(listing as any).main_category_bsr,listing_mainCategoryBsr:(listing as any).mainCategoryBsr,listing_root_rank:(listing as any).root_rank,extracted_mainCategoryBsr:mainCategoryBsr,has_main_category_bsr:!!(listing as any).main_category_bsr,has_mainCategoryBsr:!!(listing as any).mainCategoryBsr},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
                              }
                              // #endregion
                            }
                            const rootRank = (listing as any).root_rank ?? null;
                            const rootDisplayGroup = (listing as any).root_display_group ?? null;
                            const bsrRoot = (listing as any).bsr_root ?? null;
                            const bsrRootCategory = (listing as any).bsr_root_category ?? null;
                            
                            // Sponsored: use normalization fallback
                            // isSponsored ?? (sponsored === true) ?? is_sponsored ?? IsSponsored ?? false
                            const isSponsored = listing.isSponsored ?? 
                              (listing.sponsored === true ? true : undefined) ?? 
                              listing.is_sponsored ?? 
                              (listing as any).IsSponsored ?? 
                              false;
                            
                            // ASIN-level sponsored aggregation (for UI badge)
                            const appearsSponsored = typeof listing.appearsSponsored === 'boolean' 
                              ? listing.appearsSponsored 
                              : false;
                            const sponsoredPositions = Array.isArray(listing.sponsoredPositions) 
                              ? listing.sponsoredPositions 
                              : [];
                            
                            // Prime eligibility and fulfillment status (for Prime badge and filtering)
                            const primeEligible = listing.primeEligible ?? (listing.is_prime === true);
                            const fulfillmentStatus = listing.fulfillment_status 
                              ? listing.fulfillment_status 
                              : (primeEligible ? 'PRIME' : 'NON_PRIME');
                            
                            return (
                              <motion.div
                                key={stableKey}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ 
                                  duration: 0.3, 
                                  ease: [0.4, 0, 0.2, 1], // ease-out cubic bezier
                                  delay: idx * 0.04 
                                }}
                                layout
                              >
                                <ProductCard
                                  rank={rank}
                                  title={title}
                                  // brand removed (Phase 3: brands not displayed at product level)
                                  price={price}
                                  rating={rating}
                                  reviews={reviews}
                                  monthlyRevenue={monthlyRevenue}
                                  monthlyUnits={monthlyUnits}
                                  bsrSource={bsrSource}
                                  bsr={bsr}
                                  bsrContext={bsrContext}
                                  subcategoryRank={subcategoryRank}
                                  subcategoryBsr={subcategoryBsr}
                                  subcategoryName={subcategoryName}
                                  mainCategoryBsr={mainCategoryBsr}
                                  mainCategoryName={mainCategoryName}
                                  rootRank={rootRank}
                                  rootDisplayGroup={rootDisplayGroup}
                                  bsrRoot={bsrRoot}
                                  bsrRootCategory={bsrRootCategory}
                                  fulfillment={fulfillment as "FBA" | "FBM" | "AMZ"}
                                  isSponsored={isSponsored}
                                  appearsSponsored={appearsSponsored}
                                  sponsoredPositions={sponsoredPositions}
                                  imageUrl={imageUrl}
                                  asin={asin}
                                  isSelected={isSelected}
                                  primeEligible={primeEligible}
                                  fulfillment_status={fulfillmentStatus}
                                  listing={listing}
                                  onSelect={(e) => {
                                  if (!asin) return;
                                  const next = isSelected
                                    ? selectedAsins.filter((a) => a !== asin)
                                    : [...selectedAsins, asin];
                                  updateSelectedAsins(next);
                                  console.log("PRODUCT_SELECTED", { asin, selected_asins_after: next });
                                  if ("currentTarget" in e) {
                                    (e.currentTarget as HTMLElement).blur?.();
                                  }
                                }}
                              />
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </div>
                      {/* Page two results: button and grid (same look as page 1) */}
                      {pageTwoListings.length > 0 && viewMode === "products" && (
                        <div className="mt-6">
                          <button
                            type="button"
                            onClick={() => setShowPageTwoResults((v) => !v)}
                            className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors text-sm font-medium"
                          >
                            Page two results
                            <ChevronDown
                              className={`w-4 h-4 shrink-0 transition-transform ${showPageTwoResults ? "rotate-180" : ""}`}
                              aria-hidden
                            />
                          </button>
                          {showPageTwoResults && (
                            <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                              <AnimatePresence mode="popLayout">
                                {pageTwoListings.map((listing: any, idx: number) => {
                                  const asin = listing.asin || null;
                                  const stableKey = asin ? `page2-${asin}` : `page2-${idx}`;
                                  const isSelected = asin !== null && selectedAsins.includes(asin);
                                  const imageUrl = typeof listing.image_url === "string" && listing.image_url.trim() ? listing.image_url.trim() : null;
                                  const rank = listing.position ?? idx + 1;
                                  const price = listing.price ?? 0;
                                  const rating = listing.rating ?? 0;
                                  const reviews = listing.review_count ?? 0;
                                  const isSponsored = listing.is_sponsored === true;
                                  return (
                                    <motion.div
                                      key={stableKey}
                                      initial={{ opacity: 0, y: 8 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -8 }}
                                      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1], delay: idx * 0.04 }}
                                      layout
                                    >
                                      <ProductCard
                                        rank={rank}
                                        title={listing.title || null}
                                        price={price}
                                        rating={rating}
                                        reviews={reviews}
                                        monthlyRevenue={null}
                                        monthlyUnits={null}
                                        bsrSource={null}
                                        bsr={null}
                                        bsrContext={null}
                                        subcategoryRank={null}
                                        subcategoryBsr={null}
                                        subcategoryName={null}
                                        mainCategoryBsr={null}
                                        mainCategoryName={null}
                                        rootRank={null}
                                        rootDisplayGroup={null}
                                        bsrRoot={null}
                                        bsrRootCategory={null}
                                        fulfillment="FBM"
                                        isSponsored={isSponsored}
                                        appearsSponsored={isSponsored}
                                        sponsoredPositions={[]}
                                        imageUrl={imageUrl}
                                        asin={asin}
                                        isSelected={isSelected}
                                        primeEligible={false}
                                        fulfillment_status="NON_PRIME"
                                        listing={listing}
                                        onSelect={(e) => {
                                          if (!asin) return;
                                          const next = isSelected ? selectedAsins.filter((a) => a !== asin) : [...selectedAsins, asin];
                                          updateSelectedAsins(next);
                                          if ("currentTarget" in e) (e.currentTarget as HTMLElement).blur?.();
                                        }}
                                      />
                                    </motion.div>
                                  );
                                })}
                              </AnimatePresence>
                            </div>
                          )}
                        </div>
                      )}
                      </ListingsErrorBoundary>
                    )}
                  </div>
                  );
                  })()}

                </>
              ) : null}
            </div>
          ) : (
            /* Show ready state when not loading and no analysis */
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
            analysisRunId={chatAvailable ? analysisRunIdForChat : null}
            snapshotId={analysis?.analysis_run_id || null}
            analysisCreatedAt={analysis?.created_at || null}
            isHistoryContext={!!initialAnalysis}
            initialMessages={chatMessages}
            onMessagesChange={setChatMessages}
            marketSnapshot={analysis?.market_snapshot || null}
            analysisMode={analysisMode}
            selectedListing={selectedListing ? {
              ...selectedListing,
              // Normalize fields expected by chat backend (legacy compatibility)
              // Chat backend expects `reviews`, but our canonical listings use `review_count`.
              reviews: (selectedListing as any).reviews ?? (selectedListing as any).review_count ?? null,
              // Ensure page-1 estimate fields are present for immediate answers without escalation
              estimated_monthly_units: (selectedListing as any).estimated_monthly_units ?? null,
              estimated_monthly_revenue: (selectedListing as any).estimated_monthly_revenue ?? null,
            } : null}
            selectedAsins={selectedAsins}
            selectedAsinsRef={selectedAsinsRef}
            onSelectedAsinsChange={updateSelectedAsins}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleCollapse}
            insertIntoChatText={questionToInsert}
            onInsertConsumed={() => setQuestionToInsert(null)}
            helpDrawerOpen={helpDrawerOpen}
            onToggleHelpDrawer={() => setHelpDrawerOpen((o) => !o)}
            currentKeyword={analysis?.input_value ?? null}
            asinDetails={
              analysis?.page_one_listings?.length
                ? Object.fromEntries(
                    (analysis.page_one_listings as Array<{ asin?: string; brand?: string | null; title?: string | null }>)
                      .filter((p) => p?.asin)
                      .map((p) => [p.asin!, { brand: p.brand ?? null, title: p.title ?? null }])
                  )
                : undefined
            }
            maxSelectableHint={2}
          />
        </div>
      </div>
      
      <HelpDrawer
        isOpen={helpDrawerOpen}
        onClose={() => setHelpDrawerOpen(false)}
        selectedAsins={selectedAsins}
        onSelectedAsinsChange={updateSelectedAsins}
        onSelectQuestion={(text) => setQuestionToInsert(text)}
        products={analysis?.page_one_listings ?? analysis?.products ?? []}
      />

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
