"use client";

import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function ProfileTab() {
  const supabase = supabaseBrowser;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailChanged, setEmailChanged] = useState(false);

  // Load current user data
  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!user || userError) {
        router.push("/auth");
        return;
      }

      // Set form fields
      setName(user.user_metadata?.full_name || "");
      setEmail(user.email || "");
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!user || userError) {
        setError("Not authenticated");
        setSaving(false);
        router.push("/auth");
        return;
      }

      // Update user metadata (name)
      const updates: any = {
        data: {
          full_name: name || undefined,
        },
      };

      // If email changed, update email (requires re-auth)
      if (emailChanged && email !== user.email) {
        // Update email - Supabase will send confirmation email
        const { error: emailError } = await supabase.auth.updateUser({
          email: email,
        });

        if (emailError) {
          setError(`Email update failed: ${emailError.message}. Please check your current password or try again.`);
          setSaving(false);
          return;
        }

        setSuccess(true);
        setEmailChanged(false);
        setError("A confirmation email has been sent to your new email address. Please verify it to complete the change.");
        setSaving(false);
        return;
      }

      // Update user metadata only (name)
      const { error: updateError } = await supabase.auth.updateUser(updates);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
      } else {
        setSuccess(true);
        setSaving(false);
        setTimeout(() => setSuccess(false), 3000);
        // Reload profile to get updated data
        loadProfile();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading profile...</div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Success Message */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-green-700 font-medium">Profile updated successfully</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Profile Fields */}
      <div className="space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Full Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            placeholder="Enter your name"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailChanged(true);
            }}
            className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            placeholder="your@email.com"
            required
          />
          {emailChanged && (
            <p className="text-xs text-amber-600 mt-1">
              ⚠️ Changing your email will require email verification. A confirmation email will be sent.
            </p>
          )}
        </div>
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-4 border-t">
        <button
          type="submit"
          disabled={saving}
          className="bg-black text-white rounded-lg px-6 py-2 font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

