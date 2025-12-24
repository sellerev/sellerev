"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Link
              href="/dashboard"
              className="text-lg font-semibold text-gray-900 hover:text-gray-700"
            >
              Sellerev
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/analyze"
                className={`text-sm font-medium transition-colors ${
                  pathname?.startsWith("/analyze")
                    ? "text-black"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Analyze
              </Link>
              <Link
                href="/history"
                className={`text-sm font-medium transition-colors ${
                  pathname?.startsWith("/history")
                    ? "text-black"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                History
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className={`text-sm font-medium transition-colors flex items-center gap-2 ${
                pathname?.startsWith("/settings")
                  ? "text-black"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              title="Seller Profile & Preferences"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
