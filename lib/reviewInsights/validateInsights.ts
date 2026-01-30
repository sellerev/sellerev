/**
 * Hard-validate review insights so all response fields are primitives/strings.
 * Prevents [object Object] in UI and API responses.
 */

export interface ValidatedThemeItem {
  theme: string;
  frequency_pct?: number;
  examples: string[];
  opportunity: string;
  cost_impact: "low" | "medium" | "high";
  impact: "high" | "medium" | "low";
}

export interface ValidatedInsightsPayload {
  star_split: Record<string, number> | null;
  top_complaints: ValidatedThemeItem[];
  top_praise: ValidatedThemeItem[];
  summary: string;
  source: "type_product" | "type_reviews_fallback" | "mixed";
  analyzed_reviews_count: number;
}

function toStringSafe(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function toNumberSafe(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function costImpactSafe(v: unknown): "low" | "medium" | "high" {
  const s = toStringSafe(v).toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return "medium";
}

function impactSafe(v: unknown): "high" | "medium" | "low" {
  const s = toStringSafe(v).toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function sourceSafe(v: unknown): "type_product" | "type_reviews_fallback" | "mixed" {
  const s = toStringSafe(v);
  if (s === "type_product" || s === "type_reviews_fallback" || s === "mixed") return s;
  return "type_product";
}

function validateThemeItem(raw: unknown): ValidatedThemeItem {
  if (!raw || typeof raw !== "object") {
    return {
      theme: "",
      examples: [],
      opportunity: "",
      cost_impact: "medium",
      impact: "medium",
    };
  }
  const o = raw as Record<string, unknown>;
  const examples = Array.isArray(o.examples)
    ? (o.examples as unknown[]).map((e) => toStringSafe(e)).filter(Boolean)
    : [];
  return {
    theme: toStringSafe(o.theme) || "Review theme",
    frequency_pct: typeof o.frequency_pct === "number" ? o.frequency_pct : undefined,
    examples,
    opportunity: toStringSafe(o.opportunity),
    cost_impact: costImpactSafe(o.cost_impact),
    impact: impactSafe(o.impact),
  };
}

/**
 * Validate raw OpenAI or dossier-derived insights into a safe payload (primitives/strings only).
 */
export function validateInsightsPayload(raw: unknown): ValidatedInsightsPayload {
  if (!raw || typeof raw !== "object") {
    return {
      star_split: null,
      top_complaints: [],
      top_praise: [],
      summary: "",
      source: "type_product",
      analyzed_reviews_count: 0,
    };
  }
  const o = raw as Record<string, unknown>;
  const topComplaints = Array.isArray(o.top_complaints)
    ? (o.top_complaints as unknown[]).map(validateThemeItem)
    : [];
  const topPraise = Array.isArray(o.top_praise)
    ? (o.top_praise as unknown[]).map(validateThemeItem)
    : [];
  let starSplit: Record<string, number> | null = null;
  if (o.star_split && typeof o.star_split === "object" && !Array.isArray(o.star_split)) {
    starSplit = {};
    for (const [k, v] of Object.entries(o.star_split)) {
      const n = toNumberSafe(v);
      if (k && typeof k === "string") starSplit[k] = n;
    }
  }
  return {
    star_split: starSplit,
    top_complaints: topComplaints,
    top_praise: topPraise,
    summary: toStringSafe(o.summary),
    source: sourceSafe(o.source),
    analyzed_reviews_count: Math.max(0, toNumberSafe(o.analyzed_reviews_count)),
  };
}

/**
 * Ensure a string[] or mixed array is rendered as string[] (no [object Object]).
 */
export function validateDisplayStrings(items: unknown[]): string[] {
  return items.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "theme" in item) {
      const t = (item as { theme?: string; snippet?: string }).theme;
      const s = (item as { snippet?: string }).snippet;
      return typeof t === "string" ? (s ? `${t} — ${s}` : t) : String(item);
    }
    return String(item);
  }).filter(Boolean);
}
