"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

const STAGE_OPTIONS = [
  { label: "Just starting", value: "new" },
  { label: "Existing seller", value: "existing" },
  { label: "Scaling brand", value: "scaling" },
];

const SOURCING_OPTIONS = [
  { label: "Private Label (manufactured / Alibaba)", value: "private_label" },
  { label: "Wholesale / Arbitrage", value: "wholesale_arbitrage" },
  { label: "Retail Arbitrage", value: "retail_arbitrage" },
  { label: "Dropshipping", value: "dropshipping" },
  { label: "Not sure yet", value: "not_sure" },
];

const MARKETPLACE_OPTIONS = [
  { label: "US", value: "US" },
  { label: "CA", value: "CA" },
  { label: "Both", value: "Both" },
  { label: "Other", value: "Other" },
];

const PRIMARY_GOAL_OPTIONS = [
  { label: "Find product", value: "find_product" },
  { label: "Grow listing", value: "grow_listing" },
  { label: "Improve profit", value: "improve_profit" },
  { label: "Reduce PPC", value: "reduce_ppc" },
  { label: "Learn the market", value: "learn_market" },
];

const TIMELINE_OPTIONS = [
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "180 days", value: 180 },
];

const CONSTRAINT_OPTIONS = [
  { label: "No patents risk", value: "no_patents_risk" },
  { label: "No seasonal", value: "no_seasonal" },
  { label: "Lightweight", value: "lightweight" },
  { label: "No electronics", value: "no_electronics" },
  { label: "Max fee %", value: "max_fee_pct" },
  { label: "Margin target %", value: "margin_target_pct" },
];

const INTENT_OPTIONS = [
  { label: "ASIN (paste ASIN or Amazon URL)", value: "asin" },
  { label: "Keyword", value: "keyword" },
  { label: "Category idea", value: "category" },
];

function parseNum(val: string): number | null {
  const n = Number.parseFloat(val);
  return Number.isFinite(n) ? n : null;
}

/** Extract ASIN from Amazon URL or raw ASIN string */
function extractAsin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const dpMatch = trimmed.match(/\/dp\/([A-Z0-9]{10})/i) || trimmed.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  if (dpMatch) return dpMatch[1].toUpperCase();
  if (/^[A-Z0-9]{10}$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

const TOTAL_STEPS = 4;

export default function OnboardingPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1
  const [stage, setStage] = useState("");
  const [sourcingModel, setSourcingModel] = useState("");
  const [marketplace, setMarketplace] = useState("");

  // Step 2
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [timelineDays, setTimelineDays] = useState<number | "">("");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [marginTarget, setMarginTarget] = useState("");
  const [maxFeePct, setMaxFeePct] = useState("");

  // Step 3
  const [intentType, setIntentType] = useState<"asin" | "keyword" | "category">("keyword");
  const [intentValue, setIntentValue] = useState("");

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

  const step1Ok = !!stage && !!sourcingModel && !!marketplace;
  const step2Ok = !!primaryGoal && timelineDays !== "" && (
    (!constraints.includes("max_fee_pct") || (parseNum(maxFeePct) != null && parseNum(maxFeePct)! >= 0 && parseNum(maxFeePct)! <= 100)) &&
    (!constraints.includes("margin_target_pct") || (parseNum(marginTarget) != null && parseNum(marginTarget)! >= 0 && parseNum(marginTarget)! <= 100))
  );
  const step3Ok = intentType === "category" ? true : intentValue.trim().length > 0 &&
    (intentType !== "asin" || !!extractAsin(intentValue));

  const saveStep1And2And3ThenGoAnalyze = async (step4Payload: { attempted: boolean; connected?: boolean; error?: string }) => {
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
      const rawMargin = parseNum(marginTarget);
      const rawFee = parseNum(maxFeePct);
      const marginVal = rawMargin != null && rawMargin >= 0 && rawMargin <= 100 ? rawMargin : null;
      const feeVal = rawFee != null && rawFee >= 0 && rawFee <= 100 ? rawFee : null;

      const { error: profileErr } = await supabaseBrowser
        .from("seller_profiles")
        .upsert(
          {
            id: user.id,
            stage,
            sourcing_model: sourcingModel,
            marketplace: marketplace || null,
            primary_goal: primaryGoal || null,
            timeline_days: timelineDays !== "" ? Number(timelineDays) : null,
            constraints: constraints.length ? constraints : null,
            margin_target: marginVal,
            max_fee_pct: feeVal,
            updated_at: updatedAt,
          },
          { onConflict: "id" }
        );
      if (profileErr) {
        setError(profileErr.message);
        setLoading(false);
        return;
      }

      const payload = {
        onboarding_version: "v1_analyze_oauth",
        step1: { stage, sourcing_model: sourcingModel, marketplace },
        step2: { primary_goal: primaryGoal, timeline_days: timelineDays, constraints, margin_target: marginVal, max_fee_pct: feeVal },
        step3: { intent_type: intentType, intent_value: intentValue.trim() },
        step4: step4Payload,
      };
      await supabaseBrowser.from("seller_onboarding_responses").upsert(
        { user_id: user.id, payload_json: payload, created_at: updatedAt },
        { onConflict: "user_id" }
      );

      const keywordParam = intentType === "keyword" && intentValue.trim() ? `?keyword=${encodeURIComponent(intentValue.trim())}` : "";
      const asinParam = intentType === "asin" ? (() => { const a = extractAsin(intentValue); return a ? `?asin=${encodeURIComponent(a)}` : ""; })() : "";
      const query = keywordParam || asinParam || "";
      router.replace(`/analyze${query}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  };

  const handleStep3Next = async () => {
    if (!step3Ok) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: userError } = await supabaseBrowser.auth.getUser();
      if (!user || userError) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }
      const updatedAt = new Date().toISOString();
      const rawMargin = parseNum(marginTarget);
      const rawFee = parseNum(maxFeePct);
      const marginVal = rawMargin != null && rawMargin >= 0 && rawMargin <= 100 ? rawMargin : null;
      const feeVal = rawFee != null && rawFee >= 0 && rawFee <= 100 ? rawFee : null;
      const { error: profileErr } = await supabaseBrowser
        .from("seller_profiles")
        .upsert(
          {
            id: user.id,
            stage,
            sourcing_model: sourcingModel,
            marketplace: marketplace || null,
            primary_goal: primaryGoal || null,
            timeline_days: timelineDays !== "" ? Number(timelineDays) : null,
            constraints: constraints.length ? constraints : null,
            margin_target: marginVal,
            max_fee_pct: feeVal,
            updated_at: updatedAt,
          },
          { onConflict: "id" }
        );
      if (profileErr) {
        setError(profileErr.message);
        setLoading(false);
        return;
      }
      const payload = {
        onboarding_version: "v1_analyze_oauth",
        step1: { stage, sourcing_model: sourcingModel, marketplace },
        step2: { primary_goal: primaryGoal, timeline_days: timelineDays, constraints, margin_target: marginVal, max_fee_pct: feeVal },
        step3: { intent_type: intentType, intent_value: intentValue.trim() },
        step4: { attempted: false },
      };
      await supabaseBrowser.from("seller_onboarding_responses").upsert(
        { user_id: user.id, payload_json: payload, created_at: updatedAt },
        { onConflict: "user_id" }
      );
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setLoading(false);
  };

  const handleStep4Connect = () => {
    window.location.href = "/api/amazon/connect?return_to=onboarding";
  };

  const handleStep4Skip = () => {
    saveStep1And2And3ThenGoAnalyze({ attempted: true, connected: false });
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <p className="text-white/70 text-sm">Loading…</p>
      </div>
    );
  }

  const progressPct = (step / TOTAL_STEPS) * 100;

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none" aria-hidden />
      <div className="absolute bottom-1/4 right-0 w-[400px] h-[300px] bg-violet-500/10 rounded-full blur-[100px] pointer-events-none" aria-hidden />
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-none" aria-hidden />

      <div className="relative flex flex-col items-center justify-center min-h-screen px-4 py-12">
        <div
          className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl p-6 sm:p-8"
          style={{ boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)" }}
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm font-medium text-white/80">Step {step} of {TOTAL_STEPS}</span>
            <Link href="/dashboard" className="text-white/60 hover:text-white/90 text-sm" aria-label="Close">×</Link>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 mb-6">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {error && (
            <div className="mb-4 rounded-xl bg-red-500/15 border border-red-400/30 text-red-200 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Step 1 — Identify */}
          {step === 1 && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold text-white">Identify yourself (fast)</h1>
              <p className="text-sm text-white/60">We use this to tailor insights.</p>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">Stage <span className="text-red-400">*</span></label>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select stage</option>
                  {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">Sourcing model <span className="text-red-400">*</span></label>
                <select
                  value={sourcingModel}
                  onChange={(e) => setSourcingModel(e.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select sourcing model</option>
                  {SOURCING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">Marketplace <span className="text-red-400">*</span></label>
                <select
                  value={marketplace}
                  onChange={(e) => setMarketplace(e.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select marketplace</option>
                  {MARKETPLACE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!step1Ok}
                className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-medium py-3 text-sm transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 2 — Goal + constraints */}
          {step === 2 && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold text-white">Goal & constraints</h1>
              <p className="text-sm text-white/60">Pick one goal and optional constraints.</p>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">Primary goal <span className="text-red-400">*</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {PRIMARY_GOAL_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setPrimaryGoal(o.value)}
                      className={`rounded-xl border px-3 py-2.5 text-sm text-left transition-colors ${
                        primaryGoal === o.value ? "border-primary bg-primary/20 text-white" : "border-white/20 bg-white/5 text-white/90 hover:bg-white/10"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">Timeline <span className="text-red-400">*</span></label>
                <select
                  value={timelineDays}
                  onChange={(e) => setTimelineDays(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select</option>
                  {TIMELINE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">Constraints (optional, multi-select)</label>
                <div className="flex flex-wrap gap-2">
                  {CONSTRAINT_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setConstraints((c) => c.includes(o.value) ? c.filter((x) => x !== o.value) : [...c, o.value])}
                      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        constraints.includes(o.value) ? "border-primary bg-primary/20 text-white" : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {constraints.includes("max_fee_pct") && (
                <div>
                  <label className="block text-xs font-medium text-white/80 mb-1.5">Max fee % <span className="text-red-400">*</span></label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    placeholder="e.g. 15"
                    value={maxFeePct}
                    onChange={(e) => setMaxFeePct(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              )}
              {constraints.includes("margin_target_pct") && (
                <div>
                  <label className="block text-xs font-medium text-white/80 mb-1.5">Margin target % <span className="text-red-400">*</span></label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    placeholder="e.g. 25"
                    value={marginTarget}
                    onChange={(e) => setMarginTarget(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10 flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={!step2Ok}
                  className="flex-1 rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-medium py-3 text-sm transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — What to analyze first */}
          {step === 3 && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold text-white">What do you want to analyze first?</h1>
              <p className="text-sm text-white/60">Choose one — we’ll open Analyze prefilled.</p>
              <div>
                <label className="block text-xs font-medium text-white/80 mb-1.5">Type</label>
                <div className="space-y-2">
                  {INTENT_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setIntentType(o.value as "asin" | "keyword" | "category")}
                      className={`w-full rounded-xl border px-4 py-2.5 text-sm text-left transition-colors ${
                        intentType === o.value ? "border-primary bg-primary/20 text-white" : "border-white/20 bg-white/5 text-white/90 hover:bg-white/10"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {intentType !== "category" && (
                <div>
                  <label className="block text-xs font-medium text-white/80 mb-1.5">
                    {intentType === "asin" ? "ASIN or Amazon URL" : "Keyword"}
                  </label>
                  <input
                    type="text"
                    placeholder={intentType === "asin" ? "Paste ASIN or amazon.com/dp/..." : "e.g. throw blanket for couch"}
                    value={intentValue}
                    onChange={(e) => setIntentValue(e.target.value)}
                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10 flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={handleStep3Next}
                  disabled={!step3Ok}
                  className="flex-1 rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-medium py-3 text-sm transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Connect Amazon (recommended, non-blocking) */}
          {step === 4 && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold text-white">Connect Amazon (Recommended)</h1>
              <ul className="space-y-2 text-sm text-white/90">
                <li>• More accurate fee + margin estimates (uses your real fee structures & settings)</li>
                <li>• Better market and revenue signals (improves our predictions over time)</li>
                <li>• Unlock upcoming features (PPC insights, true profitability, portfolio tracking)</li>
                <li>• Read-only access. You control access. Disconnect anytime.</li>
              </ul>
              <p className="text-xs text-white/50">
                Connecting helps us learn fee/revenue/search-volume relationships over time so our estimates get closer to what tools like H10 show — without you manually entering everything.
              </p>
              <div className="flex flex-col gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleStep4Connect}
                  className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-medium py-3 text-sm transition-colors hover:opacity-90 flex items-center justify-center gap-2"
                >
                  Connect Amazon <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleStep4Skip}
                  disabled={loading}
                  className="w-full text-sm text-white/60 hover:text-white/90 transition-colors disabled:opacity-50"
                >
                  Skip for now
                </button>
              </div>
              <p className="text-xs text-center text-white/40">Analyze still works without connecting — lower accuracy.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
