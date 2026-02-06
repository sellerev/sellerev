"use client";

import { motion } from "framer-motion";

/**
 * ResultsLoadingState - Controlled loading animation for product results.
 * Progress and stage message are driven by useAnalyzeProgress (single source of truth).
 */
interface ResultsLoadingStateProps {
  /** 0–100, monotonic */
  percent: number;
  /** Stage message from progress hook */
  stageMessage: string;
}

export default function ResultsLoadingState({
  percent,
  stageMessage,
}: ResultsLoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 min-h-[400px]">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mb-8"
      >
        <h3 className="text-lg font-semibold text-gray-900">
          Analyzing Page 1 results…
        </h3>
      </motion.div>

      <div className="w-full max-w-md mb-8">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            initial={false}
            animate={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-primary to-primary-glow rounded-full relative"
          >
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        </div>
      </div>

      <div className="h-6 flex items-center justify-center">
        <motion.p
          key={stageMessage}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="text-sm text-gray-600"
          aria-live="polite"
        >
          {stageMessage} · {percent}%
        </motion.p>
      </div>
    </div>
  );
}
