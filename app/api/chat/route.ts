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
  selectedListing?: any | null; // Optional selected listing for AI context
}

function validateRequestBody(body: unknown): body is ChatRequestBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const b = body as Record<string, unknown>;
  return (
    typeof b.analysisRunId === "string" &&
    b.analysisRunId.trim().length > 0 &&
    typeof b.message === "string" &&
    b.message.trim().length > 0
  );
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
  },
  inputType: string,
  inputValue: string,
  selectedListing?: any | null
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

${JSON.stringify(rainforestData, null, 2)}`);
  } else {
    contextParts.push(`=== MARKET DATA ===
No cached market data available for this analysis.
You must explicitly state this limitation if the user asks about market metrics.`);
  }

  // Section 3: Seller Context (ensures personalized advice)
  contextParts.push(`=== SELLER CONTEXT ===
Stage: ${sellerProfile.stage}
Experience: ${sellerProfile.experience_months !== null ? `${sellerProfile.experience_months} months` : "Not specified"}
Revenue Range: ${sellerProfile.monthly_revenue_range || "Not specified"}
Sourcing Model: ${sellerProfile.sourcing_model || "not_sure"}

Use this context to tailor your advice. A new seller receives different guidance than a scaling seller.
For margin calculations, use the sourcing_model to infer COGS ranges automatically.`);

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
    
    contextParts.push(`=== MARKET SNAPSHOT (FOR MARGIN CALCULATIONS) ===
Price Band: ${avgPrice !== null ? `$${avgPrice.toFixed(2)}` : "Not available"}
Representative ASIN: ${representativeAsin}

Use price band as the selling price for margin calculations.`);
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

  // Section 7: Selected Listing/Competitor Context (if provided)
  if (selectedListing && typeof selectedListing === 'object' && selectedListing !== null) {
    try {
      const price = typeof selectedListing.price === 'number' && !isNaN(selectedListing.price) && selectedListing.price !== null && selectedListing.price !== undefined
        ? `$${selectedListing.price.toFixed(2)}`
        : 'Not available';
      const rating = typeof selectedListing.rating === 'number' && !isNaN(selectedListing.rating) && selectedListing.rating !== null && selectedListing.rating !== undefined
        ? selectedListing.rating.toFixed(1)
        : 'Not available';
      const reviews = typeof selectedListing.reviews === 'number' && !isNaN(selectedListing.reviews)
        ? selectedListing.reviews.toLocaleString()
        : 'Not available';
      const bsr = typeof selectedListing.bsr === 'number' && !isNaN(selectedListing.bsr)
        ? `#${selectedListing.bsr.toLocaleString()}`
        : 'Not available';
      
      contextParts.push(`=== SELECTED LISTING (USER CONTEXT) ===
The user has selected this listing from Page 1. Reference it when answering questions.

ASIN: ${selectedListing.asin || 'Not available'}
Title: ${selectedListing.title || 'Not available'}
Price: ${price}
Rating: ${rating}
Reviews: ${reviews}
BSR: ${bsr}
Organic Rank: ${selectedListing.organic_rank !== null && selectedListing.organic_rank !== undefined ? `#${selectedListing.organic_rank}` : 'Not available'}
Fulfillment: ${selectedListing.fulfillment || 'Not available'}
Brand: ${selectedListing.brand || 'Not available'}
Sponsored: ${selectedListing.is_sponsored ? 'Yes' : 'No'}

When the user asks about a specific product or compares products, reference this selected listing's data.`);
    } catch (error) {
      console.error("Error formatting selected listing context:", error);
    }
  }
  

  return contextParts.join("\n\n");
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
          return {
            isValid: false,
            reason: `Forbidden phrase "${match[0]}" used without citation`,
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
    /\bunits per day\b/i,
    /\bunits per month\b/i,
    /\bmonthly sales\b/i,
    /\bdaily sales\b/i,
  ];
  
  for (const pattern of unsupportedMetrics) {
    if (pattern.test(response)) {
      return {
        isValid: false,
        reason: `Unsupported metric referenced: ${pattern.source}`,
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
 * Builds Market Snapshot Summary from cached response.market_snapshot data.
 * NO recomputation - uses only cached values.
 */
function buildMarketSnapshotSummary(
  marketSnapshot: Record<string, unknown> | null
): string {
  if (!marketSnapshot) {
    return "";
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
  
  // Review Moat
  const avgReviews = (marketSnapshot.avg_reviews as number) || null;
  if (avgReviews !== null && typeof avgReviews === 'number' && !isNaN(avgReviews)) {
    parts.push(`- Review Moat: ${avgReviews.toLocaleString()} reviews`);
  }
  
  // Quality Threshold
  const avgRating = (marketSnapshot.avg_rating as number) || null;
  if (avgRating !== null && typeof avgRating === 'number' && !isNaN(avgRating)) {
    parts.push(`- Quality Threshold: ${avgRating.toFixed(1)} rating`);
  }
  
  // Competitive Density
  const totalListings = (marketSnapshot.total_page1_listings as number) || null;
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
    const { data: analysisRun, error: analysisError } = await supabase
      .from("analysis_runs")
      .select("*")
      .eq("id", body.analysisRunId)
      .eq("user_id", user.id) // Security: ensure user owns this analysis
      .single();

    if (analysisError || !analysisRun) {
      return NextResponse.json(
        { ok: false, error: "Analysis not found or access denied" },
        { status: 404, headers: res.headers }
      );
    }

    // 4. Fetch seller profile snapshot
    const { data: sellerProfile, error: profileError } = await supabase
      .from("seller_profiles")
      .select("stage, experience_months, monthly_revenue_range, sourcing_model")
      .eq("id", user.id)
      .single();

    if (profileError || !sellerProfile) {
      return NextResponse.json(
        { ok: false, error: "Seller profile not found" },
        { status: 403, headers: res.headers }
      );
    }

    // 4a. Load or create seller_memory (AI Copilot persistent memory)
    let sellerMemory: SellerMemory;
    try {
      const { data: memoryRow, error: memoryError } = await supabase
        .from("seller_memory")
        .select("memory")
        .eq("user_id", user.id)
        .single();

      if (memoryError || !memoryRow || !memoryRow.memory) {
        // Create default memory
        sellerMemory = createDefaultSellerMemory();
        // Merge with seller profile data
        const profileData = mapSellerProfileToMemory(sellerProfile);
        sellerMemory.seller_profile = {
          ...sellerMemory.seller_profile,
          ...profileData,
        };
        
        // Save to database (don't fail if this fails)
        try {
          await supabase
            .from("seller_memory")
            .insert({
              user_id: user.id,
              memory: sellerMemory,
            });
        } catch (insertError) {
          console.error("Failed to insert seller memory (non-critical):", insertError);
        }
      } else {
        // Validate and use existing memory
        const memory = memoryRow.memory as unknown;
        if (validateSellerMemory(memory)) {
          sellerMemory = memory;
          // Update profile data if it changed
          const profileData = mapSellerProfileToMemory(sellerProfile);
          sellerMemory.seller_profile = {
            ...sellerMemory.seller_profile,
            ...profileData,
          };
        } else {
          // Invalid memory, reset to default
          console.warn("Invalid seller memory structure, resetting to default");
          sellerMemory = createDefaultSellerMemory();
          const profileData = mapSellerProfileToMemory(sellerProfile);
          sellerMemory.seller_profile = {
            ...sellerMemory.seller_profile,
            ...profileData,
          };
        }
      }
    } catch (memoryError) {
      console.error("Error loading/creating seller memory:", memoryError);
      // Fallback to default memory if loading fails
      sellerMemory = createDefaultSellerMemory();
      const profileData = mapSellerProfileToMemory(sellerProfile);
      sellerMemory.seller_profile = {
        ...sellerMemory.seller_profile,
        ...profileData,
      };
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
      const { getSellerMemories, getPendingMemories } = await import("@/lib/ai/sellerMemoryStore");
      const { shouldAskUserToConfirm, formatMemoryForConfirmation } = await import("@/lib/ai/memoryMerge");
      
      // Load confirmed memories
      const memoryRecords = await getSellerMemories(supabase, user.id);
      structuredMemories = memoryRecords.map((m) => ({
        memory_type: m.memory_type,
        key: m.key,
        value: m.value,
      }));
      
      // Load pending memories that should be confirmed
      const pendingMemories = await getPendingMemories(supabase, user.id);
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
    
    // Save updated memory (if changed)
    try {
      const { error: memorySaveError } = await supabase
        .from("seller_memory")
        .upsert({
          user_id: user.id,
          memory: sellerMemory,
        }, {
          onConflict: "user_id",
        });
      
      if (memorySaveError) {
        console.error("Failed to save seller memory:", memorySaveError);
        // Don't fail the request - memory save is not critical
      }
    } catch (memoryError) {
      console.error("Error saving seller memory:", memoryError);
      // Don't fail the request - memory save is not critical
    }

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
        body.selectedListing || null
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

    // Determine analysis mode from input_type
    const analysisMode: 'KEYWORD' = 'KEYWORD'; // All analyses are keyword-only
    
    // 8a. Extract ai_context from analyze contract (if available)
    // The analyze contract stores ai_context in the response
    const aiContext = (analysisResponse.ai_context as Record<string, unknown>) || null;
    
    // If ai_context is not available, fall back to legacy context building
    // But prefer the locked contract structure
    const copilotContext = {
      ai_context: aiContext || analysisResponse, // Fallback to full response if ai_context missing
      seller_memory: sellerMemory,
      structured_memories: structuredMemories, // New structured memory system
      session_context: {
        current_feature: "analyze" as const,
        user_question: body.message,
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
    
    // Log AI reasoning inputs for audit/debugging
    console.log("AI_COPILOT_INPUT", {
      analysisRunId: body.analysisRunId,
      userId: user.id,
      analysisMode,
      hasAiContext: !!aiContext,
      memoryVersion: sellerMemory.version,
      timestamp: new Date().toISOString(),
    });

    // 10. Build message array for OpenAI
    // If refinement validation failed, inject error message for AI to explain
    const validationContext = refinementError 
      ? `\n\nIMPORTANT: The user attempted to refine costs, but validation failed:\n${refinementError}\n\nYou must explain why the input is invalid and do NOT save or process the refinement. Be helpful and suggest valid ranges.`
      : "";

    // 10. Build message array for OpenAI
    // AI Copilot prompt is self-contained with ai_context and seller_memory
    // No need for separate context injection - everything is in the system prompt
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      // System prompt: Contains locked behavior contract + ai_context + seller_memory
      { role: "system", content: systemPrompt },
      // Initial assistant greeting (quiet, data-grounded, not verdict-like)
      // Note: Chat should be quiet by default - no auto messages
      // This greeting is only used in conversation history, not as an auto-message
      { role: "assistant", content: "I have the market data and your seller profile. I can help you understand what the numbers mean, compare products, or explore different scenarios. What would you like to know?" },
    ];
    
    // Add validation context if cost refinement failed
    if (validationContext) {
      messages.push({
        role: "user",
        content: validationContext,
      });
    }

    // 11. Append conversation history from database
    if (priorMessages && priorMessages.length > 0) {
      for (const msg of priorMessages) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
        }
      }
    }

    // 12. Append the new user message
    messages.push({ role: "user", content: body.message });

    // 13. Check for profitability questions (require product-level COGS)
    // ────────────────────────────────────────────────────────────────────────
    const { classifyQuestion } = await import("@/lib/ai/copilotSystemPrompt");
    const questionClassification = classifyQuestion(body.message);
    
    // Check if profitability question requires product-level COGS
    if (questionClassification.category === "PROFITABILITY" && questionClassification.requiresProductLevelCogs) {
      // Check if we have product-level COGS in the data
      // For keyword mode, we typically don't have product-level COGS
      const hasProductLevelCogs = false; // Keyword mode doesn't have product-level COGS
      
      if (!hasProductLevelCogs) {
        // Return mandatory profitability refusal
        const encoder = new TextEncoder();
        const profitabilityRefusal = `We can't determine profitability directly because product-level COGS isn't available.

What we can do is compare revenue potential, price positioning, and competitive pressure.

Would you like me to:
• Compare revenue estimates across listings
• Analyze price positioning relative to competitors
• Discuss competitive pressure indicators`;

        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: profitabilityRefusal })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        // Save to database
        try {
          await supabase.from("analysis_messages").insert([
            {
              analysis_run_id: body.analysisRunId,
              user_id: user.id,
              role: "user",
              content: body.message,
            },
            {
              analysis_run_id: body.analysisRunId,
              user_id: user.id,
              role: "assistant",
              content: profitabilityRefusal,
            },
          ]);
        } catch (saveError) {
          console.error("Failed to save profitability refusal:", saveError);
        }

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            ...Object.fromEntries(res.headers.entries()),
          },
        });
      }
    }

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
          max_tokens: 1500,
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
    const encoder = new TextEncoder();
    let fullAssistantMessage = "";
    
    // Capture pendingMemoriesForConfirmation for use in stream closure
    const pendingMemoriesToShow = pendingMemoriesForConfirmation;

    const stream = new ReadableStream({
      async start(controller) {
        // If margin snapshot was refined, send updated snapshot metadata first
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
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter((line) => line.trim() !== "");

            for (const line of lines) {
              if (line === "data: [DONE]") {
                continue;
              }

              if (line.startsWith("data: ")) {
                try {
                  const json = JSON.parse(line.slice(6));
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    fullAssistantMessage += content;
                    // Send each chunk to the client
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch (parseError) {
                  // Skip malformed JSON chunks - log for debugging
                  console.warn("Skipping malformed JSON chunk:", line.substring(0, 100));
                }
              }
            }
          }
          
          // Ensure reader is released
          if (!readerReleased) {
            reader.releaseLock();
            readerReleased = true;
          }

          // 14. Validate response for forbidden language (TRIPWIRE)
          // ────────────────────────────────────────────────────────────────
          // Scan response for forbidden phrases: confidence scores, verdict language, internal headers
          // ────────────────────────────────────────────────────────────────
          let finalMessage = fullAssistantMessage.trim();
          let tripwireTriggered = false;
          let tripwireReason: string | undefined;
          
          if (finalMessage) {
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
                tripwireReason = `Forbidden phrase detected: ${pattern.source}`;
                
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
            supabase.from("analysis_messages").insert([
              {
                analysis_run_id: body.analysisRunId,
                user_id: user.id,
                role: "user",
                content: body.message,
              },
              {
                analysis_run_id: body.analysisRunId,
                user_id: user.id,
                role: "assistant",
                content: finalMessage,
              },
            ]).then(async (result: any) => {
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
                  const userMessageId = result.data?.[0]?.id || null;
                  
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
            }).catch((saveError) => {
              console.error("Failed to save chat messages:", saveError);
            });
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
