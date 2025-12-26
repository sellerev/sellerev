"use client";

import { useState, useEffect, useMemo } from "react";
import { getReferralFeePctByCategory } from "@/lib/spapi/getReferralFeePct";

/**
 * Feasibility Calculator Component
 * 
 * Non-AI calculator for product feasibility analysis.
 * User can edit assumptions and instantly see margin changes.
 */

interface FeasibilityCalculatorProps {
  // Defaults from market analysis
  defaultPrice?: number | null;
  categoryHint?: string | null; // For referral fee default and fee estimation fallback
  representativeAsin?: string | null; // For SP-API fee lookup
}

interface CalculatorInputs {
  target_price: number;
  cogs_low_pct: number; // COGS as % of target price
  cogs_high_pct: number;
  ship_mode: "air" | "sea" | "none";
  ship_cost_per_kg: number;
  weight_kg: number | null;
  dims_cm: { length: number | null; width: number | null; height: number | null };
  referral_fee_pct: number;
}

interface CalculatorOutputs {
  landed_cost_low: number;
  landed_cost_high: number;
  fees_low: number; // referral + fba + shipping
  fees_high: number;
  net_margin_pct_low: number;
  net_margin_pct_high: number;
  breakeven_price_low: number;
  breakeven_price_high: number;
  fba_fee: number | null;
  fba_fee_source: "sp_api" | "estimated" | null;
  fba_fee_estimated: boolean; // True if showing "est."
}

// Default shipping costs per kg (heuristics)
const DEFAULT_SHIP_COST_PER_KG = {
  air: 8.0,
  sea: 2.5,
  none: 0,
};

// Default COGS ranges (% of price)
const DEFAULT_COGS_LOW_PCT = 40;
const DEFAULT_COGS_HIGH_PCT = 65;

export default function FeasibilityCalculator({
  defaultPrice,
  categoryHint,
  representativeAsin,
}: FeasibilityCalculatorProps) {
  // Get default referral fee percentage from category
  const defaultReferralFeePct = categoryHint 
    ? getReferralFeePctByCategory(categoryHint)
    : 15.0; // Default 15%

  // Initialize inputs with defaults
  const [inputs, setInputs] = useState<CalculatorInputs>(() => ({
    target_price: defaultPrice || 25.0,
    cogs_low_pct: DEFAULT_COGS_LOW_PCT,
    cogs_high_pct: DEFAULT_COGS_HIGH_PCT,
    ship_mode: "air",
    ship_cost_per_kg: DEFAULT_SHIP_COST_PER_KG.air,
    weight_kg: null,
    dims_cm: { length: null, width: null, height: null },
    referral_fee_pct: defaultReferralFeePct,
  }));

  // Update target_price when defaultPrice changes
  useEffect(() => {
    if (defaultPrice !== null && defaultPrice !== undefined && defaultPrice > 0) {
      setInputs((prev) => ({ ...prev, target_price: defaultPrice }));
    }
  }, [defaultPrice]);

  // Update referral_fee_pct when category changes
  useEffect(() => {
    setInputs((prev) => ({ ...prev, referral_fee_pct: defaultReferralFeePct }));
  }, [defaultReferralFeePct]);

  // FBA fee state (fetched from SP-API if available)
  const [fbaFee, setFbaFee] = useState<{
    fee: number | null;
    source: "sp_api" | "estimated";
    loading: boolean;
  }>({
    fee: null,
    source: "estimated",
    loading: false,
  });

  // Fetch FBA fees when ASIN or price changes
  useEffect(() => {
    const fetchFbaFees = async () => {
      if (!representativeAsin || !inputs.target_price || inputs.target_price <= 0) {
        // No ASIN or invalid price - use estimated fees
        const estimated = estimateFbaFeeBySize(
          inputs.weight_kg,
          inputs.dims_cm,
          categoryHint
        );
        setFbaFee({
          fee: estimated.fee,
          source: "estimated",
          loading: false,
        });
        return;
      }

      setFbaFee({ fee: null, source: "estimated", loading: true });

      try {
        // Try to fetch from SP-API
        const response = await fetch("/api/fba-fees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asin: representativeAsin,
            price: inputs.target_price,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.fee !== null && data.fee !== undefined) {
            setFbaFee({
              fee: data.fee,
              source: "sp_api",
              loading: false,
            });
            return;
          }
        }
      } catch (error) {
        console.error("Failed to fetch FBA fees:", error);
      }

      // Fallback to estimated
      const estimated = estimateFbaFeeBySize(
        inputs.weight_kg,
        inputs.dims_cm,
        categoryHint
      );
      setFbaFee({
        fee: estimated.fee,
        source: "estimated",
        loading: false,
      });
    };

    fetchFbaFees();
  }, [representativeAsin, inputs.target_price, inputs.weight_kg, inputs.dims_cm, categoryHint]);

  // Calculate outputs
  const outputs = useMemo<CalculatorOutputs>(() => {
    const targetPrice = inputs.target_price || 0;

    // Calculate COGS in dollars
    const cogsLow = (targetPrice * inputs.cogs_low_pct) / 100;
    const cogsHigh = (targetPrice * inputs.cogs_high_pct) / 100;

    // Calculate shipping cost
    let shippingCost = 0;
    if (inputs.ship_mode !== "none" && inputs.weight_kg && inputs.weight_kg > 0) {
      shippingCost = inputs.ship_cost_per_kg * inputs.weight_kg;
    }

    // Calculate landed cost (COGS + shipping)
    const landedCostLow = cogsLow + shippingCost;
    const landedCostHigh = cogsHigh + shippingCost;

    // Calculate referral fee
    const referralFee = (targetPrice * inputs.referral_fee_pct) / 100;

    // Use FBA fee (from SP-API or estimated)
    const fbaFeeValue = fbaFee.fee !== null && fbaFee.fee !== undefined
      ? fbaFee.fee
      : estimateFbaFeeBySize(inputs.weight_kg, inputs.dims_cm, categoryHint).fee;

    // Total fees = referral + FBA + shipping
    const feesLow = referralFee + fbaFeeValue + shippingCost;
    const feesHigh = referralFee + fbaFeeValue + shippingCost; // Same for both scenarios

    // Net margin = target_price - landed_cost - fees
    const netMarginLow = targetPrice - landedCostHigh - feesHigh;
    const netMarginHigh = targetPrice - landedCostLow - feesLow;

    // Net margin percentage
    const netMarginPctLow = targetPrice > 0 ? (netMarginLow / targetPrice) * 100 : 0;
    const netMarginPctHigh = targetPrice > 0 ? (netMarginHigh / targetPrice) * 100 : 0;

    // Breakeven price = landed_cost + fees
    const breakevenPriceLow = landedCostLow + feesLow;
    const breakevenPriceHigh = landedCostHigh + feesHigh;

    return {
      landed_cost_low: landedCostLow,
      landed_cost_high: landedCostHigh,
      fees_low: feesLow,
      fees_high: feesHigh,
      net_margin_pct_low: Math.max(0, netMarginPctLow),
      net_margin_pct_high: Math.max(0, netMarginPctHigh),
      breakeven_price_low: breakevenPriceLow,
      breakeven_price_high: breakevenPriceHigh,
      fba_fee: fbaFeeValue,
      fba_fee_source: fbaFee.source,
      fba_fee_estimated: fbaFee.source === "estimated",
    };
  }, [inputs, fbaFee, categoryHint]);

  // Update shipping cost when ship_mode changes
  const handleShipModeChange = (mode: "air" | "sea" | "none") => {
    setInputs((prev) => ({
      ...prev,
      ship_mode: mode,
      ship_cost_per_kg: mode === "none" ? 0 : DEFAULT_SHIP_COST_PER_KG[mode],
    }));
  };

  return (
    <div className="bg-white border rounded-lg p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Feasibility Calculator</h2>

      {/* Inputs Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Target Price */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Target Price ($)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={inputs.target_price}
            onChange={(e) =>
              setInputs((prev) => ({
                ...prev,
                target_price: parseFloat(e.target.value) || 0,
              }))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        {/* COGS Low % */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            COGS Low (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={inputs.cogs_low_pct}
            onChange={(e) =>
              setInputs((prev) => ({
                ...prev,
                cogs_low_pct: parseFloat(e.target.value) || 0,
              }))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        {/* COGS High % */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            COGS High (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={inputs.cogs_high_pct}
            onChange={(e) =>
              setInputs((prev) => ({
                ...prev,
                cogs_high_pct: parseFloat(e.target.value) || 0,
              }))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        {/* Ship Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Shipping Mode
          </label>
          <select
            value={inputs.ship_mode}
            onChange={(e) => handleShipModeChange(e.target.value as "air" | "sea" | "none")}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="air">Air</option>
            <option value="sea">Sea</option>
            <option value="none">None</option>
          </select>
        </div>

        {/* Shipping Cost per kg */}
        {inputs.ship_mode !== "none" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Shipping Cost per kg ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={inputs.ship_cost_per_kg}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    ship_cost_per_kg: parseFloat(e.target.value) || 0,
                  }))
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            {/* Weight (kg) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Weight (kg) <span className="text-gray-500 text-xs">(optional)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={inputs.weight_kg || ""}
                onChange={(e) =>
                  setInputs((prev) => ({
                    ...prev,
                    weight_kg: e.target.value ? parseFloat(e.target.value) : null,
                  }))
                }
                placeholder="Optional"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </>
        )}

        {/* Dimensions (optional) */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Dimensions (cm) <span className="text-gray-500 text-xs">(optional)</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              step="0.1"
              min="0"
              value={inputs.dims_cm.length || ""}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  dims_cm: {
                    ...prev.dims_cm,
                    length: e.target.value ? parseFloat(e.target.value) : null,
                  },
                }))
              }
              placeholder="Length"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <input
              type="number"
              step="0.1"
              min="0"
              value={inputs.dims_cm.width || ""}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  dims_cm: {
                    ...prev.dims_cm,
                    width: e.target.value ? parseFloat(e.target.value) : null,
                  },
                }))
              }
              placeholder="Width"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <input
              type="number"
              step="0.1"
              min="0"
              value={inputs.dims_cm.height || ""}
              onChange={(e) =>
                setInputs((prev) => ({
                  ...prev,
                  dims_cm: {
                    ...prev.dims_cm,
                    height: e.target.value ? parseFloat(e.target.value) : null,
                  },
                }))
              }
              placeholder="Height"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
        </div>

        {/* Referral Fee % */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Referral Fee (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={inputs.referral_fee_pct}
            onChange={(e) =>
              setInputs((prev) => ({
                ...prev,
                referral_fee_pct: parseFloat(e.target.value) || 0,
              }))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
      </div>

      {/* Outputs Section */}
      <div className="border-t pt-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Results</h3>

        {/* FBA Fee Info */}
        {fbaFee.loading ? (
          <div className="mb-3 text-sm text-gray-500">Loading FBA fees...</div>
        ) : (
          <div className="mb-3 text-sm text-gray-600">
            FBA Fee: ${outputs.fba_fee?.toFixed(2) || "0.00"}{" "}
            {outputs.fba_fee_estimated && <span className="text-gray-500">(est.)</span>}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Landed Cost */}
          <div>
            <div className="text-sm text-gray-600 mb-1">Landed Cost</div>
            <div className="text-lg font-semibold text-gray-900">
              ${outputs.landed_cost_low.toFixed(2)} - ${outputs.landed_cost_high.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">COGS + Shipping</div>
          </div>

          {/* Total Fees */}
          <div>
            <div className="text-sm text-gray-600 mb-1">Total Fees</div>
            <div className="text-lg font-semibold text-gray-900">
              ${outputs.fees_low.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Referral + FBA + Shipping</div>
          </div>

          {/* Net Margin */}
          <div>
            <div className="text-sm text-gray-600 mb-1">Net Margin %</div>
            <div className="text-lg font-semibold text-gray-900">
              {outputs.net_margin_pct_low.toFixed(1)}% - {outputs.net_margin_pct_high.toFixed(1)}%
            </div>
          </div>

          {/* Breakeven Price */}
          <div>
            <div className="text-sm text-gray-600 mb-1">Breakeven Price</div>
            <div className="text-lg font-semibold text-gray-900">
              ${outputs.breakeven_price_low.toFixed(2)} - ${outputs.breakeven_price_high.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Estimate FBA fee based on size/weight/category
 * Uses size-tier heuristics when SP-API is unavailable
 */
function estimateFbaFeeBySize(
  weightKg: number | null,
  dimsCm: { length: number | null; width: number | null; height: number | null },
  categoryHint: string | null | undefined
): { fee: number; label: string } {
  // If we have dimensions, use longest side
  const longestSide = dimsCm.length || dimsCm.width || dimsCm.height || null;
  const maxDimension = Math.max(
    dimsCm.length || 0,
    dimsCm.width || 0,
    dimsCm.height || 0
  );

  // Small/standard items (< 1 lb, < 18" longest side)
  if (
    (weightKg === null || weightKg < 0.45) &&
    (maxDimension === 0 || maxDimension < 45.72) // 18" = 45.72 cm
  ) {
    return { fee: 7.5, label: "Small/standard (estimated)" }; // Midpoint of $6-9
  }

  // Oversize/home goods (> 20 lbs or > 18" longest side)
  if (
    (weightKg && weightKg > 9.07) || // 20 lbs = 9.07 kg
    (maxDimension > 45.72) ||
    (categoryHint && (
      categoryHint.toLowerCase().includes("furniture") ||
      categoryHint.toLowerCase().includes("appliance") ||
      categoryHint.toLowerCase().includes("oversized")
    ))
  ) {
    return { fee: 10.0, label: "Oversize/home goods (estimated)" }; // Midpoint of $8-12
  }

  // Default: large standard (1-20 lbs, typical)
  return { fee: 8.5, label: "Large standard (estimated)" }; // Midpoint of $7-10
}

