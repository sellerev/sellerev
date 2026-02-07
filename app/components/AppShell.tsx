"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  BarChart2,
  Briefcase,
  User,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import ProfileDropdown from "./ProfileDropdown";

const PUBLIC_PATHS = ["/", "/auth", "/terms", "/privacy", "/support"];
const SIDE_PANEL_WIDTH = 260;
const SIDE_PANEL_COLLAPSED_WIDTH = 56;

const navItems = [
  { href: "/analyze", label: "Home", icon: Home },
  { href: "/analyze", label: "Analyze", icon: BarChart2 },
  { href: "/business", label: "Business", icon: Briefcase },
  { href: "/profile", label: "Profile", icon: User },
];

function SidePanel({
  onNavigate,
  onCollapse,
  className = "",
}: {
  onNavigate?: () => void;
  onCollapse?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState<string>("Sellerev");

  useEffect(() => {
    supabaseBrowser.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.full_name) {
        const name = String(user.user_metadata.full_name).split(" ")[0];
        if (name) setUserName(`${name}'s`);
      }
    });
  }, []);

  async function handleLogout() {
    try {
      await supabaseBrowser.auth.signOut();
      router.replace("/auth");
    } catch (e) {
      console.error("Logout error:", e);
      router.replace("/auth");
    }
    onNavigate?.();
  }

  return (
    <aside
      className={`flex flex-col h-full min-h-screen bg-white border-r border-gray-200 shadow-[2px_0_8px_rgba(0,0,0,0.06)] ${className}`}
      style={{ width: SIDE_PANEL_WIDTH }}
    >
      {/* Top: workspace name + collapse (like screenshot "Christina's" + X) */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-4 border-b border-gray-100">
        <Link
          href="/analyze"
          onClick={onNavigate}
          className="font-semibold text-gray-900 truncate min-w-0"
        >
          {userName}
        </Link>
        <button
          type="button"
          onClick={onCollapse}
          className="flex-shrink-0 p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Collapse sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav: full-height scrollable, spacious padding */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 min-h-0" aria-label="Main">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href === "/analyze" && pathname?.startsWith("/analyze")) ||
            (href !== "/analyze" && pathname?.startsWith(href));
          return (
            <Link
              key={`${href}-${label}`}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 w-full rounded-l-lg px-3 py-3 text-sm transition-colors ${
                isActive
                  ? "bg-gray-100 text-gray-900 font-semibold"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700 font-medium"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout at the very bottom, with subtle divider above */}
      <div className="flex-shrink-0 border-t border-gray-200 pt-3 pb-5 px-2">
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 w-full rounded-l-lg px-3 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
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
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

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
      {/* Desktop: collapsible side panel */}
      <div
        className="hidden lg:block flex-shrink-0 h-full min-h-screen transition-[width] duration-200 ease-out"
        style={{
          width: desktopCollapsed ? SIDE_PANEL_COLLAPSED_WIDTH : SIDE_PANEL_WIDTH,
        }}
      >
        {desktopCollapsed ? (
          <aside className="flex flex-col h-full min-h-screen bg-white border-r border-gray-200 shadow-[2px_0_8px_rgba(0,0,0,0.06)]">
            <div className="flex-shrink-0 p-3 border-b border-gray-100">
              <button
                type="button"
                onClick={() => setDesktopCollapsed(false)}
                className="w-full flex items-center justify-center p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Expand sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </aside>
        ) : (
          <SidePanel onCollapse={() => setDesktopCollapsed(true)} />
        )}
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
          <div className="lg:hidden fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] shadow-xl">
            <SidePanel
              onNavigate={() => setMobileOpen(false)}
              onCollapse={() => setMobileOpen(false)}
            />
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
        <div className="hidden lg:flex flex-shrink-0 h-14 items-center justify-end px-4 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
          <ProfileDropdown />
        </div>
        <div className="lg:hidden h-14 flex-shrink-0" />
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
