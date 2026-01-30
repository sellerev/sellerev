/**
 * Per-user API usage event logging (Rainforest, SP-API, cache hits).
 * Inserts into api_usage_events; daily rollup is done by DB trigger.
 * Uses idempotency_key to avoid double-counting on retries.
 */

import { createClient } from "@supabase/supabase-js";

/** Pass from API route so cache/API layers can log usage without double-counting. */
export interface UsageContext {
  userId: string;
  messageId: string;
  analysisRunId?: string | null;
}

export type UsageEventInput = {
  userId: string;
  provider: "rainforest" | "spapi" | "cache" | "openai";
  operation: string;
  endpoint?: string | null;
  cache_status: "hit" | "miss" | "none";
  credits_used?: number;
  http_status?: number | null;
  duration_ms?: number | null;
  asin?: string | null;
  keyword?: string | null;
  marketplace_id?: string | null;
  amazon_domain?: string | null;
  meta?: Record<string, unknown>;
  idempotency_key: string;
};

/**
 * Build idempotency key for usage events.
 * Format: {analysisRunId}:{messageId}:{provider}:{operation}:{asin||'-'}:{endpoint||'-'}:{cache_status}
 */
export function buildUsageIdempotencyKey(params: {
  analysisRunId?: string | null;
  messageId: string;
  provider: string;
  operation: string;
  asin?: string | null;
  endpoint?: string | null;
  cache_status: string;
}): string {
  const a = params.analysisRunId ?? "-";
  const m = params.messageId;
  const p = params.provider;
  const o = params.operation;
  const asin = params.asin ?? "-";
  const ep = params.endpoint ?? "-";
  const c = params.cache_status;
  return `${a}:${m}:${p}:${o}:${asin}:${ep}:${c}`;
}

let supabaseService: ReturnType<typeof createClient> | null = null;

function getSupabaseService(): ReturnType<typeof createClient> | null {
  if (supabaseService) return supabaseService;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabaseService = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabaseService;
}

/**
 * Log one usage event. Uses insert with ON CONFLICT (idempotency_key) DO NOTHING
 * so retries do not double-count.
 */
export async function logUsageEvent(input: UsageEventInput): Promise<void> {
  const client = getSupabaseService();
  if (!client) return;

  const {
    userId,
    provider,
    operation,
    cache_status,
    idempotency_key,
    endpoint,
    credits_used = 0,
    http_status,
    duration_ms,
    asin,
    keyword,
    marketplace_id,
    amazon_domain,
    meta = {},
  } = input;

  try {
    const table = (client as any).from("api_usage_events");
    const { error } = await table.upsert(
      {
        user_id: userId,
        provider,
        operation,
        endpoint: endpoint ?? null,
        cache_status,
        credits_used,
        http_status: http_status ?? null,
        duration_ms: duration_ms ?? null,
        asin: asin ?? null,
        keyword: keyword ?? null,
        marketplace_id: marketplace_id ?? null,
        amazon_domain: amazon_domain ?? null,
        meta: meta && typeof meta === "object" ? meta : {},
        idempotency_key,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    );

    if (error) {
      if (error.code === "23505") {
        // unique_violation = idempotent duplicate, ignore
        return;
      }
      console.error("USAGE_LOG_INSERT_ERROR", {
        idempotency_key: idempotency_key.substring(0, 80),
        provider,
        operation,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("USAGE_LOG_EXCEPTION", {
      idempotency_key: idempotency_key.substring(0, 80),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
