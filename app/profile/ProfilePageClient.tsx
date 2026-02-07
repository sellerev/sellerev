"use client";

import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
interface ProfilePageClientProps {
  user: { id: string; email: string; user_metadata: Record<string, unknown> };
}

function stringOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default function ProfilePageClient({ user }: ProfilePageClientProps) {
  const [name, setName] = useState(() => stringOrEmpty(user.user_metadata?.full_name));
  const [email, setEmail] = useState(user.email ?? "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setName(stringOrEmpty(user.user_metadata?.full_name));
    setEmail(user.email ?? "");
  }, [user]);

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const { error } = await supabaseBrowser.auth.updateUser({
        data: { full_name: name || undefined },
      });
      if (error) throw error;
      setMessage({ type: "success", text: "Profile updated." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Update failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-[#F7F9FC]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Profile</h1>
        <p className="text-gray-600 mb-8">
          Account information and security.
        </p>

        <div className="space-y-8">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Name & email</h2>
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  readOnly
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-gray-500"
                />
                <p className="text-xs text-gray-500 mt-1">Email changes require re-verification (coming soon).</p>
              </div>
              {message && (
                <p className={`text-sm ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
                  {message.text}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-gradient-to-r from-primary to-primary-glow px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save changes"}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Password</h2>
            <p className="text-sm text-gray-600 mb-4">Change your password (coming soon).</p>
            <button
              type="button"
              disabled
              className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 cursor-not-allowed"
            >
              Change password
            </button>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Billing</h2>
            <p className="text-sm text-gray-600 mb-4">Plans and billing (coming soon).</p>
            <button
              type="button"
              disabled
              className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 cursor-not-allowed"
            >
              Manage billing
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
