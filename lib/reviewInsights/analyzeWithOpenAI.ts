/**
 * Optional OpenAI summarization of review insights (cheap + cached 30d).
 * Input: negative_snippets, positive_snippets, rating_breakdown.
 * Output: star_split, top_complaints, top_praise, summary, source, analyzed_reviews_count.
 * Cost impact: Low/Medium/High only (no exact COGS).
 */

import { createClient } from "@supabase/supabase-js";
import { validateInsightsPayload, type ValidatedInsightsPayload } from "./validateInsights";

const TTL_DAYS = 30;
let supabase: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (supabase) return supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabase;
}

export interface ReviewInsightsAnalyzeInput {
  negative_snippets: string[];
  positive_snippets: string[];
  rating_breakdown?: Record<string, { percentage?: number; count?: number }> | null;
  source: "type_product" | "type_reviews_fallback" | "mixed";
}

export async function getCachedAnalyzedInsights(
  asin: string,
  amazonDomain: string = "amazon.com"
): Promise<ValidatedInsightsPayload | null> {
  const client = getClient();
  if (!client) return null;
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("review_insights_analyzed")
    .select("payload")
    .eq("asin", asin)
    .eq("amazon_domain", amazonDomain)
    .gt("expires_at", now)
    .maybeSingle();
  if (error || !data?.payload) return null;
  return validateInsightsPayload(data.payload);
}

export async function setCachedAnalyzedInsights(
  asin: string,
  amazonDomain: string,
  payload: ValidatedInsightsPayload
): Promise<void> {
  const client = getClient();
  if (!client) return;
  const now = new Date();
  const expires = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await client
    .from("review_insights_analyzed")
    .upsert(
      {
        asin,
        amazon_domain: amazonDomain,
        payload,
        fetched_at: now.toISOString(),
        expires_at: expires.toISOString(),
      },
      { onConflict: "asin,amazon_domain" }
    );
}

const SYSTEM_PROMPT = `You summarize Amazon product review snippets into structured insights.
Output JSON only. No markdown. Use these exact keys:
- star_split: object with keys like "1_star","2_star",... and number values (percent 0-100), or null
- top_complaints: array of { theme: string, frequency_pct?: number, examples: string[], opportunity: string, cost_impact: "low"|"medium"|"high", impact: "high"|"medium"|"low" }
- top_praise: array of same shape
- summary: string (2-3 sentences)
- source: "type_product"|"type_reviews_fallback"|"mixed"
- analyzed_reviews_count: number

Cost impact must be only "low", "medium", or "high". Do NOT output exact dollar amounts or COGS.`;

export async function analyzeReviewInsightsWithOpenAI(
  input: ReviewInsightsAnalyzeInput,
  asin: string,
  amazonDomain: string = "amazon.com"
): Promise<ValidatedInsightsPayload> {
  const cached = await getCachedAnalyzedInsights(asin, amazonDomain);
  if (cached) return cached;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return {
      star_split: null,
      top_complaints: [],
      top_praise: [],
      summary: "",
      source: input.source,
      analyzed_reviews_count: input.negative_snippets.length + input.positive_snippets.length,
    };
  }

  const neg = (input.negative_snippets || []).slice(0, 10);
  const pos = (input.positive_snippets || []).slice(0, 6);
  const rb = input.rating_breakdown && typeof input.rating_breakdown === "object"
    ? Object.fromEntries(
        Object.entries(input.rating_breakdown).map(([k, v]) => [
          k,
          typeof v === "object" && v && "percentage" in v ? (v as { percentage?: number }).percentage : v,
        ])
      )
    : null;

  const userContent = JSON.stringify({
    negative_snippets: neg,
    positive_snippets: pos,
    rating_breakdown: rb,
    source: input.source,
  });

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1024,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn("REVIEW_INSIGHTS_OPENAI_ERROR", { asin, status: res.status, error: err.slice(0, 200) });
      return {
        star_split: null,
        top_complaints: [],
        top_praise: [],
        summary: "",
        source: input.source,
        analyzed_reviews_count: neg.length + pos.length,
      };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return {
        star_split: null,
        top_complaints: [],
        top_praise: [],
        summary: "",
        source: input.source,
        analyzed_reviews_count: neg.length + pos.length,
      };
    }
    const parsed = JSON.parse(content) as unknown;
    const validated = validateInsightsPayload({
      ...parsed,
      source: input.source,
      analyzed_reviews_count: neg.length + pos.length,
    });
    await setCachedAnalyzedInsights(asin, amazonDomain, validated);
    return validated;
  } catch (e) {
    console.warn("REVIEW_INSIGHTS_OPENAI_EXCEPTION", { asin, error: String(e) });
    return {
      star_split: null,
      top_complaints: [],
      top_praise: [],
      summary: "",
      source: input.source,
      analyzed_reviews_count: input.negative_snippets.length + input.positive_snippets.length,
    };
  }
}
