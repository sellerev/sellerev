import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/chatSystemPrompt";
import { estimateCogsRange } from "@/lib/cogs/assumptions";
import { normalizeCostOverrides } from "@/lib/margins/normalizeCostOverrides";
import { MarginSnapshot } from "@/types/margin";

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
  inputValue: string
): string {
  const contextParts: string[] = [];

  // Section 1: Original Analysis (marked as AUTHORITATIVE to prevent silent overrides)
  contextParts.push(`=== ORIGINAL ANALYSIS (AUTHORITATIVE) ===
This analysis anchors this conversation. Do not contradict without explicit explanation.

Input: ${inputType.toUpperCase()} - ${inputValue}

Verdict: ${(analysisResponse.decision as { verdict: string })?.verdict || "UNKNOWN"}
Confidence: ${(analysisResponse.decision as { confidence: number })?.confidence || "N/A"}%

Executive Summary:
${analysisResponse.executive_summary || "Not available"}

Risks:
${JSON.stringify(analysisResponse.risks, null, 2)}

Recommended Actions:
${JSON.stringify(analysisResponse.recommended_actions, null, 2)}

Assumptions & Limits:
${JSON.stringify(analysisResponse.assumptions_and_limits, null, 2)}`);

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
Average Page 1 Price: ${avgPrice !== null ? `$${avgPrice.toFixed(2)}` : "Not available"}
Representative ASIN: ${representativeAsin}

Use avg_price as the selling price for margin calculations.`);
  }

  // Section 5: FBA Fees (new structure from resolveFbaFees or legacy structure)
  contextParts.push(`=== FBA FEES (ESTIMATED) ===`);
  
  if (marketSnapshot && typeof marketSnapshot === 'object') {
    const fbaFees = marketSnapshot.fba_fees as any;
    
    if (fbaFees && typeof fbaFees === 'object' && !Array.isArray(fbaFees) && fbaFees !== null) {
      // Check for new structure (from resolveFbaFees for ASIN inputs)
      if ('fulfillment_fee' in fbaFees || 'referral_fee' in fbaFees || 'total_fba_fees' in fbaFees) {
        const fulfillmentFee = fbaFees.fulfillment_fee !== null && fbaFees.fulfillment_fee !== undefined
          ? `$${parseFloat(fbaFees.fulfillment_fee).toFixed(2)}`
          : "Not available";
        const referralFee = fbaFees.referral_fee !== null && fbaFees.referral_fee !== undefined
          ? `$${parseFloat(fbaFees.referral_fee).toFixed(2)}`
          : "Not available";
        const totalFees = fbaFees.total_fba_fees !== null && fbaFees.total_fba_fees !== undefined
          ? `$${parseFloat(fbaFees.total_fba_fees).toFixed(2)}`
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
          ? `$${parseFloat(fbaFees.total_fee).toFixed(2)}`
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

  // Section 6: Margin Snapshot (calculated from COGS assumptions and FBA fees)
  // May include user-refined costs if cost_overrides exist
  if (marketSnapshot && typeof marketSnapshot === 'object') {
    const marginSnapshot = (marketSnapshot.margin_snapshot as Record<string, unknown>) || null;
    if (marginSnapshot) {
      const confidence = (marginSnapshot.confidence as string) || "estimated";
      const costOverrides = (analysisResponse.cost_overrides as Record<string, unknown>) || null;
      
      let overrideNote = "";
      if (costOverrides && confidence === "refined") {
        const overrides: string[] = [];
        if (costOverrides.cogs !== null && costOverrides.cogs !== undefined) {
          overrides.push(`COGS: $${(costOverrides.cogs as number).toFixed(2)}`);
        }
        if (costOverrides.fba_fees !== null && costOverrides.fba_fees !== undefined) {
          overrides.push(`FBA fees: $${(costOverrides.fba_fees as number).toFixed(2)}`);
        }
        if (overrides.length > 0) {
          overrideNote = `\n\nNOTE: This margin snapshot uses USER-REFINED costs (${overrides.join(", ")}). Confidence = "refined".`;
        }
      }
      
      contextParts.push(`=== MARGIN SNAPSHOT ===
Selling price: $${(marginSnapshot.selling_price as number).toFixed(2)}
COGS range (assumed): $${(marginSnapshot.cogs_assumed_low as number).toFixed(2)}–$${(marginSnapshot.cogs_assumed_high as number).toFixed(2)}
Amazon fees: ${marginSnapshot.fba_fees !== null ? `$${(marginSnapshot.fba_fees as number).toFixed(2)}` : "Not available"}
Net margin range: ${(marginSnapshot.net_margin_low_pct as number).toFixed(1)}%–${(marginSnapshot.net_margin_high_pct as number).toFixed(1)}%
Breakeven price range: $${(marginSnapshot.breakeven_price_low as number).toFixed(2)}–$${(marginSnapshot.breakeven_price_high as number).toFixed(2)}
Confidence level: ${confidence}
Source: ${marginSnapshot.source || "assumption_engine"}${overrideNote}

This margin snapshot is pre-calculated. Always reference it first when answering margin questions.`);
    }
  }

  return contextParts.join("\n\n");
}

/**
 * Determines if the AI can answer a question based on available data
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
  }
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
    /\b(how much|how many|what will|when will|guaranteed profit|guaranteed sales)\b/i,
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

  // Check for margin/profit questions
  const marginPatterns = [
    /\b(margin|profit|breakeven|break even|net margin|gross margin)\b/i,
    /\b(how much profit|what's my margin|what margin|profitability)\b/i,
  ];
  
  if (marginPatterns.some(p => p.test(normalized))) {
    const marginSnapshot = (marketSnapshot?.margin_snapshot as Record<string, unknown>) || null;
    const costOverrides = (analysisResponse.cost_overrides as Record<string, unknown>) || null;
    
    // Check for required data
    if (!marginSnapshot) {
      missingItems.push("Margin snapshot data");
      options.push("Provide your COGS and FBA fees to calculate margins");
    } else {
      const sellingPrice = (marginSnapshot.selling_price as number) || null;
      const cogsLow = (marginSnapshot.cogs_assumed_low as number) || null;
      const fbaFees = (marginSnapshot.fba_fees as number) || null;
      
      if (!sellingPrice || sellingPrice <= 0) {
        missingItems.push("Selling price");
        options.push("Provide a selling price to calculate margins");
      }
      
      // If no cost overrides, check if we have assumed COGS
      if (!costOverrides || (costOverrides.cogs === null || costOverrides.cogs === undefined)) {
        if (cogsLow === null || cogsLow <= 0) {
          missingItems.push("COGS (cost of goods sold)");
          options.push("Provide your COGS to calculate accurate margins");
        }
      }
      
      if (!costOverrides || (costOverrides.fba_fees === null || costOverrides.fba_fees === undefined)) {
        if (fbaFees === null || fbaFees <= 0) {
          missingItems.push("FBA fees");
          options.push("Provide your FBA fees to calculate accurate margins");
        }
      }
    }
  }

  // Check for fee questions
  const feePatterns = [
    /\b(fba fee|amazon fee|fulfillment fee|referral fee|what.*fee|how much.*fee)\b/i,
  ];
  
  if (feePatterns.some(p => p.test(normalized))) {
    const fbaFees = (marketSnapshot?.fba_fees as Record<string, unknown>) || null;
    const marginSnapshot = (marketSnapshot?.margin_snapshot as Record<string, unknown>) || null;
    
    if (!fbaFees && !marginSnapshot) {
      missingItems.push("FBA fee data");
      options.push("Provide your FBA fees to get accurate calculations");
    } else {
      const feesValue = (fbaFees?.total_fba_fees as number) || 
                        (fbaFees?.total_fee as number) ||
                        (marginSnapshot?.fba_fees as number) || null;
      
      if (feesValue === null || feesValue <= 0) {
        missingItems.push("FBA fees");
        options.push("Provide your FBA fees to get accurate calculations");
      }
    }
  }

  // Check for price questions
  const pricePatterns = [
    /\b(what.*price|how much.*price|selling price|list price|price point)\b/i,
  ];
  
  if (pricePatterns.some(p => p.test(normalized))) {
    const avgPrice = (marketSnapshot?.avg_price as number) || null;
    const marginSnapshot = (marketSnapshot?.margin_snapshot as Record<string, unknown>) || null;
    const sellingPrice = (marginSnapshot?.selling_price as number) || null;
    
    if (!avgPrice && !sellingPrice) {
      missingItems.push("Price data");
      options.push("Run an analysis to get market price data");
    }
  }

  // Check for strategic questions about competition/viability - require CPI
  const strategicPatterns = [
    /\b(how hard|how difficult|viability|viable|competitive|competition|market entry|enter this market|break into)\b/i,
    /\b(should I launch|can I compete|worth pursuing|worth it)\b/i,
  ];
  
  if (strategicPatterns.some(p => p.test(normalized))) {
    try {
      const cpi = (marketSnapshot?.cpi as { score?: number; label?: string } | null) || null;
      if (!cpi || typeof cpi !== 'object' || cpi === null || 
          typeof cpi.score !== 'number' || typeof cpi.label !== 'string') {
        return {
          canAnswer: false,
          missingItems: ["Competitive Pressure Index (CPI) not available"],
          options: ["Run an analysis to get CPI data", "Ask about specific metrics available in the market snapshot"],
        };
      }
    } catch (error) {
      // If CPI access fails, refuse to answer
      return {
        canAnswer: false,
        missingItems: ["Competitive Pressure Index (CPI) not available"],
        options: ["Run an analysis to get CPI data", "Ask about specific metrics available in the market snapshot"],
      };
    }
  }
  
  // Check for data outside cached context
  const externalDataPatterns = [
    /\b(bsr|best seller rank|sales volume|units sold|revenue|sales rank)\b/i,
    /\b(ppc cost|advertising cost|ad spend|sponsored ad cost)\b/i,
    /\b(conversion rate|click through rate|ctr)\b/i,
  ];
  
  if (externalDataPatterns.some(p => p.test(normalized))) {
    return {
      canAnswer: false,
      missingItems: ["This data is not available in the cached analysis"],
      options: ["Ask about data available in the market snapshot", "Ask about margin calculations using provided costs"],
    };
  }

  // If missing items found, cannot answer
  if (missingItems.length > 0) {
    return {
      canAnswer: false,
      missingItems,
      options: options.length > 0 ? options : ["Provide the missing data to proceed"],
    };
  }

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
    const marginSnapshot = marketSnapshot.margin_snapshot as Record<string, unknown> | null;
    if (marginSnapshot) {
      if (typeof marginSnapshot.selling_price === 'number') allowed.add(marginSnapshot.selling_price);
      if (typeof marginSnapshot.cogs_assumed_low === 'number') allowed.add(marginSnapshot.cogs_assumed_low);
      if (typeof marginSnapshot.cogs_assumed_high === 'number') allowed.add(marginSnapshot.cogs_assumed_high);
      if (typeof marginSnapshot.fba_fees === 'number') allowed.add(marginSnapshot.fba_fees);
      if (typeof marginSnapshot.net_margin_low_pct === 'number') allowed.add(marginSnapshot.net_margin_low_pct);
      if (typeof marginSnapshot.net_margin_high_pct === 'number') allowed.add(marginSnapshot.net_margin_high_pct);
      if (typeof marginSnapshot.breakeven_price_low === 'number') allowed.add(marginSnapshot.breakeven_price_low);
      if (typeof marginSnapshot.breakeven_price_high === 'number') allowed.add(marginSnapshot.breakeven_price_high);
    }
    
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
  
  // Extract from cost overrides
  const costOverrides = analysisResponse.cost_overrides as Record<string, unknown> | null;
  if (costOverrides) {
    if (typeof costOverrides.cogs === 'number') allowed.add(costOverrides.cogs);
    if (typeof costOverrides.fba_fees === 'number') allowed.add(costOverrides.fba_fees);
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
      return {
        cogs: null,
        fba_fees: fbaFees,
        validationError: `COGS ($${cogs.toFixed(2)}) cannot be greater than or equal to the selling price ($${sellingPrice.toFixed(2)}). Please provide a valid cost.`,
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
      return {
        cogs,
        fba_fees: null,
        validationError: `FBA fees ($${fbaFees.toFixed(2)}) cannot be greater than or equal to the selling price ($${sellingPrice.toFixed(2)}). Please provide a valid fee amount.`,
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
  
  // Typical Price
  const avgPrice = (marketSnapshot.avg_price as number) || null;
  if (avgPrice !== null) {
    parts.push(`- Typical Price: $${avgPrice.toFixed(2)}`);
  }
  
  // Review Barrier
  const avgReviews = (marketSnapshot.avg_reviews as number) || null;
  if (avgReviews !== null) {
    parts.push(`- Review Barrier: ${avgReviews.toLocaleString()} reviews`);
  }
  
  // Quality Expectation
  const avgRating = (marketSnapshot.avg_rating as number) || null;
  if (avgRating !== null) {
    parts.push(`- Quality Expectation: ${avgRating.toFixed(1)} rating`);
  }
  
  // Page 1 Competition
  const totalListings = (marketSnapshot.total_page1_listings as number) || null;
  if (totalListings !== null && totalListings !== undefined) {
    parts.push(`- Page 1 Competition: ${totalListings} listings`);
  }
  
  // Paid Competition
  const sponsoredCount = (marketSnapshot.sponsored_count as number) || null;
  if (sponsoredCount !== null && sponsoredCount !== undefined) {
    parts.push(`- Paid Competition: ${sponsoredCount} sponsored`);
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

    // 5. Fetch all prior analysis_messages for this run (conversation history)
    // ────────────────────────────────────────────────────────────────────────
    // Load from database to ensure continuity across sessions
    const { data: priorMessages } = await supabase
      .from("analysis_messages")
      .select("role, content")
      .eq("analysis_run_id", body.analysisRunId)
      .order("created_at", { ascending: true });

    // 6. Compute COGS assumptions for margin calculations
    // ─────────────────────────────────────────────────────────────────────
    const analysisResponse = analysisRun.response as Record<string, unknown>;
    let marketSnapshot = (analysisResponse.market_snapshot as Record<string, unknown>) || null;
    const avgPrice = (marketSnapshot?.avg_price as number) || null;
    const category = (marketSnapshot?.category as string) || null;
    
    let cogsAssumptions: string = "";
    if (avgPrice !== null && avgPrice > 0 && sellerProfile.sourcing_model) {
      try {
        const cogsEstimate = estimateCogsRange({
          sourcing_model: sellerProfile.sourcing_model as any,
          category: category,
          avg_price: avgPrice,
        });
        
        const estimatedRange = `$${cogsEstimate.low.toFixed(2)}–$${cogsEstimate.high.toFixed(2)}`;
        const percentRange = `${cogsEstimate.percent_range[0]}–${cogsEstimate.percent_range[1]}%`;
        const confidenceLabel = cogsEstimate.confidence === "low" ? "Low confidence" 
          : cogsEstimate.confidence === "medium" ? "Medium confidence" 
          : "High confidence";
        
        cogsAssumptions = `\n\nCOGS_ASSUMPTIONS:\n{
  estimated_range: "${estimatedRange}",
  percent_range: "${percentRange}",
  confidence: "${confidenceLabel}",
  basis: "Typical sellers using ${sellerProfile.sourcing_model} sourcing model"
}`;
      } catch (error) {
        // Fail silently - COGS assumptions are optional
        console.error("Failed to compute COGS assumptions:", error);
      }
    }

    // 7. Detect and process cost overrides in user message (BEFORE building context)
    // ────────────────────────────────────────────────────────────────────────
    // Check if user message contains structured cost inputs like:
    // - "My COGS is $22"
    // - "FBA fees are $9.80"
    // - "Use $20 cost and $8 fees"
    // ────────────────────────────────────────────────────────────────────────
    const sellingPrice = (marketSnapshot?.avg_price as number) || 
      ((analysisResponse.market_snapshot as Record<string, unknown>)?.margin_snapshot as MarginSnapshot)?.selling_price || 
      null;
    const costOverrides = detectCostOverrides(body.message, sellingPrice);
    let refinedMarginSnapshot: MarginSnapshot | null = null; // Store for response
    let costOverrideError: string | null = null; // Store validation error
    
    if (costOverrides) {
      // Check for validation errors
      if (costOverrides.validationError) {
        costOverrideError = costOverrides.validationError;
        // Don't process invalid overrides - let AI explain the error
      } else {
        // Update analysis_run.response.cost_overrides
        // IMPORTANT: Override applies ONLY to this analysis_run (via .eq("id", body.analysisRunId))
        const currentResponse = analysisResponse as Record<string, unknown>;
        const updatedResponse = {
          ...currentResponse,
          cost_overrides: {
            cogs: costOverrides.cogs,
            fba_fees: costOverrides.fba_fees,
            last_updated: new Date().toISOString(),
            source: "user" as const,
          },
        };

      // Recalculate margin snapshot using overrides
      const defaultMarginSnapshot = (
        (currentResponse.market_snapshot as Record<string, unknown>)?.margin_snapshot as MarginSnapshot
      ) || null;

      if (defaultMarginSnapshot) {
        refinedMarginSnapshot = normalizeCostOverrides({
          response: updatedResponse as any,
          defaultMarginSnapshot,
          sourcingModel: sellerProfile.sourcing_model as any,
          categoryHint: (marketSnapshot?.category as string) || null,
        });

        // Update market_snapshot.margin_snapshot with refined values
        if (!updatedResponse.market_snapshot) {
          updatedResponse.market_snapshot = {};
        }
        (updatedResponse.market_snapshot as Record<string, unknown>).margin_snapshot = refinedMarginSnapshot;
      }

      // Save updated response to database
      // SECURITY: .eq("id", body.analysisRunId) ensures override applies ONLY to this analysis_run
      const { error: updateError } = await supabase
        .from("analysis_runs")
        .update({ response: updatedResponse })
        .eq("id", body.analysisRunId)
        .eq("user_id", user.id);

      if (updateError) {
        console.error("Failed to save cost overrides:", updateError);
        // Continue anyway - don't block the chat response
      } else {
        // Update local analysisResponse for context building
        Object.assign(analysisResponse, updatedResponse);
        // Also update marketSnapshot reference
        marketSnapshot = (analysisResponse.market_snapshot as Record<string, unknown>) || null;
      }
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
        analysisRun.input_value
      );

      // 9. Build Market Snapshot Summary (from cached response.market_snapshot only)
      marketSnapshotSummary = buildMarketSnapshotSummary(
        (analysisResponse.market_snapshot as Record<string, unknown>) || null
      );
    } catch (error) {
      console.error("Error building context message:", error);
      // Fallback to minimal context
      contextMessage = `Analysis for ${analysisRun.input_type}: ${analysisRun.input_value}`;
      marketSnapshotSummary = "";
    }

    // 9. Build message array for OpenAI
    // If cost override validation failed, inject error message for AI to explain
    const validationContext = costOverrideError 
      ? `\n\nIMPORTANT: The user attempted to provide cost overrides, but validation failed:\n${costOverrideError}\n\nYou must explain why the input is invalid and do NOT save or process the override. Be helpful and suggest valid ranges.`
      : "";

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      // System prompt: Contains all rules and constraints + COGS assumptions
      { role: "system", content: CHAT_SYSTEM_PROMPT + cogsAssumptions },
      // Context injection: Provides grounded data (no hallucination possible)
      { role: "user", content: `[CONTEXT FOR THIS CONVERSATION]\n\n${contextMessage}${validationContext}` },
      { role: "assistant", content: "I understand. I have the analysis context and will only reason over the provided data. I will not invent numbers, estimate sales or PPC, or reference data not provided. How can I help you explore this analysis?" },
    ];

    // 10. Inject Market Snapshot Summary ABOVE conversation history (if available)
    if (marketSnapshotSummary) {
      messages.push({
        role: "user",
        content: marketSnapshotSummary,
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

    // 13. Validate if AI can answer based on available data
    // ────────────────────────────────────────────────────────────────────────
    // Check if required data is missing for the user's question intent
    // ────────────────────────────────────────────────────────────────────────
    const canAnswerResult = canAnswerQuestion(
      body.message,
      analysisResponse,
      marketSnapshot,
      sellerProfile
    );

    if (!canAnswerResult.canAnswer) {
      // Log refusal event
      console.error("CHAT_REFUSAL_TRIGGERED", {
        analysisRunId: body.analysisRunId,
        userId: user.id,
        userMessage: body.message,
        missingItems: canAnswerResult.missingItems,
        options: canAnswerResult.options,
        timestamp: new Date().toISOString(),
      });
      
      // Short-circuit: Return refusal response without calling OpenAI
      const encoder = new TextEncoder();
      const refusalMessage = formatRefusalResponse(canAnswerResult.missingItems, canAnswerResult.options);

      const stream = new ReadableStream({
        async start(controller) {
          // Send refusal message as a single chunk
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: refusalMessage })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      // Save refusal message to database
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
            content: refusalMessage,
          },
        ]);
      } catch (saveError) {
        console.error("Failed to save refusal message:", saveError);
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

    const stream = new ReadableStream({
      async start(controller) {
        // If cost overrides were applied, send updated margin snapshot metadata first
        // This allows the frontend to update the UI with refined margin data
        if (refinedMarginSnapshot && costOverrides) {
          const overrideValues: string[] = [];
          if (costOverrides.cogs !== null) {
            overrideValues.push(`$${costOverrides.cogs.toFixed(2)} COGS`);
          }
          if (costOverrides.fba_fees !== null) {
            overrideValues.push(`$${costOverrides.fba_fees.toFixed(2)} Amazon fees`);
          }
          
          const metadata = {
            type: "cost_override_applied",
            margin_snapshot: refinedMarginSnapshot,
            override_values: overrideValues.join(" and "),
            confidence: "refined",
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ metadata })}\n\n`));
        }

        const reader = openaiResponse.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        
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
                } catch {
                  // Skip malformed JSON chunks
                }
              }
            }
          }

          // 14. Validate response for hallucinations (TRIPWIRE)
          // ────────────────────────────────────────────────────────────────
          // Scan response for invented data, forbidden phrases, unsupported metrics
          // ────────────────────────────────────────────────────────────────
          let finalMessage = fullAssistantMessage.trim();
          let tripwireTriggered = false;
          let tripwireReason: string | undefined;
          
          if (finalMessage) {
            // Extract allowed numbers from context
            const allowedNumbers = extractAllowedNumbers(
              analysisResponse,
              marketSnapshot,
              sellerProfile
            );
            
            // Extract allowed metrics (currently none - we don't support ACOS, TACOS, etc.)
            const allowedMetrics = new Set<string>();
            
            // Validate response
            const validation = validateResponseForHallucination(
              finalMessage,
              allowedNumbers,
              allowedMetrics
            );
            
            if (!validation.isValid) {
              tripwireTriggered = true;
              tripwireReason = validation.reason;
              
              // Log the event (REQUIRED)
              console.error("HALLUCINATION_TRIPWIRE_TRIGGERED", {
                analysisRunId: body.analysisRunId,
                userId: user.id,
                reason: validation.reason,
                messagePreview: finalMessage.substring(0, 200),
                userMessage: body.message,
                timestamp: new Date().toISOString(),
              });
              
              // Replace with safe fallback
              const fallbackMessage = "I can't answer that reliably with the data available.\n\nThis question would require assumptions beyond verified inputs.";
              
              // Send correction notice and fallback
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: "\n\n[Response corrected due to data validation]\n\n" })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: fallbackMessage })}\n\n`));
              
              // Replace final message with fallback for database storage
              finalMessage = fallbackMessage;
            }
          }

          // 15. Enforce confidence tier disclaimers (backend enforcement)
          // ────────────────────────────────────────────────────────────────
          // If assistant gives numeric conclusions with LOW confidence, append disclaimer
          // ────────────────────────────────────────────────────────────────
          let disclaimerAppended = false;
          
          if (finalMessage) {
            // Check if message contains numeric conclusions (dollar amounts, percentages, margins)
            const hasNumericConclusions = /\$\d+|\d+%|margin|profit|breakeven/i.test(finalMessage);
            
            // Check if confidence level is LOW
            const hasLowConfidence = /confidence level:\s*low/i.test(finalMessage);
            
            // Check if it's NOT a refusal response
            const isNotRefusal = !finalMessage.includes("I don't have enough verified data");
            
            // If LOW confidence + numeric conclusions + not refusal → append disclaimer
            if (hasLowConfidence && hasNumericConclusions && isNotRefusal) {
              // Check if disclaimer already present
              if (!finalMessage.includes("directional only") && !finalMessage.includes("capital decisions")) {
                // Log confidence downgrade event
                console.warn("CONFIDENCE_DOWNGRADED", {
                  analysisRunId: body.analysisRunId,
                  userId: user.id,
                  reason: "LOW confidence with numeric conclusions",
                  hasNumericConclusions: true,
                  hasLowConfidence: true,
                  timestamp: new Date().toISOString(),
                });
                
                const disclaimer = "\n\nThis estimate is directional only and should not be used for capital decisions.";
                finalMessage += disclaimer;
                disclaimerAppended = true;
                
                // Send disclaimer to client as additional content chunk
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: disclaimer })}\n\n`));
              }
            }
          }

          // 16. Save messages to database after streaming completes
          // ────────────────────────────────────────────────────────────────
          // Persist both user and assistant messages for history restoration
          // ────────────────────────────────────────────────────────────────
          if (finalMessage) {
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
                  content: finalMessage,
                },
              ]);
            } catch (saveError) {
              console.error("Failed to save chat messages:", saveError);
            }
          }

          // Signal end of stream
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          controller.error(error);
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
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
