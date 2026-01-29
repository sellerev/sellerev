"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

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

const SOURCING_OPTIONS = [
  { label: "Private Label (manufactured / Alibaba)", value: "private_label" },
  { label: "Wholesale / Arbitrage", value: "wholesale_arbitrage" },
  { label: "Retail Arbitrage", value: "retail_arbitrage" },
  { label: "Dropshipping", value: "dropshipping" },
  { label: "Not sure yet", value: "not_sure" },
];

const RISK_OPTIONS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

function parseNum(val: string): number | null {
  const n = Number.parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [stage, setStage] = useState("");
  const [monthlyRevenueRange, setMonthlyRevenueRange] = useState("");
  const [sourcingModel, setSourcingModel] = useState("");
  const [experienceMonths, setExperienceMonths] = useState<string>("");
  const [riskTolerance, setRiskTolerance] = useState("");
  const [marginTarget, setMarginTarget] = useState<string>("");
  const [maxFeePct, setMaxFeePct] = useState<string>("");
  const [goals, setGoals] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) {
        router.replace("/auth");
        return;
      }
      setCheckingAuth(false);
    };
    check();
  }, [router]);

  const requiredOk = !!stage && !!monthlyRevenueRange && !!sourcingModel;

  const submit = async (skip: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user }, error: userError } = await supabaseBrowser.auth.getUser();
      if (!user || userError) {
        setError("Not authenticated");
        setLoading(false);
        router.replace("/auth");
        return;
      }

      const updatedAt = new Date().toISOString();

      if (skip) {
        // Minimal upsert: id + updated_at. sourcing_model NOT NULL in DB → use 'not_sure'.
        const { error: upsertErr } = await supabaseBrowser
          .from("seller_profiles")
          .upsert(
            { id: user.id, updated_at: updatedAt, sourcing_model: "not_sure" },
            { onConflict: "id" }
          );
        if (upsertErr) {
          setError(upsertErr.message);
          setLoading(false);
          return;
        }
        router.replace("/analyze");
        return;
      }

      const rawMargin = parseNum(marginTarget);
      const rawFee = parseNum(maxFeePct);
      const marginVal = rawMargin != null && rawMargin >= 0 && rawMargin <= 100 ? rawMargin : null;
      const feeVal = rawFee != null && rawFee >= 0 && rawFee <= 100 ? rawFee : null;
      const expVal = parseNum(experienceMonths);
      const experienceMonthsVal = expVal != null && expVal >= 0 ? expVal : null;

      const { error: upsertErr } = await supabaseBrowser
        .from("seller_profiles")
        .upsert(
          {
            id: user.id,
            stage,
            monthly_revenue_range: monthlyRevenueRange,
            sourcing_model: sourcingModel,
            experience_months: experienceMonthsVal,
            risk_tolerance: riskTolerance || null,
            margin_target: marginVal != null ? marginVal : null,
            max_fee_pct: feeVal != null ? feeVal : null,
            goals: goals.trim() || null,
            updated_at: updatedAt,
          },
          { onConflict: "id" }
        );

      if (upsertErr) {
        setError(upsertErr.message);
        setLoading(false);
        return;
      }
      router.replace("/analyze");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <p className="text-white/70 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
      {/* Glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute bottom-1/4 right-0 w-[400px] h-[300px] bg-violet-500/10 rounded-full blur-[100px] pointer-events-none"
        aria-hidden
      />

      {/* Backdrop blur overlay */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-none" aria-hidden />

      <div className="relative flex flex-col items-center justify-center min-h-screen px-4 py-12">
        <div
          className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl p-6 sm:p-8"
          style={{ boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)" }}
        >
          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold text-white">Setup (30s)</h1>
            <p className="text-sm text-white/60 mt-1">
              We use this to tailor insights and recommendations.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl bg-red-500/15 border border-red-400/30 text-red-200 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (requiredOk && !loading) submit(false);
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-white/80 mb-1.5">
                Stage <span className="text-red-400">*</span>
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50"
              >
                <option value="">Select stage</option>
                {STAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/80 mb-1.5">
                Monthly revenue range <span className="text-red-400">*</span>
              </label>
              <select
                value={monthlyRevenueRange}
                onChange={(e) => setMonthlyRevenueRange(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50"
              >
                <option value="">Select range</option>
                {REVENUE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/80 mb-1.5">
                Sourcing model <span className="text-red-400">*</span>
              </label>
              <select
                value={sourcingModel}
                onChange={(e) => setSourcingModel(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50"
              >
                <option value="">Select sourcing model</option>
                {SOURCING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/80 mb-1.5">
                Experience (months) <span className="text-white/40">optional</span>
              </label>
              <input
                type="number"
                min={0}
                placeholder="e.g. 12"
                value={experienceMonths}
                onChange={(e) => setExperienceMonths(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/80 mb-1.5">
                Risk tolerance <span className="text-white/40">optional</span>
              </label>
              <select
                value={riskTolerance}
                onChange={(e) => setRiskTolerance(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50"
              >
                <option value="">Select</option>
                {RISK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">
                  Margin target % <span className="text-white/40">optional</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder="e.g. 25"
                  value={marginTarget}
                  onChange={(e) => setMarginTarget(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">
                  Max fee % <span className="text-white/40">optional</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder="e.g. 15"
                  value={maxFeePct}
                  onChange={(e) => setMaxFeePct(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/80 mb-1.5">
                Goals <span className="text-white/40">optional</span>
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Launch 2 products this quarter, improve margins"
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400/50 disabled:opacity-50 resize-none"
              />
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={loading || !requiredOk}
                className="w-full rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-transparent"
              >
                {loading ? "Saving…" : "Continue to Analyze"}
              </button>
              {!requiredOk && (
                <p className="text-center text-xs text-white/50">
                  Complete stage, revenue range, and sourcing model to continue.
                </p>
              )}
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={loading}
                className="w-full text-sm text-white/60 hover:text-white/90 transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
