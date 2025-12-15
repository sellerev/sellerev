"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

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
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        // User has signed in (e.g., after email confirmation)
        router.replace("/onboarding");
      }
    });

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
        // Session exists - redirect to onboarding
        router.replace("/onboarding");
      } else {
        setError("Sign in failed. Please try again.");
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 border rounded-xl p-6">
        <h1 className="text-xl font-semibold">Sellerev</h1>

        {signupSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded text-sm">
            Check your email to confirm your account
          </div>
        )}

        <div className="flex gap-2">
          <button
            className={`flex-1 border rounded p-2 ${
              mode === "signup" ? "bg-black text-white" : ""
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
            className={`flex-1 border rounded p-2 ${
              mode === "signin" ? "bg-black text-white" : ""
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
          className="border rounded p-2 w-full"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="border rounded p-2 w-full"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className="bg-black text-white rounded p-2 w-full disabled:opacity-50"
          disabled={loading || !email || password.length < 6}
          onClick={submit}
        >
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>
    </div>
  );
}
