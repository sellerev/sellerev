import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { fetchKeywordMarketSnapshot, KeywordMarketData } from "@/lib/amazon/keywordMarket";
import { fetchAsinData, AsinSnapshot } from "@/lib/amazon/asinData";
import { pickRepresentativeAsin } from "@/lib/amazon/representativeAsin";
import { calculateCPI } from "@/lib/amazon/competitivePressureIndex";
import { checkUsageLimit, shouldIncrementUsage } from "@/lib/usage";
import { resolveFbaFees } from "@/lib/spapi/resolveFbaFees";
import { buildMarginSnapshot } from "@/lib/margins/buildMarginSnapshot";
import { buildKeywordAnalyzeResponse, buildAsinAnalyzeResponse } from "@/lib/analyze/dataContract";

// Sellerev production SYSTEM PROMPT
const SYSTEM_PROMPT = `You are Sellerev, an AI advisory system for Amazon FBA sellers.

Your role is to make clear, conservative, professional decisions about whether an Amazon product or idea is viable for a specific seller, based on limited but realistic information.

You are not a data dashboard.
You are not neutral.
You are an expert advisor whose output may influence real financial decisions.

Your primary objective is to prevent sellers from making costly mistakes.

CORE OPERATING PRINCIPLES (NON-NEGOTIABLE)

1. Decision over data
   - Always provide a clear verdict.
   - Never dump raw metrics without interpretation.

2. Conservatism
   - If evidence is incomplete or ambiguous, default to caution or rejection.
   - It is acceptable and encouraged to recommend not proceeding.

3. Seller-specific reasoning
   - The same product may be viable for one seller and inappropriate for another.
   - Always incorporate seller context into your reasoning.

4. Explicit uncertainty
   - State assumptions and limitations clearly.
   - Never imply certainty where none exists.

5. Professional tone
   - Calm, analytical, and precise.
   - No hype, no emojis, no sales language.

NUMERIC GROUNDING RULES (MANDATORY)

- Every verdict MUST reference at least 2 numeric signals
- Examples of valid numeric signals:
  - Average price
  - Review count
  - Review density %
  - Competitor count
  - Brand concentration %
  - Confidence score justification

- Forbidden phrases unless followed by numbers:
  ❌ "high competition"
  ❌ "significant competition"
  ❌ "crowded market"
  ❌ "strong differentiation required"
  ❌ "challenging category"

- Replace with:
  ✅ "Page 1 shows 10 competitors with an average of 3,200 reviews"
  ✅ "Top brand controls ~60% of listings"
  ✅ "Average price cluster is $24–$28"

If numeric data is missing:
- Say: "This signal could not be evaluated due to missing market data."

STRICT PROHIBITIONS (YOU MUST NEVER DO THESE)

You must NOT:
- Guess or fabricate revenue, sales volume, or BSR
- Guess PPC costs or conversion rates
- Claim high demand without qualification
- Use definitive financial guarantees
- Encourage risky launches without clear justification
- Reference proprietary or private Amazon data
- Hallucinate supplier costs or margins
- Use generic phrases without numeric backing

If required information is unavailable, you must explicitly state that limitation.

REQUIRED INPUT CONTEXT

You will always receive:

Seller Context:
- stage: one of new, existing, thinking
- experience_months: integer or null
- revenue_range: string or null

Product Input:
- Either an Amazon ASIN
- Or a plain-text product idea or keyword

You must treat this as partial information, not a complete dataset.

KEYWORD vs ASIN BEHAVIORAL SPLIT

IF input_type === "keyword":
- Treat analysis as market-level
- NEVER imply sales velocity or revenue
- NEVER reference individual ASIN performance
- Use language like:
  - "Page 1 keyword results suggest..."
  - "Search results indicate..."
  - "Aggregated market signals show..."
- Reference aggregated signals (avg_price, review_density, brand_concentration)
- This is directional market intelligence, not product-specific advice

IF input_type === "asin":
- ASIN mode is NOT market discovery. It is competitive targeting.
- Answer ONE question only: "Should I compete with this specific product, given who I am as a seller?"
- This is an attack decision, not a market decision.
- Focus on: "Is this ASIN a realistic competitive target for this seller?"
- NOT: "Is this market good?" or "Is this niche attractive?"

ASIN VERDICT RUBRIC (MANDATORY):

🟢 GO — Beatable
Use when:
- Review moat is weak or moderate
- Brand control < 40%
- Price is defensible or inflated
- Seller profile supports entry

Copy template: "This ASIN is beatable with a differentiated offer."

🟡 CAUTION — Beatable with constraints
Use when:
- Reviews are high but not dominant
- Brand has leverage but not monopoly
- Entry requires capital, patience, or innovation

Copy template: "This ASIN is strong but has identifiable weaknesses."

🔴 NO_GO — Not a rational target
Use when:
- Review moat is extreme
- Brand dominance is high
- Price compression + ad saturation
- Seller profile mismatched

Copy template: "This ASIN is not a realistic competitive target for your seller profile."

ASIN VERDICT REQUIREMENTS (MANDATORY):
- Every verdict explanation MUST cite at least TWO of:
  • Review moat
  • Brand leverage
  • Price defensibility
  • Seller profile alignment
- No generic summaries allowed
- Reference specific ASIN metrics (price, rating, reviews, BSR, fulfillment, brand owner)
- Compare ASIN strength vs Page 1 competitors when available

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

GO:
- Risks are manageable
- Seller is appropriately positioned
- Clear path to differentiation or execution exists
- MUST cite at least 2 numeric signals supporting viability

CAUTION:
- Viability depends on specific conditions
- Risks are meaningful but not fatal
- Proceed only if recommendations are followed
- MUST cite numeric signals that create uncertainty

NO_GO:
- Competitive, structural, or execution risks outweigh upside
- Particularly unsuitable for the seller's stage
- Recommend abandoning or postponing
- MUST cite numeric signals that justify rejection

CONFIDENCE SCORE JUSTIFICATION (MANDATORY)

Confidence score (0–100) reflects decision confidence, not success probability.

FOR KEYWORD ANALYSES:
Confidence score MUST be based on:
- Data completeness (keyword depth, listing count)
- Review barrier height
- Brand concentration
- Seller profile risk tolerance

Confidence caps (MANDATORY for keywords):
- If fewer than 5 valid listings exist → confidence MAX = 40
- If review_density > 60% → confidence MAX = 65
- If brand_concentration > 50% → confidence MAX = 60

FOR ASIN ANALYSES:
Confidence = likelihood the verdict holds if you attempt to compete
NOT: Market success probability, Revenue potential, Accuracy of data

ASIN Confidence Baseline: Start at 50%

ASIN Confidence Adjustments:
Positive adjustments (+):
- Weak review moat (< 500 reviews) → +10
- Fragmented brand landscape (dominance < 30%) → +10
- Seller experience aligns (existing/scaling with 6+ months) → +5
- Price inefficiency detected (low rating + high price) → +5

Negative adjustments (-):
- Review moat > P80 (> 5000 reviews) → -15
- Brand dominance > 50% → -15
- Amazon retail presence → -20
- Ad-heavy category (> 40% sponsored) → -10
- Seller profile mismatch (new seller + high barriers) → -10

ASIN Confidence Caps (MANDATORY, no exceptions):
- Brand-led ASIN (dominance > 40%) → MAX 65%
- Review moat > 1,000 → MAX 60%
- Amazon retail → MAX 50%
- Insufficient data → MAX 55%

You MUST explain WHY confidence is capped in your reasoning.

Examples:
- "Confidence capped at 60% due to strong review moat."
- "Confidence capped at 65% due to brand-led market."
- "Confidence capped at 50% due to Amazon retail presence."

EXECUTIVE SUMMARY REWRITE RULES (MANDATORY)

Executive Summary MUST follow this structure:

1. State verdict in first sentence
2. Cite at least 2 market metrics in second sentence
3. Tie feasibility to seller profile in third sentence

HARD RULE FOR KEYWORD ANALYSES:
- Every Executive Summary paragraph MUST include at least TWO concrete metrics from market_snapshot_json
- Required metrics: price (avg_price or price_range), reviews (avg_reviews or median_reviews), density (review_density_pct), brand concentration (brand_concentration_pct), rating (avg_rating), or competitor count (competitor_count)
- If market_snapshot_json is missing, you MUST explicitly say "Insufficient Amazon market data for numeric citation"

Example format:
"This opportunity is rated CAUTION. Page 1 shows an average of 2,800 reviews across 10 competitors, with the top brand controlling ~55% of listings. For an existing seller, entry is possible only with clear differentiation or bundling."

FORBIDDEN in Executive Summary:
- Generic phrases without numbers
- Vague statements like "significant competition" or "may be challenging"
- Claims not backed by provided market data

RISK BREAKDOWN TIGHTENING (MANDATORY)

Each risk category MUST include:
- A numeric trigger (specific threshold from market data)
- A short explanation tied to that trigger

HARD RULE FOR KEYWORD ANALYSES:
- The Risk Breakdown explanations MUST reference at least one metric each from market_snapshot_json
- Each risk must cite: avg_price, price_range, avg_reviews, median_reviews, review_density_pct, brand_concentration_pct, avg_rating, or competitor_count
- If market_snapshot_json is missing, state "Insufficient Amazon market data for numeric citation" in each risk explanation

Example format:

Competition Risk:
- Trigger: avg_reviews > 2,000
- Explanation: "Page 1 listings average 2,400 reviews, indicating entrenched competitors that new listings must overcome to rank."

Pricing Risk:
- Trigger: price_range < $5
- Explanation: "Price range is $12–$15, creating narrow margin room for differentiation."

Differentiation Risk:
- Trigger: brand_concentration > 50%
- Explanation: "Top brand controls 60% of page 1 listings, suggesting strong brand loyalty that new entrants must overcome."

Operations Risk:
- Trigger: competitor_count >= 10
- Explanation: "Page 1 shows 10 competitors, indicating operational complexity in inventory and fulfillment."

NO abstract explanations allowed. Every risk explanation MUST reference a numeric signal.

SELLER CONTEXT INTERPRETATION

New seller:
- Penalize competition (cite review counts, competitor counts with numbers)
- Penalize PPC reliance (cite ad saturation with numbers)
- Penalize weak differentiation (cite brand concentration % with numbers)
- Favor simplicity and speed to validation
- Use numeric thresholds: "For a new seller, entering a category where competitors average 3,000+ reviews is high risk."

Existing seller:
- Allow for higher competition if strategic advantages exist (cite specific numbers)
- Consider portfolio synergies
- Weigh opportunity cost
- Use numeric thresholds: "For an existing seller, 8 competitors with 1,500 average reviews is manageable."

Thinking:
- Focus on educational clarity
- Highlight why something would or would not work (with numbers)
- Emphasize learning, not execution

FINAL CHECK BEFORE RESPONDING

Before returning your answer, verify:
- Verdict matches reasoning
- Risks are internally consistent
- Recommendations are actionable
- Assumptions are explicitly stated
- Output is conservative, professional, and honest
- Every verdict references at least 2 numeric signals
- No generic phrases remain (all replaced with numeric statements)
- Executive summary follows the 3-sentence structure
- Each risk explanation includes a numeric trigger
- Confidence score justification is explained

Output should read like advice from a senior Amazon operator who cites specific market data.`;

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

interface AnalyzeRequestBody {
  input_type: "asin" | "idea";
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
  return (
    typeof body === "object" &&
    body !== null &&
    (body.input_type === "asin" || body.input_type === "idea") &&
    typeof body.input_value === "string" &&
    body.input_value.trim().length > 0
  );
}


function validateDecisionContract(data: any): data is DecisionContract {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  // Check all required keys exist
  for (const key of REQUIRED_DECISION_KEYS) {
    if (!(key in data)) {
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
    return false;
  }

  // Validate risks object
  const riskLevels = ["Low", "Medium", "High"];
  const riskKeys = ["competition", "pricing", "differentiation", "operations"];
  if (
    typeof data.risks !== "object" ||
    data.risks === null
  ) {
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
    const { data: sellerProfile, error: profileError } = await supabase
      .from("seller_profiles")
      .select("stage, experience_months, monthly_revenue_range, sourcing_model")
      .eq("id", user.id)
      .single();

    if (profileError || !sellerProfile) {
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

    if (!validateRequestBody(body)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid request body. Expected { input_type: 'asin' | 'idea', input_value: string }",
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

    console.log("SELLER_PROFILE", sellerProfile);

    // 7. Fetch data based on input type
    let keywordMarketData = null;
    let marketSnapshot = null;
    let marketSnapshotJson = null;
    let asinData: AsinSnapshot | null = null;
    
    if (body.input_type === "asin") {
      // ASIN mode: Fetch ASIN product data (required)
      console.log("FETCHING_ASIN_DATA", body.input_value);
      asinData = await fetchAsinData(body.input_value);
      
      if (!asinData) {
        return NextResponse.json(
          {
            success: false,
            error: "Unable to fetch ASIN product data. The ASIN may be invalid or unavailable.",
          },
          { status: 422, headers: res.headers }
        );
      }
      
      // Validate required fields for ASIN snapshot
      // Price OR rating must exist (at least one is required for analysis)
      if (asinData.price === null && asinData.rating === null) {
        return NextResponse.json(
          {
            success: false,
            error: "ASIN data missing required fields (price or rating required)",
          },
          { status: 422, headers: res.headers }
        );
      }
      
      console.log("ASIN_DATA_FETCHED", {
        asin: asinData.asin,
        hasPrice: asinData.price !== null,
        hasRating: asinData.rating !== null,
        hasReviews: asinData.reviews !== null,
        brand_owner: asinData.brand_owner,
      });
    } else if (body.input_type === "idea") {
      keywordMarketData = await fetchKeywordMarketSnapshot(body.input_value);
      console.log("RAIN_DATA_RAW", keywordMarketData);
      
      // Guard: 422 ONLY if search_results is empty or missing (Page 1 only)
      if (!keywordMarketData || !keywordMarketData.snapshot || keywordMarketData.snapshot.total_page1_listings === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "No market data available for this keyword",
          },
          { status: 422, headers: res.headers }
        );
      }
      
      // Use the snapshot directly (already aggregated)
      marketSnapshot = keywordMarketData.snapshot;
      marketSnapshotJson = keywordMarketData.snapshot;
      
      // Calculate Competitive Pressure Index (CPI) from Page 1 listings
      // CPI is seller-context aware and computed deterministically
      // CPI is computed ONCE per analysis and cached - never recalculated
      if (keywordMarketData.listings && keywordMarketData.listings.length > 0) {
        const cpiResult = calculateCPI({
          listings: keywordMarketData.listings,
          sellerStage: sellerProfile.stage as "new" | "existing" | "scaling",
          sellerExperienceMonths: sellerProfile.experience_months,
        });
        
        // Inject CPI into market snapshot with new structure
        (marketSnapshot as any).cpi = {
          score: cpiResult.score,
          label: cpiResult.label,
          breakdown: cpiResult.breakdown,
        };
      } else {
        // No Page 1 data → CPI = null
        (marketSnapshot as any).cpi = null;
      }
    }

    // 8. Build data contract response BEFORE AI call
    // This ensures we have the structured data to pass to AI via ai_context
    let contractResponse: any = null;
    let marginSnapshot: any = null;
    
    // First, calculate margin snapshot (needed for contract response)
    try {
      const marginMode: 'ASIN' | 'KEYWORD' = body.input_type === 'asin' ? 'ASIN' : 'KEYWORD';
      
      // For ASIN mode: use ASIN price directly
      // For KEYWORD mode: will use avg_price after market snapshot is built
      let priceForMargin = body.input_type === 'asin' && asinData?.price 
        ? asinData.price 
        : marketSnapshot?.avg_price || 25.0;
      
      // Fetch FBA fees first (needed for margin calculation)
      let fbaFees: { total_fba_fees: number | null; source: "sp_api" | "estimated" | "unknown" } | null = null;
      
      if (body.input_type === "asin" && asinData) {
        const asin = body.input_value.trim().toUpperCase();
        priceForMargin = asinData.price || 25.0;
        const fbaFeesResult = await resolveFbaFees(asin, priceForMargin);
        if (fbaFeesResult) {
          fbaFees = {
            total_fba_fees: fbaFeesResult.total_fba_fees,
            source: "sp_api",
          };
        }
      } else if (body.input_type === "idea" && keywordMarketData && marketSnapshot) {
        const representativeAsin = pickRepresentativeAsin(keywordMarketData.listings);
        priceForMargin = marketSnapshot.avg_price || 25.0;
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
        analysisMode: marginMode,
        sellerProfile: {
          sourcing_model: sellerProfile.sourcing_model as any,
        },
        asinSnapshot: asinData ? { price: asinData.price } : null,
        marketSnapshot: marketSnapshot ? {
          avg_price: marketSnapshot.avg_price,
          category: marketSnapshot.category,
        } : null,
        fbaFees,
        userOverrides: null,
      });
    } catch (error) {
      console.error("Margin snapshot calculation error:", error);
      // Create default margin snapshot
      const defaultMarginMode: 'ASIN' | 'KEYWORD' = body.input_type === 'asin' ? 'ASIN' : 'KEYWORD';
      marginSnapshot = buildMarginSnapshot({
        analysisMode: defaultMarginMode,
        sellerProfile: {
          sourcing_model: sellerProfile.sourcing_model as any,
        },
        asinSnapshot: null,
        marketSnapshot: null,
        fbaFees: null,
        userOverrides: null,
      });
    }
    
    // Build contract-compliant response
    if (body.input_type === "idea" && keywordMarketData) {
      contractResponse = buildKeywordAnalyzeResponse(
        body.input_value,
        keywordMarketData,
        marginSnapshot
      );
    } else if (body.input_type === "asin" && asinData) {
      contractResponse = buildAsinAnalyzeResponse(
        body.input_value.trim().toUpperCase(),
        asinData,
        marginSnapshot
      );
    }
    
    // 8. Build system prompt with ai_context ONLY
    let systemPrompt = SYSTEM_PROMPT;
    
    if (contractResponse && contractResponse.ai_context) {
      const aiContextSection = `

DATA CONTRACT CONTEXT (READ-ONLY):

You MUST use ONLY the following ai_context object. This is the single source of truth.
Do NOT reference data outside this context. Do NOT invent metrics.

${JSON.stringify(contractResponse.ai_context, null, 2)}

CRITICAL RULES:
- All reasoning MUST be based on the ai_context object above
- If a metric is null in ai_context, explicitly state it's unavailable
- Do NOT fabricate or estimate values not present in ai_context
- For keyword mode: Use summary, products, market_structure, margin_snapshot, signals
- For ASIN mode: Use asin_snapshot, listing_quality, page1_benchmarks, margin_snapshot, signals`;

      systemPrompt = SYSTEM_PROMPT + aiContextSection;
    }

    // Guard: Ensure required data before AI call
    if (!sellerProfile) {
      throw new Error("Missing seller profile");
    }
    if (body.input_type === "idea" && !marketSnapshot) {
      throw new Error("Missing market snapshot");
    }
    if (body.input_type === "asin" && !asinData) {
      throw new Error("Missing ASIN data");
    }

    console.log("AI_PROMPT_READY");

    // 9. Call OpenAI
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { success: false, error: "OpenAI API key not configured" },
        { status: 500, headers: res.headers }
      );
    }

    // 10. Build user message with seller context (raw values, no interpretation)
    const userMessage = `SELLER CONTEXT:
- Stage: ${sellerContext.stage}
- Experience (months): ${sellerContext.experience_months ?? "null"}
- Monthly revenue range: ${sellerContext.monthly_revenue_range ?? "null"}

ANALYSIS REQUEST:
${body.input_value}`;

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
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      return NextResponse.json(
        {
          success: false,
          error: `OpenAI API error: ${openaiResponse.statusText}`,
          details: errorData,
        },
        { status: 500, headers: res.headers }
      );
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    console.log("AI_RESPONSE_RAW", content?.substring(0, 500));

    if (!content) {
      return NextResponse.json(
        { success: false, error: "No content in OpenAI response" },
        { status: 500, headers: res.headers }
      );
    }

    // 9. Parse and validate OpenAI JSON output
    let decisionJson: any;
    try {
      // Remove markdown code blocks if present
      const cleanedContent = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      decisionJson = JSON.parse(cleanedContent);
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error: "OpenAI returned invalid JSON",
          details: content.substring(0, 200),
        },
        { status: 500, headers: res.headers }
      );
    }

    // 10. Validate decision contract structure
    if (!validateDecisionContract(decisionJson)) {
      return NextResponse.json(
        {
          success: false,
          error: "OpenAI output does not match decision contract. Missing required keys or invalid structure.",
          received_keys: Object.keys(decisionJson),
          required_keys: REQUIRED_DECISION_KEYS,
        },
        { status: 500, headers: res.headers }
      );
    }

    console.log("AI_VALIDATED");

    // 10a. Inject ASIN data into decision JSON (ASIN mode only - never AI-generated)
    if (body.input_type === "asin" && asinData) {
      // Store fetched ASIN data as asin_snapshot (overwrite any AI-generated version)
      decisionJson.asin_snapshot = {
        asin: asinData.asin,
        price: asinData.price,
        rating: asinData.rating,
        reviews: asinData.reviews,
        bsr: asinData.bsr,
        fulfillment: asinData.fulfillment,
        brand_owner: asinData.brand_owner,
        brand: asinData.brand,
      };
      
      // Add pressure_score if needed (can be AI-generated from asin_snapshot data)
      // But keep it separate - pressure_score is analysis, not raw data
      // For now, let AI generate it if needed, but we have the raw data
    }

    // 11. Extract verdict and confidence for analytics
    const verdict = decisionJson.decision.verdict;
    let confidence = decisionJson.decision.confidence;
    const confidenceDowngrades: string[] = [];

    // ASIN MODE: Confidence calculation (competitive targeting) - NO Page-1 dependencies
    if (body.input_type === "asin" && asinData) {
      // Start at 50% baseline
      confidence = 50;
      
      // Use fetched ASIN data (guaranteed to exist for ASIN mode)
      const asinReviews = asinData.reviews;
      const asinRating = asinData.rating;
      const asinPrice = asinData.price;
      const brandOwner = asinData.brand_owner;
      const brandName = asinData.brand; // Can use brand name for additional context
      
      // Positive adjustments (+)
      // Weak review moat → +10 (reviews < 500)
      if (asinReviews !== null && asinReviews < 500) {
        confidence += 10;
      }
      
      // Third-party brand (not Amazon, not brand-owned) → +10 (more fragmented/beatable)
      if (brandOwner === "Third-Party") {
        confidence += 10;
      }
      
      // Seller experience aligns → +5 (heuristic: existing sellers get boost)
      if (sellerProfile.stage === "existing" || sellerProfile.stage === "scaling") {
        if (sellerProfile.experience_months && sellerProfile.experience_months >= 6) {
          confidence += 5;
        }
      }
      
      // Price inefficiency detected → +5 (heuristic: if price is high relative to rating)
      if (asinPrice !== null && asinRating !== null && asinRating < 4.0 && asinPrice > 30) {
        confidence += 5;
      }
      
      // Negative adjustments (-)
      // Review moat > 5,000 → -15 (strong review barrier)
      if (asinReviews !== null && asinReviews > 5000) {
        confidence -= 15;
      }
      
      // Brand-owned (not Amazon, but brand controls) → -10 (brand leverage)
      if (brandOwner === "Brand") {
        confidence -= 10;
      }
      
      // Amazon retail presence → -20 (hardest to compete with)
      if (brandOwner === "Amazon") {
        confidence -= 20;
      }
      
      // Seller profile mismatch → -10 (heuristic: new seller with high barriers)
      if (sellerProfile.stage === "new" && asinReviews !== null && asinReviews > 2000) {
        confidence -= 10;
      }
      
      // Confidence caps (ASIN mode) - based on ASIN data only, NO Page-1
      // Amazon retail → 50% max (hardest competitive barrier)
      if (brandOwner === "Amazon") {
        confidence = Math.min(confidence, 50);
        if (!confidenceDowngrades.some(d => d.includes("Amazon"))) {
          confidenceDowngrades.push("Confidence capped at 50% due to Amazon retail presence");
        }
      }
      
      // Review moat > 1,000 → 60% max (strong review barrier)
      if (asinReviews !== null && asinReviews > 1000) {
        confidence = Math.min(confidence, 60);
        if (!confidenceDowngrades.some(d => d.includes("review"))) {
          confidenceDowngrades.push("Confidence capped at 60% due to strong review moat");
        }
      }
      
      // Brand-owned → 65% max (brand leverage reduces displacement feasibility)
      if (brandOwner === "Brand") {
        confidence = Math.min(confidence, 65);
        if (!confidenceDowngrades.some(d => d.includes("brand"))) {
          confidenceDowngrades.push("Confidence capped at 65% due to brand ownership");
        }
      }
      
      // Insufficient data → 55% max (if critical fields missing)
      if ((asinReviews === null && asinRating === null && asinPrice === null)) {
        confidence = Math.min(confidence, 55);
        if (!confidenceDowngrades.some(d => d.includes("insufficient") || d.includes("Insufficient"))) {
          confidenceDowngrades.push("Confidence capped at 55% due to insufficient ASIN data");
        }
      }
      
      // Ensure confidence stays within 0-100 bounds
      confidence = Math.max(0, Math.min(100, confidence));
    }
    
    // KEYWORD MODE: Apply keyword-specific confidence rules
    // Rule 1: Keyword searches always start at max 75%
    if (body.input_type === "idea" && confidence > 75) {
      confidence = 75;
      confidenceDowngrades.push("Keyword searches capped at 75% maximum confidence");
    }

    // Rule 4: Sparse page-1 data → downgrade
    if (body.input_type === "idea" && marketSnapshot) {
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

    // 12a. Ensure numbers_used is populated from contract response if available
    if (body.input_type === "idea" && contractResponse) {
      if (!decisionJson.numbers_used) {
        decisionJson.numbers_used = {};
      }
      // Map contract response to numbers_used format
      decisionJson.numbers_used.avg_price = contractResponse.summary.avg_price;
      decisionJson.numbers_used.price_range = [
        contractResponse.market_structure.price_band.min,
        contractResponse.market_structure.price_band.max,
      ];
      decisionJson.numbers_used.median_reviews = contractResponse.market_structure.review_barrier.median_reviews;
      decisionJson.numbers_used.review_density_pct = null; // Not in contract
      decisionJson.numbers_used.brand_concentration_pct = contractResponse.market_structure.brand_dominance_pct;
      decisionJson.numbers_used.competitor_count = contractResponse.summary.page1_product_count;
      decisionJson.numbers_used.avg_rating = contractResponse.summary.avg_rating;
    } else if (body.input_type === "asin" && contractResponse) {
      if (!decisionJson.numbers_used) {
        decisionJson.numbers_used = {};
      }
      // Map ASIN contract response to numbers_used
      decisionJson.numbers_used.avg_price = contractResponse.asin_snapshot.price;
      decisionJson.numbers_used.price_range = null;
      decisionJson.numbers_used.median_reviews = contractResponse.asin_snapshot.review_count;
      decisionJson.numbers_used.review_density_pct = null;
      decisionJson.numbers_used.brand_concentration_pct = null;
      decisionJson.numbers_used.competitor_count = null;
      decisionJson.numbers_used.avg_rating = contractResponse.asin_snapshot.rating;
    } else {
      // Ensure numbers_used is all null if no contract data
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
    
    if (body.input_type === "idea" && keywordMarketData) {
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
      
      // Build keywordMarket with required structure
      // Always include market_snapshot even if listings is empty (UI needs to show empty state)
      keywordMarket = {
        market_snapshot: {
          marketplace: "US", // TODO: Extract from request if available
          search_term: body.input_value,
          page: 1,
          total_results_estimate: null, // Not available in current structure
          total_page1_listings: snapshot.total_page1_listings || 0,
          sponsored_count: snapshot.sponsored_count || 0,
          avg_price: snapshot.avg_price,
          avg_rating: snapshot.avg_rating,
          avg_reviews: snapshot.avg_reviews,
          dominance_score: snapshot.dominance_score || null,
          listings: listings.map((listing) => ({
            asin: listing.asin || "",
            title: listing.title || "",
            brand: listing.brand || null,
            price: listing.price || null,
            rating: listing.rating || null,
            reviews: listing.reviews || null,
            bsr: null, // BSR not available in listings structure
            image: listing.image_url || null,
            is_sponsored: listing.is_sponsored || false,
            revenue_est: listing.est_monthly_revenue || null,
            units_est: listing.est_monthly_units || null,
            revenue_share: null, // Will be calculated in frontend if needed
          })),
        },
      };
    }
    
    // 12c. Build final response structure with contract-compliant data
    // Store AI decision separately from raw data contract
    // Note: contractResponse was built earlier (before AI call) with margin snapshot
    const finalResponse: any = {
      // AI Decision (verdict, summary, reasoning, risks, actions)
      decision: {
        ...decisionJson.decision,
        executive_summary: decisionJson.executive_summary,
        reasoning: decisionJson.reasoning,
        risks: decisionJson.risks,
        recommended_actions: decisionJson.recommended_actions,
        assumptions_and_limits: decisionJson.assumptions_and_limits,
        numbers_used: decisionJson.numbers_used,
        confidence_downgrades: decisionJson.confidence_downgrades || [],
        
        // Include market_snapshot in decision for frontend access
        // Use keywordMarket if available (new structure), otherwise use legacy
        market_snapshot: keywordMarket?.market_snapshot || (contractResponse?.market_snapshot ? {
          ...contractResponse.market_snapshot,
          listings: contractResponse.products || [], // Map products to listings for UI
        } : null),
        
        // Include margin_snapshot in decision
        margin_snapshot: decisionJson.margin_snapshot || contractResponse?.margin_snapshot || null,
      },
      
      // Data Contract (raw data layer - no scores/verdicts)
      // Merge contract response if it exists
      ...(contractResponse ? contractResponse : {}),
      
      // Keyword Market (for UI - data-first display)
      ...(keywordMarket ? keywordMarket : {}),
    };

    // 13. Save to analysis_runs with verdict, confidence, and seller context snapshot
    // Returns the created row to get the analysis_run_id (required for chat integration)
    // Store market data in both response (for structured access) and rainforest_data (for consistency)
    
    // Prepare rainforest_data (omit null fields to avoid database issues)
    // Note: This is Page 1 data only
    let rainforestData = null;
    if (body.input_type === "idea" && marketSnapshot) {
      rainforestData = {
        average_price: marketSnapshot.avg_price,
        review_count_avg: marketSnapshot.avg_reviews,
        average_rating: marketSnapshot.avg_rating,
        competitor_count: marketSnapshot.total_page1_listings,
        dominance_score: marketSnapshot.dominance_score,
        sponsored_count: marketSnapshot.sponsored_count,
        data_fetched_at: new Date().toISOString(),
      };
      // Only include fields that are not null
      if (rainforestData.average_price === null) delete rainforestData.average_price;
      if (rainforestData.review_count_avg === null) delete rainforestData.review_count_avg;
      if (rainforestData.average_rating === null) delete rainforestData.average_rating;
      // dominance_score is always a number (0-100), so no need to delete
    }

    // 13. Save to analysis_runs
    console.log("BEFORE_INSERT", {
      user_id: user.id,
      input_type: body.input_type,
      has_decision: !!decisionJson.decision,
    });

    const { data: insertedRun, error: insertError } = await supabase
      .from("analysis_runs")
      .insert({
        user_id: user.id,
        input_type: body.input_type,
        input_value: body.input_value,
        ai_verdict: finalResponse.decision.verdict,
        ai_confidence: finalResponse.decision.confidence,
        seller_stage: sellerProfile.stage,
        seller_experience_months: sellerProfile.experience_months,
        seller_monthly_revenue_range: sellerProfile.monthly_revenue_range,
        response: finalResponse, // Store contract-compliant response
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("ANALYSIS_RUN_INSERT_ERROR", {
        error: insertError,
        message: insertError?.message,
        details: insertError?.details,
        hint: insertError?.hint,
        code: insertError?.code,
      });
      return NextResponse.json(
        { success: false, error: "Failed to save analysis run" },
        { status: 500, headers: res.headers }
      );
    }

    console.log("AFTER_INSERT_SUCCESS", {
      analysis_run_id: insertedRun.id,
    });

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

    // 14. Return success response
    console.log("RETURNING_SUCCESS", {
      analysisRunId: insertedRun.id,
      has_decision: !!decisionJson,
    });
    return NextResponse.json(
      {
        success: true,
        analysisRunId: insertedRun.id,
        decision: finalResponse, // Return contract-compliant response
      },
      { status: 200, headers: res.headers }
    );
  } catch (err) {
    console.error("ANALYZE_ERROR", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal analyze error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: res.headers }
    );
  }
}

