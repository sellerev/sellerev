"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { FeesResultPayload } from "@/lib/spapi/feesResult";

export type FeesResultCardPayload = FeesResultPayload & { marketplaceId?: string };

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export interface FeesProfitChatCardProps {
  payload: FeesResultCardPayload;
  onFeesFetched?: (result: FeesResultCardPayload) => void;
}

export default function FeesProfitChatCard({ payload, onFeesFetched }: FeesProfitChatCardProps) {
  const { asin, marketplace_id, marketplaceId, price_used, source, fee_lines, total_fees, cta_connect, warning } = payload;
  const mkt = marketplaceId ?? marketplace_id;

  const [price, setPrice] = useState<string>(price_used != null && price_used > 0 ? String(price_used) : "");
  const [result, setResult] = useState<FeesResultCardPayload | null>(
    total_fees > 0 || (fee_lines && fee_lines.length > 0) ? payload : null
  );
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cogs, setCogs] = useState("");
  const [inbound, setInbound] = useState("");
  const [other, setOther] = useState("0");

  const handleCalculate = useCallback(async () => {
    const p = Number.parseFloat(price);
    if (!Number.isFinite(p) || p <= 0) {
      setFetchError("Enter a valid price.");
      return;
    }
    setFetchError(null);
    setFetching(true);
    try {
      const res = await fetch("/api/fees-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, marketplaceId: mkt, price: p }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data?.message ?? data?.error ?? "Fee lookup failed.");
        return;
      }
      const next: FeesResultCardPayload = { ...data, marketplaceId: data.marketplace_id ?? mkt };
      setResult(next);
      onFeesFetched?.(next);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setFetching(false);
    }
  }, [asin, mkt, price, onFeesFetched]);

  const active = result ?? payload;
  const totalFees = active.total_fees ?? 0;
  const priceNum = Number.parseFloat(price || String(active.price_used ?? ""));
  const validPrice = Number.isFinite(priceNum) && priceNum > 0;
  const cogsNum = Number.parseFloat(cogs) || 0;
  const inboundNum = Number.parseFloat(inbound) || 0;
  const otherNum = Number.parseFloat(other) || 0;
  const costs = cogsNum + inboundNum + otherNum;

  const netProfit = validPrice ? Math.round((priceNum - totalFees - costs) * 100) / 100 : null;
  const netMarginPct = validPrice && priceNum > 0 ? Math.round(((priceNum - totalFees - costs) / priceNum) * 10000) / 100 : null;
  const breakEven = Math.round((totalFees + costs) * 100) / 100;
  const feePct = validPrice && priceNum > 0 ? Math.round((totalFees / priceNum) * 10000) / 100 : null;
  const roi = costs > 0 && netProfit != null ? Math.round((netProfit / costs) * 10000) / 100 : null;

  const isEstimate = active.source === "estimate";
  const badge = isEstimate ? "Estimated (No Amazon connection)" : "SP-API (Connected)";

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
      <div className="font-medium text-gray-900 mb-3">Fees & Profit</div>

      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-200 text-gray-700">{badge}</span>
          {active.warning && (
            <span className="text-xs text-amber-700">{active.warning}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-gray-600">Selling price</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 29.99"
            className="w-24 rounded border border-gray-300 px-2 py-1 text-gray-900"
          />
          <button
            type="button"
            onClick={handleCalculate}
            disabled={fetching || !(Number.parseFloat(price || "0") > 0)}
            className="rounded bg-[#3B82F6] px-3 py-1 text-white text-xs font-medium hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fetching ? "Calculating…" : "Calculate fees"}
          </button>
        </div>
        {fetchError && <div className="text-amber-600 text-xs">{fetchError}</div>}

        {(totalFees > 0 || (active.fee_lines && active.fee_lines.length > 0)) && (
          <div className="rounded border border-gray-200 bg-white p-3 text-gray-800">
            <div className="font-medium text-gray-700">
              Total Amazon fees: {formatCurrency(totalFees)}
            </div>
            {active.fee_lines && active.fee_lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                {active.fee_lines.map((line, i) => (
                  <li key={i}>
                    {line.name}: {formatCurrency(line.amount)}
                  </li>
                ))}
              </ul>
            )}
            {isEstimate && active.assumptions && active.assumptions.length > 0 && (
              <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                {active.assumptions.map((a, i) => (
                  <div key={i}>{a}</div>
                ))}
              </div>
            )}
            {isEstimate && cta_connect && (
              <div className="mt-2">
                <Link
                  href="/connect-amazon"
                  className="inline-block rounded bg-amber-600 px-3 py-1.5 text-white text-xs font-medium hover:bg-amber-700"
                >
                  Connect Amazon to get exact fees
                </Link>
              </div>
            )}
            {!isEstimate && (
              <div className="mt-1 text-[11px] text-gray-500">
                Source: Amazon SP-API Fees Estimate{active.cached ? " · Cached (7 days)" : ""} · {active.fetched_at?.slice(0, 10) ?? ""}
              </div>
            )}
          </div>
        )}

        {(!result || (result.total_fees === 0 && (!result.fee_lines || result.fee_lines.length === 0))) &&
          active.assumptions?.some((a) => a.includes("Enter selling price")) && (
            <p className="text-xs text-gray-500">Enter selling price above, then click Calculate fees.</p>
          )}
      </div>

      <div className="space-y-2">
        <div className="text-gray-700 font-medium">Profitability</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] text-gray-500">COGS</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cogs}
              onChange={(e) => setCogs(e.target.value)}
              placeholder="0"
              className="w-full rounded border border-gray-300 px-2 py-1 text-gray-900 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500">Inbound to Amazon</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={inbound}
              onChange={(e) => setInbound(e.target.value)}
              placeholder="0"
              className="w-full rounded border border-gray-300 px-2 py-1 text-gray-900 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500">Other costs</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="0"
              className="w-full rounded border border-gray-300 px-2 py-1 text-gray-900 text-xs"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {netProfit != null && <span>Net proceeds: {formatCurrency(netProfit)}</span>}
          {netMarginPct != null && <span>Margin: {netMarginPct}%</span>}
          <span>Break-even: {formatCurrency(breakEven)}</span>
          {feePct != null && <span>Fee %: {feePct}%</span>}
          {roi != null && <span>ROI: {roi}%</span>}
        </div>
      </div>
    </div>
  );
}
