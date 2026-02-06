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

  const [analyses, setAnalyses] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch analyses on mount and when panel opens
  useEffect(() => {
    if (isOpen) {
      loadAnalyses();
    }
  }, [isOpen]);

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
        .select("id, input_value, created_at")
        .eq("user_id", user.id)
        .eq("input_type", "keyword")
        .order("created_at", { ascending: false })
        .limit(50);

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

  // Group analyses by date
  const groupedAnalyses = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Filter by search query
    const filtered = analyses.filter((analysis) =>
      analysis.input_value.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const groups: {
      label: string;
      analyses: AnalysisRun[];
    }[] = [
      { label: "Today", analyses: [] },
      { label: "Yesterday", analyses: [] },
      { label: "2 days ago", analyses: [] },
      { label: "Last week", analyses: [] },
    ];

    filtered.forEach((analysis) => {
      const analysisDate = new Date(analysis.created_at);
      const analysisDay = new Date(
        analysisDate.getFullYear(),
        analysisDate.getMonth(),
        analysisDate.getDate()
      );

      const todayTime = today.getTime();
      const yesterdayTime = yesterday.getTime();
      const twoDaysAgoTime = twoDaysAgo.getTime();
      const analysisDayTime = analysisDay.getTime();

      // Categorize by day
      if (analysisDayTime === todayTime) {
        groups[0].analyses.push(analysis);
      } else if (analysisDayTime === yesterdayTime) {
        groups[1].analyses.push(analysis);
      } else if (analysisDayTime === twoDaysAgoTime) {
        groups[2].analyses.push(analysis);
      } else if (analysisDate >= lastWeek) {
        // Within last week but not in specific day buckets (3-7 days ago)
        groups[3].analyses.push(analysis);
      } else {
        // Older than last week - include in "Last week" group as fallback
        groups[3].analyses.push(analysis);
      }
    });

    // Only return groups that have analyses
    return groups.filter((group) => group.analyses.length > 0);
  }, [analyses, searchQuery]);

  function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
    return `${Math.floor(diffDays / 30)}mo`;
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
            groupedAnalyses.map((group) => (
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
            ))
          )}
        </div>
      </div>
    </>
  );
}

