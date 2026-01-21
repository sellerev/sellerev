"use client";

import { motion } from "framer-motion";

/**
 * MetricSkeleton - Skeleton placeholder for metric values
 * Used for market summary metrics and product card metrics
 */
export function MetricSkeleton({ className = "" }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={`h-7 bg-gray-200 rounded animate-pulse ${className}`}
    />
  );
}

/**
 * TextSkeleton - Skeleton for text content
 */
export function TextSkeleton({ width = "w-24", height = "h-4", className = "" }: { width?: string; height?: string; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={`${width} ${height} bg-gray-200 rounded animate-pulse ${className}`}
    />
  );
}

