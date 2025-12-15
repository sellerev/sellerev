import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

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

STRICT PROHIBITIONS (YOU MUST NEVER DO THESE)

You must NOT:
- Guess or fabricate revenue, sales volume, or BSR
- Guess PPC costs or conversion rates
- Claim high demand without qualification
- Use definitive financial guarantees
- Encourage risky launches without clear justification
- Reference proprietary or private Amazon data
- Hallucinate supplier costs or margins

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
  "assumptions_and_limits": string[]
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

CAUTION:
- Viability depends on specific conditions
- Risks are meaningful but not fatal
- Proceed only if recommendations are followed

NO_GO:
- Competitive, structural, or execution risks outweigh upside
- Particularly unsuitable for the seller's stage
- Recommend abandoning or postponing

Confidence score (0–100) reflects decision confidence, not success probability.

SELLER CONTEXT INTERPRETATION

New seller:
- Penalize high competition
- Penalize heavy PPC reliance
- Penalize weak differentiation
- Favor simplicity and speed to validation

Existing seller:
- Allow for higher competition if strategic advantages exist
- Consider portfolio synergies
- Weigh opportunity cost

Thinking:
- Focus on educational clarity
- Highlight why something would or would not work
- Emphasize learning, not execution

FINAL CHECK BEFORE RESPONDING

Before returning your answer, verify:
- Verdict matches reasoning
- Risks are internally consistent
- Recommendations are actionable
- Assumptions are explicitly stated
- Output is conservative, professional, and honest

Output should read like advice from a senior Amazon operator.`;

// Decision contract keys that must be present in the OpenAI response
const REQUIRED_DECISION_KEYS = [
  "decision",
  "executive_summary",
  "reasoning",
  "risks",
  "recommended_actions",
  "assumptions_and_limits",
];

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
        { ok: false, error: "Unauthorized" },
        { status: 401, headers: res.headers }
      );
    }

    // 2. Load seller profile (required for AI context)
    const { data: sellerProfile, error: profileError } = await supabase
      .from("seller_profiles")
      .select("stage, experience_months, monthly_revenue_range")
      .eq("id", user.id)
      .single();

    if (profileError || !sellerProfile) {
      return NextResponse.json(
        { ok: false, error: "Seller profile not found. Onboarding incomplete." },
        { status: 400, headers: res.headers }
      );
    }

    // 3. Parse and validate request body
    let body: any;
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
          error:
            "Invalid request body. Expected { input_type: 'asin' | 'idea', input_value: string }",
        },
        { status: 400, headers: res.headers }
      );
    }

    // 4. Structure seller context
    const sellerContext = {
      stage: sellerProfile.stage,
      experience_months: sellerProfile.experience_months,
      monthly_revenue_range: sellerProfile.monthly_revenue_range,
    };

    // 5. Call OpenAI
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { ok: false, error: "OpenAI API key not configured" },
        { status: 500, headers: res.headers }
      );
    }

    // 6. Build user message with seller context (raw values, no interpretation)
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
            { role: "system", content: SYSTEM_PROMPT },
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
          ok: false,
          error: `OpenAI API error: ${openaiResponse.statusText}`,
          details: errorData,
        },
        { status: 500, headers: res.headers }
      );
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { ok: false, error: "No content in OpenAI response" },
        { status: 500, headers: res.headers }
      );
    }

    // 7. Parse and validate OpenAI JSON output
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
          ok: false,
          error: "OpenAI returned invalid JSON",
          details: content.substring(0, 200),
        },
        { status: 500, headers: res.headers }
      );
    }

    // 8. Validate decision contract structure
    if (!validateDecisionContract(decisionJson)) {
      return NextResponse.json(
        {
          ok: false,
          error: "OpenAI output does not match decision contract. Missing required keys or invalid structure.",
          received_keys: Object.keys(decisionJson),
          required_keys: REQUIRED_DECISION_KEYS,
        },
        { status: 500, headers: res.headers }
      );
    }

    // 9. Extract verdict and confidence for analytics
    const verdict = decisionJson.decision.verdict;
    const confidence = decisionJson.decision.confidence;

    // 10. Save to analysis_runs with verdict, confidence, and seller context snapshot
    const { error: saveError } = await supabase
      .from("analysis_runs")
      .insert({
        user_id: user.id,
        input_type: body.input_type,
        input_value: body.input_value,
        ai_verdict: verdict,
        ai_confidence: confidence,
        seller_stage: sellerContext.stage,
        seller_experience_months: sellerContext.experience_months,
        seller_monthly_revenue_range: sellerContext.monthly_revenue_range,
        response: decisionJson,
      });

    if (saveError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to save analysis run",
          details: saveError.message,
        },
        { status: 500, headers: res.headers }
      );
    }

    // 10. Return success response with cookies preserved
    return NextResponse.json(
      {
        ok: true,
        data: decisionJson,
      },
      { status: 200, headers: res.headers }
    );
  } catch (error) {
    console.error("Analyze endpoint error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: res.headers }
    );
  }
}

