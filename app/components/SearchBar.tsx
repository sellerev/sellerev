"use client";

import { Search, Loader2 } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";

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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch autocomplete suggestions
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    try {
      const response = await fetch(`/api/amazon/autocomplete?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          const limited = data.slice(0, 6);
          setSuggestions(limited);
          setShowDropdown(limited.length > 0);
          setSelectedIndex(-1);
        } else {
          setSuggestions([]);
          setShowDropdown(false);
        }
      } else {
        setSuggestions([]);
        setShowDropdown(false);
      }
    } catch (error) {
      // Fail silently - autocomplete is non-blocking
      setSuggestions([]);
      setShowDropdown(false);
    }
  }, []);

  // Debounced effect for autocomplete
  useEffect(() => {
    if (readOnly || loading) {
      return;
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer
    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestions(inputValue);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inputValue, fetchSuggestions, readOnly, loading]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        showDropdown &&
        dropdownRef.current &&
        inputRef.current &&
        !dropdownRef.current.contains(target) &&
        !inputRef.current.contains(target)
      ) {
        setShowDropdown(false);
      }
    };

    // Use mousedown instead of click to fire before blur
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showDropdown]);

  // Handle suggestion selection
  const selectSuggestion = useCallback((suggestion: string) => {
    onInputChange(suggestion);
    setShowDropdown(false);
    setSuggestions([]);
    setSelectedIndex(-1);
    // Focus back on input
    inputRef.current?.focus();
  }, [onInputChange]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle Enter key for analyze (when no dropdown or when not navigating)
    if (e.key === "Enter") {
      if (readOnly || loading) {
        return;
      }

      // If dropdown is closed or has no suggestions, run analyze
      if (!showDropdown || suggestions.length === 0) {
        e.preventDefault();
        onAnalyze();
        return;
      }

      // If dropdown is open, handle suggestion selection or analyze
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        selectSuggestion(suggestions[selectedIndex]);
      } else {
        // No suggestion selected, run analyze
        onAnalyze();
      }
      return;
    }

    // Only handle navigation keys when dropdown is open
    if (!showDropdown || suggestions.length === 0 || readOnly || loading) {
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Escape":
        e.preventDefault();
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
      default:
        // Allow default behavior for other keys
        break;
    }
  };

  return (
    <div className="flex gap-4 items-end">
          {/* Keyword Input Field */}
          <div className="flex-1 max-w-3xl">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Keyword
            </label>
            <div className="relative" ref={dropdownRef}>
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                ref={inputRef}
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
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  if (!readOnly && suggestions.length > 0) {
                    setShowDropdown(true);
                  }
                }}
                disabled={loading || readOnly}
                placeholder="Enter an Amazon keyword (e.g., food warmer, chalk, coffee maker)"
                readOnly={readOnly}
              />
              {/* Autocomplete Dropdown */}
              {showDropdown && suggestions.length > 0 && !readOnly && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-[240px] overflow-y-auto">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      type="button"
                      className={`w-full text-left px-4 py-2.5 text-sm text-gray-900 hover:bg-gray-50 transition-colors
                        ${index === selectedIndex ? "bg-gray-100" : ""}
                        ${index === 0 ? "rounded-t-lg" : ""}
                        ${index === suggestions.length - 1 ? "rounded-b-lg" : ""}`}
                      onClick={() => selectSuggestion(suggestion)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
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
  );
}

