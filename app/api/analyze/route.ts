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
import { buildTier1Snapshot } from "@/lib/analyze/tier1Snapshot";
import { refineTier2Estimates, Tier2RefinementContext } from "@/lib/estimators/tier2Refinement";
import { TieredAnalyzeResponse } from "@/types/tierContracts";
import { batchEnrichCatalogItems } from "@/lib/spapi/catalogItems";
import { batchEnrichPricing } from "@/lib/spapi/pricing";

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
   - Use clear numeric language with the exact percentage from snapshot.top_5_brand_revenue_share_pct (if present) OR market_structure.top_5_brand_revenue_share_pct.
   - When discussing market concentration, ALWAYS reference snapshot.top_5_brand_revenue_share_pct if present.
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
   - PREFER snapshot.top_5_brand_revenue_share_pct over brand_moat metrics when discussing market concentration

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

// Synthetic Page-1 product generation removed (correctness first).
// If Page-1 listings cannot be loaded reliably, /api/analyze returns a hard error.

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
    
    // 🚨 API SAFETY LIMIT: Create shared counter at route level (max 7 calls per analysis)
    // Call budget: 1 search + 4 BSR + 2 metadata = 7 total
    const apiCallCounter = { count: 0, max: 7 };

    // FIX 3: Lock enrichment per snapshot to avoid duplicate async re-runs in the same invocation
    // (serverless can execute multiple detached promises; this prevents double-triggering for same snapshot_id)
    const enrichmentLocks = (globalThis as any).__SELLEREV_ENRICHMENT_LOCKS__ as {
      inFlight: Set<string>;
      completed: Set<string>;
    } | undefined;
    if (!(globalThis as any).__SELLEREV_ENRICHMENT_LOCKS__) {
      (globalThis as any).__SELLEREV_ENRICHMENT_LOCKS__ = {
        inFlight: new Set<string>(),
        completed: new Set<string>(),
      };
    }
    
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
          
          // ═══════════════════════════════════════════════════════════════════════════
          // FORCE SP-API ENRICHMENT AFTER CACHE REHYDRATION (MANDATORY)
          // ═══════════════════════════════════════════════════════════════════════════
          // SP-API must run even when Rainforest is skipped (cache rehydration path)
          // This executes BEFORE buildKeywordPageOne, canonical ranking, snapshot building
          // NO conditional gates - always runs when cache is rehydrated
          const asins = cachedProducts.map((p: any) => p.asin).filter(Boolean);
          const marketplaceId = marketplace === 'amazon.com' ? 'ATVPDKIKX0DER' : 'ATVPDKIKX0DER';
          
          // REQUIRED LOG: SP_API_ENRICHMENT_FORCED_AFTER_CACHE
          console.log("SP_API_ENRICHMENT_FORCED_AFTER_CACHE", {
            keyword: normalizedKeyword,
            asin_count: asins.length,
            source: "cache",
            timestamp: new Date().toISOString(),
          });
          
          // Execute SP-API Catalog and Pricing enrichment in parallel
          // NO conditional gates - always executes
          try {
            const [catalogResult, pricingResult] = await Promise.all([
              batchEnrichCatalogItems(asins, marketplaceId, 2000),
              batchEnrichPricing(asins, marketplaceId, 2000),
            ]);
            
            // Update listings with SP-API Catalog data (brand, category, BSR, title, image)
            const catalogEnrichment = catalogResult.enriched;
            const pricingEnrichment = pricingResult.enriched;
            
            // Create a map of ASIN to listing for efficient updates
            const listingMap = new Map<string, ParsedListing>();
            realMarketData.listings.forEach((listing: ParsedListing) => {
              if (listing.asin) {
                listingMap.set(listing.asin.toUpperCase(), listing);
              }
            });
            
            // Apply SP-API Catalog enrichment (authoritative: brand, category, BSR)
            for (const [asin, metadata] of catalogEnrichment.entries()) {
              const listing = listingMap.get(asin.toUpperCase());
              if (listing) {
                // SP-API overwrites: brand, category, BSR
                if (metadata.brand) listing.brand = metadata.brand;
                if (metadata.category) listing.main_category = metadata.category;
                if (metadata.bsr !== null) {
                  listing.bsr = metadata.bsr;
                  listing.main_category_bsr = metadata.bsr;
                }
                if (metadata.title) listing.title = metadata.title;
                if (metadata.image_url) listing.image_url = metadata.image_url;
              }
            }
            
            // Apply SP-API Pricing enrichment (authoritative: fulfillment, buy box)
            for (const [asin, metadata] of pricingEnrichment.entries()) {
              const listing = listingMap.get(asin.toUpperCase());
              if (listing) {
                // SP-API overwrites: fulfillment
                if (metadata.fulfillment_channel) {
                  listing.fulfillment = metadata.fulfillment_channel === 'FBA' ? 'FBA' : 'FBM';
                }
                // Update price if available from SP-API
                if (metadata.buy_box_price !== null) {
                  listing.price = metadata.buy_box_price;
                } else if (metadata.lowest_price !== null) {
                  listing.price = metadata.lowest_price;
                }
              }
            }
          } catch (error) {
            // Log error but continue - SP-API enrichment is non-fatal
            console.error("SP_API_ENRICHMENT_ERROR_AFTER_CACHE", {
              keyword: normalizedKeyword,
              error: error instanceof Error ? error.message : String(error),
            });
          }
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
    let snapshot: any = null; // Declare at function scope for freshness badge
    if (!keywordMarketData || dataSource !== "market") {
      const {
        buildKeywordSnapshotFromCache,
        getKeywordProducts,
        incrementSearchCount,
        queueKeyword,
      } = await import("@/lib/snapshots/keywordSnapshots");
      
      // Build snapshot from cached keyword_products (zero Rainforest API calls)
      snapshot = await buildKeywordSnapshotFromCache(supabase, body.input_value, marketplace);

      if (snapshot) {
      // Snapshot exists - use it (pure database read)
      snapshotStatus = 'hit';
      console.log("SNAPSHOT_HIT", {
        keyword: body.input_value,
        last_updated: snapshot.last_updated,
        product_count: snapshot.product_count,
      });

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
      // Hard requirement: if keyword_products is empty, return a hard error (no synthetic listings).
      // CRITICAL: Use cached fields from keyword_products for full product card rendering
      let listings: ParsedListing[] = products.map((p) => ({
        asin: p.asin || '',
        title: p.title || null, // From cache
        price: p.price,
        rating: p.rating || null, // From cache
        reviews: p.review_count || null, // From cache (mapped from review_count)
        is_sponsored: p.is_sponsored || false, // From cache (not assumed false)
        position: p.rank,
        brand: p.brand || null, // From cache
        image_url: p.image_url || null, // From cache
        bsr: p.main_category_bsr,
        main_category_bsr: p.main_category_bsr,
        main_category: p.main_category,
        fulfillment: p.fulfillment || null, // From cache (not assumed null)
        est_monthly_revenue: p.estimated_monthly_revenue,
        est_monthly_units: p.estimated_monthly_units,
        revenue_confidence: 'medium' as const,
      } as ParsedListing));
      
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

        return NextResponse.json(
          {
            success: false,
            code: "PAGE1_LISTINGS_UNAVAILABLE",
            error: "Unable to load reliable Page-1 listings for this keyword.",
          },
          { status: 422, headers: res.headers }
        );
      }
      
      // Compute sponsored_count and fulfillment_mix from cached products
      const sponsoredCount = products.filter((p: any) => p.is_sponsored === true).length;
      const fulfillmentCounts = {
        fba: products.filter((p: any) => p.fulfillment === 'FBA').length,
        fbm: products.filter((p: any) => p.fulfillment === 'FBM').length,
        amazon: products.filter((p: any) => p.fulfillment === 'AMZ').length,
      };
      const totalFulfillment = fulfillmentCounts.fba + fulfillmentCounts.fbm + fulfillmentCounts.amazon;
      const fulfillmentMix = totalFulfillment > 0 ? {
        fba: Math.round((fulfillmentCounts.fba / totalFulfillment) * 100),
        fbm: Math.round((fulfillmentCounts.fbm / totalFulfillment) * 100),
        amazon: Math.round((fulfillmentCounts.amazon / totalFulfillment) * 100),
      } : { fba: 0, fbm: 0, amazon: 0 };
      
      // Compute avg_rating from cached products
      const productsWithRating = products.filter((p: any) => p.rating !== null && p.rating !== undefined && p.rating > 0);
      const avgRating = productsWithRating.length > 0
        ? productsWithRating.reduce((sum: number, p: any) => sum + (p.rating || 0), 0) / productsWithRating.length
        : null;
      
      // Compute avg_reviews from cached products
      const productsWithReviews = products.filter((p: any) => p.review_count !== null && p.review_count !== undefined && p.review_count > 0);
      const avgReviews = productsWithReviews.length > 0
        ? Math.round(productsWithReviews.reduce((sum: number, p: any) => sum + (p.review_count || 0), 0) / productsWithReviews.length)
        : 0;

      keywordMarketData = {
        snapshot: {
          keyword: snapshot.keyword,
          avg_price: avgPrice > 0 ? avgPrice : null,
          avg_reviews: avgReviews, // Computed from cached products
          avg_rating: avgRating, // Computed from cached products
          avg_bsr: snapshot.average_bsr,
          total_page1_listings: snapshot.product_count,
          sponsored_count: sponsoredCount, // Computed from cached products
          dominance_score: 0, // Not stored in snapshot (would need brand breakdown)
          fulfillment_mix: fulfillmentMix, // Computed from cached products
          est_total_monthly_revenue_min: revenueMin,
          est_total_monthly_revenue_max: revenueMax,
          est_total_monthly_units_min: unitsMin,
          est_total_monthly_units_max: unitsMax,
          search_demand: null, // Not stored in snapshot (will be computed if needed)
        },
        listings,
      };
    } else {
      // Step 2: No snapshot exists (and no market fetch was used).
      // Hard requirement: do NOT fabricate Page-1 listings. Queue work and return a hard error.
      const normalizedKeyword = body.input_value.toLowerCase().trim();
      await queueKeyword(supabase, normalizedKeyword, 5, user.id, marketplace);
      return NextResponse.json(
        {
          success: false,
          code: "PAGE1_LISTINGS_UNAVAILABLE",
          error: "Unable to load reliable Page-1 listings for this keyword.",
        },
        { status: 422, headers: res.headers }
      );
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

      return NextResponse.json(
        {
          success: false,
          code: "PAGE1_LISTINGS_UNAVAILABLE",
          error: "Unable to load reliable Page-1 listings for this keyword.",
        },
        { status: 422, headers: res.headers }
      );
    }
    
    // FINAL GUARANTEE: Ensure listings are never empty before proceeding
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

      return NextResponse.json(
        {
          success: false,
          code: "PAGE1_LISTINGS_UNAVAILABLE",
          error: "Unable to load reliable Page-1 listings for this keyword.",
        },
        { status: 422, headers: res.headers }
      );
    }

    // Determine data source: market (real) vs snapshot (estimated)
    // CRITICAL: If dataSource is "market", listings are real and must be used
    const isEstimated = dataSource === "snapshot" && (snapshotStatus === 'estimated' || snapshotStatus === 'miss');
    
    // Capture snapshot metadata for freshness badge
    let snapshotLastUpdated: string | null = null;
    if (snapshotStatus === 'hit' && snapshot) {
      snapshotLastUpdated = snapshot.last_updated;
    }
    
    const dataQuality = {
      snapshot: snapshotStatus,
      source: dataSource === "market" ? "market" : (isEstimated ? 'estimated' : 'precomputed'),
      fallback_used: false,
      estimated: isEstimated,
      snapshot_last_updated: snapshotLastUpdated, // For freshness badge
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
          // Use default US marketplace ID (ATVPDKIKX0DER) for FBA fee resolution
          const fbaFeesResult = await resolveFbaFees(representativeAsin, priceForMargin, "ATVPDKIKX0DER");
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIER-1 SNAPSHOT (FAST PATH) - Declare at function scope
    // ═══════════════════════════════════════════════════════════════════════════
    let tier1Snapshot: TieredAnalyzeResponse | null = null;
    
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
      // 🔥 HARD-FORCED SP-API EXECUTION (MANDATORY - NO CONDITIONALS)
      // ═══════════════════════════════════════════════════════════════════════════
      // SP-API must run unconditionally for all page-1 ASINs, regardless of:
      // - Cache state
      // - Confidence level
      // - Missing metadata checks
      // - Title-derived brands
      // This executes BEFORE canonicalization to ensure authoritative data
      // NOTE: SP-API also runs in fetchKeywordMarketSnapshot, but this is a safety net
      // to ensure SP-API data is always applied even if keywordMarket.ts path is skipped
      if (body.input_type === "keyword" && rawListings.length > 0) {
        // Extract and deduplicate page-1 ASINs
        const page1Asins = Array.from(new Set(
          rawListings
            .map((l: any) => l.asin)
            .filter((asin: string | null) => asin && /^[A-Z0-9]{10}$/i.test(asin.trim().toUpperCase()))
            .map((asin: string) => asin.trim().toUpperCase())
        ));
        
        if (page1Asins.length > 0) {
          const marketplaceId = marketplace === 'amazon.com' ? 'ATVPDKIKX0DER' : 'ATVPDKIKX0DER';
          
          // REQUIRED LOG: SP_API_FORCED_CALL
          console.log("SP_API_FORCED_CALL", {
            keyword: body.input_value,
            asin_count: page1Asins.length,
            timestamp: new Date().toISOString(),
          });
          
          // Execute SP-API Catalog and Pricing enrichment in parallel
          // NO conditional gates - always executes
          // CRITICAL: Pricing failures must NOT block catalog enrichment
          let catalogResult: any = null;
          let pricingResult: any = null;
          
          try {
            // Execute catalog and pricing separately to handle failures independently
            catalogResult = await batchEnrichCatalogItems(page1Asins, marketplaceId, 2000);
          } catch (error) {
            console.error("❌ SP_API_CATALOG_FAILURE", {
              keyword: body.input_value,
              error: error instanceof Error ? error.message : String(error),
              asin_count: page1Asins.length,
              message: "Catalog enrichment failed - continuing without catalog data",
            });
            catalogResult = { enriched: new Map(), failed: [], errors: [] };
          }
          
          try {
            pricingResult = await batchEnrichPricing(page1Asins, marketplaceId, 2000);
          } catch (error) {
            console.error("❌ SP_API_PRICING_FAILURE", {
              keyword: body.input_value,
              error: error instanceof Error ? error.message : String(error),
              asin_count: page1Asins.length,
              message: "Pricing enrichment failed - will fallback to Rainforest data",
            });
            pricingResult = { enriched: new Map(), failed: [], errors: [] };
          }
          
          // Create a map of ASIN to listing for efficient updates
          const listingMap = new Map<string, any>();
          rawListings.forEach((listing: any) => {
            if (listing.asin) {
              listingMap.set(listing.asin.toUpperCase(), listing);
            }
          });
          
          // Apply SP-API Catalog enrichment (authoritative: brand, category, BSR)
          // CRITICAL: This must run even if pricing failed
          if (catalogResult && catalogResult.enriched) {
            for (const [asin, metadata] of catalogResult.enriched.entries()) {
              const listing = listingMap.get(asin.toUpperCase());
              if (listing) {
                // SP-API overwrites: brand, category, BSR
                if (metadata.brand) {
                  listing.brand = metadata.brand;
                  (listing as any).brand_source = 'sp_api_catalog';
                }
                if (metadata.category) {
                  listing.main_category = metadata.category;
                  (listing as any).category_source = 'sp_api_catalog';
                }
                // CRITICAL: BSR from catalog is authoritative and must be preserved
                // Pricing failures must NOT affect BSR coverage
                if (metadata.bsr !== null && metadata.bsr > 0) {
                  listing.bsr = metadata.bsr;
                  listing.main_category_bsr = metadata.bsr;
                  (listing as any).bsr_source = 'sp_api_catalog';
                }
                if (metadata.title) {
                  listing.title = metadata.title;
                  (listing as any).title_source = 'sp_api_catalog';
                }
                if (metadata.image_url) {
                  listing.image_url = metadata.image_url;
                  (listing as any).image_source = 'sp_api_catalog';
                }
              }
            }
            
            console.log("✅ SP_API_CATALOG_ENRICHMENT_APPLIED", {
              keyword: body.input_value,
              enriched_count: catalogResult.enriched.size,
              total_asins: page1Asins.length,
            });
          }
          
          // Apply SP-API Pricing enrichment (authoritative: fulfillment, buy box)
          // CRITICAL: If pricing fails, fallback to Rainforest data and mark source
          if (pricingResult && pricingResult.enriched && pricingResult.enriched.size > 0) {
            for (const [asin, metadata] of pricingResult.enriched.entries()) {
              const listing = listingMap.get(asin.toUpperCase());
              if (listing) {
                // SP-API overwrites: fulfillment
                if (metadata.fulfillment_channel) {
                  listing.fulfillment = metadata.fulfillment_channel === 'FBA' ? 'FBA' : 'FBM';
                  (listing as any).fulfillment_source = 'sp_api_pricing';
                }
                // Update price if available from SP-API
                if (metadata.buy_box_price !== null) {
                  listing.price = metadata.buy_box_price;
                  (listing as any).price_source = 'sp_api_pricing';
                } else if (metadata.lowest_price !== null) {
                  listing.price = metadata.lowest_price;
                  (listing as any).price_source = 'sp_api_pricing';
                }
                if (metadata.buy_box_owner) {
                  (listing as any).buy_box_owner = metadata.buy_box_owner;
                  (listing as any).buy_box_owner_source = 'sp_api_pricing';
                }
                if (metadata.offer_count !== null) {
                  (listing as any).offer_count = metadata.offer_count;
                  (listing as any).offer_count_source = 'sp_api_pricing';
                }
              }
            }
            
            console.log("✅ SP_API_PRICING_ENRICHMENT_APPLIED", {
              keyword: body.input_value,
              enriched_count: pricingResult.enriched.size,
              total_asins: page1Asins.length,
            });
          } else {
            // Pricing failed or returned no data - fallback to Rainforest and mark source
            console.warn("⚠️ SP_API_PRICING_FALLBACK_TO_RAINFOREST", {
              keyword: body.input_value,
              pricing_enriched: pricingResult?.enriched?.size ?? 0,
              total_asins: page1Asins.length,
              message: "Pricing API failed or returned no data - using Rainforest price data",
            });
            
            // Mark price source as Rainforest fallback for listings that don't have SP-API pricing
            for (const listing of rawListings) {
              if (listing.asin && !(listing as any).price_source) {
                // Only set fallback if we have a price from Rainforest
                if (listing.price !== null && listing.price !== undefined) {
                  (listing as any).price_source = 'rainforest_serp';
                }
                // Mark fulfillment source if available from Rainforest
                if (listing.fulfillment && !(listing as any).fulfillment_source) {
                  (listing as any).fulfillment_source = 'rainforest_serp';
                }
              }
            }
          }
          
          console.log("✅ SP_API_ENRICHMENT_COMPLETE_CONTINUING", {
            keyword: body.input_value,
            raw_listings_count: rawListings.length,
            catalog_enriched: catalogResult?.enriched?.size ?? 0,
            pricing_enriched: pricingResult?.enriched?.size ?? 0,
            message: "SP-API enrichment complete, continuing to canonical builder",
            timestamp: new Date().toISOString(),
          });
        } else {
          // HARD ERROR: SP-API should have run but no ASINs were found
          console.error("❌ SP_API_HARD_ERROR_NO_ASINS", {
            keyword: body.input_value,
            raw_listings_count: rawListings.length,
            message: "SP-API MUST execute for all keyword searches. No ASINs found in raw listings.",
          });
        }
      } else if (body.input_type === "keyword") {
        // HARD ERROR: SP-API should have run but rawListings is empty
        console.error("❌ SP_API_HARD_ERROR_NO_LISTINGS", {
          keyword: body.input_value,
          message: "SP-API MUST execute for all keyword searches. Raw listings is empty.",
        });
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // ASIN METADATA ENRICHMENT (MOVED TO ASYNC/BACKGROUND)
      // ═══════════════════════════════════════════════════════════════════════════
      // Metadata enrichment is now done asynchronously after Page-1 returns
      // This allows immediate return without waiting for metadata API calls
      // Metadata will be populated in background and cached for future use
      // 
      // NOTE: Metadata enrichment is deferred to async/background processing
      // to ensure Page-1 returns immediately after search + canonicalization
      // Enrichment will be triggered after TIER1_EARLY_RETURN
      
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
        
        // ═══════════════════════════════════════════════════════════════════════════
        // IMAGE NORMALIZATION (BEFORE canonical builder)
        // ═══════════════════════════════════════════════════════════════════════════
        // Metadata enrichment may set image as { link: string } object
        // Canonical builder + UI expect image_url: string
        // Normalize images to ensure image_url is always a string if image data exists
        let imageNormalizedCount = 0;
        for (const listing of rawListings) {
          // Check if image_url is already an object (from enrichment)
          if (listing.image_url && typeof listing.image_url === 'object' && listing.image_url !== null) {
            // Extract link from image_url object
            const imageLink = (listing.image_url as any).link;
            if (typeof imageLink === 'string' && imageLink.trim().length > 0) {
              listing.image_url = imageLink.trim();
              imageNormalizedCount++;
            } else {
              // Invalid object, clear it
              listing.image_url = null;
            }
          }
          // If image_url is null/missing but image object exists with link property
          // Note: image property may exist on raw data but not in ParsedListing type
          else if (!listing.image_url && (listing as any).image) {
            const imageData = (listing as any).image;
            if (typeof imageData === 'object' && imageData !== null && 'link' in imageData) {
              // Extract link from image object
              const imageLink = imageData.link;
              if (typeof imageLink === 'string' && imageLink.trim().length > 0) {
                listing.image_url = imageLink.trim();
                imageNormalizedCount++;
              }
            } else if (typeof imageData === 'string' && imageData.trim().length > 0) {
              // image is already a string, use it directly
              listing.image_url = imageData.trim();
              imageNormalizedCount++;
            }
          }
          // Guard: Ensure image_url is always a string if image.link exists
          else if ((listing as any).image && typeof (listing as any).image === 'object' && (listing as any).image !== null && 'link' in (listing as any).image) {
            const imageLink = ((listing as any).image as any).link;
            if (typeof imageLink === 'string' && imageLink.trim().length > 0) {
              listing.image_url = imageLink.trim();
              imageNormalizedCount++;
            }
          }
        }
        
        if (imageNormalizedCount > 0) {
          console.log("🖼️ IMAGE_NORMALIZATION_APPLIED", {
            normalized_count: imageNormalizedCount,
            total_listings: rawListings.length,
          });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // HARD UI FALLBACK (REQUIRED FOR UI INTEGRITY)
        // ═══════════════════════════════════════════════════════════════════════════
        // Guarantees ALL page-1 products have title and image_url
        // Runs REGARDLESS of confidence level or Rainforest skip
        // Purely local - no API calls
        let fallbackTitleCount = 0;
        let fallbackImageCount = 0;
        
        for (const listing of rawListings) {
          // TITLE FALLBACK
          if (!listing.title || (typeof listing.title === 'string' && listing.title.trim().length === 0)) {
            // Try name field
            const name = (listing as any).name;
            if (name && typeof name === 'string' && name.trim().length > 0) {
              listing.title = name.trim();
              fallbackTitleCount++;
            } else {
              // Generate fallback title: Product #${position} (${asin})
              const rank = listing.position || (listing as any).organic_rank || 0;
              const asin = listing.asin || 'UNKNOWN';
              listing.title = `Product #${rank} (${asin})`;
              fallbackTitleCount++;
            }
          }
          
          // IMAGE FALLBACK
          if (!listing.image_url || (typeof listing.image_url === 'string' && listing.image_url.trim().length === 0)) {
            // Try images array
            const images = (listing as any).images;
            if (Array.isArray(images) && images.length > 0) {
              const firstImage = images[0];
              if (firstImage && typeof firstImage === 'object' && firstImage.link) {
                const imageLink = firstImage.link;
                if (typeof imageLink === 'string' && imageLink.trim().length > 0) {
                  listing.image_url = imageLink.trim();
                  fallbackImageCount++;
                }
              } else if (typeof firstImage === 'string' && firstImage.trim().length > 0) {
                listing.image_url = firstImage.trim();
                fallbackImageCount++;
              }
            }
            
            // If still no image, use ASIN-based fallback URL
            if (!listing.image_url || (typeof listing.image_url === 'string' && listing.image_url.trim().length === 0)) {
              const asin = listing.asin;
              if (asin && typeof asin === 'string' && asin.trim().length > 0) {
                listing.image_url = `https://m.media-amazon.com/images/I/${asin}.jpg`;
                fallbackImageCount++;
              }
            }
          }
        }
        
        if (fallbackTitleCount > 0 || fallbackImageCount > 0) {
          console.log("🛡️ HARD_UI_FALLBACK_APPLIED", {
            total_listings: rawListings.length,
            fallback_title_count: fallbackTitleCount,
            fallback_image_count: fallbackImageCount,
            message: "Guaranteed title and image_url for all listings before canonical builder",
          });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // LOG BEFORE CANONICAL BUILDER CALL
        // ═══════════════════════════════════════════════════════════════════════════
        console.log("🔵 CALLING_BUILD_KEYWORD_PAGE_ONE", {
          keyword: body.input_value,
          raw_listings_count: rawListings.length,
          search_volume_low: searchVolumeLow,
          search_volume_high: searchVolumeHigh,
          sample_asins: rawListings.slice(0, 5).map((l: any) => l.asin),
          timestamp: new Date().toISOString(),
        });
        
        try {
          pageOneProducts = buildKeywordPageOne(rawListings, searchVolumeLow, searchVolumeHigh);
        } catch (canonicalError) {
          console.error("❌ CANONICAL_BUILDER_ERROR", {
            keyword: body.input_value,
            error: canonicalError instanceof Error ? canonicalError.message : String(canonicalError),
            stack: canonicalError instanceof Error ? canonicalError.stack : undefined,
            raw_listings_count: rawListings.length,
            timestamp: new Date().toISOString(),
          });
          // Continue with empty array - don't crash the request
          pageOneProducts = [];
        }
        
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
        // TIER-1 SNAPSHOT BUILD (FAST PATH - ≤10s)
        // ═══════════════════════════════════════════════════════════════════════════
        // Build Tier-1 snapshot from canonicalized listings BEFORE calibration
        // Tier-1 uses fast estimation (no BSR, no calibration)
        // This snapshot is returned immediately to UI
        if (pageOneProducts.length > 0 && body.input_type === "keyword") {
          try {
            // Build Tier-1 snapshot from raw listings (before full canonical builder)
            // This uses fast estimation without BSR or calibration
            const tier1Products = buildTier1Snapshot(
              rawListings, // Use raw listings for Tier-1 (fast path)
              body.input_value,
              marketplace as 'US' | 'CA',
              'complete'
            );
            
            // Generate snapshot ID
            const snapshotId = tier1Products.snapshot_id;
            
            tier1Snapshot = {
              snapshot: tier1Products,
              ui_hints: {
                show_refining_badge: true,
                next_update_expected_sec: 15,
              },
            };
            
            console.log("✅ TIER1_SNAPSHOT_BUILT", {
              snapshot_id: snapshotId,
              product_count: tier1Products.products.length,
              total_revenue: tier1Products.aggregates.total_page1_revenue,
              total_units: tier1Products.aggregates.total_page1_units,
              timestamp: new Date().toISOString(),
            });
            
            // ═══════════════════════════════════════════════════════════════════════════
            // TIER-2 REFINEMENT (ASYNC - NON-BLOCKING)
            // ═══════════════════════════════════════════════════════════════════════════
            // Trigger Tier-2 refinement asynchronously AFTER Tier-1 response
            // This runs in background and does NOT block /api/analyze
            const tier2Context: Tier2RefinementContext = {
              snapshot_id: snapshotId,
              keyword: body.input_value,
              marketplace: marketplace as 'US' | 'CA',
              listings: rawListings,
              tier1_products: tier1Products.products,
              supabase,
              apiCallCounter,
            };
            
            // Fire-and-forget: Do NOT await - let it run in background
            refineTier2Estimates(tier2Context)
              .then((tier2Enrichment) => {
                console.log("✅ TIER2_REFINEMENT_COMPLETE", {
                  snapshot_id: snapshotId,
                  refinements_applied: Object.keys(tier2Enrichment.refinements).length,
                  timestamp: new Date().toISOString(),
                });
                
                // TODO: Update snapshot in database with Tier-2 refinements
                // This allows UI to re-hydrate refined snapshot via snapshot_id
              })
              .catch((error) => {
                console.error("❌ TIER2_REFINEMENT_ERROR", {
                  snapshot_id: snapshotId,
                  error: error instanceof Error ? error.message : String(error),
                  timestamp: new Date().toISOString(),
                });
                // Fail silently - Tier-1 data is still usable
              });
            
          } catch (tier1Error) {
            console.error("❌ TIER1_SNAPSHOT_ERROR", {
              keyword: body.input_value,
              error: tier1Error instanceof Error ? tier1Error.message : String(tier1Error),
              timestamp: new Date().toISOString(),
            });
            // Continue with legacy path if Tier-1 fails
          }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // APPLY KEYWORD CALIBRATION (TIER-2 ONLY - MOVED TO ASYNC)
        // ═══════════════════════════════════════════════════════════════════════════
        // NOTE: Calibration is now Tier-2 only and runs asynchronously
        // Tier-1 uses fast estimation without calibration
        // This section is kept for backward compatibility but will be removed
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
      
      // TIER-1 early-return removed: we always run AI before persisting and responding.
      
      // Assign to function-scope variable (final authority)
      canonicalProducts = pageOneProducts;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // UPSERT canonical products to keyword_products cache
      // ═══════════════════════════════════════════════════════════════════════════
      if (canonicalProducts.length > 0 && body.input_type === "keyword") {
        try {
          // Create source tag map from raw listings (SP-API source tags)
          const sourceTagMap = new Map<string, {
            brand_source?: string;
            category_source?: string;
            bsr_source?: string;
            fulfillment_source?: string;
            price_source?: string;
            buy_box_owner_source?: string;
            offer_count_source?: string;
            image_source?: string;
            title_source?: string;
            main_category?: string | null;
            main_category_bsr?: number | null;
            buy_box_owner?: string | null;
            offer_count?: number | null;
          }>();
          
          // Populate source tag map from raw listings
          if (rawListings && rawListings.length > 0) {
            for (const listing of rawListings) {
              if (listing.asin) {
                const asin = listing.asin.toUpperCase();
                sourceTagMap.set(asin, {
                  brand_source: (listing as any).brand_source || null,
                  category_source: (listing as any).category_source || null,
                  bsr_source: (listing as any).bsr_source || null,
                  fulfillment_source: (listing as any).fulfillment_source || null,
                  price_source: (listing as any).price_source || null,
                  buy_box_owner_source: (listing as any).buy_box_owner_source || null,
                  offer_count_source: (listing as any).offer_count_source || null,
                  image_source: (listing as any).image_source || null,
                  title_source: (listing as any).title_source || null,
                  main_category: listing.main_category || null,
                  main_category_bsr: listing.main_category_bsr || null,
                  buy_box_owner: (listing as any).buy_box_owner || null,
                  offer_count: (listing as any).offer_count || null,
                });
              }
            }
          }
          
          const upsertData = canonicalProducts.map((p) => {
            const sourceTags = sourceTagMap.get(p.asin.toUpperCase()) || {};
            
            // Compute DB flags based on source tags
            // spapi_brands = TRUE when brand comes from catalogItems
            const spapi_brands = sourceTags.brand_source === 'sp_api_catalog';
            // spapi_fulfillment = TRUE when fulfillment comes from pricing API
            const spapi_fulfillment = sourceTags.fulfillment_source === 'sp_api_pricing';
            
            return {
              keyword: normalizedKeyword,
              asin: p.asin,
              rank: p.organic_rank ?? p.page_position ?? 1,
              price: p.price,
              estimated_monthly_units: p.estimated_monthly_units,
              estimated_monthly_revenue: p.estimated_monthly_revenue,
              // Full product card rendering fields (from Rainforest SERP + SP-API)
              title: p.title || null,
              rating: p.rating || null,
              review_count: p.review_count || null,
              image_url: p.image_url || null,
              brand: p.brand || null,
              is_sponsored: p.is_sponsored || false,
              fulfillment: p.fulfillment || null,
              // SP-API fields (authoritative)
              main_category: sourceTags.main_category || null,
              main_category_bsr: sourceTags.main_category_bsr || null,
              buy_box_owner: sourceTags.buy_box_owner || null,
              offer_count: sourceTags.offer_count || null,
              // Source tags (MANDATORY for SP-API verification)
              brand_source: sourceTags.brand_source || null,
              category_source: sourceTags.category_source || null,
              bsr_source: sourceTags.bsr_source || null,
              fulfillment_source: sourceTags.fulfillment_source || null,
              price_source: sourceTags.price_source || null,
              buy_box_owner_source: sourceTags.buy_box_owner_source || null,
              offer_count_source: sourceTags.offer_count_source || null,
              image_source: sourceTags.image_source || null,
              title_source: sourceTags.title_source || null,
              // Computed DB flags (for verification queries)
              // Note: These are computed from source tags, not stored as separate columns
              // Query: SELECT COUNT(*) FROM keyword_products WHERE brand_source = 'sp_api_catalog';
              last_updated: new Date().toISOString(),
            };
          });
          
          // Log DB flag statistics for verification
          const spapiBrandsCount = upsertData.filter(d => d.brand_source === 'sp_api_catalog').length;
          const spapiFulfillmentCount = upsertData.filter(d => d.fulfillment_source === 'sp_api_pricing').length;
          console.log("✅ SP_API_DB_FLAGS_COMPUTED", {
            keyword: normalizedKeyword,
            total_products: upsertData.length,
            spapi_brands_count: spapiBrandsCount,
            spapi_fulfillment_count: spapiFulfillmentCount,
            brand_source_breakdown: {
              sp_api_catalog: spapiBrandsCount,
              model_inferred: upsertData.filter(d => d.brand_source === 'model_inferred').length,
              rainforest_serp: upsertData.filter(d => d.brand_source === 'rainforest_serp').length,
              null: upsertData.filter(d => !d.brand_source).length,
            },
            fulfillment_source_breakdown: {
              sp_api_pricing: spapiFulfillmentCount,
              rainforest_serp: upsertData.filter(d => d.fulfillment_source === 'rainforest_serp').length,
              null: upsertData.filter(d => !d.fulfillment_source).length,
            },
          });
          
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
    
    // Guard: Ensure required data
    if (!sellerProfile) {
      throw new Error("Missing seller profile");
    }
    if (!marketSnapshot) {
      throw new Error("Missing market snapshot");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Create analysis_run immediately (before AI processing)
    // ═══════════════════════════════════════════════════════════════════════════
    // Create analysis_run record with listings data, status: "processing"
    // AI will update this record asynchronously when complete
    
    const listingsResponse = {
      input_type: "keyword",
      page_one_listings: canonicalProducts,
      products: canonicalProducts,
      aggregates_derived_from_page_one: contractResponse?.aggregates_derived_from_page_one || null,
      ...(contractResponse ? contractResponse : {}),
    };

    // Clean response for database storage
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

    const cleanedListingsResponse = cleanForJSON(listingsResponse);
    const serializedListingsResponse = JSON.stringify(cleanedListingsResponse);

    // Create analysis_run with status: "processing"
    const { data: insertedRun, error: insertError } = await supabase
      .from("analysis_runs")
      .insert({
        user_id: user.id,
        input_type: "keyword",
        input_value: body.input_value,
        ai_verdict: null, // Will be updated by async AI processing
        ai_confidence: null, // Will be updated by async AI processing
        seller_stage: sellerProfile.stage,
        seller_experience_months: sellerProfile.experience_months,
        seller_monthly_revenue_range: sellerProfile.monthly_revenue_range,
        response: cleanedListingsResponse, // Store listings data immediately
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("ANALYSIS_RUN_INSERT_ERROR", {
        error: insertError,
        message: insertError?.message,
      });
      // Continue anyway - we'll still return listings
    }

    console.log("LISTINGS_READY_RETURNING_IMMEDIATELY", {
      analysis_run_id: insertedRun?.id,
      product_count: canonicalProducts.length,
      timestamp: new Date().toISOString(),
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🛡️ DECISION FALLBACK GUARD
    // ═══════════════════════════════════════════════════════════════════════════
    // If market data exists but async decision brain has not returned yet,
    // inject a safe INSIGHT_ONLY decision so the UI never errors.
    if (
      contractResponse &&
      contractResponse.has_products === true &&
      (!contractResponse.decision || Object.keys(contractResponse.decision).length === 0)
    ) {
      contractResponse.decision = {
        status: 'INSIGHT_ONLY',
        decision_available: false,
        reason: 'Decision intentionally deferred or not required for this analysis',
        confidence_level: contractResponse.confidence_level ?? 'unknown',
        ui_message: 'Market data is ready. Strategic decision is intentionally omitted for this analysis.',
      };
      console.info('🟡 DECISION_FALLBACK_INJECTED', {
        keyword: body.input_value,
        analysis_run_id: insertedRun?.id,
        reason: 'Async decision not yet returned',
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: Trigger async AI processing (fire-and-forget)
    // ═══════════════════════════════════════════════════════════════════════════
    if (insertedRun?.id) {
      const { processAiAsync } = await import("@/lib/analyze/asyncAiProcessing");
      
      // Fire-and-forget: Process AI in background
      processAiAsync({
        analysisRunId: insertedRun.id,
        keyword: body.input_value,
        sellerProfile: {
          stage: sellerProfile.stage,
          experience_months: sellerProfile.experience_months,
          monthly_revenue_range: sellerProfile.monthly_revenue_range,
        },
        marketSnapshot,
        contractResponse,
        supabase,
      }).catch((error) => {
        console.error("Async AI processing failed (non-blocking):", error);
      });

      console.log("ASYNC_AI_PROCESSING_TRIGGERED", {
        analysis_run_id: insertedRun.id,
        keyword: body.input_value,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Return listings immediately (before AI completes)
    // ═══════════════════════════════════════════════════════════════════════════
    return NextResponse.json(
      {
        success: true,
        status: "processing", // AI is processing in background
        analysisRunId: insertedRun?.id,
        data_quality: dataQuality,
        dataSource: dataSource,
        snapshotType: dataSource === "market" ? "market" : (isEstimated ? "estimated" : "snapshot"),
        snapshot_last_updated: snapshotLastUpdated,
        // Return listings immediately
        page_one_listings: canonicalProducts,
        products: canonicalProducts,
        aggregates_derived_from_page_one: contractResponse?.aggregates_derived_from_page_one || null,
        ...(contractResponse ? contractResponse : {}),
        // Decision is set by fallback guard above if async AI hasn't returned yet
        // If contractResponse has decision, it's already spread above; otherwise it will be null
        message: "Listings loaded. AI insights processing...",
      },
      { 
        status: 200,
        headers: res.headers,
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
