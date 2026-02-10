"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

const STAGES = ["just_starting", "existing_seller", "scaling_brand"] as const;
const SOURCING_MODELS = ["private_label", "wholesale_arbitrage", "retail_arbitrage", "dropshipping", "not_sure"] as const;
const MARKETPLACES = ["US", "CA", "UK", "EU", "AU", "OTHER"] as const;
const BUSINESS_TYPES = ["solo", "partnership", "agency", "brand_team"] as const;
const PRIMARY_GOALS = ["find_product", "grow_listing", "improve_profit", "reduce_ppc", "learn_market"] as const;
const CURRENT_FOCUS_OPTIONS = ["new_product_research", "listing_optimization", "ppc_optimization", "ops_and_inventory", "account_health"] as const;
const CONSTRAINTS_OPTIONS = ["avoid_patent_risk", "non_seasonal_only", "lightweight_only", "no_electronics", "no_hazmat", "no_meltable", "no_breakable", "no_brand_dominance", "avoid_gated_categories"] as const;
const MONTHLY_REVENUE_OPTIONS = ["pre_revenue", "<5k", "5-10k", "10-50k", "50-100k", "100k+"] as const;
const TOLERANCE_OPTIONS = ["low", "medium", "high"] as const;
const BRAND_STRATEGY_OPTIONS = ["premium_brand", "value_brand", "niche_specialist", "not_sure"] as const;
const SHIPS_FROM_OPTIONS = ["china", "usa", "canada", "other"] as const;
const SHIPPING_MODE_OPTIONS = ["air", "sea", "domestic_only", "not_sure"] as const;
const MOQ_OPTIONS = ["low", "medium", "high"] as const;

type ProfileRow = {
  id?: string;
  stage?: string | null;
  sourcing_model?: string | null;
  marketplaces?: string[] | null;
  marketplace?: string | null;
  business_type?: string | null;
  experience_months?: number | null;
  primary_goal?: string | null;
  timeline_days?: number | null;
  success_definition?: string | null;
  current_focus?: string | null;
  constraints?: string[] | null;
  notes_constraints?: string | null;
  target_price_min?: number | null;
  target_price_max?: number | null;
  margin_target?: number | null;
  margin_target_pct?: number | null;
  max_fee_pct?: number | null;
  target_net_profit_per_unit?: number | null;
  monthly_revenue_range?: string | null;
  review_barrier_tolerance?: string | null;
  competition_tolerance?: string | null;
  ad_spend_tolerance?: string | null;
  brand_strategy?: string | null;
  uses_fba?: boolean | null;
  ships_from?: string | null;
  shipping_mode_preference?: string | null;
  lead_time_days?: number | null;
  moq_tolerance?: string | null;
  amazon_connected?: boolean | null;
  amazon_marketplaces_connected?: string[] | null;
  amazon_connected_at?: string | null;
  amazon_last_sync_at?: string | null;
  updated_at?: string | null;
};

export default function BusinessPageClient() {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [amazonConnection, setAmazonConnection] = useState<{ status: string; updated_at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabaseBrowser
        .from("seller_profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      const { data: connData } = await supabaseBrowser
        .from("amazon_connections")
        .select("status, updated_at")
        .eq("user_id", user.id)
        .eq("status", "connected")
        .single();

      setAmazonConnection(connData || null);

      let profileToUse = profileData;
      if (!profileData && user) {
        await supabaseBrowser.from("seller_profiles").upsert({ id: user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
        const { data: refetched } = await supabaseBrowser.from("seller_profiles").select("*").eq("id", user.id).single();
        profileToUse = refetched ?? null;
        setProfile(profileToUse);
      } else {
        setProfile(profileData || null);
      }

      const data = profileToUse || {};
      {
        const markets = (data.marketplaces as string[] | null) ?? (data.marketplace ? [data.marketplace] : []);
        setForm({
          stage: (data as ProfileRow).stage ?? "",
          sourcing_model: (data as ProfileRow).sourcing_model ?? "not_sure",
          marketplaces: markets,
          business_type: (data as ProfileRow).business_type ?? "",
          experience_months: (data as ProfileRow).experience_months ?? "",
          primary_goal: (data as ProfileRow).primary_goal ?? "",
          timeline_days: (data as ProfileRow).timeline_days ?? "",
          success_definition: (data as ProfileRow).success_definition ?? "",
          current_focus: (data as ProfileRow).current_focus ?? "",
          constraints: ((data as ProfileRow).constraints as string[] | null) ?? [],
          notes_constraints: (data as ProfileRow).notes_constraints ?? "",
          target_price_min: (data as ProfileRow).target_price_min ?? "",
          target_price_max: (data as ProfileRow).target_price_max ?? "",
          margin_target_pct: (data as ProfileRow).margin_target_pct ?? (data as ProfileRow).margin_target ?? "",
          max_fee_pct: (data as ProfileRow).max_fee_pct ?? "",
          target_net_profit_per_unit: (data as ProfileRow).target_net_profit_per_unit ?? "",
          monthly_revenue_range: (data as ProfileRow).monthly_revenue_range ?? "",
          review_barrier_tolerance: (data as ProfileRow).review_barrier_tolerance ?? "",
          competition_tolerance: (data as ProfileRow).competition_tolerance ?? "",
          ad_spend_tolerance: (data as ProfileRow).ad_spend_tolerance ?? "",
          brand_strategy: (data as ProfileRow).brand_strategy ?? "",
          uses_fba: (data as ProfileRow).uses_fba ?? true,
          ships_from: (data as ProfileRow).ships_from ?? "",
          shipping_mode_preference: (data as ProfileRow).shipping_mode_preference ?? "",
          lead_time_days: (data as ProfileRow).lead_time_days ?? "",
          moq_tolerance: (data as ProfileRow).moq_tolerance ?? "",
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  const update = (key: string, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));
  const toggleMarketplace = (m: string) => {
    const arr = (form.marketplaces as string[]) ?? [];
    const next = arr.includes(m) ? arr.filter((x) => x !== m) : [...arr, m];
    update("marketplaces", next);
  };
  const toggleConstraint = (c: string) => {
    const arr = (form.constraints as string[]) ?? [];
    const next = arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c];
    update("constraints", next);
  };

  const validate = (): string | null => {
    if (!form.stage) return "Stage is required.";
    if (!form.sourcing_model) return "Sourcing model is required.";
    const markets = (form.marketplaces as string[]) ?? [];
    if (markets.length < 1) return "Select at least one marketplace.";
    if (!form.primary_goal) return "Primary goal is required.";
    const days = form.timeline_days === "" ? null : Number(form.timeline_days);
    if (days == null || days < 0) return "Timeline (days) is required and must be ≥ 0.";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setMessage({ type: "error", text: err });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) {
        setMessage({ type: "error", text: "Not authenticated." });
        setSaving(false);
        return;
      }

      const payload: Record<string, unknown> = {
        id: user.id,
        stage: form.stage || null,
        sourcing_model: form.sourcing_model || null,
        marketplaces: Array.isArray(form.marketplaces) ? form.marketplaces : null,
        business_type: form.business_type || null,
        experience_months: form.experience_months === "" ? null : Number(form.experience_months),
        primary_goal: form.primary_goal || null,
        timeline_days: form.timeline_days === "" ? null : Number(form.timeline_days),
        success_definition: (form.success_definition as string)?.trim() || null,
        current_focus: form.current_focus || null,
        constraints: Array.isArray(form.constraints) && (form.constraints as string[]).length ? form.constraints : null,
        notes_constraints: (form.notes_constraints as string)?.trim() || null,
        target_price_min: form.target_price_min === "" ? null : Number(form.target_price_min),
        target_price_max: form.target_price_max === "" ? null : Number(form.target_price_max),
        margin_target_pct: form.margin_target_pct === "" ? null : Number(form.margin_target_pct),
        max_fee_pct: form.max_fee_pct === "" ? null : Number(form.max_fee_pct),
        target_net_profit_per_unit: form.target_net_profit_per_unit === "" ? null : Number(form.target_net_profit_per_unit),
        monthly_revenue_range: form.monthly_revenue_range || null,
        review_barrier_tolerance: form.review_barrier_tolerance || null,
        competition_tolerance: form.competition_tolerance || null,
        ad_spend_tolerance: form.ad_spend_tolerance || null,
        brand_strategy: form.brand_strategy || null,
        uses_fba: form.uses_fba ?? true,
        ships_from: form.ships_from || null,
        shipping_mode_preference: form.shipping_mode_preference || null,
        lead_time_days: form.lead_time_days === "" ? null : Number(form.lead_time_days),
        moq_tolerance: form.moq_tolerance || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabaseBrowser.from("seller_profiles").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      setProfile({ ...profile, ...payload } as ProfileRow);
      setMessage({ type: "success", text: "Saved. The AI will use this context for recommendations." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  };

  const connected = profile?.amazon_connected ?? !!amazonConnection;
  const lastSync = profile?.amazon_connected_at ?? amazonConnection?.updated_at;

  if (loading) {
    return (
      <div className="min-h-full w-full flex flex-col" style={{ backgroundColor: "#f3f4f6" }}>
        <div className="flex-1 min-h-0 m-2 rounded-2xl border border-gray-200 bg-white shadow-sm flex items-center justify-center">
          <p className="text-gray-500">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex flex-col" style={{ backgroundColor: "#f3f4f6" }}>
      <div className="flex-1 min-h-0 m-2 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Business</h1>
          <p className="text-gray-600 mb-6">
            Single source of truth for AI personalization. Recommendations and Analyze outputs are tailored to this context.
          </p>

          {/* Section G — Amazon connection (top block) */}
          <section className="mb-8 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Amazon Account</h2>
            {connected ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Connected</span>
                {lastSync && (
                  <span className="text-xs text-gray-500">Last sync: {new Date(lastSync).toLocaleDateString()}</span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Not connected</span>
                <Link
                  href="/connect-amazon"
                  className="inline-flex items-center rounded-xl bg-gradient-to-r from-primary to-primary-glow px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Connect Amazon
                </Link>
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">Optional but recommended for higher accuracy and fee estimates.</p>
          </section>

          {/* Section A — Seller Identity */}
          <section className="mb-8 pb-8 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Seller Identity</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stage <span className="text-red-500">*</span></label>
                <select
                  value={String(form.stage ?? "")}
                  onChange={(e) => update("stage", e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sourcing model <span className="text-red-500">*</span></label>
                <select
                  value={String(form.sourcing_model ?? "not_sure")}
                  onChange={(e) => update("sourcing_model", e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                >
                  {SOURCING_MODELS.map((s) => (
                    <option key={s} value={s}>{s === "wholesale_arbitrage" ? "wholesale" : s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Marketplaces <span className="text-red-500">*</span> (at least one)</label>
                <div className="flex flex-wrap gap-2">
                  {MARKETPLACES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMarketplace(m)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${(form.marketplaces as string[])?.includes(m) ? "bg-primary text-primary-foreground border-primary" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business type</label>
                <select
                  value={String(form.business_type ?? "")}
                  onChange={(e) => update("business_type", e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select</option>
                  {BUSINESS_TYPES.map((b) => (
                    <option key={b} value={b}>{b.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Experience (months)</label>
                <input
                  type="number"
                  min={0}
                  value={form.experience_months === "" ? "" : form.experience_months}
                  onChange={(e) => update("experience_months", e.target.value === "" ? "" : e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. 12"
                />
              </div>
            </div>
          </section>

          {/* Section B — Goals */}
          <section className="mb-8 pb-8 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Goals</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary goal <span className="text-red-500">*</span></label>
                <select
                  value={String(form.primary_goal ?? "")}
                  onChange={(e) => update("primary_goal", e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select</option>
                  {PRIMARY_GOALS.map((g) => (
                    <option key={g} value={g}>{g.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Timeline (days) <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min={0}
                  value={form.timeline_days === "" ? "" : form.timeline_days}
                  onChange={(e) => update("timeline_days", e.target.value === "" ? "" : e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                  placeholder="e.g. 180"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Success definition</label>
                <input
                  type="text"
                  value={String(form.success_definition ?? "")}
                  onChange={(e) => update("success_definition", e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                  placeholder='e.g. "$10k/mo profit in 6 months", "launch 2 SKUs"'
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current focus</label>
                <select
                  value={String(form.current_focus ?? "")}
                  onChange={(e) => update("current_focus", e.target.value)}
                  className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select</option>
                  {CURRENT_FOCUS_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Section C — Constraints */}
          <section className="mb-8 pb-8 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Constraints & Rules</h2>
            <div className="space-y-2 mb-4">
              {CONSTRAINTS_OPTIONS.map((c) => (
                <label key={c} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(form.constraints as string[])?.includes(c) ?? false}
                    onChange={() => toggleConstraint(c)}
                    className="rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-700">{c.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (constraints)</label>
              <textarea
                value={String(form.notes_constraints ?? "")}
                onChange={(e) => update("notes_constraints", e.target.value)}
                rows={2}
                className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50"
                placeholder="Any other hard guardrails"
              />
            </div>
          </section>

          {/* Section D — Unit Economics */}
          <section className="mb-8 pb-8 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Unit Economics Targets</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target price min</label>
                <input type="number" step="0.01" min={0} value={form.target_price_min === "" ? "" : form.target_price_min} onChange={(e) => update("target_price_min", e.target.value === "" ? "" : e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target price max</label>
                <input type="number" step="0.01" min={0} value={form.target_price_max === "" ? "" : form.target_price_max} onChange={(e) => update("target_price_max", e.target.value === "" ? "" : e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Margin target %</label>
                <input type="number" step="0.01" min={0} max={100} value={form.margin_target_pct === "" ? "" : form.margin_target_pct} onChange={(e) => update("margin_target_pct", e.target.value === "" ? "" : e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max fee %</label>
                <input type="number" step="0.01" min={0} max={100} value={form.max_fee_pct === "" ? "" : form.max_fee_pct} onChange={(e) => update("max_fee_pct", e.target.value === "" ? "" : e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target net profit per unit</label>
                <input type="number" step="0.01" value={form.target_net_profit_per_unit === "" ? "" : form.target_net_profit_per_unit} onChange={(e) => update("target_net_profit_per_unit", e.target.value === "" ? "" : e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monthly revenue range</label>
                <select value={String(form.monthly_revenue_range ?? "")} onChange={(e) => update("monthly_revenue_range", e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50">
                  <option value="">Select</option>
                  {MONTHLY_REVENUE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Section E — Product Research Preferences */}
          <section className="mb-8 pb-8 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Product Research Preferences</h2>
            <div className="space-y-4 max-w-md">
              {(["review_barrier_tolerance", "competition_tolerance", "ad_spend_tolerance"] as const).map((key) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{key.replace(/_/g, " ")}</label>
                  <select value={String(form[key] ?? "")} onChange={(e) => update(key, e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50">
                    <option value="">Select</option>
                    {TOLERANCE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Brand strategy</label>
                <select value={String(form.brand_strategy ?? "")} onChange={(e) => update("brand_strategy", e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50">
                  <option value="">Select</option>
                  {BRAND_STRATEGY_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Section F — Operating Reality */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Operating Reality</h2>
            <div className="space-y-4 max-w-md">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.uses_fba} onChange={(e) => update("uses_fba", e.target.checked)} className="rounded border-gray-300 text-primary focus:ring-primary" />
                <span className="text-sm font-medium text-gray-700">Uses FBA</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ships from</label>
                <select value={String(form.ships_from ?? "")} onChange={(e) => update("ships_from", e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50">
                  <option value="">Select</option>
                  {SHIPS_FROM_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shipping mode preference</label>
                <select value={String(form.shipping_mode_preference ?? "")} onChange={(e) => update("shipping_mode_preference", e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50">
                  <option value="">Select</option>
                  {SHIPPING_MODE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lead time (days)</label>
                <input type="number" min={0} value={form.lead_time_days === "" ? "" : form.lead_time_days} onChange={(e) => update("lead_time_days", e.target.value === "" ? "" : e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">MOQ tolerance</label>
                <select value={String(form.moq_tolerance ?? "")} onChange={(e) => update("moq_tolerance", e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-primary/50">
                  <option value="">Select</option>
                  {MOQ_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {message && (
            <p className={`text-sm mb-4 ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
              {message.text}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-primary to-primary-glow px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
