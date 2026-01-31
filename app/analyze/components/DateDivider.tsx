"use client";

/**
 * DateDivider - Centered date separator (Lovable-style)
 * Renders "Today", "Yesterday", or "Jan 31, 2026"
 */
export default function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-3">
      <span className="text-[12px] text-neutral-400 font-normal">
        {label}
      </span>
    </div>
  );
}
