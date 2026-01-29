"use client";

import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

interface AmazonConnection {
  id: string;
  status: "connected" | "revoked" | "error";
  refresh_token_last4: string;
  seller_display_name: string | null;
  primary_marketplace_name: string | null;
  marketplace_ids: string[] | null;
  created_at: string;
  revoked_at: string | null;
}

export default function IntegrationsTab() {
  const [amazonConnection, setAmazonConnection] = useState<AmazonConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    loadConnection();
    
    // Check for success/error params in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "amazon") {
      // Reload connection status
      setTimeout(() => {
        loadConnection();
        // Clean up URL
        window.history.replaceState({}, "", window.location.pathname);
      }, 500);
    }
  }, []);

  async function loadConnection() {
    try {
      setLoading(true);
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return;

      const { data, error } = await supabaseBrowser
        .from("amazon_connections")
        .select("id, status, refresh_token_last4, seller_display_name, primary_marketplace_name, marketplace_ids, created_at, revoked_at")
        .eq("user_id", user.id)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned, which is fine
        console.error("Error loading connection:", error);
      } else if (data) {
        setAmazonConnection(data);
      } else {
        setAmazonConnection(null);
      }
    } catch (error) {
      console.error("Error loading Amazon connection:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    try {
      setConnecting(true);
      // Redirect to connect endpoint
      window.location.href = "/api/amazon/connect";
    } catch (error) {
      console.error("Error initiating connection:", error);
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect your Amazon account? This will prevent Sellerev from accessing pricing and fees data for your account.")) {
      return;
    }

    try {
      setDisconnecting(true);
      const response = await fetch("/api/amazon/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      // Reload connection status
      await loadConnection();
    } catch (error) {
      console.error("Error disconnecting:", error);
      alert("Failed to disconnect. Please try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = amazonConnection?.status === "connected";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Amazon SP-API Integration</h2>
        <p className="text-sm text-gray-600">
          Connect your Amazon seller account to enable access to pricing and fees data through Amazon's Selling Partner API.
        </p>
      </div>

      {/* Amazon Connection Card */}
      <div className="border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <span className="text-orange-600 font-bold text-lg">A</span>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">Amazon Seller Account</h3>
                {loading ? (
                  <p className="text-sm text-gray-500">Loading...</p>
                ) : isConnected ? (
                  <p className="text-sm text-green-600">
                    Connected{amazonConnection?.seller_display_name ? ` — ${amazonConnection.seller_display_name}` : ""}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">Not connected</p>
                )}
              </div>
            </div>

            {isConnected && amazonConnection && (
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                {amazonConnection.primary_marketplace_name && (
                  <p>
                    <span className="font-medium">Marketplace:</span> {amazonConnection.primary_marketplace_name}
                  </p>
                )}
                <p>
                  <span className="font-medium">Token:</span> ••••{amazonConnection.refresh_token_last4}
                </p>
                <p>
                  <span className="font-medium">Connected:</span>{" "}
                  {new Date(amazonConnection.created_at).toLocaleDateString()}
                </p>
              </div>
            )}

            <div className="mt-4 space-y-2 text-sm text-gray-600">
              <p className="font-medium text-gray-900">What this enables:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Access to Amazon Pricing API for accurate buy box and offer data</li>
                <li>Access to Amazon Fees API for precise FBA fee calculations</li>
                <li>Better accuracy in margin calculations and feasibility analysis</li>
              </ul>
            </div>

            <div className="mt-4 space-y-2 text-sm text-gray-600">
              <p className="font-medium text-gray-900">Privacy & Security:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>One-time connect - no need to log in every time</li>
                <li>Read-only access - we never modify your listings or account</li>
                <li>No buyer data - we only access seller account data</li>
                <li>Disconnect anytime - revoke access at any time</li>
                <li>Encrypted storage - tokens are encrypted at rest</li>
              </ul>
            </div>
          </div>

          <div className="ml-6">
            {loading ? (
              <div className="w-24 h-10 bg-gray-100 rounded-lg animate-pulse" />
            ) : isConnected ? (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <p className="text-xs text-gray-500 text-right max-w-[200px]">
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
                  className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connecting ? "Connecting..." : "Connect Amazon"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

