"use client";

import { useState } from "react";
import { Star, Image as ImageIcon, Check, Copy, ExternalLink } from "lucide-react";

interface ProductCardProps {
  rank: number;
  title: string | null;
  brand: string;
  price: number;
  rating: number;
  reviews: number;
  monthlyRevenue: number | null;
  monthlyUnits: number | null;
  fulfillment: "FBA" | "FBM" | "AMZ";
  isSponsored: boolean;
  imageUrl?: string | null;
  asin?: string | null;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function ProductCard({
  rank,
  title,
  brand,
  price,
  rating,
  reviews,
  monthlyRevenue,
  monthlyUnits,
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

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
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
        focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:ring-offset-2
        ${isSelected 
          ? 'border-2 border-[#3B82F6] bg-[#EFF6FF] shadow-md' 
          : 'border border-[#E5E7EB] shadow-sm hover:shadow-lg hover:border-[#3B82F6] hover:scale-[1.01] hover:-translate-y-0.5'
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

      {/* Selected Checkmark Badge */}
      {isSelected && (
        <div className="absolute top-4 left-4 w-6 h-6 bg-[#10B981] text-white 
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

      {/* Brand Name */}
      {brand && brand !== "—" && (
        <p className="text-sm text-[#6B7280] truncate mb-2">{brand}</p>
      )}

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
        {monthlyRevenue !== null && monthlyRevenue !== undefined ? (
          <div className="mb-2">
            <div className="text-xs text-[#6B7280] mb-1">Est. Monthly Revenue</div>
            {monthlyRevenue > 0 ? (
              <div className="text-xl font-bold text-[#111827]">
                ${(monthlyRevenue / 1000).toFixed(1)}K<span className="text-sm font-normal text-[#6B7280]"> / mo</span>
              </div>
            ) : (
              <div className="text-sm text-[#9CA3AF]">—</div>
            )}
          </div>
        ) : (
          <div className="mb-2">
            <div className="text-xs text-[#6B7280] mb-1">Est. Monthly Revenue</div>
            <div className="text-sm text-[#9CA3AF]">—</div>
          </div>
        )}
        {monthlyUnits !== null && monthlyUnits !== undefined ? (
          <div>
            <div className="text-xs text-[#6B7280] mb-1">Est. Monthly Units</div>
            {monthlyUnits > 0 ? (
              <div className="text-sm font-medium text-[#111827]">
                {monthlyUnits.toLocaleString()} units
              </div>
            ) : (
              <div className="text-sm text-[#9CA3AF]">—</div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-xs text-[#6B7280] mb-1">Est. Monthly Units</div>
            <div className="text-sm text-[#9CA3AF]">—</div>
          </div>
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

