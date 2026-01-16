"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { User, LogOut, Settings, Shield, Bell, CreditCard, FileText, Coins, Link2 } from "lucide-react";
import type { User as SupabaseUser, AuthChangeEvent, Session } from "@supabase/supabase-js";

interface CreditBalance {
  credits_remaining: number;
  credits_used: number;
  last_updated_at: string | null;
}

export default function ProfileDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; right: number } | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Load user data and credits
  useEffect(() => {
    loadUser();
    loadCredits();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabaseBrowser.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (session?.user) {
          setUser(session.user);
          loadCredits(); // Reload credits when user changes
        } else {
          setUser(null);
          setCreditBalance(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function loadCredits() {
    try {
      const {
        data: { user: currentUser },
      } = await supabaseBrowser.auth.getUser();
      
      if (!currentUser) {
        setCreditBalance(null);
        setCreditsLoading(false);
        return;
      }
      
      // Fetch credits directly from database
      const { data: userCredits, error } = await supabaseBrowser
        .from("user_credits")
        .select("free_credits, purchased_credits, subscription_credits, used_credits, updated_at")
        .eq("user_id", currentUser.id)
        .single();
      
      if (error && error.code === 'PGRST116') {
        // User credits don't exist - create with 10 free credits
        const { error: insertError } = await supabaseBrowser
          .from("user_credits")
          .insert({
            user_id: currentUser.id,
            free_credits: 10,
            purchased_credits: 0,
            subscription_credits: 0,
            used_credits: 0,
          });
        
        if (!insertError) {
          setCreditBalance({
            credits_remaining: 10,
            credits_used: 0,
            last_updated_at: new Date().toISOString(),
          });
        } else {
          setCreditBalance(null);
        }
      } else if (error || !userCredits) {
        console.error("Error loading credits:", error);
        setCreditBalance(null);
      } else {
        const credits_remaining = Math.max(0,
          (userCredits.free_credits || 0) +
          (userCredits.purchased_credits || 0) +
          (userCredits.subscription_credits || 0) -
          (userCredits.used_credits || 0)
        );
        
        setCreditBalance({
          credits_remaining,
          credits_used: userCredits.used_credits || 0,
          last_updated_at: userCredits.updated_at || null,
        });
      }
    } catch (error) {
      console.error("Error loading credits:", error);
      setCreditBalance(null);
    } finally {
      setCreditsLoading(false);
    }
  }

  // Calculate dropdown position when opening
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;

    const updatePosition = () => {
      if (!buttonRef.current) return;
      
      const rect = buttonRef.current.getBoundingClientRect();
      // Position: right-aligned to icon, 8px below (top + height + 8px)
      setDropdownPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right, // Distance from right edge
      });
    };

    updatePosition();
    
    // Recalculate on window resize/scroll
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true); // Use capture to catch all scroll events
    
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      // Check if click is outside both the button and dropdown
      if (
        buttonRef.current && 
        dropdownRef.current && 
        !buttonRef.current.contains(event.target as Node) &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setDropdownPosition(null);
      }
    }

    // Close on escape key
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        setDropdownPosition(null);
      }
    }
    
    // Add event listeners
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    
    // Cleanup
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  async function loadUser() {
    try {
      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();
      setUser(user);
    } catch (error) {
      console.error("Error loading user:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      const { error } = await supabaseBrowser.auth.signOut();
      if (error) {
        console.error("Error signing out:", error);
        alert("Failed to sign out. Please try again.");
        return;
      }
      // Redirect to auth page
      router.push("/auth");
    } catch (error) {
      console.error("Error during logout:", error);
      alert("An error occurred during logout.");
    }
  }

  // Get user initials for avatar
  const getInitials = () => {
    if (!user?.email) return "U";
    const email = user.email;
    // Try to get name from metadata
    if (user.user_metadata?.full_name) {
      const nameParts = user.user_metadata.full_name.split(" ");
      if (nameParts.length >= 2) {
        return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase();
      }
      return nameParts[0][0].toUpperCase();
    }
    // Fallback to email first letter
    return email[0].toUpperCase();
  };

  // Get display name
  const getDisplayName = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    if (user?.email) {
      return user.email.split("@")[0];
    }
    return "User";
  };

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
    );
  }

  if (!user) {
    return null;
  }

  return (
    <>
      {/* Avatar Button */}
      <button
        ref={buttonRef}
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            setDropdownPosition(null);
          } else {
            setIsOpen(true);
          }
        }}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="Profile menu"
        aria-expanded={isOpen}
      >
        <div className="w-8 h-8 rounded-full bg-[#3B82F6] text-white flex items-center justify-center text-sm font-semibold">
          {getInitials()}
        </div>
      </button>

      {/* Dropdown Menu - Positioned using getBoundingClientRect(), fixed to viewport */}
      {isOpen && dropdownPosition && (
        <div
          ref={dropdownRef}
          className="fixed w-[280px] bg-white rounded-lg shadow-sm border border-[#E5E7EB] py-2 z-[9999]"
          style={{
            top: `${dropdownPosition.top}px`,
            right: `${dropdownPosition.right}px`,
          }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="font-semibold text-gray-900 text-sm">{getDisplayName()}</div>
            <div className="text-xs text-gray-500 mt-0.5 truncate">{user.email}</div>
          </div>

          {/* Seller Credits Section */}
          <div className="px-4 py-3 border-b border-gray-200">
            <button
              onClick={() => {
                // Stub: Future billing modal
                setIsOpen(false);
              }}
              className="w-full text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Seller Credits
                  </span>
                </div>
                {!creditsLoading && creditBalance && (
                  <span className="text-sm font-semibold text-gray-900">
                    {creditBalance.credits_remaining} left
                  </span>
                )}
              </div>
              {!creditsLoading && creditBalance && (
                <div className="mt-2">
                  {/* Progress bar */}
                  <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#3B82F6] transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (creditBalance.credits_remaining / (creditBalance.credits_remaining + creditBalance.credits_used)) * 100)}%`,
                      }}
                    />
                  </div>
                  {creditBalance.credits_used > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      {creditBalance.credits_used} used
                    </div>
                  )}
                </div>
              )}
              {creditsLoading && (
                <div className="h-1.5 bg-gray-200 rounded-full animate-pulse mt-2" />
              )}
            </button>
          </div>

          {/* Account Section */}
          <div className="py-1">
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Account
            </div>
            <button
              onClick={() => {
                router.push("/account");
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
            >
              <User className="w-4 h-4 text-gray-400" />
              Profile & Account
            </button>
            <button
              onClick={() => {
                router.push("/account?tab=billing");
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
            >
              <CreditCard className="w-4 h-4 text-gray-400" />
              Plans & Billing
            </button>
            <button
              onClick={() => {
                router.push("/account?tab=notifications");
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
            >
              <Bell className="w-4 h-4 text-gray-400" />
              Notifications
            </button>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 my-1" />

          {/* Product Section */}
          <div className="py-1">
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Product
            </div>
            <button
              onClick={() => {
                router.push("/settings#ai");
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-400" />
              AI Preferences
            </button>
            <button
              onClick={() => {
                router.push("/settings#data");
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
            >
              <FileText className="w-4 h-4 text-gray-400" />
              Data Sources
            </button>
            <button
              onClick={() => {
                router.push("/settings#integrations");
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
            >
              <Link2 className="w-4 h-4 text-gray-400" />
              Integrations
            </button>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200 my-1" />

          {/* Security Section */}
          <div className="py-1">
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Security
            </div>
            <button
              onClick={() => {
                router.push("/account?tab=security");
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
            >
              <Shield className="w-4 h-4 text-gray-400" />
              Change Password
            </button>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
            >
              <LogOut className="w-4 h-4 text-red-400" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </>
  );
}

