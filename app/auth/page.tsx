"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import PublicNavigation from "../components/PublicNavigation";
import PublicFooter from "../components/PublicFooter";

export default function AuthPage() {
  const supabase = supabaseBrowser;
  const router = useRouter();

  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Listen for auth state changes
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "SIGNED_IN" && session) {
          // User has signed in (e.g., after email confirmation)
          // Redirect to Amazon connection step (before onboarding)
          router.replace("/connect-amazon");
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setSignupSuccess(false);

    let result;

    if (mode === "signup") {
      result = await supabase.auth.signUp({ email, password });
    } else {
      result = await supabase.auth.signInWithPassword({ email, password });
    }

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    if (mode === "signup") {
      // Sign-up: Show success message, don't redirect
      // User will be redirected via onAuthStateChange when they confirm email
      setSignupSuccess(true);
      setLoading(false);
    } else {
      // Sign-in: Check if session exists
      if (result.data.session) {
        // Session exists - redirect to Amazon connection step (before onboarding)
        router.replace("/connect-amazon");
      } else {
        setError("Sign in failed. Please try again.");
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicNavigation />
      
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-sm"
        >
          <div className="backdrop-blur-sm bg-card/30 border border-border/50 rounded-2xl p-8 space-y-6">
            <h1 className="text-xl font-semibold text-foreground">Sellerev</h1>

            {signupSuccess && (
              <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg text-sm">
                Check your email to confirm your account
              </div>
            )}

            <div className="flex gap-2">
              <button
                className={`flex-1 border border-border rounded-lg p-2 text-sm font-medium transition-colors ${
                  mode === "signup"
                    ? "bg-gradient-to-r from-primary to-primary-glow text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => {
                  setMode("signup");
                  setSignupSuccess(false);
                  setError(null);
                }}
              >
                Sign up
              </button>
              <button
                className={`flex-1 border border-border rounded-lg p-2 text-sm font-medium transition-colors ${
                  mode === "signin"
                    ? "bg-gradient-to-r from-primary to-primary-glow text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => {
                  setMode("signin");
                  setSignupSuccess(false);
                  setError(null);
                }}
              >
                Sign in
              </button>
            </div>

            <input
              className="w-full px-4 py-2 bg-background/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              className="w-full px-4 py-2 bg-background/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              className="w-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground rounded-lg p-2 font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !email || password.length < 6}
              onClick={submit}
            >
              {loading ? "Loading..." : mode === "signup" ? "Create account" : "Sign in"}
            </button>

            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-lg">
                {error}
              </p>
            )}
          </div>
        </motion.div>
      </main>

      <PublicFooter />
    </div>
  );
}
