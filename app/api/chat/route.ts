import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { buildChatSystemPrompt } from "@/lib/ai/chatSystemPrompt";
import { buildCopilotSystemPrompt } from "@/lib/ai/copilotSystemPrompt";
import { estimateCogsRange } from "@/lib/cogs/assumptions";
import { normalizeCostOverrides } from "@/lib/margins/normalizeCostOverrides";
import { MarginSnapshot, MarginAssumptions } from "@/types/margin";
import { detectCostRefinement } from "@/lib/margins/detectCostRefinement";
import { refineMarginSnapshot } from "@/lib/margins/refineMarginSnapshot";
import {
  SellerMemory,
  createDefaultSellerMemory,
  validateSellerMemory,
  mapSellerProfileToMemory,
} from "@/lib/ai/sellerMemory";
import {
  recordAnalyzedKeyword,
  recordAnalyzedAsin,
} from "@/lib/ai/memoryUpdates";
import { sanitizeFinancialDirectives } from "@/lib/ai/financialDirectiveFilter";
import {
  decideEscalation,
  buildEscalationMessage,
  buildInsufficientCreditsMessage,
  type Page1Context,
  type CreditContext,
  type EscalationDecision,
} from "@/lib/ai/copilotEscalation";
import {
  checkCreditBalance,
  executeEscalation,
} from "@/lib/ai/copilotEscalationHelpers";
import { evaluateChatGuardrails } from "@/lib/ai/chatGuardrails";

/**
 * Sellerev Chat API Route (Streaming)
 * 
 * This endpoint continues a conversation anchored to a completed analysis.
 * 
 * HARD CONSTRAINTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Chat only works if analysis_run_id exists and belongs to the user
 * 2. All responses grounded in:
 *    - analysis_runs.response (original AI verdict)
 *    - analysis_runs.rainforest_data (cached market data)
 *    - seller_profiles (user context)
 * 3. NEVER invents data
 * 4. NEVER fetches new market data
 * 5. If data is missing, says so explicitly
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * ANTI-HALLUCINATION GUARANTEES:
 * - NO LIVE DATA FETCHING: This route does NOT call Rainforest API or SP-API
 * - GROUNDED CONTEXT INJECTION: AI receives explicit, structured context
 * - VERDICT IMMUTABILITY: Original verdict is authoritative
 * - EXPLICIT LIMITATIONS: Must acknowledge gaps, not fill with estimates
 */

interface ChatRequestBody {
  analysisRunId: string;
  message: string;
  selectedListing?: any | null; // Optional selected listing for AI context (DEPRECATED: use selectedAsins)
  selectedAsins?: string[]; // Selected ASINs array (for multi-select)
  responseMode?: "concise" | "expanded"; // Response mode (default: concise)
  // UI-gated escalation confirmation (prevents silent credit usage)
  escalationConfirmed?: boolean;
  escalationAsins?: string[];
}

function validateRequestBody(body: unknown): body is ChatRequestBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const b = body as Record<string, unknown>;
  
  // Validate selectedAsins if present (must be array of strings)
  if ('selectedAsins' in b && !Array.isArray(b.selectedAsins)) {
    return false;
  }
  if ('selectedAsins' in b && Array.isArray(b.selectedAsins)) {
    if (!b.selectedAsins.every((item: unknown) => typeof item === 'string')) {
      return false;
    }
  }

  // Validate escalationAsins if present (must be array of strings)
  if ('escalationAsins' in b && b.escalationAsins !== undefined) {
    if (!Array.isArray(b.escalationAsins)) return false;
    if (!b.escalationAsins.every((item: unknown) => typeof item === "string")) return false;
  }
  
  return (
    typeof b.analysisRunId === "string" &&
    b.analysisRunId.trim().length > 0 &&
    typeof b.message === "string" &&
    b.message.trim().length > 0
  );
}

/**
 * Extract ASINs from text - ONLY if they exist in ai_context.products or selected_asins
 * This prevents false positives like "COMPLAINTS" being treated as ASINs
 */
function extractAsinsFromText(
  text: string,
  validAsins: string[] // ASINs from ai_context.products or selected_asins
): string[] {
  if (!text || !validAsins || validAsins.length === 0) return [];
  
  const matches = text.toUpperCase().match(/\b([A-Z0-9]{10})\b/g) || [];
  if (matches.length === 0) return [];
  
  // Validate: Must be exactly 10 chars [A-Z0-9] AND contain at least 1 digit
  const validMatches = matches.filter((asin) => {
    // Must contain at least one digit
    if (!/\d/.test(asin)) return false;
    // Must exist in valid ASINs list
    const validSet = new Set(validAsins.map(a => a.toUpperCase()));
    return validSet.has(asin);
  });
  
  return Array.from(new Set(validMatches)).slice(0, 5);
}

function intersects(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

/**
 * Builds a compact context with only essential data (for cost reduction)
 * - Top snapshot metrics only
 * - Top 10 listings (not all 50)
 * - Selected listing details
 * - Compact source map
 */
function buildCompactContext(
  analysisResponse: Record<string, unknown>,
  marketSnapshot: Record<string, unknown> | null,
  selectedListing?: any | null,
  rainforestData?: Record<string, unknown> | null
): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  
  // Essential snapshot metrics only
  if (marketSnapshot && typeof marketSnapshot === 'object') {
    compact.market_snapshot = {
      keyword: marketSnapshot.keyword || null,
      avg_price: marketSnapshot.avg_price || null,
      avg_reviews: marketSnapshot.avg_reviews || 0,
      avg_rating: marketSnapshot.avg_rating || null,
      page1_count: marketSnapshot.page1_count || marketSnapshot.total_page1_listings || 0,
      sponsored_count: marketSnapshot.sponsored_count || 0,
      fulfillment_mix: marketSnapshot.fulfillment_mix || null,
      search_volume: (marketSnapshot.search_demand as any)?.search_volume_range || null,
      cpi: marketSnapshot.cpi || null,
    };
    
    // Top 10 listings only (not all 50) - check multiple locations
    let allListings: any[] = [];
    // Check market_snapshot.listings first
    if (Array.isArray(marketSnapshot.listings)) {
      allListings = marketSnapshot.listings;
    }
    // Check rainforest_data.listings as fallback
    else if (rainforestData && typeof rainforestData === 'object' && Array.isArray(rainforestData.listings)) {
      allListings = rainforestData.listings;
    }
    // Check analysisResponse.rainforest_data.listings
    else if (analysisResponse.rainforest_data && typeof analysisResponse.rainforest_data === 'object') {
      const rd = analysisResponse.rainforest_data as Record<string, unknown>;
      if (Array.isArray(rd.listings)) {
        allListings = rd.listings;
      }
    }
    
    const topListings = allListings.slice(0, 10).map((l: any) => ({
      asin: l.asin,
      title: l.title,
      price: l.price,
      rating: l.rating,
      reviews: l.reviews,
      is_sponsored: l.is_sponsored || l.sponsored,
      fulfillment: l.fulfillment,
      position: l.position || l.organic_rank,
    }));
    (compact.market_snapshot as Record<string, unknown>).listings = topListings;
    (compact.market_snapshot as Record<string, unknown>).total_listings_count = allListings.length;
    
    // Brand moat context (if available)
    if (analysisResponse.brand_moat && typeof analysisResponse.brand_moat === 'object') {
      const brandMoat = analysisResponse.brand_moat as {
        moat_strength?: string;
        total_brands_count?: number;
        top_brand_revenue_share_pct?: number;
        top_3_brands_revenue_share_pct?: number;
        brand_breakdown?: Array<{
          brand: string;
          asin_count: number;
          total_revenue: number;
          revenue_share_pct: number;
        }>;
      };
      
      compact.brand_moat_context = {
        moat_strength: brandMoat.moat_strength || 'none',
        total_brands: brandMoat.total_brands_count || 0,
        top_brand_share: brandMoat.top_brand_revenue_share_pct || 0,
        top_3_brand_share: brandMoat.top_3_brands_revenue_share_pct || 0,
        brand_breakdown: brandMoat.brand_breakdown || [],
      };
    }
    
    // Selected listing details (if provided)
    if (selectedListing && typeof selectedListing === 'object') {
      compact.selected_listing = {
        asin: selectedListing.asin,
        title: selectedListing.title,
        price: selectedListing.price,
        rating: selectedListing.rating,
        reviews: selectedListing.reviews,
        bsr: selectedListing.bsr,
        fulfillment: selectedListing.fulfillment,
        is_sponsored: selectedListing.is_sponsored,
      };
    }
  }
  
  // Compact source map
  const searchVolumeSource = (marketSnapshot as any)?.search_volume_source;
  const revenueEstimateSource = (marketSnapshot as any)?.revenue_estimate_source;
  const fbaFees = (marketSnapshot as any)?.fba_fees;
  const modelVersion = (marketSnapshot as any)?.model_version;
  
  compact.data_sources = {
    market_data: searchVolumeSource === "model_v2" ? "Rainforest + V2 Model" 
      : searchVolumeSource === "model_v1" ? "Rainforest + V1 Heuristic"
      : "Rainforest API",
    revenue_estimate: revenueEstimateSource === "model_v2" ? "V2 Model"
      : revenueEstimateSource === "model_v1" ? "V1 Heuristic"
      : "Estimated",
    fba_fees: (fbaFees && typeof fbaFees === 'object' && (fbaFees.source === "sp_api" || fbaFees.source === "amazon")) 
      ? "Amazon SP-API"
      : "Estimated",
    model_version: modelVersion || "v1.0",
  };
  
  // Margin snapshot (essential fields only)
  const marginSnapshot = (analysisResponse.margin_snapshot as any) || null;
  if (marginSnapshot) {
    compact.margin_snapshot = {
      net_margin_min_pct: marginSnapshot.net_margin_min_pct,
      net_margin_max_pct: marginSnapshot.net_margin_max_pct,
      assumed_price: marginSnapshot.assumed_price,
      estimated_cogs_min: marginSnapshot.estimated_cogs_min,
      estimated_cogs_max: marginSnapshot.estimated_cogs_max,
      estimated_fba_fee: marginSnapshot.estimated_fba_fee,
      confidence_tier: marginSnapshot.confidence_tier,
    };
  }
  
  return compact;
}

/**
 * Builds structured selected_asins array from stable contract format
 * 
 * Matches selected ASINs to listings in the Analyze contract and returns
 * a structured array with all relevant product data for AI reasoning.
 * 
 * CRITICAL: Uses stable contract format (ListingCard[]) instead of raw response.
 * This ensures the AI does not depend on live API calls or raw responses.
 * 
 * @param selectedAsins - Array of selected ASIN strings
 * @param contract - Stable AnalyzeResultsContract containing normalized listings
 * @returns Structured array of selected ASIN data, or empty array if none selected
 */
function buildSelectedAsinsArrayFromContract(
  selectedAsins: string[],
  contract: { listings: Array<{ asin: string } & Record<string, unknown>> } | { listings: any[] }
): Array<{
  asin: string;
  title: string | null;
  brand: string | null;
  price: number;
  rating: number;
  reviews: number;
  bsr: number | null;
  is_sponsored: boolean | null;
  prime_eligible: boolean | null;
  page1_position: number | null;
  organic_rank: number | null;
  estimated_monthly_revenue?: number;
  estimated_monthly_units?: number;
  fulfillment?: string;
}> {
  if (!selectedAsins || selectedAsins.length === 0) {
    return [];
  }

  // Get listings from stable contract format
  // Type assertion needed because ListingCard doesn't have index signature
  const listings = (contract.listings as any[]) || [];

  // Normalize ASINs for comparison (uppercase, trimmed)
  const normalizeAsin = (asin: string) => asin.trim().toUpperCase();
  const selectedAsinsNormalized = selectedAsins.map(normalizeAsin);

  // Match selected ASINs to listings
  // Use type assertion to handle both contract format and legacy format
  const selectedProducts = (listings as any[])
    .filter((product: any) => {
      if (!product || !product.asin) return false;
      const productAsin = normalizeAsin(product.asin);
      return selectedAsinsNormalized.includes(productAsin);
    })
    .map((product: any) => ({
      asin: product.asin || '',
      title: product.title || null,
      brand: product.brand || null,
      price: typeof product.price === 'number' ? product.price : 0,
      rating: typeof product.rating === 'number' ? product.rating : 0,
      reviews: typeof product.review_count === 'number' ? product.review_count : 
               (typeof product.reviews === 'number' ? product.reviews : 0),
      bsr: typeof product.main_category_bsr === 'number' ? product.main_category_bsr :
           (typeof product.bsr === 'number' ? product.bsr : null),
      is_sponsored: product.is_sponsored === true ? true : 
                    (product.is_sponsored === false ? false : null),
      prime_eligible: product.is_prime === true ? true : 
                      (product.is_prime === false ? false : null),
      page1_position: typeof product.page_position === 'number' ? product.page_position :
                      (typeof product.rank === 'number' ? product.rank : null),
      organic_rank: typeof product.organic_rank === 'number' ? product.organic_rank : null,
      estimated_monthly_revenue: typeof product.estimated_monthly_revenue === 'number' 
        ? product.estimated_monthly_revenue 
        : undefined,
      estimated_monthly_units: typeof product.estimated_monthly_units === 'number' 
        ? product.estimated_monthly_units 
        : undefined,
      fulfillment: typeof product.fulfillment === 'string' ? product.fulfillment : undefined,
    }));

  // Sort by page1_position to maintain order
  selectedProducts.sort((a, b) => {
    const posA = a.page1_position ?? 999;
    const posB = b.page1_position ?? 999;
    return posA - posB;
  });

  return selectedProducts;
}

/**
 * Builds the grounded context message that anchors the conversation.
 * 
 * WHY THIS PREVENTS HALLUCINATIONS:
 * - All data comes from database records, not live API calls
 * - The original analysis verdict is explicitly marked as authoritative
 * - Market data is labeled as cached, signaling it's the only source of truth
 * - Seller context is included to ensure advice is personalized to actual profile
 */
function buildContextMessage(
  analysisResponse: Record<string, unknown>,
  rainforestData: Record<string, unknown> | null,
  sellerProfile: {
    stage: string;
    experience_months: number | null;
    monthly_revenue_range: string | null;
    sourcing_model: string;
    goals?: string | null;
    risk_tolerance?: string | null;
    margin_target?: number | null;
    max_fee_pct?: number | null;
    updated_at?: string;
  },
  inputType: string,
  inputValue: string,
  selectedListing?: any | null,
  selectedAsins?: string[] // Multi-ASIN support
): string {
  const contextParts: string[] = [];

  // Section 1: Original Analysis (available for reference, but not emphasized for keyword mode)
  const confidenceDowngrades = (analysisResponse.confidence_downgrades as string[] | undefined) || [];
  const confidenceDowngradeText = confidenceDowngrades.length > 0
    ? `\n\nConfidence Downgrades:\n${confidenceDowngrades.map((reason, idx) => `- ${reason}`).join("\n")}`
    : "";
  
  // Keyword mode: de-emphasize verdicts (they're not shown in UI)
  contextParts.push(`=== ANALYSIS CONTEXT (AVAILABLE IF ASKED) ===
This analysis data is available for reference if the user asks about it.

Input: KEYWORD - ${inputValue}

Note: Verdicts and recommendations are not displayed in the UI by default.
Only provide them if the user explicitly asks about the analysis verdict or recommendations.

Available analysis data:
- Verdict: ${(analysisResponse.decision as { verdict: string })?.verdict || "Not available"}
- Confidence: ${(analysisResponse.decision as { confidence: number })?.confidence || "N/A"}%${confidenceDowngradeText}
- Executive Summary: ${analysisResponse.executive_summary || "Not available"}
- Risks: Available if asked
- Recommended Actions: Available if asked
- Assumptions & Limits: Available if asked`);

  // Section 2: Market Data (explicitly labeled as CACHED to prevent fresh data assumptions)
  if (rainforestData && Object.keys(rainforestData).length > 0) {
    contextParts.push(`=== MARKET DATA (CACHED - DO NOT ASSUME FRESH DATA) ===
This is the only market data available. Do not invent additional data points.

${JSON.stringify(rainforestData, null, 2)}

CRITICAL: Before making any claim about this data:
- Check if the field exists in the JSON above
- If a field is labeled "estimated" or "modeled", you MUST say so
- If a field is null or missing, you MUST say "not available"
- Never make unqualified claims like "All products are X" unless you can verify ALL listings`);
  } else {
    contextParts.push(`=== MARKET DATA ===
No cached market data available for this analysis.
You must explicitly state this limitation if the user asks about market metrics.`);
  }

  // Section 3: Seller Context (ensures personalized advice)
  const profileVersion = sellerProfile.updated_at 
    ? new Date(sellerProfile.updated_at).toISOString()
    : "unknown";
  
  const sellerContextParts: string[] = [
    `Stage: ${sellerProfile.stage}`,
    `Experience: ${sellerProfile.experience_months !== null ? `${sellerProfile.experience_months} months` : "Not specified"}`,
    `Revenue Range: ${sellerProfile.monthly_revenue_range || "Not specified"}`,
    `Sourcing Model: ${sellerProfile.sourcing_model || "not_sure"}`,
  ];
  
  if (sellerProfile.goals) {
    sellerContextParts.push(`Goals: ${sellerProfile.goals}`);
  }
  if (sellerProfile.risk_tolerance) {
    sellerContextParts.push(`Risk Tolerance: ${sellerProfile.risk_tolerance}`);
  }
  if (sellerProfile.margin_target !== null && sellerProfile.margin_target !== undefined) {
    sellerContextParts.push(`Margin Target: ${sellerProfile.margin_target}%`);
  }
  if (sellerProfile.max_fee_pct !== null && sellerProfile.max_fee_pct !== undefined) {
    sellerContextParts.push(`Max Fee %: ${sellerProfile.max_fee_pct}%`);
  }
  
  sellerContextParts.push(`Profile Version: ${profileVersion} (updated_at: ${sellerProfile.updated_at || "unknown"})`);
  
  contextParts.push(`=== SELLER CONTEXT (LATEST PROFILE) ===
${sellerContextParts.join("\n")}

Use this context to tailor your advice. A new seller receives different guidance than a scaling seller.
For margin calculations, use the sourcing_model to infer COGS ranges automatically.
This profile data is always loaded fresh from the database - changes take effect immediately.`);

  // Section 4: Market Snapshot (includes pricing data for margin calculations)
  const marketSnapshot = (analysisResponse.market_snapshot as Record<string, unknown>) || null;
  
  // Section 4a: Competitive Pressure Index (CPI) - MUST be cited in strategic answers
  if (marketSnapshot) {
    try {
      const cpi = (marketSnapshot.cpi as {
        score?: number;
        label?: string;
        breakdown?: Record<string, number>;
      } | null) || null;
      
      if (cpi && typeof cpi === 'object' && cpi !== null && 
          typeof cpi.score === 'number' && 
          typeof cpi.label === 'string' && 
          cpi.breakdown && typeof cpi.breakdown === 'object') {
        const breakdown = cpi.breakdown;
        contextParts.push(`=== COMPETITIVE PRESSURE INDEX (CPI) ===
CPI Score: ${cpi.score} (${cpi.label})
Breakdown:
- Review dominance: ${breakdown.review_dominance ?? 0} pts
- Brand concentration: ${breakdown.brand_concentration ?? 0} pts
- Sponsored saturation: ${breakdown.sponsored_saturation ?? 0} pts
- Price compression: ${breakdown.price_compression ?? 0} pts
- Seller fit modifier: ${(breakdown.seller_fit_modifier ?? 0) > 0 ? '+' : ''}${breakdown.seller_fit_modifier ?? 0} pts

CRITICAL: CPI must be cited in every strategic answer. CPI is computed once, cached, immutable. Never recalculate or override CPI.`);
      } else {
        contextParts.push(`=== COMPETITIVE PRESSURE INDEX (CPI) ===
CPI: Not available (insufficient Page 1 data)`);
      }
    } catch (error) {
      // If CPI access fails, just skip it
      console.error("Error accessing CPI data:", error);
      contextParts.push(`=== COMPETITIVE PRESSURE INDEX (CPI) ===
CPI: Not available (insufficient Page 1 data)`);
    }
  }
  
  if (marketSnapshot && typeof marketSnapshot === 'object') {
    const avgPrice = (marketSnapshot.avg_price as number) || null;
    const representativeAsin = (marketSnapshot.representative_asin as string) || "Not available";
    
    // Build data availability notes
    const dataAvailabilityNotes: string[] = [];
    
    // Check which fields are estimated vs observed
    if (marketSnapshot.search_volume_source === "model_v2" || marketSnapshot.search_volume_source === "model_v1") {
      dataAvailabilityNotes.push("- Search volume is MODELED (not from Amazon directly)");
    }
    if (marketSnapshot.revenue_estimate_source === "model_v2" || marketSnapshot.revenue_estimate_source === "model_v1") {
      dataAvailabilityNotes.push("- Revenue estimates are MODELED (not from Amazon directly)");
    }
    if (marketSnapshot.fba_fees && typeof marketSnapshot.fba_fees === 'object') {
      const fbaFees = marketSnapshot.fba_fees as any;
      if (fbaFees.source === "estimated" || fbaFees.source === "heuristic") {
        dataAvailabilityNotes.push("- FBA fees are ESTIMATED (not from Amazon SP-API)");
      }
    }
    
    const availabilityText = dataAvailabilityNotes.length > 0
      ? `\n\nDATA AVAILABILITY NOTES:\n${dataAvailabilityNotes.join("\n")}\n\nBefore making claims about these metrics, you MUST cite them as "estimated" or "modeled" if noted above.`
      : "";
    
    contextParts.push(`=== MARKET SNAPSHOT (FOR MARGIN CALCULATIONS) ===
Price Band: ${avgPrice !== null ? `$${avgPrice.toFixed(2)}` : "Not available"}
Representative ASIN: ${representativeAsin}

Use price band as the selling price for margin calculations.${availabilityText}`);
  }

  // Section 5: FBA Fees (new structure from resolveFbaFees or legacy structure)
  contextParts.push(`=== FBA FEES (ESTIMATED) ===`);
  
  if (marketSnapshot && typeof marketSnapshot === 'object') {
    const fbaFees = marketSnapshot.fba_fees as any;
    
    if (fbaFees && typeof fbaFees === 'object' && !Array.isArray(fbaFees) && fbaFees !== null) {
      // Check for new structure (from resolveFbaFees for ASIN inputs)
      if ('fulfillment_fee' in fbaFees || 'referral_fee' in fbaFees || 'total_fba_fees' in fbaFees) {
        const fulfillmentFee = fbaFees.fulfillment_fee !== null && fbaFees.fulfillment_fee !== undefined
          ? (() => {
              const val = parseFloat(fbaFees.fulfillment_fee);
              return !isNaN(val) ? `$${val.toFixed(2)}` : "Not available";
            })()
          : "Not available";
        const referralFee = fbaFees.referral_fee !== null && fbaFees.referral_fee !== undefined
          ? (() => {
              const val = parseFloat(fbaFees.referral_fee);
              return !isNaN(val) ? `$${val.toFixed(2)}` : "Not available";
            })()
          : "Not available";
        const totalFees = fbaFees.total_fba_fees !== null && fbaFees.total_fba_fees !== undefined
          ? (() => {
              const val = parseFloat(fbaFees.total_fba_fees);
              return !isNaN(val) ? `$${val.toFixed(2)}` : "Not available";
            })()
          : "Not available";
        
        if (fbaFees.source === "amazon" && totalFees !== "Not available") {
          contextParts.push(`Fulfillment fee: ${fulfillmentFee}
Referral fee: ${referralFee}
Total Amazon fees: ${totalFees}

These fees are Amazon-provided (from SP-API) for ASIN analysis.`);
        } else {
          contextParts.push(`Amazon fee estimate not available for this ASIN.`);
        }
      } else if ('total_fee' in fbaFees) {
        // Legacy structure (for keyword analyses)
        const totalFee = fbaFees.total_fee !== null && fbaFees.total_fee !== undefined
          ? (() => {
              const val = parseFloat(fbaFees.total_fee);
              return !isNaN(val) ? `$${val.toFixed(2)}` : null;
            })()
          : null;
        
        if (totalFee) {
          const isAmazonProvided = fbaFees.source === "sp_api";
          contextParts.push(`Total Amazon fees: ${totalFee}
Source: ${fbaFees.source || "estimated"}

${isAmazonProvided ? "These fees are Amazon-provided (from SP-API)." : "These fees are estimated (not from Amazon SP-API). Keyword analyses use estimated ranges."}`);
        } else {
          contextParts.push(`Amazon fee estimate not available for this ASIN.`);
        }
      } else {
        contextParts.push(`Amazon fee estimate not available for this ASIN.`);
      }
    } else {
      contextParts.push(`Amazon fee estimate not available for this ASIN.`);
    }
  } else {
    contextParts.push(`Amazon fee estimate not available for this ASIN.`);
  }
  
  // Add enforcement note
  if (inputType === "asin") {
    contextParts.push(`NOTE: This is an ASIN analysis. FBA fees should be Amazon-provided from SP-API if available.`);
  } else {
    contextParts.push(`NOTE: This is a keyword analysis. FBA fees must use estimated category-based ranges, not Amazon SP-API data.`);
  }

  // Section 6: Margin Snapshot (Part G - first-class feature)
  const marginSnapshot = (analysisResponse.margin_snapshot as MarginSnapshot) || null;
  if (marginSnapshot && typeof marginSnapshot === 'object') {
    try {
      const cogsRange = marginSnapshot.estimated_cogs_min !== null && marginSnapshot.estimated_cogs_min !== undefined &&
                        marginSnapshot.estimated_cogs_max !== null && marginSnapshot.estimated_cogs_max !== undefined &&
                        typeof marginSnapshot.estimated_cogs_min === 'number' && !isNaN(marginSnapshot.estimated_cogs_min) &&
                        typeof marginSnapshot.estimated_cogs_max === 'number' && !isNaN(marginSnapshot.estimated_cogs_max)
        ? `$${marginSnapshot.estimated_cogs_min.toFixed(2)}–$${marginSnapshot.estimated_cogs_max.toFixed(2)}`
        : "Not available";
      
      const fbaFee = marginSnapshot.estimated_fba_fee !== null && marginSnapshot.estimated_fba_fee !== undefined &&
                      typeof marginSnapshot.estimated_fba_fee === 'number' && !isNaN(marginSnapshot.estimated_fba_fee)
        ? `$${marginSnapshot.estimated_fba_fee.toFixed(2)}`
        : "Not available";
      
      const marginRange = marginSnapshot.net_margin_min_pct !== null && marginSnapshot.net_margin_min_pct !== undefined &&
                          marginSnapshot.net_margin_max_pct !== null && marginSnapshot.net_margin_max_pct !== undefined &&
                          typeof marginSnapshot.net_margin_min_pct === 'number' && !isNaN(marginSnapshot.net_margin_min_pct) &&
                          typeof marginSnapshot.net_margin_max_pct === 'number' && !isNaN(marginSnapshot.net_margin_max_pct)
        ? `${marginSnapshot.net_margin_min_pct.toFixed(1)}%–${marginSnapshot.net_margin_max_pct.toFixed(1)}%`
        : "Not available";
      
      const breakevenRange = marginSnapshot.breakeven_price_min !== null && marginSnapshot.breakeven_price_min !== undefined &&
                            marginSnapshot.breakeven_price_max !== null && marginSnapshot.breakeven_price_max !== undefined &&
                            typeof marginSnapshot.breakeven_price_min === 'number' && !isNaN(marginSnapshot.breakeven_price_min) &&
                            typeof marginSnapshot.breakeven_price_max === 'number' && !isNaN(marginSnapshot.breakeven_price_max)
        ? `$${marginSnapshot.breakeven_price_min.toFixed(2)}–$${marginSnapshot.breakeven_price_max.toFixed(2)}`
        : "Not available";
      
      const refinementNote = marginSnapshot.confidence_tier === "REFINED"
        ? `\n\nNOTE: This margin snapshot uses USER-REFINED costs. Confidence tier: REFINED.`
        : marginSnapshot.confidence_tier === "EXACT"
        ? `\n\nNOTE: This margin snapshot uses Amazon SP-API fees. Confidence tier: EXACT.`
        : "";
      
      const assumptionsList = Array.isArray(marginSnapshot.assumptions) && marginSnapshot.assumptions.length > 0
        ? marginSnapshot.assumptions.map(a => `- ${a}`).join("\n")
        : "No assumptions documented";
      
      contextParts.push(`=== MARGIN SNAPSHOT ===
Mode: ${marginSnapshot.mode || "UNKNOWN"}
Confidence tier: ${marginSnapshot.confidence_tier || "ESTIMATED"}
Confidence reason: ${marginSnapshot.confidence_reason || "Established from assumptions"}
Selling price: $${(marginSnapshot.assumed_price || 0).toFixed(2)} (source: ${marginSnapshot.price_source || "unknown"})
COGS range: ${cogsRange} (source: ${marginSnapshot.cogs_source || "assumption_engine"})
FBA fees: ${fbaFee} (source: ${marginSnapshot.fba_fee_source || "unknown"})
Net margin range: ${marginRange}
Breakeven price range: ${breakevenRange}${refinementNote}

Assumptions:
${assumptionsList}

This margin snapshot is the single source of truth. Always reference it when answering margin questions. Do NOT recalculate margins.`);
    } catch (error) {
      console.error("Error building margin snapshot context:", error);
      // Don't fail - just skip margin snapshot section
    }
  }

  // Section 6.5: Brand Moat Context (if available)
  const brandMoat = (analysisResponse.brand_moat as {
    moat_strength?: string;
    total_brands_count?: number;
    top_brand_revenue_share_pct?: number;
    top_3_brands_revenue_share_pct?: number;
    brand_breakdown?: Array<{
      brand: string;
      asin_count: number;
      total_revenue: number;
      revenue_share_pct: number;
    }>;
  } | null) || null;
  
  if (brandMoat && typeof brandMoat === 'object') {
    try {
      const topBrand = brandMoat.brand_breakdown && brandMoat.brand_breakdown.length > 0
        ? brandMoat.brand_breakdown[0]
        : null;
      
      contextParts.push(`=== BRAND MOAT CONTEXT (PAGE-1 ONLY) ===
Brand moat strength: ${brandMoat.moat_strength || 'none'} (strong/moderate/weak/none)
Total brands on Page 1: ${brandMoat.total_brands_count || 0}
Top brand revenue share: ${brandMoat.top_brand_revenue_share_pct?.toFixed(1) || '0.0'}%
Top 3 brands revenue share: ${brandMoat.top_3_brands_revenue_share_pct?.toFixed(1) || '0.0'}%
${topBrand ? `Top brand: ${topBrand.brand} (${topBrand.asin_count} ASINs, ${topBrand.revenue_share_pct.toFixed(1)}% share)` : 'Top brand: Not available'}

CRITICAL AI RULES:
- AI may cite brand dominance ONLY using this brand_moat_context data
- AI must NEVER infer brands beyond this data
- AI phrasing must say "Page-1 brands indicate..." NOT "Amazon data shows..."
- This data is derived from canonical Page-1 listings only
- Percentages must match market snapshot totals exactly
- Never use lazy ASIN refinement data for brand moat calculations`);
    } catch (error) {
      console.error("Error formatting brand moat context:", error);
    }
  }

  // Section 7: Selected Listings Context (multi-ASIN support)
  // CRITICAL: selectedAsins is the single source of truth
  // If selectedAsins.length === 0, NO products are selected
  // Only use selectedListing as fallback if selectedAsins is empty/undefined
  const effectiveSelectedAsins: string[] = Array.isArray(selectedAsins) && selectedAsins.length > 0
    ? selectedAsins.filter(asin => asin && typeof asin === 'string') // Filter out invalid ASINs
    : (selectedListing?.asin && typeof selectedListing.asin === 'string'
      ? [selectedListing.asin] // Backward compatibility fallback
      : []); // Empty array = no selection
  
  if (effectiveSelectedAsins.length > 0) {
    try {
      // Get all selected listings from page_one_listings
      // CRITICAL: Match ASINs exactly - use normalized ASIN for comparison
      const pageOneListings = (analysisResponse.page_one_listings as any[]) || (analysisResponse.products as any[]) || [];
      const selectedListings = pageOneListings.filter((listing: any) => {
        const listingAsin = listing.asin || null;
        return listingAsin && effectiveSelectedAsins.includes(listingAsin);
      });
      
      if (selectedListings.length > 0) {
        const selectedCount = selectedListings.length;
        const asinList = effectiveSelectedAsins.join(', ');
        
        contextParts.push(`=== SELECTED PRODUCTS (HARD LOCK - REQUIRED) ===
The user has selected ${selectedCount === 1 ? 'this product' : `${selectedCount} products`} from Page 1. You may ONLY reference, cite, or escalate for these selected products.

CRITICAL RULES:
- You may ONLY reference, cite, or escalate for ASINs: ${asinList}
- NEVER infer or reference other ASINs unless the user explicitly requests a comparison
- All citations must use only these selected ASINs
- If the question is ambiguous or mentions other ASINs, you MUST ask a clarification question instead of guessing
- If ${selectedCount > 2 ? 'more than 2 products are selected and escalation is needed, you must ask the user to narrow to 1-2 products' : 'escalation is needed, you can escalate for up to 2 selected products'}

SELECTED PRODUCTS:`);
        
        // Add details for each selected product
        selectedListings.forEach((listing: any, idx: number) => {
          const price = typeof listing.price === 'number' && !isNaN(listing.price) && listing.price !== null && listing.price !== undefined
            ? `$${listing.price.toFixed(2)}`
            : 'Not available';
          const rating = typeof listing.rating === 'number' && !isNaN(listing.rating) && listing.rating !== null && listing.rating !== undefined
            ? listing.rating.toFixed(1)
            : 'Not available';
          const reviews = typeof listing.review_count === 'number' && !isNaN(listing.review_count)
            ? listing.review_count.toLocaleString()
            : (typeof listing.reviews === 'number' && !isNaN(listing.reviews)
              ? listing.reviews.toLocaleString()
              : 'Not available');
          const bsr = typeof listing.bsr === 'number' && !isNaN(listing.bsr)
            ? `#${listing.bsr.toLocaleString()}`
            : 'Not available';
          
          contextParts.push(`
Product ${idx + 1}:
ASIN: ${listing.asin || 'Not available'}
Title: ${listing.title || 'Not available'}
Price: ${price}
Rating: ${rating}
Reviews: ${reviews}
BSR: ${bsr}
Organic Rank: ${listing.organic_rank !== null && listing.organic_rank !== undefined ? `#${listing.organic_rank}` : 'Not available'}
Fulfillment: ${listing.fulfillment || 'Not available'}
Brand: ${listing.brand || 'Not available'}
Sponsored: ${listing.is_sponsored ? 'Yes' : 'No'}
Estimated Monthly Revenue: ${listing.estimated_monthly_revenue ? `$${listing.estimated_monthly_revenue.toLocaleString()}` : 'Not available'}
Estimated Monthly Units: ${listing.estimated_monthly_units ? listing.estimated_monthly_units.toLocaleString() : 'Not available'}`);
        });
        
        contextParts.push(`
When the user asks about specific products, you MUST only reference these selected products (ASINs: ${asinList}). If they mention other ASINs or ask ambiguous questions, ask for clarification.`);
      }
    } catch (error) {
      console.error("Error formatting selected listings context:", error);
    }
  } else {
    // No products selected - add context that only market-level data is available
    contextParts.push(`=== NO PRODUCTS SELECTED ===
No products are currently selected. You may only answer using market-level / Page-1 aggregate data.
- Do NOT reference specific products
- Do NOT escalate for product-specific questions
- If the user asks about a specific product, ask them to select exactly 1 product card from Page-1 (so the answer is tied to a single ASIN).`);
  }
  

  return contextParts.join("\n\n");
}

/**
 * Checks data sufficiency for answering a question
 * 
 * This is the MANDATORY FIRST STEP before generating any AI response.
 * Determines if we have enough data to answer the question definitively.
 * 
 * @param message - User's question
 * @param questionCategory - Classified question category
 * @param aiContext - AI context data (from analysis response)
 * @param sellerProfile - Seller profile data
 * @param marketSnapshot - Market snapshot data
 * @returns Object with sufficient boolean, missingItems array, and suggestions array
 */
function checkDataSufficiency(
  message: string,
  questionCategory: string,
  aiContext: Record<string, unknown>,
  sellerProfile: {
    stage: string;
    experience_months: number | null;
    monthly_revenue_range: string | null;
    sourcing_model: string;
    goals?: string | null;
    risk_tolerance?: string | null;
    margin_target?: number | null;
    max_fee_pct?: number | null;
    updated_at?: string;
  },
  marketSnapshot: Record<string, unknown> | null
): {
  sufficient: boolean;
  missingItems: string[];
  suggestions: string[];
} {
  const missingItems: string[] = [];
  const suggestions: string[] = [];
  
  // Extract market snapshot from ai_context if not provided separately
  const snapshot = marketSnapshot || (aiContext.market_snapshot as Record<string, unknown> | null) || null;
  const listings = (snapshot?.listings as any[] | undefined) || (aiContext.products as any[] | undefined) || [];
  
  // Check for "winnable" or "viable" questions (most common)
  const isWinnableQuestion = /\b(winnable|viable|worth it|should i|can i win|can i compete)\b/i.test(message);
  
  if (isWinnableQuestion || questionCategory === "GENERAL" || questionCategory === "CAPITAL_ALLOCATION") {
    // Required data for winnability assessment:
    
    // 1. Review barrier (median top 10 organic reviews)
    const top10Organic = listings
      .filter((l: any) => !l.is_sponsored)
      .slice(0, 10)
      .map((l: any) => l.reviews || l.review_count)
      .filter((r: any) => typeof r === 'number' && r > 0);
    
    if (top10Organic.length < 5) {
      missingItems.push("Review counts for top 10 organic listings (need at least 5 listings with review data)");
    }
    
    // 2. Revenue concentration (top 10 revenue share)
    const top10RevenueShare = snapshot?.top10_revenue_share_pct || snapshot?.top10_revenue_share;
    if (top10RevenueShare === null || top10RevenueShare === undefined) {
      missingItems.push("Top 10 revenue share percentage (top10_revenue_share_pct)");
    }
    
    // 3. CPI score
    const cpiScore = (snapshot?.cpi as any)?.score;
    if (cpiScore === null || cpiScore === undefined) {
      missingItems.push("CPI score (competitive pressure index)");
    }
    
    // 4. Price compression (price range)
    const prices = listings
      .map((l: any) => l.price)
      .filter((p: any) => typeof p === 'number' && p > 0);
    
    if (prices.length < 5) {
      missingItems.push("Price data for at least 5 listings (to calculate price compression)");
    }
    
    // 5. Seller profile (stage, capital, risk tolerance)
    if (!sellerProfile.stage) {
      missingItems.push("Seller stage (from profile)");
    }
    if (!sellerProfile.monthly_revenue_range) {
      missingItems.push("Seller revenue range (from profile) - needed to assess capital constraints");
    }
    if (!sellerProfile.risk_tolerance) {
      missingItems.push("Seller risk tolerance (from profile)");
    }
  }
  
  // Check for profitability questions
  if (questionCategory === "PROFITABILITY") {
    const marginSnapshot = aiContext.margin_snapshot as any;
    const hasCogs = marginSnapshot?.estimated_cogs_min !== null && marginSnapshot?.estimated_cogs_min !== undefined;
    
    if (!hasCogs) {
      missingItems.push("COGS estimates (from margin snapshot or user input)");
      suggestions.push("Use the Feasibility Calculator to input your COGS assumptions");
    }
    
    // Price compression still needed
    const prices = listings
      .map((l: any) => l.price)
      .filter((p: any) => typeof p === 'number' && p > 0);
    
    if (prices.length < 5) {
      missingItems.push("Price data for at least 5 listings (to assess price compression)");
    }
  }
  
  // Check for strategy questions
  if (questionCategory === "STRATEGY") {
    // Need market structure data to suggest strategies
    const cpiScore = (snapshot?.cpi as any)?.score;
    if (cpiScore === null || cpiScore === undefined) {
      missingItems.push("CPI score (to assess market structure)");
    }
    
    const listingsCount = listings.length;
    if (listingsCount < 5) {
      missingItems.push("At least 5 listings (to identify market gaps)");
    }
  }
  
  // Check for risk questions
  if (questionCategory === "RISK_PROBING") {
    const cpiScore = (snapshot?.cpi as any)?.score;
    if (cpiScore === null || cpiScore === undefined) {
      missingItems.push("CPI score (to assess risk level)");
    }
    
    const top10Organic = listings
      .filter((l: any) => !l.is_sponsored)
      .slice(0, 10)
      .map((l: any) => l.reviews || l.review_count)
      .filter((r: any) => typeof r === 'number' && r > 0);
    
    if (top10Organic.length < 5) {
      missingItems.push("Review counts for top 10 organic listings (to assess review barrier)");
    }
  }
  
  // If no missing items, data is sufficient
  if (missingItems.length === 0) {
    return { sufficient: true, missingItems: [], suggestions: [] };
  }
  
  // Generate suggestions based on missing data
  if (missingItems.some(item => item.includes("review"))) {
    suggestions.push("Review data may be available in the listings - check if review counts are shown");
  }
  if (missingItems.some(item => item.includes("revenue"))) {
    suggestions.push("Revenue estimates are calculated from BSR - ensure listings have BSR data");
  }
  if (missingItems.some(item => item.includes("profile"))) {
    suggestions.push("Update your seller profile in Settings to include missing fields");
  }
  
  return {
    sufficient: false,
    missingItems,
    suggestions: suggestions.length > 0 ? suggestions : ["Run a new analysis to gather missing data"],
  };
}

/**
 * Determines if the AI can answer a question based on available data
 * 
 * NOTE: This function is now minimal - most blocking is handled by the system prompt.
 * Only use for hard blocks (predictions, guarantees, external data).
 * 
 * @param message - User's question
 * @param analysisResponse - Analysis response data
 * @param marketSnapshot - Market snapshot data
 * @param sellerProfile - Seller profile data
 * @returns Object with canAnswer boolean, missingItems array, and options array
 */
function canAnswerQuestion(
  message: string,
  analysisResponse: Record<string, unknown>,
  marketSnapshot: Record<string, unknown> | null,
  sellerProfile: {
    stage: string;
    experience_months: number | null;
    monthly_revenue_range: string | null;
    sourcing_model: string;
    goals?: string | null;
    risk_tolerance?: string | null;
    margin_target?: number | null;
    max_fee_pct?: number | null;
    updated_at?: string;
  },
  analysisMode: 'ASIN' | 'KEYWORD' | null = null
): {
  canAnswer: boolean;
  missingItems: string[];
  options: string[];
} {
  const normalized = message.toLowerCase().trim();
  const missingItems: string[] = [];
  const options: string[] = [];

  // Check for prediction/guarantee requests (always refuse)
  const predictionPatterns = [
    /\b(will|guarantee|guaranteed|predict|prediction|future|forecast|projected|expect|expectation)\b/i,
    /\b(guaranteed profit|guaranteed sales)\b/i,
  ];
  
  for (const pattern of predictionPatterns) {
    if (pattern.test(normalized)) {
      return {
        canAnswer: false,
        missingItems: ["Predictions and guarantees are not available"],
        options: ["Ask about current market data instead", "Ask about margin calculations using provided costs"],
      };
    }
  }
  
  // Check for data outside cached context (hard block)
  const externalDataPatterns = [
    /\b(exact sales volume|exact units sold|exact revenue|exact sales rank)\b/i,
    /\b(ppc cost|advertising cost|ad spend|sponsored ad cost)\b/i,
    /\b(conversion rate|click through rate|ctr)\b/i,
  ];
  
  if (externalDataPatterns.some(p => p.test(normalized))) {
    return {
      canAnswer: false,
      missingItems: ["This exact data is not available in the cached analysis"],
      options: ["Ask about estimated data available in the market snapshot", "Ask about margin calculations using provided costs"],
    };
  }

  // All other questions can be answered (system prompt will handle limitations)
  return { canAnswer: true, missingItems: [], options: [] };
}

/**
 * Validates AI response for hallucinations and scope violations
 * 
 * Tripwire conditions:
 * - Mentions data not present in context
 * - Uses forbidden phrases without citation (typically, usually, industry standard, most sellers, on average)
 * - References Amazon metrics not provided (ACOS, TACOS, CVR, sales velocity)
 * - Claims outside Amazon FBA scope
 * 
 * @param response - AI response text
 * @param allowedNumbers - Set of numbers that are allowed (from context)
 * @param allowedMetrics - Set of metrics that are allowed (from context)
 * @returns Object with isValid boolean and reason if invalid
 */
function validateResponseForHallucination(
  response: string,
  allowedNumbers: Set<number>,
  allowedMetrics: Set<string>
): {
  isValid: boolean;
  reason?: string;
} {
  const normalized = response.toLowerCase();
  
  // Forbidden phrases that require citation
  const forbiddenPhrases = [
    /\btypically\b/i,
    /\busually\b/i,
    /\bindustry standard\b/i,
    /\bmost sellers\b/i,
    /\bon average\b/i,
    /\bgenerally\b/i,
    /\bcommonly\b/i,
  ];
  
  // Check for forbidden phrases without citation
  for (const pattern of forbiddenPhrases) {
    if (pattern.test(response)) {
      // Check if there's a citation nearby (within 50 chars)
      const matches = response.matchAll(pattern);
      for (const match of matches) {
        const index = match.index || 0;
        const contextBefore = response.substring(Math.max(0, index - 50), index);
        const contextAfter = response.substring(index, Math.min(response.length, index + 100));
        const hasCitation = /(?:according to|based on|from|per|according|data shows|analysis shows|market data)/i.test(contextBefore + contextAfter);
        
        if (!hasCitation) {
          // Include exact offending substring in reason
          const exactSubstring = response.substring(
            Math.max(0, index - 20),
            Math.min(response.length, index + match[0].length + 20)
          );
          return {
            isValid: false,
            reason: `Forbidden phrase "${match[0]}" used without citation. Context: "${exactSubstring}"`,
          };
        }
      }
    }
  }
  
  // Check for unsupported Amazon metrics
  const unsupportedMetrics = [
    /\bacos\b/i,
    /\btacos\b/i,
    /\bcvr\b/i,
    /\bconversion rate\b/i,
    /\bsales velocity\b/i,
    // NOTE: We allow "estimated monthly units/revenue" elsewhere; numeric tripwire guards hallucinations.
    /\bunits per day\b/i,
    /\bdaily sales\b/i,
  ];
  
  for (const pattern of unsupportedMetrics) {
    const match = response.match(pattern);
    if (match) {
      // Include exact offending substring in reason
      const matchIndex = response.indexOf(match[0]);
      const exactSubstring = response.substring(
        Math.max(0, matchIndex - 30),
        Math.min(response.length, matchIndex + match[0].length + 30)
      );
      return {
        isValid: false,
        reason: `Unsupported metric referenced: "${match[0]}". Context: "${exactSubstring}"`,
      };
    }
  }
  
  // Extract numbers from response and check against allowed set
  const numberPattern = /\$?(\d+(?:\.\d+)?)/g;
  const numbersInResponse: number[] = [];
  let match;
  
  while ((match = numberPattern.exec(response)) !== null) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0) {
      numbersInResponse.push(num);
    }
  }
  
  // Check if any numbers are outside allowed set (with tolerance for rounding)
  // Allow numbers that are close to allowed numbers (±0.01 for small numbers, ±1% for larger)
  for (const num of numbersInResponse) {
    let isAllowed = false;
    
    for (const allowed of allowedNumbers) {
      const tolerance = allowed < 1 ? 0.01 : allowed * 0.01;
      if (Math.abs(num - allowed) <= tolerance) {
        isAllowed = true;
        break;
      }
    }
    
    // Also allow common percentages (0-100) if they're reasonable
    if (!isAllowed && num >= 0 && num <= 100 && num % 1 === 0) {
      // Could be a percentage - allow if it's a round number
      isAllowed = true;
    }
    
    // Allow currency amounts that are reasonable (not suspiciously specific)
    if (!isAllowed && num >= 1 && num <= 10000 && num % 0.01 === 0) {
      // Could be a price - allow if it's a reasonable currency amount
      isAllowed = true;
    }
    
    if (!isAllowed && num > 10000) {
      // Large numbers are suspicious - flag them
      return {
        isValid: false,
        reason: `Suspicious number referenced: ${num} (not in allowed dataset)`,
      };
    }
  }
  
  // Check for claims outside Amazon FBA scope
  const outOfScopePatterns = [
    /\b(ebay|etsy|shopify|walmart|target|retail store|brick and mortar)\b/i,
    /\b(manufacturing|factory|supply chain|logistics)\b/i,
    /\b(seo|google ads|facebook ads|social media marketing)\b/i,
  ];
  
  for (const pattern of outOfScopePatterns) {
    if (pattern.test(response)) {
      return {
        isValid: false,
        reason: `Out of scope claim: ${pattern.source}`,
      };
    }
  }
  
  return { isValid: true };
}

function addNumbersFromUnknown(value: unknown, out: Set<number>, depth = 0) {
  if (depth > 4) return;
  if (typeof value === "number" && !isNaN(value) && value > 0) {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) addNumbersFromUnknown(v, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      addNumbersFromUnknown(v, out, depth + 1);
    }
  }
}

/**
 * Extracts allowed numbers from context data
 * 
 * @param analysisResponse - Analysis response data
 * @param marketSnapshot - Market snapshot data
 * @param sellerProfile - Seller profile data
 * @returns Set of allowed numbers
 */
function extractAllowedNumbers(
  analysisResponse: Record<string, unknown>,
  marketSnapshot: Record<string, unknown> | null,
  sellerProfile: {
    stage: string;
    experience_months: number | null;
    monthly_revenue_range: string | null;
    sourcing_model: string;
    goals?: string | null;
    risk_tolerance?: string | null;
    margin_target?: number | null;
    max_fee_pct?: number | null;
    updated_at?: string;
  }
): Set<number> {
  const allowed = new Set<number>();
  
  // Extract from market snapshot
  if (marketSnapshot) {
    if (typeof marketSnapshot.avg_price === 'number') allowed.add(marketSnapshot.avg_price);
    if (typeof marketSnapshot.avg_reviews === 'number') allowed.add(marketSnapshot.avg_reviews);
    if (typeof marketSnapshot.avg_rating === 'number') allowed.add(marketSnapshot.avg_rating);
    if (typeof marketSnapshot.total_page1_listings === 'number') allowed.add(marketSnapshot.total_page1_listings);
    if (typeof marketSnapshot.sponsored_count === 'number') allowed.add(marketSnapshot.sponsored_count);
    if (typeof marketSnapshot.dominance_score === 'number') allowed.add(marketSnapshot.dominance_score);
    
    // Extract from margin snapshot
    // Note: margin_snapshot is now at analysisResponse.margin_snapshot (Part G), not nested in marketSnapshot
    // Legacy code removed - margin_snapshot extraction handled separately
    
    // Extract from FBA fees
    const fbaFees = marketSnapshot.fba_fees as Record<string, unknown> | null;
    if (fbaFees) {
      if (typeof fbaFees.total_fba_fees === 'number') allowed.add(fbaFees.total_fba_fees);
      if (typeof fbaFees.total_fee === 'number') allowed.add(fbaFees.total_fee);
      if (typeof fbaFees.fulfillment_fee === 'number') allowed.add(fbaFees.fulfillment_fee);
      if (typeof fbaFees.referral_fee === 'number') allowed.add(fbaFees.referral_fee);
    }
  }

  // Extract from Page-1 products (allows grounded per-product answers without triggering tripwire)
  const products = (analysisResponse.products as any[]) || (analysisResponse.page_one_listings as any[]) || [];
  for (const p of products) {
    if (p && typeof p === "object") {
      if (typeof p.price === "number") allowed.add(p.price);
      if (typeof p.rating === "number") allowed.add(p.rating);
      if (typeof p.review_count === "number") allowed.add(p.review_count);
      if (typeof p.reviews === "number") allowed.add(p.reviews); // legacy
      if (typeof p.bsr === "number") allowed.add(p.bsr);
      if (typeof p.estimated_monthly_units === "number") allowed.add(p.estimated_monthly_units);
      if (typeof p.estimated_monthly_revenue === "number") allowed.add(p.estimated_monthly_revenue);
    }
  }
  
  // Extract from analysis response
  const decision = analysisResponse.decision as Record<string, unknown> | null;
  if (decision && typeof decision.confidence === 'number') {
    allowed.add(decision.confidence);
  }
  
  const numbersUsed = analysisResponse.numbers_used as Record<string, unknown> | null;
  if (numbersUsed) {
    Object.values(numbersUsed).forEach(val => {
      if (typeof val === 'number') allowed.add(val);
      if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'number' && typeof val[1] === 'number') {
        allowed.add(val[0]);
        allowed.add(val[1]);
      }
    });
  }
  
  // Extract from seller profile
  if (typeof sellerProfile.experience_months === 'number') {
    allowed.add(sellerProfile.experience_months);
  }
  
  // Extract from margin_snapshot (Part G - includes refined costs)
  const marginSnapshot = analysisResponse.margin_snapshot as MarginSnapshot | null;
  if (marginSnapshot) {
    if (typeof marginSnapshot.assumed_price === 'number') allowed.add(marginSnapshot.assumed_price);
    if (typeof marginSnapshot.estimated_cogs_min === 'number') allowed.add(marginSnapshot.estimated_cogs_min);
    if (typeof marginSnapshot.estimated_cogs_max === 'number') allowed.add(marginSnapshot.estimated_cogs_max);
    if (typeof marginSnapshot.estimated_fba_fee === 'number') allowed.add(marginSnapshot.estimated_fba_fee);
    if (typeof marginSnapshot.breakeven_price_min === 'number') allowed.add(marginSnapshot.breakeven_price_min);
    if (typeof marginSnapshot.breakeven_price_max === 'number') allowed.add(marginSnapshot.breakeven_price_max);
  }
  
  return allowed;
}

/**
 * Formats a refusal response according to strict requirements
 * 
 * @param missingItems - Array of missing data items
 * @param options - Array of options for user to proceed
 * @returns Formatted refusal message
 */
function formatRefusalResponse(missingItems: string[], options: string[]): string {
  let response = "I don't have enough verified data to answer that yet.\n\n";
  
  if (missingItems.length > 0) {
    response += "Here's what's missing:\n";
    missingItems.forEach(item => {
      response += `• ${item}\n`;
    });
  }
  
  if (options.length > 0) {
    response += "\nI can proceed if you:\n";
    options.forEach(option => {
      response += `• ${option}\n`;
    });
  }
  
  return response.trim();
}

/**
 * Detects cost override patterns in user message
 * 
 * Recognizes structured inputs like:
 * - "My COGS is $22"
 * - "FBA fees are $9.80"
 * - "Use $20 cost and $8 fees"
 * - "COGS: $15"
 * - "fees: $10"
 * 
 * @param message - User message text
 * @param sellingPrice - Current selling price for validation
 * @returns Cost overrides object with cogs and/or fba_fees, or null if not detected or invalid
 */
function detectCostOverrides(
  message: string,
  sellingPrice?: number | null
): {
  cogs: number | null;
  fba_fees: number | null;
  validationError?: string;
} | null {
  const normalized = message.toLowerCase().trim();
  let cogs: number | null = null;
  let fbaFees: number | null = null;

  // Pattern 1: "My COGS is $X" or "COGS is $X" or "COGS: $X"
  const cogsPatterns = [
    /(?:my\s+)?cogs\s+(?:is|are|:)\s*\$?([\d,]+\.?\d*)/i,
    /cost\s+(?:is|are|:)\s*\$?([\d,]+\.?\d*)/i,
    /(?:use|set)\s+\$?([\d,]+\.?\d*)\s+(?:cost|cogs)/i,
  ];

  for (const pattern of cogsPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ""));
      if (!isNaN(value) && value > 0 && value < 10000) {
        // Sanity check: COGS should be reasonable
        cogs = value;
        break;
      }
    }
  }

  // Pattern 2: "FBA fees are $X" or "fees are $X" or "fees: $X"
  const feesPatterns = [
    /(?:fba\s+)?fees?\s+(?:is|are|:)\s*\$?([\d,]+\.?\d*)/i,
    /(?:use|set)\s+\$?([\d,]+\.?\d*)\s+(?:fees?|fba)/i,
  ];

  for (const pattern of feesPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ""));
      if (!isNaN(value) && value > 0 && value < 100) {
        // Sanity check: FBA fees should be reasonable
        fbaFees = value;
        break;
      }
    }
  }

  // Pattern 3: "Use $X cost and $Y fees" or "$X cost, $Y fees"
  const combinedPattern = /(?:use|set)\s+\$?([\d,]+\.?\d*)\s+(?:cost|cogs)\s+(?:and|,)\s+\$?([\d,]+\.?\d*)\s+fees?/i;
  const combinedMatch = normalized.match(combinedPattern);
  if (combinedMatch) {
    const costValue = parseFloat(combinedMatch[1].replace(/,/g, ""));
    const feesValue = parseFloat(combinedMatch[2].replace(/,/g, ""));
    if (!isNaN(costValue) && costValue > 0 && costValue < 10000) {
      cogs = costValue;
    }
    if (!isNaN(feesValue) && feesValue > 0 && feesValue < 100) {
      fbaFees = feesValue;
    }
  }

  // Validation guardrails
  if (cogs !== null) {
    if (cogs <= 0) {
      return {
        cogs: null,
        fba_fees: fbaFees,
        validationError: "COGS must be greater than zero. Please provide a valid cost.",
      };
    }
    if (sellingPrice !== null && sellingPrice !== undefined && cogs >= sellingPrice) {
      const cogsStr = typeof cogs === 'number' && !isNaN(cogs) ? cogs.toFixed(2) : String(cogs);
      const priceStr = typeof sellingPrice === 'number' && !isNaN(sellingPrice) ? sellingPrice.toFixed(2) : String(sellingPrice);
      return {
        cogs: null,
        fba_fees: fbaFees,
        validationError: `COGS ($${cogsStr}) cannot be greater than or equal to the selling price ($${priceStr}). Please provide a valid cost.`,
      };
    }
  }

  if (fbaFees !== null) {
    if (fbaFees <= 0) {
      return {
        cogs,
        fba_fees: null,
        validationError: "FBA fees must be greater than zero. Please provide a valid fee amount.",
      };
    }
    if (sellingPrice !== null && sellingPrice !== undefined && fbaFees >= sellingPrice) {
      const feesStr = typeof fbaFees === 'number' && !isNaN(fbaFees) ? fbaFees.toFixed(2) : String(fbaFees);
      const priceStr = typeof sellingPrice === 'number' && !isNaN(sellingPrice) ? sellingPrice.toFixed(2) : String(sellingPrice);
      return {
        cogs,
        fba_fees: null,
        validationError: `FBA fees ($${feesStr}) cannot be greater than or equal to the selling price ($${priceStr}). Please provide a valid fee amount.`,
      };
    }
  }

  // Only return if at least one value was detected and validated
  if (cogs !== null || fbaFees !== null) {
    return { cogs, fba_fees: fbaFees };
  }

  return null;
}

/**
 * Detects user intent to run an exact FBA fees + profitability lookup (SP-API Fees).
 * This is handled WITHOUT calling the LLM or Rainforest, and is fulfilled via /api/fba-fees.
 */
function detectFbaProfitabilityIntent(message: string): boolean {
  const t = message.toLowerCase();
  // Tightened to avoid accidental triggers on generic "fees" or "margin" questions
  const hasFeesOrProfitSignal =
    t.includes("profit") ||
    t.includes("profitability") ||
    t.includes("is this profitable") ||
    t.includes("margin") ||
    t.includes("fee") ||
    t.includes("fees");

  const hasFbaOrAmazonFeesSignal =
    t.includes("fba") ||
    t.includes("fulfillment fee") ||
    t.includes("referral fee") ||
    t.includes("amazon fee") ||
    t.includes("amazon fees") ||
    t.includes("seller api");

  const hasExplicitActionSignal =
    t.includes("run fees") ||
    t.includes("calculate fba") ||
    t.includes("calculate fees") ||
    t.includes("fee lookup");

  // Require either explicit action, or an FBA/Amazon-fees anchor
  return hasFeesOrProfitSignal && (hasExplicitActionSignal || hasFbaOrAmazonFeesSignal);
}

/**
 * Builds Market Snapshot Summary from cached response.market_snapshot data.
 * NO recomputation - uses only cached values.
 */
function buildMarketSnapshotSummary(
  marketSnapshot: Record<string, unknown> | null
): string {
  // HARDEN: Never crash on missing market snapshot (Step 6)
  if (!marketSnapshot || typeof marketSnapshot !== 'object') {
    return "=== MARKET SNAPSHOT ===\nMarket snapshot data is not available. This analysis may have used estimated values.";
  }

  const parts: string[] = [];
  
  // Competitive Pressure (CPI) - MUST be first
  try {
    const cpi = (marketSnapshot.cpi as {
      score?: number;
      label?: string;
    } | null) || null;
    if (cpi && typeof cpi === 'object' && cpi !== null && 
        typeof cpi.score === 'number' && typeof cpi.label === 'string') {
      parts.push(`- Competitive Pressure: ${cpi.label} (CPI ${cpi.score})`);
    }
  } catch (error) {
    // If CPI access fails, skip it
    console.error("Error accessing CPI in summary:", error);
  }
  
  // Price Band
  const avgPrice = (marketSnapshot.avg_price as number) || null;
  if (avgPrice !== null && typeof avgPrice === 'number' && !isNaN(avgPrice)) {
    parts.push(`- Price Band: $${avgPrice.toFixed(2)}`);
  }
  
  // Review Moat - HARDEN: always default to 0, never null (Step 6)
  const avgReviews = (typeof marketSnapshot.avg_reviews === 'number' && !isNaN(marketSnapshot.avg_reviews))
    ? marketSnapshot.avg_reviews
    : 0; // Default to 0, not null
  if (avgReviews > 0) {
    parts.push(`- Review Moat: ${avgReviews.toLocaleString()} reviews`);
  } else {
    parts.push(`- Review Moat: <10 (new market)`);
  }
  
  // Quality Threshold
  const avgRating = (marketSnapshot.avg_rating as number) || null;
  if (avgRating !== null && typeof avgRating === 'number' && !isNaN(avgRating)) {
    parts.push(`- Quality Threshold: ${avgRating.toFixed(1)} rating`);
  }
  
  // Competitive Density - HARDEN: check both field names (Step 6)
  const totalListings = (typeof marketSnapshot.page1_count === 'number' && !isNaN(marketSnapshot.page1_count))
    ? marketSnapshot.page1_count
    : (typeof marketSnapshot.total_page1_listings === 'number' && !isNaN(marketSnapshot.total_page1_listings))
      ? marketSnapshot.total_page1_listings
      : null;
  if (totalListings !== null && totalListings !== undefined) {
    parts.push(`- Competitive Density: ${totalListings} listings`);
  }
  
  // Ad Saturation
  const sponsoredCount = (marketSnapshot.sponsored_count as number) || null;
  if (sponsoredCount !== null && sponsoredCount !== undefined) {
    parts.push(`- Ad Saturation: ${sponsoredCount} sponsored`);
  }
  
  if (parts.length === 0) {
    return "";
  }
  
  return `MARKET SNAPSHOT SUMMARY:\n${parts.join("\n")}`;
}

export async function POST(req: NextRequest) {
  // Create response object for cookie handling
  const res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // 2. Parse and validate request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400, headers: res.headers }
      );
    }

    if (!validateRequestBody(body)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid request body. Expected { analysisRunId: string, message: string }",
        },
        { status: 400, headers: res.headers }
      );
    }

    // 3. Fetch the analysis run (CACHED DATA ONLY - no live API calls)
    // ────────────────────────────────────────────────────────────────
    // This is critical for anti-hallucination: we only use data that was
    // already validated and stored during the original analysis.
    // ❗ CHAT MUST NEVER RE-CALL RAINFOREST - only use cached data
    
    // Validate analysisRunId format (should be UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(body.analysisRunId)) {
      console.error("CHAT_INVALID_ANALYSIS_RUN_ID", {
        analysisRunId: body.analysisRunId,
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
      
      return NextResponse.json(
        { ok: false, error: "Invalid analysis run ID format" },
        { status: 400, headers: res.headers }
      );
    }
    
    const { data: analysisRun, error: analysisError } = await supabase
      .from("analysis_runs")
      .select("*")
      .eq("id", body.analysisRunId)
      .eq("user_id", user.id) // Security: ensure user owns this analysis
      .single();

    if (analysisError || !analysisRun) {
      // Enhanced error logging for debugging
      console.error("CHAT_ANALYSIS_FETCH_ERROR", {
        analysisRunId: body.analysisRunId,
        userId: user.id,
        error: analysisError,
        errorCode: analysisError?.code,
        errorMessage: analysisError?.message,
        errorDetails: analysisError?.details,
        errorHint: analysisError?.hint,
        foundAnalysis: !!analysisRun,
        // Try to find if analysis exists with different user_id (for debugging)
        timestamp: new Date().toISOString(),
      });
      
      // Try to check if analysis exists but with different user_id (for debugging only)
      const { data: analysisExists } = await supabase
        .from("analysis_runs")
        .select("id, user_id")
        .eq("id", body.analysisRunId)
        .single();
      
      if (analysisExists) {
        console.error("CHAT_ANALYSIS_EXISTS_BUT_WRONG_USER", {
          analysisRunId: body.analysisRunId,
          analysisUserId: analysisExists.user_id,
          currentUserId: user.id,
          usersMatch: analysisExists.user_id === user.id,
        });
      }
      
      return NextResponse.json(
        { ok: false, error: "Analysis not found or access denied" },
        { status: 404, headers: res.headers }
      );
    }

    // 4. Fetch seller profile snapshot (always load latest with updated_at for versioning)
    // First try with all fields (including new optional fields), fall back to core fields if needed
    let { data: sellerProfile, error: profileError } = await supabase
      .from("seller_profiles")
      .select("stage, experience_months, monthly_revenue_range, sourcing_model, goals, risk_tolerance, margin_target, max_fee_pct, updated_at")
      .eq("id", user.id)
      .single();

    // If error indicates missing columns (new fields don't exist yet), fall back to core fields only
    if (profileError) {
      const errorMsg = profileError.message || String(profileError);
      // Check if it's a column-related error (new fields don't exist) vs profile doesn't exist
      if (errorMsg.includes("column") || errorMsg.includes("does not exist")) {
        console.warn("New profile fields not available, falling back to core fields:", errorMsg);
        const { data: coreProfile, error: coreError } = await supabase
          .from("seller_profiles")
          .select("stage, experience_months, monthly_revenue_range, sourcing_model")
          .eq("id", user.id)
          .single();
        
        if (coreError || !coreProfile) {
          console.error("Seller profile not found even with core fields:", coreError);
          return NextResponse.json(
            { ok: false, error: "Seller profile not found" },
            { status: 403, headers: res.headers }
          );
        }
        
        // Add defaults for new fields
        sellerProfile = {
          ...coreProfile,
          goals: null,
          risk_tolerance: null,
          margin_target: null,
          max_fee_pct: null,
          updated_at: null,
        };
        profileError = null;
      } else {
        // Different error (profile doesn't exist, permission issue, etc.)
        console.error("Seller profile fetch error:", profileError);
        return NextResponse.json(
          { ok: false, error: "Seller profile not found" },
          { status: 403, headers: res.headers }
        );
      }
    }

    if (!sellerProfile) {
      return NextResponse.json(
        { ok: false, error: "Seller profile not found" },
        { status: 403, headers: res.headers }
      );
    }

    // 4a. Seller memory (legacy blob) is NO LONGER stored in `seller_memory`.
    // `seller_memory` is now the structured memory table (memory_type/key/value).
    // To prevent chat failures from schema mismatches, we build a safe in-memory
    // SellerMemory snapshot from seller_profiles each turn.
    let sellerMemory: SellerMemory = createDefaultSellerMemory();
    try {
      const profileData = mapSellerProfileToMemory(sellerProfile);
      sellerMemory.seller_profile = {
        ...sellerMemory.seller_profile,
        ...profileData,
      };
    } catch (e) {
      console.error("Failed to map seller profile into sellerMemory (non-blocking):", e);
    }
    
    // Record analyzed keyword in memory (append-only, no confirmation needed)
    // All analyses are keyword-only now
    sellerMemory = recordAnalyzedKeyword(sellerMemory, analysisRun.input_value);
    
    // 5a. Load structured seller memories (new memory system)
    // ────────────────────────────────────────────────────────────────────────
    // Load factual memories from seller_memory table
    // ────────────────────────────────────────────────────────────────────────
    let structuredMemories: Array<{
      memory_type: string;
      key: string;
      value: unknown;
    }> = [];
    
    let pendingMemoriesForConfirmation: Array<{
      id: string;
      memory_candidate: {
        memory_type: string;
        key: string;
        value: unknown;
      };
      reason: string;
    }> = [];
    
    try {
      const { getSellerMemories } = await import("@/lib/ai/sellerMemoryStore");
      const { shouldAskUserToConfirm, formatMemoryForConfirmation } = await import("@/lib/ai/memoryMerge");
      
      // Load confirmed memories
      const memoryRecords = await getSellerMemories(supabase, user.id);
      structuredMemories = memoryRecords.map((m) => ({
        memory_type: m.memory_type,
        key: m.key,
        value: m.value,
      }));
      
      // Load pending memories that should be confirmed
      const { data: pendingMemoryData } = await supabase
        .from("pending_memory")
        .select("*")
        .eq("user_id", user.id);
      const pendingMemories = pendingMemoryData || [];
      pendingMemoriesForConfirmation = pendingMemories
        .filter((p) => shouldAskUserToConfirm(p.memory_candidate, p.reason))
        .map((p) => ({
          id: p.id,
          memory_candidate: {
            memory_type: p.memory_candidate.memory_type,
            key: p.memory_candidate.key,
            value: p.memory_candidate.value,
          },
          reason: p.reason,
        }));
    } catch (memoryError) {
      console.error("Failed to load structured seller memories:", memoryError);
      // Continue without structured memories - don't block chat
    }
    
    // NOTE: We do not write the legacy sellerMemory blob to the DB.
    // Structured memories are handled by the memory extraction + merge pipeline and stored in `seller_memory` (memory_type/key/value).

    // 5. Fetch all prior analysis_messages for this run (conversation history)
    // ────────────────────────────────────────────────────────────────────────
    // Load from database to ensure continuity across sessions
    const { data: priorMessages } = await supabase
      .from("analysis_messages")
      .select("role, content")
      .eq("analysis_run_id", body.analysisRunId)
      .order("created_at", { ascending: true });

    // 6. COGS assumptions context (optional helper for chat)
    // ─────────────────────────────────────────────────────────────────────
    // Reference margin_snapshot for COGS - chat should use margin_snapshot directly
    const analysisResponse = analysisRun.response as Record<string, unknown>;
    let marketSnapshot = (analysisResponse.market_snapshot as Record<string, unknown>) || null;
    const marginSnapshotForCogs = (analysisResponse.margin_snapshot as MarginSnapshot) || null;
    
    let cogsAssumption: string = "";
    
    // If margin_snapshot exists, extract COGS info from it
    if (marginSnapshotForCogs && 
        marginSnapshotForCogs.estimated_cogs_min !== null && marginSnapshotForCogs.estimated_cogs_min !== undefined &&
        marginSnapshotForCogs.estimated_cogs_max !== null && marginSnapshotForCogs.estimated_cogs_max !== undefined &&
        typeof marginSnapshotForCogs.estimated_cogs_min === 'number' && !isNaN(marginSnapshotForCogs.estimated_cogs_min) &&
        typeof marginSnapshotForCogs.estimated_cogs_max === 'number' && !isNaN(marginSnapshotForCogs.estimated_cogs_max)) {
      const estimatedRange = marginSnapshotForCogs.estimated_cogs_min === marginSnapshotForCogs.estimated_cogs_max
        ? `$${marginSnapshotForCogs.estimated_cogs_min.toFixed(2)}`
        : `$${marginSnapshotForCogs.estimated_cogs_min.toFixed(2)}–$${marginSnapshotForCogs.estimated_cogs_max.toFixed(2)}`;
      
      const confidenceLabel = marginSnapshotForCogs.confidence_tier === 'EXACT' ? "High confidence (exact)"
        : marginSnapshotForCogs.confidence_tier === 'REFINED' ? "Medium confidence (user-refined)"
        : "Medium confidence (estimated)";
      
      cogsAssumption = `\n\nCOGS_REFERENCE:\n{
  range: "${estimatedRange}",
  confidence: "${confidenceLabel}",
  source: "${marginSnapshotForCogs.cogs_source}",
  sourcing_model: "${sellerProfile.sourcing_model}",
  confidence_tier: "${marginSnapshotForCogs.confidence_tier}"
}`;
    } else {
      // Fallback: compute from seller profile (should not happen if margin_snapshot exists)
      const avgPrice = (marketSnapshot?.avg_price as number) || null;
      const category = (marketSnapshot?.category as string) || null;
      
      if (avgPrice !== null && avgPrice > 0 && sellerProfile.sourcing_model) {
        try {
          const cogsEstimate = estimateCogsRange({
            price: avgPrice,
            category: category,
            sourcing_model: sellerProfile.sourcing_model as any,
          });
          
          const estimatedRange = typeof cogsEstimate.low === 'number' && !isNaN(cogsEstimate.low) && 
                                 typeof cogsEstimate.high === 'number' && !isNaN(cogsEstimate.high)
            ? `$${cogsEstimate.low.toFixed(2)}–$${cogsEstimate.high.toFixed(2)}`
            : "Not available";
          const confidenceLabel = cogsEstimate.confidence === "low" ? "Low confidence" 
            : cogsEstimate.confidence === "medium" ? "Medium confidence" 
            : "High confidence";
          
          cogsAssumption = `\n\nCOGS_REFERENCE:\n{
  estimated_range: "${estimatedRange}",
  confidence: "${confidenceLabel}",
  rationale: "${cogsEstimate.rationale}",
  sourcing_model: "${sellerProfile.sourcing_model}",
  category: "${category || "not specified"}"
}`;
        } catch (error) {
          // Fail silently - COGS assumptions are optional
          console.error("Failed to compute COGS assumptions:", error);
        }
      }
    }

    // 7. Cost Refinement Loop (Chat-Driven)
    // ────────────────────────────────────────────────────────────────────────
    // Detect user refinements to COGS/FBA fees, update margin_snapshot, recalculate, persist
    // ────────────────────────────────────────────────────────────────────────
    
    const currentResponse = analysisResponse as Record<string, unknown>;
    
    // Get current margin_snapshot (from Part G, stored at decisionJson.margin_snapshot)
    let marginSnapshot: MarginSnapshot | null = (currentResponse.margin_snapshot as MarginSnapshot) || null;
    
    // Detect cost refinements in user message
    const sellingPrice = marginSnapshot?.assumed_price || null;
    const costRefinement = detectCostRefinement(body.message, sellingPrice);
    let refinementError: string | null = null;
    let shouldSaveSnapshot = false;
    
    // Apply refinements if detected
    if (costRefinement && marginSnapshot) {
      if (costRefinement.validationError) {
        refinementError = costRefinement.validationError;
      } else {
        try {
          // Apply refinements to margin snapshot
          marginSnapshot = refineMarginSnapshot(marginSnapshot, {
            cogs: costRefinement.cogs,
            fbaFee: costRefinement.fbaFee,
          });
          shouldSaveSnapshot = true;
        } catch (error) {
          console.error("Error refining margin snapshot:", error);
          refinementError = "Failed to apply cost refinements. Please try again.";
        }
      }
    }
    
    // Persist updated margin_snapshot if refinements were applied
    if (shouldSaveSnapshot && marginSnapshot) {
      const updatedResponse = {
        ...currentResponse,
        margin_snapshot: marginSnapshot,
      };
      
      // SECURITY: .eq("id", body.analysisRunId) ensures update applies ONLY to this analysis_run
      const { error: updateError } = await supabase
        .from("analysis_runs")
        .update({ response: updatedResponse })
        .eq("id", body.analysisRunId)
        .eq("user_id", user.id);

      if (updateError) {
        console.error("Failed to save refined margin_snapshot:", updateError);
        // Continue anyway - don't block the chat response
      } else {
        // Update local analysisResponse for context building
        Object.assign(analysisResponse, updatedResponse);
      }
    }

    // ASIN extraction and validation
    // ═══════════════════════════════════════════════════════════════════════════
    // EXTRACT SELECTED ASINS / EXPLICIT ASINS (SINGLE SOURCE OF TRUTH)
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: selectedAsins is the single source of truth
    // Only use selectedListing as fallback if selectedAsins is empty/undefined
    // If selectedAsins.length === 0, NO ASIN is selected (Copilot must not reference any ASIN)
    let selectedAsins: string[] = Array.isArray(body.selectedAsins) && body.selectedAsins.length > 0
      ? body.selectedAsins.filter(asin => asin && typeof asin === 'string') // Filter out invalid ASINs
      : (body.selectedListing?.asin && typeof body.selectedListing.asin === 'string'
        ? [body.selectedListing.asin] // Backward compatibility fallback
        : []); // Empty array = no selection
    
    // PRIORITY A.3: Extract ASINs from message text (only when selectedAsins is empty)
    // CRITICAL: UI selection is authoritative - only use extracted ASINs when no UI selection exists
    // CRITICAL: Only extract ASINs that exist in ai_context.products OR selected_asins
    let extractedAsinsFromMessage: string[] = [];
    let mergeSkipped = false;
    
    if (selectedAsins.length === 0) {
      // Get valid ASINs from ai_context.products (Page-1 listings)
      const page1Listings = (analysisResponse.page_one_listings as any[]) || (analysisResponse.products as any[]) || [];
      const validAsins = page1Listings
        .map((p: any) => p.asin)
        .filter((asin: any): asin is string => asin && typeof asin === 'string');
      
      // Only extract ASINs that exist in valid ASINs list
      extractedAsinsFromMessage = extractAsinsFromText(body.message, validAsins);
      
      if (extractedAsinsFromMessage.length > 0) {
        // Only merge when selectedAsins is empty (user typed ASINs manually)
        selectedAsins = extractedAsinsFromMessage;
      }
    } else {
      // UI selection exists - skip extraction merge
      mergeSkipped = true;
    }
    
    console.log("ASIN_EXTRACTION_FROM_MESSAGE", {
      analysisRunId: body.analysisRunId,
      extracted_asins: extractedAsinsFromMessage,
      filtered_extracted_asins: extractedAsinsFromMessage, // After validation
      original_selected: body.selectedAsins || [],
      merge_skipped: mergeSkipped,
      final_selected: selectedAsins,
      selected_count: selectedAsins.length,
    });
    
    // PRIORITY A.4: Handle "this one/selected/that listing" when selectedAsins is empty
    const normalizedMessage = body.message.toLowerCase();
    const referencesSelection = /this (one|listing|product)|selected|that listing|that product|the selected/i.test(normalizedMessage);
    if (referencesSelection && selectedAsins.length === 0) {
      // Return early with a follow-up question
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: "Which ASIN should I use?" })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...Object.fromEntries(res.headers.entries()),
        },
      });
    }
    
    console.log("SELECTED_ASINS_RECEIVED", {
      analysisRunId: body.analysisRunId,
      selected_asins: selectedAsins,
      selected_count: selectedAsins.length,
      extracted_from_message: extractedAsinsFromMessage,
    });

    // Encoder for lightweight SSE responses (intents / guardrails) before OpenAI streaming
    const encoder = new TextEncoder();

    // ═══════════════════════════════════════════════════════════════════════════
    // COPILOT INTENT: FBA PROFITABILITY LOOKUP (SP-API Fees, chat-only)
    // ═══════════════════════════════════════════════════════════════════════════
    // IMPORTANT: This must NOT block normal chat answers.
    // For the valid (exactly 1 ASIN) case we:
    // - emit SSE metadata to trigger the inline fees UI
    // - still call the LLM and stream a helpful assistant response
    const isFbaProfitabilityIntent = detectFbaProfitabilityIntent(body.message);
    let copilotIntentMetadata: null | {
      type: "copilot_intent";
      intent: "fba_profitability_lookup";
      asins: string[];
      asin: string;
    } = null;
    if (isFbaProfitabilityIntent) {
      console.log("[COPILOT_INTENT]", {
        intent: "fba_profitability_lookup",
        user_id: user.id,
        analysis_run_id: body.analysisRunId,
        selected_asins: selectedAsins,
        selected_count: selectedAsins.length,
        timestamp: new Date().toISOString(),
      });

      // Hard rule: exactly 1 ASIN must be selected
      if (selectedAsins.length === 0) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  content:
                    "I can calculate **exact FBA fees** for a product using Amazon’s **Seller API**—but I need you to **select exactly 1 ASIN** first.\n\nRight now you have **0 selected**, so I can’t run the fee lookup yet.\n\nPlease select **one** product card and then tell me “run fees”.",
                })}\n\n`
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      }

      if (selectedAsins.length > 1) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  content:
                    `I can calculate **exact FBA fees** using Amazon’s **Seller API**, but the fee lookup supports **exactly 1 ASIN at a time**.\n\nYou currently have **${selectedAsins.length} ASINs selected**, so I’m going to pause here to avoid mixing products.\n\nPlease **deselect down to 1 ASIN**, then tell me “run fees”.`,
                })}\n\n`
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      }

      // Valid: exactly 1 ASIN selected → emit intent metadata AND continue to LLM.
      copilotIntentMetadata = {
        type: "copilot_intent",
        intent: "fba_profitability_lookup",
        asins: selectedAsins,
        asin: selectedAsins[0],
      };
    }
    
    // Guardrail input: explicit ASINs in user question (allows escalation only when explicitly referenced)
    // Get Page-1 ASINs for validation (optional but preferred)
    const page1ListingsForEscalation = (analysisResponse.page_one_listings as any[]) || (analysisResponse.products as any[]) || [];
    const page1AsinsForEscalation = page1ListingsForEscalation
      .map((p: any) => p.asin)
      .filter((asin: any): asin is string => asin && typeof asin === 'string');
    const explicitAsins = extractAsinsFromText(body.message, page1AsinsForEscalation);
    const isExplicitCompare =
      /\b(vs|versus|compare|comparison)\b/i.test(body.message) || explicitAsins.length >= 2;
    const maxEscalationAsins = isExplicitCompare ? 2 : 1;
    const confirmedAsins = Array.isArray(body.escalationAsins)
      ? body.escalationAsins.filter((a) => a && typeof a === "string")
      : [];
    const eligibleAsinsForEscalation =
      body.escalationConfirmed === true && confirmedAsins.length > 0
        ? confirmedAsins
        : (selectedAsins.length > 0 ? selectedAsins : explicitAsins);

    // For backward compatibility and single-ASIN logic, also extract first ASIN
    // CRITICAL: If selectedAsins.length === 0, selectedAsin must be null
    const selectedAsin = selectedAsins.length > 0 ? selectedAsins[0] : null;
    const effectiveSelectedAsinForEscalation = eligibleAsinsForEscalation.length > 0 ? eligibleAsinsForEscalation[0] : null;
    
    // 8. Build grounded context message
    // ─────────────────────────────────────────────────────────────────────
    // WHY VERDICTS CANNOT SILENTLY CHANGE:
    // The original verdict is injected as "AUTHORITATIVE" in the context.
    // The CHAT_SYSTEM_PROMPT explicitly states:
    // - "NEVER contradict the original verdict without explanation"
    // - "Verdict does not change automatically"
    // - "Explain what would need to change for verdict to change"
    // ─────────────────────────────────────────────────────────────────────
    let contextMessage: string;
    let marketSnapshotSummary: string;
    
    try {
      contextMessage = buildContextMessage(
        analysisResponse,
        analysisRun.rainforest_data as Record<string, unknown> | null,
        sellerProfile,
        analysisRun.input_type,
        analysisRun.input_value,
        body.selectedListing || null, // Backward compatibility
        selectedAsins // Multi-ASIN support
      );

      // 9. Build Market Snapshot Summary (from cached response.market_snapshot only)
      marketSnapshotSummary = buildMarketSnapshotSummary(
        (analysisResponse.market_snapshot as Record<string, unknown>) || null
      );
    } catch (error) {
      console.error("Error building context message:", error);
      const errorDetails = error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : { error: String(error) };
      console.error("CONTEXT_BUILD_ERROR_DETAILS", errorDetails);
      
      // Fallback to minimal context
      contextMessage = `Analysis for ${analysisRun.input_type}: ${analysisRun.input_value}`;
      marketSnapshotSummary = "";
    }

    // If fee intent is active, instruct the assistant to respond normally AND guide the inline fees workflow.
    if (copilotIntentMetadata) {
      const priceHint =
        typeof body.selectedListing?.price === "number" && body.selectedListing.price > 0
          ? `$${body.selectedListing.price.toFixed(2)}`
          : "the current listing price";
      contextMessage += `\n\nCOPILOT_INTENT: FBA_PROFITABILITY_LOOKUP\nUser asked to run Amazon fees/profitability for the selected ASIN (${copilotIntentMetadata.asin}).\nFrontend will attempt to fetch an exact Seller API fee quote at ${priceHint}.\nYou MUST still answer normally:\n- Briefly say you're attempting to fetch exact Amazon fees using Amazon's Seller API.\n- Tell the user what they'll see (fee breakdown first), and that they can retry or change price if it fails.\n- Ask for COGS and inbound shipping (and optional other costs) so profitability can be calculated after fees load.\n- Do not proceed silently.\n`;
    }

    // Determine analysis mode from input_type
    const analysisMode: 'KEYWORD' = 'KEYWORD'; // All analyses are keyword-only
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ESCALATION DECISION ENGINE (NEW)
    // ═══════════════════════════════════════════════════════════════════════════
    // Check if this question requires escalation to type=product API calls
    // This enforces the Escalation Policy and Credit & Pricing Policy
    // Note: selectedAsins and selectedAsin are already defined above
    
    // Build Page-1 context for escalation decision
    const products = (analysisResponse.products as any[]) || (analysisResponse.page_one_listings as any[]) || [];
    const page1Context: Page1Context = {
      products: products.map(p => ({
        asin: p.asin,
        title: p.title || null,
        price: p.price || 0,
        rating: p.rating || 0,
        review_count: p.review_count ?? null, // Preserve null, never invent
        bsr: p.bsr || null,
        estimated_monthly_units: p.estimated_monthly_units || 0,
        estimated_monthly_revenue: p.estimated_monthly_revenue || 0,
        revenue_share_pct: p.revenue_share_pct || 0,
        fulfillment: p.fulfillment || "FBM",
        organic_rank: p.organic_rank || null,
        page_position: p.page_position || 0,
        is_sponsored: p.is_sponsored || false,
        page_one_appearances: p.page_one_appearances || 1,
        is_algorithm_boosted: p.is_algorithm_boosted || false,
      })),
      market_snapshot: {
        avg_price: (analysisResponse.summary as any)?.avg_price || 0,
        avg_rating: (analysisResponse.summary as any)?.avg_rating || 0,
        avg_bsr: (analysisResponse.summary as any)?.avg_bsr || null,
        total_monthly_units_est: (analysisResponse.summary as any)?.total_monthly_units_est || 0,
        total_monthly_revenue_est: (analysisResponse.summary as any)?.total_monthly_revenue_est || 0,
        page1_product_count: (analysisResponse.summary as any)?.page1_product_count || 0,
        sponsored_count: (analysisResponse.summary as any)?.sponsored_count || null,
      },
      market_structure: {
        price_band: (analysisResponse.market_structure as any)?.price_band || { min: 0, max: 0, tightness: "moderate" },
        fulfillment_mix: (analysisResponse.market_structure as any)?.fulfillment_mix || { fba_pct: 0, fbm_pct: 0, amazon_pct: 0 },
        review_barrier: (analysisResponse.market_structure as any)?.review_barrier || { median_reviews: 0, top_5_avg_reviews: 0 },
        page1_density: (analysisResponse.market_structure as any)?.page1_density || 0,
      },
      brand_moat: (analysisResponse.brand_moat as any) || undefined,
    };
    
    // ────────────────────────────────────────────────────────────────────────
    // FIX (Credtless chat on existing context):
    // Credits are ONLY required to CREATE new data (escalation / provider calls),
    // NOT to answer Page-1 questions about an existing analysis run.
    //
    // We therefore avoid calling checkCreditBalance unless escalation is actually required.
    // ────────────────────────────────────────────────────────────────────────
    const optimisticCreditContext: CreditContext = {
      available_credits: Number.MAX_SAFE_INTEGER,
      session_credits_used: 0,
      daily_credits_used: 0,
      max_session_credits: 10,
      max_daily_credits: 50,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ENRICHMENT DECISION (SP-API catalog + Rainforest product)
    // ═══════════════════════════════════════════════════════════════════════════
    // GOAL: No credits gating - use hard limits instead
    const MAX_ENRICHMENT_ASINS_PER_MESSAGE = 2; // Per user message (hard cap for all enrichment types)
    const MAX_ENRICHMENT_CALLS_PER_SESSION = 20; // Total across chat for this analysis_run_id
    
    const normalizedQuestion = body.message.toLowerCase();
    
    // GOAL 4A: Variants/attributes/bullets/description intent detection
    const variantsAttributesIntent = /variant|variants|variation|variations|size|sizes|color|colors|colour|colours|version|versions|how many variants|which variant|attributes?|bullet points?|bullets?|description|title details?|material|dimensions?|specifications?/i.test(body.message);
    
    // GOAL 4B: Review insights intent detection (complaints, praise, customer feedback)
    // Keywords: complain, complaints, bad reviews, negative reviews, common issues, pros and cons,
    // what do customers say, praise, good reviews, positive reviews, customer feedback
    const reviewInsightsIntent = /complain|complaints|bad reviews?|negative reviews?|common issues?|pros and cons|what do customers (say|complain about)|praise|good reviews?|positive reviews?|customer feedback|issues?|problems?/i.test(body.message);
    
    // If selectedAsins exists AND any intent is true, enrichment MUST execute (zero-confirmation)
    // For review insights: max 2 ASINs (hard cap)
    const requiresEnrichment = (variantsAttributesIntent || reviewInsightsIntent) && selectedAsins.length > 0;
    
    // Special handling: block enrichment if 3+ ASINs selected (for both variants and review insights)
    let enrichmentAsins: string[] = [];
    if (requiresEnrichment) {
      if (selectedAsins.length > 2) {
        // Block enrichment for 3+ ASINs - return early with clear message
        const message = reviewInsightsIntent 
          ? `Select 1–2 products to analyze reviews. You currently have ${selectedAsins.length} selected.`
          : `Select 1–2 products to analyze product details. You currently have ${selectedAsins.length} selected.`;
        
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: message })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      } else {
        // Cap at 2 ASINs for all enrichment types
        enrichmentAsins = selectedAsins.slice(0, 2);
      }
    }
    
    const enrichmentTypes: Array<'spapi_catalog' | 'rainforest_product' | 'rainforest_reviews'> = [];
    if (requiresEnrichment && enrichmentAsins.length > 0) {
      if (variantsAttributesIntent) enrichmentTypes.push('spapi_catalog');
      if (reviewInsightsIntent) {
        // For review insights: try product endpoint first, fallback to reviews if needed
        enrichmentTypes.push('rainforest_product');
        // Note: reviews endpoint will be called automatically if customers_say is missing
      }
    }
    
    console.log("ENRICHMENT_DECISION", {
      analysisRunId: body.analysisRunId,
      requires_enrichment: requiresEnrichment,
      variants_attributes_intent: variantsAttributesIntent,
      review_insights_intent: reviewInsightsIntent,
      selected_asins: selectedAsins,
      selected_asins_count: selectedAsins.length,
      enrichment_asins: enrichmentAsins,
      enrichment_types: enrichmentTypes,
      capped_to: MAX_ENRICHMENT_ASINS_PER_MESSAGE,
      blocked_for_3plus: selectedAsins.length > 2,
    });

    // Pass 1: decide escalation WITHOUT hitting credits DB (fast, and does not block history chat).
    let escalationDecision = decideEscalation(
      body.message,
      page1Context,
      optimisticCreditContext,
      effectiveSelectedAsinForEscalation, // Backward compatibility (single ASIN)
      eligibleAsinsForEscalation // Multi-ASIN support (selected OR explicit)
    );
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ENRICHMENT IS INDEPENDENT OF ESCALATION
    // ═══════════════════════════════════════════════════════════════════════════
    // Enrichment (SP-API catalog, Rainforest product/reviews) does NOT require escalation or credits
    // Enrichment runs independently and uses caps + caching only
    // DO NOT modify escalationDecision for enrichment - they are separate flows
    if (requiresEnrichment) {
      console.log("ENRICHMENT_DETECTED", {
        analysisRunId: body.analysisRunId,
        enrichment_types: enrichmentTypes,
        enrichment_asins: enrichmentAsins,
        note: "Enrichment runs independently of escalation - no credits required",
      });
    }

    // Server-side guardrails (single source of truth for creditless analysis-only chat).
    // NOTE: this does NOT change pricing/credit logic; it only clarifies intent classification.
    const hasSnapshot = !!body.analysisRunId; // analysis_run_id anchors an existing snapshot/context
    const guardrails = evaluateChatGuardrails({
      question: body.message,
      selectedAsins,
      hasSnapshot,
      creditsAvailable: optimisticCreditContext.available_credits,
    });
    console.log("CHAT_GUARDRAILS", {
      analysis_run_id: body.analysisRunId,
      intent: guardrails.intent,
      requires_credits: guardrails.requiresCredits,
      credits_required: guardrails.creditsRequired,
      selected_count: selectedAsins.length,
      timestamp: new Date().toISOString(),
    });

    // IMPORTANT: Enrichment intents (variants/attributes or review insights) MUST NOT require escalation/credits.
    // Force escalation off for these intents so ESCALATION_GATE never blocks enrichment flows.
    if (variantsAttributesIntent || reviewInsightsIntent) {
      escalationDecision.requires_escalation = false;
      escalationDecision.required_asins = [];
      escalationDecision.required_credits = 0;
    }

    // Only now (and only if needed) load real credit context and re-run decision.
    const creditContext: CreditContext = escalationDecision.requires_escalation
      ? await checkCreditBalance(user.id, supabase, body.analysisRunId)
      : optimisticCreditContext;

    if (escalationDecision.requires_escalation) {
      escalationDecision = decideEscalation(
        body.message,
        page1Context,
        creditContext,
        effectiveSelectedAsinForEscalation,
        eligibleAsinsForEscalation
      );
    }

    // ────────────────────────────────────────────────────────────────────────
    // ESCALATION GUARDRAILS (STRICT)
    // - Never escalate unless an ASIN is selected OR explicitly referenced
    // - Max 1 ASIN by default, max 2 only for explicit compare
    // - Never consume credits without explicit confirmation (handled below)
    // ────────────────────────────────────────────────────────────────────────
    if (escalationDecision.requires_escalation) {
      if (eligibleAsinsForEscalation.length === 0) {
        // Hard block: no selection and no explicit ASIN in the question
        escalationDecision.requires_escalation = false;
        escalationDecision.required_asins = [];
        escalationDecision.required_credits = 0;
      } else if (eligibleAsinsForEscalation.length > maxEscalationAsins) {
        // Hard block: too many ASINs unless explicit compare (max 2)
        const hint = isExplicitCompare
          ? "To compare, select or paste exactly 2 ASINs."
          : "Select exactly 1 ASIN (or paste an ASIN) to look up live product details.";
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: hint })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      } else {
        // Enforce ASIN cap and intersection with eligible ASINs
        const intersected = intersects(escalationDecision.required_asins, eligibleAsinsForEscalation);
        const requiredAsins = (intersected.length > 0 ? intersected : eligibleAsinsForEscalation).slice(0, maxEscalationAsins);
        escalationDecision.required_asins = requiredAsins;
        escalationDecision.required_credits = requiredAsins.length;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // FIX 1: PER-MESSAGE PRODUCT SELECTION GATING (NON-STICKY)
    // Only require product selection when THIS message requires ASINs (required_asins.length > 0)
    // and cannot be answered from Page-1 data alone.
    // Page-1 questions (can_answer_from_page1 === true) must proceed WITHOUT requiring selected ASINs.
    // ────────────────────────────────────────────────────────────────────────
    
    // CRITICAL FIX: Allow Page-1 questions to proceed without selected ASINs
    // If can_answer_from_page1 === true, the question can be answered using market-level data
    // and should NEVER be blocked for having 0 selected ASINs
    if (escalationDecision.can_answer_from_page1 === true) {
      // Question can be answered from Page-1 data - proceed to AI without requiring ASIN selection
      // Do NOT block or show fallback message
    } else if (
      // Only require ASIN selection if:
      // 1. Question requires specific ASINs (required_asins.length > 0)
      // 2. AND no ASINs are selected (selectedAsins.length === 0)
      // 3. AND no explicit ASINs in message (explicitAsins.length === 0)
      escalationDecision.required_asins.length > 0 &&
      selectedAsins.length === 0 &&
      explicitAsins.length === 0
    ) {
      // Hard-block: Question requires product-specific data but no ASIN is selected
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                content:
                  "Select a product from Page-1 to analyze it.",
              })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...Object.fromEntries(res.headers.entries()),
        },
      });
    }
    
    // STEP 5: GUARANTEED LOGGING - Log escalation decision BEFORE LLM runs
    console.log("[ESCALATION_GATE]", {
      question: body.message,
      selected_asins: selectedAsins,
      requires_escalation: escalationDecision.requires_escalation,
      can_answer_from_page1: escalationDecision.can_answer_from_page1,
      reason: escalationDecision.escalation_reason,
      required_asins: escalationDecision.required_asins,
      required_credits: escalationDecision.required_credits,
      available_credits: creditContext.available_credits,
      timestamp: new Date().toISOString(),
    });
    
    // Log escalation decision (structured logging)
    console.log("ESCALATION_DECISION", {
      user_id: user.id,
      analysis_run_id: body.analysisRunId,
      question: body.message,
      requires_escalation: escalationDecision.requires_escalation,
      can_answer_from_page1: escalationDecision.can_answer_from_page1,
      required_asins: escalationDecision.required_asins,
      required_credits: escalationDecision.required_credits,
      available_credits: creditContext.available_credits,
      session_credits_used: creditContext.session_credits_used,
      daily_credits_used: creditContext.daily_credits_used,
      escalation_reason: escalationDecision.escalation_reason,
      timestamp: new Date().toISOString(),
    });
    
    // Execute escalation if needed and credits available
    let escalationResults: {
      success: boolean;
      productData: Map<string, any>;
      creditsUsed: number;
      cached: boolean[];
    } | null = null;
    
    let escalationMessage = "";
    let shouldShowEscalationMessage = false; // Track if we should show the pre-escalation message
    
    if (escalationDecision.requires_escalation && escalationDecision.required_asins.length > 0) {
      // Check if escalation is blocked (insufficient credits, limits exceeded)
      const hasEnoughCredits = creditContext.available_credits >= escalationDecision.required_credits;
      const sessionLimitOk = (creditContext.session_credits_used + escalationDecision.required_credits) <= (creditContext.max_session_credits ?? 10);
      const dailyLimitOk = (creditContext.daily_credits_used + escalationDecision.required_credits) <= (creditContext.max_daily_credits ?? 50);
      
      if (!hasEnoughCredits || !sessionLimitOk || !dailyLimitOk) {
        // Escalation blocked - log and show message
        console.log("ESCALATION_BLOCKED", {
          user_id: user.id,
          analysis_run_id: body.analysisRunId,
          required_credits: escalationDecision.required_credits,
          available_credits: creditContext.available_credits,
          session_credits_used: creditContext.session_credits_used,
          daily_credits_used: creditContext.daily_credits_used,
          session_limit_ok: sessionLimitOk,
          daily_limit_ok: dailyLimitOk,
          reason: !hasEnoughCredits ? "insufficient_credits" : !sessionLimitOk ? "session_limit_exceeded" : "daily_limit_exceeded",
          timestamp: new Date().toISOString(),
        });
        
        escalationMessage = buildInsufficientCreditsMessage(escalationDecision, creditContext);
      } else {
        // UI must explicitly confirm before any credits are consumed
        if (body.escalationConfirmed !== true) {
          const confirmationMetadata = {
            type: "escalation_confirmation_required",
            message: escalationDecision.required_credits === 1
              ? "This will use 1 credit to fetch live Amazon data. Continue?"
              : `This will use ${escalationDecision.required_credits} credits to fetch live Amazon data. Continue?`,
            asins: escalationDecision.required_asins,
            credits: escalationDecision.required_credits,
          };
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ metadata: confirmationMetadata })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });
          return new NextResponse(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              ...Object.fromEntries(res.headers.entries()),
            },
          });
        }

        // Credits available - BUILD MESSAGE FIRST (before executing escalation)
        // This ensures the message is ready to send immediately
        escalationMessage = buildEscalationMessage(escalationDecision, effectiveSelectedAsinForEscalation, eligibleAsinsForEscalation);
        shouldShowEscalationMessage = true; // Mark that we should show this message
        
        // Now execute escalation
        try {
          const rainforestApiKey = process.env.RAINFOREST_API_KEY;
          escalationResults = await executeEscalation(
            escalationDecision,
            user.id,
            body.analysisRunId,
            supabase,
            rainforestApiKey
          );

          // Guardrail: never spend credits without surfacing usable result.
          // If Rainforest returned an empty payload, we still proceed but force the model to state the failure explicitly.
          // (Credits may already be deducted; do not hide that.)
          try {
            const unusable = escalationDecision.required_asins.filter((asin) => {
              const d = escalationResults?.productData?.get(asin);
              return !d || (typeof d === "object" && d !== null && Object.keys(d).length === 0);
            });
            if (unusable.length === escalationDecision.required_asins.length) {
              escalationMessage = `Live lookup completed, but returned no usable product details for ${unusable.join(", ")}. I’ll answer using what’s available in the analysis, and call out what’s missing.`;
              shouldShowEscalationMessage = true;
            }
          } catch {
            // Non-blocking
          }
          
          // Structured logging for successful escalation
          console.log("ESCALATION_EXECUTED", {
            user_id: user.id,
            analysis_run_id: body.analysisRunId,
            asins: escalationDecision.required_asins,
            credits_used: escalationResults.creditsUsed,
            cached: escalationResults.cached,
            cached_count: escalationResults.cached.filter(c => c).length,
            api_calls: escalationResults.cached.filter(c => !c).length,
            timestamp: new Date().toISOString(),
          });
        } catch (escalationError) {
          // Structured logging for escalation errors
          console.error("ESCALATION_ERROR", {
            user_id: user.id,
            analysis_run_id: body.analysisRunId,
            asins: escalationDecision.required_asins,
            error: escalationError instanceof Error ? escalationError.message : String(escalationError),
            stack: escalationError instanceof Error ? escalationError.stack : undefined,
            timestamp: new Date().toISOString(),
          });
          
          escalationMessage = `Failed to look up product details: ${escalationError instanceof Error ? escalationError.message : String(escalationError)}`;
          shouldShowEscalationMessage = false; // Don't show the pre-escalation message if it failed
        }
      }
    }
    
    // 8a. Convert Analyze response to stable contract format
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: AI Copilot MUST consume ONLY the stable contract format
    // This ensures the AI does not depend on live API calls or raw responses
    const { convertToAnalyzeContract } = await import("@/lib/analyze/contractConverter");
    const analyzeContract = convertToAnalyzeContract(
      analysisResponse,
      analysisResponse.enrichment_status as any
    );
    
    // 8b. Extract ai_context from analyze response (CRITICAL: Must include products, computed_metrics, etc.)
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE B FIX: Ensure ai_context is properly extracted and passed to copilot
    const aiContext = (analysisResponse.ai_context as Record<string, unknown>) || null;
    
    // Validate ai_context structure
    if (aiContext) {
      console.log("🔍 AI_CONTEXT_EXTRACTED", {
        has_products: Array.isArray(aiContext.products),
        products_count: Array.isArray(aiContext.products) ? aiContext.products.length : 0,
        has_computed_metrics: !!aiContext.computed_metrics,
        computed_metrics_keys: aiContext.computed_metrics ? Object.keys(aiContext.computed_metrics) : [],
        has_page_one_listings: Array.isArray(aiContext.page_one_listings),
      });
    } else {
      console.warn("⚠️ AI_CONTEXT_MISSING", {
        analysisRunId: body.analysisRunId,
        has_analysisResponse: !!analysisResponse,
        analysisResponse_keys: analysisResponse ? Object.keys(analysisResponse) : [],
      });
    }
    
    // 8c. Build structured selected_asins array from contract listings
    // ═══════════════════════════════════════════════════════════════════════════
    // This creates a structured array of selected ASIN data that the AI can use
    // for product-specific and comparative reasoning
    // Uses the stable contract format (ListingCard[]) instead of raw response
    const selectedAsinsArray = buildSelectedAsinsArrayFromContract(selectedAsins, analyzeContract);
    
    console.log("📌 SELECTED_ASINS_BUILT", {
      selected_count: selectedAsins.length,
      matched_count: selectedAsinsArray.length,
      asins: selectedAsins,
      matched_asins: selectedAsinsArray.map(p => p.asin),
    });
    
    // GOAL 3: Check enrichment limits (per session/analysis_run_id)
    let enrichmentCallsUsed = 0;
    if (requiresEnrichment && enrichmentAsins.length > 0) {
      // Count existing enrichment calls for this analysis_run_id (check both spapi and rainforest)
      try {
        const { data: existingCalls } = await supabase
          .from('chat_messages')
          .select('id, metadata')
          .eq('analysis_run_id', body.analysisRunId)
          .or('metadata->spapi_enrichment.not.is.null,metadata->rainforest_enrichment.not.is.null')
          .limit(MAX_ENRICHMENT_CALLS_PER_SESSION);
        
        enrichmentCallsUsed = existingCalls?.length || 0;
      } catch (error) {
        console.warn("ENRICHMENT_LIMIT_CHECK_ERROR", {
          analysisRunId: body.analysisRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      
      if (enrichmentCallsUsed >= MAX_ENRICHMENT_CALLS_PER_SESSION) {
        // Limit reached - return early with explanation
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `I've reached the limit for enrichment calls in this analysis (${MAX_ENRICHMENT_CALLS_PER_SESSION} total). Please pick 1-3 ASINs to analyze.` })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      }
    }
    
    // GOAL 3: In-memory cache for enrichment (7 days TTL)
    const ENRICHMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const spapiCache = new Map<string, { expiresAt: number; data: any }>();
    const rainforestCache = new Map<string, { expiresAt: number; data: any }>();
    
    function getCachedSPAPI(asin: string, marketplaceId: string): any | null {
      const cacheKey = `${asin}:${marketplaceId}:spapi`;
      const entry = spapiCache.get(cacheKey);
      if (!entry || Date.now() > entry.expiresAt) {
        return null;
      }
      return entry.data;
    }
    
    function setCachedSPAPI(asin: string, marketplaceId: string, data: any) {
      const cacheKey = `${asin}:${marketplaceId}:spapi`;
      spapiCache.set(cacheKey, { expiresAt: Date.now() + ENRICHMENT_CACHE_TTL_MS, data });
    }
    
    function getCachedRainforest(asin: string, amazonDomain: string): any | null {
      const cacheKey = `${asin}:${amazonDomain}:rainforest`;
      const entry = rainforestCache.get(cacheKey);
      if (!entry || Date.now() > entry.expiresAt) {
        return null;
      }
      return entry.data;
    }
    
    function setCachedRainforest(asin: string, amazonDomain: string, data: any) {
      const cacheKey = `${asin}:${amazonDomain}:rainforest`;
      rainforestCache.set(cacheKey, { expiresAt: Date.now() + ENRICHMENT_CACHE_TTL_MS, data });
    }
    
    // Separate cache for reviews (different endpoint)
    const reviewsCache = new Map<string, { expiresAt: number; data: any }>();
    
    function getCachedReviews(asin: string, amazonDomain: string): any | null {
      const cacheKey = `${asin}:${amazonDomain}:reviews`;
      const entry = reviewsCache.get(cacheKey);
      if (!entry || Date.now() > entry.expiresAt) {
        return null;
      }
      return entry.data;
    }
    
    function setCachedReviews(asin: string, amazonDomain: string, data: any) {
      const cacheKey = `${asin}:${amazonDomain}:reviews`;
      reviewsCache.set(cacheKey, { expiresAt: Date.now() + ENRICHMENT_CACHE_TTL_MS, data });
    }
    
    // GOAL 4A: SP-API Catalog enrichment for variants/attributes/bullets/description
    let spapiEnrichment: {
      executed: boolean;
      asins: string[];
      by_asin: Record<string, {
        title?: string | null;
        bullet_points?: string[] | null;
        description?: string | null;
        attributes?: Record<string, any> | null;
        variation_relationships?: {
          parent_asins?: string[] | null;
          child_asins?: string[] | null;
          variation_theme?: string | null;
        } | null;
        product_type?: string | null;
        errors: string[];
      }>;
    } | null = null;
    
    // GOAL 4B: Rainforest product enrichment for review insights
    let rainforestEnrichment: {
      executed: boolean;
      asins: string[];
      by_asin: Record<string, {
        asin: string;
        title: string | null;
        customers_say: any | null;
        summarization_attributes: any | null;
        extracted: {
          top_complaints: string[];
          top_praise: string[];
          attribute_signals: Array<{ name: string; value: string }>;
          // Catalog fallback fields (for when SP-API is empty or missing fields)
          feature_bullets?: string[] | string | null;
          description?: string | null;
          attributes?: Record<string, any> | null;
        };
        errors: string[];
      }>;
      errors: Array<{ asin: string; error: string }>;
    } | null = null;
    
    // GOAL 4C: Rainforest reviews enrichment (for review snippets when customers_say is missing)
    let rainforestReviewsEnrichment: {
      executed: boolean;
      asins: string[];
      by_asin: Record<string, {
        asin: string;
        title: string | null;
        extracted: {
          top_complaints: Array<{ theme: string; snippet?: string }>;
          top_praise: Array<{ theme: string; snippet?: string }>;
        };
        errors: string[];
      }>;
      errors: Array<{ asin: string; error: string }>;
    } | null = null;
    
    if (requiresEnrichment && enrichmentAsins.length > 0) {
      const marketplaceId = "ATVPDKIKX0DER"; // US marketplace
      const amazonDomain = "amazon.com";
      
      // GOAL 4A: SP-API Catalog enrichment
      if (enrichmentTypes.includes('spapi_catalog')) {
        const { getCatalogItemEnrichment } = await import("@/lib/spapi/enrichment");
        
        spapiEnrichment = {
          executed: true,
          asins: enrichmentAsins,
          by_asin: {},
        };
        
        for (const asin of enrichmentAsins) {
          const errors: string[] = [];
          let catalogData: any | null = null;
          let needsRainforestFallback = false;
          let fallbackReason: "spapi_empty" | "missing_fields" | null = null;
          
          // Check cache first
          const cached = getCachedSPAPI(asin, marketplaceId);
          if (cached) {
            catalogData = cached;
            console.log("SP_API_ENRICHMENT_CACHE_HIT", { asin, endpoint: "catalog" });
          } else {
            try {
              catalogData = await getCatalogItemEnrichment(asin, marketplaceId, user.id);
              if (catalogData) {
                setCachedSPAPI(asin, marketplaceId, catalogData);
              } else {
                errors.push("Catalog enrichment failed");
                needsRainforestFallback = true;
                fallbackReason = "spapi_empty";
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              if (errorMessage.includes('403') || errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
                errors.push("Permission denied: Catalog API access not authorized");
                // Still try fallback for 403 errors
                needsRainforestFallback = true;
                fallbackReason = "spapi_empty";
              } else {
                errors.push(`Catalog enrichment error: ${errorMessage}`);
                needsRainforestFallback = true;
                fallbackReason = "spapi_empty";
              }
            }
          }
          
          // Check if SP-API data is missing bullets or description (even if catalogData exists)
          const hasBullets = catalogData?.bullet_points && 
            (Array.isArray(catalogData.bullet_points) ? catalogData.bullet_points.length > 0 : true);
          const hasDescription = catalogData?.description && 
            (typeof catalogData.description === 'string' && catalogData.description.trim().length > 0);
          
          if (catalogData && (!hasBullets || !hasDescription)) {
            needsRainforestFallback = true;
            fallbackReason = "missing_fields";
          }
          
          // Parse catalog data into compact format
          spapiEnrichment.by_asin[asin] = {
            title: catalogData?.item_name || null,
            bullet_points: catalogData?.bullet_points || null,
            description: catalogData?.description || null,
            attributes: catalogData?.attributes || null,
            variation_relationships: catalogData ? {
              parent_asins: catalogData.parent_asins || null,
              child_asins: catalogData.child_asins || null,
              variation_theme: catalogData.variation_theme || null,
            } : null,
            product_type: catalogData?.product_type || null,
            errors,
          };
          
          // FALLBACK: If SP-API returned empty or missing bullets/description, fetch from Rainforest
          if (needsRainforestFallback) {
            const { getRainforestProductEnrichment } = await import("@/lib/rainforest/productEnrichment");
            
            // Ensure rainforestEnrichment exists
            if (!rainforestEnrichment) {
              rainforestEnrichment = {
                executed: true,
                asins: [],
                by_asin: {},
                errors: [],
              };
            }
            
            if (!rainforestEnrichment.asins.includes(asin)) {
              rainforestEnrichment.asins.push(asin);
            }
            
            let rainforestData: any | null = null;
            const rainforestErrors: string[] = [];
            
            // Check Rainforest cache first
            const cachedRainforest = getCachedRainforest(asin, amazonDomain);
            if (cachedRainforest) {
              rainforestData = cachedRainforest;
              console.log("RAINFOREST_ENRICHMENT_CACHE_HIT", { 
                asin, 
                endpoint: "product", 
                cache_hit: true,
                reason: "catalog_fallback"
              });
            } else {
              try {
                rainforestData = await getRainforestProductEnrichment(asin, amazonDomain, user.id);
                if (rainforestData) {
                  setCachedRainforest(asin, amazonDomain, rainforestData);
                  console.log("RAINFOREST_ENRICHMENT_CACHE_MISS", { 
                    asin, 
                    endpoint: "product", 
                    cache_hit: false,
                    reason: "catalog_fallback"
                  });
                } else {
                  rainforestErrors.push("Rainforest product enrichment failed");
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                rainforestErrors.push(`Rainforest product enrichment error: ${errorMessage}`);
                rainforestEnrichment.errors.push({ asin, error: errorMessage });
              }
            }
            
            // Extract bullets and description from Rainforest
            if (rainforestData) {
              // Get feature_bullets and description from extracted object (stored by getRainforestProductEnrichment)
              const extracted = (rainforestData as any).extracted || {};
              const featureBullets = extracted.feature_bullets || null;
              const description = extracted.description || null;
              const attributes = extracted.attributes || null;
              
              // Merge into existing rainforest_enrichment entry or create new one
              if (rainforestEnrichment.by_asin[asin]) {
                // Merge with existing entry (from review insights)
                const existing = rainforestEnrichment.by_asin[asin];
                rainforestEnrichment.by_asin[asin] = {
                  ...existing,
                  title: existing.title || rainforestData.title || null,
                  // Merge extracted fields (preserve existing, add catalog fields)
                  extracted: {
                    ...existing.extracted,
                    feature_bullets: featureBullets || existing.extracted.feature_bullets,
                    description: description || existing.extracted.description,
                    attributes: attributes || existing.extracted.attributes,
                  },
                };
              } else {
                // Create new entry for catalog fallback
                rainforestEnrichment.by_asin[asin] = {
                  asin: rainforestData.asin || asin,
                  title: rainforestData.title || null,
                  customers_say: null, // Not needed for catalog fallback
                  summarization_attributes: null, // Not needed for catalog fallback
                  extracted: {
                    top_complaints: [],
                    top_praise: [],
                    attribute_signals: [],
                    // Store catalog fields in extracted for copilot access
                    feature_bullets: featureBullets,
                    description: description,
                    attributes: attributes,
                  },
                  errors: rainforestErrors,
                };
              }
              
              // Also update spapiEnrichment with Rainforest data if SP-API was empty or missing fields
              if (!catalogData || !hasBullets || !hasDescription) {
                if (featureBullets && !spapiEnrichment.by_asin[asin].bullet_points) {
                  spapiEnrichment.by_asin[asin].bullet_points = Array.isArray(featureBullets) 
                    ? featureBullets 
                    : (typeof featureBullets === 'string' ? [featureBullets] : null);
                }
                if (description && !spapiEnrichment.by_asin[asin].description) {
                  spapiEnrichment.by_asin[asin].description = description;
                }
                if (attributes && !spapiEnrichment.by_asin[asin].attributes) {
                  spapiEnrichment.by_asin[asin].attributes = attributes;
                }
                if (rainforestData.title && !spapiEnrichment.by_asin[asin].title) {
                  spapiEnrichment.by_asin[asin].title = rainforestData.title;
                }
              }
              
              console.log("CATALOG_FALLBACK_TO_RAINFOREST_PRODUCT", {
                asin,
                reason: fallbackReason,
                spapi_has_bullets: hasBullets,
                spapi_has_description: hasDescription,
                rainforest_has_bullets: !!featureBullets,
                rainforest_has_description: !!description,
              });
            } else {
              // Rainforest fallback also failed
              console.log("CATALOG_FALLBACK_TO_RAINFOREST_PRODUCT", {
                asin,
                reason: fallbackReason,
                fallback_failed: true,
                errors: rainforestErrors,
              });
            }
          }
        }
      }
      
      // GOAL 4B: Rainforest product enrichment for review insights
      if (enrichmentTypes.includes('rainforest_product')) {
        const { getRainforestProductEnrichment } = await import("@/lib/rainforest/productEnrichment");
        
        rainforestEnrichment = {
          executed: true,
          asins: enrichmentAsins,
          by_asin: {},
          errors: [],
        };
        
        const cacheHits: Record<string, boolean> = {};
        
        for (const asin of enrichmentAsins) {
          const errors: string[] = [];
          let productData: any | null = null;
          let cacheHit = false;
          
          // Check cache first
          const cached = getCachedRainforest(asin, amazonDomain);
          if (cached) {
            productData = cached;
            cacheHit = true;
            cacheHits[asin] = true;
            console.log("RAINFOREST_ENRICHMENT_CACHE_HIT", { asin, endpoint: "product", cache_hit: true });
          } else {
            cacheHits[asin] = false;
            try {
              productData = await getRainforestProductEnrichment(asin, amazonDomain, user.id);
              if (productData) {
                setCachedRainforest(asin, amazonDomain, productData);
                console.log("RAINFOREST_ENRICHMENT_CACHE_MISS", { asin, endpoint: "product", cache_hit: false });
              } else {
                errors.push("Rainforest product enrichment failed");
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              errors.push(`Rainforest product enrichment error: ${errorMessage}`);
              rainforestEnrichment.errors.push({ asin, error: errorMessage });
            }
          }
          
          // Parse product data into required structure
          if (productData) {
            rainforestEnrichment.by_asin[asin] = {
              asin: productData.asin || asin,
              title: productData.title || null,
              customers_say: productData.customers_say || null,
              summarization_attributes: productData.summarization_attributes || null,
              extracted: productData.extracted || {
                top_complaints: [],
                top_praise: [],
                attribute_signals: [],
              },
              errors: productData.errors || [],
            };
          } else {
            rainforestEnrichment.by_asin[asin] = {
              asin,
              title: null,
              customers_say: null,
              summarization_attributes: null,
              extracted: {
                top_complaints: [],
                top_praise: [],
                attribute_signals: [],
              },
              errors,
            };
          }
        }
        
        // Log enrichment completion with cache hit info
        console.log("RAINFOREST_ENRICHMENT_COMPLETE", {
          analysisRunId: body.analysisRunId,
          asins: enrichmentAsins,
          cache_hits: cacheHits,
          cache_hit_count: Object.values(cacheHits).filter(h => h).length,
          cache_miss_count: Object.values(cacheHits).filter(h => !h).length,
        });
      }
      
      // GOAL 4C: Auto-fallback to Rainforest reviews if customers_say is missing
      // After product enrichment, check if customers_say is missing/empty and auto-fetch reviews
      if (enrichmentTypes.includes('rainforest_product') && reviewInsightsIntent) {
        const { getRainforestReviewsEnrichment } = await import("@/lib/rainforest/reviewsEnrichment");
        const MAX_REVIEWS_PER_ASIN = 20;
        
        for (const asin of enrichmentAsins) {
          const productData = rainforestEnrichment?.by_asin[asin];
          const hasCustomersSay = productData?.customers_say && 
            (typeof productData.customers_say === 'object' && Object.keys(productData.customers_say).length > 0);
          
          // If customers_say is missing or empty, automatically fetch reviews
          if (!hasCustomersSay && !productData?.errors?.length) {
            if (!rainforestReviewsEnrichment) {
              rainforestReviewsEnrichment = {
                executed: true,
                asins: [],
                by_asin: {},
                errors: [],
              };
            }
            
            if (!rainforestReviewsEnrichment.asins.includes(asin)) {
              rainforestReviewsEnrichment.asins.push(asin);
            }
            
            const errors: string[] = [];
            let reviewsData: any | null = null;
            
            // Check cache first
            const cached = getCachedReviews(asin, amazonDomain);
            if (cached) {
              reviewsData = cached;
              console.log("RAINFOREST_REVIEWS_ENRICHMENT_CACHE_HIT", { 
                asin, 
                endpoint: "reviews", 
                cache_hit: true,
                reason: "customers_say_missing"
              });
            } else {
              try {
                reviewsData = await getRainforestReviewsEnrichment(asin, amazonDomain, MAX_REVIEWS_PER_ASIN);
                if (reviewsData) {
                  setCachedReviews(asin, amazonDomain, reviewsData);
                  console.log("RAINFOREST_REVIEWS_ENRICHMENT_CACHE_MISS", { 
                    asin, 
                    endpoint: "reviews", 
                    cache_hit: false,
                    reason: "customers_say_missing"
                  });
                } else {
                  errors.push("Rainforest reviews enrichment failed");
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                // Handle 503 errors gracefully
                if (errorMessage.includes('503') || errorMessage.includes('temporarily unavailable')) {
                  errors.push("TEMPORARILY_UNAVAILABLE");
                  console.log("RAINFOREST_REVIEWS_503_ERROR", { asin, error: errorMessage });
                } else {
                  errors.push(`Rainforest reviews enrichment error: ${errorMessage}`);
                }
                rainforestReviewsEnrichment.errors.push({ asin, error: errorMessage });
              }
            }
            
            // Parse reviews data
            if (reviewsData) {
              rainforestReviewsEnrichment.by_asin[asin] = {
                asin: reviewsData.asin || asin,
                title: reviewsData.title || null,
                extracted: reviewsData.extracted || {
                  top_complaints: [],
                  top_praise: [],
                },
                errors: reviewsData.errors || [],
              };
            } else {
              rainforestReviewsEnrichment.by_asin[asin] = {
                asin,
                title: null,
                extracted: {
                  top_complaints: [],
                  top_praise: [],
                },
                errors,
              };
            }
          }
        }
        
        if (rainforestReviewsEnrichment && rainforestReviewsEnrichment.asins.length > 0) {
          console.log("RAINFOREST_REVIEWS_ENRICHMENT_COMPLETE", {
            analysisRunId: body.analysisRunId,
            asins: rainforestReviewsEnrichment.asins,
            success_count: Object.values(rainforestReviewsEnrichment.by_asin).filter(v => v.errors.length === 0).length,
            reason: "auto_fallback_customers_say_missing"
          });
        }
      }
      
      console.log("ENRICHMENT_COMPLETE", {
        analysisRunId: body.analysisRunId,
        asins: enrichmentAsins,
        total_selected: selectedAsins.length,
        enrichment_types: enrichmentTypes,
        spapi_success: spapiEnrichment ? Object.values(spapiEnrichment.by_asin).filter(v => !v.errors.length).length : 0,
        rainforest_success: rainforestEnrichment ? Object.values(rainforestEnrichment.by_asin).filter(v => !v.errors.length).length : 0,
        reviews_success: rainforestReviewsEnrichment ? Object.values(rainforestReviewsEnrichment.by_asin).filter(v => !v.errors.length).length : 0,
        calls_used: enrichmentCallsUsed + 1,
        calls_remaining: MAX_ENRICHMENT_CALLS_PER_SESSION - (enrichmentCallsUsed + 1),
      });
    }
    
    // PRIORITY D.11: Log what ai_context.spapi_enrichment contains before OpenAI call
    if (spapiEnrichment) {
      console.log("SPAPI_ENRICHMENT_INJECTED", {
        analysisRunId: body.analysisRunId,
        executed: spapiEnrichment.executed,
        asins: spapiEnrichment.asins,
        by_asin_keys: Object.keys(spapiEnrichment.by_asin),
        success_count: Object.values(spapiEnrichment.by_asin).filter(v => v.errors.length === 0).length,
        error_count: Object.values(spapiEnrichment.by_asin).reduce((sum, v) => sum + v.errors.length, 0),
        has_403_errors: Object.values(spapiEnrichment.by_asin).some(v => v.errors.some(e => e.includes('Permission denied'))),
        has_title: Object.values(spapiEnrichment.by_asin).filter(v => v.title).length,
        has_bullet_points: Object.values(spapiEnrichment.by_asin).filter(v => v.bullet_points?.length).length,
        has_description: Object.values(spapiEnrichment.by_asin).filter(v => v.description).length,
        has_variation_relationships: Object.values(spapiEnrichment.by_asin).filter(v => v.variation_relationships).length,
      });
    }
    
    // 8c. Inject selected_asins and enrichment into ai_context
    // ═══════════════════════════════════════════════════════════════════════════
    // Add selected_asins and enrichment objects to ai_context so the AI can reference them in answers
    // CRITICAL: This must be done BEFORE building contextToUse so enrichment is included
    const aiContextWithEnrichment = aiContext 
      ? {
          ...aiContext,
          selected_asins: selectedAsinsArray,
          ...(spapiEnrichment ? { spapi_enrichment: spapiEnrichment } : {}),
          ...(rainforestEnrichment ? { rainforest_enrichment: rainforestEnrichment } : {}),
          ...(rainforestReviewsEnrichment ? { rainforest_reviews_enrichment: rainforestReviewsEnrichment } : {}),
        }
      : {
          selected_asins: selectedAsinsArray,
          ...(spapiEnrichment ? { spapi_enrichment: spapiEnrichment } : {}),
          ...(rainforestEnrichment ? { rainforest_enrichment: rainforestEnrichment } : {}),
          ...(rainforestReviewsEnrichment ? { rainforest_reviews_enrichment: rainforestReviewsEnrichment } : {}),
        };
    
    // 8d. Determine response mode (concise by default, expanded if user requests)
    const responseMode = body.responseMode || (
      /\b(explain more|expand|more details|tell me more|elaborate|detailed|comprehensive)\b/i.test(body.message)
        ? "expanded"
        : "concise"
    );
    
    // 8e. Build compact or full context based on mode
    // CRITICAL: Use stable contract format for AI Copilot consumption
    const useCompactContext = responseMode === "concise";
    
    // Remove selected_asins from aiContextWithEnrichment to avoid duplicate (selected_asins is added separately)
    const { selected_asins: _, ...aiContextWithoutSelectedAsins } = aiContextWithEnrichment || {};
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE B FIX: Ensure ai_context is ALWAYS included with products and computed_metrics
    // ═══════════════════════════════════════════════════════════════════════════
    const contextToUse = useCompactContext
      ? {
          // Compact mode: Use contract format with essential fields only
          analyze_contract: analyzeContract, // Stable contract format
          selected_asins: selectedAsinsArray, // Always include selected_asins even in compact mode
          // CRITICAL: Include ai_context even in compact mode (required for copilot)
          // This ensures has_ai_context=true, has_ai_context_products=true, has_computed_metrics=true
          // Include enrichment in ai_context
          ...(aiContextWithEnrichment ? { ai_context: aiContextWithEnrichment } : {}),
          // Legacy fields for backward compatibility (deprecated)
          ...buildCompactContext(
            analysisResponse, 
            marketSnapshot, 
            body.selectedListing || null,
            analysisRun.rainforest_data as Record<string, unknown> | null
          ),
        }
      : {
          // Expanded mode: Use full contract format
          analyze_contract: analyzeContract, // Stable contract format (primary)
          selected_asins: selectedAsinsArray,
          // CRITICAL: Include full ai_context in expanded mode
          // This ensures has_ai_context=true, has_ai_context_products=true, has_computed_metrics=true
          // Include enrichment in ai_context
          ...(aiContextWithEnrichment ? { ai_context: aiContextWithEnrichment } : {}),
          // Legacy ai_context fields for backward compatibility (deprecated, without selected_asins to avoid duplicate)
          ...aiContextWithoutSelectedAsins,
        };
    
    // If ai_context is not available, fall back to legacy context building
    // But prefer the locked contract structure
    // Extract decision from analysis response for co-pilot context
    const decision = analysisResponse.decision ? {
      verdict: (analysisResponse.decision as { verdict: string }).verdict as "GO" | "CAUTION" | "NO_GO",
      confidence: (analysisResponse.decision as { confidence: number }).confidence,
      executive_summary: analysisResponse.executive_summary as string | undefined,
    } : undefined;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE B FIX: Normalize ai_context to ensure it's the actual ai_context object
    // ═══════════════════════════════════════════════════════════════════════════
    // The copilot expects copilotContext.ai_context to be the actual ai_context object
    // with keys: mode, keyword, products, computed_metrics, authoritative_facts, etc.
    // NOT the wrapper object (contextToUse) which contains analyze_contract, selected_asins, etc.
    let aiContextToUse: Record<string, unknown> | null = null;
    
    // Safe "mode exists" check to find the actual ai_context object
    if ((contextToUse as any).ai_context?.mode) {
      // ai_context is nested inside contextToUse
      aiContextToUse = (contextToUse as any).ai_context as Record<string, unknown>;
    } else if ((contextToUse as any).mode) {
      // contextToUse IS the ai_context object (legacy path)
      aiContextToUse = contextToUse as Record<string, unknown>;
    } else {
      // Try to extract from aiContext variable (from analysisResponse)
      if (aiContext && typeof aiContext === 'object' && (aiContext as any).mode) {
        aiContextToUse = aiContext as Record<string, unknown>;
      } else {
        // Hard error - log and throw
        console.error("❌ AI_CONTEXT_NORMALIZATION_FAILED", {
          analysisRunId: body.analysisRunId,
          contextToUse_keys: Object.keys(contextToUse),
          has_ai_context_nested: !!(contextToUse as any).ai_context,
          has_mode_in_contextToUse: !!(contextToUse as any).mode,
          has_aiContext: !!aiContext,
          aiContext_keys: aiContext ? Object.keys(aiContext) : [],
        });
        // Don't throw - allow it to continue but log the error
        // The copilot will work with whatever data is available
        aiContextToUse = (contextToUse as any).ai_context || contextToUse || {};
      }
    }
    
    // Ensure enrichment is included in ai_context if it exists
    if (spapiEnrichment && aiContextToUse) {
      aiContextToUse.spapi_enrichment = spapiEnrichment;
    } else if (spapiEnrichment && !aiContextToUse) {
      aiContextToUse = { spapi_enrichment: spapiEnrichment };
    }
    
    if (rainforestEnrichment && aiContextToUse) {
      aiContextToUse.rainforest_enrichment = rainforestEnrichment;
    } else if (rainforestEnrichment && !aiContextToUse) {
      aiContextToUse = { ...(aiContextToUse || {}), rainforest_enrichment: rainforestEnrichment };
    }
    
    if (rainforestReviewsEnrichment && aiContextToUse) {
      aiContextToUse.rainforest_reviews_enrichment = rainforestReviewsEnrichment;
    } else if (rainforestReviewsEnrichment && !aiContextToUse) {
      aiContextToUse = { ...(aiContextToUse || {}), rainforest_reviews_enrichment: rainforestReviewsEnrichment };
    }
    
    // GOAL 7: Log enrichment objects in ai_context before OpenAI call
    const spapiEnrichmentInContext = (aiContextToUse as any)?.spapi_enrichment;
    const rainforestEnrichmentInContext = (aiContextToUse as any)?.rainforest_enrichment;
    const rainforestReviewsEnrichmentInContext = (aiContextToUse as any)?.rainforest_reviews_enrichment;
    
    // Log enrichment details for each selected ASIN
    console.log("ENRICHMENT_BEFORE_OPENAI_CALL", {
      analysisRunId: body.analysisRunId,
      has_spapi_enrichment: !!spapiEnrichmentInContext,
      has_rainforest_reviews_enrichment: !!rainforestReviewsEnrichmentInContext,
      selected_asins: selectedAsins,
      enrichment_by_asin: selectedAsins.map((asin: string) => {
        const spapi = spapiEnrichmentInContext?.by_asin?.[asin];
        return {
          asin,
          has_description: !!spapi?.description,
          bullets_count: spapi?.bullet_points?.length || 0,
          has_title: !!spapi?.title,
          has_attributes: !!spapi?.attributes,
          has_variations: !!(spapi?.variation_relationships?.child_asins?.length || spapi?.variation_relationships?.parent_asins?.length),
          errors: spapi?.errors || [],
        };
      }),
    });
    
    if (spapiEnrichmentInContext) {
      console.log("SPAPI_ENRICHMENT_IN_CONTEXT", {
        analysisRunId: body.analysisRunId,
        executed: spapiEnrichmentInContext.executed,
        asins: spapiEnrichmentInContext.asins || [],
        by_asin_keys: Object.keys(spapiEnrichmentInContext.by_asin || {}),
        success_count: Object.values(spapiEnrichmentInContext.by_asin || {}).filter((v: any) => v.errors?.length === 0).length,
        error_count: Object.values(spapiEnrichmentInContext.by_asin || {}).reduce((sum: number, v: any) => sum + (v.errors?.length || 0), 0),
        has_403_errors: Object.values(spapiEnrichmentInContext.by_asin || {}).some((v: any) => v.errors?.some((e: string) => e.includes('Permission denied'))),
      });
    }
    
    if (rainforestEnrichmentInContext) {
      console.log("RAINFOREST_ENRICHMENT_IN_CONTEXT", {
        analysisRunId: body.analysisRunId,
        executed: rainforestEnrichmentInContext.executed,
        asins: rainforestEnrichmentInContext.asins || [],
        by_asin_keys: Object.keys(rainforestEnrichmentInContext.by_asin || {}),
        success_count: Object.values(rainforestEnrichmentInContext.by_asin || {}).filter((v: any) => v.errors?.length === 0).length,
        error_count: Object.values(rainforestEnrichmentInContext.by_asin || {}).reduce((sum: number, v: any) => sum + (v.errors?.length || 0), 0),
      });
    }
    
    console.log("🔍 AI_CONTEXT_NORMALIZED", {
      analysisRunId: body.analysisRunId,
      has_aiContextToUse: !!aiContextToUse,
      aiContextToUse_keys: aiContextToUse ? Object.keys(aiContextToUse) : [],
      has_mode: !!(aiContextToUse as any)?.mode,
      has_products: Array.isArray((aiContextToUse as any)?.products),
      products_count: Array.isArray((aiContextToUse as any)?.products) ? (aiContextToUse as any).products.length : 0,
      has_computed_metrics: !!(aiContextToUse as any)?.computed_metrics,
      has_spapi_enrichment: !!spapiEnrichmentInContext,
      has_rainforest_enrichment: !!rainforestEnrichmentInContext,
      spapi_enrichment_asins: spapiEnrichmentInContext?.asins || [],
      rainforest_enrichment_asins: rainforestEnrichmentInContext?.asins || [],
    });

    // ────────────────────────────────────────────────────────────────────────
    // DIRECT RESPONSES FOR ENRICHMENT INTENTS (NO OPENAI CALL)
    // ────────────────────────────────────────────────────────────────────────
    // A) VARIANTS / ATTRIBUTES / BULLETS / DESCRIPTION (single ASIN)
    if (variantsAttributesIntent && selectedAsins.length === 1 && spapiEnrichmentInContext) {
      const asin = selectedAsins[0];
      const spapi = spapiEnrichmentInContext.by_asin?.[asin];
      
      if (spapi && ((spapi.bullet_points && spapi.bullet_points.length > 0) || spapi.description)) {
        const title = spapi.title || "(title unavailable)";
        const bullets = spapi.bullet_points || [];
        const description = spapi.description || "No description text was provided for this ASIN via Catalog.";
        
        console.log("DIRECT_RESPONSE_USED", {
          type: "spapi_catalog_fields",
          asins: [asin],
          bullet_count: bullets.length,
          has_description: !!spapi.description,
        });
        
        const bulletLines = bullets.length
          ? bullets.map((b: string) => `- ${b}`).join("\n")
          : "No bullet points were provided for this ASIN via Catalog.";
        
        const directResponse = `ASIN ${asin} (${title})

Bullet points:
${bulletLines}

Description:
${description}`;
        
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: directResponse })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      }
    }

    // B) REVIEW INSIGHTS (complaints/praise) – 1–2 selected ASINs
    if (reviewInsightsIntent && selectedAsins.length > 0 && selectedAsins.length <= 2) {
      const MAX_THEMES = 3;
      
      const summaries: Array<{
        asin: string;
        title: string | null;
        top_complaints: string[];
        top_praise: string[];
        provider_unavailable: boolean;
      }> = [];
      
      for (const asin of selectedAsins) {
        const productEntry = rainforestEnrichmentInContext?.by_asin?.[asin];
        const reviewsEntry = rainforestReviewsEnrichmentInContext?.by_asin?.[asin];
        
        const title =
          productEntry?.title ??
          reviewsEntry?.title ??
          null;
        
        // Prefer customers_say-derived themes from product enrichment
        let topComplaints: string[] = [];
        let topPraise: string[] = [];
        
        if (productEntry?.extracted) {
          if (Array.isArray(productEntry.extracted.top_complaints)) {
            topComplaints = productEntry.extracted.top_complaints.slice(0, MAX_THEMES);
          }
          if (Array.isArray(productEntry.extracted.top_praise)) {
            topPraise = productEntry.extracted.top_praise.slice(0, MAX_THEMES);
          }
        }
        
        // If product themes missing, fall back to reviews enrichment
        if ((!topComplaints.length && !topPraise.length) && reviewsEntry?.extracted) {
          if (Array.isArray(reviewsEntry.extracted.top_complaints)) {
            topComplaints = reviewsEntry.extracted.top_complaints
              .map((t: any) => (typeof t === "string" ? t : t.theme))
              .filter(Boolean)
              .slice(0, MAX_THEMES);
          }
          if (Array.isArray(reviewsEntry.extracted.top_praise)) {
            topPraise = reviewsEntry.extracted.top_praise
              .map((t: any) => (typeof t === "string" ? t : t.theme))
              .filter(Boolean)
              .slice(0, MAX_THEMES);
          }
        }
        
        // Detect 503 / TEMPORARILY_UNAVAILABLE from reviews enrichment
        const hasTempUnavailable =
          (reviewsEntry?.errors || []).some((e: string) =>
            typeof e === "string" && e.includes("TEMPORARILY_UNAVAILABLE")
          ) ||
          (Array.isArray(rainforestReviewsEnrichmentInContext?.errors)
            ? rainforestReviewsEnrichmentInContext.errors.some(
                (e: any) =>
                  e?.asin === asin &&
                  typeof e.error === "string" &&
                  e.error.includes("TEMPORARILY_UNAVAILABLE")
              )
            : false);
        
        summaries.push({
          asin,
          title,
          top_complaints: topComplaints,
          top_praise: topPraise,
          provider_unavailable: hasTempUnavailable,
        });
      }
      
      // If any selected ASIN has provider unavailable and no themes, short-circuit with clear message
      const anyProviderUnavailableWithoutThemes = summaries.some(
        (s) => s.provider_unavailable && !s.top_complaints.length && !s.top_praise.length
      );
      
      if (anyProviderUnavailableWithoutThemes) {
        console.log("DIRECT_RESPONSE_USED", {
          type: "review_insights",
          asins: summaries.map((s) => s.asin),
          reason: "provider_temporarily_unavailable",
        });
        
        const content =
          summaries.length === 1
            ? "Our review provider is temporarily unavailable right now — try again in a few minutes."
            : "Our review provider is temporarily unavailable for at least one of the selected products — try again in a few minutes.";
        
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      }
      
      // If we have any themes, build a direct comparison/summary response
      const anyThemes = summaries.some(
        (s) => s.top_complaints.length || s.top_praise.length
      );
      
      if (anyThemes) {
        console.log("DIRECT_RESPONSE_USED", {
          type: "review_insights",
          asins: summaries.map((s) => s.asin),
          reason: "themes_available",
        });
        
        let content = "";
        
        if (summaries.length === 1) {
          const s = summaries[0];
          const headerTitle = s.title ? `${s.asin} (${s.title})` : s.asin;
          
          content += `Review insights for ${headerTitle}\n\n`;
          
          content += "Top complaints:\n";
          if (s.top_complaints.length) {
            for (const t of s.top_complaints) {
              content += `- ${t}\n`;
            }
          } else {
            content += "- No clear complaint themes available from the current review data.\n";
          }
          
          content += "\nTop praise:\n";
          if (s.top_praise.length) {
            for (const t of s.top_praise) {
              content += `- ${t}\n`;
            }
          } else {
            content += "- No clear praise themes available from the current review data.\n";
          }
        } else {
          // Two-ASIN side-by-side compare
          content += "Review insights comparison (2 selected products):\n\n";
          
          for (const s of summaries) {
            const headerTitle = s.title ? `${s.asin} (${s.title})` : s.asin;
            content += `${headerTitle}\n`;
            
            content += "  Top complaints:\n";
            if (s.top_complaints.length) {
              for (const t of s.top_complaints) {
                content += `  - ${t}\n`;
              }
            } else {
              content += "  - No clear complaint themes available.\n";
            }
            
            content += "  Top praise:\n";
            if (s.top_praise.length) {
              for (const t of s.top_praise) {
                content += `  - ${t}\n`;
              }
            } else {
              content += "  - No clear praise themes available.\n";
            }
            
            content += "\n";
          }
        }
        
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      }
    
    const copilotContext = {
      ai_context: aiContextToUse || {}, // Use normalized ai_context, not the wrapper
      seller_memory: sellerMemory,
      structured_memories: structuredMemories, // New structured memory system
      seller_profile_version: sellerProfile.updated_at || null, // Include profile version for context
      decision: decision, // Pass decision to co-pilot for reasoning forward
      session_context: {
        current_feature: "analyze" as const,
        user_question: body.message,
        response_mode: responseMode, // Pass response mode to system prompt
      },
    };
    
    // Build AI Copilot system prompt (locked behavior contract)
    let systemPrompt: string;
    try {
      systemPrompt = buildCopilotSystemPrompt(
        copilotContext,
        'keyword' // All analyses are keyword-only
      );
    } catch (promptError) {
      console.error("Failed to build copilot system prompt:", promptError);
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to build system prompt",
          details: promptError instanceof Error ? promptError.message : String(promptError),
        },
        { status: 500, headers: res.headers }
      );
    }
    
    // STEP 2: BLOCK LLM ANSWERS WHEN ESCALATION IS REQUIRED (NOT ENRICHMENT)
    // IMPORTANT: Enrichment (SP-API catalog, Rainforest product/reviews) does NOT require escalation
    // Only block if escalation is required AND it's NOT just enrichment
    if (escalationDecision.requires_escalation && escalationDecision.required_asins.length > 0 && !requiresEnrichment) {
      // Check if escalation was blocked (insufficient credits, limits)
      const hasEnoughCredits = creditContext.available_credits >= escalationDecision.required_credits;
      const sessionLimitOk = (creditContext.session_credits_used + escalationDecision.required_credits) <= (creditContext.max_session_credits ?? 10);
      const dailyLimitOk = (creditContext.daily_credits_used + escalationDecision.required_credits) <= (creditContext.max_daily_credits ?? 50);
      
      if (!hasEnoughCredits || !sessionLimitOk || !dailyLimitOk) {
        // Escalation blocked - inject rule to use insufficient credit message only
        systemPrompt += `\n\n=== ESCALATION REQUIRED BUT BLOCKED ===
This question requires product specifications that can only be answered via escalation.
However, escalation is blocked due to insufficient credits or limits.

CRITICAL RULES:
- DO NOT attempt to answer this question from Page-1 data
- DO NOT say "Amazon does not expose..." or "I cannot provide..."
- DO NOT suggest external tools
- The escalation message will be shown to the user explaining the credit situation
- Wait for escalated data before answering product specification questions`;
      } else {
        // Escalation will proceed - inject rule to wait for escalated data
        systemPrompt += `\n\n=== ESCALATION REQUIRED (IN PROGRESS) ===
This question requires product specifications that can only be answered via escalation.
Escalation is in progress and product data will be provided shortly.

CRITICAL RULES:
- DO NOT attempt to answer this question from Page-1 data
- DO NOT say "Amazon does not expose..." or "I cannot provide..."
- DO NOT suggest external tools
- Wait for escalated product data to be injected before answering
- Once escalated data is provided, answer using ONLY that data`;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE B FIX: Ensure messages[0].content is updated if systemPrompt was mutated
    // ═══════════════════════════════════════════════════════════════════════════
    // Note: messages array is created later, but we need to ensure systemPrompt
    // is the final version when messages[0] is created
    
    // Log AI reasoning inputs for audit/debugging
    // FIX (History context): ai_context may be missing on older analysis runs, but the analysis_run_id
    // still represents valid grounded context (Page-1 snapshot + response JSON).
    const hasAiContextForThisRequest =
      !!body.analysisRunId &&
      !!analysisResponse &&
      (!!aiContext ||
        !!analysisResponse.market_snapshot ||
        Array.isArray((analysisResponse as any).page_one_listings) ||
        Array.isArray((analysisResponse as any).products));
    console.log("AI_COPILOT_INPUT", {
      analysisRunId: body.analysisRunId,
      userId: user.id,
      analysisMode,
      hasAiContext: hasAiContextForThisRequest,
      memoryVersion: sellerMemory.version,
      sellerProfileVersion: sellerProfile.updated_at || "unknown",
      sellerProfileUpdatedAt: sellerProfile.updated_at || null,
      timestamp: new Date().toISOString(),
    });

    // 10. Build message array for OpenAI
    // If refinement validation failed, inject error message for AI to explain
    const validationContext = refinementError 
      ? `\n\nIMPORTANT: The user attempted to refine costs, but validation failed:\n${refinementError}\n\nYou must explain why the input is invalid and do NOT save or process the refinement. Be helpful and suggest valid ranges.`
      : "";

    // 10. Build message array for OpenAI
    // AI Copilot prompt is self-contained with ai_context + seller_memory
    // No need for separate context injection - everything is in the system prompt
    // Chat stays quiet by default - no initial greeting, only respond when user asks
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE B FIX: Ensure systemPrompt is the final version (after escalation mutations)
    // ═══════════════════════════════════════════════════════════════════════════
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      // System prompt: Contains locked behavior contract + ai_context + seller_memory
      // CRITICAL: Use final systemPrompt (after escalation mutations if any)
      { role: "system", content: systemPrompt },
    ];
    
    // Add validation context if cost refinement failed
    if (validationContext) {
      messages.push({
        role: "user",
        content: validationContext,
      });
    }

    // 11. Append conversation history from database (if exists)
    // This includes previous user questions and assistant responses
    if (priorMessages && priorMessages.length > 0) {
      for (const msg of priorMessages) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
        }
      }
    }

    // 12. Append escalation context if escalation was executed
    // ────────────────────────────────────────────────────────────────────────
    // If escalation was executed, inject product data into context
    // This makes escalated data available to the AI for answering
    if (escalationResults && escalationResults.success) {
      const escalationContext: Record<string, unknown> = {
        escalation_executed: true,
        escalated_asins: escalationDecision.required_asins,
        credits_used: escalationResults.creditsUsed,
        cached: escalationResults.cached,
      };
      
      // Add product data for each ASIN
      for (const asin of escalationDecision.required_asins) {
        if (escalationResults.productData.has(asin)) {
          escalationContext[`product_${asin}`] = escalationResults.productData.get(asin);
        }
      }
      
      // Inject escalation context into system prompt
      // STRICT RULE: All product data comes from the single API response per ASIN
      // If data is missing, use available related data - NEVER refuse
      systemPrompt += `\n\n=== ESCALATION CONTEXT ===
${JSON.stringify(escalationContext, null, 2)}

CRITICAL RULES FOR ESCALATED DATA:
1. All product data comes from a SINGLE Rainforest API call per ASIN (type=product)
2. If a field is missing from the response, use available related data from the escalated response to answer
3. NEVER say "This information is not available" or "Amazon does not expose" - these are FORBIDDEN phrases
4. If specific data is missing, provide the closest available information from the escalated response
5. Do NOT infer, guess, or suggest additional API calls for missing data
6. Use only the data present in the single response object
7. ALWAYS answer the user's question using the escalated product data provided above - never refuse even if specific field is missing
8. You MUST explicitly reference at least 2 concrete fields from the escalated product payload(s) (e.g., price, rating, reviews_total, bsr, bought_last_month) when answering. If the payload lacks usable fields, say so explicitly and state what was missing.`;
      
      // CRITICAL: Update the system message in messages array after modifying systemPrompt
      // The messages array was already built, so we need to update it
      if (messages.length > 0 && messages[0].role === "system") {
        messages[0].content = systemPrompt;
      }
    }
    
    // 12. Append the new user message
    // If escalation message exists, prepend it to show user what's happening
    const userMessage = escalationMessage 
      ? `${escalationMessage}\n\n${body.message}`
      : body.message;
    messages.push({ role: "user", content: userMessage });

    // 13. Classify question (for context, not blocking)
    // ────────────────────────────────────────────────────────────────────────
    // Note: We no longer block responses due to missing data.
    // The AI will always answer using available data, with confidence adjustments.
    // ────────────────────────────────────────────────────────────────────────
    const { classifyQuestion } = await import("@/lib/ai/copilotSystemPrompt");
    const questionClassification = classifyQuestion(body.message);

    // 14. Call OpenAI with streaming enabled
    // ────────────────────────────────────────────────────────────────────────
    // IMPORTANT: This call does NOT trigger any external data fetching.
    // The AI can ONLY use data injected via the context message above.
    // ────────────────────────────────────────────────────────────────────────
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { ok: false, error: "OpenAI API key not configured" },
        { status: 500, headers: res.headers }
      );
    }

    // Determine max_tokens based on response mode
    const maxTokens = responseMode === "expanded" ? 700 : 300;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE B FIX: Updated sanity check to inspect ONLY copilotContext.ai_context
    // ═══════════════════════════════════════════════════════════════════════════
    // Inspect ONLY copilotContext.ai_context (not any wrapper)
    const ai = copilotContext.ai_context as Record<string, unknown> | null;
    const productsArray = Array.isArray(ai?.products) ? (ai.products as any[]) : [];
    const computedMetrics = ai?.computed_metrics as Record<string, unknown> | undefined;
    
    // Validate exact booleans as required
    const has_ai_context = !!ai;
    const has_ai_context_products = Array.isArray(ai?.products) && productsArray.length > 0;
    const has_computed_metrics = !!computedMetrics;
    
    // Server-side count verification: count products with review_count < 500
    const lt500 = productsArray.filter((p: any) => 
      typeof p.review_count === 'number' && p.review_count < 500
    ).length;
    
    const firstProductSample = productsArray.length > 0 ? {
      asin: productsArray[0]?.asin,
      title: productsArray[0]?.title?.substring(0, 50) || null,
      review_count: productsArray[0]?.review_count ?? null,
      estimated_monthly_revenue: productsArray[0]?.estimated_monthly_revenue ?? null,
    } : null;
    
    // Server-side scope verification counts (explicit boolean checks)
    const sponsoredCount = productsArray.filter((p: any) => p.is_sponsored === true).length;
    const organicCount = productsArray.filter((p: any) => p.is_sponsored === false).length;
    const unknownSponsoredCount = productsArray.filter((p: any) => p.is_sponsored === null).length;
    
    // Unique ASINs vs Total Appearances
    const uniqueAsins = new Set(productsArray.map((p: any) => p.asin));
    const page1UniqueAsins = uniqueAsins.size;
    const page1TotalAppearances = productsArray.length;
    
    // Scope-specific lt500 counts (explicit boolean checks)
    const lt500All = productsArray.filter((p: any) => 
      typeof p.review_count === 'number' && p.review_count < 500
    ).length;
    const lt500AllUnknown = productsArray.filter((p: any) => 
      p.review_count === null
    ).length;
    
    const lt500Organic = productsArray.filter((p: any) => 
      p.is_sponsored === false && typeof p.review_count === 'number' && p.review_count < 500
    ).length;
    const lt500OrganicUnknown = productsArray.filter((p: any) => 
      p.is_sponsored === false && p.review_count === null
    ).length;
    
    const lt500Sponsored = productsArray.filter((p: any) => 
      p.is_sponsored === true && typeof p.review_count === 'number' && p.review_count < 500
    ).length;
    const lt500SponsoredUnknown = productsArray.filter((p: any) => 
      p.is_sponsored === true && p.review_count === null
    ).length;
    
    const lt500UnknownSponsored = productsArray.filter((p: any) => 
      p.is_sponsored === null && typeof p.review_count === 'number' && p.review_count < 500
    ).length;
    const lt500UnknownSponsoredUnknown = productsArray.filter((p: any) => 
      p.is_sponsored === null && p.review_count === null
    ).length;
    
    console.log("🔍 OPENAI_CONTEXT_SANITY_CHECK", {
      analysisRunId: body.analysisRunId,
      userId: user.id,
      // Inspect ONLY copilotContext.ai_context
      has_ai_context,
      has_ai_context_products,
      has_computed_metrics,
        computed_metrics_keys: computedMetrics ? Object.keys(computedMetrics) : [],
      selected_asins_count: selectedAsins.length,
      selected_asins: selectedAsins,
      enrichment_triggered_types: enrichmentTypes,
      has_spapi_enrichment: !!(ai as any)?.spapi_enrichment,
      has_rainforest_enrichment: !!(ai as any)?.rainforest_enrichment,
      has_rainforest_reviews_enrichment: !!(ai as any)?.rainforest_reviews_enrichment,
      spapi_enrichment_asins: (ai as any)?.spapi_enrichment?.asins || [],
      rainforest_enrichment_asins: (ai as any)?.rainforest_enrichment?.asins || [],
      rainforest_reviews_enrichment_asins: (ai as any)?.rainforest_reviews_enrichment?.asins || [],
      spapi_enrichment_count: (ai as any)?.spapi_enrichment?.asins?.length || 0,
      rainforest_enriched_asins_count: (ai as any)?.rainforest_enrichment?.asins?.length || 0,
      reviews_enriched_asins_count: (ai as any)?.rainforest_reviews_enrichment?.asins?.length || 0,
      // Unique ASINs vs Total Appearances
      page1_unique_asins: page1UniqueAsins,
      page1_total_appearances: page1TotalAppearances,
      // Product counts by sponsored status (appearances)
      total_products: productsArray.length,
      sponsored_count: sponsoredCount,
      organic_count: organicCount,
      unknown_sponsored_count: unknownSponsoredCount,
      first_product_sample: firstProductSample,
      // Server-side verification counts (all scopes)
      lt500_all_scope: lt500,
      // Scope-specific lt500 breakdown (with unknown_sponsored)
      lt500_breakdown: {
        all: { known_count: lt500All, unknown_count: lt500AllUnknown },
        organic: { known_count: lt500Organic, unknown_count: lt500OrganicUnknown },
        sponsored: { known_count: lt500Sponsored, unknown_count: lt500SponsoredUnknown },
        unknown_sponsored: { known_count: lt500UnknownSponsored, unknown_count: lt500UnknownSponsoredUnknown },
      },
      // Additional context for debugging
      ai_context_keys: ai ? Object.keys(ai) : [],
      has_mode: !!(ai as any)?.mode,
      has_keyword: !!(ai as any)?.keyword,
      has_authoritative_facts: !!(ai as any)?.authoritative_facts,
      has_page1_market_summary: !!(ai as any)?.page1_market_summary,
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MATH/EQUALITY FAST PATH (Deterministic - Bypasses LLM)
    // ═══════════════════════════════════════════════════════════════════════════
    // Detects equality check questions and computes answer deterministically
    // This prevents LLM from incorrectly saying "No" when math shows equality
    const equalityPatterns = [
      /(is|does).*(all|total).*(=|equal).*(organic).*sponsored/i,
      /(is|does).*(organic).*sponsored.*(=|equal).*(all|total)/i,
      /show.*math/i,
      /equal.*organic.*sponsored/i,
      /organic.*sponsored.*equal/i,
    ];
    
    const isEqualityQuestion = equalityPatterns.some(pattern => pattern.test(body.message));
    
    if (isEqualityQuestion && computedMetrics && typeof computedMetrics === 'object') {
      try {
        // Type-safe access to computed_metrics
        const counts = (computedMetrics as any).counts;
        if (!counts || typeof counts !== 'object') {
          throw new Error("computed_metrics.counts not available");
        }
        
        // Parse metric type from question
        const mentionsReviews = /(<|less than|under|below)\s*(\d+)\s*(reviews?|review)/i.test(body.message);
        const mentionsListings = /(listings?|products?|asins?|appearances?)/i.test(body.message);
        
        let metric = "unknown";
        let left: { known_count: number; unknown_count: number } | null = null;
        let right: { known_count: number; unknown_count: number } | null = null;
        let equals = false;
        let organicValue = 0;
        let sponsoredValue = 0;
        let organicUnknown = 0;
        let sponsoredUnknown = 0;
        
        if (mentionsReviews) {
          // Extract threshold (e.g., "500", "50", "100")
          const thresholdMatch = body.message.match(/(\d+)/);
          const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 500;
          
          // Use review_thresholds if available
          const thresholds = counts.review_thresholds;
          const thresholdKey = threshold === 50 ? 'lt50' : 'lt500';
          const thresholdData = thresholds?.[thresholdKey];
          
          if (thresholdData && thresholdData.all && thresholdData.organic && thresholdData.sponsored) {
            metric = `review_thresholds.${thresholdKey}`;
            const allData = thresholdData.all;
            const organicData = thresholdData.organic;
            const sponsoredData = thresholdData.sponsored;
            left = allData;
            organicValue = organicData.known_count || 0;
            sponsoredValue = sponsoredData.known_count || 0;
            organicUnknown = organicData.unknown_count || 0;
            sponsoredUnknown = sponsoredData.unknown_count || 0;
            right = {
              known_count: organicValue + sponsoredValue,
              unknown_count: organicUnknown + sponsoredUnknown,
            };
            equals = (allData.known_count === right.known_count) && (allData.unknown_count === right.unknown_count);
          }
        } else if (mentionsListings) {
          // Listing count comparison
          metric = "listing_counts";
          const byStatus = counts.by_sponsored_status;
          const page1UniqueAsins = counts.page1_unique_asins || 0;
          
          if (byStatus) {
            organicValue = byStatus.organic_unique_asins || 0;
            sponsoredValue = byStatus.sponsored_unique_asins || 0;
            left = {
              known_count: page1UniqueAsins,
              unknown_count: 0, // No unknown for listing counts
            };
            right = {
              known_count: organicValue + sponsoredValue,
              unknown_count: 0,
            };
            equals = left.known_count === right.known_count;
          }
        }
        
        if (left && right) {
          // Build deterministic response
          // TypeScript: left and right are guaranteed non-null here
          const leftValue = left;
          const rightValue = right;
          let responseText = "";
          
          if (equals) {
            responseText = `Yes, all equals organic + sponsored.\n\nMath:\n`;
            responseText += `- All: ${leftValue.known_count}${leftValue.unknown_count > 0 ? ` (${leftValue.unknown_count} listings with missing data)` : ''}\n`;
            responseText += `- Organic: ${organicValue}${mentionsReviews && organicUnknown > 0 ? ` (${organicUnknown} listings with missing data)` : ''}\n`;
            responseText += `- Sponsored: ${sponsoredValue}${mentionsReviews && sponsoredUnknown > 0 ? ` (${sponsoredUnknown} listings with missing data)` : ''}\n`;
            responseText += `- Sum: ${rightValue.known_count}${rightValue.unknown_count > 0 ? ` (${rightValue.unknown_count} listings with missing data)` : ''}\n\n`;
            responseText += `${leftValue.known_count} = ${rightValue.known_count}`;
            if (leftValue.unknown_count > 0 || rightValue.unknown_count > 0) {
              responseText += `\n\nNote: Some listings don't show this data on Page-1, so the true numbers could be slightly different.`;
            }
            responseText += `\n\nWant me to break this down by organic vs sponsored, or by the top brands?`;
          } else {
            responseText = `No, all does not equal organic + sponsored.\n\nMath:\n`;
            responseText += `- All: ${leftValue.known_count}${leftValue.unknown_count > 0 ? ` (${leftValue.unknown_count} listings with missing data)` : ''}\n`;
            responseText += `- Organic: ${organicValue}${mentionsReviews && organicUnknown > 0 ? ` (${organicUnknown} listings with missing data)` : ''}\n`;
            responseText += `- Sponsored: ${sponsoredValue}${mentionsReviews && sponsoredUnknown > 0 ? ` (${sponsoredUnknown} listings with missing data)` : ''}\n`;
            responseText += `- Sum: ${rightValue.known_count}${rightValue.unknown_count > 0 ? ` (${rightValue.unknown_count} listings with missing data)` : ''}\n\n`;
            responseText += `${leftValue.known_count} ≠ ${rightValue.known_count}`;
            if (leftValue.unknown_count > 0 || rightValue.unknown_count > 0) {
              responseText += `\n\nNote: Some listings don't show this data on Page-1, so the true numbers could be slightly different.`;
            }
            responseText += `\n\nWant me to break this down by organic vs sponsored, or by the top brands?`;
          }
          
          console.log("🔢 MATH_FAST_PATH_USED", {
            question: body.message,
            metric,
            left,
            right,
            equals,
            analysisRunId: body.analysisRunId,
          });
          
          // Return deterministic response directly (no OpenAI call)
          return new NextResponse(
            JSON.stringify({
              ok: true,
              message: responseText,
              source: "math_fast_path",
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                ...res.headers,
              },
            }
          );
        }
      } catch (error) {
        // If fast path fails, fall through to normal OpenAI call
        console.warn("⚠️ MATH_FAST_PATH_ERROR", {
          question: body.message,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.7,
          max_tokens: maxTokens, // Enforce token limit based on mode
          stream: true, // Enable streaming
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      return NextResponse.json(
        {
          ok: false,
          error: `OpenAI API error: ${openaiResponse.statusText}`,
          details: errorData,
        },
        { status: 500, headers: res.headers }
      );
    }

    // 12. Stream the response to the client
    // ────────────────────────────────────────────────────────────────────────
    // We collect the full response while streaming to save it to the database
    // ────────────────────────────────────────────────────────────────────────
    let fullAssistantMessage = "";
    
    // Capture pendingMemoriesForConfirmation for use in stream closure
    const pendingMemoriesToShow = pendingMemoriesForConfirmation;
    
    // Capture escalation results and selected ASINs for citation building (used in stream closure)
    const escalationResultsForCitations = escalationResults;
    const selectedAsinForCitations = selectedAsin; // Backward compatibility
    const selectedAsinsForCitations = selectedAsins; // Multi-ASIN support
    const escalationDecisionForCitations = escalationDecision;
    const selectedListingForCitations = body.selectedListing; // Backward compatibility
    
    // Variable to capture citations built in stream closure (for database storage)
    let citationsForDb: Array<{ type: "asin"; asin: string; source: "page1_estimate" | "rainforest_product" }> = [];

    const stream = new ReadableStream({
      async start(controller) {
        // Send copilot intent metadata early (non-blocking) so the UI can start inline workflows
        if (copilotIntentMetadata) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ metadata: copilotIntentMetadata })}\n\n`)
          );
        }

        // CRITICAL: Send escalation message IMMEDIATELY when escalation is required
        // This must happen BEFORE the OpenAI API call so the user sees the message first
        if (shouldShowEscalationMessage && escalationMessage) {
          // Send the exact escalation message as metadata
          // The frontend will display this message immediately
          const escalationMetadata = {
            type: "escalation_message",
            message: escalationMessage, // The exact message from buildEscalationMessage()
            asins: escalationDecision.required_asins,
            credits: escalationDecision.required_credits,
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ metadata: escalationMetadata })}\n\n`));
        }
        
        // Also send escalation_started for backward compatibility (if escalation happened)
        if (escalationMessage && escalationResults && escalationResults.success) {
          const escalationMetadata = {
            type: "escalation_started",
            question: body.message, // Natural language version of the question
            asin: selectedAsin || escalationDecision.required_asins[0] || null,
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ metadata: escalationMetadata })}\n\n`));
        }
        
        // If margin snapshot was refined, send updated snapshot metadata
        // This allows the frontend to update the UI with refined margin data
        if (shouldSaveSnapshot && marginSnapshot) {
          const refinedValues: string[] = [];
          if (costRefinement?.cogs !== undefined && costRefinement.cogs !== null && typeof costRefinement.cogs === 'number' && !isNaN(costRefinement.cogs)) {
            refinedValues.push(`$${costRefinement.cogs.toFixed(2)} COGS`);
          }
          if (costRefinement?.fbaFee !== undefined && costRefinement.fbaFee !== null && typeof costRefinement.fbaFee === 'number' && !isNaN(costRefinement.fbaFee)) {
            refinedValues.push(`$${costRefinement.fbaFee.toFixed(2)} FBA fees`);
          }
          
          const metadata = {
            type: "margin_snapshot_refined",
            margin_snapshot: marginSnapshot,
            refined_values: refinedValues.join(" and "),
            confidence_tier: marginSnapshot.confidence_tier,
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ metadata })}\n\n`));
        }

        const reader = openaiResponse.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let readerReleased = false;
        let buffer = ""; // Buffer for incomplete SSE lines
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Decode chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });

            // Split by double newline to get complete SSE events
            const lines = buffer.split("\n\n");
            // Keep the last incomplete line in buffer
            buffer = lines.pop() || "";

            // Process complete lines
            for (const line of lines) {
              if (!line.trim()) continue;

              // Handle [DONE] marker
              if (line.trim() === "data: [DONE]" || line.trim() === "[DONE]") {
                continue;
              }

              // Extract data from SSE line
              if (line.startsWith("data:")) {
                const data = line.replace(/^data:\s*/, "").trim();
                
                // Skip [DONE] marker
                if (data === "[DONE]") {
                  continue;
                }

                // Parse JSON data
                try {
                  const json = JSON.parse(data);
                  
                  // Extract content from OpenAI streaming format: choices[0].delta.content
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    fullAssistantMessage += content;
                    // Send each chunk to the client
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch (parseError) {
                  // Only log if it's not an empty string or partial JSON (which is expected)
                  if (data && data !== "[DONE]" && !data.startsWith("{")) {
                    console.warn("Failed to parse SSE line:", data.substring(0, 100));
                  }
                }
              }
            }
          }
          
          // Process any remaining buffer content after stream ends
          if (buffer.trim()) {
            const lines = buffer.split("\n\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              if (line.trim() === "data: [DONE]" || line.trim() === "[DONE]") continue;
              
              if (line.startsWith("data:")) {
                const data = line.replace(/^data:\s*/, "").trim();
                if (data === "[DONE]") continue;
                
                try {
                  const json = JSON.parse(data);
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    fullAssistantMessage += content;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch (parseError) {
                  // Ignore parse errors on leftover buffer
                }
              }
            }
          }
          
          // Ensure reader is released
          if (!readerReleased) {
            reader.releaseLock();
            readerReleased = true;
          }

          // FIX 4: Safety assertion — never silently fail on valid Page-1 context.
          // If we have an analysis_run_id and the question can be answered from Page-1,
          // OpenAI must produce some content. If not, crash loudly (caught and surfaced to client).
          const hasAiContext =
            !!body.analysisRunId &&
            (!!aiContext ||
              !!analysisResponse.market_snapshot ||
              Array.isArray((analysisResponse as any).page_one_listings) ||
              Array.isArray((analysisResponse as any).products));
          if (hasAiContext && escalationDecisionForCitations.can_answer_from_page1 && !fullAssistantMessage.trim()) {
            throw new Error("Chat failed despite valid Page-1 context");
          }

          // 14. Validate response for forbidden language (TRIPWIRE)
          // ────────────────────────────────────────────────────────────────
          // Scan response for forbidden phrases: confidence scores, verdict language, internal headers
          // ────────────────────────────────────────────────────────────────
          let finalMessage = fullAssistantMessage.trim();
          let tripwireTriggered = false;
          let tripwireReason: string | undefined;
          
          // ═══════════════════════════════════════════════════════════════════════════
          // POST-PROCESSOR: Strip dev jargon and ensure follow-up question
          // ═══════════════════════════════════════════════════════════════════════════
          if (finalMessage) {
            let hadForbiddenTerms = false;
            let appendedFollowup = false;
            
            // Strip/replace forbidden technical terms
            const forbiddenTerms = [
              { pattern: /\bunknown_count\b/gi, replacement: "listings with missing data" },
              { pattern: /\bknown_count\b/gi, replacement: "listings" },
              { pattern: /\bcomputed_metrics\b/gi, replacement: "data" },
              { pattern: /\bai_context\b/gi, replacement: "data" },
              { pattern: /\bauthoritative_facts\b/gi, replacement: "data" },
              { pattern: /\bPage-1 array\b/gi, replacement: "Page-1 listings" },
              { pattern: /\bschema\b/gi, replacement: "format" },
              { pattern: /\bcontract\b/gi, replacement: "data" },
              { pattern: /\bdata structure\b/gi, replacement: "data" },
              { pattern: /\binternal\b/gi, replacement: "" },
            ];
            
            for (const { pattern, replacement } of forbiddenTerms) {
              if (pattern.test(finalMessage)) {
                hadForbiddenTerms = true;
                finalMessage = finalMessage.replace(pattern, replacement);
              }
            }
            
            // Clean up any double spaces or trailing punctuation issues
            finalMessage = finalMessage.replace(/\s+/g, " ").trim();
            
            // Ensure ends with exactly ONE follow-up question
            const questionMarkCount = (finalMessage.match(/\?/g) || []).length;
            const lastChar = finalMessage[finalMessage.length - 1];
            
            if (lastChar !== "?") {
              // Append a follow-up question if missing
              const followUpQuestions = [
                "Want me to break this down by organic vs sponsored, or by the top brands?",
                "Should I analyze the price structure for these listings?",
                "Would you like me to check the review distribution for the top products?",
                "Want me to dive deeper into any specific aspect?",
              ];
              // Pick a relevant follow-up based on context
              const hasReviewMention = /review/i.test(finalMessage);
              const hasPriceMention = /price|cost|revenue/i.test(finalMessage);
              const hasBrandMention = /brand/i.test(finalMessage);
              
              let followUp = followUpQuestions[0]; // Default
              if (hasReviewMention) {
                followUp = "Want me to break this down by organic vs sponsored, or by the top brands?";
              } else if (hasPriceMention) {
                followUp = "Should I analyze the price structure for these listings?";
              } else if (hasBrandMention) {
                followUp = "Want me to dive deeper into any specific aspect?";
              }
              
              finalMessage = finalMessage + (lastChar.match(/[.!]$/) ? " " : ". ") + followUp;
              appendedFollowup = true;
            } else if (questionMarkCount > 1) {
              // Multiple questions - keep only the last one
              const sentences = finalMessage.split(/(?<=[.!?])\s+/);
              const questions = sentences.filter(s => s.trim().endsWith("?"));
              if (questions.length > 1) {
                // Remove all but the last question
                const lastQuestion = questions[questions.length - 1];
                const lastQuestionIndex = finalMessage.lastIndexOf(lastQuestion);
                finalMessage = finalMessage.substring(0, lastQuestionIndex) + lastQuestion;
              }
            }
            
            console.log("🔧 COPILOT_POSTPROCESS", {
              analysisRunId: body.analysisRunId,
              had_forbidden_terms: hadForbiddenTerms,
              appended_followup: appendedFollowup,
              question_count_after: (finalMessage.match(/\?/g) || []).length,
            });
          }
          
          if (finalMessage) {
            // Check for financial directive patterns first
            const financialCheck = sanitizeFinancialDirectives(finalMessage);
            if (financialCheck.detected) {
              tripwireTriggered = true;
              tripwireReason = `Financial directive patterns detected: ${financialCheck.patterns.join(", ")}`;
              
              // Log the event
              console.error("AI_COPILOT_FINANCIAL_DIRECTIVE_TRIPWIRE", {
                analysisRunId: body.analysisRunId,
                userId: user.id,
                reason: tripwireReason,
                patterns: financialCheck.patterns,
                messagePreview: finalMessage.substring(0, 200),
                userMessage: body.message,
                timestamp: new Date().toISOString(),
              });
              
              // Use sanitized message
              finalMessage = financialCheck.sanitized;
            }

            // Check for forbidden phrases
            const forbiddenPhrases = [
              /confidence level:\s*(high|medium|low)/i,
              /confidence:\s*(high|medium|low)/i,
              /data interpretation/i,
              /scenario answer/i,
              /response corrected due to data validation/i,
              /corrected due to validation/i,
              /this analysis suggests/i,
              /i can't answer reliably/i,
            ];
            
            for (const pattern of forbiddenPhrases) {
              if (pattern.test(finalMessage)) {
                tripwireTriggered = true;
                tripwireReason = tripwireReason 
                  ? `${tripwireReason}; Forbidden phrase: ${pattern.source}`
                  : `Forbidden phrase detected: ${pattern.source}`;
                
                // Log the event
                console.error("AI_COPILOT_FORBIDDEN_LANGUAGE_TRIPWIRE", {
                  analysisRunId: body.analysisRunId,
                  userId: user.id,
                  reason: tripwireReason,
                  messagePreview: finalMessage.substring(0, 200),
                  userMessage: body.message,
                  timestamp: new Date().toISOString(),
                });
                
                // Remove forbidden phrases and clean up
                finalMessage = finalMessage
                  .replace(/confidence level:\s*(high|medium|low)/gi, "")
                  .replace(/confidence:\s*(high|medium|low)/gi, "")
                  .replace(/data interpretation/gi, "")
                  .replace(/scenario answer/gi, "")
                  .replace(/response corrected due to data validation/gi, "")
                  .replace(/corrected due to validation/gi, "")
                  .replace(/this analysis suggests/gi, "The data shows")
                  .replace(/i can't answer reliably/gi, "I don't have the data needed to answer that")
                  .replace(/\n\n\n+/g, "\n\n") // Clean up extra newlines
                  .trim();
                
                break;
              }
            }
            
            // Extract allowed numbers from context
            const allowedNumbers = extractAllowedNumbers(
              analysisResponse,
              marketSnapshot,
              sellerProfile
            );

            // If escalation ran, allow numbers from escalated product payloads (prevents false hallucination tripwires)
            if (escalationResults && escalationResults.success) {
              for (const asin of escalationDecision.required_asins) {
                if (escalationResults.productData.has(asin)) {
                  addNumbersFromUnknown(escalationResults.productData.get(asin), allowedNumbers);
                }
              }
            }
            
            // Extract allowed metrics (currently none - we don't support ACOS, TACOS, etc.)
            const allowedMetrics = new Set<string>();
            
            // Validate response for hallucinations (invented data)
            const validation = validateResponseForHallucination(
              finalMessage,
              allowedNumbers,
              allowedMetrics
            );
            
            if (!validation.isValid) {
              tripwireTriggered = true;
              tripwireReason = validation.reason;
              
              // Log the event
              console.error("AI_COPILOT_HALLUCINATION_TRIPWIRE", {
                analysisRunId: body.analysisRunId,
                userId: user.id,
                reason: validation.reason,
                messagePreview: finalMessage.substring(0, 200),
                userMessage: body.message,
                aiContextKeys: aiContext ? Object.keys(aiContext) : [],
                memoryVersion: sellerMemory.version,
                timestamp: new Date().toISOString(),
              });
              
              // Replace with calm explanation (no "corrected" language)
              const fallbackMessage = "I don't have the data needed to answer that definitively.\n\nThis question would require information beyond what's available in the analysis.";
              
              // Send fallback (no correction notice)
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: fallbackMessage })}\n\n`));
              
              // Replace final message with fallback for database storage
              finalMessage = fallbackMessage;
            } else {
              // Log successful AI response for audit/debugging
              console.log("AI_COPILOT_RESPONSE", {
                analysisRunId: body.analysisRunId,
                userId: user.id,
                messageLength: finalMessage.length,
                hasAiContext: !!aiContext,
                memoryVersion: sellerMemory.version,
                timestamp: new Date().toISOString(),
              });
            }
          }

          // 15. Remove any remaining confidence/verdict language (cleanup)
          // ────────────────────────────────────────────────────────────────
          // Final pass to remove any confidence scores or verdict language that slipped through
          if (finalMessage) {
            // Remove confidence language
            finalMessage = finalMessage
              .replace(/confidence level:\s*(high|medium|low)/gi, "")
              .replace(/confidence:\s*(high|medium|low)/gi, "")
              .replace(/confidence tier:\s*(high|medium|low)/gi, "")
              .replace(/\n\n\n+/g, "\n\n") // Clean up extra newlines
              .trim();
          }
          
          // 15a. Add inline citations if escalation was executed
          // ────────────────────────────────────────────────────────────────
          // Citations are now handled via metadata (citations array)
          // This section is kept for backward compatibility but citations are added via chips

          // Check for pending memories that need confirmation
          // Only show one at a time, after the response
          if (pendingMemoriesToShow.length > 0) {
            const pendingMemory = pendingMemoriesToShow[0];
            const { formatMemoryForConfirmation } = await import("@/lib/ai/memoryMerge");
            const memoryDescription = formatMemoryForConfirmation(pendingMemory.memory_candidate as any);
            
            // Send confirmation prompt as metadata
            const confirmationPrompt = {
              type: "memory_confirmation",
              pendingMemoryId: pendingMemory.id,
              message: "I can remember this to improve future answers.\n\nShould I save this about how you operate?",
              memoryDescription,
              subtext: "You can change or delete this anytime in Settings.",
            };
            
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ metadata: confirmationPrompt })}\n\n`));
          }
          
          // Build citations based on data used
          // STRICT: Only cite selected ASINs - if exactly 1 ASIN is selected, cite ONLY that ASIN
          const citations: Array<{ type: "asin"; asin: string; source: "page1_estimate" | "rainforest_product" }> = [];
          
          // Get effective selected ASINs (multi-select support)
          const effectiveSelectedAsinsForCitations = selectedAsinsForCitations && selectedAsinsForCitations.length > 0
            ? selectedAsinsForCitations
            : (selectedAsinForCitations ? [selectedAsinForCitations] : []);
          
          // STRICT ENFORCEMENT: Citations may ONLY include selected ASINs
          // If exactly 1 ASIN is selected, citations must contain ONLY that ASIN
          if (effectiveSelectedAsinsForCitations.length > 0) {
            // If escalation occurred, add citations with rainforest_product source
            if (escalationResultsForCitations && escalationResultsForCitations.success) {
              // STRICT: Only cite ASINs that were escalated AND are in selected ASINs
              // Do NOT cite any ASINs outside of selected ASINs
              for (const escalatedAsin of escalationDecisionForCitations.required_asins) {
                if (effectiveSelectedAsinsForCitations.includes(escalatedAsin)) {
                  citations.push({
                    type: "asin",
                    asin: escalatedAsin,
                    source: "rainforest_product",
                  });
                } else {
                  // Log error if citation ASIN is not in selected ASINs
                  console.error("[CITATION_ASIN_MISMATCH]", {
                    selectedAsins: effectiveSelectedAsinsForCitations,
                    escalatedAsin,
                    required_asins: escalationDecisionForCitations.required_asins,
                    note: "Citation ASIN is not in selected ASINs - citation blocked. This should never happen if escalation logic is correct.",
                  });
                }
              }
            } else {
              // If Page-1 product data was used, add citations with page1_estimate source
              // Check if the response likely used product-specific data
              const hasProductDataInContext = 
                effectiveSelectedAsinsForCitations.some(asin => 
                  finalMessage?.toLowerCase().includes(asin.toLowerCase())
                ) ||
                finalMessage?.toLowerCase().includes("this product") ||
                finalMessage?.toLowerCase().includes("these products") ||
                finalMessage?.toLowerCase().includes("selected product") ||
                finalMessage?.toLowerCase().includes("selected products");
              
              if (hasProductDataInContext) {
                // STRICT: Only cite selected ASINs, never auto-expand to other products
                // If exactly 1 ASIN is selected, this will cite ONLY that ASIN
                for (const asin of effectiveSelectedAsinsForCitations) {
                  citations.push({
                    type: "asin",
                    asin,
                    source: "page1_estimate",
                  });
                }
              }
            }
          }
          
          // Send citations as metadata before closing stream
          if (citations.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ metadata: { type: "citations", citations } })}\n\n`));
            // Capture citations for database storage
            citationsForDb = citations;
          }
          
          // Signal end of stream FIRST (don't block on database save)
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          
          // 16. Save messages to database after streaming completes (non-blocking)
          // ────────────────────────────────────────────────────────────────
          // Persist both user and assistant messages for history restoration
          // ────────────────────────────────────────────────────────────────
          // Do this after closing the stream so it doesn't block the response
          if (finalMessage) {
            // Don't await - let it run in background
            (async () => {
              try {
                // Extract source ASINs from escalation results
                // HARD LOCK: Only track the selected ASIN
                const sourceAsins = escalationResults && escalationResults.success && selectedAsin
                  ? [selectedAsin] // Only selected ASIN
                  : null;
                
                // Calculate credits used
                const creditsUsed = escalationResults && escalationResults.success
                  ? escalationResults.creditsUsed
                  : 0;
                
                // Citations already captured in stream closure (citationsForDb)
                
                const result = await supabase.from("analysis_messages").insert([
                  {
                    analysis_run_id: body.analysisRunId,
                    user_id: user.id,
                    role: "user",
                    content: body.message,
                    source_asins: null,
                    credits_used: 0,
                  },
                  {
                    analysis_run_id: body.analysisRunId,
                    user_id: user.id,
                    role: "assistant",
                    content: finalMessage,
                    source_asins: sourceAsins,
                    credits_used: creditsUsed,
                  },
                ]);
                
                console.log("Chat messages saved to database");
                
                // 17. Extract and store memories from user message (non-blocking, parallel)
                // ────────────────────────────────────────────────────────────────
                // Memory extraction runs in parallel - doesn't block the response
                // Uses merge logic to determine what to save vs. what to ask user about
                // ────────────────────────────────────────────────────────────────
                try {
                  const { extractMemoriesFromText } = await import("@/lib/ai/memoryExtraction");
                  const { upsertMemoriesWithMerge } = await import("@/lib/ai/sellerMemoryStore");
                  const { shouldAskUserToConfirm, formatMemoryForConfirmation } = await import("@/lib/ai/memoryMerge");
                  
                  // Extract memories from user message
                  const extractedMemories = await extractMemoriesFromText(
                    body.message,
                    'explicit_user_statement'
                  );
                  
                  if (extractedMemories.length > 0) {
                    // Get the user message ID for source_reference
                    const userMessageId = (result.data as any)?.[0]?.id || null;
                    
                    // Upsert memories with merge logic
                    const mergeResult = await upsertMemoriesWithMerge(
                      supabase,
                      user.id,
                      extractedMemories,
                      userMessageId
                    );
                    
                    console.log(`Memory extraction: ${mergeResult.inserted} inserted, ${mergeResult.updated} updated, ${mergeResult.pending.length} pending`);
                    
                    // If there are pending memories that should be confirmed, we'll handle them
                    // in the next chat response (they'll be checked when building context)
                    if (mergeResult.pending.length > 0) {
                      console.log(`Pending memories requiring confirmation: ${mergeResult.pending.length}`);
                    }
                  }
                } catch (error) {
                  // Memory extraction failures should not block chat
                  console.error("Memory extraction error (non-blocking):", error);
                }
              } catch (saveError) {
                console.error("Failed to save chat messages:", saveError);
              }
            })();
          }
        } catch (error) {
          console.error("Streaming error:", error);
          
          // Ensure reader is released even on error
          if (!readerReleased && reader) {
            try {
              reader.releaseLock();
            } catch (releaseError) {
              // Ignore release errors
            }
          }
          
          // Try to send error message to client before closing
          try {
            const errorMessage = error instanceof Error ? error.message : "An error occurred while streaming";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch (enqueueError) {
            // If we can't enqueue, just close
          }
          
          // Always close the controller
          try {
            controller.close();
          } catch (closeError) {
            // Controller might already be closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        ...Object.fromEntries(res.headers.entries()),
      },
    });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    const errorDetails = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : { error: String(error) };
    
    console.error("CHAT_ERROR_DETAILS", {
      ...errorDetails,
      timestamp: new Date().toISOString(),
    });
    
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500, headers: res.headers }
    );
  }
}

