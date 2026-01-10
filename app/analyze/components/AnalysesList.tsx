"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

interface AnalysisRun {
  id: string;
  input_value: string;
  created_at: string;
  ai_verdict?: string | null;
}

/**
 * AnalysesList - Cursor-style analyses rail
 * 
 * Displays a list of recent analyses for quick switching.
 * Clicking an analysis updates the URL, which triggers state restoration.
 */
export default function AnalysesList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRunId = searchParams.get("run");

  const [analyses, setAnalyses] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Fetch analyses on mount
  useEffect(() => {
    loadAnalyses();
  }, []);

  async function loadAnalyses() {
    try {
      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("analysis_runs")
        .select("id, input_value, created_at, ai_verdict")
        .eq("user_id", user.id)
        .eq("input_type", "keyword") // Only keyword analyses for now
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("Error loading analyses:", error);
        setLoading(false);
        return;
      }

      setAnalyses(data || []);
    } catch (error) {
      console.error("Error fetching analyses:", error);
    } finally {
      setLoading(false);
    }
  }

  function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function getVerdictBadge(verdict: string | null | undefined): string {
    if (!verdict) return "";
    switch (verdict) {
      case "GO":
        return "text-green-600";
      case "CAUTION":
        return "text-yellow-600";
      case "NO_GO":
        return "text-red-600";
      default:
        return "text-gray-500";
    }
  }

  function handleAnalysisClick(runId: string) {
    // Update URL only - existing logic in page.tsx will handle state restoration
    router.push(`/analyze?run=${runId}`, { scroll: false });
  }

  if (loading) {
    return (
      <div className="px-6 py-2.5 border-b border-gray-100/50 shrink-0">
        <div className="text-xs text-gray-400">Loading analyses...</div>
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <div className="border-b border-gray-100/50 shrink-0">
        <div className="px-6 py-2.5">
          <h3 className="text-xs font-medium text-gray-500 mb-2">Analyses</h3>
        </div>
        <div className="px-6 pb-3">
          <div className="text-xs text-gray-400">No saved analyses yet</div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-100/50 shrink-0">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-6 py-2.5 flex items-center justify-between hover:bg-gray-50/50 transition-colors group"
      >
        <h3 className="text-xs font-medium text-gray-500 group-hover:text-gray-700">
          Analyses
        </h3>
        <svg
          className={`w-3 h-3 text-gray-400 transition-transform ${
            collapsed ? "" : "rotate-180"
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* List */}
      {!collapsed && (
        <div className="max-h-[320px] overflow-y-auto">
          {analyses.map((analysis) => {
            const isActive = analysis.id === activeRunId;
            return (
              <button
                key={analysis.id}
                onClick={() => handleAnalysisClick(analysis.id)}
                className={`w-full px-6 py-1.5 text-left hover:bg-gray-50/50 transition-colors relative rounded-md ${
                  isActive ? "bg-blue-50/60" : ""
                }`}
              >
                {/* Left accent for active state */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-600 rounded-r" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-xs font-medium truncate mb-0.5 ${
                        isActive ? "text-gray-900" : "text-gray-700"
                      }`}
                    >
                      {analysis.input_value}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500">
                        {formatRelativeTime(analysis.created_at)}
                      </span>
                      {analysis.ai_verdict && (
                        <span
                          className={`text-[10px] font-medium ${getVerdictBadge(
                            analysis.ai_verdict
                          )}`}
                        >
                          {analysis.ai_verdict === "NO_GO" ? "NO GO" : analysis.ai_verdict}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

