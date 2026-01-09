"use client";

import { useState, useMemo } from "react";

/**
 * Brand Moat Summary Component
 * 
 * Displays brand moat analysis with color-coded badge and sortable brand revenue breakdown table.
 * Deterministic UI - no AI generation.
 */

interface BrandRevenueBreakdown {
  brand: string;
  revenue: number;
  share_pct: number;
  asin_count: number;
  top10_count: number;
}

interface BrandMoatSummaryProps {
  level: "HARD" | "SOFT" | "NONE";
  top_brand: string | null;
  top_brand_share_pct: number;
  top_3_share_pct: number;
  unique_brand_count: number;
  brand_revenue_breakdown: BrandRevenueBreakdown[];
}

type SortColumn = "brand" | "revenue" | "share_pct" | "asin_count" | "top10_count";
type SortDirection = "asc" | "desc";

export default function BrandMoatSummary({
  level,
  top_brand,
  top_brand_share_pct,
  top_3_share_pct,
  unique_brand_count,
  brand_revenue_breakdown,
}: BrandMoatSummaryProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("share_pct");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Get badge color and explanation based on moat level
  const badgeConfig = useMemo(() => {
    switch (level) {
      case "HARD":
        return {
          color: "bg-red-100 text-red-800 border-red-200",
          text: "Hard Brand Moat",
          explanation: top_brand
            ? `${top_brand} controls ${top_brand_share_pct.toFixed(1)}% of Page-1 revenue${top_3_share_pct >= 75 ? `, with top 3 brands controlling ${top_3_share_pct.toFixed(1)}%` : ""}. Established brand dominance creates high entry barriers for new sellers.`
            : "Brand dominance creates high entry barriers for new sellers.",
        };
      case "SOFT":
        return {
          color: "bg-yellow-100 text-yellow-800 border-yellow-200",
          text: "Soft Brand Moat",
          explanation: top_brand
            ? `${top_brand} controls ${top_brand_share_pct.toFixed(1)}% of Page-1 revenue, with top 3 brands controlling ${top_3_share_pct.toFixed(1)}%. Moderate brand concentration requires clear differentiation to compete.`
            : "Moderate brand concentration requires clear differentiation to compete.",
        };
      case "NONE":
        return {
          color: "bg-green-100 text-green-800 border-green-200",
          text: "No Brand Moat",
          explanation: unique_brand_count > 0
            ? `Market is fragmented across ${unique_brand_count} brands. No single brand dominates, allowing new entry opportunities.`
            : "No significant brand dominance detected. Market allows new entry opportunities.",
        };
    }
  }, [level, top_brand, top_brand_share_pct, top_3_share_pct, unique_brand_count]);

  // Sort brand breakdown
  const sortedBreakdown = useMemo(() => {
    const sorted = [...brand_revenue_breakdown];
    
    sorted.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      
      switch (sortColumn) {
        case "brand":
          aVal = a.brand.toLowerCase();
          bVal = b.brand.toLowerCase();
          break;
        case "revenue":
          aVal = a.revenue;
          bVal = b.revenue;
          break;
        case "share_pct":
          aVal = a.share_pct;
          bVal = b.share_pct;
          break;
        case "asin_count":
          aVal = a.asin_count;
          bVal = b.asin_count;
          break;
        case "top10_count":
          aVal = a.top10_count;
          bVal = b.top10_count;
          break;
        default:
          return 0;
      }
      
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    
    return sorted;
  }, [brand_revenue_breakdown, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return (
        <span className="text-gray-400 text-xs ml-1">
          <svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </span>
      );
    }
    
    return sortDirection === "asc" ? (
      <span className="text-gray-600 text-xs ml-1">↑</span>
    ) : (
      <span className="text-gray-600 text-xs ml-1">↓</span>
    );
  };

  // Don't render if no breakdown data
  if (!brand_revenue_breakdown || brand_revenue_breakdown.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 p-5 bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* Badge and Explanation */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-3">
          <span
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold border ${badgeConfig.color}`}
          >
            {badgeConfig.text}
          </span>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">
          {badgeConfig.explanation}
        </p>
      </div>

      {/* Brand Revenue Breakdown Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("brand")}
              >
                <div className="flex items-center">
                  Brand
                  {getSortIcon("brand")}
                </div>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("revenue")}
              >
                <div className="flex items-center">
                  Page-1 Revenue
                  {getSortIcon("revenue")}
                </div>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("share_pct")}
              >
                <div className="flex items-center">
                  Revenue Share %
                  {getSortIcon("share_pct")}
                </div>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("asin_count")}
              >
                <div className="flex items-center">
                  ASINs on Page 1
                  {getSortIcon("asin_count")}
                </div>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("top10_count")}
              >
                <div className="flex items-center">
                  Top-10 ASIN Count
                  {getSortIcon("top10_count")}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedBreakdown.map((item, idx) => (
              <tr
                key={item.brand}
                className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
              >
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                  {item.brand}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                  {formatCurrency(item.revenue)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                  {item.share_pct.toFixed(1)}%
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                  {item.asin_count}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                  {item.top10_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

