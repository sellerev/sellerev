"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

/**
 * HistoryGrid - Client Component
 * 
 * Displays analysis runs in a grid with client-side search filtering.
 */

interface AnalysisRun {
  id: string;
  input_type: string;
  input_value: string;
  created_at: string;
  ai_verdict: string | null;
  ai_confidence: number | null;
}

interface HistoryGridProps {
  runs: AnalysisRun[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

function getVerdictStyles(verdict: string | null): {
  badge: string;
  text: string;
} {
  switch (verdict) {
    case "GO":
      return {
        badge: "bg-green-100 text-green-800 border-green-300",
        text: "GO",
      };
    case "CAUTION":
      return {
        badge: "bg-yellow-100 text-yellow-800 border-yellow-300",
        text: "CAUTION",
      };
    case "NO_GO":
      return {
        badge: "bg-red-100 text-red-800 border-red-300",
        text: "NO GO",
      };
    default:
      return {
        badge: "bg-gray-100 text-gray-800 border-gray-300",
        text: "UNKNOWN",
      };
  }
}

function getInputTypeLabel(inputType: string): string {
  switch (inputType) {
    case "asin":
      return "ASIN";
    case "keyword":
      return "Keyword";
    default:
      return inputType.toUpperCase();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function HistoryGrid({ runs }: HistoryGridProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Client-side filter
  const filteredRuns = useMemo(() => {
    if (!searchQuery.trim()) return runs;
    
    const query = searchQuery.toLowerCase();
    return runs.filter((run) => {
      return (
        run.input_value.toLowerCase().includes(query) ||
        run.input_type.toLowerCase().includes(query) ||
        (run.ai_verdict && run.ai_verdict.toLowerCase().includes(query))
      );
    });
  }, [runs, searchQuery]);

  return (
    <div>
      {/* Search Input */}
      <div className="mb-6 flex justify-end">
        <div className="relative w-full sm:w-72">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search analyses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
          />
        </div>
      </div>

      {/* Grid */}
      {filteredRuns.length === 0 ? (
        <div className="bg-white border rounded-xl p-8 text-center">
          <p className="text-gray-500">No analyses match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRuns.map((run) => {
            const verdictStyles = getVerdictStyles(run.ai_verdict);
            
            return (
              <Link
                key={run.id}
                href={`/analyze/${run.id}`}
                className="bg-white border rounded-xl p-5 hover:border-gray-400 hover:shadow-md transition-all cursor-pointer group"
              >
                {/* Header: Verdict Badge + Confidence */}
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={`px-3 py-1 rounded-md border text-xs font-bold ${verdictStyles.badge}`}
                  >
                    {verdictStyles.text}
                  </span>
                  {run.ai_confidence !== null && (
                    <span className="text-sm text-gray-500 font-medium">
                      {run.ai_confidence}%
                    </span>
                  )}
                </div>

                {/* Input Value */}
                <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 group-hover:text-black">
                  {run.input_value}
                </h3>

                {/* Meta: Type + Time */}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="px-2 py-0.5 bg-gray-100 rounded font-medium">
                    {getInputTypeLabel(run.input_type)}
                  </span>
                  <span>{formatRelativeTime(run.created_at)}</span>
                </div>

                {/* Hover indicator */}
                <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs text-gray-400 group-hover:text-gray-600">
                  <span>View analysis</span>
                  <svg
                    className="w-4 h-4 transform group-hover:translate-x-1 transition-transform"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}










