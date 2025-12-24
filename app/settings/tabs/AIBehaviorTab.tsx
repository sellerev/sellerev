"use client";

import { useState } from "react";

export default function AIBehaviorTab() {
  const [preferences, setPreferences] = useState({
    askBeforeRemembering: true,
    prioritizeDataOverOpinions: true,
    showAssumptions: true,
    provideStrategicRecommendations: false,
    useConservativeEstimates: false,
  });

  const [confirmationSetting, setConfirmationSetting] = useState<"always" | "auto" | "never">("always");

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-600 mb-6">
        Control how Sellerev's AI behaves and when it saves preferences.
      </p>

      {/* AI Behavior Preferences */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-4">AI Behavior Preferences</h3>
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.askBeforeRemembering}
              onChange={(e) =>
                setPreferences({ ...preferences, askBeforeRemembering: e.target.checked })
              }
              className="mt-1 w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">
                Ask before remembering inferred preferences
              </span>
              <p className="text-xs text-gray-500 mt-1">
                Sellerev will always ask before saving preferences it infers from your usage.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.prioritizeDataOverOpinions}
              onChange={(e) =>
                setPreferences({ ...preferences, prioritizeDataOverOpinions: e.target.checked })
              }
              className="mt-1 w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">
                Prioritize data over opinions
              </span>
              <p className="text-xs text-gray-500 mt-1">
                AI responses will focus on concrete data rather than speculative advice.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.showAssumptions}
              onChange={(e) =>
                setPreferences({ ...preferences, showAssumptions: e.target.checked })
              }
              className="mt-1 w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">
                Show assumptions when making estimates
              </span>
              <p className="text-xs text-gray-500 mt-1">
                Always disclose when estimates are based on assumptions rather than verified data.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.provideStrategicRecommendations}
              onChange={(e) =>
                setPreferences({ ...preferences, provideStrategicRecommendations: e.target.checked })
              }
              className="mt-1 w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">
                Provide strategic recommendations by default
              </span>
              <p className="text-xs text-gray-500 mt-1">
                AI will proactively suggest strategies, not just answer questions.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.useConservativeEstimates}
              onChange={(e) =>
                setPreferences({ ...preferences, useConservativeEstimates: e.target.checked })
              }
              className="mt-1 w-4 h-4 text-black border-gray-300 rounded focus:ring-black"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">
                Use conservative estimates only
              </span>
              <p className="text-xs text-gray-500 mt-1">
                When data is uncertain, default to more conservative assumptions.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Memory Confirmation Setting */}
      <div className="border-t border-gray-200 pt-6">
        <h3 className="font-semibold text-gray-900 mb-4">Memory Confirmation Setting</h3>
        <p className="text-sm text-gray-600 mb-4">
          When should Sellerev save new preferences?
        </p>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="confirmation"
              value="always"
              checked={confirmationSetting === "always"}
              onChange={() => setConfirmationSetting("always")}
              className="w-4 h-4 text-black border-gray-300 focus:ring-black"
            />
            <span className="text-sm text-gray-700">Always ask me</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="confirmation"
              value="auto"
              checked={confirmationSetting === "auto"}
              onChange={() => setConfirmationSetting("auto")}
              className="w-4 h-4 text-black border-gray-300 focus:ring-black"
            />
            <span className="text-sm text-gray-700">Save obvious ones automatically</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="confirmation"
              value="never"
              checked={confirmationSetting === "never"}
              onChange={() => setConfirmationSetting("never")}
              className="w-4 h-4 text-black border-gray-300 focus:ring-black"
            />
            <span className="text-sm text-gray-700">Never save unless I explicitly say so</span>
          </label>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Default: Always ask me
        </p>
      </div>
    </div>
  );
}
