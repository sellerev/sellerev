"use client";

import type { ChatMessage } from "../ChatSidebar";
import DateDivider from "./DateDivider";
import ChatMessageBubble from "./ChatMessageBubble";

/** Get display label for a date (Today, Yesterday, or "Jan 31, 2026") */
export function getDateLabel(isoOrDate: string | Date): string {
  try {
    const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (msgDate.getTime() === today.getTime()) return "Today";
    if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "Today";
  }
}

export interface ChatTranscriptProps {
  messages: ChatMessage[];
  copiedIndex: number | null;
  onCopy: (index: number) => (e: React.MouseEvent | React.KeyboardEvent) => void;
  setMessages?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

/**
 * ChatTranscript - List of messages with date separators (Lovable-style)
 * Inserts a centered DateDivider whenever the day changes between messages.
 */
export default function ChatTranscript({
  messages,
  copiedIndex,
  onCopy,
  setMessages,
}: ChatTranscriptProps) {
  const items: Array<{ type: "date"; label: string } | { type: "message"; message: ChatMessage; index: number }> = [];
  let lastDateLabel: string | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const createdAt = (msg as ChatMessage & { createdAt?: string }).createdAt;
    const dateLabel: string = createdAt ? getDateLabel(createdAt) : (lastDateLabel ?? "Today");

    if (dateLabel !== lastDateLabel) {
      items.push({ type: "date", label: dateLabel });
      lastDateLabel = dateLabel;
    }
    items.push({ type: "message", message: msg, index: i });
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, key) =>
        item.type === "date" ? (
          <DateDivider key={`date-${key}`} label={item.label} />
        ) : (
          <ChatMessageBubble
            key={`msg-${item.index}`}
            message={item.message}
            index={item.index}
            isCopied={copiedIndex === item.index}
            onCopy={onCopy(item.index)}
            showTime={item.index === messages.length - 1}
            renderCards
            setMessages={setMessages}
          />
        )
      )}
    </div>
  );
}
