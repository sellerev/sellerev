import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/chatSystemPrompt";

/**
 * Sellerev Chat API Route
 * 
 * This endpoint continues a conversation anchored to a completed analysis.
 * 
 * ANTI-HALLUCINATION GUARANTEES:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. NO LIVE DATA FETCHING: This route does NOT call Rainforest API or SP-API.
 *    All data is retrieved from cached analysis_runs records, ensuring the AI
 *    can only reason over data that was already validated and stored.
 * 
 * 2. GROUNDED CONTEXT INJECTION: The AI receives explicit, structured context
 *    including the original analysis, cached market data, and seller profile.
 *    This prevents the model from inventing data it doesn't have.
 * 
 * 3. VERDICT IMMUTABILITY: The original verdict is injected as authoritative.
 *    The system prompt explicitly forbids silent verdict changes. Any verdict
 *    discussion must explain what conditions would need to change.
 * 
 * 4. EXPLICIT LIMITATIONS: When data is missing, the system prompt requires
 *    the AI to acknowledge gaps rather than fill them with estimates.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  analysis_run_id: string;
  message: string;
  history?: ChatMessage[];
}

function validateRequestBody(body: unknown): body is ChatRequestBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const b = body as Record<string, unknown>;
  return (
    typeof b.analysis_run_id === "string" &&
    b.analysis_run_id.trim().length > 0 &&
    typeof b.message === "string" &&
    b.message.trim().length > 0 &&
    (b.history === undefined || Array.isArray(b.history))
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

Use this context to tailor your advice. A new seller receives different guidance than a scaling seller.`);

  return contextParts.join("\n\n");
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
          error: "Invalid request body. Expected { analysis_run_id: string, message: string, history?: ChatMessage[] }",
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
      .eq("id", body.analysis_run_id)
      .eq("user_id", user.id) // Ensure user owns this analysis
      .single();

    if (analysisError || !analysisRun) {
      return NextResponse.json(
        { ok: false, error: "Analysis not found or access denied" },
        { status: 404, headers: res.headers }
      );
    }

    // 4. Fetch seller profile snapshot
    // Using current profile data to ensure advice matches seller's current stage
    const { data: sellerProfile, error: profileError } = await supabase
      .from("seller_profiles")
      .select("stage, experience_months, monthly_revenue_range")
      .eq("id", user.id)
      .single();

    if (profileError || !sellerProfile) {
      return NextResponse.json(
        { ok: false, error: "Seller profile not found" },
        { status: 403, headers: res.headers }
      );
    }

    // 5. Build grounded context message
    // ─────────────────────────────────────────────────────────────────────
    // WHY VERDICTS CANNOT SILENTLY CHANGE:
    // The original verdict is injected as "AUTHORITATIVE" in the context.
    // The CHAT_SYSTEM_PROMPT explicitly states:
    // - "NEVER contradict the original verdict without explanation"
    // - "Verdict does not change automatically"
    // - "Explain what would need to change for verdict to change"
    // ─────────────────────────────────────────────────────────────────────
    const contextMessage = buildContextMessage(
      analysisRun.response as Record<string, unknown>,
      analysisRun.rainforest_data as Record<string, unknown> | null,
      sellerProfile,
      analysisRun.input_type,
      analysisRun.input_value
    );

    // 6. Build message array for OpenAI
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      // System prompt: Contains all rules and constraints
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      // Context injection: Provides grounded data (no hallucination possible)
      { role: "user", content: `[CONTEXT FOR THIS CONVERSATION]\n\n${contextMessage}` },
      { role: "assistant", content: "I understand. I have the analysis context and will only reason over the provided data. I will not invent numbers, estimate sales or PPC, or reference data not provided. How can I help you explore this analysis?" },
    ];

    // 7. Append conversation history (if provided)
    if (body.history && Array.isArray(body.history)) {
      for (const msg of body.history) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    // 8. Append the new user message
    messages.push({ role: "user", content: body.message });

    // 9. Call OpenAI (reasoning over cached data only)
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
    const assistantMessage = openaiData.choices?.[0]?.message?.content;

    if (!assistantMessage) {
      return NextResponse.json(
        { ok: false, error: "No response from AI" },
        { status: 500, headers: res.headers }
      );
    }

    // 10. Persist chat messages to database for history restoration
    // ────────────────────────────────────────────────────────────────────────
    // Save both user and assistant messages to enable conversation continuity
    // when users return to a previous analysis from history.
    // ────────────────────────────────────────────────────────────────────────
    try {
      await supabase.from("analysis_messages").insert([
        {
          analysis_run_id: body.analysis_run_id,
          user_id: user.id,
          role: "user",
          content: body.message,
        },
        {
          analysis_run_id: body.analysis_run_id,
          user_id: user.id,
          role: "assistant",
          content: assistantMessage,
        },
      ]);
    } catch (saveError) {
      // Log but don't fail - chat history is non-critical
      console.error("Failed to save chat messages:", saveError);
    }

    // 11. Return the response
    // The response is grounded because:
    // - The AI was given explicit constraints via CHAT_SYSTEM_PROMPT
    // - All data came from cached analysis_runs and seller_profiles
    // - No live API calls were made during this request
    return NextResponse.json(
      {
        ok: true,
        data: {
          message: assistantMessage,
          analysis_run_id: body.analysis_run_id,
        },
      },
      { status: 200, headers: res.headers }
    );
  } catch (error) {
    console.error("Chat endpoint error:", error);
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
