"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const AI_THINKING_MESSAGES = [
  "Scanning Amazon Page 1…",
  "Mapping competitive structure…",
  "Evaluating brand dominance…",
  "Identifying demand concentration…",
  "Analyzing review barriers…",
  "Confidence increasing as signals resolve…",
];

/**
 * AIThinkingMessage - Rotating AI-thinking messages
 * Replaces "Loading" copy with intelligent, calm system messages
 */
export default function AIThinkingMessage() {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  // Rotate messages every 2 seconds
  useEffect(() => {
    const messageInterval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % AI_THINKING_MESSAGES.length);
    }, 2000);

    return () => clearInterval(messageInterval);
  }, []);

  return (
    <div className="flex items-center justify-center h-6">
      <AnimatePresence mode="wait">
        <motion.p
          key={currentMessageIndex}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="text-sm text-gray-600 text-center"
          aria-live="polite"
        >
          {AI_THINKING_MESSAGES[currentMessageIndex]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

