/**
 * Deterministic fee estimator when SP-API is unavailable (no OAuth or API failure).
 * Used so fees are never blocked — we always return a usable breakdown.
 */

import { getReferralFeePctByCategory } from "./getReferralFeePct";

export interface EstimateFeesResult {
  referral_fee: number;
  fulfillment_fee: number;
  total_fees: number;
  fee_lines: Array<{ name: string; amount: number }>;
  assumptions: string[];
}

const DEFAULT_REFERRAL_PCT = 15;
/** Conservative standard-size FBA placeholder when we lack dimensions. */
const DEFAULT_FULFILLMENT_FEE = 3.5;

export function estimateFees(
  price: number,
  opts?: { category?: string | null; fulfillmentFee?: number }
): EstimateFeesResult {
  const referralPct =
    opts?.category != null
      ? getReferralFeePctByCategory(opts.category)
      : DEFAULT_REFERRAL_PCT;
  const referral_fee = Math.round(price * (referralPct / 100) * 100) / 100;
  const fulfillment_fee = opts?.fulfillmentFee ?? DEFAULT_FULFILLMENT_FEE;
  const total_fees = Math.round((referral_fee + fulfillment_fee) * 100) / 100;
  const fee_lines: Array<{ name: string; amount: number }> = [
    { name: "Referral", amount: referral_fee },
    { name: "FBA fulfillment", amount: Math.round(fulfillment_fee * 100) / 100 },
  ];
  const assumptions: string[] = [];
  if (opts?.category == null)
    assumptions.push(`Referral: ${DEFAULT_REFERRAL_PCT}% default (category unknown).`);
  else assumptions.push(`Referral: ${referralPct}% from category.`);
  if (opts?.fulfillmentFee == null)
    assumptions.push("FBA fulfillment: conservative standard-size estimate. Connect Amazon for exact fees.");
  return { referral_fee, fulfillment_fee, total_fees, fee_lines, assumptions };
}
