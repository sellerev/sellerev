"use client";

import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const STAGE_OPTIONS = [
  { label: "Just starting", value: "new" },
  { label: "Existing seller", value: "existing" },
  { label: "Scaling brand", value: "scaling" },
];

const REVENUE_OPTIONS = [
  { label: "Pre-revenue", value: "pre-revenue" },
  { label: "< $5k / month", value: "<$5k" },
  { label: "$5k–$10k / month", value: "$5k-$10k" },
  { label: "$10k–$50k / month", value: "$10k-$50k" },
  { label: "$50k–$100k / month", value: "$50k-$100k" },
  { label: "$100k+ / month", value: "$100k+" },
];

const SOURCING_MODEL_OPTIONS = [
  { label: "Private Label (manufactured / Alibaba)", value: "private_label" },
  { label: "Wholesale / Arbitrage", value: "wholesale_arbitrage" },
  { label: "Retail Arbitrage", value: "retail_arbitrage" },
  { label: "Dropshipping", value: "dropshipping" },
  { label: "Not sure yet", value: "not_sure" },
];

const RISK_TOLERANCE_OPTIONS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

export default function ProfileTab() {
  const supabase = supabaseBrowser;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form fields
  const [stage, setStage] = useState("");
  const [experienceMonths, setExperienceMonths] = useState<number | "">("");
  const [revenueRange, setRevenueRange] = useState("");
  const [sourcingModel, setSourcingModel] = useState("");
  const [goals, setGoals] = useState("");
  const [riskTolerance, setRiskTolerance] = useState("");
  const [marginTarget, setMarginTarget] = useState<number | "">("");
  const [maxFeePct, setMaxFeePct] = useState<number | "">("");

  // Load current profile
  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("seller_profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileError) {
        setError("Failed to load profile");
        setLoading(false);
        return;
      }

      // Populate form fields
      setStage(profile.stage || "");
      setExperienceMonths(profile.experience_months || "");
      setRevenueRange(profile.monthly_revenue_range || "");
      setSourcingModel(profile.sourcing_model || "");
      setGoals(profile.goals || "");
      setRiskTolerance(profile.risk_tolerance || "");
      setMarginTarget(profile.margin_target || "");
      setMaxFeePct(profile.max_fee_pct || "");
      
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!user || userError) {
        setError("Not authenticated");
        setSaving(false);
        router.push("/auth");
        return;
      }

      const { error: upsertError } = await supabase
        .from("seller_profiles")
        .upsert(
          {
            id: user.id,
            stage,
            experience_months: experienceMonths === "" ? null : Number(experienceMonths),
            monthly_revenue_range: revenueRange || null,
            sourcing_model: sourcingModel || null,
            goals: goals || null,
            risk_tolerance: riskTolerance || null,
            margin_target: marginTarget === "" ? null : Number(marginTarget),
            max_fee_pct: maxFeePct === "" ? null : Number(maxFeePct),
          },
          { onConflict: "id" }
        );

      if (upsertError) {
        setError(upsertError.message);
        setSaving(false);
      } else {
        setSuccess(true);
        setSaving(false);
        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(false), 3000);
        // Refresh the page to ensure latest data is used
        router.refresh();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading profile...</div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Success Message */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-green-700 font-medium">Profile updated successfully</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Profile Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stage */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Stage
          </label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="">Select stage</option>
            {STAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Experience Months */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Experience (months)
          </label>
          <input
            type="number"
            min="0"
            value={experienceMonths}
            onChange={(e) =>
              setExperienceMonths(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            placeholder="Optional"
          />
        </div>

        {/* Revenue Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Monthly Revenue Range
          </label>
          <select
            value={revenueRange}
            onChange={(e) => setRevenueRange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="">Select range</option>
            {REVENUE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sourcing Model */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Sourcing Model
          </label>
          <select
            value={sourcingModel}
            onChange={(e) => setSourcingModel(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="">Select model</option>
            {SOURCING_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Goals */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Goals
          </label>
          <textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            placeholder="Describe your business goals (optional)"
          />
        </div>

        {/* Risk Tolerance */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Risk Tolerance
          </label>
          <select
            value={riskTolerance}
            onChange={(e) => setRiskTolerance(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="">Select tolerance</option>
            {RISK_TOLERANCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Margin Target */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Margin Target (%)
          </label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={marginTarget}
            onChange={(e) =>
              setMarginTarget(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            placeholder="e.g., 25"
          />
          <p className="text-xs text-gray-500 mt-1">Target net margin percentage (0-100)</p>
        </div>

        {/* Max Fee % */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Max Fee % (FBA + Referral)
          </label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={maxFeePct}
            onChange={(e) =>
              setMaxFeePct(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            placeholder="e.g., 30"
          />
          <p className="text-xs text-gray-500 mt-1">Maximum acceptable total fees as percentage (0-100)</p>
        </div>
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-4 border-t">
        <button
          type="submit"
          disabled={saving}
          className="bg-black text-white rounded-lg px-6 py-2 font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

