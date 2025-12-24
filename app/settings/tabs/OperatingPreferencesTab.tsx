"use client";

import { useState, useEffect } from "react";
import MemoryCard from "../components/MemoryCard";

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

export default function OperatingPreferencesTab() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMemories();
  }, []);

  async function loadMemories() {
    try {
      const response = await fetch("/api/memory/list");
      if (response.ok) {
        const data = await response.json();
        // Filter to operating preferences (sourcing, logistics, preferences, goals, strategy)
        const operatingTypes = ['sourcing', 'logistics', 'preferences', 'goals', 'strategy'];
        const filtered = (data.memories || []).filter((m: Memory) =>
          operatingTypes.includes(m.memory_type)
        );
        setMemories(filtered);
      }
    } catch (error) {
      console.error("Error loading memories:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(memoryId: string, key: string) {
    if (!confirm(`Delete this preference? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch("/api/memory/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });

      if (response.ok) {
        setMemories(memories.filter((m) => m.id !== memoryId));
      } else {
        alert("Failed to delete preference");
      }
    } catch (error) {
      console.error("Error deleting memory:", error);
      alert("Failed to delete preference");
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Loading preferences...</p>
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">No operating preferences saved yet.</p>
        <p className="text-sm text-gray-400">
          Preferences will appear here as you use Sellerev and confirm suggestions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 mb-6">
        These preferences help Sellerev tailor analysis and recommendations to how you operate.
      </p>
      <div className="grid gap-4">
        {memories.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            onDelete={() => handleDelete(memory.id, memory.key)}
            onUpdate={loadMemories}
          />
        ))}
      </div>
    </div>
  );
}
