"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

type FeesPayload = {
  asin: string;
  marketplace_id: string;
  price: number;
  currency: string;
  total_fees: number | null;
  fee_lines: Array<{ name: string; amount: number }>;
  fetched_at: string;
  cached?: boolean;
};

export type FeesProfitCardPayload = {
  asin: string;
  marketplaceId: string;
  price: number | null;
  fees: FeesPayload | null;
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export interface FeesProfitChatCardProps {
  payload: FeesProfitCardPayload;
  onFeesFetched?: (fees: FeesPayload) => void;
}

export default function FeesProfitChatCard({ payload, onFeesFetched }: FeesProfitChatCardProps) {
  const { asin, marketplaceId, price: initialPrice, fees: initialFees } = payload;

  const [price, setPrice] = useState<string>(initialPrice != null ? String(initialPrice) : "");
  const [fees, setFees] = useState<FeesPayload | null>(initialFees);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [noAmazonConnection, setNoAmazonConnection] = useState(false);
  const [cogs, setCogs] = useState("");
  const [inbound, setInbound] = useState("");
  const [other, setOther] = useState("0");

  const handleFetch = useCallback(async () => {
    const p = Number.parseFloat(price);
    if (!Number.isFinite(p) || p <= 0) {
      setFetchError("Enter a valid price.");
      setNoAmazonConnection(false);
      return;
    }
    setFetchError(null);
    setNoAmazonConnection(false);
    setFetching(true);
    try {
      const res = await fetch("/api/fees-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, marketplaceId, price: p }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === "no_amazon_connection") {
          setNoAmazonConnection(true);
          setFetchError(null);
        } else {
          setFetchError(data?.message ?? data?.error ?? "Fee lookup failed.");
          setNoAmazonConnection(false);
        }
        return;
      }
      setFees(data);
      onFeesFetched?.(data);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Request failed.");
      setNoAmazonConnection(false);
    } finally {
      setFetching(false);
    }
  }, [asin, marketplaceId, price, onFeesFetched]);

  const totalFees = fees?.total_fees ?? null;
  const priceNum = Number.parseFloat(price);
  const validPrice = Number.isFinite(priceNum) && priceNum > 0;
  const cogsNum = Number.parseFloat(cogs) || 0;
  const inboundNum = Number.parseFloat(inbound) || 0;
  const otherNum = Number.parseFloat(other) || 0;
  const costs = cogsNum + inboundNum + otherNum;

  const netProfit =
    validPrice && totalFees != null
      ? Math.round((priceNum - totalFees - costs) * 100) / 100
      : null;
  const netMarginPct =
    validPrice && totalFees != null && priceNum > 0
      ? Math.round(((priceNum - totalFees - costs) / priceNum) * 10000) / 100
      : null;
  const breakEven =
    totalFees != null ? Math.round((totalFees + costs) * 100) / 100 : null;
  const feePct =
    validPrice && totalFees != null && priceNum > 0
      ? Math.round((totalFees / priceNum) * 10000) / 100
      : null;

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
      <div className="font-medium text-gray-900 mb-3">Fees & Profit</div>

      {/* Fees section */}
      <div className="space-y-2 mb-4">
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
            onClick={handleFetch}
            disabled={fetching || !validPrice}
            className="rounded bg-[#3B82F6] px-3 py-1 text-white text-xs font-medium hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fetching ? "Fetching…" : "Fetch Amazon fees"}
          </button>
        </div>
        {fetchError && <div className="text-amber-600 text-xs">{fetchError}</div>}
        {noAmazonConnection && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
            <p>Connect Amazon to fetch exact SP-API fees for this ASIN.</p>
            <Link
              href="/connect-amazon"
              className="mt-2 inline-block rounded bg-amber-600 px-3 py-1.5 text-white text-xs font-medium hover:bg-amber-700"
            >
              Connect Amazon
            </Link>
          </div>
        )}
        {fees && !noAmazonConnection && (
          <div className="rounded border border-gray-200 bg-white p-3 text-gray-800">
            <div className="font-medium text-gray-700">
              Total Amazon fees: {formatCurrency(fees.total_fees ?? 0)}
            </div>
            {fees.fee_lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                {fees.fee_lines.map((line, i) => (
                  <li key={i}>
                    {line.name}: {formatCurrency(line.amount)}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 text-[11px] text-gray-500">
              Source: Amazon SP-API{fees.cached ? " · Cached (7 days)" : ""} · {fees.fetched_at.slice(0, 10)}
            </div>
          </div>
        )}
      </div>

      {/* Profitability section */}
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
          {netProfit != null && (
            <span>Net profit: {formatCurrency(netProfit)}</span>
          )}
          {netMarginPct != null && (
            <span>Net margin: {netMarginPct}%</span>
          )}
          {breakEven != null && (
            <span>Break-even: {formatCurrency(breakEven)}</span>
          )}
          {feePct != null && (
            <span>Fee % of price: {feePct}%</span>
          )}
        </div>
      </div>
    </div>
  );
}
