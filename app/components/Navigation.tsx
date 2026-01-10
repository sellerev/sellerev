"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ProfileDropdown from "./ProfileDropdown";

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-200 bg-white flex-shrink-0 z-50 shadow-sm h-16">
      <div className="w-full h-full px-6">
        <div className="flex items-center justify-between h-full">
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
          
          {/* Right-aligned: Profile Dropdown */}
          <div className="flex items-center">
            <ProfileDropdown />
          </div>
        </div>
      </div>
    </nav>
  );
}
