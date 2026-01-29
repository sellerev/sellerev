"use client";

import { X } from "lucide-react";

export type RequiresSelection = 0 | 1 | 2;

export interface HelpQuestion {
  id: string;
  label: string;
  promptText: string;
  requiresSelection: RequiresSelection;
  maxSelection?: number;
  tags?: string[];
  category: string;
}

export const HELP_QUESTIONS: HelpQuestion[] = [
  // ─── Market / Page-1 (no ASINs required) ─────────────────────────────────
  { id: "m1", label: "How competitive is this market overall?", promptText: "How competitive is this market overall?", requiresSelection: 0, category: "Market / Page-1", tags: ["competition"] },
  { id: "m2", label: "How many listings are sponsored vs organic?", promptText: "How many listings are sponsored vs organic?", requiresSelection: 0, category: "Market / Page-1", tags: ["sponsored"] },
  { id: "m3", label: "What's the price range and is it tight or wide?", promptText: "What's the price range and is it tight or wide?", requiresSelection: 0, category: "Market / Page-1", tags: ["pricing"] },
  { id: "m4", label: "Which ASIN has the highest estimated monthly revenue?", promptText: "Which ASIN has the highest estimated monthly revenue?", requiresSelection: 0, category: "Market / Page-1", tags: ["revenue"] },
  { id: "m5", label: "How many listings have fewer than 500 reviews?", promptText: "How many listings have fewer than 500 reviews?", requiresSelection: 0, category: "Market / Page-1", tags: ["reviews"] },
  { id: "m6", label: "How concentrated is the market (top 3 share)?", promptText: "How concentrated is the market (top 3 share)?", requiresSelection: 0, category: "Market / Page-1", tags: ["concentration"] },
  { id: "m7", label: "What's the review barrier?", promptText: "What's the review barrier?", requiresSelection: 0, category: "Market / Page-1", tags: ["reviews"] },
  { id: "m8", label: "What's the brand dominance?", promptText: "What's the brand dominance?", requiresSelection: 0, category: "Market / Page-1", tags: ["brands"] },
  { id: "m9", label: "How many brands are on Page 1?", promptText: "How many brands are on Page 1?", requiresSelection: 0, category: "Market / Page-1", tags: ["brands"] },
  { id: "m10", label: "Is this market winnable?", promptText: "Is this market winnable?", requiresSelection: 0, category: "Market / Page-1", tags: ["strategy"] },
  // ─── Selected Product Deep Dive (exactly 1 ASIN) ──────────────────────────
  { id: "d1", label: "What do customers complain about most, and what do they praise most?", promptText: "What do customers complain about most, and what do they praise most?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["reviews"] },
  { id: "d2", label: "Summarize this listing's positioning (title + bullets) in 3 points.", promptText: "Summarize this listing's positioning (title + bullets) in 3 points.", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["positioning"] },
  { id: "d3", label: "What are the key product attributes (size, material, etc.)?", promptText: "What are the key product attributes (size, material, etc.)?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["attributes"] },
  { id: "d4", label: "How many variants does it have and what's the variation type?", promptText: "How many variants does it have and what's the variation type?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["variants"] },
  { id: "d5", label: "Why is this listing ranking despite fewer reviews?", promptText: "Why is this listing ranking despite fewer reviews?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["reviews", "competition"] },
  { id: "d6", label: "Is this price point typical for Page 1?", promptText: "Is this price point typical for Page 1?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["pricing"] },
  { id: "d7", label: "What advantages does this listing appear to have?", promptText: "What advantages does this listing appear to have?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["positioning"] },
  { id: "d8", label: "How long has this listing been live?", promptText: "How long has this listing been live?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["listing age"] },
  { id: "d9", label: "What are the bullet points?", promptText: "What are the bullet points?", requiresSelection: 1, category: "Selected Product Deep Dive", tags: ["bullets"] },
  // ─── Compare Two Products (exactly 2 ASINs) ───────────────────────────────
  { id: "c1", label: "Compare top complaints and praise for both.", promptText: "Compare top complaints and praise for both.", requiresSelection: 2, maxSelection: 2, category: "Compare Two Products", tags: ["reviews"] },
  { id: "c2", label: "Which listing looks easier to compete with and why?", promptText: "Which listing looks easier to compete with and why?", requiresSelection: 2, maxSelection: 2, category: "Compare Two Products", tags: ["competition"] },
  { id: "c3", label: "What's the biggest positioning difference between these two?", promptText: "What's the biggest positioning difference between these two?", requiresSelection: 2, maxSelection: 2, category: "Compare Two Products", tags: ["positioning"] },
  { id: "c4", label: "Compare price, reviews, rating, BSR, revenue estimates side-by-side.", promptText: "Compare price, reviews, rating, BSR, revenue estimates side-by-side.", requiresSelection: 2, maxSelection: 2, category: "Compare Two Products", tags: ["pricing", "reviews"] },
  { id: "c5", label: "Which product has more reviews?", promptText: "Which product has more reviews?", requiresSelection: 2, maxSelection: 2, category: "Compare Two Products", tags: ["reviews"] },
  { id: "c6", label: "Which product has higher revenue?", promptText: "Which product has higher revenue?", requiresSelection: 2, maxSelection: 2, category: "Compare Two Products", tags: ["revenue"] },
  // ─── Fees / Profitability (1 ASIN; app supports it) ───────────────────────
  { id: "f1", label: "What are the Amazon fees for this product?", promptText: "What are the Amazon fees for this product?", requiresSelection: 1, category: "Fees / Profitability", tags: ["fees"] },
  { id: "f2", label: "Calculate profitability for this ASIN.", promptText: "Calculate profitability for this ASIN.", requiresSelection: 1, category: "Fees / Profitability", tags: ["profitability"] },
  // ─── Data Quality / Missing Data (no ASINs) ───────────────────────────────
  { id: "q1", label: "How many listings have missing review counts?", promptText: "How many listings have missing review counts?", requiresSelection: 0, category: "Data Quality / Missing Data", tags: ["reviews", "missing"] },
  { id: "q2", label: "Which listings have unknown sponsored status?", promptText: "Which listings have unknown sponsored status?", requiresSelection: 0, category: "Data Quality / Missing Data", tags: ["sponsored", "missing"] },
  { id: "q3", label: "How accurate are these revenue estimates?", promptText: "How accurate are these revenue estimates?", requiresSelection: 0, category: "Data Quality / Missing Data", tags: ["revenue", "quality"] },
  { id: "q4", label: "What's the BSR and category quality for Page 1?", promptText: "What's the BSR and category quality for Page 1?", requiresSelection: 0, category: "Data Quality / Missing Data", tags: ["bsr", "category"] },
];

const CATEGORY_ORDER = [
  "Market / Page-1",
  "Selected Product Deep Dive",
  "Compare Two Products",
  "Fees / Profitability",
  "Data Quality / Missing Data",
];

const MAX_PER_SECTION = 10;

function groupByCategory(questions: HelpQuestion[]): Map<string, HelpQuestion[]> {
  const map = new Map<string, HelpQuestion[]>();
  for (const q of questions) {
    const list = map.get(q.category) ?? [];
    if (list.length < MAX_PER_SECTION) list.push(q);
    map.set(q.category, list);
  }
  return map;
}

export interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAsins: string[];
  onSelectQuestion: (promptText: string) => void;
}

export default function HelpDrawer({
  isOpen,
  onClose,
  selectedAsins,
  onSelectQuestion,
}: HelpDrawerProps) {
  const n = selectedAsins.length;
  const grouped = groupByCategory(HELP_QUESTIONS);

  function canUse(q: HelpQuestion): boolean {
    if (q.requiresSelection === 0) return true;
    if (q.requiresSelection === 1) return n === 1;
    if (q.requiresSelection === 2) return n === 2;
    return false;
  }

  function overSelected(q: HelpQuestion): boolean {
    if (q.requiresSelection === 0) return false;
    const max = q.maxSelection ?? q.requiresSelection;
    return n > max;
  }

  function disabled(q: HelpQuestion): boolean {
    return !canUse(q) || overSelected(q);
  }

  function helperText(q: HelpQuestion): string {
    if (q.requiresSelection === 0) return "";
    if (overSelected(q)) return "Select only 1–2 ASINs for deep dives";
    if (q.requiresSelection === 1 && n !== 1) return "Select 1 ASIN to ask this";
    if (q.requiresSelection === 2 && n !== 2) return "Select 2 ASINs to ask this";
    return "";
  }

  function handleClick(q: HelpQuestion) {
    if (disabled(q)) return;
    onSelectQuestion(q.promptText);
  }

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
            How to use Sellerev
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
            aria-label="Close drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-xs text-gray-700 space-y-1">
            <p className="font-medium text-gray-900">How it works</p>
            <p>Market questions use Page-1 data.</p>
            <p>Deep dives use selected ASINs.</p>
          </div>

          {CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat);
            if (!list || list.length === 0) return null;
            return (
              <section key={cat}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {cat}
                </h3>
                <p className="text-[11px] text-gray-500 mb-2">
                  {cat === "Market / Page-1" && "No ASINs required. Ask anytime."}
                  {cat === "Selected Product Deep Dive" && "Select exactly 1 product from Page 1."}
                  {cat === "Compare Two Products" && "Select exactly 2 products from Page 1."}
                  {cat === "Fees / Profitability" && "Select 1 ASIN. Fees and profitability use Seller API."}
                  {cat === "Data Quality / Missing Data" && "No ASINs required."}
                </p>
                <ul className="space-y-1">
                  {list.map((q) => {
                    const isDisabled = disabled(q);
                    const text = helperText(q);
                    return (
                      <li key={q.id}>
                        <button
                          type="button"
                          onClick={() => handleClick(q)}
                          disabled={isDisabled}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                            isDisabled
                              ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                              : "border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <span className="block">{q.label}</span>
                          {text && (
                            <span className="block mt-1 text-[11px] text-amber-600">
                              {text}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
