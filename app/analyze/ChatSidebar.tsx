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

interface ChatSidebarProps {
  /** The analysis run ID to anchor chat to. If null, chat is disabled. */
  analysisRunId: string | null;
  /** Initial messages loaded from history */
  initialMessages?: ChatMessage[];
  /** Callback when messages change (for parent state sync) */
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED FOLLOW-UP QUESTIONS
// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "Help me calculate potential margins",
  "What would change this verdict?",
  "Compare to the top competitor",
  "Explain the main risks in detail",
  "What differentiation strategies could work?",
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ChatSidebar({
  analysisRunId,
  initialMessages = [],
  onMessagesChange,
}: ChatSidebarProps) {
  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────
  
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  
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

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
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
  }, [analysisRunId, input]);

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
            ? "Ask questions about this analysis"
            : "Complete an analysis to start chatting"}
        </p>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MESSAGES AREA                                                       */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50"
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
              <li>• Explain the verdict</li>
              <li>• Run what-if scenarios</li>
              <li>• Calculate margins</li>
              <li>• Compare competitors</li>
            </ul>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          /* Post-analysis, no messages yet: Show suggested question chips */
          <div className="space-y-3">
            <p className="text-xs text-gray-500 text-center mb-4">
              Suggested questions:
            </p>
            {SUGGESTED_QUESTIONS.map((question, idx) => (
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
        
        {/* Grounding disclaimer */}
        {!isDisabled && (
          <p className="text-xs text-gray-400 mt-2 text-center">
            Chat is grounded to this analysis only
          </p>
        )}
      </div>
    </div>
  );
}
