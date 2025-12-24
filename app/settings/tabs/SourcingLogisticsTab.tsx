"use client";

import { useState, useEffect } from "react";

const SOURCING_REGIONS = ["China", "Vietnam", "Mexico", "Domestic only"];
const LOGISTICS_CONSTRAINTS = [
  { key: "avoid_oversized", label: "Avoid oversized items" },
  { key: "avoid_hazmat", label: "Avoid hazmat" },
  { key: "ok_sea_freight", label: "OK with sea freight" },
  { key: "fba_only", label: "FBA only" },
];

export default function SourcingLogisticsTab() {
  const [sourcingRegions, setSourcingRegions] = useState<string[]>([]);
  const [logisticsConstraints, setLogisticsConstraints] = useState<Record<string, boolean>>({});
  const [moqTolerance, setMoqTolerance] = useState<"low" | "medium" | "high" | null>(null);
  const [leadTimeTolerance, setLeadTimeTolerance] = useState<string | null>(null);

  useEffect(() => {
    loadPreferences();
  }, []);

  async function loadPreferences() {
    try {
      const response = await fetch("/api/memory/list");
      if (response.ok) {
        const data = await response.json();
        const memories = data.memories || [];
        
        // Load sourcing regions
        const primaryCountry = memories.find((m: any) => m.key === "primary_sourcing_country");
        if (primaryCountry?.value) {
          setSourcingRegions([String(primaryCountry.value)]);
        }

        // Load logistics constraints
        const constraints: Record<string, boolean> = {};
        LOGISTICS_CONSTRAINTS.forEach((c) => {
          const memory = memories.find((m: any) => m.key === c.key);
          constraints[c.key] = memory?.value === true;
        });
        setLogisticsConstraints(constraints);

        // Load MOQ and lead time
        const moq = memories.find((m: any) => m.key === "comfortable_moq");
        if (moq?.value) {
          // Infer tolerance from MOQ value
          const moqValue = moq.value as number;
          if (moqValue < 500) setMoqTolerance("low");
          else if (moqValue < 2000) setMoqTolerance("medium");
          else setMoqTolerance("high");
        }
      }
    } catch (error) {
      console.error("Error loading preferences:", error);
    }
  }

  async function saveSourcingRegion(region: string, checked: boolean) {
    const updated = checked
      ? [...sourcingRegions, region]
      : sourcingRegions.filter((r) => r !== region);

    setSourcingRegions(updated);

    if (updated.length > 0) {
      await fetch("/api/memory/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "primary_sourcing_country",
          value: updated[0],
          confidence: "high",
          memory_type: "sourcing",
        }),
      });
    }
  }

  async function saveLogisticsConstraint(key: string, checked: boolean) {
    setLogisticsConstraints({ ...logisticsConstraints, [key]: checked });

    await fetch("/api/memory/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        value: checked,
        confidence: "high",
        memory_type: "logistics",
      }),
    });
  }

  async function saveMoqTolerance(value: "low" | "medium" | "high") {
    setMoqTolerance(value);
    
    // Map to approximate MOQ values
    const moqMap = { low: 250, medium: 1000, high: 5000 };
    
    await fetch("/api/memory/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "comfortable_moq",
        value: moqMap[value],
        confidence: "high",
        memory_type: "logistics",
      }),
    });
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-600 mb-6">
        Configure sourcing and logistics preferences to prevent bad recommendations.
      </p>

      {/* Preferred Sourcing Regions */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-4">Preferred Sourcing Regions</h3>
        <div className="space-y-2">
          {SOURCING_REGIONS.map((region) => (
            <label key={region} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sourcingRegions.includes(region)}
                onChange={(e) => saveSourcingRegion(region, e.target.checked)}
                className="w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
              />
              <span className="text-sm text-gray-700">{region}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Logistics Constraints */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-4">Logistics Constraints</h3>
        <div className="space-y-2">
          {LOGISTICS_CONSTRAINTS.map((constraint) => (
            <label key={constraint.key} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={logisticsConstraints[constraint.key] || false}
                onChange={(e) => saveLogisticsConstraint(constraint.key, e.target.checked)}
                className="w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
              />
              <span className="text-sm text-gray-700">{constraint.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Supplier Preferences */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-4">Supplier Preferences</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              MOQ tolerance
            </label>
            <select
              value={moqTolerance || ""}
              onChange={(e) => saveMoqTolerance(e.target.value as "low" | "medium" | "high")}
              className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Select...</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Lead time tolerance
            </label>
            <select
              value={leadTimeTolerance || ""}
              onChange={(e) => setLeadTimeTolerance(e.target.value)}
              className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Select...</option>
              <option value="<30 days">&lt;30 days</option>
              <option value="<60 days">&lt;60 days</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
