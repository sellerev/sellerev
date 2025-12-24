"use client";

import { useState } from "react";
// Format relative time without date-fns dependency
function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? "" : "s"} ago`;
  return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) === 1 ? "" : "s"} ago`;
}

interface Memory {
  id: string;
  memory_type: string;
  key: string;
  value: unknown;
  confidence: 'low' | 'medium' | 'high';
  source: string;
  last_confirmed_at: string | null;
  updated_at: string;
}

interface MemoryCardProps {
  memory: Memory;
  onDelete: () => void;
  onUpdate: () => void;
}

const KEY_LABELS: Record<string, string> = {
  primary_sourcing_country: "Primary Sourcing Country",
  backup_sourcing_country: "Backup Sourcing Country",
  uses_wholesale: "Uses Wholesale",
  uses_private_label: "Uses Private Label",
  typical_cogs_percent: "Typical COGS %",
  target_landed_cost_range: "Target Landed Cost Range",
  comfortable_moq: "Comfortable MOQ",
  max_unit_weight_lbs: "Max Unit Weight (lbs)",
  preferred_size_tier: "Preferred Size Tier",
  uses_fba: "Uses FBA",
  avoided_categories: "Avoided Categories",
  capital_limit_usd: "Capital Limit (USD)",
  launch_time_horizon_days: "Launch Time Horizon (days)",
  primary_goal: "Primary Goal",
  monthly_profit_target: "Monthly Profit Target",
  prefers_bundles: "Prefers Bundles",
  risk_tolerance: "Risk Tolerance",
  defensibility_priority: "Defensibility Priority",
};

const SOURCE_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  explicit_user_statement: "You confirmed this",
  attachment_extraction: "From uploaded file",
  ai_inference: "Inferred from usage",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (value < 1 && value > 0) {
      return `${Math.round(value * 100)}%`;
    }
    return value.toLocaleString();
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.min !== undefined && obj.max !== undefined) {
      return `$${obj.min} – $${obj.max}`;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

export default function MemoryCard({ memory, onDelete, onUpdate }: MemoryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(formatValue(memory.value));

  const label = KEY_LABELS[memory.key] || memory.key.replace(/_/g, " ");
  const sourceLabel = SOURCE_LABELS[memory.source] || memory.source;
  const confidenceBadge = memory.confidence === "high" ? "High" : "Medium";

  async function handleSave() {
    try {
      // Parse the edit value based on original type
      let parsedValue: unknown = editValue;
      if (typeof memory.value === "number") {
        parsedValue = parseFloat(editValue);
      } else if (typeof memory.value === "boolean") {
        parsedValue = editValue.toLowerCase() === "yes" || editValue === "true";
      }

      const response = await fetch("/api/memory/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: memory.key,
          value: parsedValue,
          confidence: "high", // User edits are always high confidence
        }),
      });

      if (response.ok) {
        setIsEditing(false);
        onUpdate();
      } else {
        alert("Failed to update preference");
      }
    } catch (error) {
      console.error("Error updating memory:", error);
      alert("Failed to update preference");
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-5 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 mb-1">{label}</h3>
          {isEditing ? (
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              autoFocus
            />
          ) : (
            <p className="text-gray-700">{formatValue(memory.value)}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-4">
          {isEditing ? (
            <>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 bg-black text-white rounded text-sm font-medium hover:bg-gray-800"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditValue(formatValue(memory.value));
                }}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsEditing(true)}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                onClick={onDelete}
                className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-sm font-medium hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span
            className={`px-2 py-0.5 rounded ${
              memory.confidence === "high"
                ? "bg-green-100 text-green-700"
                : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {confidenceBadge}
          </span>
        </span>
        <span>Source: {sourceLabel}</span>
        <span>
          Updated: {formatDistanceToNow(new Date(memory.updated_at))}
        </span>
      </div>
    </div>
  );
}
