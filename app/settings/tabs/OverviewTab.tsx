"use client";

import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

interface OverviewTabProps {
  onReviewPending: () => void;
}

export default function OverviewTab({ onReviewPending }: OverviewTabProps) {
  const [stats, setStats] = useState({
    confirmed: 0,
    pending: 0,
    lastUpdated: null as string | null,
  });

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return;

      // Load confirmed memories
      const { getSellerMemories } = await import("@/lib/ai/sellerMemoryStore");
      // const { getPendingMemories } = await import("@/lib/ai/sellerMemoryStore"); // Temporarily disabled - not required for MVP
      const { shouldAskUserToConfirm } = await import("@/lib/ai/memoryMerge");
      
      // Use API route instead (client-side can't use server functions directly)
      const [confirmedRes, pendingRes] = await Promise.all([
        fetch("/api/memory/list"),
        fetch("/api/memory/pending"),
      ]);

      if (confirmedRes.ok) {
        const confirmedData = await confirmedRes.json();
        const confirmed = confirmedData.memories || [];
        
        let lastUpdated: string | null = null;
        if (confirmed.length > 0) {
          const dates = confirmed.map((m: any) => new Date(m.updated_at || m.created_at));
          lastUpdated = new Date(Math.max(...dates.map((d: Date) => d.getTime()))).toISOString();
        }

        if (pendingRes.ok) {
          const pendingData = await pendingRes.json();
          const pending = (pendingData.pending || []).filter((p: any) =>
            shouldAskUserToConfirm(p.memory_candidate, p.reason)
          );

          setStats({
            confirmed: confirmed.length,
            pending: pending.length,
            lastUpdated,
          });
        } else {
          setStats({
            confirmed: confirmed.length,
            pending: 0,
            lastUpdated,
          });
        }
      }
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  }

  function formatLastUpdated(dateString: string | null): string {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  }

  return (
    <div className="space-y-6">
      {/* How Sellerev Uses This */}
      <div className="border-b border-gray-200 pb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          How Sellerev Uses This
        </h2>
        <p className="text-gray-600 text-sm leading-relaxed">
          Sellerev uses these preferences to tailor analysis, assumptions, and AI responses.
        </p>
        <p className="text-gray-600 text-sm leading-relaxed mt-2">
          You're always in control — nothing here is required.
        </p>
      </div>

      {/* Memory Health Card */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              Seller Memory Status
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span>
                <span className="text-sm text-gray-700">
                  {stats.confirmed} confirmed preference{stats.confirmed !== 1 ? 's' : ''}
                </span>
              </div>
              {stats.pending > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-yellow-600">⏳</span>
                  <span className="text-sm text-gray-700">
                    {stats.pending} suggestion{stats.pending !== 1 ? 's' : ''} pending review
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-gray-500">
                  Last updated: {formatLastUpdated(stats.lastUpdated)}
                </span>
              </div>
            </div>
          </div>
          {stats.pending > 0 && (
            <button
              onClick={onReviewPending}
              className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Review pending suggestions
            </button>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('settings-tab-change', { detail: 'preferences' }));
          }}
          className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <h4 className="font-medium text-gray-900 mb-1">Operating Preferences</h4>
          <p className="text-xs text-gray-600">Manage sourcing, logistics, and strategy preferences</p>
        </button>
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('settings-tab-change', { detail: 'financial' }));
          }}
          className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <h4 className="font-medium text-gray-900 mb-1">Financial Constraints</h4>
          <p className="text-xs text-gray-600">Set capital limits, margin targets, and pricing ranges</p>
        </button>
      </div>
    </div>
  );
}
