"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { X, ChevronDown, ChevronRight, Search } from "lucide-react";

export type RequiresSelection = 0 | 1 | 2;

export type QuestionCategory =
  | "market"
  | "brands"
  | "reviews"
  | "listing_copy"
  | "compare"
  | "fees"
  | "data_quality"
  | "workflow";

export interface QuestionTemplate {
  id: string;
  category: QuestionCategory;
  title: string;
  promptText: string;
  requiresSelection: RequiresSelection;
  tags?: string[];
  priority?: number;
}

const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  market: "Market / Page-1",
  brands: "Brands",
  reviews: "Reviews & Voice of Customer",
  listing_copy: "Listing Copy / Product Details",
  compare: "Compare",
  fees: "Fees / Profitability",
  data_quality: "Data Quality / Debug",
  workflow: "Workflow / What to do next",
};

const CATEGORY_ORDER: QuestionCategory[] = [
  "market",
  "brands",
  "reviews",
  "listing_copy",
  "compare",
  "fees",
  "data_quality",
  "workflow",
];

const DEFAULT_OPEN_CATEGORIES: QuestionCategory[] = [];

const FEES_SUPPORTED = true;

const QUESTION_TEMPLATES: QuestionTemplate[] = [
  // ─── Market / Page-1 ────────────────────────────────────────────────────
  { id: "m1", category: "market", title: "Give me the Market Snapshot in 1 paragraph.", promptText: "Give me the Market Snapshot in 1 paragraph.", requiresSelection: 0, tags: ["snapshot"], priority: 1 },
  { id: "m2", category: "market", title: "How competitive is this market overall?", promptText: "How competitive is this market overall?", requiresSelection: 0, tags: ["competition"], priority: 2 },
  { id: "m3", category: "market", title: "How many listings are sponsored vs organic?", promptText: "How many listings are sponsored vs organic?", requiresSelection: 0, tags: ["sponsored"], priority: 3 },
  { id: "m4", category: "market", title: "What's the price range and where is the price cluster?", promptText: "What's the price range and where is the price cluster?", requiresSelection: 0, tags: ["pricing"], priority: 4 },
  { id: "m5", category: "market", title: "Which ASINs dominate revenue on Page 1?", promptText: "Which ASINs dominate revenue on Page 1?", requiresSelection: 0, tags: ["revenue"], priority: 5 },
  { id: "m6", category: "market", title: "How concentrated is the market (top 3 share)?", promptText: "How concentrated is the market (top 3 share)?", requiresSelection: 0, tags: ["concentration"], priority: 6 },
  { id: "m7", category: "market", title: "What's the review barrier to hit Page 1?", promptText: "What's the review barrier to hit Page 1?", requiresSelection: 0, tags: ["reviews"], priority: 7 },
  { id: "m8", category: "market", title: "How many listings under 100 / 300 / 500 reviews?", promptText: "How many listings under 100 / 300 / 500 reviews?", requiresSelection: 0, tags: ["reviews"], priority: 8 },
  { id: "m9", category: "market", title: "Is there room for a new entrant in the top 10–15?", promptText: "Is there room for a new entrant in the top 10–15?", requiresSelection: 0, tags: ["strategy"], priority: 9 },
  { id: "m10", category: "market", title: "Which price tier looks least crowded?", promptText: "Which price tier looks least crowded?", requiresSelection: 0, tags: ["pricing", "strategy"], priority: 10 },
  // ─── Brands ─────────────────────────────────────────────────────────────
  { id: "b1", category: "brands", title: "Which brands control the most revenue?", promptText: "Which brands control the most revenue?", requiresSelection: 0, tags: ["revenue"], priority: 1 },
  { id: "b2", category: "brands", title: "Show me brand market share breakdown.", promptText: "Show me brand market share breakdown.", requiresSelection: 0, tags: ["market share"], priority: 2 },
  { id: "b3", category: "brands", title: "How many brands have multiple listings on Page 1?", promptText: "How many brands have multiple listings on Page 1?", requiresSelection: 0, tags: ["concentration"], priority: 3 },
  { id: "b4", category: "brands", title: "Is this market dominated by a single brand?", promptText: "Is this market dominated by a single brand?", requiresSelection: 0, tags: ["dominance"], priority: 4 },
  { id: "b5", category: "brands", title: "Which brands look like weaker competitors (low reviews but high rank)?", promptText: "Which brands look like weaker competitors (low reviews but high rank)?", requiresSelection: 0, tags: ["competition"], priority: 5 },
  // ─── Reviews & Voice of Customer ────────────────────────────────────────
  { id: "r1", category: "reviews", title: "What do customers complain about most for this product?", promptText: "What do customers complain about most for {ASIN_1}?", requiresSelection: 1, tags: ["complaints"], priority: 1 },
  { id: "r2", category: "reviews", title: "What do customers praise most for this product?", promptText: "What do customers praise most for {ASIN_1}?", requiresSelection: 1, tags: ["praise"], priority: 2 },
  { id: "r3", category: "reviews", title: "Summarize top complaints + top praise in bullets.", promptText: "Summarize the top complaints + top praise for {ASIN_1} in bullets.", requiresSelection: 1, tags: ["complaints", "praise"], priority: 3 },
  { id: "r4", category: "reviews", title: "What are the common deal-breakers mentioned in reviews?", promptText: "What are the common deal-breakers mentioned in reviews for {ASIN_1}?", requiresSelection: 1, tags: ["complaints"], priority: 4 },
  { id: "r5", category: "reviews", title: "Compare complaints between these two products.", promptText: "Compare complaints between {ASIN_1} vs {ASIN_2}.", requiresSelection: 2, tags: ["complaints", "compare"], priority: 5 },
  { id: "r6", category: "reviews", title: "Which product has clearer weaknesses based on reviews?", promptText: "Which product has clearer weaknesses based on reviews: {ASIN_1} vs {ASIN_2}?", requiresSelection: 2, tags: ["complaints", "compare"], priority: 6 },
  { id: "r7", category: "reviews", title: "What feature do customers wish existed (gap) comparing these two?", promptText: "What feature do customers wish existed (gap) comparing {ASIN_1} vs {ASIN_2}?", requiresSelection: 2, tags: ["gap", "compare"], priority: 7 },
  // ─── Listing Copy / Product Details ─────────────────────────────────────
  { id: "l1", category: "listing_copy", title: "Give me the bullet points and description.", promptText: "Give me the bullet points and description for {ASIN_1}.", requiresSelection: 1, tags: ["bullets", "description"], priority: 1 },
  { id: "l2", category: "listing_copy", title: "Summarize this listing's positioning (title + bullets).", promptText: "Summarize this listing's positioning (title + bullets) for {ASIN_1}.", requiresSelection: 1, tags: ["positioning"], priority: 2 },
  { id: "l3", category: "listing_copy", title: "What are the key attributes (material, size, etc.)?", promptText: "What are the key attributes (material, size, etc.) for {ASIN_1}?", requiresSelection: 1, tags: ["attributes"], priority: 3 },
  { id: "l4", category: "listing_copy", title: "How many variants does it have and what are the variation themes?", promptText: "How many variants does {ASIN_1} have and what are the variation themes?", requiresSelection: 1, tags: ["variants"], priority: 4 },
  { id: "l5", category: "listing_copy", title: "How long has this listing been live (date first available)?", promptText: "How long has {ASIN_1} been live (date first available)?", requiresSelection: 1, tags: ["listing age"], priority: 5 },
  { id: "l6", category: "listing_copy", title: "Compare positioning (title + bullets) of these two.", promptText: "Compare the positioning (title + bullets) of {ASIN_1} vs {ASIN_2}.", requiresSelection: 2, tags: ["positioning", "compare"], priority: 6 },
  { id: "l7", category: "listing_copy", title: "Which listing has a clearer value prop?", promptText: "Which listing has a clearer value prop: {ASIN_1} or {ASIN_2}?", requiresSelection: 2, tags: ["positioning", "compare"], priority: 7 },
  // ─── Compare ────────────────────────────────────────────────────────────
  { id: "c1", category: "compare", title: "Compare price, rating, reviews, BSR, revenue side-by-side.", promptText: "Compare price, rating, reviews, BSR/category rank, estimated revenue for {ASIN_1} vs {ASIN_2}.", requiresSelection: 2, tags: ["metrics"], priority: 1 },
  { id: "c2", category: "compare", title: "Which looks easier to compete with and why?", promptText: "Which looks easier to compete with and why: {ASIN_1} vs {ASIN_2}?", requiresSelection: 2, tags: ["competition"], priority: 2 },
  { id: "c3", category: "compare", title: "If I copied one strategy, which would I copy and why?", promptText: "If I copied one strategy, which would I copy and why: {ASIN_1} vs {ASIN_2}?", requiresSelection: 2, tags: ["strategy"], priority: 3 },
  { id: "c4", category: "compare", title: "Which is more premium-positioned and how can I tell?", promptText: "Which one is more premium-positioned and how can I tell: {ASIN_1} vs {ASIN_2}?", requiresSelection: 2, tags: ["positioning"], priority: 4 },
  { id: "c5", category: "compare", title: "Which product has more reviews?", promptText: "Which product has more reviews: {ASIN_1} vs {ASIN_2}?", requiresSelection: 2, tags: ["reviews"], priority: 5 },
  { id: "c6", category: "compare", title: "Which product has higher revenue?", promptText: "Which product has higher revenue: {ASIN_1} vs {ASIN_2}?", requiresSelection: 2, tags: ["revenue"], priority: 6 },
  // ─── Fees / Profitability ───────────────────────────────────────────────
  { id: "f1", category: "fees", title: "Estimate fees + net margin at current price.", promptText: "Estimate fees + net margin for {ASIN_1} at current price.", requiresSelection: 1, tags: ["fees", "profitability"], priority: 1 },
  { id: "f2", category: "fees", title: "What are the Amazon fees for this product?", promptText: "What are the Amazon fees for this product? ({ASIN_1})", requiresSelection: 1, tags: ["fees"], priority: 2 },
  { id: "f3", category: "fees", title: "Calculate profitability for this ASIN.", promptText: "Calculate profitability for this ASIN. ({ASIN_1})", requiresSelection: 1, tags: ["profitability"], priority: 3 },
  // ─── Data Quality / Debug ───────────────────────────────────────────────
  { id: "q1", category: "data_quality", title: "Are any listings missing review counts? How many?", promptText: "Are any listings missing review counts? How many?", requiresSelection: 0, tags: ["reviews", "missing"], priority: 1 },
  { id: "q2", category: "data_quality", title: "Any missing sponsored flags?", promptText: "Any missing sponsored flags?", requiresSelection: 0, tags: ["sponsored", "missing"], priority: 2 },
  { id: "q3", category: "data_quality", title: "How confident are the revenue estimates?", promptText: "How confident are the revenue estimates?", requiresSelection: 0, tags: ["revenue", "quality"], priority: 3 },
  { id: "q4", category: "data_quality", title: "Any obvious outliers skewing averages?", promptText: "Any obvious outliers skewing averages?", requiresSelection: 0, tags: ["outliers"], priority: 4 },
  { id: "q5", category: "data_quality", title: "What's the data coverage % for price/reviews/rank?", promptText: "What's the data coverage % for price/reviews/rank?", requiresSelection: 0, tags: ["coverage"], priority: 5 },
  // ─── Workflow / What to do next ──────────────────────────────────────────
  { id: "w1", category: "workflow", title: "Based on this market, what should I check next?", promptText: "Based on this market, what should I check next?", requiresSelection: 0, tags: ["workflow"], priority: 1 },
  { id: "w2", category: "workflow", title: "Give me 3 entry angles for this market.", promptText: "Give me 3 entry angles for this market.", requiresSelection: 0, tags: ["strategy"], priority: 2 },
  { id: "w3", category: "workflow", title: "Suggest 5 long-tail keywords to analyze next (based on Page-1 patterns).", promptText: "Suggest 5 long-tail keywords to analyze next (based on Page-1 patterns).", requiresSelection: 0, tags: ["keywords"], priority: 3 },
  { id: "w4", category: "workflow", title: "Recommend a unique selling proposition.", promptText: "Recommend a unique selling proposition.", requiresSelection: 0, tags: ["USP", "differentiation", "positioning"], priority: 4 },
];

function interpolatePrompt(promptText: string, asins: string[]): string {
  let out = promptText;
  if (asins[0]) out = out.replace(/\{ASIN_1\}/g, asins[0]);
  if (asins[1]) out = out.replace(/\{ASIN_2\}/g, asins[1]);
  return out;
}

function groupByCategory(questions: QuestionTemplate[]): Map<QuestionCategory, QuestionTemplate[]> {
  const map = new Map<QuestionCategory, QuestionTemplate[]>();
  for (const q of questions) {
    const list = map.get(q.category) ?? [];
    list.push(q);
    map.set(q.category, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  }
  return map;
}

export interface ListingLike {
  asin?: string | null;
  title?: string | null;
  price?: number | null;
  rating?: number | null;
  review_count?: number | null;
  reviews?: number | null;
}

export interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAsins: string[];
  onSelectedAsinsChange: (asins: string[]) => void;
  onSelectQuestion: (promptText: string) => void;
  products: ListingLike[];
}

export default function HelpDrawer({
  isOpen,
  onClose,
  selectedAsins,
  onSelectedAsinsChange,
  onSelectQuestion,
  products,
}: HelpDrawerProps) {
  const [search, setSearch] = useState("");
  const [openCategories, setOpenCategories] = useState<Set<QuestionCategory>>(() => new Set(DEFAULT_OPEN_CATEGORIES));
  const [mode, setMode] = useState<"library" | "select">("library");
  const [pendingQuestion, setPendingQuestion] = useState<QuestionTemplate | null>(null);
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const toggleCategory = useCallback((cat: QuestionCategory) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const grouped = useMemo(() => groupByCategory(QUESTION_TEMPLATES), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return QUESTION_TEMPLATES;
    return QUESTION_TEMPLATES.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
    );
  }, [search]);

  const filteredByCategory = useMemo(() => {
    const map = new Map<QuestionCategory, QuestionTemplate[]>();
    for (const t of filtered) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [filtered]);

  const selectableProducts = useMemo(() => {
    return products.filter((p) => {
      const a = p.asin ?? "";
      return a.length >= 10 && !a.startsWith("ESTIMATED-") && !a.startsWith("INFERRED-") && !a.startsWith("KEYWORD-");
    });
  }, [products]);

  useEffect(() => {
    if (!toast) return;
    const tid = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(tid);
  }, [toast]);

  // Reset to collapsed, library mode whenever drawer is opened
  useEffect(() => {
    if (isOpen) {
      setOpenCategories(new Set(DEFAULT_OPEN_CATEGORIES));
      setMode("library");
      setPendingQuestion(null);
      setPickerSelected([]);
    }
  }, [isOpen]);

  const handleQuestionClick = useCallback(
    (t: QuestionTemplate, category: QuestionCategory) => {
      const isFeesComingSoon = category === "fees" && !FEES_SUPPORTED;
      if (isFeesComingSoon) {
        setToast("Fees mode not enabled yet.");
        return;
      }

      const n = selectedAsins.length;
      if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
        console.log("QUESTION_TEMPLATE_CLICKED", { id: t.id, requiresSelection: t.requiresSelection, selectedCount: n });
      }

      if (t.requiresSelection === 0) {
        onSelectQuestion(t.promptText);
        if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
          console.log("QUESTION_INSERTED", { id: t.id });
        }
        onClose();
        return;
      }

      if (t.requiresSelection === 1 && n === 1) {
        const text = interpolatePrompt(t.promptText, selectedAsins);
        onSelectQuestion(text);
        if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
          console.log("QUESTION_INSERTED", { id: t.id });
        }
        onClose();
        return;
      }

      if (t.requiresSelection === 2 && n === 2) {
        const text = interpolatePrompt(t.promptText, selectedAsins);
        onSelectQuestion(text);
        if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
          console.log("QUESTION_INSERTED", { id: t.id });
        }
        onClose();
        return;
      }

      // Require selection flow: show overlay. Pre-fill from page selection only (single source of truth).
      setPendingQuestion(t);
      const need = t.requiresSelection;
      const prefill = selectableProducts
        ? selectedAsins.filter((a) => selectableProducts.some((p) => (p.asin ?? "") === a)).slice(0, need)
        : [];
      setPickerSelected(prefill);
      setMode("select");
    },
    [selectedAsins, selectableProducts, onSelectQuestion, onClose]
  );

  const handleConfirmSelection = useCallback(() => {
    if (!pendingQuestion) return;
    const need = pendingQuestion.requiresSelection;
    if (pickerSelected.length !== need) return;

    onSelectedAsinsChange(pickerSelected);
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      console.log("QUESTION_SELECTION_CONFIRMED", { selected_asins: pickerSelected });
    }

    const text = interpolatePrompt(pendingQuestion.promptText, pickerSelected);
    onSelectQuestion(text);
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      console.log("QUESTION_INSERTED", { id: pendingQuestion.id });
    }

    setPendingQuestion(null);
    setPickerSelected([]);
    setMode("library");
    onClose();
  }, [pendingQuestion, pickerSelected, onSelectedAsinsChange, onSelectQuestion, onClose]);

  const handleBackFromSelect = useCallback(() => {
    setPendingQuestion(null);
    setPickerSelected([]);
    setMode("library");
  }, []);

  const need = pendingQuestion?.requiresSelection ?? 2;
  const isSelectMode = mode === "select" && !!pendingQuestion;
  const selectedAsinsCount = pickerSelected.length;
  const canSend = selectedAsinsCount === need;
  const whyDisabled = canSend ? undefined : `need ${need} selected, have ${selectedAsinsCount}`;
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && isSelectMode) {
    console.log("QUESTION_GO_DEBUG", { selectedAsinsCount, requiredCount: need, canSend, whyDisabled });
  }

  const toggleProduct = useCallback(
    (asin: string) => {
      setPickerSelected((prev) => {
        const next = prev.includes(asin) ? prev.filter((a) => a !== asin) : [...prev, asin];
        return next.slice(0, need);
      });
    },
    [need]
  );

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-white border-l border-gray-200 shadow-xl flex flex-col"
        role="dialog"
        aria-labelledby="help-drawer-title"
      >
        <div className="shrink-0 px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
          <h2 id="help-drawer-title" className="text-base font-semibold text-gray-900">
            {isSelectMode ? (need === 1 ? "Select 1 product" : "Select 2 products") : "Question Library"}
          </h2>
          <div className="flex items-center gap-1">
            {isSelectMode && (
              <button
                type="button"
                onClick={handleBackFromSelect}
                className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
              aria-label="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {toast && (
          <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            {toast}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {isSelectMode ? (
            <>
              <p className="text-xs text-gray-600">
                {selectedAsinsCount === 0
                  ? "Select 1–2 ASINs to run this question."
                  : "Select from Page 1. Then confirm to insert the question into chat."}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPickerSelected([])}
                  className="text-xs text-gray-600 hover:text-gray-900 underline"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSelection}
                  disabled={!canSend}
                  className="ml-auto px-3 py-1.5 rounded-lg bg-[#3B82F6] text-white text-xs font-medium hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm selection
                </button>
              </div>
              <ul className="space-y-1.5 flex-1 min-h-0">
                {selectableProducts.length === 0 ? (
                  <li className="text-sm text-gray-500 py-4">No Page-1 products available.</li>
                ) : (
                  selectableProducts.map((p) => {
                    const asin = p.asin ?? "";
                    const checked = pickerSelected.includes(asin);
                    const reviews = p.review_count ?? p.reviews ?? null;
                    const title = (p.title ?? "").slice(0, 60);
                    return (
                      <li key={asin}>
                        <label className="flex items-start gap-2 p-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProduct(asin)}
                            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[11px] text-gray-500">{asin}</div>
                            <div className="text-sm text-gray-900 truncate" title={p.title ?? undefined}>
                              {title}{title.length >= 60 ? "…" : ""}
                            </div>
                            <div className="text-[11px] text-gray-500 mt-0.5">
                              {p.price != null && `$${Number(p.price).toFixed(2)}`}
                              {p.rating != null && ` · ${Number(p.rating).toFixed(1)}★`}
                              {reviews != null && ` · ${reviews} reviews`}
                            </div>
                          </div>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="search"
                  placeholder="Search questions…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {CATEGORY_ORDER.map((cat) => {
                const list = filteredByCategory.get(cat);
                if (!list || list.length === 0) return null;
                const label = CATEGORY_LABELS[cat];
                const isOpenCat = openCategories.has(cat);
                const isFees = cat === "fees";
                const showComingSoon = isFees && !FEES_SUPPORTED;

                return (
                  <section key={cat}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center justify-between gap-2 py-2 text-left"
                    >
                      <span className="flex items-center gap-2">
                        {isOpenCat ? (
                          <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          {label}
                        </span>
                        <span className="bg-gray-200 text-gray-600 text-[10px] font-medium px-1.5 py-0.5 rounded">
                          {list.length}
                        </span>
                        {showComingSoon && (
                          <span className="text-[10px] text-amber-600 font-medium">Coming soon</span>
                        )}
                      </span>
                    </button>
                    {isOpenCat && (
                      <ul className="space-y-1 pl-6">
                        {list.map((t) => {
                          const reqLabel = t.requiresSelection === 1 ? "Requires 1 selection" : t.requiresSelection === 2 ? "Requires 2 selections" : null;
                          return (
                            <li key={t.id}>
                              <button
                                type="button"
                                onClick={() => handleQuestionClick(t, cat)}
                                className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50 text-sm transition-colors"
                              >
                                <span className="block">{t.title}</span>
                                {reqLabel && (
                                  <span className="inline-block mt-1 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                    {reqLabel}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}
