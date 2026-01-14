"use client";

import { useState } from "react";
import { Star, Image as ImageIcon, Check, Copy, ExternalLink } from "lucide-react";

interface ProductCardProps {
  rank: number;
  title: string | null;
  // brand removed (Phase 3: brands not displayed at product level)
  price: number;
  rating: number;
  reviews: number;
  monthlyRevenue: number | null;
  monthlyUnits: number | null;
  /**
   * Optional: Lazy refinement control (e.g. fetch BSR/product data on demand).
   * If provided, the card can render a small "Refine" action that does NOT affect market totals.
   */
  onRefineEstimates?: () => void;
  refineStatus?: "idle" | "loading" | "refined" | "error";
  refineMeta?: {
    served_from_cache?: boolean;
    cache_age_seconds?: number | null;
    credits_charged?: number | null;
  };
  fulfillment: "FBA" | "FBM" | "AMZ";
  isSponsored: boolean;
  imageUrl?: string | null;
  asin?: string | null;
  isSelected?: boolean;
  onSelect?: (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => void;
}

export function ProductCard({
  rank,
  title,
  // brand removed (Phase 3: brands not displayed at product level)
  price,
  rating,
  reviews,
  monthlyRevenue,
  monthlyUnits,
  onRefineEstimates,
  refineStatus = "idle",
  refineMeta,
  fulfillment,
  isSponsored,
  imageUrl,
  asin,
  isSelected = false,
  onSelect,
}: ProductCardProps) {
  const [copied, setCopied] = useState(false);

  const getFulfillmentBadgeStyle = () => {
    switch (fulfillment) {
      case "FBA":
        return "bg-[#DBEAFE] text-[#1E40AF]";
      case "FBM":
        return "bg-[#F3F4F6] text-[#4B5563]";
      case "AMZ":
        return "bg-[#FED7AA] text-[#9A3412]";
    }
  };

  const handleCopyASIN = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (asin) {
      try {
        await navigator.clipboard.writeText(asin);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy ASIN:", err);
      }
    }
  };

  const handleAmazonLink = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleRefineClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRefineEstimates?.();
  };

  const isLoading = refineStatus === "loading";
  const isRefined = refineStatus === "refined";

  return (
    <div
      onClick={(e) => onSelect?.(e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(e);
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      className={`
        bg-white rounded-xl p-4 relative cursor-pointer
        transition-all duration-200 ease-in-out
        flex flex-col
        min-h-[480px]
        focus:outline-none
        ${!isSelected ? 'focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2' : 'focus-visible:ring-0'}
        ${isSelected 
          ? 'border-2 border-gray-400 bg-gray-50 shadow-md' 
          : 'border border-transparent shadow-sm hover:shadow-lg hover:border-gray-300 hover:scale-[1.01] hover:-translate-y-0.5'
        }
      `}
    >
      {/* Rank Badge */}
      <div className="absolute top-4 right-4 w-8 h-8 bg-[#3B82F6] text-white 
                      rounded-md flex items-center justify-center font-bold text-xs z-10 shadow-sm">
        #{rank}
      </div>

      {/* Amazon Link Icon */}
      {asin && (
        <a
          href={`https://www.amazon.com/dp/${asin}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleAmazonLink}
          className="absolute top-4 right-14 w-7 h-7 bg-white border border-gray-300 rounded-md flex items-center justify-center hover:bg-gray-50 transition-colors z-10 shadow-sm"
          title="View on Amazon"
        >
          <ExternalLink className="w-3.5 h-3.5 text-gray-600" />
        </a>
      )}

      {/* Selected Checkmark Badge - Subtle neutral styling */}
      {isSelected && (
        <div className="absolute top-4 left-4 w-6 h-6 bg-gray-700 text-white 
                        rounded-full flex items-center justify-center z-10 shadow-md">
          <Check className="w-4 h-4" />
        </div>
      )}

      {/* Product Image - Larger size for visibility */}
      <div className="w-full max-w-[160px] h-[160px] bg-[#F3F4F6] rounded-lg mb-3 flex items-center justify-center overflow-hidden mx-auto">
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt={title || "Product image"} 
            className="w-full h-full object-contain p-2"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const placeholder = img.parentElement?.querySelector('.img-placeholder');
              if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
            }}
          />
        ) : null}
        <div className="img-placeholder w-full h-full flex items-center justify-center" style={{ display: imageUrl ? 'none' : 'flex' }}>
          <ImageIcon className="w-16 h-16 text-[#9CA3AF]" />
        </div>
      </div>

      {/* Product Title */}
      {title ? (
        <h3 className="text-base font-semibold text-[#111827] line-clamp-2 leading-[1.4] mb-1 min-h-[2.5rem]">
          {title}
        </h3>
      ) : (
        <div className="text-sm text-[#9CA3AF] italic mb-1 min-h-[2.5rem]">
          Title not available
        </div>
      )}

      {/* Brand removed (Phase 3: brands not displayed at product level) */}

      {/* ASIN with Copy Button */}
      {asin && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-mono text-gray-500">ASIN: {asin}</span>
          <button
            onClick={handleCopyASIN}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
            title="Copy ASIN"
            type="button"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-gray-400" />
            )}
          </button>
        </div>
      )}

      {/* Price */}
      {price > 0 ? (
        <div className="text-lg font-bold text-[#111827] mb-2">
          ${price.toFixed(2)}
        </div>
      ) : (
        <div className="text-sm text-[#9CA3AF] mb-2">Price not available</div>
      )}

      {/* Rating & Reviews */}
      {rating > 0 || reviews > 0 ? (
        <div className="flex items-center gap-2 mb-3">
          {rating > 0 && (
            <>
              <Star className="w-4 h-4 text-[#FBBF24] fill-[#FBBF24]" />
              <span className="text-sm text-[#111827]">{rating.toFixed(1)}</span>
            </>
          )}
          {reviews > 0 && (
            <span className="text-sm text-[#6B7280]">({reviews.toLocaleString()})</span>
          )}
        </div>
      ) : null}

      {/* Spacer to push revenue section to bottom */}
      <div className="flex-1" />

      {/* Revenue Section - Prominent */}
      <div className="bg-[#F9FAFB] -mx-4 -mb-4 px-4 py-3 mt-3 rounded-b-xl border-t border-[#E5E7EB]">
        {/* DEFAULT STATE (no placeholders): show only "Load Sales Data" block until enrichment is ready */}
        {asin && onRefineEstimates && !isRefined && (
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-[#6B7280] pr-3 flex items-center gap-2">
              {isLoading && (
                <span
                  className="inline-block w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin"
                  aria-hidden="true"
                />
              )}
              <span>
                {isLoading
                  ? "Loading Sales Data…"
                  : refineStatus === "error"
                  ? "Load failed. Try again."
                  : "Load 30-day sales signal for higher accuracy."}
              </span>
            </div>
            <button
              type="button"
              onClick={handleRefineClick}
              disabled={refineStatus === "loading"}
              className={`text-[11px] font-medium underline ${
                refineStatus === "loading"
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-gray-700 hover:text-gray-900"
              }`}
              title="Load sales data for this ASIN to refine this card's estimates"
            >
              {refineStatus === "loading" ? "Loading…" : "Load Sales Data"}
            </button>
          </div>
        )}

        {/* READY STATE: render numbers only after enrichment */}
        {refineStatus === "refined" && (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-medium text-[#374151]">
                Refined (live product data)
                <span className="ml-2 text-[11px] font-normal text-[#6B7280]">
                  {refineMeta?.served_from_cache ? "Loaded from cache" : "Live fetch"}
                  {typeof refineMeta?.cache_age_seconds === "number" && refineMeta.cache_age_seconds > 30
                    ? ` • ${Math.round(refineMeta.cache_age_seconds / 60)}m old`
                    : ""}
                </span>
              </div>
              {asin && onRefineEstimates && (
                <button
                  type="button"
                  onClick={handleRefineClick}
                  disabled={isLoading}
                  className="text-[11px] font-medium underline text-gray-700 hover:text-gray-900"
                  title="Reload sales data for this ASIN"
                >
                  Reload Sales Data
                </button>
              )}
            </div>

            <div className="mb-2">
              <div className="text-xs text-[#6B7280] mb-1">Est. Monthly Revenue</div>
              <div className="text-xl font-bold text-[#111827]">
                {monthlyRevenue && monthlyRevenue > 0
                  ? (
                      <>
                        ${(monthlyRevenue / 1000).toFixed(1)}K
                        <span className="text-sm font-normal text-[#6B7280]"> / mo</span>
                      </>
                    )
                  : "—"}
              </div>
            </div>

            <div>
              <div className="text-xs text-[#6B7280] mb-1">Est. Monthly Units</div>
              <div className="text-sm font-medium text-[#111827]">
                {monthlyUnits && monthlyUnits > 0 ? `${monthlyUnits.toLocaleString()} units` : "—"}
              </div>
            </div>
          </>
        )}

        {/* Badges Row */}
        <div className="flex gap-2 mt-3">
          {fulfillment && (
            <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${getFulfillmentBadgeStyle()}`}>
              {fulfillment}
            </span>
          )}
          {isSponsored && (
            <span className="px-2 py-1 rounded-full text-[11px] font-medium bg-[#FED7AA] text-[#9A3412]">
              Sponsored
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

