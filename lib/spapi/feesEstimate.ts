import type { SupabaseClient } from "@supabase/supabase-js";
import { getFbaFees } from "./getFbaFees";

export interface FeesEstimatePayload {
  asin: string;
  marketplace_id: string;
  price: number;
  currency: string;
  total_fees: number | null;
  fee_lines: Array<{ name: string; amount: number }>;
  fetched_at: string;
}

const TTL_DAYS = 7;
const DEFAULT_MARKETPLACE = "ATVPDKIKX0DER";

export async function getOrFetchFeesEstimate(
  supabase: SupabaseClient,
  userId: string,
  params: { asin: string; marketplaceId?: string; price: number }
): Promise<FeesEstimatePayload | null> {
  const asin = params.asin.trim();
  const marketplaceId = params.marketplaceId && params.marketplaceId.length > 0 ? params.marketplaceId : DEFAULT_MARKETPLACE;
  const price = params.price;

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + TTL_DAYS);

  const { data: cached, error: cacheErr } = await supabase
    .from("spapi_fee_estimates")
    .select("asin, marketplace_id, price, currency, total_fees, fee_lines, fetched_at")
    .eq("asin", asin)
    .eq("marketplace_id", marketplaceId)
    .eq("price", price)
    .gt("expires_at", now.toISOString())
    .limit(1)
    .single();

  if (!cacheErr && cached) {
    return {
      asin: cached.asin,
      marketplace_id: cached.marketplace_id,
      price: Number(cached.price),
      currency: (cached.currency as string) || "USD",
      total_fees: cached.total_fees != null ? Number(cached.total_fees) : null,
      fee_lines: Array.isArray(cached.fee_lines) ? (cached.fee_lines as Array<{ name: string; amount: number }>) : [],
      fetched_at: (cached.fetched_at as string) || now.toISOString(),
    };
  }

  const fba = await getFbaFees({
    asin,
    price,
    marketplaceId,
    userId,
  });

  const referral = fba.referral_fee ?? null;
  const fulfillment = fba.fulfillment_fee ?? null;
  const totalFees = fba.total_fba_fees ?? (referral != null && fulfillment != null ? referral + fulfillment : null);

  if (totalFees == null || (referral == null && fulfillment == null)) return null;

  const totalFeesRounded = Math.round(totalFees * 100) / 100;
  const feeLines: Array<{ name: string; amount: number }> = [];
  if (referral != null && referral > 0) feeLines.push({ name: "Referral", amount: Math.round(referral * 100) / 100 });
  if (fulfillment != null && fulfillment > 0) feeLines.push({ name: "FBA fulfillment", amount: Math.round(fulfillment * 100) / 100 });

  const row = {
    asin,
    marketplace_id: marketplaceId,
    price,
    currency: "USD",
    total_fees: totalFeesRounded,
    fee_lines: feeLines,
    raw: { referral_fee: fba.referral_fee, fulfillment_fee: fba.fulfillment_fee, total_fba_fees: fba.total_fba_fees },
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  await supabase.from("spapi_fee_estimates").upsert(row, {
    onConflict: "asin,marketplace_id,price",
  });

  return {
    asin,
    marketplace_id: marketplaceId,
    price,
    currency: "USD",
    total_fees: totalFeesRounded,
    fee_lines: feeLines,
    fetched_at: row.fetched_at,
  };
}
