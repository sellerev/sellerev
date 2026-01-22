"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import SellerevLogo from "./SellerevLogo";

export default function PublicNavigation() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border/50 bg-background/80 backdrop-blur-sm flex-shrink-0 z-50 sticky top-0">
      <div className="w-full max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center hover:opacity-80 transition-opacity"
            aria-label="Sellerev"
          >
            <SellerevLogo className="w-8 h-8" />
          </Link>
          
          {/* Right-aligned: Theme toggle and Auth buttons */}
          <div className="flex items-center gap-4">
            {pathname !== "/" && <ThemeToggle />}
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

