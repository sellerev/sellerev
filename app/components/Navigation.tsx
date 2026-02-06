"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import ProfileDropdown from "./ProfileDropdown";

export default function Navigation() {
  const pathname = usePathname();
  const isAnalyze = pathname?.startsWith("/analyze");

  return (
    <nav className="border-b border-gray-200 bg-white flex-shrink-0 z-50 shadow-sm h-16">
      <div className="w-full h-full px-6">
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="Home"
              title="Home"
            >
              <Home className="w-5 h-5" />
            </Link>
            <Link
              href="/dashboard"
              className="text-lg font-bold text-gray-900 hover:text-gray-700 transition-colors"
            >
              Sellerev
            </Link>
            {isAnalyze && (
              <span className="text-sm font-medium text-primary border-b-2 border-primary pb-1 -mb-1 ml-2">
                Analyze
              </span>
            )}
          </div>

          <div className="flex items-center">
            <ProfileDropdown />
          </div>
        </div>
      </div>
    </nav>
  );
}
