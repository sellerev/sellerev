"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Search, Trash2 } from "lucide-react";

interface AnalysisRun {
  id: string;
  input_value: string;
  created_at: string;
}

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  anchorElement?: HTMLElement | null;
}

/**
 * HistoryPanel - History overlay panel
 * 
 * Displays recent analyses in a floating panel matching app theme.
 */
export default function HistoryPanel({ isOpen, onClose, anchorElement }: HistoryPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRunId = searchParams.get("run");

  const PAGE_SIZE = 25;
  const [analyses, setAnalyses] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch initial analyses when panel opens
  useEffect(() => {
    if (isOpen) {
      loadAnalyses(true);
    }
  }, [isOpen]);

  async function loadAnalyses(reset = false, cursorCreatedAt?: string) {
    try {
      if (reset) {
        setLoading(true);
        setAnalyses([]);
      }

      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();

      if (!user) {
        setLoading(false);
        setHasMore(false);
        return;
      }

      let query = supabaseBrowser
        .from("analysis_runs")
        .select("id, input_value, created_at")
        .eq("user_id", user.id)
        .eq("input_type", "keyword")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE + 1);

      if (!reset && cursorCreatedAt) {
        query = query.lt("created_at", cursorCreatedAt);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error loading analyses:", error);
        setLoading(false);
        setLoadingMore(false);
        setHasMore(false);
        return;
      }

      const list = data || [];
      const next = list.length > PAGE_SIZE ? list.slice(0, PAGE_SIZE) : list;
      setHasMore(list.length > PAGE_SIZE);
      if (reset) {
        setAnalyses(next);
      } else {
        setAnalyses((prev) => [...prev, ...next]);
      }
    } catch (error) {
      console.error("Error fetching analyses:", error);
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore || analyses.length === 0) return;
    setLoadingMore(true);
    const lastCreated = analyses[analyses.length - 1].created_at;
    await loadAnalyses(false, lastCreated);
  }

  /** Returns group label for a given date (for grouping). Order matches sort. */
  function getGroupLabel(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const analysisDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today.getTime() - analysisDay.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays >= 2 && diffDays <= 6) return "This week";
    if (diffDays >= 7 && diffDays <= 13) return "2w ago";
    if (diffDays >= 14 && diffDays <= 20) return "3w ago";
    if (diffDays >= 21 && diffDays <= 44) return "1 month ago";
    if (diffDays >= 45 && diffDays <= 74) return "2 months ago";
    if (diffDays >= 75 && diffDays <= 104) return "3 months ago";
    if (diffDays >= 105 && diffDays <= 199) return "6 months ago";
    if (diffDays >= 200 && diffDays <= 364) return "1 year ago";
    return "Older";
  }

  const groupOrder = [
    "Today",
    "Yesterday",
    "This week",
    "2w ago",
    "3w ago",
    "1 month ago",
    "2 months ago",
    "3 months ago",
    "6 months ago",
    "1 year ago",
    "Older",
  ];

  const groupedAnalyses = useMemo(() => {
    const filtered = analyses.filter((analysis) =>
      analysis.input_value.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const byLabel = new Map<string, AnalysisRun[]>();
    filtered.forEach((analysis) => {
      const label = getGroupLabel(analysis.created_at);
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label)!.push(analysis);
    });
    return groupOrder
      .filter((label) => byLabel.has(label) && byLabel.get(label)!.length > 0)
      .map((label) => ({ label, analyses: byLabel.get(label)! }));
  }, [analyses, searchQuery]);

  /** Per-item time label — uses same boundaries as getGroupLabel so group header and item text match. */
  function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const analysisDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today.getTime() - analysisDay.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      if (diffMinutes < 1) return "Just now";
      if (diffMinutes < 60) return `${diffMinutes}m ago`;
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return "1d ago";
    if (diffDays >= 2 && diffDays <= 6) return `${diffDays}d ago`;
    if (diffDays >= 7 && diffDays <= 13) return "2w ago";
    if (diffDays >= 14 && diffDays <= 20) return "3w ago";
    if (diffDays >= 21 && diffDays <= 44) return "1 month ago";
    if (diffDays >= 45 && diffDays <= 74) return "2 months ago";
    if (diffDays >= 75 && diffDays <= 104) return "3 months ago";
    if (diffDays >= 105 && diffDays <= 199) return "6 months ago";
    if (diffDays >= 200 && diffDays <= 364) return "1 year ago";
    return "Older";
  }

  function handleAnalysisClick(runId: string, e?: React.MouseEvent) {
    if (e) {
      e.stopPropagation();
    }
    // Update URL only - existing logic in page.tsx will handle state restoration
    router.push(`/analyze?run=${runId}`, { scroll: false });
    onClose();
  }

  function handleDeleteClick(runId: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    // Read-only: Delete functionality not implemented per requirements
    // This would require API endpoint and permission checks
  }

  // Calculate panel position (anchor to button or default to top-right)
  const panelStyle: React.CSSProperties = useMemo(() => {
    if (anchorElement && typeof window !== 'undefined') {
      const rect = anchorElement.getBoundingClientRect();
      return {
        position: "fixed",
        top: `${rect.bottom + 8}px`,
        right: `${window.innerWidth - rect.right}px`,
        width: "340px",
        maxWidth: "340px",
      };
    }
    return {
      position: "fixed",
      top: "60px",
      right: "20px",
      width: "340px",
      maxWidth: "340px",
    };
  }, [anchorElement]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed z-50 bg-white border border-[#E5E7EB] rounded-lg shadow-lg overflow-hidden flex flex-col max-h-[80vh]"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="p-3 border-b border-[#E5E7EB]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent transition-colors"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onClose();
                }
              }}
            />
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {loading ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              Loading…
            </div>
          ) : groupedAnalyses.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              {searchQuery ? "No analyses match your search" : "No analyses yet"}
            </div>
          ) : (
            <>
              {groupedAnalyses.map((group) => (
                <div key={group.label} className="border-b border-[#E5E7EB] last:border-b-0">
                  {/* Group header */}
                  <div className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                    {group.label}
                  </div>

                  {/* Group items */}
                  {group.analyses.map((analysis) => {
                    const isActive = analysis.id === activeRunId;
                    return (
                      <div
                        key={analysis.id}
                        onClick={(e) => handleAnalysisClick(analysis.id, e)}
                        className={`relative px-4 py-2.5 hover:bg-gray-100 cursor-pointer group transition-colors ${
                          isActive ? "bg-primary/10 hover:bg-primary/10 border-l-2 border-primary" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Magnifying glass icon */}
                          <Search className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isActive ? "text-[#3B82F6]" : "text-gray-400"}`} />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div
                              className={`text-sm truncate mb-1 ${
                                isActive ? "text-gray-900 font-medium" : "text-gray-900"
                              }`}
                            >
                              {analysis.input_value}
                            </div>
                            <div className={`text-xs ${isActive ? "text-gray-600" : "text-gray-500"}`}>
                              {formatRelativeTime(analysis.created_at)}
                            </div>
                          </div>

                          {/* Delete icon - show on hover */}
                          <button
                            onClick={(e) => handleDeleteClick(analysis.id, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-all flex-shrink-0"
                            aria-label="Delete analysis"
                            title="Delete (read-only)"
                          >
                            <Trash2 className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {hasMore && (
                <div className="p-3 border-t border-[#E5E7EB] bg-white">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full py-2.5 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg border border-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

