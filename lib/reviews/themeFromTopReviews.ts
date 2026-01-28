export interface TopReview {
  rating: number;
  title: string | null;
  text: string;
  verified_purchase: boolean | null;
  date: string | null;
}

export interface TopReviewThemes {
  top_praise: string[];
  top_complaints: string[];
  praise_quotes: string[];
  complaint_quotes: string[];
}

/**
 * Lightweight, deterministic theme extraction from top_reviews.
 *
 * - Praise pool: rating >= 4
 * - Complaint pool: rating <= 3
 * - Themes: first-sentence/title style summaries
 * - Quotes: first 160 chars of body
 */
export function themeFromTopReviews(topReviews: TopReview[]): TopReviewThemes {
  const praisePool = topReviews.filter((r) => typeof r.rating === "number" && r.rating >= 4);
  const complaintPool = topReviews.filter((r) => typeof r.rating === "number" && r.rating <= 3);

  const praiseThemes: string[] = [];
  const complaintThemes: string[] = [];
  const praiseQuotes: string[] = [];
  const complaintQuotes: string[] = [];

  const takeFirstSentence = (text: string): string => {
    const trimmed = text.trim();
    const match = trimmed.match(/^(.*?[\.!\?])\s+/);
    if (match && match[1]) return match[1].trim();
    return trimmed.length > 160 ? trimmed.substring(0, 160).trim() + "…" : trimmed;
  };

  const asQuote = (text: string): string =>
    text.length > 160 ? text.substring(0, 160).trim() + "…" : text.trim();

  // Complaints (up to 3 themes + 2–3 quotes)
  for (const r of complaintPool.slice(0, 10)) {
    const body = (r.text || "").trim();
    if (!body) continue;
    const base =
      (r.title && r.title.trim()) ||
      takeFirstSentence(body) ||
      "Critical feedback from buyers";
    if (complaintThemes.length < 3) {
      complaintThemes.push(base);
    }
    if (complaintQuotes.length < 3) {
      complaintQuotes.push(asQuote(body));
    }
  }

  // Praise (up to 3 themes + 2–3 quotes)
  for (const r of praisePool.slice(0, 10)) {
    const body = (r.text || "").trim();
    if (!body) continue;
    const base =
      (r.title && r.title.trim()) ||
      takeFirstSentence(body) ||
      "Positive feedback from buyers";
    if (praiseThemes.length < 3) {
      praiseThemes.push(base);
    }
    if (praiseQuotes.length < 3) {
      praiseQuotes.push(asQuote(body));
    }
  }

  // Safe fallback when no complaint pool
  if (complaintThemes.length === 0) {
    complaintThemes.push(
      "No repeated complaint themes found in the top review snippets we pulled. (Full review text may contain more.)"
    );
  }

  return {
    top_praise: praiseThemes,
    top_complaints: complaintThemes,
    praise_quotes: praiseQuotes,
    complaint_quotes: complaintQuotes,
  };
}

