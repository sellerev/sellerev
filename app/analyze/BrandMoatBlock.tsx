"use client";

import { useState } from "react";

/**
 * Brand Moat Block Component
 * 
 * Visually explains whether Page-1 is controlled by brands (a moat) or fragmented.
 * Uses ONLY canonical Page-1 data - never relies on lazy ASIN refinement data.
 */

interface BrandBreakdown {
  brand: string;
  asin_count: number;
  total_revenue: number;
  revenue_share_pct: number;
}

interface BrandMoatBlockProps {
  moat_strength: "strong" | "moderate" | "weak" | "none";
  total_brands_count: number;
  top_brand_revenue_share_pct: number;
  top_3_brands_revenue_share_pct: number;
  brand_breakdown: BrandBreakdown[];
  // Optional: for hover interaction to highlight listings
  onBrandHover?: (brand: string | null) => void;
}

export default function BrandMoatBlock({
  moat_strength,
  total_brands_count,
  top_brand_revenue_share_pct,
  top_3_brands_revenue_share_pct,
  brand_breakdown,
  onBrandHover,
}: BrandMoatBlockProps) {
  const [hoveredBrand, setHoveredBrand] = useState<string | null>(null);

  // Get badge color and text based on moat strength
  const badgeConfig = {
    strong: {
      color: "bg-red-100 text-red-800 border-red-200",
      text: "Brand Moat: Strong",
      tooltip: "Strong brand dominance creates high entry barriers. One or more brands control a significant portion of Page-1 revenue, making it difficult for new sellers to compete.",
    },
    moderate: {
      color: "bg-orange-100 text-orange-800 border-orange-200",
      text: "Brand Moat: Moderate",
      tooltip: "Moderate brand concentration suggests some established players, but opportunities still exist with clear differentiation.",
    },
    weak: {
      color: "bg-yellow-100 text-yellow-800 border-yellow-200",
      text: "Brand Moat: Weak",
      tooltip: "Weak brand moat indicates limited brand dominance. Market is more open to new entrants.",
    },
    none: {
      color: "bg-green-100 text-green-800 border-green-200",
      text: "Brand Moat: None",
      tooltip: "No significant brand moat detected. Market is fragmented across many brands, creating opportunities for new sellers.",
    },
  }[moat_strength];

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleBrandHover = (brand: string) => {
    setHoveredBrand(brand);
    if (onBrandHover) {
      onBrandHover(brand);
    }
  };

  const handleBrandLeave = () => {
    setHoveredBrand(null);
    if (onBrandHover) {
      onBrandHover(null);
    }
  };

  // Get top brand name
  const topBrand = brand_breakdown.length > 0 ? brand_breakdown[0] : null;

  return (
    <div className="mb-6 p-5 bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* Brand Moat Badge */}
      <div className="mb-4">
        <div className="group relative inline-block">
          <span
            className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold border ${badgeConfig.color}`}
          >
            {badgeConfig.text}
            <svg
              className="w-4 h-4 ml-2 text-current opacity-70"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-80 p-3 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
            {badgeConfig.tooltip}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
              <div className="border-4 border-transparent border-t-gray-900"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Brand Summary Row */}
      <div className="mb-4 space-y-2 text-sm text-gray-700">
        <div>
          <span className="font-medium">Page 1 contains </span>
          <span className="font-semibold text-gray-900">{total_brands_count}</span>
          <span className="font-medium"> {total_brands_count === 1 ? "brand" : "brands"}</span>
        </div>
        {topBrand && (
          <div>
            <span className="font-medium">Top brand </span>
            <span
              className="font-semibold text-gray-900 cursor-pointer hover:text-primary transition-colors"
              onMouseEnter={() => handleBrandHover(topBrand.brand)}
              onMouseLeave={handleBrandLeave}
            >
              {topBrand.brand}
            </span>
            <span className="font-medium"> controls </span>
            <span className="font-semibold text-gray-900">{top_brand_revenue_share_pct.toFixed(1)}%</span>
            <span className="font-medium"> of revenue</span>
          </div>
        )}
        <div>
          <span className="font-medium">Top 3 brands control </span>
          <span className="font-semibold text-gray-900">{top_3_brands_revenue_share_pct.toFixed(1)}%</span>
          <span className="font-medium"> of revenue</span>
        </div>
      </div>

      {/* Brand Breakdown Table */}
      {brand_breakdown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Brand
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  ASINs on Page 1
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Page-1 Revenue
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Revenue Share %
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {brand_breakdown.map((item, idx) => {
                const isTopBrand = idx === 0;
                const isHovered = hoveredBrand === item.brand;
                
                return (
                  <tr
                    key={item.brand}
                    className={`
                      ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                      ${isTopBrand ? "bg-primary/10 border-l-4 border-l-primary" : ""}
                      ${isHovered ? "bg-primary/15" : ""}
                      transition-colors
                      ${onBrandHover ? "cursor-pointer" : ""}
                    `}
                    onMouseEnter={() => handleBrandHover(item.brand)}
                    onMouseLeave={handleBrandLeave}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        <span className={`text-sm font-medium ${isTopBrand ? "text-primary" : "text-gray-900"}`}>
                          {item.brand}
                        </span>
                        {isTopBrand && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">
                            Top
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                      {item.asin_count}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                      {formatCurrency(item.total_revenue)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                      {item.revenue_share_pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {brand_breakdown.length === 0 && (
        <div className="text-sm text-gray-500 italic text-center py-4">
          No brand data available
        </div>
      )}
    </div>
  );
}

