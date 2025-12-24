"use client";

import { useState, useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import OverviewTab from "./tabs/OverviewTab";
import OperatingPreferencesTab from "./tabs/OperatingPreferencesTab";
import FinancialConstraintsTab from "./tabs/FinancialConstraintsTab";
import SourcingLogisticsTab from "./tabs/SourcingLogisticsTab";
import AIBehaviorTab from "./tabs/AIBehaviorTab";
import DataSourcesTab from "./tabs/DataSourcesTab";
import PendingMemoryReview from "./components/PendingMemoryReview";

type Tab = "overview" | "preferences" | "financial" | "sourcing" | "ai" | "data";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [pendingCount, setPendingCount] = useState(0);
  const [showPendingReview, setShowPendingReview] = useState(false);

  // Load pending memory count
  useEffect(() => {
    loadPendingCount();
    
    // Handle hash-based tab navigation
    const hash = window.location.hash.replace("#", "");
    if (hash && tabs.some((t) => t.id === hash)) {
      setActiveTab(hash as Tab);
    }
    
    // Listen for custom tab change events
    const handleTabChange = (e: CustomEvent) => {
      const tabId = e.detail as Tab;
      if (tabs.some((t) => t.id === tabId)) {
        setActiveTab(tabId);
        window.history.replaceState(null, "", `#${tabId}`);
      }
    };
    
    window.addEventListener("settings-tab-change", handleTabChange as EventListener);
    return () => {
      window.removeEventListener("settings-tab-change", handleTabChange as EventListener);
    };
  }, []);

  async function loadPendingCount() {
    try {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) return;

      const { getPendingMemories } = await import("@/lib/ai/sellerMemoryStore");
      const { shouldAskUserToConfirm } = await import("@/lib/ai/memoryMerge");
      
      // We need to use server-side supabase for this
      // For now, we'll fetch via API
      const response = await fetch("/api/memory/pending");
      if (response.ok) {
        const data = await response.json();
        const count = data.pending?.filter((p: any) => 
          shouldAskUserToConfirm(p.memory_candidate, p.reason)
        ).length || 0;
        setPendingCount(count);
        if (count > 0) {
          setShowPendingReview(true);
        }
      }
    } catch (error) {
      console.error("Error loading pending count:", error);
    }
  }

  const tabs = [
    { id: "overview" as Tab, label: "Overview" },
    { id: "preferences" as Tab, label: "Operating Preferences" },
    { id: "financial" as Tab, label: "Financial Constraints" },
    { id: "sourcing" as Tab, label: "Sourcing & Logistics" },
    { id: "ai" as Tab, label: "AI Behavior" },
    { id: "data" as Tab, label: "Data Sources" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Seller Profile & Preferences
          </h1>
          <p className="text-gray-600">
            Manage how Sellerev tailors analysis and AI responses to your business
          </p>
        </div>

        {/* Pending Memory Banner */}
        {pendingCount > 0 && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 font-semibold">{pendingCount}</span>
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  Sellerev has {pendingCount} suggestion{pendingCount !== 1 ? 's' : ''} to review
                </p>
                <p className="text-sm text-gray-600">
                  Review preferences that were inferred from your conversations
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowPendingReview(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Review now
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-8" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  // Update URL hash for deep linking
                  window.history.replaceState(null, "", `#${tab.id}`);
                }}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.id
                      ? "border-black text-black"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {activeTab === "overview" && <OverviewTab onReviewPending={() => setShowPendingReview(true)} />}
          {activeTab === "preferences" && <OperatingPreferencesTab />}
          {activeTab === "financial" && <FinancialConstraintsTab />}
          {activeTab === "sourcing" && <SourcingLogisticsTab />}
          {activeTab === "ai" && <AIBehaviorTab />}
          {activeTab === "data" && <DataSourcesTab />}
        </div>

        {/* Pending Memory Review Modal */}
        {showPendingReview && (
          <PendingMemoryReview
            onClose={() => {
              setShowPendingReview(false);
              loadPendingCount();
            }}
          />
        )}
      </div>
    </div>
  );
}
