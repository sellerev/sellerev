"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * ResultsLoadingState - Modern loading animation for product results
 * 
 * Renders ONLY inside the product results container.
 * Shows when analysis is in progress and listings are not yet ready.
 */
export default function ResultsLoadingState() {
  const [progressWidth, setProgressWidth] = useState(0);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  const messages = [
    "Fetching page 1 listings",
    "Analyzing brands and pricing",
    "Estimating demand",
  ];

  // Animate progress bar: 0% → 70% over 2.5s, then pulse between 70-85%
  useEffect(() => {
    let pulseInterval: NodeJS.Timeout | null = null;

    // Start animating to 70% immediately (Framer Motion will animate smoothly over 2.5s)
    setProgressWidth(70);

    // After reaching 70%, start pulsing between 70-85%
    const pulseStartTimeout = setTimeout(() => {
      pulseInterval = setInterval(() => {
        setProgressWidth((prev) => {
          if (prev >= 85) return 70;
          return prev + 1;
        });
      }, 200);
    }, 2500); // Start pulsing after initial animation completes

    return () => {
      clearTimeout(pulseStartTimeout);
      if (pulseInterval) clearInterval(pulseInterval);
    };
  }, []);

  // Rotate messages every 1.2s
  useEffect(() => {
    const messageInterval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
    }, 1200);

    return () => clearInterval(messageInterval);
  }, [messages.length]);

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 min-h-[400px]">
      {/* Title Text - Fade + upward motion */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="mb-8"
      >
        <h3 className="text-lg font-semibold text-gray-900">
          Analyzing Page 1 Results...
        </h3>
      </motion.div>

      {/* Progress Bar */}
      <div className="w-full max-w-md mb-8">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: `${progressWidth}%` }}
            transition={{ 
              duration: progressWidth <= 70 ? 2.5 : 0.3, 
              ease: "easeInOut" 
            }}
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full relative"
          >
            {/* Subtle glow sweep */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
              animate={{
                x: ["-100%", "200%"],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "linear",
              }}
            />
          </motion.div>
        </div>
      </div>

      {/* Rotating Subtext Messages */}
      <div className="h-6 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={currentMessageIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="text-sm text-gray-600"
            aria-live="polite"
          >
            {messages[currentMessageIndex]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

