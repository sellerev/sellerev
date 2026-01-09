"use client";

import { Search, Loader2 } from "lucide-react";

interface SearchBarProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onAnalyze: () => void;
  loading?: boolean;
  readOnly?: boolean;
  inputError?: string | null;
}

export default function SearchBar({
  inputValue,
  onInputChange,
  onAnalyze,
  loading = false,
  readOnly = false,
  inputError = null,
}: SearchBarProps) {
  return (
    <div className="border-b border-gray-200 bg-white sticky top-16 z-40 shadow-sm">
      <div className="w-full px-6 py-4">
        <div className="flex gap-4 items-end">
          {/* Keyword Input Field */}
          <div className="flex-1 max-w-3xl">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Keyword
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                className={`w-full border rounded-xl pl-12 pr-4 py-3.5 text-base text-gray-900 placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent
                  transition-all duration-200
                  ${inputError 
                    ? "border-red-300 bg-red-50 focus:ring-red-500 focus:bg-white" 
                    : "border-gray-300 bg-white hover:border-gray-400 focus:bg-white"
                  } 
                  ${readOnly ? "bg-gray-50 cursor-not-allowed" : ""}`}
                value={inputValue}
                onChange={(e) => {
                  if (!readOnly) {
                    onInputChange(e.target.value);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading && !readOnly) {
                    onAnalyze();
                  }
                }}
                disabled={loading || readOnly}
                placeholder="Enter an Amazon keyword (e.g., food warmer, chalk, coffee maker)"
                readOnly={readOnly}
              />
            </div>
            {inputError && (
              <p className="text-red-600 text-sm mt-1.5 flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {inputError}
              </p>
            )}
          </div>

          {/* Analyze Button */}
          {readOnly ? (
            <div className="flex items-center gap-2 px-6 py-3.5 bg-gray-100 rounded-xl text-sm font-medium text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              View Only
            </div>
          ) : (
            <button
              className="bg-[#3B82F6] text-white rounded-xl px-8 py-3.5 font-semibold text-base
                hover:bg-[#2563EB] active:bg-[#1D4ED8]
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#3B82F6]
                transition-all duration-200 shadow-sm hover:shadow-md
                flex items-center gap-2 min-w-[140px] justify-center"
              onClick={onAnalyze}
              disabled={loading || !inputValue.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Analyzing…</span>
                </>
              ) : (
                <>
                  <Search className="h-5 w-5" />
                  <span>Analyze</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

