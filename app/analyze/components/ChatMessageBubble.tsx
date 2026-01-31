"use client";

import { Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps } from "react";
import type { ChatMessage } from "../ChatSidebar";
import FeesProfitChatCard, {
  type FeesResultCardPayload,
} from "./FeesProfitChatCard";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// PREPROCESSING (smart formatting)
// ─────────────────────────────────────────────────────────────────────────────

/** Strip "Thought for XXs" line (and similar) from assistant output */
function stripThoughtLine(text: string): string {
  return text.replace(/^Thought\s+for\s+\d+s\s*$/gim, "").trim();
}

/** Auto-bold common heading-like patterns if not already Markdown */
function autoBoldHeadings(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Already has ** or ## - leave as is
    if (/^\s*(\*\*|##|###)/.test(line) || /\*\*[^*]+\*\*/.test(line)) {
      out.push(line);
      continue;
    }
    // Option 1: / Option 2: etc.
    if (/^Option\s+\d+:/i.test(line.trim())) {
      line = line.replace(/^(Option\s+\d+:)(.*)$/i, "**$1**$2");
    }
    // Key Highlights: / Top Complaints: / Summary: / Next steps: etc.
    if (/^[A-Z][A-Za-z0-9\s\-/&]+:\s*$/.test(line.trim()) || /^(Key Highlights|Top Complaints|Top Praise|Summary|Next steps|Constraints):/i.test(line.trim())) {
      line = "**" + line.trim() + "**";
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Normalize bullet characters to Markdown - */
function normalizeBullets(text: string): string {
  return text
    .replace(/^[\s]*[•]\s+/gm, "- ")
    .replace(/^[\s]*[▪]\s+/gm, "- ")
    .replace(/^[\s]*[●]\s+/gm, "- ");
}

/** Ensure blank line before bullet sections */
function ensureBlankBeforeBullets(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBullet = /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
    if (isBullet && i > 0 && out[out.length - 1] !== "") {
      out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}

export function preprocessAssistantContent(content: string): string {
  if (!content?.trim()) return content;
  let out = stripThoughtLine(content);
  out = normalizeBullets(out);
  out = autoBoldHeadings(out);
  out = ensureBlankBeforeBullets(out);
  out = out.replace(/\n\n\n+/g, "\n\n").trim();
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN STYLES (Lovable typography)
// ─────────────────────────────────────────────────────────────────────────────

const markdownComponents: ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p className="my-2 text-sm leading-6 text-gray-900">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  h1: ({ children }) => <h1 className="text-base font-semibold text-gray-900 mt-3 mb-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold text-gray-900 mt-3 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-900 mt-2 mb-1 first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="pl-5 my-2 space-y-1 list-disc text-sm leading-6 text-gray-900">{children}</ul>,
  ol: ({ children }) => <ol className="pl-5 my-2 space-y-1 list-decimal text-sm leading-6 text-gray-900">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-6">{children}</li>,
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre
          className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs overflow-auto my-2 text-gray-900"
          {...props}
        >
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code className="bg-neutral-100 px-1.5 py-0.5 rounded text-xs font-mono text-gray-800" {...props}>
        {children}
      </code>
    );
  },
  a: ({ href, children }) => (
    <a href={href} className="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessageBubbleProps {
  message: ChatMessage;
  index: number;
  isCopied: boolean;
  onCopy: (e: React.MouseEvent | React.KeyboardEvent) => void;
  /** Optional small time under bubble (e.g. last in group) */
  showTime?: boolean;
  /** Render cards (e.g. FeesProfitChatCard) - requires setMessages for fees update */
  renderCards?: boolean;
  setMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export default function ChatMessageBubble({
  message,
  index,
  isCopied,
  onCopy,
  showTime = false,
  renderCards = true,
  setMessages,
}: ChatMessageBubbleProps) {
  const isUser = message.role === "user";
  const content = message.role === "assistant"
    ? preprocessAssistantContent(message.content)
    : message.content;

  const bubbleClasses = isUser
    ? "bg-neutral-100 text-gray-900 rounded-[18px] px-3.5 py-2.5 max-w-[80%] ml-auto"
    : "bg-white border border-neutral-200 text-gray-900 rounded-[18px] px-3.5 py-3 max-w-[80%]";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`group relative ${bubbleClasses}`}>
        {/* Hover-reveal copy */}
        <div className="absolute right-2 top-2.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 has-[:focus]:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onCopy}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCopy(e);
              }
            }}
            className="p-1.5 rounded-md hover:bg-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-300 text-neutral-500 hover:text-neutral-700"
            aria-label="Copy message"
            title="Copy message"
            tabIndex={0}
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Optional label (Sellerev / You) - minimal */}
        <div className="text-[11px] font-medium text-neutral-400 mb-1.5">
          {isUser ? "You" : "Sellerev"}
        </div>

        {/* Content: Markdown for assistant, plain for user */}
        {content.trim() && (
          <div className="text-sm leading-6 text-gray-900 break-words">
            {message.role === "assistant" ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            ) : (
              <div className="whitespace-pre-wrap">{content}</div>
            )}
          </div>
        )}

        {/* ASIN Citation Chips */}
        {message.role === "assistant" && message.citations && message.citations.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {message.citations.map((citation, citationIdx) => (
              <span
                key={citationIdx}
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                  citation.source === "rainforest_product"
                    ? "bg-gray-50 border border-gray-300 text-gray-700"
                    : "bg-gray-50 border border-gray-200 text-gray-600"
                }`}
                title={citation.source === "rainforest_product" ? "Verified via product API" : "Estimated from Page-1 data"}
              >
                ASIN {citation.asin}
              </span>
            ))}
          </div>
        )}

        {/* Cards (Fees / Connect Amazon) */}
        {renderCards && message.role === "assistant" && message.cards?.map((card, cIdx) => {
          if (card.type === "connect_amazon") {
            const pl = card.payload as { message?: string; ctaUrl?: string };
            return (
              <div key={cIdx} className="mt-2">
                <Link
                  href={pl?.ctaUrl ?? "/connect-amazon"}
                  className="inline-block rounded bg-amber-600 px-3 py-1.5 text-white text-xs font-medium hover:bg-amber-700"
                >
                  Connect Amazon
                </Link>
              </div>
            );
          }
          if (card.type !== "fees_result" && card.type !== "fees_profit") return null;
          const raw = card.payload as Record<string, unknown>;
          const pl: FeesResultCardPayload =
            card.type === "fees_result"
              ? (raw as unknown as FeesResultCardPayload)
              : {
                  type: "fees_result",
                  source: raw?.fees ? "sp_api" : "estimate",
                  asin: (raw?.asin as string) ?? "",
                  marketplace_id: (raw?.marketplaceId as string) ?? "",
                  marketplaceId: (raw?.marketplaceId as string) ?? undefined,
                  price_used: (raw?.price as number) ?? null,
                  currency: "USD",
                  total_fees: (raw?.fees as any)?.total_fees ?? 0,
                  fee_lines: (raw?.fees as any)?.fee_lines ?? [],
                  fetched_at: (raw?.fees as any)?.fetched_at ?? new Date().toISOString(),
                  cta_connect: !raw?.fees,
                  assumptions: !raw?.fees ? ["Enter selling price to calculate fees."] : undefined,
                };
          return (
            <FeesProfitChatCard
              key={cIdx}
              payload={pl}
              onFeesFetched={
                setMessages
                  ? (data) => {
                      setMessages((prev) => {
                        const n = [...prev];
                        const m = n[index];
                        if (!m?.cards) return prev;
                        const cards = [...m.cards];
                        cards[cIdx] = { type: "fees_result", payload: data };
                        n[index] = { ...m, cards };
                        return n;
                      });
                    }
                  : undefined
              }
            />
          );
        })}

        {/* Optional time under bubble */}
        {showTime && (message as ChatMessage & { createdAt?: string }).createdAt && (
          <div className="text-[11px] text-neutral-400 mt-1">
            {formatTime((message as ChatMessage & { createdAt?: string }).createdAt!)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
