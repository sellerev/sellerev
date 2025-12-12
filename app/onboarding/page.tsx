"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Stage = "new" | "existing" | "thinking";

export default function OnboardingPage() {
  const supabase = createClient();

  const [stage, setStage] = useState<Stage | null>(null);
  const [experience, setExperience] = useState("");
  const [revenue, setRevenue] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!stage) return;
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    await supabase.from("seller_profiles").insert({
      id: user.id,
      stage,
      experience_months:
        stage === "existing" ? Number(experience) || null : null,
      monthly_revenue_range:
        stage === "existing" ? revenue || null : null,
    });

    window.location.href = "/dashboard";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <h1 className="text-2xl font-semibold">Welcome to Sellerev</h1>
        <p className="text-gray-500">
          Let’s understand where you’re at so we can give you the right signals.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {[
            { id: "new", label: "New Seller" },
            { id: "existing", label: "Existing Seller" },
            { id: "thinking", label: "Just Researching" },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setStage(opt.id as Stage)}
              className={`border rounded-lg p-4 text-center ${
                stage === opt.id ? "bg-black text-white" : ""
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {stage === "existing" && (
          <div className="space-y-3">
            <input
              className="border rounded p-2 w-full"
              placeholder="Months selling on Amazon"
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
            />
            <input
              className="border rounded p-2 w-full"
              placeholder="Monthly revenue range (e.g. $5k–$10k)"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
            />
          </div>
        )}

        <button
          disabled={!stage || loading}
          onClick={submit}
          className="bg-black text-white rounded p-3 w-full disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}