"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ProfileTab from "./tabs/ProfileTab";
import SecurityTab from "./tabs/SecurityTab";
import NotificationsTab from "./tabs/NotificationsTab";

type Tab = "profile" | "security" | "notifications";

function AccountPageContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "security" || tab === "notifications" || tab === "billing") {
      if (tab === "billing") {
        // Billing is a placeholder, show notifications for now
        setActiveTab("notifications");
      } else {
        setActiveTab(tab as Tab);
      }
    } else {
      setActiveTab("profile");
    }
  }, [searchParams]);

  const tabs = [
    { id: "profile" as Tab, label: "Profile" },
    { id: "security" as Tab, label: "Security" },
    { id: "notifications" as Tab, label: "Notifications" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Account Settings
          </h1>
          <p className="text-gray-600">
            Manage your account information and preferences
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-8" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  window.history.replaceState(null, "", `?tab=${tab.id}`);
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
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "security" && <SecurityTab />}
          {activeTab === "notifications" && <NotificationsTab />}
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="h-full bg-gray-50 flex items-center justify-center">Loading...</div>}>
      <AccountPageContent />
    </Suspense>
  );
}

