"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Copy, Check, ChevronRight, History } from "lucide-react";
import HistoryPanel from "./components/HistoryPanel";

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

export interface Citation {
  type: "asin";
  asin: string;
  source: "page1_estimate" | "rainforest_product";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  citations?: Citation[];
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
  /** The snapshot ID (Tier-1/Tier-2 identifier). Used as primary identifier if analysisRunId is null. */
  snapshotId?: string | null;
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
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean;
  /** Callback to toggle collapse state */
  onToggleCollapse?: () => void;
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
 * ASIN Citation Chip Component
 * 
 * Renders inline ASIN citations as small pill-style chips.
 * - Subtle neutral styling (matches system messages)
 * - No hover tooltip yet
 * - Visual distinction for verified (rainforest_product) vs estimated (page1_estimate)
 */
function AsinCitationChip({ citation }: { citation: Citation }) {
  const isVerified = citation.source === "rainforest_product";
  
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
        isVerified
          ? "bg-gray-50 border border-gray-300 text-gray-700"
          : "bg-gray-50 border border-gray-200 text-gray-600"
      }`}
      title={isVerified ? "Verified via product API" : "Estimated from Page-1 data"}
    >
      {isVerified && (
        <svg
          className="w-2.5 h-2.5 mr-1 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
      ASIN {citation.asin}
    </span>
  );
}

function SourceChips() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SOURCE_CHIPS.map((chip) => (
        <span
          key={chip}
          className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded"
        >
          <svg
            className="w-2.5 h-2.5 mr-1 text-gray-500"
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

/**
 * Sanitizes verdict language from chat messages (presentation-layer only)
 * Replaces explicit verdict headers with neutral, Cursor-style framing
 * This is UI-only cleanup - does not modify stored data or backend logic
 */
function sanitizeVerdictLanguage(content: string): string {
  if (!content) return content;
  
  let sanitized = content;
  
  // Replace "VERDICT:" headers (case-insensitive, handles various formats)
  sanitized = sanitized.replace(/^VERDICT:\s*(GO|NO-GO|NO\s+GO|CAUTION|CONDITIONAL)/gim, 'KEY OBSERVATIONS:');
  sanitized = sanitized.replace(/^VERDICT:\s*$/gim, 'KEY OBSERVATIONS:');
  sanitized = sanitized.replace(/VERDICT:\s*(GO|NO-GO|NO\s+GO|CAUTION|CONDITIONAL)/gim, 'KEY OBSERVATIONS:');
  
  // Replace standalone verdict labels on their own lines
  sanitized = sanitized.replace(/^(GO|NO-GO|NO\s+GO|CAUTION|CONDITIONAL)\s*$/gim, (match) => {
    // If it's a standalone line, remove it entirely or replace with neutral text
    // For now, just remove standalone verdict labels
    return '';
  });
  
  // Replace "WHY:" with "WHAT STANDS OUT:" for neutral framing
  sanitized = sanitized.replace(/^WHY:\s*$/gim, 'WHAT STANDS OUT:');
  sanitized = sanitized.replace(/^WHY\s*$/gim, 'WHAT STANDS OUT:');
  
  // Replace "THIS FAILS UNLESS" with neutral framing
  sanitized = sanitized.replace(/THIS FAILS UNLESS ALL OF THE FOLLOWING ARE TRUE:/gim, 'CONSTRAINTS TO CONSIDER: Entry would require ALL of the following conditions:');
  sanitized = sanitized.replace(/THIS FAILS UNLESS:/gim, 'CONSTRAINTS TO CONSIDER: Entry would require the following conditions:');
  
  // Clean up any double line breaks that might result from removals
  sanitized = sanitized.replace(/\n\n\n+/g, '\n\n');
  
  return sanitized.trim();
}

export default function ChatSidebar({
  analysisRunId,
  snapshotId = null,
  initialMessages = [],
  onMessagesChange,
  marketSnapshot = null,
  onMarginSnapshotUpdate,
  analysisMode = null,
  selectedListing = null,
  isCollapsed = false,
  onToggleCollapse,
}: ChatSidebarProps) {
  // Use snapshotId as primary identifier if analysisRunId is not available (Tier-1/Tier-2 model)
  // For chat API, we still need analysisRunId, but UI unlocking uses snapshotId
  const effectiveId = analysisRunId || snapshotId;
  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────
  
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [pendingMemoryConfirmation, setPendingMemoryConfirmation] = useState<{
    pendingMemoryId: string;
    message: string;
    memoryDescription: string;
    subtext?: string;
  } | null>(null);
  const [escalationState, setEscalationState] = useState<{ question: string; asin: string | null } | null>(null);
  const [currentCitations, setCurrentCitations] = useState<Citation[]>([]);
  
  // Smart scrolling state
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const userHasScrolledRef = useRef(false);
  
  // History panel state
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  
  // Refs for auto-scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ─────────────────────────────────────────────────────────────────────────

  // Sync messages with parent when they change
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  // Reset messages when analysis changes (use effectiveId to detect changes)
  useEffect(() => {
    setMessages(initialMessages);
  }, [effectiveId, initialMessages]);

  // Show contextual suggestions when a listing is selected (if no messages yet)
  // This happens silently - chat context updates, then suggestions appear
  useEffect(() => {
    // If a listing is selected and we have no messages, the suggestions will automatically
    // update via getSuggestedQuestions() which checks selectedListing
    // No need to force a re-render - the component will naturally show updated suggestions
  }, [selectedListing]);

  // Check if user is near bottom (within 50px threshold)
  const checkIfNearBottom = useCallback(() => {
    if (!messagesContainerRef.current) return false;
    const container = messagesContainerRef.current;
    const threshold = 50;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= threshold;
  }, []);

  // Initial check on mount - assume user starts at bottom
  useEffect(() => {
    if (messagesContainerRef.current) {
      const nearBottom = checkIfNearBottom();
      setIsNearBottom(nearBottom);
      if (nearBottom) {
        userHasScrolledRef.current = false;
        setShowJumpToBottom(false);
      }
    }
  }, [checkIfNearBottom]);

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const nearBottom = checkIfNearBottom();
      setIsNearBottom(nearBottom);
      
      // If user scrolls up, mark that they've manually scrolled
      if (!nearBottom) {
        userHasScrolledRef.current = true;
        setShowJumpToBottom(true);
      } else {
        // User scrolled back to bottom, reset flag and hide button
        setShowJumpToBottom(false);
        userHasScrolledRef.current = false;
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [checkIfNearBottom]);

  // Auto-scroll to bottom ONLY if user is already at bottom
  // This prevents interrupting user when they're reading previous messages
  useEffect(() => {
    if (messagesContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current;
          
          // Re-check if near bottom after DOM update (content may have changed)
          const currentlyNearBottom = checkIfNearBottom();
          
          // Only auto-scroll if user is near bottom (hasn't scrolled up)
          // This allows auto-scroll during streaming if user stays at bottom
          if (currentlyNearBottom && !userHasScrolledRef.current) {
            container.scrollTop = container.scrollHeight;
            setIsNearBottom(true);
            setShowJumpToBottom(false);
          } else if (userHasScrolledRef.current) {
            // User has scrolled up and new content arrived, show jump to bottom button
            // Don't auto-scroll - let user control their view
            if (!currentlyNearBottom) {
              setShowJumpToBottom(true);
            }
          }
        }
      });
    }
  }, [messages, streamingContent, isLoading, checkIfNearBottom]);

  // Smooth scroll to bottom function
  const scrollToBottom = useCallback((smooth = true) => {
    if (!messagesContainerRef.current) return;
    const container = messagesContainerRef.current;
    
    if (smooth) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
    
    setIsNearBottom(true);
    setShowJumpToBottom(false);
    userHasScrolledRef.current = false;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (messageOverride?: string) => {
    const messageToSend = messageOverride || input.trim();
    
    // Guard: Must have analysis_run_id (for chat API) and message
    // Note: Chat API still requires analysisRunId, but UI unlocks with snapshotId
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
              
              // Handle metadata (e.g., cost override updates, memory confirmation, escalation, citations)
              if (json.metadata) {
                if (json.metadata.type === "cost_override_applied" || json.metadata.type === "margin_snapshot_refined") {
                  const { margin_snapshot } = json.metadata;
                  if (margin_snapshot && onMarginSnapshotUpdate) {
                    onMarginSnapshotUpdate(margin_snapshot);
                  }
                } else if (json.metadata.type === "memory_confirmation") {
                  // Show memory confirmation prompt
                  setPendingMemoryConfirmation(json.metadata);
                } else if (json.metadata.type === "escalation_started") {
                  // Show escalation loading state
                  setEscalationState({
                    question: json.metadata.question || "",
                    asin: json.metadata.asin || null,
                  });
                } else if (json.metadata.type === "citations") {
                  // Store citations for the current message
                  setCurrentCitations(json.metadata.citations || []);
                }
              }
              
              // Handle content chunks
              if (json.content) {
                // Clear escalation state when content starts streaming
                if (escalationState) {
                  setEscalationState(null);
                }
                accumulatedContent += json.content;
                setStreamingContent(accumulatedContent);
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      // Add complete assistant message with citations
      if (accumulatedContent.trim()) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: accumulatedContent,
          citations: currentCitations.length > 0 ? currentCitations : undefined,
        };
        setMessages((prev) => [...prev, assistantMessage]);
        // Clear citations for next message
        setCurrentCitations([]);
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
      setEscalationState(null); // Clear escalation state when done
      // Focus input after send
      inputRef.current?.focus();
    }
  }, [analysisRunId, input, onMarginSnapshotUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Use effectiveId for UI enabling, but chat API still needs analysisRunId
    if (e.key === "Enter" && !e.shiftKey && !isLoading && input.trim() && effectiveId) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Auto-resize textarea as user types (like Cursor chat)
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const scrollHeight = inputRef.current.scrollHeight;
      // Max height of ~6 lines (24px line height * 6 = 144px)
      const maxHeight = 144;
      const newHeight = Math.min(scrollHeight, maxHeight);
      inputRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // UI unlocks with snapshotId (Tier-1/Tier-2), but chat API still needs analysisRunId
  // For now, unlock UI if either exists (chat will work only if analysisRunId exists)
  const isDisabled = !effectiveId;

  return (
    <div className="h-full bg-white flex flex-col overflow-hidden border-l border-[#E5E7EB]" style={{ minHeight: 0 }}>
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* HEADER                                                              */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 shrink-0 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-900 text-sm">AI Assistant</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {analysisRunId
              ? "Explains the visible Page-1 data only"
              : "Complete an analysis to start chatting"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* History button */}
          <button
            ref={historyButtonRef}
            onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
            className="flex-shrink-0 p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-300"
            aria-label="View analysis history"
            title="View history"
          >
            <History className="w-4 h-4" />
          </button>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="flex-shrink-0 p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-300"
              aria-label="Collapse chat sidebar"
              title="Collapse sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MESSAGES AREA                                                       */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 relative bg-gray-50"
        style={{ minHeight: 0 }}
      >
        {isDisabled ? (
          /* Pre-analysis: Show capabilities */
          <div className="text-center py-12">
            <div className="w-14 h-14 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg
                className="w-7 h-7 text-gray-400"
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
            <p className="text-gray-900 text-sm font-medium mb-3">
              The AI assistant will help you:
            </p>
            <ul className="text-xs text-gray-600 space-y-1.5 max-w-[280px] mx-auto">
              <li>• Understand market data</li>
              <li>• Compare listings</li>
              <li>• Explore different scenarios</li>
              <li>• Interpret what you're seeing</li>
            </ul>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          /* Post-analysis, no messages yet: Show suggested question chips (quiet by default) */
          <div className="space-y-2.5">
            <p className="text-xs text-gray-500 text-center mb-4">
              Suggested questions:
            </p>
            {getSuggestedQuestions(analysisMode, marketSnapshot, selectedListing).slice(0, 4).map((question, idx) => (
              <button
                key={idx}
                className="w-full text-left text-sm px-4 py-2.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
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
            {messages.map((msg, idx) => {
              const messageContent = msg.role === "assistant" ? sanitizeVerdictLanguage(msg.content) : msg.content;
              const isCopied = copiedIndex === idx;
              
              const handleCopy = async (e: React.MouseEvent | React.KeyboardEvent) => {
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(messageContent);
                  setCopiedIndex(idx);
                  setTimeout(() => setCopiedIndex(null), 2000);
                } catch (err) {
                  console.error("Failed to copy message:", err);
                }
              };

              return (
                <div
                  key={idx}
                  className={`group relative w-full flex ${
                    msg.role === "user" ? "justify-start" : "justify-start"
                  }`}
                >
                  <div
                    className={`group relative max-w-[85%] px-4 py-3 rounded-lg border shadow-sm ${
                      msg.role === "user"
                        ? "bg-white border-gray-200 text-gray-900"
                        : "bg-white border-gray-200 text-gray-900"
                    }`}
                  >
                    {/* Hover-reveal actions - Cursor-style: hidden by default, fade in on hover/focus */}
                    <div className="absolute right-2 top-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 has-[:focus]:opacity-100 transition-all duration-150 ease-out translate-y-[-2px] group-hover:translate-y-0 has-[:focus]:translate-y-0">
                      <button
                        onClick={handleCopy}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleCopy(e);
                          }
                        }}
                        className="p-1.5 rounded-md transition-all focus:outline-none focus:ring-1 hover:bg-gray-100 focus:ring-gray-300 focus:bg-gray-100 text-gray-500 hover:text-gray-700"
                        aria-label="Copy message"
                        title="Copy message"
                        tabIndex={0}
                      >
                        {isCopied ? (
                          <Check className="w-3.5 h-3.5 text-gray-700" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Message header with role label */}
                    <div className="text-[11px] font-medium mb-2 text-gray-500">
                      {msg.role === "user" ? "You" : "Sellerev"}
                    </div>
                    
                    {/* Message content */}
                    <div className="text-sm whitespace-pre-wrap leading-relaxed text-gray-900">
                      {messageContent}
                    </div>
                    
                    {/* ASIN Citation Chips - inline at end of message */}
                    {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {msg.citations.map((citation, citationIdx) => (
                          <AsinCitationChip key={citationIdx} citation={citation} />
                        ))}
                      </div>
                    )}
                    
                    {/* Trust indicator chips - assistant messages only */}
                    {msg.role === "assistant" && !msg.content.startsWith("Error:") && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <SourceChips />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Streaming message indicator */}
            {isLoading && streamingContent && (
              <div className="w-full flex justify-start">
                <div className="group relative max-w-[85%] bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-3">
                  {/* Message header */}
                  <div className="text-[11px] font-medium mb-2 text-gray-500">
                    Sellerev
                  </div>
                  
                  {/* Streaming content with blinking cursor */}
                  <div className="text-sm whitespace-pre-wrap leading-relaxed text-gray-900">
                    {sanitizeVerdictLanguage(streamingContent)}
                    <span className="inline-block w-0.5 h-4 bg-gray-900 ml-0.5 align-middle cursor-blink" />
                  </div>
                  
                  {/* ASIN Citation Chips - show while streaming if available */}
                  {currentCitations.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {currentCitations.map((citation, citationIdx) => (
                        <AsinCitationChip key={citationIdx} citation={citation} />
                      ))}
                    </div>
                  )}
                  
                  {/* Show chips while streaming (faded) */}
                  {streamingContent && (
                    <div className="mt-2 pt-2 border-t border-gray-200 opacity-50">
                      <SourceChips />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Escalation loading state (when escalation is happening) */}
            {escalationState && !streamingContent && (
              <div className="w-full flex justify-start">
                <div className="max-w-[85%] bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
                  <div className="text-xs text-gray-500 italic">
                    Searching for {escalationState.question}…
                  </div>
                </div>
              </div>
            )}

            {/* Loading indicator (before streaming starts, no escalation) */}
            {isLoading && !streamingContent && !escalationState && (
              <div className="w-full flex justify-start">
                <div className="max-w-[85%] bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-3">
                  <div className="text-[11px] font-medium mb-2 text-gray-500">
                    Sellerev
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    />
                    <span
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </>
        )}
        
        {/* Jump to bottom button - appears when user scrolls up during streaming */}
        {showJumpToBottom && (
          <button
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 bg-white border border-gray-300 rounded-full shadow-sm hover:shadow-md transition-all duration-200 hover:bg-gray-50 flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900"
            aria-label="Jump to bottom"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
            <span>Jump to bottom</span>
          </button>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MEMORY CONFIRMATION PROMPT                                           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {pendingMemoryConfirmation && (
        <div className="mx-6 mb-4 p-4 bg-blue-50/80 backdrop-blur-sm rounded-xl">
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
              className="px-3 py-1.5 bg-[#3B82F6] text-white rounded-xl text-sm font-medium hover:bg-[#2563EB]"
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
              className="px-3 py-1.5 bg-white/80 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/90 text-gray-700"
            >
              Don't save
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* INPUT AREA                                                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 shrink-0 bg-white border-t border-[#E5E7EB]">
        <div className="flex gap-2 items-end bg-white border border-gray-300 rounded-xl px-3 py-2 shadow-sm hover:border-gray-400 focus-within:ring-2 focus-within:ring-[#3B82F6] focus-within:border-transparent transition-all">
          <textarea
            ref={inputRef}
            className="flex-1 bg-transparent border-0 rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none disabled:cursor-not-allowed resize-none overflow-y-auto placeholder:text-gray-400"
            style={{
              minHeight: "36px",
              maxHeight: "144px",
              lineHeight: "24px"
            }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isDisabled ? "Run an analysis first" : "Ask about the analysis..."}
            disabled={isDisabled || isLoading}
            rows={1}
          />
          <button
            className="w-9 h-9 bg-[#3B82F6] text-white rounded-lg flex items-center justify-center hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
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
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </div>
        
        {/* One-time trust disclaimer */}
        {!isDisabled && (
          <p className="text-[10px] text-gray-500 mt-2 text-center leading-relaxed px-2">
            Responses are based on Amazon market data, your seller profile, and this analysis. No live scraping or predictions.
          </p>
        )}
      </div>

      {/* History Panel - Floating overlay */}
      <HistoryPanel
        isOpen={isHistoryPanelOpen}
        onClose={() => setIsHistoryPanelOpen(false)}
        anchorElement={historyButtonRef.current}
      />
    </div>
  );
}

