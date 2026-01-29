import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAmazonConnection } from "@/lib/amazon/getUserToken";
import { getOrFetchFeesEstimate } from "./feesEstimate";
import { estimateFees } from "./estimateFees";

export interface FeesResultPayload {
  type: "fees_result";
  source: "sp_api" | "estimate";
  asin: string;
  marketplace_id: string;
  price_used: number | null;
  currency: string;
  total_fees: number;
  fee_lines: Array<{ name: string; amount: number }>;
  fetched_at: string;
  cached?: boolean;
  assumptions?: string[];
  cta_connect: boolean;
  warning?: string;
  marketplaceId?: string;
}

const DEFAULT_MARKETPLACE = "ATVPDKIKX0DER";

/**
 * Unified fees pipeline: never blocks. Returns SP-API result when connected,
 * otherwise estimated fees. On SP-API failure, falls back to estimate + warning.
 */
export async function getFeesResult(
  supabase: SupabaseClient,
  userId: string,
  params: { asin: string; marketplaceId?: string; price: number; category?: string | null }
): Promise<FeesResultPayload> {
  const asin = params.asin.trim();
  const marketplaceId = params.marketplaceId?.trim() || DEFAULT_MARKETPLACE;
  const price = params.price;
  const category = params.category ?? null;
  const now = new Date().toISOString();

  const connected = await hasAmazonConnection(userId);

  if (!connected) {
    const est = estimateFees(price, { category });
    return {
      type: "fees_result",
      source: "estimate",
      asin,
      marketplace_id: marketplaceId,
      price_used: price,
      currency: "USD",
      total_fees: est.total_fees,
      fee_lines: est.fee_lines,
      fetched_at: now,
      assumptions: est.assumptions,
      cta_connect: true,
    };
  }

  const sp = await getOrFetchFeesEstimate(supabase, userId, { asin, marketplaceId, price });
  if (sp && sp.total_fees != null) {
    return {
      type: "fees_result",
      source: "sp_api",
      asin,
      marketplace_id: sp.marketplace_id,
      price_used: sp.price,
      currency: sp.currency,
      total_fees: sp.total_fees,
      fee_lines: sp.fee_lines,
      fetched_at: sp.fetched_at,
      cached: sp.cached,
      cta_connect: false,
    };
  }

  const est = estimateFees(price, { category });
  return {
    type: "fees_result",
    source: "estimate",
    asin,
    marketplace_id: marketplaceId,
    price_used: price,
    currency: "USD",
    total_fees: est.total_fees,
    fee_lines: est.fee_lines,
    fetched_at: now,
    assumptions: est.assumptions,
    cta_connect: true,
    warning:
      "Couldn't access Amazon fees right now—showing estimated fees instead. Reconnect Amazon to restore exact fees.",
  };
}
