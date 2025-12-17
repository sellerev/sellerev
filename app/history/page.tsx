import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import HistoryGrid from "./HistoryGrid";

/**
 * History Page - Server Component
 * 
 * Lists past analysis runs and allows users to reopen
 * a full analysis + chat view.
 * 
 * SECURITY:
 * - User may ONLY see their own analysis_runs
 * - Never exposes other users' data
 */

interface AnalysisRun {
  id: string;
  input_type: string;
  input_value: string;
  created_at: string;
  ai_verdict: string | null;
  ai_confidence: number | null;
}

export default async function HistoryPage() {
  const supabase = await createClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  // Query analysis_runs where user_id = current user
  // Order by created_at DESC, limit 50
  const { data: runs, error } = await supabase
    .from("analysis_runs")
    .select("id, input_type, input_value, created_at, ai_verdict, ai_confidence")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Analysis History</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
            <p className="text-red-700">Error loading history: {error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* BLOCK 1: HEADER                                                     */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analysis History</h1>
            <p className="text-gray-500 text-sm mt-1">Your past product decisions</p>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* BLOCK 2 & 3: HISTORY GRID OR EMPTY STATE                            */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {!runs || runs.length === 0 ? (
          /* BLOCK 3: EMPTY STATE */
          <div className="bg-white border rounded-xl p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No analyses yet</h2>
            <p className="text-gray-500 text-sm mb-6">
              Run your first product analysis to start building your history.
            </p>
            <Link
              href="/analyze"
              className="inline-flex items-center px-6 py-3 bg-black text-white rounded-lg font-medium text-sm hover:bg-gray-800 transition-colors"
            >
              Run your first analysis
            </Link>
          </div>
        ) : (
          /* BLOCK 2: HISTORY GRID (Client component for search) */
          <HistoryGrid runs={runs as AnalysisRun[]} />
        )}
      </div>
    </div>
  );
}
