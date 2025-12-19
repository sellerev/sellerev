import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { fetchKeywordMarketSnapshot, KeywordMarketData } from "@/lib/amazon/keywordMarket";
import { pickRepresentativeAsin } from "@/lib/amazon/representativeAsin";
import { checkUsageLimit, shouldIncrementUsage } from "@/lib/usage";
import { getFbaFeesEstimateForAsin } from "@/lib/spapi/fees";
import { getCachedFee, setCachedFee } from "@/lib/spapi/feeCache";
import { resolveFbaFees } from "@/lib/spapi/resolveFbaFees";

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
- Treat analysis as product-specific
- You MAY reference pricing, reviews, positioning
- You MAY compare directly to competitors
- You MAY reference specific product attributes if provided

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

Confidence score MUST be based on:
- Data completeness (keyword depth, listing count)
- Review barrier height
- Brand concentration
- Seller profile risk tolerance

Confidence caps (MANDATORY):
- If fewer than 5 valid listings exist → confidence MAX = 40
- If review_density > 60% → confidence MAX = 65
- If brand_concentration > 50% → confidence MAX = 60

You MUST explain WHY confidence is capped in your reasoning.

Example: "Confidence is capped at 60% because the top brand controls 55% of page 1 listings, indicating high market concentration risk."

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
- Explanation: "Page 1 listings average 2,400 reviews, indicating entrenched competitors that new listings typically struggle to outrank."

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
- Penalize high competition (cite review counts, competitor counts)
- Penalize heavy PPC reliance (cite price compression signals)
- Penalize weak differentiation (cite brand concentration %)
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

    // 7. Fetch keyword market data if input_type is "idea"
    let keywordMarketData = null;
    let marketSnapshot = null;
    let marketSnapshotJson = null;
    
    if (body.input_type === "idea") {
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
    }

    // 8. Build system prompt (with keyword-specific rules if applicable)
    let systemPrompt = SYSTEM_PROMPT;
    
    if (body.input_type === "idea" && marketSnapshot) {
      // Add keyword-specific market data section
      const keywordText = (marketSnapshot as any).keyword || body.input_value;
      const avgPriceText = marketSnapshot.avg_price !== null 
        ? `$${marketSnapshot.avg_price.toFixed(2)}` 
        : "Not available";
      const avgReviewsText = marketSnapshot.avg_reviews !== null 
        ? marketSnapshot.avg_reviews.toLocaleString() 
        : "Not available";
      const avgRatingText = marketSnapshot.avg_rating !== null 
        ? marketSnapshot.avg_rating.toFixed(1)
        : "Not available";
      const dominanceText = `${marketSnapshot.dominance_score}%`;

      const marketDataSection = `

KEYWORD ANALYSIS CONTEXT:

MARKET DATA (Page 1 Amazon search results for "${keywordText}"):
- Page 1 listings analyzed: ${marketSnapshot.total_page1_listings}
- Sponsored listings: ${marketSnapshot.sponsored_count}
- Avg price: ${avgPriceText}
- Avg reviews: ${avgReviewsText}
- Avg rating: ${avgRatingText}
- Brand dominance score: ${dominanceText} (top brand share of Page 1)

KEYWORD ANALYSIS RULES (NON-NEGOTIABLE):
- Treat keyword analysis as directional, not definitive
- Reference aggregated signals from Page 1 only, not individual ASIN performance
- If dominance_score > 50%, flag brand dominance as a risk
- If avg_reviews > 2000, flag high review barrier as a risk
- If total_page1_listings >= 10, flag crowded Page 1 as a risk
- This is aggregated Page 1 market context, not a specific product listing
- Cite specific numbers from market data when available
- If a metric is "Not available", explicitly state that in your analysis
- DO NOT reference total_results_estimate or deep pagination metrics (Page 1 only)

METRIC CITATION REQUIREMENTS:
- Executive Summary MUST include at least TWO metrics from the market data above
- Each Risk Breakdown explanation MUST reference at least ONE metric from the market data above
- Fill numbers_used field with actual values from market_snapshot (use null if metric is not available):
  - If you cite avg_price in your analysis, set numbers_used.avg_price to ${marketSnapshot.avg_price !== null ? marketSnapshot.avg_price : 'null'}
  - If you cite avg_reviews, set numbers_used.avg_reviews to ${marketSnapshot.avg_reviews !== null ? marketSnapshot.avg_reviews : 'null'}
  - If you cite total_page1_listings, set numbers_used.competitor_count to ${marketSnapshot.total_page1_listings}
  - If you cite dominance_score, set numbers_used.brand_concentration_pct to ${marketSnapshot.dominance_score}
  - For metrics you do NOT cite or that are not available, set to null`;

      systemPrompt = SYSTEM_PROMPT + marketDataSection;
    } else if (body.input_type === "idea") {
      // No market data available - add warning
      const warningSection = `

KEYWORD ANALYSIS CONTEXT:

MARKET DATA: Not available (insufficient search results or API error)

KEYWORD ANALYSIS RULES:
- Treat keyword analysis as directional, not definitive
- Without market data, analysis is based on general market knowledge only
- Confidence must be capped at <= 55% maximum
- Explicitly state "Insufficient Amazon market data for numeric citation" in Executive Summary
- Each Risk Breakdown explanation must state "Insufficient Amazon market data for numeric citation"
- Fill numbers_used field with all null values`;

      systemPrompt = SYSTEM_PROMPT + warningSection;
    }

    // Guard: Ensure required data before AI call
    if (!sellerProfile) {
      throw new Error("Missing seller profile");
    }
    if (body.input_type === "idea" && !marketSnapshot) {
      throw new Error("Missing market snapshot");
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

    // 11. Extract verdict and confidence for analytics
    const verdict = decisionJson.decision.verdict;
    let confidence = decisionJson.decision.confidence;

    // Cap confidence at 55 if keyword analysis has no market data
    if (body.input_type === "idea" && !marketSnapshot && confidence > 55) {
      confidence = 55;
      decisionJson.decision.confidence = 55;
    }

    // 12. Store market data in response for keyword analyses
    if (body.input_type === "idea" && keywordMarketData) {
      decisionJson.market_snapshot = marketSnapshot;
      decisionJson.market_listings = keywordMarketData.listings;
    }

    // 12b. Fetch FBA fee estimates via SP-API (with caching)
    // For ASIN analysis: use new resolveFbaFees resolver after market snapshot aggregation
    try {
      const marketplaceId = "ATVPDKIKX0DER"; // US marketplace (default)
      
      if (body.input_type === "asin") {
        // ASIN analysis: use the ASIN directly
        const asin = body.input_value.trim().toUpperCase();
        
        // Determine price_used: use avg_price from market snapshot if available
        let priceUsed = 25.0; // Default fallback
        if (decisionJson.market_snapshot && typeof decisionJson.market_snapshot === 'object' && 'avg_price' in decisionJson.market_snapshot) {
          const avgPrice = (decisionJson.market_snapshot as any).avg_price;
          if (avgPrice !== null && typeof avgPrice === 'number' && avgPrice > 0) {
            priceUsed = avgPrice;
          }
        }
        
        // Use new cache-first resolver
        const fbaFeesResult = await resolveFbaFees(asin, priceUsed);
        
        // Initialize market_snapshot if it doesn't exist
        if (!decisionJson.market_snapshot) {
          decisionJson.market_snapshot = {};
        }
        
        // Inject into decision JSON with new structure
        if (fbaFeesResult) {
          decisionJson.market_snapshot.fba_fees = {
            fulfillment_fee: fbaFeesResult.fulfillment_fee,
            referral_fee: fbaFeesResult.referral_fee,
            total_fba_fees: fbaFeesResult.total_fba_fees,
            source: "amazon",
          };
        } else {
          // Unavailable - set to null
          decisionJson.market_snapshot.fba_fees = null;
        }
        
        decisionJson.market_snapshot.representative_asin = asin;
      } else if (body.input_type === "idea" && keywordMarketData && marketSnapshot) {
        // Keyword analysis: pick representative ASIN and use avg price
        const representativeAsin = pickRepresentativeAsin(keywordMarketData.listings);
        const priceUsed = marketSnapshot.avg_price || 25.0; // Use avg price or fallback

        if (representativeAsin) {
          // Check cache first
          let feeEstimate = await getCachedFee(marketplaceId, representativeAsin, priceUsed);
          
          if (!feeEstimate) {
            // Cache miss - call SP-API
            feeEstimate = await getFbaFeesEstimateForAsin({
              asin: representativeAsin,
              price: priceUsed,
            });
            
            // Cache the result (best effort, don't wait)
            setCachedFee(marketplaceId, representativeAsin, priceUsed, feeEstimate).catch(() => {
              // Silently fail - caching is best effort
            });
          }

          // Ensure market_snapshot exists (should already exist from step 12)
          if (!decisionJson.market_snapshot) {
            decisionJson.market_snapshot = marketSnapshot;
          }
          
          decisionJson.market_snapshot.fba_fees = feeEstimate;
          decisionJson.market_snapshot.representative_asin = representativeAsin;
        } else {
          // No representative ASIN found - set estimated fees
          if (!decisionJson.market_snapshot) {
            decisionJson.market_snapshot = marketSnapshot;
          }
          decisionJson.market_snapshot.fba_fees = {
            total_fee: null,
            source: "estimated",
            asin_used: "",
            price_used: priceUsed,
          };
          decisionJson.market_snapshot.representative_asin = null;
        }
      }
    } catch (error) {
      // Fail gracefully - don't break the analysis
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("FBA fee estimation error:", errorMessage);
      
      // Set fba_fees to null if unavailable
      if (decisionJson.market_snapshot) {
        if (body.input_type === "asin") {
          decisionJson.market_snapshot.fba_fees = null;
          decisionJson.market_snapshot.representative_asin = body.input_value.trim().toUpperCase();
        } else {
          // For keyword analysis, keep existing fallback structure
          decisionJson.market_snapshot.fba_fees = {
            total_fee: null,
            source: "estimated",
            asin_used: "",
            price_used: marketSnapshot?.avg_price || 25.0,
          };
        }
      }
    }

    // 12a. Ensure numbers_used is populated from market snapshot if available
    if (body.input_type === "idea" && marketSnapshot) {
      if (!decisionJson.numbers_used) {
        decisionJson.numbers_used = {};
      }
      // Map snapshot structure to numbers_used format (Page 1 only)
      decisionJson.numbers_used.avg_price = marketSnapshot.avg_price;
      decisionJson.numbers_used.price_range = null; // Not available in Page 1 structure
      decisionJson.numbers_used.median_reviews = null; // Not available in Page 1 structure
      decisionJson.numbers_used.review_density_pct = null; // Not available in Page 1 structure
      decisionJson.numbers_used.brand_concentration_pct = marketSnapshot.dominance_score;
      decisionJson.numbers_used.competitor_count = marketSnapshot.total_page1_listings;
      decisionJson.numbers_used.avg_rating = marketSnapshot.avg_rating;
    } else if (body.input_type === "idea") {
      // Ensure numbers_used is all null if no market data
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
        ai_verdict: decisionJson.decision.verdict,
        ai_confidence: decisionJson.decision.confidence,
        seller_stage: sellerProfile.stage,
        seller_experience_months: sellerProfile.experience_months,
        seller_monthly_revenue_range: sellerProfile.monthly_revenue_range,
        response: decisionJson,
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
        decision: decisionJson,
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

