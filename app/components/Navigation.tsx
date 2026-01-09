"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-200 bg-white sticky top-0 z-50 shadow-sm">
      <div className="w-full px-6">
        <div className="flex items-center justify-between h-16">
          {/* Left-aligned: Brand + Navigation */}
          <div className="flex items-center gap-8">
            <Link
              href="/dashboard"
              className="text-lg font-bold text-gray-900 hover:text-gray-700 transition-colors"
            >
              Sellerev
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/analyze"
                className={`text-sm font-medium transition-colors ${
                  pathname?.startsWith("/analyze")
                    ? "text-[#111827] font-semibold border-b-2 border-[#111827] pb-1 -mb-1"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Analyze
              </Link>
              <Link
                href="/history"
                className={`text-sm font-medium transition-colors ${
                  pathname?.startsWith("/history")
                    ? "text-[#111827] font-semibold border-b-2 border-[#111827] pb-1 -mb-1"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                History
              </Link>
            </div>
          </div>
          
          {/* Right-aligned: Settings */}
          <div className="flex items-center">
            <Link
              href="/settings"
              className={`text-sm font-medium transition-colors flex items-center gap-2 px-3 py-2 rounded-lg ${
                pathname?.startsWith("/settings")
                  ? "text-[#111827] bg-gray-100"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
