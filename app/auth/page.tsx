"use client";

import { useState } from "react";
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

  const submit = async () => {
    setLoading(true);
    setError(null);

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

    // Verify session exists in result.data.session
    if (!result.data.session) {
      setError(
        mode === "signup"
          ? "Account created but session not available. Please check your email for confirmation."
          : "No session available. Please try again."
      );
      setLoading(false);
      return;
    }

    // Session exists - verify it's set
    console.log("Session created:", !!result.data.session);
    
    // Redirect to onboarding
    router.replace("/onboarding");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 border rounded-xl p-6">
        <h1 className="text-xl font-semibold">Sellerev</h1>

        <div className="flex gap-2">
          <button
            className={`flex-1 border rounded p-2 ${
              mode === "signup" ? "bg-black text-white" : ""
            }`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
          <button
            className={`flex-1 border rounded p-2 ${
              mode === "signin" ? "bg-black text-white" : ""
            }`}
            onClick={() => setMode("signin")}
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