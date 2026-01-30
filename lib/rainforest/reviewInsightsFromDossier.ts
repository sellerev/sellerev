/**
 * Build review insights (top complaints + top praise) from a single Rainforest
 * type=product dossier only. No type=reviews calls.
 *
 * Priority: customers_say → top_reviews by star → rating_breakdown fallback.
 * Never return "no complaints"; use rating_breakdown + limitation text when no
 * low-star top_reviews are present.
 */

import type { ProductDossier } from "./productDossier";

export type ReviewInsightItem =
  | string
  | { theme: string; snippet?: string; stars?: number };

export type ComplaintSourceUsed =
  | "negative_top_reviews"
  | "mixed_top_reviews"
  | "customers_say"
  | "rating_breakdown_only";

export interface ReviewInsightsMeta {
  complaint_source_used: ComplaintSourceUsed;
  overall_rating: number | null;
  rating_breakdown_present: boolean;
  top_reviews_count: number;
  negative_reviews_count: number;
  mixed_reviews_count: number;
  positive_reviews_count: number;
}

export interface ReviewInsightsFromDossier {
  top_complaints: ReviewInsightItem[];
  top_praise: ReviewInsightItem[];
  meta: ReviewInsightsMeta;
}

const STOPWORDS = new Set(
  "a an the and or but in on at to for of with by from as is was are were been be have has had do does did will would could should may might must can".split(
    " "
  )
);

function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function firstSentence(text: string, maxWords = 10): string {
  const t = stripHtml(text).trim();
  const match = t.match(/^(.*?[.!?])\s+/);
  const base = match ? match[1].trim() : t;
  const words = base.split(/\s+/).slice(0, maxWords);
  return words.join(" ");
}

function snippet(body: string, maxLen = 140): string {
  const s = stripHtml(body).replace(/\s+/g, " ").trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen).trim() + "…";
}

function themeFromReview(
  r: { rating?: number; title?: string; body?: string }
): string {
  const title = (r.title || "").trim();
  if (title) {
    const words = title.split(/\s+/).slice(0, 10);
    return words.join(" ");
  }
  const body = (r.body || "").trim();
  if (body) return firstSentence(body, 10);
  return r.rating != null && r.rating <= 2
    ? "Negative feedback"
    : r.rating === 3
      ? "Mixed feedback"
      : "Positive feedback";
}

function getRatingBreakdownPct(
  rb: Record<string, { percentage?: number; count?: number }> | null | undefined,
  star: number
): number | undefined {
  if (!rb || typeof rb !== "object") return undefined;
  const key = `${star}_star`;
  const v = rb[key] ?? rb[String(star)];
  return typeof v?.percentage === "number" ? v.percentage : undefined;
}

/**
 * Build review insights from a product dossier only (one Rainforest type=product call).
 */
export function buildReviewInsightsFromProductDossier(
  dossier: ProductDossier
): ReviewInsightsFromDossier {
  const product = dossier.product ?? {};
  const reviewMaterial = dossier.review_material ?? { top_reviews: [] };
  const topReviews = reviewMaterial.top_reviews ?? [];
  const customersSay = reviewMaterial.customers_say ?? [];
  const ratingBreakdown = product.rating_breakdown ?? null;
  const overallRating =
    typeof product.rating === "number" ? product.rating : null;

  const negativeReviews = topReviews.filter(
    (r) => typeof r.rating === "number" && r.rating <= 2
  );
  const mixedReviews = topReviews.filter(
    (r) => typeof r.rating === "number" && r.rating === 3
  );
  const positiveReviews = topReviews.filter(
    (r) => typeof r.rating === "number" && r.rating >= 4
  );

  const meta: ReviewInsightsMeta = {
    complaint_source_used: "rating_breakdown_only",
    overall_rating: overallRating,
    rating_breakdown_present: !!(
      ratingBreakdown &&
      typeof ratingBreakdown === "object" &&
      Object.keys(ratingBreakdown).length > 0
    ),
    top_reviews_count: topReviews.length,
    negative_reviews_count: negativeReviews.length,
    mixed_reviews_count: mixedReviews.length,
    positive_reviews_count: positiveReviews.length,
  };

  const top_complaints: ReviewInsightItem[] = [];
  const top_praise: ReviewInsightItem[] = [];
  const seenComplaintThemes = new Set<string>();
  const seenPraiseThemes = new Set<string>();

  const addComplaint = (item: ReviewInsightItem, source: ComplaintSourceUsed) => {
    if (top_complaints.length >= 3) return;
    const theme =
      typeof item === "string" ? item : (item as { theme: string }).theme;
    const norm = normalizeForDedup(theme);
    if (seenComplaintThemes.has(norm)) return;
    seenComplaintThemes.add(norm);
    top_complaints.push(item);
    meta.complaint_source_used = source;
  };

  const addPraise = (item: ReviewInsightItem) => {
    if (top_praise.length >= 3) return;
    const theme =
      typeof item === "string" ? item : (item as { theme: string }).theme;
    const norm = normalizeForDedup(theme);
    if (seenPraiseThemes.has(norm)) return;
    seenPraiseThemes.add(norm);
    top_praise.push(item);
  };

  // A) customers_say: complaints (Negative/Mixed) and praise (Positive)
  const complaintsFromCustomersSay = customersSay.filter(
    (c) =>
      (c.value || "").toString().toLowerCase().includes("negative") ||
      (c.value || "").toString().toLowerCase().includes("mixed")
  );
  const praiseFromCustomersSay = customersSay.filter((c) =>
    (c.value || "").toString().toLowerCase().includes("positive")
  );

  if (complaintsFromCustomersSay.length > 0 || praiseFromCustomersSay.length > 0) {
    for (const c of complaintsFromCustomersSay.slice(0, 3)) {
      const theme = (c.name || "").trim() || "Customer concern";
      addComplaint({ theme, stars: undefined }, "customers_say");
    }
    for (const c of praiseFromCustomersSay.slice(0, 3)) {
      addPraise({ theme: (c.name || "").trim() || "Positive feedback" });
    }
    // Add 1–2 snippets from top_reviews when possible (match by sentiment)
    for (const r of negativeReviews.slice(0, 2)) {
      if (top_complaints.length >= 3) break;
      const theme = themeFromReview(r);
      const snip = r.body ? snippet(r.body) : undefined;
      addComplaint(
        { theme, snippet: snip, stars: r.rating },
        "customers_say"
      );
    }
    for (const r of positiveReviews.slice(0, 2)) {
      if (top_praise.length >= 3) break;
      const theme = themeFromReview(r);
      const snip = r.body ? snippet(r.body) : undefined;
      addPraise({ theme, snippet: snip, stars: r.rating });
    }
  }

  // B) Always parse top_reviews for complaints (priority: negative → mixed → breakdown)
  if (top_complaints.length === 0) {
    if (negativeReviews.length > 0) {
      for (const r of negativeReviews.slice(0, 3)) {
        addComplaint(
          {
            theme: themeFromReview(r),
            snippet: r.body ? snippet(r.body) : undefined,
            stars: r.rating,
          },
          "negative_top_reviews"
        );
      }
    } else if (mixedReviews.length > 0) {
      for (const r of mixedReviews.slice(0, 2)) {
        addComplaint(
          {
            theme: themeFromReview(r) + " (mixed feedback)",
            snippet: r.body ? snippet(r.body) : undefined,
            stars: r.rating,
          },
          "mixed_top_reviews"
        );
      }
    } else if (topReviews.length > 0) {
      // No rating <= 3 in top_reviews: scan for negative language (broke, cheap, flimsy, etc.)
      const negativeKeywords = [
        "broke", "broken", "cheap", "flimsy", "poor quality", "defective", "damaged",
        "doesn't work", "doesnt work", "stopped working", "waste", "disappointed",
        "return", "refund", "too small", "too large", "uncomfortable", "unreliable",
        "missing", "wrong", "not as described", "not worth", "horrible", "terrible",
      ];
      for (const r of topReviews) {
        if (top_complaints.length >= 3) break;
        const body = (r.body || "").toLowerCase();
        const title = (r.title || "").toLowerCase();
        const text = body + " " + title;
        for (const kw of negativeKeywords) {
          if (text.includes(kw)) {
            const theme = themeFromReview(r) + " (from review text)";
            const snip = r.body ? snippet(r.body) : undefined;
            addComplaint({ theme, snippet: snip, stars: r.rating }, "negative_top_reviews");
            break;
          }
        }
      }
      // If still no complaints after negative-language scan, fall through to rating_breakdown below.
    }
    if (top_complaints.length === 0) {
      // No top_reviews or no signal: use rating_breakdown + honest limitation
      const p1 = getRatingBreakdownPct(ratingBreakdown, 1);
      const p2 = getRatingBreakdownPct(ratingBreakdown, 2);
      const p3 = getRatingBreakdownPct(ratingBreakdown, 3);
      const parts: string[] = [];
      if (p1 != null) parts.push(`1★: ${p1}%`);
      if (p2 != null) parts.push(`2★: ${p2}%`);
      if (p3 != null) parts.push(`3★: ${p3}%`);
      const breakdownText =
        parts.length > 0
          ? `Low-star feedback exists (${parts.join(", ")} of ratings), but Amazon's on-page "Top reviews" sample didn't include low-star examples for this scrape.`
          : "This scrape didn't include low-star 'Top reviews' text.";
      top_complaints.push(breakdownText);
      meta.complaint_source_used = "rating_breakdown_only";

      // One "Potential watch-outs" from product facts (labeled as not from review text)
      const specs = product.specifications ?? product.attributes ?? [];
      const arr = Array.isArray(specs) ? specs : Object.entries(specs);
      const watchOuts: string[] = [];
      for (const entry of arr.slice(0, 5)) {
        const name =
          typeof entry === "object" && entry && "name" in entry
            ? (entry as { name: string }).name
            : String(entry[0]);
        const val =
          typeof entry === "object" && entry && "value" in entry
            ? (entry as { value: string }).value
            : String(entry[1]);
        const n = (name || "").toLowerCase();
        const v = (val || "").toLowerCase();
        if (
          (n.includes("size") || n.includes("dimension") || n.includes("weight")) &&
          v
        )
          watchOuts.push(`${name}: ${val}`);
        if ((n.includes("heat") || n.includes("temperature")) && v)
          watchOuts.push(`${name}: ${val}`);
        if ((n.includes("quality") || n.includes("material")) && v)
          watchOuts.push(`${name}: ${val}`);
      }
      if (watchOuts.length > 0) {
        top_complaints.push(
          `Potential watch-outs (from product specs, not from review text): ${watchOuts[0]}`
        );
      }
    }
  }

  // Top praise: positive_reviews first, then customers_say positives, then rating_breakdown
  if (top_praise.length === 0 && positiveReviews.length > 0) {
    for (const r of positiveReviews.slice(0, 3)) {
      addPraise({
        theme: themeFromReview(r),
        snippet: r.body ? snippet(r.body) : undefined,
        stars: r.rating,
      });
    }
  }
  if (top_praise.length === 0 && praiseFromCustomersSay.length > 0) {
    for (const c of praiseFromCustomersSay.slice(0, 3)) {
      addPraise({ theme: (c.name || "").trim() || "Positive feedback" });
    }
  }
  if (top_praise.length === 0 && meta.rating_breakdown_present && ratingBreakdown) {
    const p4 = getRatingBreakdownPct(ratingBreakdown, 4);
    const p5 = getRatingBreakdownPct(ratingBreakdown, 5);
    if (p4 != null || p5 != null) {
      const pct = [p4, p5].filter((x): x is number => typeof x === "number");
      const avg =
        pct.length > 0 ? pct.reduce((a, b) => a + b, 0) / pct.length : 0;
      top_praise.push(
        `High-star share (4–5★: ${avg.toFixed(1)}% of ratings). No positive review snippets in this scrape.`
      );
    }
  }

  return { top_complaints, top_praise, meta };
}
