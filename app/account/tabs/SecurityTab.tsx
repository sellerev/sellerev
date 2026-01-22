"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export default function SecurityTab() {
  const supabase = supabaseBrowser;
  const router = useRouter();

  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    // Validation
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters long");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    setChangingPassword(true);

    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.email) {
        setPasswordError("Unable to identify user. Please try logging out and back in.");
        setChangingPassword(false);
        return;
      }

      // Update password - Supabase requires re-authentication for password changes
      // We need to sign in first, then update
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (signInError) {
        setPasswordError("Current password is incorrect");
        setChangingPassword(false);
        return;
      }

      // Now update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setPasswordError(updateError.message);
        setChangingPassword(false);
      } else {
        setPasswordSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setChangingPassword(false);
        setTimeout(() => setPasswordSuccess(false), 3000);
      }
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
      setChangingPassword(false);
    }
  }

  async function handleLogoutAllSessions() {
    if (!confirm("Are you sure you want to sign out of all devices? You'll need to sign in again everywhere.")) {
      return;
    }

    setLoggingOutAll(true);
    try {
      // Sign out from current session
      const { error } = await supabase.auth.signOut();
      if (error) {
        alert("Failed to sign out. Please try again.");
        setLoggingOutAll(false);
        return;
      }
      router.push("/");
    } catch (error) {
      console.error("Error signing out:", error);
      alert("An error occurred. Please try again.");
      setLoggingOutAll(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Change Password */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h2>
        
        {passwordSuccess && (
          <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-green-700 font-medium text-sm">Password updated successfully</p>
            </div>
          </div>
        )}

        {passwordError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-700 text-sm">{passwordError}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              minLength={8}
              required
            />
            <p className="text-xs text-gray-500 mt-1">Must be at least 8 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              minLength={8}
              required
            />
          </div>

          <button
            type="submit"
            disabled={changingPassword}
            className="bg-black text-white rounded-lg px-6 py-2 font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {changingPassword ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Active Sessions - Placeholder */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Sessions</h2>
        <p className="text-sm text-gray-600 mb-4">
          View and manage your active sessions across different devices.
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-w-md">
          <p className="text-sm text-gray-500 italic">
            Session management coming soon. For now, you can sign out of all devices below.
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Logout All Sessions */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Sign Out of All Devices</h2>
        <p className="text-sm text-gray-600 mb-4">
          This will sign you out of all devices and require you to sign in again.
        </p>
        <button
          onClick={handleLogoutAllSessions}
          disabled={loggingOutAll}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {loggingOutAll ? "Signing out..." : "Sign Out All Devices"}
        </button>
      </div>
    </div>
  );
}

