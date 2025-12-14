"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function OnboardingPage() {
  const supabase = supabaseBrowser;

  const [stage, setStage] = useState("");
  const [experienceMonths, setExperienceMonths] = useState<number | "">("");
  const [revenueRange, setRevenueRange] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (!user || userError) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("seller_profiles")
      .upsert({
        id: user.id,
        stage,
        experience_months: experienceMonths,
        monthly_revenue_range: revenueRange,
      });

    if (insertError) {
      setError(insertError.message);
    } else {
      window.location.href = "/dashboard";
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 border rounded-xl p-6">
        <h1 className="text-xl font-semibold">Tell us about your selling stage</h1>

        <input
          className="border rounded p-2 w-full"
          placeholder="Stage (e.g. Researching, Launched, Scaling)"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        />

        <input
          className="border rounded p-2 w-full"
          placeholder="Experience (months)"
          type="number"
          value={experienceMonths}
          onChange={(e) =>
            setExperienceMonths(
              e.target.value === "" ? "" : Number(e.target.value)
            )
          }
        />

        <input
          className="border rounded p-2 w-full"
          placeholder="Monthly revenue range (e.g. $0–1k, $1k–10k)"
          value={revenueRange}
          onChange={(e) => setRevenueRange(e.target.value)}
        />

        <button
          className="bg-black text-white rounded p-2 w-full disabled:opacity-50"
          disabled={loading || !stage || !experienceMonths || !revenueRange}
          onClick={submit}
        >
          Continue
        </button>

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>
    </div>
  );
}