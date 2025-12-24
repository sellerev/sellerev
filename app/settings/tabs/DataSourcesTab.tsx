"use client";

import { useState } from "react";

const DATA_SOURCES = [
  {
    name: "Amazon search results",
    source: "via Rainforest",
    status: "active",
    description: "Page 1 listings, prices, reviews, ratings, BSR",
  },
  {
    name: "SP-API",
    source: "fees, listings, ads — when connected",
    status: "optional",
    description: "Real FBA fees, listing data, advertising metrics",
  },
  {
    name: "Seller inputs & uploads",
    source: "your data",
    status: "active",
    description: "Preferences, constraints, uploaded files",
  },
  {
    name: "Modeled estimates",
    source: "clearly labeled",
    status: "active",
    description: "Search volume, revenue estimates, fulfillment mix",
  },
];

export default function DataSourcesTab() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-2">Data Sources Used</h3>
        <p className="text-sm text-gray-600 mb-6">
          Transparency about what data is real vs. estimated.
        </p>
      </div>

      <div className="space-y-3">
        {DATA_SOURCES.map((source) => (
          <div
            key={source.name}
            className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-green-600">✓</span>
                  <span className="font-medium text-gray-900">{source.name}</span>
                  <span className="text-xs text-gray-500">({source.source})</span>
                </div>
                <p className="text-sm text-gray-600">{source.description}</p>
              </div>
              <button
                onClick={() => setExpanded(expanded === source.name ? null : source.name)}
                className="ml-4 text-sm text-gray-500 hover:text-gray-700"
              >
                {expanded === source.name ? "Less" : "More"}
              </button>
            </div>

            {expanded === source.name && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="space-y-2 text-sm text-gray-600">
                  {source.name === "Modeled estimates" && (
                    <>
                      <p>
                        <strong>What is real vs estimated:</strong> Search volume, revenue, and
                        fulfillment mix are modeled estimates based on Page 1 data patterns.
                      </p>
                      <p>
                        <strong>When estimates are used:</strong> When Amazon doesn't provide
                        exact data (search volume, sales volume, conversion rates).
                      </p>
                      <p>
                        <strong>What affects accuracy:</strong> Number of Page 1 listings, review
                        distribution, category patterns, and sponsored ad density.
                      </p>
                    </>
                  )}
                  {source.name === "SP-API" && (
                    <>
                      <p>
                        <strong>What is real vs estimated:</strong> FBA fees are real when SP-API
                        is connected. Otherwise, fees are estimated from category averages.
                      </p>
                      <p>
                        <strong>When estimates are used:</strong> When SP-API is not connected or
                        data is unavailable for a specific ASIN.
                      </p>
                      <p>
                        <strong>What affects accuracy:</strong> SP-API connection status, ASIN
                        availability, and category-specific fee variations.
                      </p>
                    </>
                  )}
                  {source.name === "Amazon search results" && (
                    <>
                      <p>
                        <strong>What is real vs estimated:</strong> All Page 1 listing data
                        (prices, reviews, ratings, BSR) is real data from Amazon search results.
                      </p>
                      <p>
                        <strong>When estimates are used:</strong> Never for this source. All data
                        is directly from Amazon.
                      </p>
                      <p>
                        <strong>What affects accuracy:</strong> Search result freshness and
                        Amazon's data availability.
                      </p>
                    </>
                  )}
                  {source.name === "Seller inputs & uploads" && (
                    <>
                      <p>
                        <strong>What is real vs estimated:</strong> All seller-provided data is
                        treated as authoritative and real.
                      </p>
                      <p>
                        <strong>When estimates are used:</strong> Never for this source. Your
                        inputs override all estimates.
                      </p>
                      <p>
                        <strong>What affects accuracy:</strong> Completeness and accuracy of
                        your inputs.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Danger Zone */}
      <div className="border-t border-gray-200 pt-6 mt-8">
        <h3 className="font-semibold text-red-600 mb-4">Danger Zone</h3>
        <div className="space-y-3">
          <button
            onClick={() => {
              if (confirm("Clear all saved preferences? This cannot be undone.")) {
                // TODO: Implement clear all
                alert("Feature coming soon");
              }
            }}
            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Clear all saved preferences
          </button>
          <button
            onClick={() => {
              if (confirm("Disable memory entirely? Sellerev will stop learning your preferences.")) {
                // TODO: Implement disable memory
                alert("Feature coming soon");
              }
            }}
            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Disable memory entirely
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          These actions cannot be undone. Use with caution.
        </p>
      </div>
    </div>
  );
}
