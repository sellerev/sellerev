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
  PanelLeft,
  ChevronLeft,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

const PUBLIC_PATHS = ["/", "/auth", "/terms", "/privacy", "/support"];
const SIDE_PANEL_WIDTH = 200;
const SIDE_PANEL_COLLAPSED_WIDTH = 56;

const navItems = [
  { href: "/analyze", label: "Home", icon: Home },
  { href: "/analyze", label: "Analyze", icon: BarChart2 },
  { href: "/business", label: "Business", icon: Briefcase },
  { href: "/profile", label: "Profile", icon: User },
];

const ICON_COLUMN_WIDTH = 56;

/** Single sidebar: width animates; icons stay fixed in 56px column; text appears when expanded. */
function DesktopSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
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
      className="flex flex-col h-full overflow-hidden"
      style={{ width: "100%", backgroundColor: "#f3f4f6" }}
    >
      {/* Header: fixed 56px column (panel icon when collapsed, else empty); then collapse arrow when expanded */}
      <div className="flex flex-shrink-0 items-center h-14 min-h-[56px]">
        <div
          className="flex-shrink-0 flex items-center justify-center"
          style={{ width: ICON_COLUMN_WIDTH }}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={onToggle}
              className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-200 transition-colors"
              aria-label="Expand sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          ) : null}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0" aria-hidden />
            <button
              type="button"
              onClick={onToggle}
              className="flex-shrink-0 p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-200 transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Nav: icons in fixed 56px column (same size, no movement); text appears when expanded. Pushed down. */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 pt-6" aria-label="Main">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={`${href}-${label}`}
            href={href}
            className="flex items-center w-full rounded-lg py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 hover:text-gray-900 transition-colors min-w-0"
          >
            <span
              className="flex-shrink-0 flex items-center justify-center"
              style={{ width: ICON_COLUMN_WIDTH }}
            >
              <Icon className="w-5 h-5" />
            </span>
            <span className="min-w-0 truncate pr-3">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Logout: same layout — icon column + text */}
      <div className="flex-shrink-0 pt-2 pb-5">
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center w-full rounded-lg py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 hover:text-gray-900 transition-colors min-w-0"
        >
          <span
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: ICON_COLUMN_WIDTH }}
          >
            <LogOut className="w-5 h-5" />
          </span>
          <span className="min-w-0 truncate pr-3 text-left">Log out</span>
        </button>
      </div>
    </aside>
  );
}

/** Full-width panel for mobile drawer (unchanged layout). */
function SidePanel({
  onNavigate,
  onCollapse,
  className = "",
}: {
  onNavigate?: () => void;
  onCollapse?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [userName, setUserName] = useState<string>("Sellerev");

  useEffect(() => {
    supabaseBrowser.auth.getUser().then(({ data: { user } }: { data: { user: SupabaseUser | null } }) => {
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
      className={`flex flex-col h-full ${className}`}
      style={{ width: SIDE_PANEL_WIDTH, backgroundColor: "#f3f4f6" }}
    >
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-4">
        <Link href="/analyze" onClick={onNavigate} className="font-semibold text-gray-900 truncate min-w-0">
          {userName}
        </Link>
        <button type="button" onClick={onCollapse} className="flex-shrink-0 p-1.5 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-200 transition-colors" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2 min-h-0" aria-label="Main">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link key={`${href}-${label}`} href={href} onClick={onNavigate} className="flex items-center gap-3 w-full rounded-l-lg px-3 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 hover:text-gray-900 transition-colors">
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="flex-shrink-0 pt-3 pb-5 px-2">
        <button type="button" onClick={handleLogout} className="flex items-center gap-3 w-full rounded-l-lg px-3 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 hover:text-gray-900 transition-colors">
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
    <>
      {/* Site background = lighter gray behind app; sidebar stays gray-600 */}
      <div className="min-h-screen" style={{ backgroundColor: "#f3f4f6" }}>
        <div className="flex h-full min-h-screen overflow-hidden">
          {/* Desktop: collapsible side panel (gray-600) */}
          <div
            className="hidden lg:block flex-shrink-0 h-full transition-[width] duration-200 ease-out overflow-hidden"
            style={{
              width: desktopCollapsed ? SIDE_PANEL_COLLAPSED_WIDTH : SIDE_PANEL_WIDTH,
              backgroundColor: "#f3f4f6",
            }}
          >
            <DesktopSidebar collapsed={desktopCollapsed} onToggle={() => setDesktopCollapsed((c) => !c)} />
          </div>

          {/* Mobile: hamburger + drawer */}
          <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between h-14 px-4 bg-white border-b border-gray-200 shadow-sm rounded-t-2xl">
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

          {/* Main content area — lighter gray for contrast behind panels */}
          <main className="flex-1 min-w-0 flex flex-col min-h-full" style={{ backgroundColor: "#f3f4f6" }}>
            <div className="lg:hidden h-14 flex-shrink-0" />
            <div className="flex-1 overflow-auto min-h-0">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
