"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Send } from "lucide-react";

interface DashboardClientProps {
  userName: string;
}

export default function DashboardClient({ userName }: DashboardClientProps) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = keyword.trim();
    if (!trimmed) return;
    router.push(`/analyze?keyword=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="min-h-full flex flex-col">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: `linear-gradient(180deg, 
            hsl(229 84% 25%) 0%, 
            hsl(229 84% 63%) 45%, 
            hsl(257 69% 71%) 100%)`,
        }}
      />

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4">
            Welcome back, {userName}
          </h1>
          <p className="text-xl md:text-2xl text-white/90">
            What keyword should we dive into today?
          </p>
        </motion.div>

        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-2xl"
        >
          <div className="flex items-center gap-3 rounded-2xl bg-gray-900/95 border border-gray-700/80 shadow-xl px-4 py-3.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Enter a keyword to analyze..."
              className="flex-1 min-w-0 bg-transparent text-white placeholder-gray-500 text-base focus:outline-none"
              aria-label="Keyword"
              autoFocus
            />
            <span className="flex-shrink-0 text-xs text-gray-500 font-medium">Analyze</span>
            <button
              type="submit"
              disabled={!keyword.trim()}
              className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-700 hover:bg-primary flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
              aria-label="Run analysis"
            >
              <Send className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
        </motion.form>
      </div>
    </div>
  );
}
