/**
 * Async AI Processing for Keyword Analysis
 * 
 * Processes AI Pass 1 & Pass 2 in background after listings are returned to frontend.
 * Updates analysis_run record when complete.
 */

import { normalizeRisks } from "./normalizeRisks";

const DECISION_BRAIN_PROMPT = `You are Sellerev, a seller decision engine for Amazon FBA.

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
   - Speak as if you're making the decision yourself.`;

const STRUCTURING_BRAIN_PROMPT = `You are a JSON structuring assistant for Sellerev.

Your role: Convert the Decision Brain's plain text verdict and reasoning into the required JSON decision contract format.

You MUST output valid JSON that conforms exactly to this structure:

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
}`;

const REQUIRED_DECISION_KEYS = [
  "decision",
  "executive_summary",
  "reasoning",
  "risks",
  "recommended_actions",
  "assumptions_and_limits",
  "numbers_used",
];

function validateDecisionContract(decisionJson: any): boolean {
  for (const key of REQUIRED_DECISION_KEYS) {
    if (!(key in decisionJson)) {
      return false;
    }
  }
  return true;
}

interface AsyncAiProcessingContext {
  analysisRunId: string;
  keyword: string;
  sellerProfile: {
    stage: string;
    experience_months: number | null;
    monthly_revenue_range: string | null;
  };
  marketSnapshot: any;
  contractResponse: any;
  supabase: any;
}

/**
 * Process AI Pass 1 & Pass 2 asynchronously and update analysis_run
 */
export async function processAiAsync(context: AsyncAiProcessingContext): Promise<void> {
  const { analysisRunId, keyword, sellerProfile, marketSnapshot, contractResponse, supabase } = context;

  try {
    console.log("ASYNC_AI_PROCESSING_START", {
      analysis_run_id: analysisRunId,
      keyword,
      timestamp: new Date().toISOString(),
    });

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

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
- Stage: ${sellerProfile.stage}
- Experience (months): ${sellerProfile.experience_months ?? "null"}
- Monthly revenue range: ${sellerProfile.monthly_revenue_range ?? "null"}

ANALYSIS REQUEST:
${keyword}`;

    console.log("ASYNC_PASS1_DECISION_BRAIN_CALL", { analysis_run_id: analysisRunId });

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
          temperature: 0.7,
        }),
      }
    );

    if (!pass1Response.ok) {
      const errorData = await pass1Response.text();
      throw new Error(`OpenAI API error (PASS 1): ${pass1Response.statusText} - ${errorData}`);
    }

    const pass1Data = await pass1Response.json();
    const decisionBrainOutput = pass1Data.choices?.[0]?.message?.content;

    if (!decisionBrainOutput) {
      throw new Error("No content in PASS 1 OpenAI response");
    }

    console.log("ASYNC_PASS1_COMPLETE", { analysis_run_id: analysisRunId });

    // PASS 2: Structuring Brain
    let structuringBrainPrompt = STRUCTURING_BRAIN_PROMPT;
    if (contractResponse && contractResponse.ai_context) {
      const aiContextSection = `

AI_CONTEXT (for numbers_used population):

${JSON.stringify(contractResponse.ai_context, null, 2)}

Extract all numeric metrics from ai_context and populate numbers_used accordingly.`;
      structuringBrainPrompt = STRUCTURING_BRAIN_PROMPT + aiContextSection;
    }

    const pass2UserMessage = `DECISION BRAIN OUTPUT:

${decisionBrainOutput}

Convert this plain text decision into the required JSON contract format. Extract verdict, reasoning, risks, recommended actions, and populate numbers_used from ai_context.`;

    console.log("ASYNC_PASS2_STRUCTURING_BRAIN_CALL", { analysis_run_id: analysisRunId });

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
          temperature: 0.3,
        }),
      }
    );

    if (!pass2Response.ok) {
      const errorData = await pass2Response.text();
      throw new Error(`OpenAI API error (PASS 2): ${pass2Response.statusText} - ${errorData}`);
    }

    const pass2Data = await pass2Response.json();
    const pass2Content = pass2Data.choices?.[0]?.message?.content;

    if (!pass2Content) {
      throw new Error("No content in PASS 2 OpenAI response");
    }

    // Parse and validate PASS 2 JSON output
    let decisionJson: any;
    try {
      const cleanedContent = pass2Content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      decisionJson = JSON.parse(cleanedContent);
    } catch (parseError) {
      throw new Error(`PASS 2 returned invalid JSON: ${pass2Content.substring(0, 200)}`);
    }

    if (!validateDecisionContract(decisionJson)) {
      throw new Error("PASS 2 output does not match decision contract");
    }

    // Normalize risks
    const normalizedRisks = normalizeRisks(decisionJson.risks);

    // Apply confidence caps
    let confidence = decisionJson.decision.confidence;
    const confidenceDowngrades: string[] = [];

    if (confidence > 75) {
      confidence = 75;
      confidenceDowngrades.push("Keyword searches capped at 75% maximum confidence");
    }

    if (marketSnapshot) {
      const totalListings = marketSnapshot.total_page1_listings || 0;
      if (totalListings < 5) {
        confidence = Math.min(confidence, 40);
        confidenceDowngrades.push("Sparse Page 1 data (< 5 listings)");
      } else if (totalListings < 10) {
        confidence = Math.min(confidence, 60);
        confidenceDowngrades.push("Limited Page 1 data (< 10 listings)");
      }
    }

    decisionJson.decision.confidence = Math.round(confidence);
    if (confidenceDowngrades.length > 0) {
      decisionJson.confidence_downgrades = confidenceDowngrades;
    }

    // Build final decision response
    // Merge with existing response data (listings, products, etc.)
    const existingResponse = await supabase
      .from("analysis_runs")
      .select("response")
      .eq("id", analysisRunId)
      .single();

    const existingData = existingResponse.data?.response || {};
    
    const finalResponse = {
      ...existingData, // Preserve listings, products, etc.
      decision: {
        ...decisionJson.decision,
        executive_summary: decisionJson.executive_summary,
        reasoning: decisionJson.reasoning,
        risks: normalizedRisks,
        recommended_actions: decisionJson.recommended_actions,
        assumptions_and_limits: decisionJson.assumptions_and_limits,
        numbers_used: decisionJson.numbers_used,
        confidence_downgrades: decisionJson.confidence_downgrades || [],
      },
    };

    // Update analysis_run with AI decision
    const { error: updateError } = await supabase
      .from("analysis_runs")
      .update({
        ai_verdict: finalResponse.decision.verdict,
        ai_confidence: finalResponse.decision.confidence,
        response: finalResponse,
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysisRunId);

    if (updateError) {
      console.error("ASYNC_AI_UPDATE_ERROR", {
        analysis_run_id: analysisRunId,
        error: updateError,
      });
      throw updateError;
    }

    console.log("ASYNC_AI_PROCESSING_COMPLETE", {
      analysis_run_id: analysisRunId,
      keyword,
      verdict: finalResponse.decision.verdict,
      confidence: finalResponse.decision.confidence,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("ASYNC_AI_PROCESSING_ERROR", {
      analysis_run_id: analysisRunId,
      keyword,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });

    // Update analysis_run with error status
    await supabase
      .from("analysis_runs")
      .update({
        response: {
          error: error instanceof Error ? error.message : String(error),
          status: "ai_processing_failed",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysisRunId)
      .catch((updateErr: any) => {
        console.error("Failed to update analysis_run with error:", updateErr);
      });
  }
}

