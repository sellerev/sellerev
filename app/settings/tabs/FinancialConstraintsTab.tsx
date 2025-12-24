"use client";

import { useState, useEffect } from "react";

interface FinancialConstraint {
  key: string;
  label: string;
  type: "range" | "number" | "percent";
  value: unknown;
  tooltip: string;
}

export default function FinancialConstraintsTab() {
  const [constraints, setConstraints] = useState<FinancialConstraint[]>([
    {
      key: "target_margin_pct",
      label: "Target Net Margin (%)",
      type: "range",
      value: null,
      tooltip: "Used for margin assumptions & AI answers",
    },
    {
      key: "capital_limit_usd",
      label: "Maximum Capital per SKU",
      type: "number",
      value: null,
      tooltip: "Used to filter out opportunities that exceed your budget",
    },
    {
      key: "monthly_profit_target",
      label: "Monthly Revenue Goal",
      type: "range",
      value: null,
      tooltip: "Helps prioritize opportunities that align with your goals",
    },
    {
      key: "pricing_sweet_spot",
      label: "Pricing Sweet Spot",
      type: "range",
      value: null,
      tooltip: "Preferred price range for product analysis",
    },
  ]);

  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadConstraints();
  }, []);

  async function loadConstraints() {
    try {
      const response = await fetch("/api/memory/list");
      if (response.ok) {
        const data = await response.json();
        const memories = data.memories || [];
        
        const updated = constraints.map((c) => {
          const memory = memories.find((m: any) => m.key === c.key);
          return {
            ...c,
            value: memory?.value || null,
          };
        });

        setConstraints(updated);
        
        // All enabled by default
        const enabledMap: Record<string, boolean> = {};
        constraints.forEach((c) => {
          enabledMap[c.key] = true;
        });
        setEnabled(enabledMap);
      }
    } catch (error) {
      console.error("Error loading constraints:", error);
    }
  }

  async function handleSave(constraint: FinancialConstraint, value: unknown) {
    try {
      const response = await fetch("/api/memory/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: constraint.key,
          value,
          confidence: "high",
          memory_type: "constraints",
        }),
      });

      if (response.ok) {
        loadConstraints();
      } else {
        alert("Failed to save constraint");
      }
    } catch (error) {
      console.error("Error saving constraint:", error);
      alert("Failed to save constraint");
    }
  }

  function renderInput(constraint: FinancialConstraint) {
    if (constraint.type === "range") {
      const range = constraint.value as { min?: number; max?: number } | null;
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Min"
            value={range?.min || ""}
            onChange={(e) => {
              const newValue = {
                ...(range || {}),
                min: e.target.value ? parseFloat(e.target.value) : undefined,
              };
              handleSave(constraint, newValue);
            }}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <span className="text-gray-500">–</span>
          <input
            type="number"
            placeholder="Max"
            value={range?.max || ""}
            onChange={(e) => {
              const newValue = {
                ...(range || {}),
                max: e.target.value ? parseFloat(e.target.value) : undefined,
              };
              handleSave(constraint, newValue);
            }}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      );
    }

    if (constraint.type === "number") {
      return (
        <input
          type="number"
          value={(constraint.value as number) || ""}
          onChange={(e) => {
            const value = e.target.value ? parseFloat(e.target.value) : null;
            handleSave(constraint, value);
          }}
          className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      );
    }

    if (constraint.type === "percent") {
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="100"
            value={constraint.value ? ((constraint.value as number) * 100).toFixed(0) : ""}
            onChange={(e) => {
              const value = e.target.value ? parseFloat(e.target.value) / 100 : null;
              handleSave(constraint, value);
            }}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <span className="text-gray-500">%</span>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 mb-6">
        Set financial constraints to keep AI recommendations grounded and realistic.
      </p>

      {constraints.map((constraint) => (
        <div key={constraint.key} className="border-b border-gray-200 pb-6 last:border-0 last:pb-0">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <label className="font-medium text-gray-900">{constraint.label}</label>
                <span
                  className="text-gray-400 cursor-help"
                  title={constraint.tooltip}
                >
                  ⓘ
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">{constraint.tooltip}</p>
              {renderInput(constraint)}
            </div>
            <div className="ml-6 flex items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled[constraint.key] ?? true}
                  onChange={(e) => {
                    setEnabled({ ...enabled, [constraint.key]: e.target.checked });
                  }}
                  className="w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
                />
                <span className="text-sm text-gray-600">Use in analysis</span>
              </label>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
