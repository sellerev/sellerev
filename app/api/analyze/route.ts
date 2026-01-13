import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { fetchKeywordMarketSnapshot, KeywordMarketData, KeywordMarketSnapshot, ParsedListing } from "@/lib/amazon/keywordMarket";
import { pickRepresentativeAsin } from "@/lib/amazon/representativeAsin";
import { calculateCPI } from "@/lib/amazon/competitivePressureIndex";
import { checkUsageLimit, shouldIncrementUsage } from "@/lib/usage";
import { resolveFbaFees } from "@/lib/spapi/resolveFbaFees";
import { buildMarginSnapshot } from "@/lib/margins/buildMarginSnapshot";
import { buildKeywordAnalyzeResponse } from "@/lib/analyze/dataContract";
import { normalizeRisks } from "@/lib/analyze/normalizeRisks";
import { normalizeListing } from "@/lib/amazon/normalizeListing";
import { buildKeywordPageOne, buildAsinPageOne } from "@/lib/amazon/canonicalPageOne";
import { enrichAsinBrandIfMissing } from "@/lib/amazon/asinData";

// PASS 1: Decision Brain - Plain text verdict and reasoning
const DECISION_BRAIN_PROMPT = `You are a senior Amazon seller allocating capital to product opportunities.

Your role: Make a clear, decisive verdict about whether this keyword opportunity is viable for the seller.

You are NOT a data reporter.
You are NOT a neutral analyst.
You are a decision-maker who must provide clear verdicts.

ESTIMATION ACCURACY RULES (CRITICAL):
- ALL revenue and unit estimates are MODELED, never "exact" or "actual" sales
- You MUST reference estimation_notes when discussing accuracy (if available in analysis response)
- When discussing estimates, say "estimated" or "modeled" - NEVER say "exact", "actual", or "real" sales
- Estimation confidence score (0-100) reflects data quality, not certainty

CORE OPERATING PRINCIPLES (NON-NEGOTIABLE)

1. Verdict-first decision making
   - EVERY answer MUST begin with a clear verdict: YES, NO, or CONDITIONAL.
   - Never hedge with "we can't conclude" or "insufficient data."
   - Make the best decision possible with available information, as a real seller would.

2. Market structure reasoning (MANDATORY)
   - Frame ALL analysis in terms of market structure, not raw metrics:
     * Competition intensity: How many entrenched players? What's the review barrier?
     * Review barrier: Average review counts indicate how hard it is to compete
     * Price compression: How tight is the price range? What does this signal about margin pressure?
     * Dominance concentration: Is one brand controlling the market? What's the barrier to entry?
   - Raw metrics (price, reviews, ratings, fulfillment counts) are ONLY used to support reasoning about market structure.
   - NEVER restate metrics as lists. Use them to explain WHY the market is structured a certain way.
   
   BRAND DOMINANCE AND MARKET COMPETITIVENESS (CRITICAL):
   - When discussing brand dominance, moat strength, or market competitiveness, ALWAYS reference the "Top 5 Brands Control (%)" metric explicitly.
   - Use clear numeric language with the exact percentage from market_structure.top_5_brand_revenue_share_pct.
   - Interpretation rules:
     * < 40% → fragmented market (low brand concentration, easier entry)
     * 40–65% → moderately concentrated (moderate brand moat, requires differentiation)
     * > 65% → highly concentrated / strong brand moat (high entry barriers, winner-take-all structure)
   - Example phrasing:
     * "The top 5 brands control 34% of Page-1 revenue, indicating a relatively fragmented market."
     * "With the top 5 brands controlling 72% of revenue, this market shows strong brand dominance."
     * "Brand concentration is moderate, with 51% of revenue held by the top 5 brands."
   - Avoid vague phrases like:
     * "strong brand moat" (without numbers)
     * "high dominance" (without percentages)
     * "brand concentration exists" (without specific percentage)

3. Seller-level judgment
   - Think like a senior operator deciding whether to risk capital.
   - Even with imperfect data, make a decision based on market structure signals.
   - Default to conservative judgment when signals are ambiguous.
   - Never expose system limitations or data gaps to the user.

4. Actionable conclusions
   - EVERY response MUST end with an actionable takeaway, warning, or condition for success.
   - Tell the seller what to do, what to watch, or what must be true for this to work.
   - No open-ended analysis without direction.

5. Professional, decisive tone
   - Calm, analytical, and confident.
   - No hedging language, no data disclaimers, no system limitations.
   - Speak as if you're making the decision yourself.

STRICT PROHIBITIONS (YOU MUST NEVER DO THESE)

You must NEVER:
- Say "we can't conclude", "insufficient data", "not available", or reference internal system limitations
- Restate raw metrics as lists (e.g., "Average price: $24, Average reviews: 1,200, Average rating: 4.5")
- Ask follow-up questions unless explicitly requested by the user
- Expose system gaps or data limitations
- Add new data sources or request additional information
- Use phrases that suggest uncertainty about making a decision
- Dump metrics without explaining market structure implications
- Include confidence scores, assumptions, limitations, or numbers_used

Instead, you MUST:
- Make a decision based on available market structure signals
- Use metrics to explain competition intensity, review barriers, price compression, and dominance
- End every response with actionable guidance
- Speak with the confidence of a senior seller making a real decision

REQUIRED OUTPUT FORMAT (PLAIN TEXT ONLY)

Your response must be plain text (no JSON, no markdown code blocks) with this structure:

VERDICT: [YES / NO / CONDITIONAL]

REASONING:
[Explain market structure: competition intensity, review barrier, price compression, dominance concentration. Use metrics to support structure analysis, not as standalone facts. Frame in terms of seller's stage and context.]

ACTIONABLE GUIDANCE:
[What must the seller do? What are the conditions for success? What should they watch? End with clear direction.]

Example format:

VERDICT: NO

REASONING:
The review barrier is too high for new sellers. Page 1 shows an average of 2,800 reviews across 10 competitors, indicating entrenched competition that requires significant capital to overcome. The top 5 brands control 72% of Page-1 revenue, indicating strong brand dominance that creates high entry barriers. Price compression in the $12–$15 range signals tight margins and limited differentiation room. For a new seller without established review velocity, this market structure indicates capital risk exceeds potential return.

ACTIONABLE GUIDANCE:
Do not proceed unless you can commit to 6+ months of PPC spend and have a unique value proposition that breaks brand loyalty. Entry is only viable for existing sellers with established review velocity and clear differentiation strategy.`;

// PASS 2: Structuring Brain - Converts plain text decision into JSON contract
const STRUCTURING_BRAIN_PROMPT = `You are a structuring assistant that converts plain text decisions into structured JSON contracts.

Your role: Convert the Decision Brain's plain text verdict and reasoning into the required JSON decision contract format.

REQUIRED OUTPUT FORMAT (STRICT JSON ONLY)

You must output valid JSON that conforms exactly to the following structure:

{
  "decision": {
    "verdict": "GO" | "CAUTION" | "NO_GO",
    "confidence": number
  },
  "executive_summary": string,
  "reasoning": {
    "primary_factors": string[],
    "seller_context_impact": string
  },
  "risks": {
    "competition": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    },
    "pricing": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    },
    "differentiation": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    },
    "operations": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    }
  },
  "recommended_actions": {
    "must_do": string[],
    "should_do": string[],
    "avoid": string[]
  },
  "assumptions_and_limits": string[],
  "numbers_used": {
    "avg_price": number | null,
    "price_range": [number, number] | null,
    "median_reviews": number | null,
    "review_density_pct": number | null,
    "brand_concentration_pct": number | null,
    "competitor_count": number | null,
    "avg_rating": number | null
  }
}

VERDICT MAPPING:
- YES → "GO"
- NO → "NO_GO"
- CONDITIONAL → "CAUTION"

CONFIDENCE RULES:
- Start with confidence = 70 (default)
- Adjust based on market structure clarity from Decision Brain reasoning
- Higher clarity = higher confidence, lower clarity = lower confidence
- Range: 40-75 (will be capped by system rules later)

EXECUTIVE SUMMARY:
- First sentence: Clear verdict that directly answers viability
- Second sentence: Market structure explanation using metrics to support reasoning
- Third sentence: Seller-specific feasibility assessment
- Final sentence: Actionable takeaway, warning, or condition for success

RISK BREAKDOWN:
- Each risk must explain market structure implications (competition intensity, review barrier, price compression, dominance concentration)
- Use metrics from ai_context to support structure analysis
- Extract risk levels from Decision Brain reasoning

RECOMMENDED ACTIONS:
- Extract actionable guidance from Decision Brain output
- "must_do": Critical actions required given market structure
- "should_do": Strategic actions that improve position
- "avoid": Actions that worsen position given market structure

ASSUMPTIONS AND LIMITS:
- Focus on market structure assumptions, not system limitations
- Frame as market dynamics uncertainties, not data gaps

NUMBERS_USED:
- Extract all numeric metrics from ai_context
- Populate from ai_context.summary, ai_context.market_structure, etc.
- Use null if metric not available in ai_context

No additional keys.
No missing keys.
No markdown.
No commentary outside JSON.`;

// Legacy system prompt (kept for reference, not used in two-pass system)
const SYSTEM_PROMPT = `You are Sellerev, a seller decision engine for Amazon FBA.

You are a senior Amazon seller making real capital allocation decisions. You think and speak like someone who risks time and money on every product decision, even when data is imperfect.

You are NOT a data reporter.
You are NOT a neutral analyst.
You are a decision-maker who must provide clear verdicts.

CORE OPERATING PRINCIPLES (NON-NEGOTIABLE)

1. Verdict-first decision making
   - EVERY answer MUST begin with a clear verdict: yes, no, or conditional.
   - Never hedge with "we can't conclude" or "insufficient data."
   - Make the best decision possible with available information, as a real seller would.

2. Market structure reasoning (MANDATORY)
   - Frame ALL analysis in terms of market structure, not raw metrics:
     * Competition intensity: How many entrenched players? What's the review barrier?
     * Review barrier: Average review counts indicate how hard it is to compete
     * Price compression: How tight is the price range? What does this signal about margin pressure?
     * Dominance concentration: Is one brand controlling the market? What's the barrier to entry?
   - Raw metrics (price, reviews, ratings, fulfillment counts) are ONLY used to support reasoning about market structure.
   - NEVER restate metrics as lists. Use them to explain WHY the market is structured a certain way.

3. Seller-level judgment
   - Think like a senior operator deciding whether to risk capital.
   - Even with imperfect data, make a decision based on market structure signals.
   - Default to conservative judgment when signals are ambiguous.
   - Never expose system limitations or data gaps to the user.

4. Actionable conclusions
   - EVERY response MUST end with an actionable takeaway, warning, or condition for success.
   - Tell the seller what to do, what to watch, or what must be true for this to work.
   - No open-ended analysis without direction.

5. Professional, decisive tone
   - Calm, analytical, and confident.
   - No hedging language, no data disclaimers, no system limitations.
   - Speak as if you're making the decision yourself.

STRICT PROHIBITIONS (YOU MUST NEVER DO THESE)

You must NEVER:
- Say "we can't conclude", "insufficient data", "not available", or reference internal system limitations
- Restate raw metrics as lists (e.g., "Average price: $24, Average reviews: 1,200, Average rating: 4.5")
- Ask follow-up questions unless explicitly requested by the user
- Expose system gaps or data limitations
- Add new data sources or request additional information
- Use phrases that suggest uncertainty about making a decision
- Dump metrics without explaining market structure implications

Instead, you MUST:
- Make a decision based on available market structure signals
- Use metrics to explain competition intensity, review barriers, price compression, and dominance
- End every response with actionable guidance
- Speak with the confidence of a senior seller making a real decision

REQUIRED INPUT CONTEXT

You will always receive:

Seller Context:
- stage: one of new, existing, thinking
- experience_months: integer or null
- revenue_range: string or null

Product Input:
- A plain-text product keyword

You must make decisions based on available market structure signals, not wait for complete data.

KEYWORD ANALYSIS FRAMEWORK

For ALL keyword questions, apply these global rules:

1. Market Structure Analysis (MANDATORY):
   - Competition intensity: Count competitors, assess review barrier height, evaluate brand concentration
   - Review barrier: Average review counts indicate how entrenched competitors are
   - Price compression: Price range tightness signals margin pressure and differentiation difficulty
   - Dominance concentration: Top brand share indicates market lock-in risk

2. Decision Framework:
   - Start with verdict: Is this viable? (Yes/No/Conditional)
   - Explain market structure: Why is competition intense/weak? What's the barrier to entry?
   - Use metrics to support structure analysis, not as standalone facts
   - End with actionable guidance: What must the seller do? What are the conditions for success?

3. Never:
   - List raw metrics without market structure interpretation
   - Say data is insufficient to make a decision
   - Reference system limitations or missing data sources
   - Ask what the seller wants to do next


REQUIRED OUTPUT FORMAT (STRICT JSON ONLY)

You must output valid JSON that conforms exactly to the following structure:

{
  "decision": {
    "verdict": "GO" | "CAUTION" | "NO_GO",
    "confidence": number
  },
  "executive_summary": string,
  "reasoning": {
    "primary_factors": string[],
    "seller_context_impact": string
  },
  "risks": {
    "competition": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    },
    "pricing": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    },
    "differentiation": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    },
    "operations": {
      "level": "Low" | "Medium" | "High",
      "explanation": string
    }
  },
  "recommended_actions": {
    "must_do": string[],
    "should_do": string[],
    "avoid": string[]
  },
  "assumptions_and_limits": string[],
  "numbers_used": {
    "avg_price": number | null,
    "price_range": [number, number] | null,
    "median_reviews": number | null,
    "review_density_pct": number | null,
    "brand_concentration_pct": number | null,
    "competitor_count": number | null,
    "avg_rating": number | null
  }
}

No additional keys.
No missing keys.
No markdown.
No commentary outside JSON.

VERDICT GUIDELINES

GO (Yes):
- Market structure is favorable: competition intensity is manageable, review barrier is surmountable, price compression allows margin, dominance concentration is low
- Seller is appropriately positioned for the market structure
- Clear path to differentiation or execution exists within the market structure
- Use market structure reasoning supported by metrics, not just metric lists

CAUTION (Conditional):
- Market structure shows mixed signals: some barriers exist but are surmountable with specific conditions
- Viability depends on seller meeting specific conditions (e.g., differentiation strategy, capital commitment, operational capability)
- Frame in terms of market structure: "Review barrier is high but manageable IF seller commits to X"
- End with clear conditions for success

NO_GO (No):
- Market structure is unfavorable: competition intensity is too high, review barrier is insurmountable, price compression eliminates margin, dominance concentration locks out new entrants
- Market structure signals indicate capital risk exceeds potential return
- Frame in terms of market structure: "Review barrier and dominance concentration make entry unviable" not "Average reviews are high"
- End with clear warning about why this won't work

CONFIDENCE SCORE JUSTIFICATION (MANDATORY)

Confidence score (0–100) reflects decision confidence based on market structure clarity, not data completeness.

FOR KEYWORD ANALYSES:
Confidence score MUST be based on:
- Market structure clarity: How clear are the competition intensity, review barrier, price compression, and dominance signals?
- Review barrier height: Higher barriers = lower confidence in entry viability
- Dominance concentration: Higher concentration = lower confidence in differentiation success
- Seller profile fit: How well does seller stage match market structure requirements?

Confidence reflects how certain you are about the decision given market structure signals, not how complete the data is. Even with sparse data, make a decision and set confidence based on market structure clarity.

Confidence caps (MANDATORY for keywords):
- If fewer than 5 valid listings exist → confidence MAX = 40 (market structure is unclear)
- If review_density > 60% → confidence MAX = 65 (review barrier is very high)
- If brand_concentration > 50% → confidence MAX = 60 (dominance concentration is high)


EXECUTIVE SUMMARY RULES (MANDATORY)

Executive Summary MUST follow this structure:

1. First sentence: Clear verdict (Yes/No/Conditional) that directly answers viability
2. Second sentence: Market structure explanation using metrics to support reasoning
3. Third sentence: Seller-specific feasibility assessment
4. Final sentence: Actionable takeaway, warning, or condition for success

HARD RULE FOR KEYWORD ANALYSES:
- Use metrics to explain market structure (competition intensity, review barrier, price compression, dominance), not as standalone facts
- If metrics are available, use them to support structure analysis
- If metrics are sparse, make a decision based on available market structure signals anyway
- NEVER say "insufficient data" or "not available" - make the best judgment call possible

Example format:
"This is a NO-GO for new sellers. The review barrier is high (2,800 average reviews) and dominance concentration is strong (top brand controls 55% of listings), indicating entrenched competition that requires significant capital to overcome. Entry is only viable for existing sellers with established review velocity and clear differentiation strategy. Proceed only if you can commit to 6+ months of PPC spend and have a unique value proposition that breaks brand loyalty."

FORBIDDEN in Executive Summary:
- Phrases like "we can't conclude", "insufficient data", "not available"
- Raw metric lists without market structure interpretation
- Vague statements without actionable direction
- References to system limitations or missing data

RISK BREAKDOWN RULES (MANDATORY)

Each risk category MUST explain market structure implications, not just list metrics:

HARD RULE FOR KEYWORD ANALYSES:
- Each risk explanation must reason about market structure (competition intensity, review barrier, price compression, dominance concentration)
- Use metrics to support structure analysis, not as standalone facts
- If metrics are available, use them to explain WHY the risk exists
- If metrics are sparse, make a judgment about market structure based on available signals
- NEVER say "insufficient data" or "not available" - explain the risk based on market structure signals

Example format:

Competition Risk:
- Explanation: "High competition intensity: 2,400 average reviews indicates a high review barrier. New listings must invest significant capital in PPC and review generation to compete, making this unsuitable for sellers without established review velocity."

Pricing Risk:
- Explanation: "Price compression: $12–$15 range signals tight margins and limited differentiation room. Sellers must compete on operational efficiency or find a unique angle, as price-based competition will erode margins quickly."

Differentiation Risk:
- Explanation: "High dominance concentration: Top brand controls 60% of listings, indicating strong brand loyalty. New entrants face an uphill battle breaking customer trust, requiring either superior product quality or aggressive marketing spend."

Operations Risk:
- Explanation: "Operational complexity: 10 competitors on Page 1 indicates mature market with established fulfillment patterns. Sellers must match or exceed current service levels, requiring robust inventory management and fast fulfillment."

NO abstract explanations. Every risk must explain market structure implications, using metrics to support reasoning when available.

RECOMMENDED ACTIONS RULES (MANDATORY)

Recommended actions must be:
- Actionable: Specific steps the seller can take based on market structure
- Tied to market structure: Address competition intensity, review barriers, price compression, or dominance concentration
- Conditional when needed: "IF market structure shows X, THEN do Y"
- End with clear success conditions or warnings

For "must_do":
- Critical actions required given market structure (e.g., "Commit to 6+ months PPC spend to overcome review barrier")
- Conditions that must be met for viability (e.g., "Secure unique differentiation angle before entry")

For "should_do":
- Strategic actions that improve position within market structure
- Optimization steps given competition intensity and barriers

For "avoid":
- Actions that worsen position given market structure
- Common mistakes that don't account for competition intensity or barriers

NEVER include:
- Generic advice not tied to market structure
- References to system limitations or missing data
- Vague suggestions without actionable steps

ASSUMPTIONS AND LIMITS RULES (MANDATORY)

Assumptions and limits must:
- Focus on market structure assumptions, not system limitations
- Explain what market structure signals assume (e.g., "Assumes current competition intensity remains stable")
- Frame limitations as market structure uncertainties, not data gaps

NEVER include:
- References to "insufficient data" or "not available"
- System limitations or missing data sources
- Phrases that suggest inability to make a decision

Instead, frame as:
- Market structure assumptions: "Assumes review barrier remains at current level"
- Market dynamics: "Market structure may shift if new entrants enter"
- Seller capability assumptions: "Assumes seller can commit required capital"

SELLER CONTEXT INTERPRETATION

New seller:
- Assess market structure through the lens of capital constraints and review velocity limitations
- High competition intensity (many competitors with high review counts) = NO-GO unless clear differentiation path exists
- High dominance concentration (single brand control) = NO-GO unless unique angle identified
- Price compression (tight range) = CAUTION, requires operational efficiency
- Frame in terms of market structure: "Review barrier is too high for new seller capital constraints" not "Average reviews are 3,000"

Existing seller:
- Allow for higher competition intensity if market structure shows differentiation opportunities
- Consider portfolio synergies and opportunity cost
- Frame in terms of market structure: "Review barrier is manageable given established velocity" not "Average reviews are 1,500"
- Assess whether market structure allows for strategic entry despite competition

Thinking:
- Focus on market structure education: explain WHY competition intensity, review barriers, price compression, and dominance matter
- Use metrics to illustrate market structure concepts
- Emphasize decision-making framework, not just data interpretation

FINAL CHECK BEFORE RESPONDING

Before returning your answer, verify:
- Verdict is clear and appears in first sentence of executive summary
- Reasoning explains market structure (competition intensity, review barrier, price compression, dominance), not just lists metrics
- Raw metrics are used to support market structure analysis, not restated as lists
- Response ends with actionable takeaway, warning, or condition for success
- No phrases like "we can't conclude", "insufficient data", "not available", or system limitations
- No follow-up questions unless explicitly requested
- Output reads like a senior Amazon seller making a real capital allocation decision
- Confidence reflects decision certainty based on market structure signals, not data completeness

Output should read like a senior Amazon operator making a real decision about whether to risk time and capital, even when data is imperfect.`;

// Decision contract keys that must be present in the OpenAI response
const REQUIRED_DECISION_KEYS = [
  "decision",
  "executive_summary",
  "reasoning",
  "risks",
  "recommended_actions",
  "assumptions_and_limits",
  "numbers_used",
];

const MAX_ANALYSES_PER_PERIOD = 5;
const USAGE_PERIOD_DAYS = 30;

/**
 * STEP 4: Generate representative product cards from market snapshot stats
 * 
 * This is a guaranteed fallback to ensure products array is never empty.
 * 
 * Features:
 * - Generates 4-6 synthetic products based on snapshot averages
 * - Uses realistic price variance (±12%)
 * - Includes proper logging for debugging
 * - Never throws errors - always returns valid products
 * 
 * Logging:
 * - SYNTHETIC_PRODUCTS_GENERATION_START: When generation begins
 * - SYNTHETIC_PRODUCTS_GENERATION_COMPLETE: When generation finishes
 */
/**
 * Generate representative product cards from market snapshot stats
 * 
 * Returns listings that match the canonical ParsedListing interface exactly.
 * These are fallback listings used when real listings are missing.
 * 
 * Canonical contract rules:
 * - title, brand, rating, reviews, image_url must be null (not strings/numbers)
 * - main_category and main_category_bsr must always exist (null allowed)
 * - revenue_confidence must be "medium" (never "low")
 * - Shape must be identical to real listings so UI never breaks
 */
function generateRepresentativeProducts(
  snapshot: {
    avg_price: number | null;
    est_total_monthly_units_min?: number | null;
    est_total_monthly_units_max?: number | null;
    total_page1_listings: number;
    avg_reviews?: number | null;
    avg_rating?: number | null;
  },
  keyword: string
): ParsedListing[] {
  // STEP 4: Enhanced logging for synthetic product generation
  console.log("🔵 SYNTHETIC_PRODUCTS_GENERATION_START", {
    keyword,
    snapshot_price: snapshot.avg_price,
    snapshot_units_min: snapshot.est_total_monthly_units_min,
    snapshot_units_max: snapshot.est_total_monthly_units_max,
    total_page1_listings: snapshot.total_page1_listings,
    timestamp: new Date().toISOString(),
  });
  
  // Generate 4-6 products based on snapshot.product_count
  const productCount = snapshot.total_page1_listings || 5;
  const placeholderCount = Math.min(6, Math.max(4, productCount));
  
  const avgPrice = snapshot.avg_price ?? 25;
  const totalUnits = snapshot.est_total_monthly_units_min ?? snapshot.est_total_monthly_units_max ?? (productCount * 150);
  const productCountForCalc = productCount > 0 ? productCount : placeholderCount;
  const avgMonthlyUnits = Math.round(totalUnits / productCountForCalc);
  const avgMonthlyRevenue = avgPrice * avgMonthlyUnits;
  
  // Calculate median reviews (use avg_reviews if available, otherwise 0)
  const medianReviews = snapshot.avg_reviews ?? 0;
  
  // Generate price variance (±10-15%)
  const priceVariance = avgPrice * 0.12; // 12% variance
  
  const syntheticProducts = Array.from({ length: placeholderCount }, (_, idx) => {
    // Vary price around average (±10-15%)
    const priceOffset = (Math.random() - 0.5) * 2 * priceVariance;
    const price = Math.max(1, Math.round((avgPrice + priceOffset) * 100) / 100);
    
    // Vary units slightly (±20%)
    const unitsVariance = avgMonthlyUnits * 0.2;
    const unitsOffset = (Math.random() - 0.5) * 2 * unitsVariance;
    const units = Math.max(1, Math.round(avgMonthlyUnits + unitsOffset));
    const revenue = price * units;
    
    return {
      asin: `ESTIMATED-${idx + 1}`, // Non-null string (required for ParsedListing)
      title: null, // Must be null, not string (canonical contract)
      price,
      rating: null, // Must be null, not number (canonical contract)
      reviews: null, // Must be null, not number (canonical contract)
      is_sponsored: false,
      position: idx + 1,
      brand: null, // Must be null, not string (canonical contract)
      image_url: null, // Must be null, not string (canonical contract)
      bsr: null,
      main_category_bsr: null, // Required field, must exist (canonical contract)
      main_category: null, // Required field, must exist (canonical contract)
      fulfillment: null, // "FBA" | "FBM" | "Amazon" | null
      est_monthly_revenue: Math.round(revenue * 100) / 100,
      est_monthly_units: units,
      revenue_confidence: "medium" as const, // Must be "medium", never "low" (canonical contract)
    } as ParsedListing;
  });
  
  // STEP 4: Enhanced logging for synthetic product generation completion
  console.log("🔵 SYNTHETIC_PRODUCTS_GENERATION_COMPLETE", {
    keyword,
    generated_count: syntheticProducts.length,
    avg_price: avgPrice,
    avg_monthly_units: avgMonthlyUnits,
    avg_monthly_revenue: avgMonthlyRevenue,
    sample_product: syntheticProducts[0] ? {
      asin: syntheticProducts[0].asin,
      price: syntheticProducts[0].price,
      est_monthly_units: syntheticProducts[0].est_monthly_units,
      est_monthly_revenue: syntheticProducts[0].est_monthly_revenue,
    } : null,
    timestamp: new Date().toISOString(),
  });
  
  return syntheticProducts;
}

interface AnalyzeRequestBody {
  input_type: "keyword";
  input_value: string;
}

interface DecisionContract {
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
    competition: {
      level: "Low" | "Medium" | "High";
      explanation: string;
    };
    pricing: {
      level: "Low" | "Medium" | "High";
      explanation: string;
    };
    differentiation: {
      level: "Low" | "Medium" | "High";
      explanation: string;
    };
    operations: {
      level: "Low" | "Medium" | "High";
      explanation: string;
    };
  };
  recommended_actions: {
    must_do: string[];
    should_do: string[];
    avoid: string[];
  };
  assumptions_and_limits: string[];
  numbers_used: {
    avg_price: number | null;
    price_range: [number, number] | null;
    median_reviews: number | null;
    review_density_pct: number | null;
    brand_concentration_pct: number | null;
    competitor_count: number | null;
    avg_rating: number | null;
  };
  // User-refined costs (optional, added after initial analysis)
  cost_overrides?: {
    cogs: number | null;
    fba_fees: number | null;
    last_updated: string; // ISO timestamp
    source: "user";
  };
}

function validateRequestBody(body: any): body is AnalyzeRequestBody {
  // Check if input looks like an ASIN (10 alphanumeric characters, typically starting with B0)
  const asinPattern = /^B0[A-Z0-9]{8}$/i;
  const inputValue = typeof body.input_value === "string" ? body.input_value.trim() : "";
  
  if (asinPattern.test(inputValue)) {
    return false; // Reject ASIN-like strings
  }
  
  return (
    typeof body === "object" &&
    body !== null &&
    body.input_type === "keyword" &&
    typeof body.input_value === "string" &&
    body.input_value.trim().length > 0
  );
}



function validateDecisionContract(data: any): data is DecisionContract {
  if (typeof data !== "object" || data === null) {
    console.error("VALIDATION_FAILED: data is not an object", { type: typeof data, value: data });
    return false;
  }

  // Check all required keys exist
  for (const key of REQUIRED_DECISION_KEYS) {
    if (!(key in data)) {
      console.error("VALIDATION_FAILED: missing required key", { key, available_keys: Object.keys(data) });
      return false;
    }
  }

  // Validate decision object
  if (
    typeof data.decision !== "object" ||
    data.decision === null ||
    !["GO", "CAUTION", "NO_GO"].includes(data.decision.verdict) ||
    typeof data.decision.confidence !== "number" ||
    data.decision.confidence < 0 ||
    data.decision.confidence > 100
  ) {
    console.error("VALIDATION_FAILED: invalid decision object", {
      is_object: typeof data.decision === "object",
      is_null: data.decision === null,
      verdict: data.decision?.verdict,
      verdict_valid: data.decision?.verdict ? ["GO", "CAUTION", "NO_GO"].includes(data.decision.verdict) : false,
      confidence: data.decision?.confidence,
      confidence_type: typeof data.decision?.confidence,
      confidence_valid: typeof data.decision?.confidence === "number" && data.decision.confidence >= 0 && data.decision.confidence <= 100,
    });
    return false;
  }

  // Validate executive_summary
  if (typeof data.executive_summary !== "string") {
    return false;
  }

  // Validate reasoning object
  if (
    typeof data.reasoning !== "object" ||
    data.reasoning === null ||
    !Array.isArray(data.reasoning.primary_factors) ||
    !data.reasoning.primary_factors.every((item: any) => typeof item === "string") ||
    typeof data.reasoning.seller_context_impact !== "string"
  ) {
    console.error("VALIDATION_FAILED: invalid reasoning object", {
      is_object: typeof data.reasoning === "object",
      is_null: data.reasoning === null,
      has_primary_factors: Array.isArray(data.reasoning?.primary_factors),
      primary_factors_valid: Array.isArray(data.reasoning?.primary_factors) && data.reasoning.primary_factors.every((item: any) => typeof item === "string"),
      has_seller_context_impact: typeof data.reasoning?.seller_context_impact === "string",
    });
    return false;
  }

  // Validate risks object
  const riskLevels = ["Low", "Medium", "High"];
  const riskKeys = ["competition", "pricing", "differentiation", "operations"];
  if (
    typeof data.risks !== "object" ||
    data.risks === null
  ) {
    console.error("VALIDATION_FAILED: risks is not an object", { risks: data.risks, type: typeof data.risks });
    return false;
  }
  for (const riskKey of riskKeys) {
    if (
      !(riskKey in data.risks) ||
      typeof data.risks[riskKey] !== "object" ||
      data.risks[riskKey] === null ||
      !riskLevels.includes(data.risks[riskKey].level) ||
      typeof data.risks[riskKey].explanation !== "string"
    ) {
      console.error("VALIDATION_FAILED: invalid risk", {
        riskKey,
        has_key: riskKey in data.risks,
        is_object: typeof data.risks[riskKey] === "object",
        is_null: data.risks[riskKey] === null,
        level: data.risks[riskKey]?.level,
        level_valid: riskLevels.includes(data.risks[riskKey]?.level),
        has_explanation: typeof data.risks[riskKey]?.explanation === "string",
      });
      return false;
    }
  }

  // Validate recommended_actions object
  const actionKeys = ["must_do", "should_do", "avoid"];
  if (
    typeof data.recommended_actions !== "object" ||
    data.recommended_actions === null
  ) {
    return false;
  }
  for (const actionKey of actionKeys) {
    if (
      !(actionKey in data.recommended_actions) ||
      !Array.isArray(data.recommended_actions[actionKey]) ||
      !data.recommended_actions[actionKey].every((item: any) => typeof item === "string")
    ) {
      return false;
    }
  }

  // Validate assumptions_and_limits
  if (
    !Array.isArray(data.assumptions_and_limits) ||
    !data.assumptions_and_limits.every((item: any) => typeof item === "string")
  ) {
    return false;
  }

  // Validate numbers_used object
  if (
    typeof data.numbers_used !== "object" ||
    data.numbers_used === null
  ) {
    return false;
  }
  const numbersUsedKeys = [
    "avg_price",
    "price_range",
    "median_reviews",
    "review_density_pct",
    "brand_concentration_pct",
    "competitor_count",
    "avg_rating",
  ];
  for (const key of numbersUsedKeys) {
    if (!(key in data.numbers_used)) {
      return false;
    }
    // Validate types: number | null, or [number, number] | null for price_range
    if (key === "price_range") {
      if (
        data.numbers_used[key] !== null &&
        (!Array.isArray(data.numbers_used[key]) ||
          data.numbers_used[key].length !== 2 ||
          typeof data.numbers_used[key][0] !== "number" ||
          typeof data.numbers_used[key][1] !== "number")
      ) {
        return false;
      }
    } else {
      if (
        data.numbers_used[key] !== null &&
        typeof data.numbers_used[key] !== "number"
      ) {
        return false;
      }
    }
  }

  return true;
}

export async function POST(req: NextRequest) {
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Top-level execution log
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("🔥 ANALYZE ROUTE HIT", {
    path: "app/api/analyze/route.ts",
    timestamp: new Date().toISOString(),
  });
  
  // Create a response object that can be modified for cookie handling
  let res = new NextResponse();
  const supabase = createApiClient(req, res);

  try {
    // 1. Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // 2. Get user email for admin/dev bypass check
    const userEmail = user.email || null;

    // 3. Gate: Require seller profile (onboarding must be complete)
    // Always load latest profile with updated_at for versioning
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
            { success: false, error: "Onboarding incomplete" },
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
          { success: false, error: "Onboarding incomplete" },
          { status: 403, headers: res.headers }
        );
      }
    }

    if (!sellerProfile) {
      return NextResponse.json(
        { success: false, error: "Onboarding incomplete" },
        { status: 403, headers: res.headers }
      );
    }

    // 4. Load or create usage counter (only check if not bypassing)
    let currentCount = 0;
    let resetAt: Date;

    // Only load/check usage counter if not bypassing limits
    if (shouldIncrementUsage(userEmail)) {
      const { data: usageCounter, error: usageError } = await supabase
        .from("usage_counters")
        .select("analyze_count, reset_at")
        .eq("user_id", user.id)
        .single();

      if (usageError || !usageCounter) {
        // Create new usage counter row
        const newResetAt = new Date();
        newResetAt.setDate(newResetAt.getDate() + USAGE_PERIOD_DAYS);

        const { error: createError } = await supabase
          .from("usage_counters")
          .insert({
            user_id: user.id,
            analyze_count: 0,
            reset_at: newResetAt.toISOString(),
          });

        if (createError) {
          return NextResponse.json(
            {
              success: false,
              error: "Failed to initialize usage counter",
              details: createError.message,
            },
            { status: 500, headers: res.headers }
          );
        }

        currentCount = 0;
        resetAt = newResetAt;
      } else {
        // Check if reset period has passed
        const resetAtDate = new Date(usageCounter.reset_at);
        const now = new Date();

        if (now > resetAtDate) {
          // Reset the counter
          const newResetAt = new Date();
          newResetAt.setDate(newResetAt.getDate() + USAGE_PERIOD_DAYS);

          const { error: resetError } = await supabase
            .from("usage_counters")
            .update({
              analyze_count: 0,
              reset_at: newResetAt.toISOString(),
            })
            .eq("user_id", user.id);

          if (resetError) {
            return NextResponse.json(
              {
                success: false,
                error: "Failed to reset usage counter",
                details: resetError.message,
              },
              { status: 500, headers: res.headers }
            );
          }

          currentCount = 0;
          resetAt = newResetAt;
        } else {
          currentCount = usageCounter.analyze_count;
          resetAt = resetAtDate;
        }
      }

      // Check usage limit (only for non-bypass users)
      const usageCheck = await checkUsageLimit(
        user.id,
        userEmail,
        currentCount,
        MAX_ANALYSES_PER_PERIOD
      );

      if (!usageCheck.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: "Usage limit reached. Upgrade to continue analyzing products.",
          },
          { status: 429, headers: res.headers }
        );
      }
    }

    // 5. Parse and validate request body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400, headers: res.headers }
      );
    }

    // Check if input looks like an ASIN before validation
    const asinPattern = /^B0[A-Z0-9]{8}$/i;
    const inputValue = typeof body.input_value === "string" ? body.input_value.trim() : "";
    
    if (asinPattern.test(inputValue)) {
      return NextResponse.json(
        {
          success: false,
          error: "Analyze currently supports keyword search only.",
        },
        { status: 400, headers: res.headers }
      );
    }
    
    if (!validateRequestBody(body)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid request body. Expected { input_type: 'keyword', input_value: string }",
        },
        { status: 400, headers: res.headers }
      );
    }

    console.log("INPUT", body.input_type, body.input_value);

    // 6. Structure seller context
    const sellerContext = {
      stage: sellerProfile.stage,
      experience_months: sellerProfile.experience_months,
      monthly_revenue_range: sellerProfile.monthly_revenue_range,
    };

    console.log("SELLER_PROFILE", {
      stage: sellerProfile.stage,
      experience_months: sellerProfile.experience_months,
      revenue_range: sellerProfile.monthly_revenue_range,
      sourcing_model: sellerProfile.sourcing_model,
      profile_version: sellerProfile.updated_at || "unknown",
      profile_updated_at: sellerProfile.updated_at || null,
    });

    // 7. MARKET-FIRST ARCHITECTURE: Fetch real Rainforest listings FIRST
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: If real Rainforest listings exist, NEVER use snapshot-based Page-1
    // ═══════════════════════════════════════════════════════════════════════════
    const marketplace = "amazon.com"; // Amazon marketplace
    let keywordMarketData: KeywordMarketData | null = null;
    let snapshotStatus = 'miss';
    let dataSource: "market" | "snapshot" = "snapshot"; // Default to snapshot, switch to market if real listings exist
    let rawRainforestListings: any[] = []; // Track raw Rainforest listings for assertions
    
    // STEP 1: Check keyword_confidence and skip Rainforest if HIGH confidence
    const normalizedKeyword = body.input_value.toLowerCase().trim();
    let confidenceLevel = 'low';
    
    if (body.input_type === "keyword") {
      try {
        // Compute confidence from observations (on-the-fly, since keyword_confidence table doesn't exist yet)
        const {
          getConfidenceStats,
          computeConfidenceMetadata,
        } = await import("@/lib/analyze/keywordConfidence");
        
        const stats = await getConfidenceStats(supabase, normalizedKeyword, marketplace);
        const metadata = computeConfidenceMetadata(stats);
        
        if (metadata) {
          // Map confidence level to lowercase format
          confidenceLevel = metadata.confidence_level.toLowerCase() as 'high' | 'medium' | 'low';
        }
      } catch (error) {
        console.warn("Confidence check failed, continuing normally:", error);
      }
    }
    
    console.log("CONFIDENCE_LEVEL_USED", {
      keyword: normalizedKeyword,
      marketplace: marketplace,
      confidenceLevel: confidenceLevel,
    });
    
    // STEP 1.1: If confidence is HIGH, skip Rainforest and use cached data
    let cachedProducts: any[] = [];
    const cacheThreshold = new Date();
    cacheThreshold.setHours(cacheThreshold.getHours() - 24);
    
    if (confidenceLevel === 'high' && body.input_type === "keyword") {
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const { data: cachedRows } = await supabase
          .from("keyword_products")
          .select("*")
          .eq("keyword", normalizedKeyword)
          .gte("last_updated", sevenDaysAgo.toISOString())
          .order("rank", { ascending: true });
        
        const { data: snapshot } = await supabase
          .from("keyword_snapshots")
          .select("*")
          .eq("keyword", normalizedKeyword)
          .eq("marketplace", marketplace)
          .order("last_updated", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (cachedRows && cachedRows.length > 0 && snapshot) {
          cachedProducts = cachedRows;
          console.log("RAINFOREST_SKIPPED_CONFIDENT", {
            keyword: normalizedKeyword,
            marketplace: marketplace,
            cached_count: cachedProducts.length,
          });
          
          // Rehydrate cache and use it (skip Rainforest entirely)
          // This will be handled in the rehydration section below
        }
      } catch (error) {
        console.warn("High confidence cache fetch failed, continuing to Rainforest:", error);
      }
    } else {
      // Normal cache check (24 hours) when confidence is not HIGH
      try {
        const { data: cachedRows, error: cacheError } = await supabase
          .from("keyword_products")
          .select("*")
          .eq("keyword", normalizedKeyword)
          .gte("last_updated", cacheThreshold.toISOString())
          .order("rank", { ascending: true });
        
        if (!cacheError && cachedRows && cachedRows.length > 0) {
          cachedProducts = cachedRows;
          console.log("KEYWORD_PRODUCTS_CACHE_HIT", {
            keyword: normalizedKeyword,
            cached_count: cachedProducts.length,
          });
        }
      } catch (error) {
        // Cache check failed - continue to Rainforest
        console.warn("Cache check failed, continuing to Rainforest:", error);
      }
    }
    
    // STEP 1.5: Rehydrate cache into KeywordMarketData format (pure adapter layer)
    async function rehydrateCacheToMarketData(
      cachedRows: any[],
      keyword: string
    ): Promise<KeywordMarketData | null> {
      if (!cachedRows || cachedRows.length === 0) return null;

      // Convert cached rows to ParsedListing[]
      const listings: ParsedListing[] = cachedRows.map((row) => {
        return {
          asin: row.asin || null,
          title: null, // Not stored in keyword_products
          price: row.price !== null && row.price !== undefined ? parseFloat(row.price) : null,
          rating: row.rating !== null && row.rating !== undefined ? parseFloat(row.rating) : null,
          reviews: row.review_count !== null && row.review_count !== undefined ? parseInt(row.review_count) : null,
          is_sponsored: false, // Assume organic (not stored in keyword_products)
          position: row.rank || 1, // Organic rank
          brand: null, // Not stored in keyword_products
          image_url: null, // Not stored in keyword_products
          bsr: null, // Not stored in keyword_products
          main_category_bsr: null, // Not stored in keyword_products
          main_category: null, // Not stored in keyword_products
          fulfillment: row.fulfillment || null,
          seller: null, // Not stored in keyword_products
          is_prime: undefined, // Not stored in keyword_products
          est_monthly_revenue: row.estimated_monthly_revenue !== null && row.estimated_monthly_revenue !== undefined
            ? parseFloat(row.estimated_monthly_revenue)
            : null,
          est_monthly_units: row.estimated_monthly_units !== null && row.estimated_monthly_units !== undefined
            ? parseInt(row.estimated_monthly_units)
            : null,
          revenue_confidence: undefined,
          bsr_invalid_reason: null,
        };
      });

      // Compute KeywordMarketSnapshot from listings (reusing existing helper functions)
      const { computeAvgReviews } = await import("@/lib/amazon/marketAggregates");
      const { computeFulfillmentMix } = await import("@/lib/amazon/fulfillmentMix");
      const { computePPCIndicators } = await import("@/lib/amazon/ppcIndicators");

      const total_page1_listings = listings.length;
      const sponsored_count = listings.filter((l) => l.is_sponsored).length;

      // Average price
      const listingsWithPrice = listings.filter((l) => l.price !== null && l.price !== undefined);
      const avg_price =
        listingsWithPrice.length > 0
          ? listingsWithPrice.reduce((sum, l) => sum + (l.price ?? 0), 0) / listingsWithPrice.length
          : null;

      // Average reviews
      const avg_reviews = computeAvgReviews(listings);

      // Average rating
      const listingsWithRating = listings.filter((l) => l.rating !== null && l.rating !== undefined);
      const avg_rating =
        listingsWithRating.length > 0
          ? listingsWithRating.reduce((sum, l) => sum + (l.rating ?? 0), 0) / listingsWithRating.length
          : null;

      // Average BSR (none in cache, so null)
      const avg_bsr = null;

      // Fulfillment mix
      const fulfillmentMix = listings.length > 0
        ? computeFulfillmentMix(listings)
        : { fba: 0, fbm: 0, amazon: 0 };

      // Top brands (none in cache, so dominance_score = 0)
      const dominance_score = 0;

      // PPC indicators
      let ppcIndicators: { sponsored_pct: number; ad_intensity_label: "Low" | "Medium" | "High"; signals: string[]; source: "heuristic_v1" } | null = null;
      try {
        const ppcResult = computePPCIndicators(
          listings,
          total_page1_listings,
          sponsored_count,
          dominance_score,
          avg_price
        );
        ppcIndicators = {
          sponsored_pct: ppcResult.sponsored_pct,
          ad_intensity_label: ppcResult.ad_intensity_label,
          signals: ppcResult.signals,
          source: "heuristic_v1",
        };
      } catch (error) {
        // Continue without PPC indicators if computation fails
      }

      const snapshot: KeywordMarketSnapshot = {
        keyword,
        avg_price: avg_price !== null ? Math.round(avg_price * 100) / 100 : null,
        avg_reviews,
        avg_rating: avg_rating !== null ? Math.round(avg_rating * 10) / 10 : null,
        avg_bsr,
        total_page1_listings,
        sponsored_count,
        dominance_score,
        fulfillment_mix: fulfillmentMix,
        ppc: ppcIndicators,
      };

      return {
        snapshot,
        listings,
      };
    }

    // STEP 2: Try to fetch real Rainforest listings FIRST (skip if cache exists)
    console.log("🔵 MARKET_FETCH_START", {
      keyword: body.input_value,
      cached_count: cachedProducts.length,
      timestamp: new Date().toISOString(),
    });
    
    // 🚨 API SAFETY LIMIT: Create shared counter at route level (max 6 calls per analysis)
    const apiCallCounter = { count: 0, max: 6 };
    
    try {
      // Rehydrate cache if available, otherwise fetch from Rainforest
      let realMarketData: KeywordMarketData | null = null;
      
      // If we have cached products (either from HIGH confidence skip or normal cache), rehydrate them
      if (cachedProducts.length > 0) {
        // Rehydrate cached products into KeywordMarketData format
        realMarketData = await rehydrateCacheToMarketData(cachedProducts, body.input_value);
        
        if (realMarketData) {
          console.log("KEYWORD_PRODUCTS_CACHE_REHYDRATED", {
            keyword: normalizedKeyword,
            product_count: cachedProducts.length,
            listing_count: realMarketData.listings.length,
            confidence_skip: confidenceLevel === 'high',
          });
        }
      } else {
        // No cache - fetch from Rainforest (only if confidence is not HIGH)
        if (confidenceLevel !== 'high') {
          realMarketData = await fetchKeywordMarketSnapshot(
            body.input_value,
            supabase,
            "US",
            apiCallCounter // Pass shared counter
          );
        }
        // If confidence is HIGH but no cache, we'll fall through to snapshot lookup
      }
      
      // CRITICAL: If real listings exist, use them and NEVER use snapshot-based Page-1
      if (realMarketData && realMarketData.listings && realMarketData.listings.length > 0) {
        // Check if listings have real ASINs (not ESTIMATED-X or INFERRED-X)
        const hasRealAsins = realMarketData.listings.some(
          (l: any) => l.asin && 
          !l.asin.startsWith('ESTIMATED-') && 
          !l.asin.startsWith('INFERRED-') &&
          /^B0[A-Z0-9]{8}$/i.test(l.asin)
        );
        
        if (hasRealAsins) {
          console.log("✅ REAL_MARKET_DATA_FOUND", {
            keyword: body.input_value,
            listing_count: realMarketData.listings.length,
            real_asins: realMarketData.listings.filter((l: any) => l.asin && /^B0[A-Z0-9]{8}$/i.test(l.asin)).length,
            timestamp: new Date().toISOString(),
          });
          
          keywordMarketData = realMarketData;
          rawRainforestListings = [...realMarketData.listings]; // Store raw listings for assertions
          dataSource = "market";
          snapshotStatus = 'market'; // Mark as real market data
          
          // ═══════════════════════════════════════════════════════════════════════════
          // STEP 3: Trace raw Page-1 listings BEFORE any processing
          // ═══════════════════════════════════════════════════════════════════════════
          console.log("🔍 RAW PAGE-1 LISTINGS (SOURCE)", {
            count: rawRainforestListings?.length,
            sample: rawRainforestListings?.slice(0, 3).map((l: any) => ({
              asin: l.asin,
              brand: l.brand,
              image_url: l.image_url,
              fulfillment: l.fulfillment,
              rating: l.rating,
              reviews: l.reviews,
            })),
            hasImages: rawRainforestListings?.some((l: any) => !!l.image || !!l.image_url),
            hasBrands: rawRainforestListings?.some((l: any) => !!l.brand),
            fulfillmentCounts: {
              FBA: rawRainforestListings?.filter((l: any) => l.fulfillment === "FBA").length,
              FBM: rawRainforestListings?.filter((l: any) => l.fulfillment === "FBM").length,
            },
          });
          
          // SKIP snapshot lookup entirely when real listings exist
          // This ensures snapshot-based Page-1 generation NEVER runs
        } else {
          console.warn("⚠️ MARKET_DATA_HAS_SYNTHETIC_ASINS", {
            keyword: body.input_value,
            listing_count: realMarketData.listings.length,
            timestamp: new Date().toISOString(),
          });
          // Fall through to snapshot lookup
        }
      } else {
        console.log("ℹ️ NO_REAL_MARKET_DATA", {
          keyword: body.input_value,
          timestamp: new Date().toISOString(),
        });
        // Fall through to snapshot lookup
      }
    } catch (error) {
      console.error("❌ MARKET_FETCH_ERROR", {
        keyword: body.input_value,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      // Fall through to snapshot lookup
    }
    
    // STEP 2: Only use snapshot if NO real market data exists
    if (!keywordMarketData || dataSource !== "market") {
      const {
        buildKeywordSnapshotFromCache,
        getKeywordProducts,
        incrementSearchCount,
        queueKeyword,
      } = await import("@/lib/snapshots/keywordSnapshots");
      
      // Build snapshot from cached keyword_products (zero Rainforest API calls)
      let snapshot = await buildKeywordSnapshotFromCache(supabase, body.input_value, marketplace);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/2d717643-6e0f-44e0-836b-7d7b2c0dda42',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/analyze/route.ts:778',message:'Snapshot lookup result',data:{has_snapshot:!!snapshot,keyword:body.input_value,marketplace},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      if (snapshot) {
      // Snapshot exists - use it (pure database read)
      snapshotStatus = 'hit';
      console.log("SNAPSHOT_HIT", {
        keyword: body.input_value,
        last_updated: snapshot.last_updated,
        product_count: snapshot.product_count,
      });

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/2d717643-6e0f-44e0-836b-7d7b2c0dda42',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/analyze/route.ts:782',message:'Snapshot hit - proceeding with analysis',data:{snapshot_status:snapshotStatus},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // Increment search count
      await incrementSearchCount(supabase, body.input_value, marketplace);

      // Get products for this keyword
      const products = await getKeywordProducts(supabase, body.input_value, marketplace);

      // Compute aggregated metrics from products
      const productsWithPrice = products.filter(p => p.price !== null && p.price > 0);
      const avgPrice = productsWithPrice.length > 0
        ? productsWithPrice.reduce((sum, p) => sum + (p.price || 0), 0) / productsWithPrice.length
        : (snapshot.average_price || 0);

      // Compute min/max values using deterministic logic if snapshot doesn't have them
      // Try to read from snapshot fields first (if they exist), otherwise compute
      const page1Count = snapshot.product_count;
      const finalAvgPrice = avgPrice > 0 ? avgPrice : (snapshot.average_price || 25);
      
      // Check if snapshot has min/max fields (from database columns or computed)
      let unitsMin: number;
      let unitsMax: number;
      let revenueMin: number;
      let revenueMax: number;
      
      if (snapshot.est_total_monthly_units_min !== undefined && snapshot.est_total_monthly_units_min !== null) {
        // Snapshot has min/max fields - use them
        unitsMin = snapshot.est_total_monthly_units_min;
        unitsMax = snapshot.est_total_monthly_units_max ?? unitsMin;
        revenueMin = snapshot.est_total_monthly_revenue_min ?? 0;
        revenueMax = snapshot.est_total_monthly_revenue_max ?? revenueMin;
      } else {
        // Compute using deterministic logic: est_units_per_listing = 150
        const estUnitsPerListing = 150;
        const totalUnits = page1Count * estUnitsPerListing;
        unitsMin = Math.round(totalUnits * 0.7);
        unitsMax = Math.round(totalUnits * 1.3);
        revenueMin = Math.round((unitsMin * finalAvgPrice) * 100) / 100;
        revenueMax = Math.round((unitsMax * finalAvgPrice) * 100) / 100;
        
        // Update snapshot in database with computed min/max values for future reads
        const { error: updateError } = await supabase
          .from("keyword_snapshots")
          .update({
            est_total_monthly_units_min: unitsMin,
            est_total_monthly_units_max: unitsMax,
            est_total_monthly_revenue_min: revenueMin,
            est_total_monthly_revenue_max: revenueMax,
          })
          .eq("keyword", snapshot.keyword)
          .eq("marketplace", snapshot.marketplace);
        
        if (updateError) {
          console.warn("Failed to update snapshot with min/max fields:", updateError);
          // Continue anyway - values are computed and will be used in response
        } else {
        console.log("✅ Updated snapshot with min/max fields:", {
          keyword: snapshot.keyword,
          page1_count: page1Count,
          avg_price: finalAvgPrice,
          units_min: unitsMin,
          units_max: unitsMax,
          revenue_min: revenueMin,
          revenue_max: revenueMax,
        });
        }
      }

      // Convert snapshot to KeywordMarketData format
      // GUARANTEED PRODUCT FALLBACK: Ensure listings are never empty
      let listings: ParsedListing[] = products.map((p) => ({
        asin: p.asin || '',
        title: null,
        price: p.price,
        rating: null,
        reviews: null,
        is_sponsored: false,
        position: p.rank,
        brand: null,
        image_url: null,
        bsr: p.main_category_bsr,
        main_category_bsr: p.main_category_bsr,
        main_category: p.main_category,
        fulfillment: null,
        est_monthly_revenue: p.estimated_monthly_revenue,
        est_monthly_units: p.estimated_monthly_units,
        revenue_confidence: 'medium' as const,
      } as ParsedListing));
      
      // FALLBACK LAYER 2: If no cached listings, generate representative products
      // BUT: Do NOT generate if dataSource === "market" (should never reach here)
      if (listings.length === 0) {
        if (dataSource === "market") {
          console.error("🔴 FATAL: dataSource === 'market' but snapshot branch generated estimated products", {
            keyword: body.input_value,
            dataSource,
            rawRainforestListings_count: rawRainforestListings.length,
            timestamp: new Date().toISOString(),
          });
          return NextResponse.json(
            {
              success: false,
              error: "Market data routing error: Snapshot branch should not run for market data",
              details: "dataSource is 'market' but code reached snapshot fallback",
            },
            { status: 500, headers: res.headers }
          );
        }
        
        console.log("GUARANTEED_FALLBACK: No cached listings, generating representative products from snapshot");
        listings = generateRepresentativeProducts({
          avg_price: avgPrice > 0 ? avgPrice : snapshot.average_price,
          est_total_monthly_units_min: unitsMin,
          est_total_monthly_units_max: unitsMax,
          total_page1_listings: snapshot.product_count,
          avg_reviews: 0,
          avg_rating: null,
        }, snapshot.keyword);
      }
      
      keywordMarketData = {
        snapshot: {
          keyword: snapshot.keyword,
          avg_price: avgPrice > 0 ? avgPrice : null,
          avg_reviews: 0, // Reviews not stored in snapshot
          avg_rating: null, // Rating not stored in snapshot
          avg_bsr: snapshot.average_bsr,
          total_page1_listings: snapshot.product_count,
          sponsored_count: 0, // Not stored in snapshot
          dominance_score: 0, // Not stored in snapshot
          fulfillment_mix: { fba: 0, fbm: 0, amazon: 0 }, // Not stored in snapshot
          est_total_monthly_revenue_min: revenueMin,
          est_total_monthly_revenue_max: revenueMax,
          est_total_monthly_units_min: unitsMin,
          est_total_monthly_units_max: unitsMax,
          search_demand: null, // Not stored in snapshot (will be computed if needed)
        },
        listings,
      };
    } else {
      // Step 2: No snapshot exists - create Tier-1 instantly (NO API calls, $0 cost)
      const normalizedKeyword = body.input_value.toLowerCase().trim();
      console.log("SNAPSHOT_MISS - Creating Tier-1 instantly", { keyword: normalizedKeyword });

      // Import Tier-1 builder
      const { buildTier1Snapshot, tier1ToDbFormat } = await import("@/lib/snapshots/tier1Estimate");

      // Build Tier-1 snapshot using deterministic heuristic
      const tier1Snapshot = buildTier1Snapshot(normalizedKeyword);

      // Compute min/max values using deterministic logic
      // est_units_per_listing = 150, total_units = page1_count * 150
      // units_min = total_units * 0.7, units_max = total_units * 1.3
      // revenue_min = units_min * avg_price, revenue_max = units_max * avg_price
      const estUnitsPerListing = 150;
      const page1Count = tier1Snapshot.product_count;
      const totalUnits = page1Count * estUnitsPerListing;
      const unitsMin = Math.round(totalUnits * 0.7);
      const unitsMax = Math.round(totalUnits * 1.3);
      const revenueMin = Math.round((unitsMin * tier1Snapshot.average_price) * 100) / 100;
      const revenueMax = Math.round((unitsMax * tier1Snapshot.average_price) * 100) / 100;

      // Insert Tier-1 snapshot into database with min/max fields
      const dbSnapshot = tier1ToDbFormat(tier1Snapshot, marketplace);
      const { error: insertError } = await supabase
        .from("keyword_snapshots")
        .upsert(dbSnapshot, {
          onConflict: 'keyword,marketplace'
        });

      if (insertError) {
        console.error("❌ Failed to insert Tier-1 snapshot:", insertError);
        // Continue anyway - we'll use the in-memory snapshot
      } else {
        console.log("✅ Tier-1 snapshot inserted:", {
          keyword: normalizedKeyword,
          units_min: unitsMin,
          units_max: unitsMax,
          revenue_min: revenueMin,
          revenue_max: revenueMax,
        });
      }

      // Queue keyword for Tier-2 enrichment (background, non-blocking)
      await queueKeyword(supabase, normalizedKeyword, 5, user.id, marketplace);
      console.log("✅ Keyword queued for Tier-2 enrichment");

      // Convert Tier-1 snapshot to KeywordMarketData format with computed min/max
      // GUARANTEED PRODUCT FALLBACK: Generate representative products for Tier-1
      const tier1Listings = generateRepresentativeProducts({
        avg_price: tier1Snapshot.average_price,
        est_total_monthly_units_min: unitsMin,
        est_total_monthly_units_max: unitsMax,
        total_page1_listings: tier1Snapshot.product_count,
        avg_reviews: 0,
        avg_rating: null,
      }, tier1Snapshot.keyword);
      
      console.log("GUARANTEED_FALLBACK: Tier-1 snapshot - generated representative products", {
        count: tier1Listings.length,
        keyword: tier1Snapshot.keyword,
      });
      
      keywordMarketData = {
        snapshot: {
          keyword: tier1Snapshot.keyword,
          avg_price: tier1Snapshot.average_price,
          avg_reviews: 0,
          avg_rating: null,
          avg_bsr: tier1Snapshot.average_bsr,
          total_page1_listings: tier1Snapshot.product_count,
          sponsored_count: 0,
          dominance_score: 0,
          fulfillment_mix: { fba: 0, fbm: 0, amazon: 0 },
          est_total_monthly_revenue_min: revenueMin,
          est_total_monthly_revenue_max: revenueMax,
          est_total_monthly_units_min: unitsMin,
          est_total_monthly_units_max: unitsMax,
          search_demand: null,
        },
        listings: tier1Listings, // GUARANTEED: Never empty
      };
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ENFORCE INVARIANTS: NO FALLBACKS FOR MARKET ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: If dataSource === "market", we MUST have rawRainforestListings
    if (dataSource === "market") {
      if (rawRainforestListings.length === 0) {
        console.error("🔴 FATAL: dataSource === 'market' but rawRainforestListings.length === 0", {
          keyword: body.input_value,
          dataSource,
          rawRainforestListings_count: rawRainforestListings.length,
          has_keywordMarketData: !!keywordMarketData,
          keywordMarketData_listings_count: keywordMarketData?.listings?.length || 0,
          timestamp: new Date().toISOString(),
        });
        // Return error - do NOT fallback to estimated products
        return NextResponse.json(
          {
            success: false,
            error: "Market data routing error: No raw Rainforest listings found",
            details: "dataSource is 'market' but no real listings were fetched",
          },
          { status: 500, headers: res.headers }
        );
      }
    }
    
    // CRITICAL: keywordMarketData must never be null at this point
    // BUT: Do NOT generate estimated products if dataSource === "market"
    if (!keywordMarketData) {
      if (dataSource === "market") {
        console.error("🔴 FATAL: dataSource === 'market' but keywordMarketData is null", {
          keyword: body.input_value,
          dataSource,
          rawRainforestListings_count: rawRainforestListings.length,
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json(
          {
            success: false,
            error: "Market data routing error: keywordMarketData is null",
            details: "dataSource is 'market' but keywordMarketData was not set",
          },
          { status: 500, headers: res.headers }
        );
      }
      
      // Only allow fallback for snapshot/estimated dataSource
      console.error("❌ FATAL: keywordMarketData is null - this should never happen");
      // Emergency fallback - create Tier-1 on the fly (ONLY for snapshot/estimated)
      const { buildTier1Snapshot } = await import("@/lib/snapshots/tier1Estimate");
      const normalizedKeyword = body.input_value.toLowerCase().trim();
      const emergencyTier1 = buildTier1Snapshot(normalizedKeyword);
      
      // Compute min/max values using deterministic logic
      const estUnitsPerListing = 150;
      const page1Count = emergencyTier1.product_count;
      const totalUnits = page1Count * estUnitsPerListing;
      const unitsMin = Math.round(totalUnits * 0.7);
      const unitsMax = Math.round(totalUnits * 1.3);
      const revenueMin = Math.round((unitsMin * emergencyTier1.average_price) * 100) / 100;
      const revenueMax = Math.round((unitsMax * emergencyTier1.average_price) * 100) / 100;
      
      // GUARANTEED PRODUCT FALLBACK: Generate representative products for emergency fallback
      const emergencyListings = generateRepresentativeProducts({
        avg_price: emergencyTier1.average_price,
        est_total_monthly_units_min: unitsMin,
        est_total_monthly_units_max: unitsMax,
        total_page1_listings: emergencyTier1.product_count,
        avg_reviews: 0,
        avg_rating: null,
      }, emergencyTier1.keyword);
      
      console.log("GUARANTEED_FALLBACK: Emergency fallback - generated representative products", {
        count: emergencyListings.length,
        keyword: emergencyTier1.keyword,
      });
      
      keywordMarketData = {
        snapshot: {
          keyword: emergencyTier1.keyword,
          avg_price: emergencyTier1.average_price,
          avg_reviews: 0,
          avg_rating: null,
          avg_bsr: emergencyTier1.average_bsr,
          total_page1_listings: emergencyTier1.product_count,
          sponsored_count: 0,
          dominance_score: 0,
          fulfillment_mix: { fba: 0, fbm: 0, amazon: 0 },
          est_total_monthly_revenue_min: revenueMin,
          est_total_monthly_revenue_max: revenueMax,
          est_total_monthly_units_min: unitsMin,
          est_total_monthly_units_max: unitsMax,
          search_demand: null,
        },
        listings: emergencyListings, // GUARANTEED: Never empty
      };
      snapshotStatus = 'estimated'; // Mark as estimated for emergency fallback
    }
    
    // FINAL GUARANTEE: Ensure listings are never empty before proceeding
    // BUT: Do NOT generate estimated products if dataSource === "market"
    if (!keywordMarketData.listings || keywordMarketData.listings.length === 0) {
      if (dataSource === "market") {
        console.error("🔴 FATAL: dataSource === 'market' but listings array is empty", {
          keyword: body.input_value,
          dataSource,
          rawRainforestListings_count: rawRainforestListings.length,
          has_keywordMarketData: !!keywordMarketData,
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json(
          {
            success: false,
            error: "Market data routing error: Listings array is empty",
            details: "dataSource is 'market' but keywordMarketData.listings is empty",
          },
          { status: 500, headers: res.headers }
        );
      }
      
      // Only allow fallback for snapshot/estimated dataSource
      console.error("CRITICAL: listings array is empty - applying final fallback");
      keywordMarketData.listings = generateRepresentativeProducts(
        keywordMarketData.snapshot,
        keywordMarketData.snapshot.keyword
      );
      console.log("FINAL_FALLBACK: Generated", keywordMarketData.listings.length, "representative products");
    }

    // Determine data source: market (real) vs snapshot (estimated)
    // CRITICAL: If dataSource is "market", listings are real and must be used
    const isEstimated = dataSource === "snapshot" && (snapshotStatus === 'estimated' || snapshotStatus === 'miss');
    const dataQuality = {
      snapshot: snapshotStatus,
      source: dataSource === "market" ? "market" : (isEstimated ? 'estimated' : 'precomputed'),
      fallback_used: false,
      estimated: isEstimated,
    };
    
    // Use the snapshot (guaranteed to exist after snapshot check)
    const marketSnapshot = keywordMarketData.snapshot;
    const marketSnapshotJson = keywordMarketData.snapshot;
    
    // CPI calculation moved to after canonical Page-1 build
    // (Will be calculated from canonical products after they're built)

    // 8. Build data contract response BEFORE AI call
    // This ensures we have the structured data to pass to AI via ai_context
    let contractResponse: any = null;
    let marginSnapshot: any = null;
    
    // First, calculate margin snapshot (needed for contract response)
    try {
      const priceForMargin = marketSnapshot?.avg_price || 25.0;
      
      // Fetch FBA fees first (needed for margin calculation)
      let fbaFees: { total_fba_fees: number | null; source: "sp_api" | "estimated" | "unknown" } | null = null;
      
      if (keywordMarketData && marketSnapshot) {
        const representativeAsin = pickRepresentativeAsin(keywordMarketData.listings);
        if (representativeAsin) {
          const fbaFeesResult = await resolveFbaFees(representativeAsin, priceForMargin);
          if (fbaFeesResult) {
            fbaFees = {
              total_fba_fees: fbaFeesResult.total_fba_fees,
              source: "sp_api",
            };
          }
        }
      }
      
      // Build margin snapshot
      marginSnapshot = buildMarginSnapshot({
        analysisMode: 'KEYWORD',
        sellerProfile: {
          sourcing_model: sellerProfile.sourcing_model as any,
        },
        asinSnapshot: null,
        marketSnapshot: marketSnapshot ? {
          avg_price: marketSnapshot.avg_price,
        } : null,
        fbaFees,
        userOverrides: null,
      });
    } catch (error) {
      console.error("Margin snapshot calculation error:", error);
      // Create default margin snapshot
      marginSnapshot = buildMarginSnapshot({
        analysisMode: 'KEYWORD',
        sellerProfile: {
          sourcing_model: sellerProfile.sourcing_model as any,
        },
        asinSnapshot: null,
        marketSnapshot: null,
        fbaFees: null,
        userOverrides: null,
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REMOVED: Fatal invariants for keyword analysis
    // Keyword analysis is permissive and must not hard-fail
    // ═══════════════════════════════════════════════════════════════════════════
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CANONICAL PRODUCTS (FINAL AUTHORITY) - Declare at function scope
    // ═══════════════════════════════════════════════════════════════════════════
    let canonicalProducts: any[] = [];
    
    // Build contract-compliant response
    if (keywordMarketData) {
      // CANONICAL PAGE-1 BUILDER: Replace raw listings with deterministic Page-1 reconstruction
      // CRITICAL: This MUST run when dataSource === "market"
      console.log("🔵 CANONICAL_PAGE1_BUILD_START", {
        keyword: body.input_value,
        dataSource,
        raw_listings_count: keywordMarketData.listings?.length || 0,
        rawRainforestListings_count: rawRainforestListings.length,
        snapshot_avg_price: keywordMarketData.snapshot?.avg_price,
        snapshot_total_units: keywordMarketData.snapshot?.est_total_monthly_units_min,
        snapshot_total_revenue: keywordMarketData.snapshot?.est_total_monthly_revenue_min,
        timestamp: new Date().toISOString(),
      });
      
      // ═══════════════════════════════════════════════════════════════════════════
      // STEP 2 — CONFIRM CANONICAL PAGE-1 INPUT
      // ═══════════════════════════════════════════════════════════════════════════
      // Log the input passed into the canonical Page-1 builder
      const inputListings = keywordMarketData.listings || [];
      const first5Input = inputListings.slice(0, 5);
      console.log("🔍 STEP_2_CANONICAL_PAGE1_INPUT", {
        keyword: body.input_value,
        total_listings: inputListings.length,
        first_5_listings: first5Input.map((listing: any, idx: number) => ({
          index: idx + 1,
          asin: listing.asin || null,
          price: listing.price || null,
          rating: listing.rating || null,
          reviews: listing.reviews || null,
          bsr: listing.main_category_bsr || listing.bsr || null,
          image_url: listing.image_url || listing.image || null,
        })),
        timestamp: new Date().toISOString(),
      });
      
      // ═══════════════════════════════════════════════════════════════════════════
      // ROUTE CANONICAL LOGIC BY INPUT TYPE
      // ═══════════════════════════════════════════════════════════════════════════
      
      let rawListings = keywordMarketData.listings || [];
      let pageOneProducts: any[] = [];
      
      console.log("🔵 INPUT_TYPE_RECEIVED", body.input_type);
      console.log("🔵 RAW_LISTINGS_LENGTH_BEFORE_CANONICAL", rawListings.length);
      
      // ═══════════════════════════════════════════════════════════════════════════
      // ASIN METADATA ENRICHMENT (DECOUPLED FROM SNAPSHOT FINALIZATION)
      // ═══════════════════════════════════════════════════════════════════════════
      // CRITICAL: Enrich metadata BEFORE building canonical products.
      // This ensures metadata is populated regardless of:
      // - Snapshot finalization state
      // - Snapshot estimating state
      // - Inferred state
      // - Expected ASIN count
      // - Mixed category detection
      // 
      // Metadata enrichment runs as soon as ASINs are discovered, not gated behind
      // snapshot finalization. This fixes issues like "food warming mat" where
      // snapshot never finalizes but ASINs still need metadata.
      if (rawListings.length > 0) {
        // 🚨 API SAFETY LIMIT: Use shared counter (already tracks search + BSR calls)
        const { enrichListingsMetadata } = await import("@/lib/amazon/keywordMarket");
        rawListings = await enrichListingsMetadata(rawListings, body.input_value, undefined, apiCallCounter);
        console.log("✅ METADATA_ENRICHMENT_COMPLETE_BEFORE_CANONICAL", {
          keyword: body.input_value,
          enriched_listings_count: rawListings.length,
          sample_listing: rawListings[0] ? {
            asin: rawListings[0].asin,
            has_title: !!rawListings[0].title,
            has_image: !!rawListings[0].image_url,
            has_rating: rawListings[0].rating !== null,
            has_reviews: rawListings[0].reviews !== null,
            has_brand: !!rawListings[0].brand,
            brand: rawListings[0].brand,
          } : null,
          brand_sample: rawListings.slice(0, 5).map((l: any) => ({
            asin: l.asin,
            brand: l.brand,
          })),
        });
      }
      
      if (body.input_type === "keyword") {
        // Keyword analysis: Use permissive canonical builder
        console.log("🔵 CALLING_CANONICAL_BUILDER: keyword (buildKeywordPageOne)");
        console.log("✅ KEYWORD CANONICAL BUILD START", {
          keyword: body.input_value,
          raw_listings_count: rawListings.length,
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // STEP 1: Log raw brand data before normalization
        // ═══════════════════════════════════════════════════════════════════════════
        console.log("🟣 RAW BRAND SAMPLE", rawListings.slice(0, 5).map((l: any) => ({
          asin: l.asin,
          brand: l.brand,
          brand_name: l.brand_name,
          seller: l.seller?.name,
        })));
        
        // ═══════════════════════════════════════════════════════════════════════════
        // STEP 4: Log BEFORE canonical builder
        // ═══════════════════════════════════════════════════════════════════════════
        console.log("🔧 BEFORE CANONICAL BUILDER", {
          listingsCount: rawListings.length,
          fieldsPresent: {
            image: rawListings.some((l: any) => !!l.image_url),
            brand: rawListings.some((l: any) => !!l.brand),
            fulfillment: rawListings.some((l: any) => !!l.fulfillment),
            rating: rawListings.some((l: any) => !!l.rating),
          },
        });
        
        // Get search volume for keyword demand scaling
        let searchVolumeLow: number | undefined;
        let searchVolumeHigh: number | undefined;
        
        if (keywordMarketData.snapshot?.search_demand?.search_volume_range) {
          // Parse search volume range (e.g., "10k–20k", "1.5M–2M")
          const parseRange = (rangeStr: string): { min: number; max: number } => {
            const match = rangeStr.match(/(\d+(?:\.\d+)?)([kM]?)\s*[–-]\s*(\d+(?:\.\d+)?)([kM]?)/);
            if (match) {
              const min = parseFloat(match[1]) * (match[2] === 'M' ? 1000000 : match[2] === 'k' ? 1000 : 1);
              const max = parseFloat(match[3]) * (match[4] === 'M' ? 1000000 : match[4] === 'k' ? 1000 : 1);
              return { min: Math.round(min), max: Math.round(max) };
            }
            return { min: 0, max: 0 };
          };
          
          const parsed = parseRange(keywordMarketData.snapshot.search_demand.search_volume_range);
          searchVolumeLow = parsed.min;
          searchVolumeHigh = parsed.max;
        } else if (rawListings.length > 0) {
          // Estimate search volume from listings if not available in snapshot
          const { estimateSearchVolume } = await import("@/lib/amazon/searchVolumeEstimator");
          const estimated = estimateSearchVolume({
            page1Listings: rawListings,
            sponsoredCount: keywordMarketData.snapshot?.sponsored_count || 0,
            avgReviews: keywordMarketData.snapshot?.avg_reviews || 0,
          });
          searchVolumeLow = estimated.min;
          searchVolumeHigh = estimated.max;
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // BRAND FREQUENCY RESOLUTION (AFTER metadata enrichment, BEFORE canonical builder)
        // ═══════════════════════════════════════════════════════════════════════════
        // Remove junk brands extracted from titles (e.g., "Under Sink Organizer", "Multi")
        // while preserving real brands. A brand is valid if:
        // - It appears 2+ times (frequency indicates it's real), OR
        // - Any listing has it from metadata enrichment (API source is authoritative)
        // This is a logic-only fix - no API calls.
        const { resolveBrandFrequency } = await import("@/lib/amazon/resolveBrandFrequency");
        rawListings = resolveBrandFrequency(rawListings);
        
        pageOneProducts = buildKeywordPageOne(rawListings, searchVolumeLow, searchVolumeHigh);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // STEP 2: Log normalized brand data after canonical builder
        // ═══════════════════════════════════════════════════════════════════════════
        console.log("🟢 NORMALIZED BRAND SAMPLE", pageOneProducts.slice(0, 5).map((p: any) => ({
          asin: p.asin,
          brand: p.brand,
        })));
        
        // ═══════════════════════════════════════════════════════════════════════════
        // STEP 5: Log AFTER canonical builder
        // ═══════════════════════════════════════════════════════════════════════════
        console.log("✅ AFTER CANONICAL BUILDER", {
          listingsCount: pageOneProducts.length,
          sample: pageOneProducts.slice(0, 3).map((p: any) => ({
            asin: p.asin,
            brand: p.brand,
            image_url: p.image_url,
            fulfillment: p.fulfillment,
            rating: p.rating,
            review_count: p.review_count,
          })),
          imageMissingCount: pageOneProducts.filter((p: any) => !p.image_url).length,
          brandMissingCount: pageOneProducts.filter((p: any) => !p.brand).length,
          fbaCount: pageOneProducts.filter((p: any) => p.fulfillment === "FBA").length,
        });
        
        console.log("✅ KEYWORD PAGE-1 COUNT", pageOneProducts.length);
        if (pageOneProducts.length > 0) {
          console.log("📦 SAMPLE CANONICAL PRODUCT", pageOneProducts[0]);
        } else {
          console.log("❌ KEYWORD CANONICAL EMPTY (NON-FATAL)", {
            keyword: body.input_value,
            raw_listings_count: rawListings.length,
          });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // APPLY KEYWORD CALIBRATION (DETERMINISTIC)
        // ═══════════════════════════════════════════════════════════════════════════
        // Apply calibration AFTER buildKeywordPageOne and BEFORE buildKeywordAnalyzeResponse
        // This adjusts canonical revenue based on keyword intent archetype and category
        if (pageOneProducts.length > 0) {
          try {
            const { applyKeywordCalibration } = await import("@/lib/amazon/keywordCalibration");
            
            // Extract category from listings (most common category)
            const categoryCounts = new Map<string, number>();
            for (const listing of rawListings) {
              const category = listing.main_category;
              if (category && category.trim()) {
                categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
              }
            }
            let mostCommonCategory: string | null = null;
            let maxCount = 0;
            for (const [category, count] of categoryCounts.entries()) {
              if (count > maxCount) {
                maxCount = count;
                mostCommonCategory = category;
              }
            }
            
            const calibrationResult = await applyKeywordCalibration(
              pageOneProducts,
              body.input_value,
              mostCommonCategory,
              supabase,
              rawListings
            );
            
            // Replace pageOneProducts with calibrated products
            pageOneProducts = calibrationResult.products;
            
            // Store calibration metadata for logging (will be added to ai_context)
            (pageOneProducts as any).__calibration_metadata = {
              applied: calibrationResult.calibration_applied,
              revenue_multiplier: calibrationResult.revenue_multiplier,
              units_multiplier: calibrationResult.units_multiplier,
              confidence: calibrationResult.confidence,
              source: calibrationResult.source,
            };
            
            console.log("✅ KEYWORD CALIBRATION APPLIED", {
              keyword: body.input_value,
              category: mostCommonCategory,
              calibration_applied: calibrationResult.calibration_applied,
              revenue_multiplier: calibrationResult.revenue_multiplier,
              units_multiplier: calibrationResult.units_multiplier,
              confidence: calibrationResult.confidence,
              source: calibrationResult.source,
            });
          } catch (error) {
            console.warn("⚠️ KEYWORD CALIBRATION ERROR (NON-FATAL)", {
              keyword: body.input_value,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue with uncalibrated products if calibration fails
          }
        }
      } else {
        // ASIN analysis: Use strict canonical builder
        console.log("🔵 CALLING_CANONICAL_BUILDER: asin (buildAsinPageOne)");
        pageOneProducts = await buildAsinPageOne(
          rawListings,
          keywordMarketData.snapshot,
          body.input_value,
          marketplace,
          undefined, // rawRainforestData
          supabase // supabase client for history blending
        );
      }
      
      console.log("🔵 PAGE_ONE_PRODUCTS_LENGTH_AFTER_CANONICAL", pageOneProducts.length);
      
      // Assign to function-scope variable (final authority)
      canonicalProducts = pageOneProducts;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // UPSERT canonical products to keyword_products cache
      // ═══════════════════════════════════════════════════════════════════════════
      if (canonicalProducts.length > 0 && body.input_type === "keyword") {
        try {
          const upsertData = canonicalProducts.map((p) => ({
            keyword: normalizedKeyword,
            asin: p.asin,
            rank: p.organic_rank ?? p.page_position ?? 1,
            price: p.price,
            estimated_monthly_units: p.estimated_monthly_units,
            estimated_monthly_revenue: p.estimated_monthly_revenue,
            rating: p.rating || null,
            review_count: p.review_count || null,
            fulfillment: p.fulfillment || null,
            last_updated: new Date().toISOString(),
          }));
          
          const { error: upsertError } = await supabase
            .from("keyword_products")
            .upsert(upsertData, {
              onConflict: "keyword,asin",
            });
          
          if (upsertError) {
            console.warn("Failed to cache keyword products:", upsertError);
          } else {
            console.log("KEYWORD_PRODUCTS_CACHE_WRITE", {
              keyword: normalizedKeyword,
              product_count: upsertData.length,
            });
          }
        } catch (error) {
          console.warn("Error caching keyword products:", error);
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // CANONICAL PAGE-1 IS FINAL AUTHORITY - NO CONVERSION, NO REBUILDING
      // ═══════════════════════════════════════════════════════════════════════════
      // For keyword analysis: Pass canonical products directly to data contract
      // DO NOT convert back to listings, DO NOT rebuild products
      
      try {
        // Convert marketplace domain to Marketplace type (default to "US")
        const marketplaceCode: "US" | "CA" | "UK" | "EU" | "AU" = "US";
        
        // Pass canonical products directly to data contract builder
        // This ensures canonical products are the final authority
        // v1: No refined data - canonical revenue only
        contractResponse = await buildKeywordAnalyzeResponse(
          body.input_value,
          keywordMarketData,
          marginSnapshot,
          marketplaceCode,
          "USD",
          supabase, // supabase client for keyword history blending
          canonicalProducts, // CANONICAL PAGE-1 PRODUCTS (FINAL AUTHORITY)
          0 // refinedDataCount - v1 does not support refinement
        );
        
        // Canonical products are already set in contractResponse - no replacement needed
        console.log("✅ CANONICAL_PAGE1_INJECTED_INTO_CONTRACT", {
          canonical_count: canonicalProducts.length,
          contract_products_count: contractResponse.products?.length || 0,
          contract_page_one_listings_count: contractResponse.page_one_listings?.length || 0,
        });
        
        console.log("CONTRACT_RESPONSE_BUILT", {
          has_products: !!contractResponse?.products,
          product_count: contractResponse?.products?.length || 0,
          has_summary: !!contractResponse?.summary,
          has_market_structure: !!contractResponse?.market_structure,
        });
        
        // Calculate CPI from original raw listings (before canonical build)
        // CPI is competitive analysis, not Page-1 display, so use original data
        if (rawListings && rawListings.length > 0) {
          try {
            const cpiResult = calculateCPI({
              listings: rawListings, // Use original listings for competitive analysis
              sellerStage: sellerProfile.stage as "new" | "existing" | "scaling",
              sellerExperienceMonths: sellerProfile.experience_months,
            });
            
            // Inject CPI into market snapshot
            if (marketSnapshot) {
              (marketSnapshot as any).cpi = {
                score: cpiResult.score,
                label: cpiResult.label,
                breakdown: cpiResult.breakdown,
              };
            }
          } catch (cpiError) {
            console.error("CPI calculation error:", cpiError);
            if (marketSnapshot) {
              (marketSnapshot as any).cpi = null;
            }
          }
        } else {
          // No listings → CPI = null
          if (marketSnapshot) {
            (marketSnapshot as any).cpi = null;
          }
        }
      } catch (contractError) {
        console.error("CONTRACT_BUILD_ERROR", {
          error: contractError,
          message: contractError instanceof Error ? contractError.message : String(contractError),
          stack: contractError instanceof Error ? contractError.stack : undefined,
        });
        // Continue without contractResponse - will use keywordMarket instead
        contractResponse = null;
      }
    }
    
    // Guard: Ensure required data before AI call
    if (!sellerProfile) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/2d717643-6e0f-44e0-836b-7d7b2c0dda42',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/analyze/route.ts:1014',message:'Missing seller profile - early return',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      throw new Error("Missing seller profile");
    }
    if (!marketSnapshot) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/2d717643-6e0f-44e0-836b-7d7b2c0dda42',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/analyze/route.ts:1017',message:'Missing market snapshot - early return',data:{has_keywordMarketData:!!keywordMarketData},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      throw new Error("Missing market snapshot");
    }

    console.log("AI_TWO_PASS_START");

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { success: false, error: "OpenAI API key not configured" },
        { status: 500, headers: res.headers }
      );
    }

    // ============================================================================
    // PASS 1: Decision Brain - Plain text verdict and reasoning
    // ============================================================================
    
    // Build PASS 1 system prompt with ai_context
    let decisionBrainPrompt = DECISION_BRAIN_PROMPT;
    if (contractResponse && contractResponse.ai_context) {
      const aiContextSection = `

MARKET DATA CONTEXT (READ-ONLY):

You MUST use ONLY the following market data. This is the single source of truth.
Do NOT reference data outside this context. Do NOT invent metrics.

${JSON.stringify(contractResponse.ai_context, null, 2)}

CRITICAL RULES:
- All reasoning MUST be based on the market data above
- Use metrics to explain market structure (competition intensity, review barrier, price compression, dominance)
- Do NOT restate metrics as lists - use them to support structure reasoning`;
      decisionBrainPrompt = DECISION_BRAIN_PROMPT + aiContextSection;
    }

    // Build user message for PASS 1
    const pass1UserMessage = `SELLER CONTEXT:
- Stage: ${sellerContext.stage}
- Experience (months): ${sellerContext.experience_months ?? "null"}
- Monthly revenue range: ${sellerContext.monthly_revenue_range ?? "null"}

ANALYSIS REQUEST:
${body.input_value}`;

    console.log("PASS1_DECISION_BRAIN_CALL");

    const pass1Response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: decisionBrainPrompt },
            { role: "user", content: pass1UserMessage },
          ],
          // NO response_format - plain text output
          temperature: 0.7,
        }),
      }
    );

    if (!pass1Response.ok) {
      const errorData = await pass1Response.text();
      return NextResponse.json(
        {
          success: false,
          error: `OpenAI API error (PASS 1): ${pass1Response.statusText}`,
          details: errorData,
        },
        { status: 500, headers: res.headers }
      );
    }

    const pass1Data = await pass1Response.json();
    const decisionBrainOutput = pass1Data.choices?.[0]?.message?.content;

    console.log("PASS1_DECISION_BRAIN_OUTPUT", decisionBrainOutput?.substring(0, 500));

    if (!decisionBrainOutput) {
      return NextResponse.json(
        { success: false, error: "No content in PASS 1 OpenAI response" },
        { status: 500, headers: res.headers }
      );
    }

    // ============================================================================
    // PASS 2: Structuring Brain - Convert plain text to JSON contract
    // ============================================================================

    // Build PASS 2 system prompt with ai_context
    let structuringBrainPrompt = STRUCTURING_BRAIN_PROMPT;
    if (contractResponse && contractResponse.ai_context) {
      const aiContextSection = `

AI_CONTEXT (for numbers_used population):

${JSON.stringify(contractResponse.ai_context, null, 2)}

Extract all numeric metrics from ai_context and populate numbers_used accordingly.`;
      structuringBrainPrompt = STRUCTURING_BRAIN_PROMPT + aiContextSection;
    }

    // Build user message for PASS 2
    const pass2UserMessage = `DECISION BRAIN OUTPUT:

${decisionBrainOutput}

Convert this plain text decision into the required JSON contract format. Extract verdict, reasoning, risks, recommended actions, and populate numbers_used from ai_context.`;

    console.log("PASS2_STRUCTURING_BRAIN_CALL");

    const pass2Response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: structuringBrainPrompt },
            { role: "user", content: pass2UserMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3, // Lower temperature for structured output
        }),
      }
    );

    if (!pass2Response.ok) {
      const errorData = await pass2Response.text();
      return NextResponse.json(
        {
          success: false,
          error: `OpenAI API error (PASS 2): ${pass2Response.statusText}`,
          details: errorData,
        },
        { status: 500, headers: res.headers }
      );
    }

    const pass2Data = await pass2Response.json();
    const pass2Content = pass2Data.choices?.[0]?.message?.content;

    console.log("PASS2_STRUCTURING_BRAIN_OUTPUT", pass2Content?.substring(0, 500));

    if (!pass2Content) {
      return NextResponse.json(
        { success: false, error: "No content in PASS 2 OpenAI response" },
        { status: 500, headers: res.headers }
      );
    }

    // Parse and validate PASS 2 JSON output
    let decisionJson: any;
    try {
      // Remove markdown code blocks if present
      const cleanedContent = pass2Content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      decisionJson = JSON.parse(cleanedContent);
      
      // Log the parsed JSON structure for debugging
      console.log("PASS2_PARSED_JSON", {
        keys: Object.keys(decisionJson),
        has_decision: !!decisionJson.decision,
        decision_keys: decisionJson.decision ? Object.keys(decisionJson.decision) : [],
        has_reasoning: !!decisionJson.reasoning,
        reasoning_keys: decisionJson.reasoning ? Object.keys(decisionJson.reasoning) : [],
        has_risks: !!decisionJson.risks,
        risks_keys: decisionJson.risks ? Object.keys(decisionJson.risks) : [],
      });
    } catch (parseError) {
      console.error("PASS2_JSON_PARSE_ERROR", {
        error: parseError,
        content_preview: pass2Content.substring(0, 500),
      });
      return NextResponse.json(
        {
          success: false,
          error: "PASS 2 returned invalid JSON",
          details: pass2Content.substring(0, 200),
        },
        { status: 500, headers: res.headers }
      );
    }

    // 10. Validate decision contract structure
    if (!validateDecisionContract(decisionJson)) {
      // Enhanced error logging
      const receivedKeys = Object.keys(decisionJson);
      const missingKeys = REQUIRED_DECISION_KEYS.filter(key => !receivedKeys.includes(key));
      const extraKeys = receivedKeys.filter(key => !REQUIRED_DECISION_KEYS.includes(key));
      
      console.error("DECISION_CONTRACT_VALIDATION_FAILED", {
        received_keys: receivedKeys,
        required_keys: REQUIRED_DECISION_KEYS,
        missing_keys: missingKeys,
        extra_keys: extraKeys,
        decision_structure: decisionJson.decision ? {
          has_verdict: 'verdict' in decisionJson.decision,
          has_confidence: 'confidence' in decisionJson.decision,
          verdict_value: decisionJson.decision.verdict,
          confidence_value: decisionJson.decision.confidence,
        } : null,
        reasoning_structure: decisionJson.reasoning ? {
          has_primary_factors: 'primary_factors' in decisionJson.reasoning,
          has_seller_context_impact: 'seller_context_impact' in decisionJson.reasoning,
        } : null,
        risks_structure: decisionJson.risks ? {
          keys: Object.keys(decisionJson.risks),
          has_competition: 'competition' in decisionJson.risks,
          has_pricing: 'pricing' in decisionJson.risks,
          has_differentiation: 'differentiation' in decisionJson.risks,
          has_operations: 'operations' in decisionJson.risks,
        } : null,
      });
      
      return NextResponse.json(
        {
          success: false,
          error: "OpenAI output does not match decision contract. Missing required keys or invalid structure.",
          received_keys: receivedKeys,
          required_keys: REQUIRED_DECISION_KEYS,
          missing_keys: missingKeys,
          extra_keys: extraKeys,
        },
        { status: 500, headers: res.headers }
      );
    }

    console.log("PASS2_VALIDATED");

    // 10.5. Normalize risks to ensure stable contract (all 4 keys always present)
    const normalizedRisks = normalizeRisks(decisionJson.risks);

    // 11. Apply confidence caps and downgrades (PASS 2 ONLY)
    // Note: Confidence is set by Structuring Brain, but we apply caps here
    const verdict = decisionJson.decision.verdict;
    let confidence = decisionJson.decision.confidence;
    const confidenceDowngrades: string[] = [];
    
    // KEYWORD MODE: Apply keyword-specific confidence rules
    // Rule 1: Keyword searches always start at max 75%
    if (confidence > 75) {
      confidence = 75;
      confidenceDowngrades.push("Keyword searches capped at 75% maximum confidence");
    }

    // Rule 4: Sparse page-1 data → downgrade
    if (marketSnapshot) {
      const totalListings = marketSnapshot.total_page1_listings || 0;
      if (totalListings < 5) {
        confidence = Math.min(confidence, 40);
        confidenceDowngrades.push("Sparse Page 1 data (< 5 listings)");
      } else if (totalListings < 10) {
        confidence = Math.min(confidence, 60);
        if (!confidenceDowngrades.some(d => d.includes("Limited") || d.includes("Sparse"))) {
          confidenceDowngrades.push("Limited Page 1 data (< 10 listings)");
        }
      }
    }

    // Apply final downgraded confidence
    decisionJson.decision.confidence = Math.round(confidence);
    
    // Store downgrade reasons for chat explanations
    if (confidenceDowngrades.length > 0) {
      decisionJson.confidence_downgrades = confidenceDowngrades;
    }

    // 12a. Ensure numbers_used is populated (PASS 2 should populate from ai_context, but ensure completeness)
    // Fallback: If PASS 2 didn't populate or missed fields, fill from contractResponse
    if (contractResponse) {
      if (!decisionJson.numbers_used) {
        decisionJson.numbers_used = {
          avg_price: null,
          price_range: null,
          median_reviews: null,
          review_density_pct: null,
          brand_concentration_pct: null,
          competitor_count: null,
          avg_rating: null,
        };
      }
      // Ensure all fields are populated (override nulls with contract data if available)
      if (decisionJson.numbers_used.avg_price === null) {
        decisionJson.numbers_used.avg_price = contractResponse.summary.avg_price;
      }
      if (decisionJson.numbers_used.price_range === null) {
        decisionJson.numbers_used.price_range = [
          contractResponse.market_structure.price_band.min,
          contractResponse.market_structure.price_band.max,
        ];
      }
      if (decisionJson.numbers_used.median_reviews === null) {
        decisionJson.numbers_used.median_reviews = contractResponse.market_structure.review_barrier.median_reviews;
      }
      if (decisionJson.numbers_used.brand_concentration_pct === null) {
        decisionJson.numbers_used.brand_concentration_pct = contractResponse.market_structure.brand_dominance_pct;
      }
      if (decisionJson.numbers_used.competitor_count === null) {
        decisionJson.numbers_used.competitor_count = contractResponse.summary.page1_product_count;
      }
      if (decisionJson.numbers_used.avg_rating === null) {
        decisionJson.numbers_used.avg_rating = contractResponse.summary.avg_rating;
      }
      // review_density_pct is not in contract, keep as null
    } else {
      // Ensure numbers_used exists even if no contract data
      if (!decisionJson.numbers_used) {
        decisionJson.numbers_used = {
          avg_price: null,
          price_range: null,
          median_reviews: null,
          review_density_pct: null,
          brand_concentration_pct: null,
          competitor_count: null,
          avg_rating: null,
        };
      }
    }
    
    // 12b. LOCK KEYWORD ANALYZE DATA CONTRACT (runtime validation)
    // Build keywordMarket object with required structure for UI
    let keywordMarket: any = null;
    
    // Get canonical products if available (for use in keywordMarket listings)
    let canonicalProductsForListings: any[] | null = null;
    if (contractResponse?.page_one_listings && contractResponse.page_one_listings.length > 0) {
      canonicalProductsForListings = contractResponse.page_one_listings;
    } else if (contractResponse?.products && contractResponse.products.length > 0) {
      canonicalProductsForListings = contractResponse.products;
    }
    
    if (keywordMarketData) {
      const listings = keywordMarketData.listings || [];
      const snapshot = keywordMarketData.snapshot;
      
      // Validate listings exist - log structured error if empty
      if (!listings || listings.length === 0) {
        const search_term = body.input_value;
        const domain = "amazon.com";
        const raw_counts = {
          total_results: listings.length,
          snapshot_listings: snapshot?.total_page1_listings || 0,
        };
        const first_result_keys = listings.length > 0 && listings[0]
          ? Object.keys(listings[0])
          : [];
        
        console.error("KEYWORD_SNAPSHOT_EMPTY", {
          search_term,
          domain,
          raw_counts,
          first_result_keys,
        });
      }
      
      // Build keywordMarket with LOCKED DATA CONTRACT
      // market_snapshot must ALWAYS have required fields with NO nulls when listings exist
      const hasListings = listings.length > 0;
      
      // FORCE SEARCH VOLUME TO ALWAYS RENDER (Step 3)
      // Priority: 1) Cached/SP-API, 2) Rainforest proxy, 3) Modeled fallback
      let searchVolume: { min: number; max: number; source: "sp_api" | "historical" | "modeled"; confidence: "high" | "medium" | "low" };
      
      // Try to parse from search_demand if available
      const parseRange = (rangeStr: string): { min: number; max: number } => {
        const match = rangeStr.match(/(\d+(?:\.\d+)?)([kM]?)\s*[–-]\s*(\d+(?:\.\d+)?)([kM]?)/);
        if (match) {
          const min = parseFloat(match[1]) * (match[2] === 'M' ? 1000000 : match[2] === 'k' ? 1000 : 1);
          const max = parseFloat(match[3]) * (match[4] === 'M' ? 1000000 : match[4] === 'k' ? 1000 : 1);
          return { min: Math.round(min), max: Math.round(max) };
        }
        return { min: 0, max: 0 };
      };
      
      if (snapshot.search_demand?.search_volume_range) {
        const parsed = parseRange(snapshot.search_demand.search_volume_range);
        searchVolume = {
          ...parsed,
          source: "historical" as const,
          confidence: snapshot.search_demand.search_volume_confidence === "medium" ? "medium" : "low",
        };
      } else if (hasListings) {
        // Use estimator with real listings
        const { estimateSearchVolume } = await import("@/lib/amazon/searchVolumeEstimator");
        const estimated = estimateSearchVolume({
          page1Listings: listings,
          sponsoredCount: snapshot.sponsored_count || 0,
          avgReviews: snapshot.avg_reviews || 0,
        });
        searchVolume = {
          ...estimated,
          source: "modeled" as const,
        };
      } else {
        // Use fallback estimator when no listings
        const { estimateSearchVolumeFallback } = await import("@/lib/amazon/marketFallbacks");
        const fallback = estimateSearchVolumeFallback(0, null);
        searchVolume = fallback;
      }
      
      // Ensure avg_reviews is always a number (never null)
      const avgReviews = snapshot.avg_reviews !== null && snapshot.avg_reviews !== undefined
        ? snapshot.avg_reviews
        : 0;
      
      // Ensure avg_price is always a number (never null) - use 0 as fallback if needed
      const avgPrice = snapshot.avg_price !== null && snapshot.avg_price !== undefined
        ? snapshot.avg_price
        : 0;
      
      // Ensure avg_rating is always a number (never null) - use 0 as fallback if needed
      const avgRating = snapshot.avg_rating !== null && snapshot.avg_rating !== undefined
        ? snapshot.avg_rating
        : 0;
      
      // FORCE FULFILLMENT MIX TO ALWAYS RENDER (Step 4)
      // Add source tracking: "real" if from Rainforest, "estimated" if fallback
      const fulfillmentMix = snapshot.fulfillment_mix || { fba: 65, fbm: 25, amazon: 10 };
      const fulfillmentMixWithSource = {
        ...fulfillmentMix,
        source: hasListings && snapshot.fulfillment_mix ? "real" as const : "estimated" as const,
      };
      
      keywordMarket = {
        market_snapshot: {
          // LOCKED DATA CONTRACT - Required fields, no nulls when listings exist
          // These fields MUST always be present and never null
          search_volume: searchVolume, // { min, max, source, confidence } - ALWAYS present
          avg_reviews: avgReviews, // number (never null, 0 if no valid reviews)
          avg_price: avgPrice, // number (never null, 0 if no prices)
          avg_rating: avgRating, // number (never null, 0 if no ratings)
          fulfillment_mix: fulfillmentMixWithSource, // { fba, fbm, amazon, source } - ALWAYS present
          page1_count: snapshot.total_page1_listings || 0, // number (never null)
          
          // Monthly units and revenue estimates (ALWAYS present, never null)
          // Use computed values from keywordMarketData.snapshot which has our calculated min/max
          est_total_monthly_units_min: snapshot.est_total_monthly_units_min ?? 0,
          est_total_monthly_units_max: snapshot.est_total_monthly_units_max ?? snapshot.est_total_monthly_units_min ?? 0,
          est_total_monthly_revenue_min: snapshot.est_total_monthly_revenue_min ?? 0,
          est_total_monthly_revenue_max: snapshot.est_total_monthly_revenue_max ?? snapshot.est_total_monthly_revenue_min ?? 0,
          
          // Additional fields (optional but included for compatibility)
          marketplace: "US",
          search_term: body.input_value,
          page: 1,
          total_results_estimate: null,
          sponsored_count: snapshot.sponsored_count || 0,
          avg_bsr: snapshot.avg_bsr || null,
          dominance_score: snapshot.dominance_score || null,
          // Use canonical products for listings (ensures UI, aggregates, and cards all derive from ONE canonical Page-1 array)
          // CRITICAL: If canonicalProductsForListings exists (even if empty), use it - never fallback to raw listings
          listings: (canonicalProductsForListings && canonicalProductsForListings.length > 0 ? canonicalProductsForListings.map((p: any) => ({
            asin: p.asin,
            title: p.title,
            price: p.price,
            rating: p.rating,
            reviews: p.review_count,
            is_sponsored: false,
            position: p.rank,
            brand: p.brand,
            image_url: p.image_url,
            bsr: p.bsr,
            main_category_bsr: p.bsr,
            main_category: null,
            fulfillment: p.fulfillment === "FBA" ? "FBA" : p.fulfillment === "AMZ" ? "Amazon" : "FBM",
            est_monthly_revenue: p.estimated_monthly_revenue,
            est_monthly_units: p.estimated_monthly_units,
            revenue_confidence: p.snapshot_inferred ? "low" as const : "medium" as const,
          })) : (listings && listings.length > 0 ? listings : [])).map((listing: any) => {
            const normalized = normalizeListing(listing);
            return {
              asin: normalized.asin,
              title: normalized.title,
              brand: normalized.brand || null,
              price: normalized.price,
              rating: normalized.rating,
              reviews: normalized.reviews,
              bsr: normalized.bsr,
              organic_rank: normalized.organic_rank,
              fulfillment: normalized.fulfillment,
              image: normalized.image,
              is_sponsored: normalized.sponsored,
              revenue_est: listing.est_monthly_revenue || null,
              units_est: listing.est_monthly_units || null,
              revenue_share: null,
            };
          }),
        },
      };
    }
    
    // 12c. Build final response structure with contract-compliant data
    // Store AI decision separately from raw data contract
    // Note: contractResponse was built earlier (before AI call) with margin snapshot
    
    // FINAL GUARANTEE: Use canonical products for final response
    // Canonical products are already built and guaranteed to have ~20 items
    let finalListings: any[] = [];
    
    // Priority 1: Use canonical products from contract response (most reliable)
    if (contractResponse?.products && contractResponse.products.length > 0) {
      finalListings = contractResponse.products.map((p: any) => ({
        asin: p.asin || null,
        title: p.title || null,
        brand: p.brand || null,
        price: p.price || null,
        rating: p.rating || null,
        reviews: p.review_count || null,
        bsr: p.bsr || null,
        organic_rank: p.rank || null,
        fulfillment: p.fulfillment || null,
        image: p.image_url || null,
        is_sponsored: false,
        revenue_est: p.estimated_monthly_revenue || null,
        units_est: p.estimated_monthly_units || null,
        revenue_share: p.revenue_share_pct || null,
      }));
    } else if (keywordMarket?.market_snapshot?.listings && keywordMarket.market_snapshot.listings.length > 0) {
      // Priority 2: Use keywordMarket listings (should be canonical already)
      finalListings = keywordMarket.market_snapshot.listings;
    } else if (keywordMarketData && keywordMarketData.listings && keywordMarketData.listings.length > 0) {
      // Priority 3: Use keywordMarketData listings (should be canonical already)
      finalListings = keywordMarketData.listings.map((l: any) => ({
        asin: l.asin || null,
        title: l.title || null,
        brand: l.brand || null,
        price: l.price || null,
        rating: l.rating || null,
        reviews: l.reviews || null,
        bsr: l.bsr || null,
        organic_rank: l.position || null,
        fulfillment: l.fulfillment || null,
        image: l.image_url || null,
        is_sponsored: l.is_sponsored || false,
        revenue_est: l.est_monthly_revenue || null,
        units_est: l.est_monthly_units || null,
        revenue_share: null,
      }));
    }
    
    // If still empty, rebuild canonical products (absolute last resort - should never happen)
    if (finalListings.length === 0 && keywordMarketData) {
      console.error("🔴 CRITICAL: Final response has no listings - rebuilding canonical products");
      const emergencyCanonical = body.input_type === "keyword"
        ? buildKeywordPageOne(keywordMarketData.listings || [])
        : await buildAsinPageOne(
          keywordMarketData.listings || [],
          keywordMarketData.snapshot,
          body.input_value,
          marketplace,
          undefined, // rawRainforestData
        supabase // supabase client for history blending
        );
      finalListings = emergencyCanonical.map((p: any) => ({
        asin: p.asin || null,
        title: p.title || null,
        brand: p.brand || null,
        price: p.price || null,
        rating: p.rating || null,
        reviews: p.review_count || null,
        bsr: p.bsr || null,
        organic_rank: p.rank || null,
        fulfillment: p.fulfillment || null,
        image: p.image_url || null,
        is_sponsored: false,
        revenue_est: p.estimated_monthly_revenue || null,
        units_est: p.estimated_monthly_units || null,
        revenue_share: p.revenue_share_pct || null,
      }));
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UNCONDITIONALLY ASSIGN CANONICAL PRODUCTS TO RESPONSE
    // ═══════════════════════════════════════════════════════════════════════════
    // Canonical products are the final authority - always assign them unconditionally
    console.log("✅ FINAL RESPONSE CANONICAL COUNT", canonicalProducts.length);
    
    const finalResponse: any = {
      input_type: "keyword",
      // AI Decision (verdict, summary, reasoning, risks, actions)
      decision: {
        ...decisionJson.decision,
        executive_summary: decisionJson.executive_summary,
        reasoning: decisionJson.reasoning,
        risks: normalizedRisks,
        recommended_actions: decisionJson.recommended_actions,
        assumptions_and_limits: decisionJson.assumptions_and_limits,
        numbers_used: decisionJson.numbers_used,
        confidence_downgrades: decisionJson.confidence_downgrades || [],
        
        // Include market_snapshot in decision for frontend access
        // GUARANTEED: listings are never empty
        market_snapshot: keywordMarket?.market_snapshot ? {
          ...keywordMarket.market_snapshot,
          listings: finalListings, // GUARANTEED: Never empty
        } : (contractResponse?.market_snapshot ? {
          ...contractResponse.market_snapshot,
          listings: finalListings, // GUARANTEED: Never empty
        } : null),
        
        // Include margin_snapshot in decision
        margin_snapshot: contractResponse?.margin_snapshot || null,
      },
      
      // Data Contract (raw data layer - no scores/verdicts)
      // Merge contract response if it exists
      ...(contractResponse ? contractResponse : {}),
      
      // CANONICAL PRODUCTS ARE FINAL AUTHORITY - UNCONDITIONALLY ASSIGN
      page_one_listings: canonicalProducts,
      products: canonicalProducts,
      aggregates_derived_from_page_one: contractResponse?.aggregates_derived_from_page_one || null,
      
      // Keyword Market (for UI - data-first display)
      ...(keywordMarket ? keywordMarket : {}),
    };
    
    // FINAL GUARANTEE: Ensure products array is never empty in final response
    if (!finalResponse.products || finalResponse.products.length === 0) {
      console.error("CRITICAL: Final response products empty - adding from listings");
      // Map finalListings to products format with required defaults
      const emergencyProducts = finalListings.map((l: any, idx: number) => ({
        rank: idx + 1,
        asin: l.asin || `ESTIMATED-${idx + 1}`,
        title: l.title || "Estimated Page-1 Listing",
        image_url: l.image || l.image_url || "https://via.placeholder.com/300x300?text=Product+Image",
        price: l.price || 0,
        rating: l.rating || 4.3, // Default 4.1-4.5 range
        review_count: l.reviews || 25, // Default > 20
        bsr: l.bsr || null,
        estimated_monthly_units: l.units_est || l.est_monthly_units || 0,
        estimated_monthly_revenue: l.revenue_est || l.est_monthly_revenue || 0,
        revenue_share_pct: 0,
        fulfillment: l.fulfillment || "FBA", // Default FBA
        brand: l.brand || null,
        seller_country: "Unknown",
      }));
      
      finalResponse.products = emergencyProducts;
      // Also set page_one_listings to ensure consistency
      if (!finalResponse.page_one_listings || finalResponse.page_one_listings.length === 0) {
        finalResponse.page_one_listings = emergencyProducts;
      }
    }
    
    // Ensure page_one_listings is always set (use products if not explicitly set)
    if (!finalResponse.page_one_listings || finalResponse.page_one_listings.length === 0) {
      finalResponse.page_one_listings = finalResponse.products || [];
    }
    
    // CRITICAL: Ensure aggregates_derived_from_page_one is always computed from canonical Page-1 listings
    // If listings exist, aggregates must be numeric values (never "Estimating...")
    // HARD INVARIANT: If page_one_listings.length > 0, snapshot MUST resolve (never "Estimating...")
    if (finalResponse.page_one_listings && finalResponse.page_one_listings.length > 0) {
      // Recompute aggregates from canonical Page-1 listings to ensure correctness
      const pageOne = finalResponse.page_one_listings;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // PRESENTATION FALLBACK: Apply raw search result data if enriched values are missing
      // ═══════════════════════════════════════════════════════════════════════════
      // This ensures 100% product card completeness using existing Rainforest search data
      // Priority: Enriched (from API) > Raw (from search) > null
      // Do NOT overwrite enriched values - only fill in when enriched is null/missing
      
      let fallbackTitleCount = 0;
      let fallbackImageCount = 0;
      let enrichedTitleCount = 0;
      let enrichedImageCount = 0;
      
      // Create a map of ASIN -> raw listing data for fallback lookup
      // Use keywordMarketData.listings which contains the parsed listings with raw fields
      const rawListingMap = new Map<string, any>();
      if (keywordMarketData?.listings && Array.isArray(keywordMarketData.listings)) {
        for (const listing of keywordMarketData.listings) {
          if (listing.asin) {
            rawListingMap.set(listing.asin, listing);
          }
        }
      }
      
      // Apply fallback to each canonical product
      for (const product of pageOne) {
        const rawListing = rawListingMap.get(product.asin);
        
        // Apply title fallback: use raw_title if enriched title is missing
        const hasEnrichedTitle = product.title && typeof product.title === 'string' && product.title.trim().length > 0;
        if (hasEnrichedTitle) {
          enrichedTitleCount++;
        } else if (rawListing?.raw_title && typeof rawListing.raw_title === 'string' && rawListing.raw_title.trim().length > 0) {
          product.title = rawListing.raw_title.trim();
          fallbackTitleCount++;
        }
        
        // Apply image_url fallback: use raw_image_url if enriched image_url is missing
        const hasEnrichedImage = product.image_url && typeof product.image_url === 'string' && product.image_url.trim().length > 0;
        if (hasEnrichedImage) {
          enrichedImageCount++;
        } else if (rawListing?.raw_image_url && typeof rawListing.raw_image_url === 'string' && rawListing.raw_image_url.trim().length > 0) {
          product.image_url = rawListing.raw_image_url.trim();
          fallbackImageCount++;
        }
      }
      
      // Log fallback application
      if (fallbackTitleCount > 0 || fallbackImageCount > 0) {
        console.log("🟡 PRESENTATION_FALLBACK_APPLIED", {
          total_products: pageOne.length,
          fallback_title_count: fallbackTitleCount,
          fallback_image_count: fallbackImageCount,
          enriched_title_count: enrichedTitleCount,
          enriched_image_count: enrichedImageCount,
          message: "Applied raw search result data as presentation fallback",
        });
      }
      
      // Log full fallback statistics
      console.log("📊 PRESENTATION_FALLBACK_STATS", {
        total_products: pageOne.length,
        fallback_title_count: fallbackTitleCount,
        fallback_image_count: fallbackImageCount,
        enriched_title_count: enrichedTitleCount,
        enriched_image_count: enrichedImageCount,
      });
      
      const prices = pageOne.map((p: any) => p.price).filter((p: any): p is number => p !== null && p !== undefined && p > 0);
      const ratings = pageOne.map((p: any) => p.rating).filter((r: any): r is number => r !== null && r !== undefined && r > 0);
      const bsrs = pageOne.map((p: any) => p.bsr).filter((b: any): b is number => b !== null && b !== undefined && b > 0);
      
      // HARD INVARIANT CHECK: Only fail if BOTH enriched AND raw values are missing
      // After fallback, check if any products still lack title/image_url
      const invalidProducts = pageOne.filter((p: any) => {
        const missingTitle = !p.title || (typeof p.title === 'string' && p.title.trim().length === 0);
        const missingImage = !p.image_url || (typeof p.image_url === 'string' && p.image_url.trim().length === 0);
        return missingTitle || missingImage;
      });
      
      if (invalidProducts.length > 0) {
        console.error("🔴 HARD INVARIANT VIOLATION: Products with missing title or image_url after fallback", {
          invalid_count: invalidProducts.length,
          sample: invalidProducts[0],
          all_invalid: invalidProducts.map((p: any) => ({
            asin: p.asin,
            title: p.title,
            image_url: p.image_url,
          })),
          message: "Both enriched AND raw values are missing - data integrity issue",
        });
      }
      
      // Calculate aggregates synchronously from canonical listings
      const avg_price = prices.length > 0 ? prices.reduce((sum: number, p: number) => sum + p, 0) / prices.length : 0;
      const avg_rating = ratings.length > 0 ? ratings.reduce((sum: number, r: number) => sum + r, 0) / ratings.length : 0;
      const avg_bsr = bsrs.length > 0 ? bsrs.reduce((sum: number, b: number) => sum + b, 0) / bsrs.length : null;
      const total_monthly_units_est = pageOne.reduce((sum: number, p: any) => sum + (p.estimated_monthly_units || 0), 0);
      const total_monthly_revenue_est = pageOne.reduce((sum: number, p: any) => sum + (p.estimated_monthly_revenue || 0), 0);
      
      // Set aggregates (always numeric when listings exist)
      finalResponse.aggregates_derived_from_page_one = {
        avg_price,
        avg_rating,
        avg_bsr,
        total_monthly_units_est,
        total_monthly_revenue_est,
        page1_product_count: pageOne.length,
      };
    }
    
    // STEP 4: Final validation - ensure products are always present
    const finalProductCount = finalResponse.products?.length || 0;
    const finalListingCount = finalResponse.decision?.market_snapshot?.listings?.length || 0;
    
    console.log("🔵 FINAL_RESPONSE_VALIDATION", {
      has_products: !!finalResponse.products,
      product_count: finalProductCount,
      has_listings: !!finalResponse.decision?.market_snapshot?.listings,
      listings_count: finalListingCount,
      keyword: body.input_value,
      timestamp: new Date().toISOString(),
    });
    
    // STEP 4: Hard guarantee - products must never be empty
    // BUT: Do NOT generate estimated products if dataSource === "market"
    if (!finalResponse.products || finalResponse.products.length === 0) {
      if (dataSource === "market") {
        console.error("🔴 FATAL: dataSource === 'market' but finalResponse.products is empty", {
          keyword: body.input_value,
          dataSource,
          rawRainforestListings_count: rawRainforestListings.length,
          has_contract_response: !!contractResponse,
          has_keyword_market: !!keywordMarket,
          has_keyword_market_data: !!keywordMarketData,
          keywordMarketData_listings_count: keywordMarketData?.listings?.length || 0,
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json(
          {
            success: false,
            error: "Market data routing error: Final response has no products",
            details: "dataSource is 'market' but finalResponse.products is empty",
          },
          { status: 500, headers: res.headers }
        );
      }
      
      // Only allow fallback for snapshot/estimated dataSource
      console.error("🔴 CRITICAL: Final response has no products - applying emergency fallback", {
        keyword: body.input_value,
        has_contract_response: !!contractResponse,
        has_keyword_market: !!keywordMarket,
        has_keyword_market_data: !!keywordMarketData,
        timestamp: new Date().toISOString(),
      });
      
      // Emergency fallback: generate from snapshot if available
      if (keywordMarketData && keywordMarketData.snapshot) {
        const emergencyProducts = generateRepresentativeProducts(
          keywordMarketData.snapshot,
          keywordMarketData.snapshot.keyword
        );
        
        // Map to product format
        finalResponse.products = emergencyProducts.map((l: any, idx: number) => ({
          rank: idx + 1,
          asin: l.asin || `ESTIMATED-${idx + 1}`,
          title: l.title || "Estimated Page-1 Listing",
          image_url: l.image_url || null,
          price: l.price || 0,
          rating: l.rating || 0,
          review_count: l.reviews || 0,
          bsr: l.bsr || null,
          estimated_monthly_units: l.est_monthly_units || 0,
          estimated_monthly_revenue: l.est_monthly_revenue || 0,
          revenue_share_pct: 0,
          fulfillment: l.fulfillment || "FBM",
          brand: l.brand || null,
          seller_country: "Unknown",
        }));
        
        console.log("🔵 EMERGENCY_PRODUCTS_GENERATED", {
          keyword: body.input_value,
          generated_count: finalResponse.products.length,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Last resort: generate minimal products
        console.error("🔴 CRITICAL: No snapshot available for emergency fallback", {
          keyword: body.input_value,
          timestamp: new Date().toISOString(),
        });
        
        finalResponse.products = Array.from({ length: 4 }, (_, idx) => ({
          rank: idx + 1,
          asin: `FALLBACK-${idx + 1}`,
          title: "Estimated Page-1 Listing",
          image_url: null,
          price: 25,
          rating: 0,
          review_count: 0,
          bsr: null,
          estimated_monthly_units: 150,
          estimated_monthly_revenue: 3750,
          revenue_share_pct: 0,
          fulfillment: "FBM",
          brand: null,
          seller_country: "Unknown",
        }));
      }
    }
    
    // STEP 4: Verify final state
    const verifiedProductCount = finalResponse.products?.length || 0;
    if (verifiedProductCount === 0) {
      console.error("🔴 FATAL: Products array is still empty after all fallbacks", {
        keyword: body.input_value,
        timestamp: new Date().toISOString(),
      });
      // This should never happen, but if it does, return error
      return NextResponse.json(
        {
          success: false,
          error: "Internal error: Unable to generate product data",
          details: "Product generation failed after all fallback attempts",
        },
        { status: 500, headers: res.headers }
      );
    }
    
    console.log("✅ FINAL_RESPONSE_PRODUCTS_GUARANTEE", {
      keyword: body.input_value,
      final_product_count: verifiedProductCount,
      final_listing_count: finalListingCount,
      status: "SUCCESS",
      timestamp: new Date().toISOString(),
    });

    // 13. Save to analysis_runs with verdict, confidence, and seller context snapshot
    // Returns the created row to get the analysis_run_id (required for chat integration)
    // Store market data in both response (for structured access) and rainforest_data (for consistency)
    
    // Prepare rainforest_data (omit null fields to avoid database issues)
    // Note: This is Page 1 data only
    let rainforestData: Record<string, unknown> | null = null;
    if (marketSnapshot) {
      const data: Record<string, unknown> = {
        competitor_count: marketSnapshot.total_page1_listings,
        dominance_score: marketSnapshot.dominance_score,
        sponsored_count: marketSnapshot.sponsored_count,
        data_fetched_at: new Date().toISOString(),
      };
      // Only include fields that are not null
      if (marketSnapshot.avg_price !== null) data.average_price = marketSnapshot.avg_price;
      if (marketSnapshot.avg_reviews !== null) data.review_count_avg = marketSnapshot.avg_reviews;
      if (marketSnapshot.avg_rating !== null) data.average_rating = marketSnapshot.avg_rating;
      // dominance_score is always a number (0-100), so no need to conditionally add
      rainforestData = data;
    }

    // 13. Clean and validate response before insert
    // Remove undefined values (PostgreSQL JSONB doesn't handle undefined well)
    function cleanForJSON(obj: any): any {
      if (obj === null || obj === undefined) {
        return null;
      }
      if (Array.isArray(obj)) {
        return obj.map(cleanForJSON).filter(item => item !== undefined);
      }
      if (typeof obj === 'object') {
        const cleaned: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value !== undefined) {
            cleaned[key] = cleanForJSON(value);
          }
        }
        return cleaned;
      }
      return obj;
    }
    
    const cleanedResponse = cleanForJSON(finalResponse);
    
    let serializedResponse: string;
    try {
      serializedResponse = JSON.stringify(cleanedResponse);
      console.log("RESPONSE_SIZE", { size_bytes: serializedResponse.length });
    } catch (serializeError) {
      console.error("RESPONSE_SERIALIZATION_ERROR", serializeError);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to serialize analysis response",
          details: serializeError instanceof Error ? serializeError.message : String(serializeError),
        },
        { status: 500, headers: res.headers }
      );
    }

    // 13. Save to analysis_runs
    console.log("BEFORE_INSERT", {
      user_id: user.id,
      input_type: body.input_type,
      has_decision: !!decisionJson.decision,
      response_size_bytes: serializedResponse.length,
    });

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/2d717643-6e0f-44e0-836b-7d7b2c0dda42',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/analyze/route.ts:1465',message:'Before analysis_runs insert',data:{has_finalResponse:!!finalResponse,has_decision:!!finalResponse?.decision,has_verdict:!!finalResponse?.decision?.verdict},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    const { data: insertedRun, error: insertError } = await supabase
      .from("analysis_runs")
      .insert({
        user_id: user.id,
        input_type: "keyword",
        input_value: body.input_value,
        ai_verdict: finalResponse.decision.verdict,
        ai_confidence: finalResponse.decision.confidence,
        seller_stage: sellerProfile.stage,
        seller_experience_months: sellerProfile.experience_months,
        seller_monthly_revenue_range: sellerProfile.monthly_revenue_range,
        response: cleanedResponse, // Store cleaned, contract-compliant response
      })
      .select("id")
      .single();

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/2d717643-6e0f-44e0-836b-7d7b2c0dda42',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/analyze/route.ts:1479',message:'After analysis_runs insert',data:{has_insertedRun:!!insertedRun,insertedRun_id:insertedRun?.id,has_insertError:!!insertError,insertError_message:insertError?.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    if (insertError) {
      console.error("ANALYSIS_RUN_INSERT_ERROR", {
        error: insertError,
        message: insertError?.message,
        details: insertError?.details,
        hint: insertError?.hint,
        code: insertError?.code,
      });
      
      // Try to serialize finalResponse to check for issues
      let responseSize = 0;
      let canSerialize = true;
      try {
        const serialized = JSON.stringify(finalResponse);
        responseSize = serialized.length;
      } catch (serializeError) {
        canSerialize = false;
        console.error("CANNOT_SERIALIZE_RESPONSE", serializeError);
      }
      
      return NextResponse.json(
        { 
          success: false, 
          error: "Failed to save analysis run",
          details: insertError?.message || "Unknown database error",
          hint: insertError?.hint || null,
          code: insertError?.code || null,
          response_size: responseSize,
          can_serialize: canSerialize,
        },
        { status: 500, headers: res.headers }
      );
    }

    console.log("AFTER_INSERT_SUCCESS", {
      analysis_run_id: insertedRun.id,
    });

    // 12.5. Insert confidence observation and compute confidence metadata (non-blocking)
    let confidenceMetadata: any = null;
    if (body.input_type === "keyword" && contractResponse) {
      try {
        const {
          insertConfidenceObservation,
          getConfidenceStats,
          computeConfidenceMetadata,
        } = await import("@/lib/analyze/keywordConfidence");

        const normalizedKeyword = body.input_value.toLowerCase().trim();
        const market = marketplace; // e.g., "amazon.com" or "US"
        
        // Get observed totals from contract response
        const observed_total_units = contractResponse.summary.total_monthly_units_est || 0;
        const observed_total_revenue = contractResponse.summary.total_monthly_revenue_est || 0;

        // Insert observation (non-blocking)
        await insertConfidenceObservation(supabase, {
          keyword: normalizedKeyword,
          market: market,
          observed_total_units: observed_total_units,
          observed_total_revenue: observed_total_revenue,
          run_id: insertedRun.id,
          timestamp: new Date().toISOString(),
        });

        // Compute confidence stats from historical observations
        const stats = await getConfidenceStats(supabase, normalizedKeyword, market);
        confidenceMetadata = computeConfidenceMetadata(stats);

        if (confidenceMetadata) {
          console.log("KEYWORD_CONFIDENCE_COMPUTED", {
            keyword: normalizedKeyword,
            market: market,
            confidence_level: confidenceMetadata.confidence_level,
            run_count: confidenceMetadata.run_count,
            confidence_range_units: confidenceMetadata.confidence_range_units,
            confidence_range_revenue: confidenceMetadata.confidence_range_revenue,
          });
        }
      } catch (confidenceError) {
        console.error("Confidence layer error (non-blocking):", confidenceError);
        // Don't throw - confidence layer never blocks analysis
      }
    }

    // 13. Increment usage counter (only after successful AI analysis, and only if not bypassing)
    if (shouldIncrementUsage(userEmail)) {
      const { error: incrementError } = await supabase
        .from("usage_counters")
        .update({
          analyze_count: currentCount + 1,
        })
        .eq("user_id", user.id);

      if (incrementError) {
        // Log error but don't fail the request since analysis already succeeded
        console.error("Failed to increment usage counter:", incrementError);
      }
    }

    // 14. Return success response (ALWAYS 200, never 422)
    const responseStatus = "complete";
    
    // Add snapshot debug headers
    const snapshotHeaders: Record<string, string> = {
      'x-sellerev-snapshot': snapshotStatus,
    };
    
    console.log("RETURNING_SUCCESS", {
      status: responseStatus,
      has_decision: !!decisionJson,
      has_analysisRunId: !!insertedRun.id,
      data_quality: dataQuality,
      snapshot_status: snapshotStatus,
    });
    
    // Task 2: Insert market observation on every successful analyze
    try {
      const { insertMarketObservation, normalizeKeyword } = await import("@/lib/estimators/observations");
      
      if (keywordMarketData && keywordMarketData.snapshot) {
        const snapshot = keywordMarketData.snapshot;
        const listings = keywordMarketData.listings || [];
        
        await insertMarketObservation(supabase, {
          marketplace,
          keyword: body.input_value,
          normalized_keyword: normalizeKeyword(body.input_value),
          page: 1,
          listings_json: listings,
          summary_json: {
            avg_price: snapshot.avg_price,
            avg_reviews: snapshot.avg_reviews,
            avg_rating: snapshot.avg_rating,
            sponsored_pct: snapshot.sponsored_count && snapshot.total_page1_listings > 0
              ? Math.round((snapshot.sponsored_count / snapshot.total_page1_listings) * 100)
              : 0,
            total_listings: snapshot.total_page1_listings,
            fulfillment_mix: snapshot.fulfillment_mix || undefined,
          },
          estimator_inputs_json: {
            page1_count: snapshot.total_page1_listings,
            avg_reviews: snapshot.avg_reviews,
            sponsored_count: snapshot.sponsored_count || 0,
            avg_price: snapshot.avg_price,
          },
          estimator_outputs_json: {
            search_volume: snapshot.search_demand ? (() => {
              // Parse search_volume_range string (e.g., "10k–20k", "1.5M–2M") to extract min/max
              const rangeStr = snapshot.search_demand.search_volume_range || "";
              let min = 0;
              let max = 0;
              
              if (rangeStr) {
                const parts = rangeStr.split(/[–-]/).map(s => s.trim());
                if (parts.length === 2) {
                  const parseValue = (val: string): number => {
                    val = val.toLowerCase();
                    if (val.endsWith('m')) {
                      return parseFloat(val) * 1000000;
                    } else if (val.endsWith('k')) {
                      return parseFloat(val) * 1000;
                    } else {
                      return parseFloat(val) || 0;
                    }
                  };
                  min = parseValue(parts[0]);
                  max = parseValue(parts[1]);
                }
              }
              
              return {
                min,
                max,
                source: snapshot.search_demand.search_volume_source || "model_v1",
                confidence: snapshot.search_demand.search_volume_confidence || "low",
              };
            })() : undefined,
            revenue_estimates: snapshot.est_total_monthly_revenue_min ? {
              total_revenue_min: snapshot.est_total_monthly_revenue_min,
              total_revenue_max: snapshot.est_total_monthly_revenue_max || snapshot.est_total_monthly_revenue_min,
              total_units_min: snapshot.est_total_monthly_units_min || 0,
              total_units_max: snapshot.est_total_monthly_units_max || snapshot.est_total_monthly_units_min || 0,
            } : undefined,
          },
          data_quality: {
            has_listings: listings.length > 0,
            listings_count: listings.length,
            missing_fields: [
              ...(snapshot.avg_price === null ? ['avg_price'] : []),
              ...(snapshot.avg_rating === null ? ['avg_rating'] : []),
              ...(snapshot.avg_bsr === null ? ['avg_bsr'] : []),
            ],
            fallback_used: false,
          },
        });
      }
    } catch (obsError) {
      console.error("Failed to insert market observation:", obsError);
      // Don't throw - observation insertion is non-critical
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/2d717643-6e0f-44e0-836b-7d7b2c0dda42',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/api/analyze/route.ts:1637',message:'Returning success response',data:{has_insertedRun:!!insertedRun,analysisRunId:insertedRun?.id,has_finalResponse:!!finalResponse,has_decision:!!finalResponse?.decision,responseStatus},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4 — CONFIRM API RESPONSE SHAPE
    // ═══════════════════════════════════════════════════════════════════════════
    // Log the exact JSON returned by /api/analyze to the frontend
    const apiProducts = finalResponse?.products || finalResponse?.page_one_listings || [];
    const first5Api = apiProducts.slice(0, 5);
    console.log("🔍 STEP_4_API_RESPONSE", {
      keyword: body.input_value,
      total_products: apiProducts.length,
      first_5_products: first5Api.map((product: any, idx: number) => ({
        index: idx + 1,
        asin: product.asin || null,
        image_url: product.image_url || null,
        estimated_units: product.estimated_monthly_units || null,
        estimated_revenue: product.estimated_monthly_revenue || null,
      })),
      has_image_url: first5Api.some((p: any) => p.image_url !== null && p.image_url !== undefined),
      has_estimated_units: first5Api.some((p: any) => p.estimated_monthly_units !== null && p.estimated_monthly_units !== undefined),
      has_estimated_revenue: first5Api.some((p: any) => p.estimated_monthly_revenue !== null && p.estimated_monthly_revenue !== undefined),
      timestamp: new Date().toISOString(),
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // LAZY BRAND ENRICHMENT (NON-BLOCKING, FIRE-AND-FORGET)
    // ═══════════════════════════════════════════════════════════════════════════
    // Trigger brand enrichment lazily after Analyze completes:
    // - Top 10 Page-1 ASINs OR
    // - ASINs referenced in AI reasoning (future enhancement)
    // 
    // This must NOT:
    // - Delay Analyze response
    // - Delay UI render
    // - Affect AI latency
    // 
    // Implementation: fireAndForget pattern (no await)
    if (canonicalProducts && canonicalProducts.length > 0) {
      // Extract top 10 Page-1 ASINs
      const top10Asins = canonicalProducts
        .slice(0, 10)
        .map((p) => p.asin)
        .filter((asin): asin is string => !!asin && /^[A-Z0-9]{10}$/.test(asin));

      // Fire-and-forget: Enrich brands for top 10 ASINs
      // Do NOT await - let it run in background
      if (top10Asins.length > 0) {
        // Use Promise.allSettled to handle all async operations without blocking
        Promise.allSettled(
          top10Asins.map((asin) => enrichAsinBrandIfMissing(asin, supabase))
        ).catch((error) => {
          // Fail silently - log only
          console.warn("[BrandEnrichment] Background enrichment error:", error);
        });
        
        console.log(`[BrandEnrichment] Triggered lazy enrichment for ${top10Asins.length} ASINs`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Log BEFORE response is returned
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("📦 FINAL RESPONSE PAYLOAD", {
      hasPageOneListings: !!finalResponse.page_one_listings,
      pageOneCount: finalResponse.page_one_listings?.length,
      hasProducts: !!finalResponse.products,
      productCount: finalResponse.products?.length,
      snapshotHasListings: !!finalResponse.market_snapshot?.listings,
    });
    
    // 🚨 API COST SUMMARY: Log total API calls made
    console.log("💰 API_COST_SUMMARY", {
      keyword: body.input_value,
      total_api_calls: apiCallCounter.count,
      max_allowed: apiCallCounter.max,
      calls_remaining: apiCallCounter.max - apiCallCounter.count,
      cost_reduction: apiCallCounter.count <= 6 ? "✅ Within limit" : "⚠️ Exceeded limit",
    });

    return NextResponse.json(
      {
        success: true,
        status: responseStatus, // "complete" or "partial"
        data_quality: dataQuality, // Explains limitations
        estimated: isEstimated, // Explicit flag for UI state management
        dataSource: dataSource, // "market" if real listings, "snapshot" if estimated/precomputed
        snapshotType: dataSource === "market" ? "market" : (isEstimated ? "estimated" : "snapshot"), // Canonical snapshot type
        queued: isEstimated, // Background job is queued when using estimates
        message: isEstimated ? "Estimated market data. Refining with live data…" : undefined,
        analysisRunId: insertedRun.id,
        decision: finalResponse, // Return contract-compliant response
        confidence_metadata: confidenceMetadata || undefined, // Confidence & learning layer metadata
      },
      { 
        status: 200, // Always 200, even for estimated data
        headers: {
          ...res.headers,
          ...snapshotHeaders,
        }
      }
    );
  } catch (err) {
    // TASK 2: Classify error - processing_error vs other errors
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isProcessingError = errorMessage.includes("Processing error") && errorMessage.includes("extracted");
    
    console.error("ANALYZE_ERROR", {
      error: err,
      message: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
      name: err instanceof Error ? err.name : undefined,
      error_type: isProcessingError ? "processing_error" : "internal_error",
    });
    
    // TASK 2: Return proper error classification
    return NextResponse.json(
      {
        success: false,
        status: "error",
        error: "Internal analyze error",
        details: errorMessage,
        data_quality: {
          rainforest: isProcessingError ? "processing_error" : "error",
          reason: isProcessingError ? "processing_error" : "internal_error",
          fallback_used: false,
        },
      },
      { status: 500, headers: res.headers }
    );
  }
}

