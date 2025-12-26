"use client";

import { useState, useRef, useEffect, useCallback } from "react";

/**
 * ChatSidebar - Context-Locked Refinement Tool
 * 
 * This chat is NOT a general chatbot.
 * It is a context-locked refinement tool for a single analysis_run.
 * 
 * HARD CONSTRAINTS:
 * - Chat only works if analysis_run_id exists
 * - All responses grounded in cached data only
 * - NEVER invents data
 * - NEVER fetches new market data
 * - If data is missing, says so explicitly
 * 
 * Behavior like Spellbook's sidebar:
 * Iterative, grounded, professional, and trustworthy.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface MarketSnapshot {
  avg_reviews: number | null;
  sponsored_count: number;
  dominance_score: number;
  total_page1_listings: number;
}

interface MarginSnapshot {
  selling_price: number;
  cogs_assumed_low: number;
  cogs_assumed_high: number;
  fba_fees: number | null;
  net_margin_low_pct: number;
  net_margin_high_pct: number;
  breakeven_price_low: number;
  breakeven_price_high: number;
  confidence: "estimated" | "refined";
  source: "assumption_engine" | "amazon_fees";
}

interface ChatSidebarProps {
  /** The analysis run ID to anchor chat to. If null, chat is disabled. */
  analysisRunId: string | null;
  /** Initial messages loaded from history */
  initialMessages?: ChatMessage[];
  /** Callback when messages change (for parent state sync) */
  onMessagesChange?: (messages: ChatMessage[]) => void;
  /** Market snapshot data for dynamic question chips */
  marketSnapshot?: MarketSnapshot | null;
  /** Callback when margin snapshot is updated from chat */
  onMarginSnapshotUpdate?: (snapshot: MarginSnapshot) => void;
  /** Analysis mode: 'KEYWORD' for market discovery */
  analysisMode?: 'KEYWORD' | null;
  /** Selected listing (for AI context) */
  selectedListing?: any | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED FOLLOW-UP QUESTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate Market Pressure from snapshot data (same logic as AnalyzeForm)
 */
function calculateMarketPressure(
  avgReviews: number | null,
  sponsoredCount: number,
  dominanceScore: number
): "Low" | "Moderate" | "High" {
  let pressureScore = 0;

  if (avgReviews !== null && avgReviews !== undefined) {
    if (avgReviews >= 5000) pressureScore += 2;
    else if (avgReviews >= 1000) pressureScore += 1;
  }

  if (sponsoredCount >= 8) pressureScore += 2;
  else if (sponsoredCount >= 4) pressureScore += 1;

  if (dominanceScore >= 40) pressureScore += 2;
  else if (dominanceScore >= 20) pressureScore += 1;

  if (pressureScore <= 2) return "Low";
  if (pressureScore <= 4) return "Moderate";
  return "High";
}

/**
 * Get suggested questions based on analysis mode and market snapshot
 * 
 * These are neutral, interpretive prompts - not prescriptive or verdict-like.
 * Show 3-4 suggestions when analysis first loads (no messages yet).
 */
function getSuggestedQuestions(
  analysisMode: 'ASIN' | 'KEYWORD' | null | undefined,
  marketSnapshot: MarketSnapshot | null,
  selectedListing: any | null = null
): string[] {
  // If a listing is selected, show contextual suggestions
  if (selectedListing) {
    return [
      "Why is this listing ranking despite fewer reviews?",
      "Is this price point typical for Page 1?",
      "What advantages does this listing appear to have?",
    ];
  }
  
  // KEYWORD mode: Neutral, interpretive market questions
  if (analysisMode === 'KEYWORD') {
    // Default neutral questions (interpretive, not prescriptive)
    return [
      "How competitive does this market look?",
      "What stands out on Page 1?",
      "How do sellers usually assess this category?",
      "Which listings are earning more than expected?",
    ];
  }
  
  // Fallback (no mode detected)
  return [
    "How competitive does this market look?",
    "What stands out on Page 1?",
    "How do sellers usually assess this category?",
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUST INDICATOR CHIPS
// Source chips shown beneath assistant messages to reinforce grounding
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_CHIPS = [
  "This analysis",
  "Amazon market data",
  "Your seller profile",
] as const;

/**
 * SourceChips - Renders trust indicator chips beneath assistant messages
 * Shows 2-3 chips per message, always includes "This analysis"
 */
function SourceChips() {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
      {SOURCE_CHIPS.map((chip) => (
        <span
          key={chip}
          className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-gray-500 bg-gray-100 rounded"
        >
          <svg
            className="w-2.5 h-2.5 mr-1 text-gray-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          {chip}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ChatSidebar({
  analysisRunId,
  initialMessages = [],
  onMessagesChange,
  marketSnapshot = null,
  onMarginSnapshotUpdate,
  analysisMode = null,
  selectedListing = null,
}: ChatSidebarProps) {
  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────
  
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingMemoryConfirmation, setPendingMemoryConfirmation] = useState<{
    pendingMemoryId: string;
    message: string;
    memoryDescription: string;
    subtext?: string;
  } | null>(null);
  
  // Refs for auto-scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────────────────────

  // Sync messages with parent when they change
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  // Reset messages when analysis changes
  useEffect(() => {
    setMessages(initialMessages);
  }, [analysisRunId, initialMessages]);

  // Show contextual suggestions when a listing is selected (if no messages yet)
  // This happens silently - chat context updates, then suggestions appear
  useEffect(() => {
    // If a listing is selected and we have no messages, the suggestions will automatically
    // update via getSuggestedQuestions() which checks selectedListing
    // No need to force a re-render - the component will naturally show updated suggestions
  }, [selectedListing]);

  // Auto-scroll to bottom when new messages arrive or streaming updates
  // Scrolls the messages container, not the page (prevents page from scrolling)
  useEffect(() => {
    if (messagesContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current;
          // Always scroll to bottom during streaming or when new messages arrive
          // This keeps the chat viewport fixed while content scrolls internally
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, [messages, streamingContent, isLoading]);

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (messageOverride?: string) => {
    const messageToSend = messageOverride || input.trim();
    
    // Guard: Must have analysis_run_id and message
    if (!analysisRunId || !messageToSend) return;

    // Add user message immediately
    const userMessage: ChatMessage = {
      role: "user",
      content: messageToSend,
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");

    try {
      // Call streaming API
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisRunId,
          message: messageToSend,
          selectedListing: selectedListing || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Chat request failed");
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let accumulatedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim() !== "");

        for (const line of lines) {
          if (line === "data: [DONE]") {
            continue;
          }

          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.slice(6));
              
              // Handle metadata (e.g., cost override updates, memory confirmation)
              if (json.metadata) {
                if (json.metadata.type === "cost_override_applied" || json.metadata.type === "margin_snapshot_refined") {
                  const { margin_snapshot } = json.metadata;
                  if (margin_snapshot && onMarginSnapshotUpdate) {
                    onMarginSnapshotUpdate(margin_snapshot);
                  }
                } else if (json.metadata.type === "memory_confirmation") {
                  // Show memory confirmation prompt
                  setPendingMemoryConfirmation(json.metadata);
                }
              }
              
              // Handle content chunks
              if (json.content) {
                accumulatedContent += json.content;
                setStreamingContent(accumulatedContent);
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      // Add complete assistant message
      if (accumulatedContent.trim()) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: accumulatedContent,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      // Add error message
      const errorMessage = error instanceof Error ? error.message : "Chat failed";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${errorMessage}. Please try again.`,
        },
      ]);
    } finally {
      setIsLoading(false);
      setStreamingContent("");
      // Focus input after send
      inputRef.current?.focus();
    }
  }, [analysisRunId, input, onMarginSnapshotUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isLoading && input.trim() && analysisRunId) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const isDisabled = !analysisRunId;

  return (
    <div className="border-l bg-white flex flex-col h-full" style={{ width: "30%", minWidth: "320px" }}>
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* HEADER                                                              */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="p-4 border-b bg-gray-50 shrink-0">
        <h2 className="font-semibold text-gray-900">AI Assistant</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {analysisRunId
            ? "Explains the visible Page-1 data only"
            : "Complete an analysis to start chatting"}
        </p>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MESSAGES AREA                                                       */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50"
        style={{ minHeight: 0 }}
      >
        {isDisabled ? (
          /* Pre-analysis: Show capabilities */
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-3 bg-gray-200 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">
              The AI assistant will help you:
            </p>
            <ul className="text-xs text-gray-400 mt-2 space-y-1">
              <li>• Understand market data</li>
              <li>• Compare listings</li>
              <li>• Explore different scenarios</li>
              <li>• Interpret what you're seeing</li>
            </ul>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          /* Post-analysis, no messages yet: Show suggested question chips (quiet by default) */
          <div className="space-y-3">
            <p className="text-xs text-gray-500 text-center mb-4">
              Suggested questions:
            </p>
            {getSuggestedQuestions(analysisMode, marketSnapshot, selectedListing).slice(0, 4).map((question, idx) => (
              <button
                key={idx}
                className="w-full text-left text-sm p-3 bg-white border rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => sendMessage(question)}
                disabled={isLoading}
              >
                {question}
              </button>
            ))}
          </div>
        ) : (
          /* Chat messages */
          <>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg ${
                  msg.role === "user"
                    ? "bg-black text-white ml-6"
                    : "bg-white border mr-6 shadow-sm"
                }`}
              >
                <div
                  className={`text-xs font-medium mb-1.5 ${
                    msg.role === "user" ? "text-gray-300" : "text-gray-500"
                  }`}
                >
                  {msg.role === "user" ? "You" : "Sellerev"}
                </div>
                <div
                  className={`text-sm whitespace-pre-wrap leading-relaxed ${
                    msg.role === "user" ? "" : "text-gray-700"
                  }`}
                >
                  {msg.content}
                </div>
                {/* Trust indicator chips - assistant messages only */}
                {msg.role === "assistant" && !msg.content.startsWith("Error:") && (
                  <SourceChips />
                )}
              </div>
            ))}

            {/* Streaming message indicator */}
            {isLoading && streamingContent && (
              <div className="bg-white border rounded-lg p-3 mr-6 shadow-sm">
                <div className="text-xs font-medium mb-1.5 text-gray-500">
                  Sellerev
                </div>
                <div className="text-sm whitespace-pre-wrap text-gray-700 leading-relaxed">
                  {streamingContent}
                  <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5" />
                </div>
                {/* Show chips while streaming (faded) */}
                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100 opacity-50">
                  {SOURCE_CHIPS.map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-gray-500 bg-gray-100 rounded"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Loading indicator (before streaming starts) */}
            {isLoading && !streamingContent && (
              <div className="bg-white border rounded-lg p-3 mr-6 shadow-sm">
                <div className="text-xs font-medium mb-1.5 text-gray-500">
                  Sellerev
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"
                    style={{ animationDelay: "0.1s" }}
                  />
                  <span
                    className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  />
                </div>
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MEMORY CONFIRMATION PROMPT                                           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {pendingMemoryConfirmation && (
        <div className="p-4 border-t bg-blue-50">
          <p className="text-sm text-gray-900 mb-2 font-medium">
            {pendingMemoryConfirmation.message}
          </p>
          <p className="text-xs text-gray-600 mb-3">
            {pendingMemoryConfirmation.memoryDescription}
          </p>
          {pendingMemoryConfirmation.subtext && (
            <p className="text-xs text-gray-500 mb-3">
              {pendingMemoryConfirmation.subtext}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={async () => {
                try {
                  const response = await fetch("/api/memory/confirm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      pendingMemoryId: pendingMemoryConfirmation.pendingMemoryId,
                      confidence: "medium",
                    }),
                  });
                  if (response.ok) {
                    setPendingMemoryConfirmation(null);
                  } else {
                    alert("Failed to save preference");
                  }
                } catch (error) {
                  console.error("Error confirming memory:", error);
                  alert("Failed to save preference");
                }
              }}
              className="px-3 py-1.5 bg-black text-white rounded text-sm font-medium hover:bg-gray-800"
            >
              Save it
            </button>
            <button
              onClick={async () => {
                try {
                  const response = await fetch("/api/memory/reject", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      pendingMemoryId: pendingMemoryConfirmation.pendingMemoryId,
                    }),
                  });
                  if (response.ok) {
                    setPendingMemoryConfirmation(null);
                  } else {
                    alert("Failed to reject preference");
                  }
                } catch (error) {
                  console.error("Error rejecting memory:", error);
                  alert("Failed to reject preference");
                }
              }}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50"
            >
              Don't save
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* INPUT AREA                                                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="p-4 border-t bg-white shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isDisabled ? "Run an analysis first" : "Ask about the analysis..."}
            disabled={isDisabled || isLoading}
          />
          <button
            className="bg-black text-white rounded-lg px-4 py-2 font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={() => sendMessage()}
            disabled={isDisabled || !input.trim() || isLoading}
          >
            {isLoading ? (
              <svg
                className="animate-spin h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              "Send"
            )}
          </button>
        </div>
        
        {/* One-time trust disclaimer */}
        {!isDisabled && (
          <p className="text-[10px] text-gray-400 mt-2 text-center leading-relaxed">
            Responses are based on Amazon market data, your seller profile, and this analysis. No live scraping or predictions.
          </p>
        )}
      </div>
    </div>
  );
}

