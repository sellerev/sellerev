"use client";

import { useState, useEffect } from "react";

interface PendingMemory {
  id: string;
  memory_candidate: {
    memory_type: string;
    key: string;
    value: unknown;
  };
  reason: 'inferred' | 'conflict' | 'low_confidence';
}

interface PendingMemoryReviewProps {
  onClose: () => void;
}

export default function PendingMemoryReview({ onClose }: PendingMemoryReviewProps) {
  const [pendingMemories, setPendingMemories] = useState<PendingMemory[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPendingMemories();
  }, []);

  async function loadPendingMemories() {
    try {
      const response = await fetch("/api/memory/pending");
      if (response.ok) {
        const data = await response.json();
        const { shouldAskUserToConfirm } = await import("@/lib/ai/memoryMerge");
        
        const filtered = (data.pending || []).filter((p: PendingMemory) =>
          shouldAskUserToConfirm(p.memory_candidate as any, p.reason)
        );
        
        setPendingMemories(filtered);
      }
    } catch (error) {
      console.error("Error loading pending memories:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    const current = pendingMemories[currentIndex];
    if (!current) return;

    try {
      const response = await fetch("/api/memory/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingMemoryId: current.id, confidence: "medium" }),
      });

      if (response.ok) {
        // Move to next or close
        if (currentIndex < pendingMemories.length - 1) {
          setCurrentIndex(currentIndex + 1);
          setPendingMemories(pendingMemories.filter((_, i) => i !== currentIndex));
        } else {
          onClose();
        }
      } else {
        alert("Failed to save preference");
      }
    } catch (error) {
      console.error("Error confirming memory:", error);
      alert("Failed to save preference");
    }
  }

  async function handleEdit() {
    // For now, just save it (editing can be added later)
    await handleSave();
  }

  async function handleDontSave() {
    const current = pendingMemories[currentIndex];
    if (!current) return;

    try {
      const response = await fetch("/api/memory/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingMemoryId: current.id }),
      });

      if (response.ok) {
        // Move to next or close
        if (currentIndex < pendingMemories.length - 1) {
          setCurrentIndex(currentIndex + 1);
          setPendingMemories(pendingMemories.filter((_, i) => i !== currentIndex));
        } else {
          onClose();
        }
      } else {
        alert("Failed to reject preference");
      }
    } catch (error) {
      console.error("Error rejecting memory:", error);
      alert("Failed to reject preference");
    }
  }

  function formatValue(value: unknown): string {
    if (value === null || value === undefined) return "Not set";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return value.toLocaleString();
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  }

  function getInferenceReason(reason: string, memory: PendingMemory): string {
    if (reason === "inferred") {
      return "This was inferred from your usage patterns and conversations.";
    }
    if (reason === "conflict") {
      return "This conflicts with an existing high-confidence preference.";
    }
    return "This has low confidence and requires confirmation.";
  }

  const current = pendingMemories[currentIndex];

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <p className="text-gray-600">Loading suggestions...</p>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <h3 className="font-semibold text-gray-900 mb-2">All caught up!</h3>
          <p className="text-gray-600 mb-4">No pending suggestions to review.</p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const KEY_LABELS: Record<string, string> = {
    primary_sourcing_country: "Primary Sourcing Country",
    capital_limit_usd: "Capital Limit",
    avoided_categories: "Avoided Categories",
    prefers_bundles: "Prefers Bundles",
    risk_tolerance: "Risk Tolerance",
  };

  const label = KEY_LABELS[current.memory_candidate.key] || 
    current.memory_candidate.key.replace(/_/g, " ");

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Suggested Preference
          </h3>
          <span className="text-sm text-gray-500">
            {currentIndex + 1} of {pendingMemories.length}
          </span>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 mb-4">
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-700 mb-1">{label}</p>
            <p className="text-lg text-gray-900">{formatValue(current.memory_candidate.value)}</p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-2">Why this was inferred:</p>
          <p className="text-sm text-gray-600">{getInferenceReason(current.reason, current)}</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleSave}
            className="w-full px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Save
          </button>
          <button
            onClick={handleEdit}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors"
          >
            Edit before saving
          </button>
          <button
            onClick={handleDontSave}
            className="w-full px-4 py-2 border border-gray-300 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition-colors"
          >
            Don't save
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-4">
          No pressure. No auto-save.
        </p>
      </div>
    </div>
  );
}
