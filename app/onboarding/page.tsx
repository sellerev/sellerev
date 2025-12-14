"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function OnboardingPage() {
  const supabase = supabaseBrowser;
  const router = useRouter();

  const [stage, setStage] = useState("");
  const [experienceMonths, setExperienceMonths] = useState<number | "">("");
  const [revenueRange, setRevenueRange] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check authentication on load
  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth");
        return;
      }

      setCheckingAuth(false);
    };

    checkAuth();
  }, [router, supabase]);

  const submit = async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!user || userError) {
        setError("Not authenticated");
        setLoading(false);
        router.push("/auth");
        return;
      }

      const { error: insertError } = await supabase
        .from("seller_profiles")
        .insert({
          id: user.id,
          stage,
          experience_months: experienceMonths === "" ? null : experienceMonths,
          monthly_revenue_range: revenueRange || null,
        });

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 border rounded-xl p-6">
        <h1 className="text-xl font-semibold">Tell us about your selling stage</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Stage</label>
          <select
            className="border rounded p-2 w-full"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            disabled={loading}
          >
            <option value="">Select stage</option>
            <option value="new_seller">New Seller</option>
            <option value="existing_seller">Existing Seller</option>
            <option value="researching">Researching</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Experience (months)
          </label>
          <input
            type="number"
            min="0"
            className="border rounded p-2 w-full"
            placeholder="Enter months"
            value={experienceMonths}
            onChange={(e) =>
              setExperienceMonths(
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Monthly revenue range
          </label>
          <select
            className="border rounded p-2 w-full"
            value={revenueRange}
            onChange={(e) => setRevenueRange(e.target.value)}
            disabled={loading}
          >
            <option value="">Select range</option>
            <option value="$0">$0</option>
            <option value="$1k–$10k">$1k–$10k</option>
            <option value="$10k–$50k">$10k–$50k</option>
            <option value="$50k+">$50k+</option>
          </select>
        </div>

        <button
          className="bg-black text-white rounded p-2 w-full disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={loading || !stage || !revenueRange}
          onClick={submit}
        >
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
