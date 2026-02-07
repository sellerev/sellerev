"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Briefcase,
  User,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import SellerevLogo from "./SellerevLogo";
import ProfileDropdown from "./ProfileDropdown";

const PUBLIC_PATHS = ["/", "/auth", "/terms", "/privacy", "/support"];
const SIDE_PANEL_WIDTH = 260;

const navItems = [
  { href: "/analyze", label: "Home", icon: Home },
  { href: "/business", label: "Business", icon: Briefcase },
  { href: "/profile", label: "Profile", icon: User },
];

function SidePanel({
  onNavigate,
  className = "",
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    try {
      await supabaseBrowser.auth.signOut();
      router.replace("/auth");
    } catch (e) {
      console.error("Logout error:", e);
      router.replace("/auth");
    }
  }

  return (
    <aside
      className={`flex flex-col bg-white border-r border-gray-200 shadow-sm ${className}`}
      style={{ width: SIDE_PANEL_WIDTH }}
    >
      <div className="flex-shrink-0 p-4 border-b border-gray-100">
        <Link
          href="/analyze"
          onClick={onNavigate}
          className="flex items-center gap-2 text-gray-900 hover:text-gray-700"
        >
          <SellerevLogo className="h-6 w-auto" />
          <span className="font-bold text-lg">Sellerev</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3" aria-label="Main">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href === "/analyze" && pathname?.startsWith("/analyze")) ||
            (href !== "/analyze" && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-gray-700 hover:bg-gray-100 border border-transparent"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-shrink-0 border-t border-gray-200 pt-3 pb-4 px-3">
        <button
          onClick={() => {
            handleLogout();
            onNavigate?.();
          }}
          className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Log out
        </button>
      </div>
    </aside>
  );
}

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isPublic = PUBLIC_PATHS.includes(pathname || "");
  const isConnectAmazon = pathname?.startsWith("/connect-amazon");
  const isOnboarding = pathname?.startsWith("/onboarding");

  const showSidePanel =
    !isPublic && !isConnectAmazon && !isOnboarding;

  if (!showSidePanel) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-full min-h-screen">
      {/* Desktop: always visible */}
      <div className="hidden lg:block flex-shrink-0">
        <SidePanel />
      </div>

      {/* Mobile: hamburger + drawer */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between h-14 px-4 bg-white border-b border-gray-200 shadow-sm">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link href="/analyze" className="font-bold text-gray-900">
          Sellerev
        </Link>
        <div className="w-10" />
      </div>

      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
          <div className="lg:hidden fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw]">
            <SidePanel onNavigate={() => setMobileOpen(false)} />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 p-2 rounded-lg text-gray-500 hover:bg-gray-100"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </>
      )}

      <main className="flex-1 min-w-0 flex flex-col min-h-screen lg:min-h-0">
        {/* Slim top bar: profile/credits (desktop); mobile has hamburger in fixed bar */}
        <div className="hidden lg:flex flex-shrink-0 h-14 items-center justify-end px-4 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
          <ProfileDropdown />
        </div>
        <div className="lg:hidden h-14 flex-shrink-0" />
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
