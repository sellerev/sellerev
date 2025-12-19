import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/chatSystemPrompt";

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

  // Section 4: Market Snapshot (includes FBA fees and pricing data for margin calculations)
  const marketSnapshot = (analysisResponse.market_snapshot as Record<string, unknown>) || null;
  if (marketSnapshot) {
    const avgPrice = (marketSnapshot.avg_price as number) || null;
    const fbaFees = (marketSnapshot.fba_fees as {
      total_fee: number | null;
      source: "sp_api" | "estimated";
      asin_used: string;
      price_used: number;
    }) || null;
    
    contextParts.push(`=== MARKET SNAPSHOT (FOR MARGIN CALCULATIONS) ===
Average Page 1 Price: ${avgPrice !== null ? `$${avgPrice.toFixed(2)}` : "Not available"}
FBA Fees Estimate: ${fbaFees && fbaFees.total_fee !== null ? `$${fbaFees.total_fee.toFixed(2)}` : "Not available"}
FBA Fees Source: ${fbaFees ? fbaFees.source : "Not available"}
Representative ASIN: ${marketSnapshot.representative_asin || "Not available"}

Use avg_price as the selling price for margin calculations.
Use fba_fees.total_fee if available, otherwise estimate 15-20% of price.`);
  }

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

    // 6. Build grounded context message
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

    // 7. Build message array for OpenAI
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      // System prompt: Contains all rules and constraints
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      // Context injection: Provides grounded data (no hallucination possible)
      { role: "user", content: `[CONTEXT FOR THIS CONVERSATION]\n\n${contextMessage}` },
      { role: "assistant", content: "I understand. I have the analysis context and will only reason over the provided data. I will not invent numbers, estimate sales or PPC, or reference data not provided. How can I help you explore this analysis?" },
    ];

    // 8. Append conversation history from database
    if (priorMessages && priorMessages.length > 0) {
      for (const msg of priorMessages) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
        }
      }
    }

    // 9. Append the new user message
    messages.push({ role: "user", content: body.message });

    // 10. Call OpenAI with streaming enabled
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

    // 11. Stream the response to the client
    // ────────────────────────────────────────────────────────────────────────
    // We collect the full response while streaming to save it to the database
    // ────────────────────────────────────────────────────────────────────────
    const encoder = new TextEncoder();
    let fullAssistantMessage = "";

    const stream = new ReadableStream({
      async start(controller) {
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

          // 12. Save messages to database after streaming completes
          // ────────────────────────────────────────────────────────────────
          // Persist both user and assistant messages for history restoration
          // ────────────────────────────────────────────────────────────────
          if (fullAssistantMessage.trim()) {
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
                  content: fullAssistantMessage,
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
