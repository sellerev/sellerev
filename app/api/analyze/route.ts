import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";

// Sellerev production SYSTEM PROMPT
// TODO: Replace with actual production system prompt
const SYSTEM_PROMPT = `You are an expert Amazon seller advisor. Analyze the provided input (either an ASIN or a product idea) and return a structured JSON decision with the following keys:
- viability_score: number (0-100)
- market_analysis: object with keys: competition_level, market_size, trends
- recommendations: array of strings
- risk_factors: array of strings
- next_steps: array of strings

Return ONLY valid JSON, no markdown, no code blocks, no explanations.`;

// Decision contract keys that must be present in the OpenAI response
const REQUIRED_DECISION_KEYS = [
  "viability_score",
  "market_analysis",
  "recommendations",
  "risk_factors",
  "next_steps",
];

interface AnalyzeRequestBody {
  input_type: "asin" | "idea";
  input_value: string;
}

interface DecisionContract {
  viability_score: number;
  market_analysis: {
    competition_level: string;
    market_size: string;
    trends: string;
  };
  recommendations: string[];
  risk_factors: string[];
  next_steps: string[];
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

  // Validate structure
  if (
    typeof data.viability_score !== "number" ||
    data.viability_score < 0 ||
    data.viability_score > 100
  ) {
    return false;
  }

  if (
    typeof data.market_analysis !== "object" ||
    data.market_analysis === null ||
    typeof data.market_analysis.competition_level !== "string" ||
    typeof data.market_analysis.market_size !== "string" ||
    typeof data.market_analysis.trends !== "string"
  ) {
    return false;
  }

  if (
    !Array.isArray(data.recommendations) ||
    !data.recommendations.every((item: any) => typeof item === "string")
  ) {
    return false;
  }

  if (
    !Array.isArray(data.risk_factors) ||
    !data.risk_factors.every((item: any) => typeof item === "string")
  ) {
    return false;
  }

  if (
    !Array.isArray(data.next_steps) ||
    !data.next_steps.every((item: any) => typeof item === "string")
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

    // 2. Load seller profile
    const { data: profile, error: profileError } = await supabase
      .from("seller_profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { ok: false, error: "Seller profile not found" },
        { status: 404, headers: res.headers }
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

    // 4. Call OpenAI
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { ok: false, error: "OpenAI API key not configured" },
        { status: 500, headers: res.headers }
      );
    }

    const userMessage =
      body.input_type === "asin"
        ? `Analyze this ASIN: ${body.input_value}`
        : `Analyze this product idea: ${body.input_value}`;

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

    // 5. Parse and validate JSON output
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

    // 6. Validate decision contract
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

    // 7. Save to analysis_runs
    const { error: saveError } = await supabase
      .from("analysis_runs")
      .insert({
        user_id: user.id,
        input_type: body.input_type,
        input_value: body.input_value,
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

    // 8. Return success response with cookies preserved
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
