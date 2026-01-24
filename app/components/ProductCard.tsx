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
   * BSR source to determine prefix (~ for estimated, no prefix for sp_api)
   */
  bsrSource?: string | null;
  bsr?: number | null; // Best Seller Rank
  bsrContext?: {
    chosen_category_name?: string | null;
    chosen_rank_source?: string | null;
  } | null; // BSR context with category name
  subcategoryBsr?: number | null; // Subcategory rank
  subcategoryName?: string | null; // Subcategory name
  bsrRoot?: number | null; // Main/root category BSR
  bsrRootCategory?: string | null; // Main/root category name
  fulfillment: "FBA" | "FBM" | "AMZ";
  isSponsored: boolean | null; // true = sponsored, false = organic, null = unknown
  appearsSponsored?: boolean; // ASIN-level: true if appears sponsored anywhere on Page 1
  sponsoredPositions?: number[]; // All positions where ASIN appeared as sponsored
  imageUrl?: string | null;
  asin?: string | null;
  isSelected?: boolean;
  onSelect?: (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => void;
  primeEligible?: boolean; // Prime eligibility (from is_prime heuristic)
  fulfillment_status?: 'PRIME' | 'NON_PRIME'; // Prime/Non-Prime status (heuristic from is_prime)
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
  bsrSource,
  bsr,
  bsrContext,
  subcategoryBsr,
  subcategoryName,
  bsrRoot,
  bsrRootCategory,
  fulfillment,
  isSponsored,
  appearsSponsored,
  sponsoredPositions,
  imageUrl,
  asin,
  isSelected = false,
  onSelect,
  primeEligible,
  fulfillment_status,
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

  // Determine if we should show ~ prefix (for estimated, not for sp_api)
  const showEstimatePrefix = bsrSource !== 'sp_api' || bsrContext === null || bsrContext === undefined;
  
  // Use subcategory rank if available, otherwise fallback to bsr
  const displaySubcategoryBsr = subcategoryBsr ?? bsr;
  const displaySubcategoryName = subcategoryName ?? bsrContext?.chosen_category_name;

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

      {/* BSR Display */}
      <div className="text-sm text-[#6B7280] mb-3 space-y-1">
        {/* Subcategory Rank */}
        {displaySubcategoryBsr !== null && displaySubcategoryBsr !== undefined && displaySubcategoryBsr > 0 ? (
          <div>
            Subcategory Rank: #{displaySubcategoryBsr.toLocaleString()}
            {displaySubcategoryName ? ` in ${displaySubcategoryName}` : ''}
          </div>
        ) : (
          <div>Subcategory Rank: —</div>
        )}
        {/* Main Category BSR */}
        {bsrRoot !== null && bsrRoot !== undefined && bsrRoot > 0 ? (
          <div>
            Main Category BSR: #{bsrRoot.toLocaleString()}
            {bsrRootCategory ? ` in ${bsrRootCategory}` : ''}
          </div>
        ) : (
          <div>Main Category BSR: —</div>
        )}
      </div>

      {/* Spacer to push revenue section to bottom */}
      <div className="flex-1" />

      {/* Revenue Section - Always shows monthly units and revenue */}
      <div className="bg-[#F9FAFB] -mx-4 -mb-4 px-4 py-3 mt-3 rounded-b-xl border-t border-[#E5E7EB]">
        {/* Monthly Revenue - Always shown */}
        <div className="mb-2">
          <div className="text-xs text-[#6B7280] mb-1 flex items-center gap-1">
            Monthly Revenue
            {showEstimatePrefix && (
              <span className="text-[10px] text-[#9CA3AF]">(~estimate)</span>
            )}
          </div>
          {monthlyRevenue !== null && monthlyRevenue !== undefined && monthlyRevenue >= 0 ? (
            <div className="text-xl font-bold text-[#111827]">
              {showEstimatePrefix ? '~' : ''}${(monthlyRevenue / 1000).toFixed(1)}K
              <span className="text-sm font-normal text-[#6B7280]"> / mo</span>
            </div>
          ) : (
            <div className="h-7 bg-gray-200 rounded animate-pulse" />
          )}
        </div>

        {/* Monthly Units - Always shown */}
        <div>
          <div className="text-xs text-[#6B7280] mb-1 flex items-center gap-1">
            Monthly Units
            {showEstimatePrefix && (
              <span className="text-[10px] text-[#9CA3AF]">(~estimate)</span>
            )}
          </div>
          {monthlyUnits !== null && monthlyUnits !== undefined && monthlyUnits >= 0 ? (
            <div className="text-sm font-medium text-[#111827]">
              {showEstimatePrefix ? '~' : ''}{monthlyUnits.toLocaleString()} units
            </div>
          ) : (
            <div className="h-5 bg-gray-200 rounded animate-pulse" />
          )}
        </div>

        {/* Badges Row */}
        <div className="flex gap-2 mt-3">
          {/* SPONSORED badge (ASIN-level: show if appearsSponsored, even if also ranks organically) */}
          {appearsSponsored && (
            (() => {
              // Calculate lowest sponsored position (sponsoredSlot)
              const sponsoredSlot = sponsoredPositions && sponsoredPositions.length > 0
                ? Math.min(...sponsoredPositions)
                : null;
              return (
                <span 
                  className="px-2 py-1 rounded-full text-[11px] font-medium bg-[#8B5CF6] text-white" 
                  title="This product appears as sponsored on Page 1"
                >
                  SPONSORED{sponsoredSlot ? ` #${sponsoredSlot}` : ''}
                </span>
              );
            })()
          )}
          {/* Legacy Sponsored/Organic/Unknown badge (fallback if appearsSponsored not available) */}
          {!appearsSponsored && isSponsored === true && (
            <span className="px-2 py-1 rounded-full text-[11px] font-medium bg-[#FED7AA] text-[#9A3412]" title="This listing is sponsored">
              Sponsored
            </span>
          )}
          {!appearsSponsored && isSponsored === false && (
            <span className="px-2 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700">
              Organic
            </span>
          )}
          {!appearsSponsored && isSponsored === null && (
            <span 
              className="px-2 py-1 rounded-full text-[11px] font-medium bg-gray-50 text-gray-500"
              title="Sponsored status not detected for this listing."
            >
              Unknown
            </span>
          )}
          {/* Prime Badge (from is_prime heuristic) */}
          {((primeEligible === true) || (fulfillment_status === 'PRIME')) && (
            <span 
              className="px-2 py-1 rounded-full text-[11px] font-medium bg-[#FFD700] text-[#B8860B] border border-[#DAA520]"
              title="Prime eligible (heuristic from is_prime, not a guarantee of FBA)"
            >
              Prime
            </span>
          )}
          {/* Fulfillment Badge (FBA or FBM only, not AMZ) - Keep for backward compatibility */}
          {(fulfillment === "FBA" || fulfillment === "FBM") && (
            <span 
              className={`px-2 py-1 rounded-full text-[11px] font-medium ${getFulfillmentBadgeStyle()}`}
              title={fulfillment === "FBA" ? "Fulfilled by Amazon" : "Fulfilled by Merchant"}
            >
              {fulfillment}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

