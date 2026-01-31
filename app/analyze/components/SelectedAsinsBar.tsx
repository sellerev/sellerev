"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";

const VISIBLE_CHIPS = 3;

export interface AsinDetail {
  brand?: string | null;
  title?: string | null;
}

export interface SelectedAsinsBarProps {
  selectedAsins: string[];
  onClear: () => void;
  onRemove: (asin: string) => void;
  /** Optional lookup for brand/title (e.g. from page_one_listings) */
  asinDetails?: Record<string, AsinDetail>;
  /** When true, show inline warning that some questions require 1–2 products */
  showMaxTwoWarning?: boolean;
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
  asinDetails = {},
  showMaxTwoWarning = false,
}: SelectedAsinsBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const visible = selectedAsins.slice(0, VISIBLE_CHIPS);
  const restCount = selectedAsins.length - VISIBLE_CHIPS;
  const showMore = restCount > 0;

  useEffect(() => {
    if (!popoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popoverOpen]);

  return (
    <div
      className="transition-all duration-150 overflow-hidden border-b border-neutral-200 bg-neutral-50/80"
      style={{ minHeight: selectedAsins.length === 0 ? 0 : undefined }}
    >
      <div className="px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 min-h-[28px]">
          <span className="text-xs font-medium text-neutral-600 whitespace-nowrap">
            Selected ({selectedAsins.length})
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-neutral-500 hover:text-neutral-700 hover:underline focus:outline-none focus:ring-1 focus:ring-neutral-300 rounded"
          >
            Clear
          </button>
        </div>

        {showMaxTwoWarning && selectedAsins.length > 2 && (
          <p className="text-[11px] text-amber-600">
            Some questions require 1–2 selected products
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5 max-h-[60px] overflow-y-auto overflow-x-hidden">
          {visible.map((asin) => {
            const detail = asinDetails[asin];
            const label = chipLabel(asin, detail);
            const title = tooltipTitle(asin, detail);
            return (
              <button
                key={asin}
                type="button"
                onClick={() => onRemove(asin)}
                title={title}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-300 bg-white text-[11px] text-gray-800 hover:bg-neutral-50 focus:outline-none focus:ring-1 focus:ring-neutral-300 font-mono max-w-[140px] truncate"
              >
                <span className="truncate">{label}</span>
                <X className="w-3 h-3 flex-shrink-0 text-neutral-500" />
              </button>
            );
          })}
          {showMore && (
            <div className="relative inline-block" ref={popoverRef}>
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setPopoverOpen((o) => !o)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-300 bg-neutral-100 text-[11px] text-gray-700 hover:bg-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-300"
              >
                <span>+{restCount} more</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${popoverOpen ? "rotate-180" : ""}`} />
              </button>
              {popoverOpen && (
                <div className="absolute left-0 bottom-full mb-1 z-50 min-w-[180px] max-h-[200px] overflow-y-auto py-1 bg-white border border-neutral-200 rounded-lg shadow-lg">
                  {selectedAsins.slice(VISIBLE_CHIPS).map((asin) => {
                    const detail = asinDetails[asin];
                    const label = chipLabel(asin, detail);
                    const title = tooltipTitle(asin, detail);
                    return (
                      <button
                        key={asin}
                        type="button"
                        onClick={() => {
                          onRemove(asin);
                          if (selectedAsins.length - 1 <= VISIBLE_CHIPS) setPopoverOpen(false);
                        }}
                        title={title}
                        className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-neutral-50 text-xs font-mono text-gray-800"
                      >
                        <span className="truncate flex-1">{label}</span>
                        <X className="w-3 h-3 flex-shrink-0 text-neutral-500" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
