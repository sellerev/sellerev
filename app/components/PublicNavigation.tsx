"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PublicNavigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-200 bg-white flex-shrink-0 z-50 shadow-sm">
      <div className="w-full max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="text-xl font-bold text-gray-900 hover:text-gray-700 transition-colors"
          >
            Sellerev
          </Link>
          
          {/* Right-aligned: Auth buttons */}
          <div className="flex items-center gap-4">
            <Link
              href="/auth"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Log In
            </Link>
            <Link
              href="/auth"
              className="bg-black text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Create Account
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

