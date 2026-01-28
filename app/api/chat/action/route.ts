import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase/server-api";
import { buildCopilotSystemPrompt } from "@/lib/ai/copilotSystemPrompt";
import {
  SellerMemory,
  createDefaultSellerMemory,
  mapSellerProfileToMemory,
} from "@/lib/ai/sellerMemory";

interface ChatActionRequestBody {
  analysisRunId: string;
  action_type: "rainforest_reviews";
  asins: string[];
  user_choice: "yes" | "no";
  limit?: number;
}

function validateActionRequest(body: unknown): body is ChatActionRequestBody {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const b = body as Record<string, unknown>;
  return (
    typeof b.analysisRunId === "string" &&
    b.analysisRunId.trim().length > 0 &&
    b.action_type === "rainforest_reviews" &&
    Array.isArray(b.asins) &&
    b.asins.every((a: unknown) => typeof a === "string") &&
    (b.user_choice === "yes" || b.user_choice === "no") &&
    (b.limit === undefined || (typeof b.limit === "number" && b.limit > 0 && b.limit <= 50))
  );
}

// Import pending action functions from shared module
import { getPendingAction, clearPendingAction } from "@/lib/chat/pendingActions";

export async function POST(req: NextRequest) {
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

    if (!validateActionRequest(body)) {
      return NextResponse.json(
        { ok: false, error: "Invalid action request body" },
        { status: 400, headers: res.headers }
      );
    }

    // 3. Validate analysis run exists and belongs to user
    const { data: analysisRun, error: analysisError } = await supabase
      .from("analysis_runs")
      .select("id, user_id, response")
      .eq("id", body.analysisRunId)
      .eq("user_id", user.id)
      .single();

    if (analysisError || !analysisRun) {
      return NextResponse.json(
        { ok: false, error: "Analysis run not found" },
        { status: 404, headers: res.headers }
      );
    }

    // 4. Check pending action exists and matches
    const pendingAction = getPendingAction(body.analysisRunId);
    if (!pendingAction) {
      return NextResponse.json(
        { ok: false, error: "No pending action found or action expired" },
        { status: 404, headers: res.headers }
      );
    }

    if (pendingAction.type !== body.action_type) {
      return NextResponse.json(
        { ok: false, error: "Action type mismatch" },
        { status: 400, headers: res.headers }
      );
    }

    console.log("ACTION_BUTTON_CLICKED", {
      analysis_run_id: body.analysisRunId,
      user_id: user.id,
      action_type: body.action_type,
      user_choice: body.user_choice,
      asins: body.asins,
      limit: body.limit,
    });

    // 5. Handle user choice
    if (body.user_choice === "no") {
      // Clear pending action and return a short response
      clearPendingAction(body.analysisRunId);
      
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ content: "No problem. Want me to analyze something else about these products?" })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...Object.fromEntries(res.headers.entries()),
        },
      });
    }

    // 6. Execute action (user_choice === "yes")
    const actionAsins = body.asins.slice(0, 2); // Max 2 ASINs
    const reviewsLimit = body.limit || pendingAction.limit || 20;

    if (actionAsins.length === 0) {
      clearPendingAction(body.analysisRunId);
      return NextResponse.json(
        { ok: false, error: "No ASINs provided for action" },
        { status: 400, headers: res.headers }
      );
    }

    if (actionAsins.length > 2) {
      clearPendingAction(body.analysisRunId);
      return NextResponse.json(
        { ok: false, error: "Maximum 2 ASINs allowed for review enrichment" },
        { status: 400, headers: res.headers }
      );
    }

    // 7. Fetch reviews enrichment
    const { getRainforestReviewsEnrichment } = await import("@/lib/rainforest/reviewsEnrichment");
    const amazonDomain = "amazon.com";
    
    // Cache for reviews (7 days TTL)
    const ENRICHMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const reviewsCache = new Map<string, { expiresAt: number; data: any }>();
    
    function getCachedReviews(asin: string, amazonDomain: string): any | null {
      const cacheKey = `${asin}:${amazonDomain}:reviews`;
      const entry = reviewsCache.get(cacheKey);
      if (!entry || Date.now() > entry.expiresAt) {
        return null;
      }
      return entry.data;
    }
    
    function setCachedReviews(asin: string, amazonDomain: string, data: any) {
      const cacheKey = `${asin}:${amazonDomain}:reviews`;
      reviewsCache.set(cacheKey, { expiresAt: Date.now() + ENRICHMENT_CACHE_TTL_MS, data });
    }

    const reviewsEnrichment: {
      executed: boolean;
      asins: string[];
      by_asin: Record<string, {
        asin: string;
        title: string | null;
        extracted: {
          top_complaints: Array<{ theme: string; snippet?: string }>;
          top_praise: Array<{ theme: string; snippet?: string }>;
        };
        errors: string[];
      }>;
      errors: Array<{ asin: string; error: string }>;
    } = {
      executed: true,
      asins: actionAsins,
      by_asin: {},
      errors: [],
    };

    for (const asin of actionAsins) {
      const errors: string[] = [];
      let reviewsData: any | null = null;
      let cacheHit = false;

      // Check cache first
      const cached = getCachedReviews(asin, amazonDomain);
      if (cached) {
        reviewsData = cached;
        cacheHit = true;
        console.log("RAINFOREST_REVIEWS_REQUEST", {
          asin,
          cache_hit: true,
          endpoint: "reviews",
        });
      } else {
        try {
          reviewsData = await getRainforestReviewsEnrichment(asin, amazonDomain, reviewsLimit);
          if (reviewsData) {
            setCachedReviews(asin, amazonDomain, reviewsData);
            console.log("RAINFOREST_REVIEWS_REQUEST", {
              asin,
              cache_hit: false,
              endpoint: "reviews",
              limit: reviewsLimit,
            });
          } else {
            errors.push("Rainforest reviews enrichment failed");
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Rainforest reviews enrichment error: ${errorMessage}`);
          reviewsEnrichment.errors.push({ asin, error: errorMessage });
        }
      }

      // Parse reviews data
      if (reviewsData) {
        reviewsEnrichment.by_asin[asin] = {
          asin: reviewsData.asin || asin,
          title: reviewsData.title || null,
          extracted: reviewsData.extracted || {
            top_complaints: [],
            top_praise: [],
          },
          errors: reviewsData.errors || [],
        };
      } else {
        reviewsEnrichment.by_asin[asin] = {
          asin,
          title: null,
          extracted: {
            top_complaints: [],
            top_praise: [],
          },
          errors,
        };
      }
    }

    console.log("PENDING_ACTION_EXECUTED", {
      analysis_run_id: body.analysisRunId,
      action_type: body.action_type,
      asins: actionAsins,
      success_count: Object.values(reviewsEnrichment.by_asin).filter(v => v.errors.length === 0).length,
      error_count: reviewsEnrichment.errors.length,
    });

    // 8. Clear pending action
    clearPendingAction(body.analysisRunId);

    // 9. Get analysis response for context
    const analysisResponse = analysisRun.response as Record<string, unknown>;
    const aiContext = (analysisResponse.ai_context as Record<string, unknown>) || {};

    // 10. Build AI context with reviews enrichment
    const aiContextWithReviews = {
      ...aiContext,
      rainforest_reviews_enrichment: reviewsEnrichment,
    };

    // 11. Build system prompt and get AI response
    // Create seller memory from analysis response data
    const sellerProfileData = {
      stage: (analysisResponse.seller_stage as string) || "pre-revenue",
      experience_months: (analysisResponse.seller_experience_months as number) || null,
      monthly_revenue_range: (analysisResponse.seller_monthly_revenue_range as string) || null,
      sourcing_model: "unknown",
      goals: null,
      risk_tolerance: null,
      margin_target: null,
      max_fee_pct: null,
      updated_at: null,
    };

    // Create proper SellerMemory object
    let sellerMemory: SellerMemory = createDefaultSellerMemory();
    try {
      const profileData = mapSellerProfileToMemory(sellerProfileData);
      sellerMemory.seller_profile = {
        ...sellerMemory.seller_profile,
        ...profileData,
      };
    } catch (e) {
      console.error("Failed to map seller profile into sellerMemory (non-blocking):", e);
    }

    const decision = analysisResponse.decision
      ? {
          verdict: (analysisResponse.decision as { verdict: string }).verdict as "GO" | "CAUTION" | "NO_GO",
          confidence: (analysisResponse.decision as { confidence: number }).confidence,
          executive_summary: (analysisResponse.executive_summary as string) || undefined,
        }
      : undefined;

    const copilotContext = {
      ai_context: aiContextWithReviews,
      seller_memory: sellerMemory,
      structured_memories: [],
      seller_profile_version: sellerProfileData.updated_at || null,
      decision,
      session_context: {
        current_feature: "analyze" as const,
        user_question: `Summarize review themes for ${actionAsins.join(", ")}`,
        response_mode: "concise" as const,
      },
    };

    const systemPrompt = buildCopilotSystemPrompt(copilotContext, "keyword");

    // 12. Call OpenAI to generate summary (using fetch like the main chat route)
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { ok: false, error: "OpenAI API key not configured" },
        { status: 500, headers: res.headers }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
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
                  {
                    role: "user",
                    content: `I just fetched review snippets for ${actionAsins.length === 1 ? "this product" : "these products"}. Summarize the top complaints and praise themes. Use the data from rainforest_reviews_enrichment.`,
                  },
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 800,
              }),
            }
          );

          if (!openaiResponse.ok) {
            const errorData = await openaiResponse.text();
            throw new Error(`OpenAI API error: ${openaiResponse.statusText} - ${errorData}`);
          }

          const reader = openaiResponse.body?.getReader();
          if (!reader) {
            throw new Error("No response body from OpenAI");
          }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.trim() === "") continue;
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") continue;
                try {
                  const json = JSON.parse(data);
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          console.log("RAINFOREST_REVIEWS_ENRICHMENT_IN_CONTEXT", {
            analysis_run_id: body.analysisRunId,
            asins: actionAsins,
            has_enrichment: true,
            success_count: Object.values(reviewsEnrichment.by_asin).filter(v => v.errors.length === 0).length,
          });
        } catch (error) {
          console.error("ACTION_EXECUTION_ERROR", {
            analysis_run_id: body.analysisRunId,
            error: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ content: "I couldn't retrieve review snippets for this listing right now, so I can't summarize complaints/praise." })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...Object.fromEntries(res.headers.entries()),
      },
    });
  } catch (error) {
    console.error("CHAT_ACTION_ERROR", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500, headers: res.headers }
    );
  }
}
