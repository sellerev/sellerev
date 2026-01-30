/**
 * Product dossiers table: 7-day TTL cache for Rainforest type=product response.
 * Used by getOrFetchDossier for review insights pipeline.
 */

import { createClient } from "@supabase/supabase-js";
import {
  type UsageContext,
  buildUsageIdempotencyKey,
  logUsageEvent,
} from "@/lib/usage/logUsageEvent";

const TTL_DAYS = 7;

let supabase: ReturnType<typeof createClient<any, "public", any>> | null = null;

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

export async function getCachedDossier(
  asin: string,
  amazonDomain: string,
  usageContext?: UsageContext | null
): Promise<unknown | null> {
  const client = getClient();
  if (!client) return null;
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("product_dossiers")
    .select("payload")
    .eq("asin", asin)
    .eq("amazon_domain", amazonDomain)
    .gt("expires_at", now)
    .maybeSingle();
  if (error) {
    console.error("PRODUCT_DOSSIERS_GET_ERROR", { asin, amazon_domain: amazonDomain, error });
    return null;
  }
  if (data?.payload != null && usageContext?.userId && usageContext?.messageId) {
    const idempotencyKey = buildUsageIdempotencyKey({
      analysisRunId: usageContext.analysisRunId ?? null,
      messageId: usageContext.messageId,
      provider: "cache",
      operation: "cache.product_dossiers",
      asin,
      endpoint: "product_dossiers",
      cache_status: "hit",
    });
    await logUsageEvent({
      userId: usageContext.userId,
      provider: "cache",
      operation: "cache.product_dossiers",
      endpoint: "product_dossiers",
      cache_status: "hit",
      credits_used: 0,
      asin,
      amazon_domain: amazonDomain,
      meta: { table: "product_dossiers" },
      idempotency_key: idempotencyKey,
    });
  }
  return data?.payload ?? null;
}

export async function setCachedDossier(
  asin: string,
  amazonDomain: string,
  payload: unknown
): Promise<void> {
  const client = getClient();
  if (!client) return;
  const now = new Date();
  const expires = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await client
    .from("product_dossiers")
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
  if (error) {
    console.error("PRODUCT_DOSSIERS_SET_ERROR", { asin, amazon_domain: amazonDomain, error });
  }
}
