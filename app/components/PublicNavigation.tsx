"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

export default function PublicNavigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border/50 bg-background/80 backdrop-blur-sm flex-shrink-0 z-50 sticky top-0">
      <div className="w-full max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="text-xl font-bold text-foreground hover:text-primary transition-colors"
          >
            Sellerev
          </Link>
          
          {/* Right-aligned: Theme toggle and Auth buttons */}
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link
              href="/auth"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Log In
            </Link>
            <Link
              href="/auth"
              className="bg-gradient-to-r from-primary to-primary-glow text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Create Account
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

