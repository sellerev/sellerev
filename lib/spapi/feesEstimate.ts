import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAmazonConnection } from "@/lib/amazon/getUserToken";
import { getFbaFees } from "./getFbaFees";
import {
  buildUsageIdempotencyKey,
  logUsageEvent,
} from "@/lib/usage/logUsageEvent";

export interface FeesEstimatePayload {
  asin: string;
  marketplace_id: string;
  price: number;
  currency: string;
  total_fees: number | null;
  fee_lines: Array<{ name: string; amount: number }>;
  fetched_at: string;
  cached?: boolean;
}

const TTL_DAYS = 7;
const DEFAULT_MARKETPLACE = "ATVPDKIKX0DER";
const DIMS_HASH_EMPTY = "";
const FEES_ENDPOINT = "POST /products/fees/v0/items/{asin}/feesEstimate";

export type FeesUsageContext = {
  messageId: string;
  analysisRunId?: string | null;
};

export async function getOrFetchFeesEstimate(
  supabase: SupabaseClient,
  userId: string,
  params: { asin: string; marketplaceId?: string; price: number },
  usageContext?: FeesUsageContext | null
): Promise<FeesEstimatePayload | null> {
  const asin = params.asin.trim();
  const marketplaceId = params.marketplaceId?.trim() || DEFAULT_MARKETPLACE;
  const price = params.price;

  const connected = await hasAmazonConnection(userId);
  if (!connected) return null;

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + TTL_DAYS);

  const { data: cached, error: cacheErr } = await supabase
    .from("asin_fees_cache")
    .select("fees_json, fetched_at")
    .eq("user_id", userId)
    .eq("asin", asin)
    .eq("marketplace_id", marketplaceId)
    .eq("is_amazon_fulfilled", true)
    .eq("listing_price", price)
    .eq("dims_hash", DIMS_HASH_EMPTY)
    .gt("expires_at", now.toISOString())
    .limit(1)
    .single();

  if (!cacheErr && cached?.fees_json) {
    if (usageContext?.messageId) {
      const hitKey = buildUsageIdempotencyKey({
        analysisRunId: usageContext.analysisRunId ?? null,
        messageId: usageContext.messageId,
        provider: "cache",
        operation: "cache.spapi_fee_estimates",
        asin,
        endpoint: "spapi_fee_estimates",
        cache_status: "hit",
      });
      await logUsageEvent({
        userId,
        provider: "cache",
        operation: "cache.spapi_fee_estimates",
        endpoint: FEES_ENDPOINT,
        cache_status: "hit",
        credits_used: 0,
        asin,
        marketplace_id: marketplaceId,
        meta: { table: "asin_fees_cache" },
        idempotency_key: hitKey,
      });
    }
    const j = cached.fees_json as Record<string, unknown>;
    return {
      asin: (j.asin as string) ?? asin,
      marketplace_id: (j.marketplace_id as string) ?? marketplaceId,
      price: Number(j.price ?? price),
      currency: (j.currency as string) ?? "USD",
      total_fees: j.total_fees != null ? Number(j.total_fees) : null,
      fee_lines: Array.isArray(j.fee_lines) ? (j.fee_lines as Array<{ name: string; amount: number }>) : [],
      fetched_at: (cached.fetched_at as string) ?? now.toISOString(),
      cached: true,
    };
  }

  if (usageContext?.messageId) {
    const missKey = buildUsageIdempotencyKey({
      analysisRunId: usageContext.analysisRunId ?? null,
      messageId: usageContext.messageId,
      provider: "cache",
      operation: "cache.spapi_fee_estimates",
      asin,
      endpoint: "spapi_fee_estimates",
      cache_status: "miss",
    });
    await logUsageEvent({
      userId,
      provider: "cache",
      operation: "cache.spapi_fee_estimates",
      endpoint: FEES_ENDPOINT,
      cache_status: "miss",
      credits_used: 0,
      asin,
      marketplace_id: marketplaceId,
      meta: { table: "asin_fees_cache" },
      idempotency_key: missKey,
    });
  }

  const startMs = Date.now();
  const fba = await getFbaFees({ asin, price, marketplaceId, userId });
  const durationMs = Date.now() - startMs;
  const totalFees = fba.total_fba_fees ?? null;
  const feeLines = fba.fee_lines ?? [];

  if (usageContext?.messageId) {
    const spapiKey = buildUsageIdempotencyKey({
      analysisRunId: usageContext.analysisRunId ?? null,
      messageId: usageContext.messageId,
      provider: "spapi",
      operation: "spapi.fees_estimate",
      asin,
      endpoint: FEES_ENDPOINT,
      cache_status: "none",
    });
    await logUsageEvent({
      userId,
      provider: "spapi",
      operation: "spapi.fees_estimate",
      endpoint: FEES_ENDPOINT,
      cache_status: "none",
      credits_used: 0,
      http_status: fba.debug?.http_status ?? null,
      duration_ms: durationMs,
      asin,
      marketplace_id: marketplaceId,
      meta: {},
      idempotency_key: spapiKey,
    });
  }

  if (totalFees == null && feeLines.length === 0) return null;

  const totalRounded = totalFees != null ? Math.round(totalFees * 100) / 100 : null;
  const feesJson = {
    asin,
    marketplace_id: marketplaceId,
    price,
    currency: "USD",
    total_fees: totalRounded,
    fee_lines: feeLines,
    fetched_at: now.toISOString(),
  };

  await supabase.from("asin_fees_cache").upsert(
    {
      user_id: userId,
      asin,
      marketplace_id: marketplaceId,
      is_amazon_fulfilled: true,
      listing_price: price,
      currency: "USD",
      dims_hash: DIMS_HASH_EMPTY,
      fees_json: feesJson,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: "user_id,asin,marketplace_id,is_amazon_fulfilled,listing_price,dims_hash" }
  );

  return {
    asin,
    marketplace_id: marketplaceId,
    price,
    currency: "USD",
    total_fees: totalRounded,
    fee_lines: feeLines,
    fetched_at: feesJson.fetched_at,
    cached: false,
  };
}
