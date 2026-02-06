"use client";

import { useRef, useEffect, useCallback } from "react";
import SelectedAsinsBar, { type AsinDetail } from "./SelectedAsinsBar";

const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 160;

export interface ChatComposerProps {
  /** Current input value */
  value: string;
  /** Controlled setter */
  onChange: (value: string) => void;
  /** Send message (e.g. on Enter) */
  onSend: () => void;
  /** Ref for the textarea (for focus / autosize) */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  disabled?: boolean;
  /** Disable send button (e.g. empty input or loading) */
  sendDisabled?: boolean;
  loading?: boolean;
  /** Selected ASINs - when length > 0, selection bar is shown above input */
  selectedAsins: string[];
  onSelectedAsinsChange: (asins: string[]) => void;
  /** Optional lookup for chip labels (brand/title) */
  asinDetails?: Record<string, AsinDetail>;
  /** When > 0, show hint "Some questions work best with 1–2 selected" when count exceeds this (e.g. 2) */
  maxSelectableHint?: number;
}

export default function ChatComposer({
  value,
  onChange,
  onSend,
  inputRef: externalRef,
  placeholder = "Ask about the analysis...",
  disabled = false,
  sendDisabled = false,
  loading = false,
  selectedAsins,
  onSelectedAsinsChange,
  asinDetails = {},
  maxSelectableHint = 2,
}: ChatComposerProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = (externalRef ?? internalRef) as React.RefObject<HTMLTextAreaElement | null>;

  const adjustHeight = useCallback(() => {
    const el = textareaRef?.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollHeight = el.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
    el.style.height = `${newHeight}px`;
  }, [textareaRef]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !disabled && value.trim()) {
      e.preventDefault();
      onSend();
    }
  };

  const handleClearSelection = () => {
    onSelectedAsinsChange([]);
  };

  const handleRemoveAsin = (asin: string) => {
    onSelectedAsinsChange(selectedAsins.filter((a) => a !== asin));
  };

  const handleRemoveMany = (asins: string[]) => {
    const set = new Set(asins);
    onSelectedAsinsChange(selectedAsins.filter((a) => !set.has(a)));
  };

  return (
    <div className="w-full min-w-0 shrink-0 flex flex-col bg-white border-t border-neutral-200">
      {/* Selection bar: only when there are selected ASINs. Adds space above textarea, doesn't squeeze it. */}
      {selectedAsins.length > 0 && (
        <SelectedAsinsBar
          selectedAsins={selectedAsins}
          onClear={handleClearSelection}
          onRemove={handleRemoveAsin}
          onRemoveMany={handleRemoveMany}
          asinDetails={asinDetails}
          maxSelectableHint={maxSelectableHint}
        />
      )}

      {/* Input row: textarea + send. No overflow-hidden so textarea can scroll internally. */}
      <div className="flex flex-wrap gap-2 items-end w-full min-w-0 px-4 py-3 bg-white border border-neutral-300 rounded-xl shadow-sm hover:border-neutral-400 focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent transition-all box-border">
        <textarea
          ref={textareaRef}
          className="flex-1 min-w-[120px] bg-transparent border-0 rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none disabled:cursor-not-allowed resize-none placeholder:text-neutral-400"
          style={{
            minHeight: TEXTAREA_MIN_HEIGHT,
            maxHeight: TEXTAREA_MAX_HEIGHT,
            lineHeight: "1.5",
            overflowY: "auto",
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          aria-label="Message"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || sendDisabled}
          className="w-9 h-9 flex-shrink-0 bg-gradient-to-r from-primary to-primary-glow text-primary-foreground rounded-lg flex items-center justify-center hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Send message"
        >
          {loading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
