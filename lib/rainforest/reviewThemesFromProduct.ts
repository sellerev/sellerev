export interface ProductReviewSignals {
  customers_say?: {
    themes?: Array<{ label: string; sentiment: "positive" | "negative" | "mixed"; mentions?: number }>;
    snippets?: Array<{ text: string; sentiment: "positive" | "negative" | "mixed" }>;
  } | null;
  summarization_attributes?: Record<string, { rating: number; count?: number }> | null;
  top_reviews?: Array<{
    rating: number;
    title: string | null;
    text: string;
    verified_purchase: boolean | null;
    date: string | null;
  }> | null;
  rating_breakdown?: Record<string, { percentage?: number; count?: number }> | null;
}

export type ReviewThemeSource =
  | "customers_say"
  | "summarization_attributes"
  | "top_reviews"
  | "rating_breakdown"
  | "reviews";

export interface ProductReviewThemes {
  top_complaints: Array<{ theme: string; evidence?: string }>;
  top_praise: Array<{ theme: string; evidence?: string }>;
  source_used: ReviewThemeSource | null;
}

/**
 * Deterministic, lightweight extraction of complaint/praise themes
 * from Rainforest product-level review signals.
 *
 * Priority:
 * 1) customers_say
 * 2) summarization_attributes
 * 3) top_reviews
 * 4) rating_breakdown
 */
export function buildReviewThemesFromProduct(
  signals: ProductReviewSignals
): ProductReviewThemes {
  // 1) customers_say (strongest signal when present)
  const cs = signals.customers_say;
  if (cs && Array.isArray(cs.themes) && cs.themes.length > 0) {
    const complaints: Array<{ theme: string; evidence?: string }> = [];
    const praise: Array<{ theme: string; evidence?: string }> = [];

    for (const theme of cs.themes) {
      const label = theme.label?.trim();
      if (!label) continue;

      const sentiment = theme.sentiment === "positive" ? "positive" : "negative";
      const evidence =
        typeof theme.mentions === "number" && theme.mentions > 0
          ? `${theme.mentions} mentions`
          : undefined;

      if (sentiment === "negative") {
        complaints.push({ theme: label, evidence });
      } else {
        praise.push({ theme: label, evidence });
      }
    }

    return {
      top_complaints: complaints.slice(0, 3),
      top_praise: praise.slice(0, 3),
      source_used: "customers_say",
    };
  }

  // 2) summarization_attributes (low-rated = complaints, high-rated = praise)
  const sa = signals.summarization_attributes;
  if (sa && typeof sa === "object" && Object.keys(sa).length > 0) {
    const complaints: Array<{ theme: string; evidence?: string }> = [];
    const praise: Array<{ theme: string; evidence?: string }> = [];

    const entries = Object.entries(sa);
    for (const [name, value] of entries) {
      if (!value || typeof value.rating !== "number") continue;
      const rating = value.rating;
      const count = typeof value.count === "number" ? value.count : undefined;

      const label = name.replace(/_/g, " ");
      const evidenceParts: string[] = [];
      evidenceParts.push(`${rating.toFixed(1)}★`);
      if (count && count > 0) evidenceParts.push(`${count} votes`);
      const evidence = evidenceParts.join(" · ");

      if (rating <= 3.4) {
        complaints.push({ theme: label, evidence });
      } else if (rating >= 4.2) {
        praise.push({ theme: label, evidence });
      }
    }

    return {
      top_complaints: complaints.slice(0, 3),
      top_praise: praise.slice(0, 3),
      source_used: "summarization_attributes",
    };
  }

  // 3) top_reviews (fallback when PDP shows representative reviews)
  const tr = signals.top_reviews;
  if (tr && Array.isArray(tr) && tr.length > 0) {
    const complaints: Array<{ theme: string; evidence?: string }> = [];
    const praise: Array<{ theme: string; evidence?: string }> = [];

    const reviews = tr.slice(0, 10); // keep it cheap

    for (const r of reviews) {
      const text = (r.text || "").trim();
      if (!text) continue;
      const isComplaint = typeof r.rating === "number" && r.rating <= 3;
      const isPraise = typeof r.rating === "number" && r.rating >= 4;
      const snippet =
        text.length > 160 ? text.substring(0, 160).trim() + "…" : text;

      const theme =
        (r.title && r.title.trim()) ||
        (isComplaint ? "Negative feedback" : isPraise ? "Positive feedback" : "Mixed feedback");

      if (isComplaint) {
        complaints.push({ theme, evidence: snippet });
      } else if (isPraise) {
        praise.push({ theme, evidence: snippet });
      }
    }

    return {
      top_complaints: complaints.slice(0, 3),
      top_praise: praise.slice(0, 3),
      source_used: "top_reviews",
    };
  }

  // 4) rating_breakdown (percentage-based summary only)
  const rb = signals.rating_breakdown;
  if (rb && typeof rb === "object" && Object.keys(rb).length > 0) {
    // Expect keys like "5_star", "4_star", etc. but be tolerant.
    const getBucket = (key: string) => rb[key] || rb[key.replace(" ", "_")] || rb[key.replace("_", " ")];

    const one = getBucket("1_star") || getBucket("1");
    const two = getBucket("2_star") || getBucket("2");
    const four = getBucket("4_star") || getBucket("4");
    const five = getBucket("5_star") || getBucket("5");

    const pct = (v?: { percentage?: number; count?: number }) =>
      typeof v?.percentage === "number" ? v.percentage : undefined;

    const complaints: Array<{ theme: string; evidence?: string }> = [];
    const praise: Array<{ theme: string; evidence?: string }> = [];

    const lowPct = [pct(one), pct(two)].filter(
      (v): v is number => typeof v === "number"
    );
    const highPct = [pct(four), pct(five)].filter(
      (v): v is number => typeof v === "number"
    );

    if (lowPct.length) {
      const avgLow = lowPct.reduce((a, b) => a + b, 0) / lowPct.length;
      complaints.push({
        theme: "Low-star complaints",
        evidence: `${avgLow.toFixed(1)}% of reviews are 1–2★`,
      });
    }

    if (highPct.length) {
      const avgHigh = highPct.reduce((a, b) => a + b, 0) / highPct.length;
      praise.push({
        theme: "High-star praise",
        evidence: `${avgHigh.toFixed(1)}% of reviews are 4–5★`,
      });
    }

    return {
      top_complaints: complaints,
      top_praise: praise,
      source_used: "rating_breakdown",
    };
  }

  // No usable signals on the product page
  return {
    top_complaints: [],
    top_praise: [],
    source_used: null,
  };
}

