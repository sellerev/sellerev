"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "prompt" | "connecting" | "success";

function ConnectAmazonContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("prompt");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we're returning from OAuth (success or error state)
  useEffect(() => {
    const connected = searchParams.get("connected");
    const errorParam = searchParams.get("error");
    
    if (connected === "amazon") {
      setStep("success");
    } else if (errorParam) {
      // Show error message but stay on prompt step
      setStep("prompt");
      setError("Connection failed. Please try again or skip for now.");
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  // Check authentication on load
  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();

      if (!user) {
        router.push("/auth");
        return;
      }

      // Check if already connected
      const { data: connection } = await supabaseBrowser
        .from("amazon_connections")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("status", "connected")
        .single();

      if (connection) {
        // Already connected → go to Analyze
        router.push("/analyze");
        return;
      }

      setCheckingAuth(false);
    };

    checkAuth();
  }, [router]);

  const handleConnect = () => {
    setConnecting(true);
    setStep("connecting");
    // Redirect to OAuth connect endpoint
    window.location.href = "/api/amazon/connect?return_to=onboarding";
    // Callback will redirect to /analyze?connected=1 on success
  };

  const handleSkip = () => {
    router.push("/analyze");
  };

  const handleContinue = () => {
    router.push("/analyze");
  };

  const glassCard =
    "w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl p-6 sm:p-8";
  const glassStyle = {
    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <p className="text-white/70 text-sm">Loading…</p>
      </div>
    );
  }

  if (step === "connecting") {
    return (
      <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-none" aria-hidden />
        <div className={`relative ${glassCard}`} style={glassStyle}>
          <div className="w-16 h-16 mx-auto bg-primary/20 rounded-full flex items-center justify-center mb-4">
            <span className="text-primary font-bold text-2xl">A</span>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2 text-center">Redirecting to Amazon…</h1>
          <p className="text-sm text-white/70 text-center">
            You'll be asked to approve read-only access. Amazon handles authentication — we never see your password.
          </p>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-none" aria-hidden />
        <div className={`relative ${glassCard} space-y-6`} style={glassStyle}>
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-white mb-2">Amazon connected</h1>
            <p className="text-sm text-white/70">Accuracy upgraded. You can continue to Analyze.</p>
          </div>
          <button
            onClick={handleContinue}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-medium py-3 text-sm hover:opacity-90 transition-colors"
          >
            Continue to Analyze
          </button>
        </div>
      </div>
    );
  }

  // Default: prompt step — gradient + glass card (same language as onboarding)
  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-6">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none" aria-hidden />
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-none" aria-hidden />
      <div className={`relative ${glassCard} space-y-6`} style={glassStyle}>
        <h1 className="text-lg font-semibold text-white">Connect Amazon (Recommended)</h1>
        <p className="text-sm text-white/60">Optional — Analyze works without connecting; accuracy is higher when connected.</p>

        {error && (
          <div className="rounded-xl bg-red-500/15 border border-red-400/30 text-red-200 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <ul className="space-y-2 text-sm text-white/90">
          <li>• More accurate fee + margin estimates (uses your real fee structures)</li>
          <li>• Better market and revenue signals over time</li>
          <li>• Read-only access. Disconnect anytime in Settings.</li>
        </ul>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-medium py-3 text-sm hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? "Connecting…" : "Connect Amazon"}
          </button>
          <button
            onClick={handleSkip}
            className="w-full text-sm text-white/60 hover:text-white/90 transition-colors"
          >
            Skip for now
          </button>
        </div>
        <p className="text-xs text-center text-white/40">You can connect later in Settings.</p>
      </div>
    </div>
  );
}

export default function ConnectAmazonPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    }>
      <ConnectAmazonContent />
    </Suspense>
  );
}

