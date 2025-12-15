import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface AnalysisRun {
  id: string;
  input_type: string;
  input_value: string;
  created_at: string;
  response: any;
  ai_verdict?: string;
  ai_confidence?: number;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getVerdict(run: AnalysisRun): string {
  // Try to get verdict from direct column first
  if (run.ai_verdict) {
    return run.ai_verdict;
  }

  // Fallback to parsing response JSON
  try {
    if (run.response && typeof run.response === "object") {
      return run.response.decision?.verdict || "Unknown";
    }
    if (typeof run.response === "string") {
      const parsed = JSON.parse(run.response);
      return parsed.decision?.verdict || "Unknown";
    }
  } catch {
    // Malformed JSON
  }

  return "Unknown";
}

function getConfidence(run: AnalysisRun): number | null {
  // Try to get confidence from direct column first
  if (run.ai_confidence !== undefined && run.ai_confidence !== null) {
    return run.ai_confidence;
  }

  // Fallback to parsing response JSON
  try {
    if (run.response && typeof run.response === "object") {
      return run.response.decision?.confidence ?? null;
    }
    if (typeof run.response === "string") {
      const parsed = JSON.parse(run.response);
      return parsed.decision?.confidence ?? null;
    }
  } catch {
    // Malformed JSON
  }

  return null;
}

function getVerdictColor(verdict: string): string {
  switch (verdict) {
    case "GO":
      return "text-green-600 font-semibold";
    case "CAUTION":
      return "text-yellow-600 font-semibold";
    case "NO_GO":
      return "text-red-600 font-semibold";
    default:
      return "text-gray-600";
  }
}

export default async function AnalyzeHistoryPage() {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  // Query analysis runs
  const { data: runs, error } = await supabase
    .from("analysis_runs")
    .select("id, input_type, input_value, created_at, response, ai_verdict, ai_confidence")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Analyze History</h1>
        <p className="text-red-500">Error loading history: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Analyze History</h1>

      {!runs || runs.length === 0 ? (
        <div className="border rounded-lg p-8 text-center">
          <p className="text-gray-500">No analysis history yet.</p>
          <p className="text-gray-400 text-sm mt-2">
            Run your first analysis to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => {
            const verdict = getVerdict(run);
            const confidence = getConfidence(run);

            return (
              <div
                key={run.id}
                className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`text-lg ${getVerdictColor(verdict)}`}>
                      {verdict}
                    </span>
                    {confidence !== null && (
                      <span className="text-sm text-gray-500">
                        {confidence}% confidence
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-gray-400">
                    {formatDate(run.created_at)}
                  </span>
                </div>

                <div className="mt-2 space-y-1">
                  <div className="text-sm">
                    <span className="text-gray-500">Type: </span>
                    <span className="font-medium capitalize">{run.input_type}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-500">Input: </span>
                    <span className="font-medium">{run.input_value}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
