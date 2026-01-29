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
        // Already connected, skip to onboarding
        router.push("/onboarding");
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
  };

  const handleSkip = () => {
    router.push("/onboarding");
  };

  const handleContinue = () => {
    router.push("/onboarding");
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (step === "connecting") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="w-16 h-16 mx-auto bg-orange-100 rounded-full flex items-center justify-center">
            <span className="text-orange-600 font-bold text-2xl">A</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">
              Redirecting to Amazon…
            </h1>
            <p className="text-gray-600">
              You'll be asked to approve access to pricing & fee data.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Amazon handles authentication — we never see your password.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">
              Amazon Connected Successfully
            </h1>
            <p className="text-gray-600">
              Your account is now linked.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Sellerev will use this connection to provide exact fees and pricing insights.
            </p>
          </div>
          <button
            onClick={handleContinue}
            className="w-full bg-black text-white rounded-lg p-3 font-medium hover:bg-gray-800 transition-colors"
          >
            Continue Setup
          </button>
        </div>
      </div>
    );
  }

  // Default: prompt step
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 mx-auto bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <span className="text-orange-600 font-bold text-2xl">A</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Connect Amazon for Accurate Insights
          </h1>
          <p className="text-sm text-gray-500">
            Optional — you can skip this and connect later
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Main Explanation */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <p className="text-gray-700">
            Sellerev works without connecting Amazon.
          </p>
          <p className="text-gray-700">
            Connecting your Seller Central account unlocks:
          </p>
          <ul className="space-y-2 text-gray-700">
            <li className="flex items-start">
              <span className="text-orange-600 mr-2">•</span>
              <span>Exact FBA fee calculations (no estimates)</span>
            </li>
            <li className="flex items-start">
              <span className="text-orange-600 mr-2">•</span>
              <span>Buy Box ownership (Amazon vs 3P sellers)</span>
            </li>
            <li className="flex items-start">
              <span className="text-orange-600 mr-2">•</span>
              <span>More accurate pricing & fulfillment signals</span>
            </li>
          </ul>
          <p className="text-sm text-gray-600 pt-2 border-t border-gray-100">
            This is a one-time, secure connection using Amazon OAuth.
            <br />
            You can disconnect anytime.
          </p>
        </div>

        {/* Trust & Safety */}
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 space-y-4">
          <p className="font-medium text-gray-900 text-sm">What we can access:</p>
          <ul className="space-y-1 text-sm text-gray-700">
            <li className="flex items-start">
              <span className="text-gray-400 mr-2">•</span>
              <span>Product pricing & fee data for your account</span>
            </li>
          </ul>
          <p className="font-medium text-gray-900 text-sm pt-2 border-t border-gray-200">
            What we never access:
          </p>
          <ul className="space-y-1 text-sm text-gray-700">
            <li className="flex items-start">
              <span className="text-gray-400 mr-2">•</span>
              <span>Buyer data</span>
            </li>
            <li className="flex items-start">
              <span className="text-gray-400 mr-2">•</span>
              <span>Messages or customer info</span>
            </li>
            <li className="flex items-start">
              <span className="text-gray-400 mr-2">•</span>
              <span>Your password</span>
            </li>
            <li className="flex items-start">
              <span className="text-gray-400 mr-2">•</span>
              <span>Competitor seller data</span>
            </li>
          </ul>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Don't have an Amazon account yet? Fees will be close but estimated.{" "}
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="text-orange-600 font-medium hover:underline disabled:opacity-50"
            >
              Connect for exact fees.
            </button>
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full bg-orange-600 text-white rounded-lg p-3 font-medium hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? "Connecting..." : "Connect Amazon"}
          </button>
          <p className="text-xs text-center text-gray-500">
            Takes ~30 seconds
          </p>

          <button
            onClick={handleSkip}
            className="w-full text-gray-600 rounded-lg p-3 font-medium hover:bg-gray-100 transition-colors border border-gray-200"
          >
            Skip for now
          </button>
          <p className="text-xs text-center text-gray-500">
            You can connect later in Settings
          </p>
        </div>
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

