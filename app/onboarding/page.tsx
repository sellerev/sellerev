"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Stage = "new" | "existing" | "thinking";

export default function OnboardingPage() {
  const supabase = supabaseBrowser;
  const router = useRouter();

  const [stage, setStage] = useState<Stage | null>(null);
  const [experience, setExperience] = useState("");
  const [revenue, setRevenue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check authentication on mount
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
    if (!stage) return;

    // Validate experience_months for existing sellers
    if (stage === "existing") {
      const experienceNum = Number(experience);
      if (!experience || isNaN(experienceNum) || experienceNum < 0) {
        setError("Please enter a valid number of months for experience");
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setError("Authentication failed. Please try again.");
        setLoading(false);
        router.push("/auth");
        return;
      }

      const experienceMonths =
        stage === "existing" && experience
          ? Number(experience)
          : null;

      const { error: upsertError } = await supabase
        .from("seller_profiles")
        .upsert(
          {
            id: user.id,
            stage,
            experience_months: experienceMonths,
            monthly_revenue_range: revenue || null,
          },
          { onConflict: "id" }
        );

      if (upsertError) {
        setError(`Failed to save profile: ${upsertError.message}`);
        setLoading(false);
        return;
      }

      // Success - redirect to dashboard
      router.push("/dashboard");
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
      <div className="w-full max-w-lg space-y-6">
        <h1 className="text-2xl font-semibold">Welcome to Sellerev</h1>
        <p className="text-gray-500">
          Let's understand where you're at so we can give you the right signals.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {[
            { id: "new", label: "New Seller" },
            { id: "existing", label: "Existing Seller" },
            { id: "thinking", label: "Just Researching" },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                setStage(opt.id as Stage);
                setError(null);
              }}
              disabled={loading}
              className={`border rounded-lg p-4 text-center transition-colors ${
                stage === opt.id
                  ? "bg-black text-white"
                  : "hover:bg-gray-50"
              } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {stage === "existing" && (
          <div className="space-y-3">
            <input
              type="number"
              min="0"
              className="border rounded p-2 w-full"
              placeholder="Months selling on Amazon"
              value={experience}
              onChange={(e) => {
                setExperience(e.target.value);
                setError(null);
              }}
              disabled={loading}
            />
            <input
              type="text"
              className="border rounded p-2 w-full"
              placeholder="Monthly revenue range (e.g. $5k–$10k)"
              value={revenue}
              onChange={(e) => {
                setRevenue(e.target.value);
                setError(null);
              }}
              disabled={loading}
            />
          </div>
        )}

        <button
          disabled={!stage || loading}
          onClick={submit}
          className="bg-black text-white rounded p-3 w-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
