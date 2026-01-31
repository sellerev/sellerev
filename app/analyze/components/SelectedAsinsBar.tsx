"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, Trash2 } from "lucide-react";

export interface AsinDetail {
  brand?: string | null;
  title?: string | null;
}

export interface SelectedAsinsBarProps {
  selectedAsins: string[];
  onClear: () => void;
  onRemove: (asin: string) => void;
  /** Remove multiple ASINs at once (e.g. from Edit mode "Remove selected") */
  onRemoveMany?: (asins: string[]) => void;
  /** Optional lookup for brand/title (e.g. from page_one_listings) */
  asinDetails?: Record<string, AsinDetail>;
  /** When > 0, show subtle hint "Some questions work best with 1–2 selected" when count exceeds this */
  maxSelectableHint?: number;
}

function chipLabel(asin: string, detail?: AsinDetail): string {
  if (detail?.brand && detail.brand.trim()) {
    const last4 = asin.length >= 4 ? asin.slice(-4) : asin;
    return `${detail.brand.trim()} • ${last4}`;
  }
  return asin;
}

function tooltipTitle(asin: string, detail?: AsinDetail): string {
  const parts: string[] = [];
  if (detail?.title && detail.title.trim()) parts.push(detail.title.trim());
  parts.push(`ASIN: ${asin}`);
  return parts.join("\n");
}

export default function SelectedAsinsBar({
  selectedAsins,
  onClear,
  onRemove,
  onRemoveMany,
  asinDetails = {},
  maxSelectableHint = 2,
}: SelectedAsinsBarProps) {
  const [editMode, setEditMode] = useState(false);
  const [clearConfirmShown, setClearConfirmShown] = useState(false);
  const [selectedInEditMode, setSelectedInEditMode] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedCount = selectedInEditMode.size;

  // Esc exits edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditMode(false);
        setClearConfirmShown(false);
        setSelectedInEditMode(new Set());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Arrow keys scroll chip row when container focused
  const handleScrollKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.key === "ArrowLeft") {
      el.scrollBy({ left: -80, behavior: "smooth" });
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      el.scrollBy({ left: 80, behavior: "smooth" });
      e.preventDefault();
    }
  }, []);

  const toggleSelect = (asin: string) => {
    setSelectedInEditMode((prev) => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else next.add(asin);
      return next;
    });
  };

  const handleRemoveSelected = () => {
    if (selectedCount === 0 || !onRemoveMany) return;
    onRemoveMany(Array.from(selectedInEditMode));
    setSelectedInEditMode(new Set());
    setEditMode(false);
  };

  const handleClearConfirmed = () => {
    onClear();
    setClearConfirmShown(false);
    setEditMode(false);
  };

  const showHint = maxSelectableHint > 0 && selectedAsins.length > maxSelectableHint;

  return (
    <div className="transition-all duration-150 overflow-hidden border-b border-neutral-200 bg-neutral-50/80">
      <div className="px-3 py-2 flex flex-col gap-2">
        {/* Header: Selected (N) | Clear all / confirm | Edit | Remove selected + Done */}
        <div className="flex items-center justify-between gap-2 min-h-[28px] flex-shrink-0">
          <span className="text-xs font-medium text-neutral-600 whitespace-nowrap">
            Selected ({selectedAsins.length})
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {clearConfirmShown ? (
              <>
                <span className="text-xs text-neutral-500">Clear all?</span>
                <button
                  type="button"
                  onClick={() => setClearConfirmShown(false)}
                  className="text-xs text-neutral-600 hover:text-neutral-800 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-neutral-300 min-w-[28px] min-h-[28px] flex items-center justify-center"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleClearConfirmed}
                  className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-red-300 min-w-[28px] min-h-[28px] flex items-center justify-center"
                >
                  Clear
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setClearConfirmShown(true)}
                  className="text-xs text-neutral-500 hover:text-neutral-700 hover:underline focus:outline-none focus:ring-1 focus:ring-neutral-300 rounded min-h-[28px] flex items-center justify-center px-1"
                >
                  Clear all
                </button>
                {editMode ? (
                  <>
                    {onRemoveMany && selectedCount > 0 && (
                      <button
                        type="button"
                        onClick={handleRemoveSelected}
                        className="text-xs text-red-600 hover:text-red-700 font-medium inline-flex items-center gap-1 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-red-300 min-h-[28px] flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove selected ({selectedCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setEditMode(false); setSelectedInEditMode(new Set()); }}
                      className="text-xs text-neutral-600 hover:text-neutral-800 font-medium px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-neutral-300 min-h-[28px] flex items-center justify-center"
                    >
                      Done
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditMode(true)}
                    className="text-xs text-neutral-500 hover:text-neutral-700 hover:underline focus:outline-none focus:ring-1 focus:ring-neutral-300 rounded min-h-[28px] flex items-center justify-center px-1"
                  >
                    Edit
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Subtle hint when > maxSelectableHint (no orange) */}
        {showHint && (
          <p className="text-[11px] text-neutral-500">
            Tip: Some questions work best with 1–2 selected
          </p>
        )}

        {/* Single horizontal scroll row — no dropdown */}
        <div
          ref={scrollRef}
          role="listbox"
          tabIndex={0}
          onKeyDown={handleScrollKeyDown}
          className="relative flex items-center gap-2 max-h-[44px] overflow-x-auto overflow-y-hidden whitespace-nowrap rounded-lg border border-neutral-200 bg-white/80 py-1.5 px-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {/* Left edge fade */}
          <div
            className="pointer-events-none absolute left-0 top-0 bottom-0 w-4 z-10 bg-gradient-to-r from-neutral-50/95 to-transparent"
            aria-hidden
          />
          {/* Chips */}
          <div className="flex items-center gap-2 pl-1 pr-1">
            {selectedAsins.map((asin) => {
              const detail = asinDetails[asin];
              const label = chipLabel(asin, detail);
              const title = tooltipTitle(asin, detail);
              const isSelected = selectedInEditMode.has(asin);

              if (editMode) {
                return (
                  <button
                    key={asin}
                    type="button"
                    onClick={() => toggleSelect(asin)}
                    title={title}
                    className={`inline-flex items-center gap-2 h-9 min-h-[36px] px-3 rounded-lg border text-xs font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 flex-shrink-0 ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-neutral-300 bg-white hover:bg-neutral-50"
                    }`}
                  >
                    <span className="flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center bg-white">
                      {isSelected && <Check className="w-2.5 h-2.5 text-blue-600" strokeWidth={3} />}
                    </span>
                    <span className="truncate max-w-[120px]">{label}</span>
                  </button>
                );
              }

              return (
                <div
                  key={asin}
                  className="inline-flex items-center gap-1.5 h-9 min-h-[36px] px-3 rounded-lg border border-neutral-300 bg-white text-xs font-mono text-gray-800 flex-shrink-0"
                  title={title}
                >
                  <span className="truncate max-w-[140px]">{label}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(asin)}
                    aria-label={`Remove ${asin}`}
                    className="flex-shrink-0 w-7 h-7 min-w-[28px] min-h-[28px] rounded flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          {/* Right edge fade */}
          <div
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-4 z-10 bg-gradient-to-l from-neutral-50/95 to-transparent"
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
