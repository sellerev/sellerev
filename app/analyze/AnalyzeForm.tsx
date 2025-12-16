"use client";

import { useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AnalyzeForm() {
  const [inputType, setInputType] = useState<"asin" | "idea">("idea");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  
  // AI Assistant sidebar state
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input_type: inputType,
          input_value: inputValue,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Analyze failed");
      }

      const data = await res.json();
      setAnalysis(data.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !analysis) return;

    const userMessage: Message = {
      role: "user",
      content: chatInput,
    };

    setMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    // Stub: POST to /api/assistant (placeholder for now)
    try {
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      const assistantMessage: Message = {
        role: "assistant",
        content: "Based on the current analysis, I can help explain risks, confidence, or what would change the verdict.",
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (e) {
      // Handle error silently for now
    } finally {
      setChatLoading(false);
    }
  };

  const getVerdictColor = (verdict: string) => {
    switch (verdict) {
      case "GO":
        return "bg-green-100 text-green-800 border-green-300";
      case "CAUTION":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "NO_GO":
        return "bg-red-100 text-red-800 border-red-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Input Bar - Full Width */}
      <div className="border-b p-4 bg-white">
        <div className="flex gap-4 items-end max-w-7xl mx-auto">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Input Type</label>
            <select
              className="border rounded p-2 w-full"
              value={inputType}
              onChange={(e) => setInputType(e.target.value as "asin" | "idea")}
              disabled={loading}
            >
              <option value="idea">Idea / Keyword</option>
              <option value="asin">ASIN</option>
            </select>
          </div>
          <div className="flex-2">
            <label className="block text-sm font-medium mb-1">Input Value</label>
            <input
              type="text"
              className="border rounded p-2 w-full"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading && inputValue.trim()) {
                  analyze();
                }
              }}
              disabled={loading}
              placeholder="Enter product idea or ASIN"
            />
          </div>
          <button
            className="bg-black text-white rounded p-2 px-6 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={analyze}
            disabled={loading || !inputValue.trim()}
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>
        {error && (
          <div className="mt-2 text-red-600 text-sm">{error}</div>
        )}
      </div>

      {/* Main Content + Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main Content - 70% */}
        <div className="flex-1 overflow-y-auto p-6" style={{ width: "70%" }}>
          {!analysis ? (
            <div className="text-center text-gray-500 mt-12">
              <p>Enter an idea or ASIN to analyze.</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-4xl">
              {/* Market Snapshot */}
              <div className="border rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4">Market Snapshot</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-gray-500">Competition:</span>
                    <span className="ml-2 font-medium">High</span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-500">Saturation:</span>
                    <span className="ml-2 font-medium">Heavy</span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-500">Price band:</span>
                    <span className="ml-2 font-medium">Mid</span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-500">Review density:</span>
                    <span className="ml-2 font-medium">High</span>
                  </div>
                </div>
              </div>

              {/* Decision Header */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-4 mb-4">
                  <span className={`px-4 py-2 rounded border font-semibold ${getVerdictColor(analysis.decision?.verdict || "")}`}>
                    {analysis.decision?.verdict || "UNKNOWN"}
                  </span>
                  <span className="text-lg font-medium">
                    {analysis.decision?.confidence || 0}% confidence
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Executive Summary</h3>
                  <p className="text-gray-700">{analysis.executive_summary || "No summary available."}</p>
                </div>
              </div>

              {/* Reasoning */}
              <div className="border rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4">Reasoning</h2>
                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium mb-2">Primary Factors</h3>
                    <ul className="list-disc list-inside space-y-1">
                      {analysis.reasoning?.primary_factors?.map((factor: string, idx: number) => (
                        <li key={idx} className="text-gray-700">{factor}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">Seller Context Impact</h3>
                    <p className="text-gray-700">{analysis.reasoning?.seller_context_impact || "No context impact available."}</p>
                  </div>
                </div>
              </div>

              {/* Risks */}
              <div className="border rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4">Risks</h2>
                <div className="grid grid-cols-2 gap-4">
                  {analysis.risks && Object.entries(analysis.risks).map(([key, risk]: [string, any]) => (
                    <div key={key} className="border rounded p-3">
                      <div className="font-medium capitalize mb-1">{key}</div>
                      <div className="text-sm text-gray-600 mb-2">
                        Level: <span className="font-medium">{risk?.level || "Unknown"}</span>
                      </div>
                      <p className="text-sm text-gray-700">{risk?.explanation || "No explanation available."}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Actions */}
              <div className="border rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4">Recommended Actions</h2>
                <div className="space-y-4">
                  {analysis.recommended_actions?.must_do && analysis.recommended_actions.must_do.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-2 text-green-700">Must Do</h3>
                      <ul className="list-disc list-inside space-y-1">
                        {analysis.recommended_actions.must_do.map((action: string, idx: number) => (
                          <li key={idx} className="text-gray-700">{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysis.recommended_actions?.should_do && analysis.recommended_actions.should_do.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-2 text-blue-700">Should Do</h3>
                      <ul className="list-disc list-inside space-y-1">
                        {analysis.recommended_actions.should_do.map((action: string, idx: number) => (
                          <li key={idx} className="text-gray-700">{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysis.recommended_actions?.avoid && analysis.recommended_actions.avoid.length > 0 && (
                    <div>
                      <h3 className="font-medium mb-2 text-red-700">Avoid</h3>
                      <ul className="list-disc list-inside space-y-1">
                        {analysis.recommended_actions.avoid.map((action: string, idx: number) => (
                          <li key={idx} className="text-gray-700">{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Assumptions and Limits */}
              {analysis.assumptions_and_limits && analysis.assumptions_and_limits.length > 0 && (
                <div className="border rounded-lg p-4">
                  <h2 className="text-lg font-semibold mb-4">Assumptions and Limits</h2>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.assumptions_and_limits.map((item: string, idx: number) => (
                      <li key={idx} className="text-gray-700">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI Assistant Sidebar - 30% */}
        <div className="border-l bg-gray-50 flex flex-col" style={{ width: "30%" }}>
          <div className="p-4 border-b bg-white">
            <h2 className="font-semibold">AI Assistant</h2>
            <p className="text-sm text-gray-500">Ask questions about this analysis</p>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 mt-8">
                <p className="text-sm">Start a conversation about the analysis</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded ${
                    msg.role === "user"
                      ? "bg-blue-100 ml-8"
                      : "bg-white mr-8 border"
                  }`}
                >
                  <div className="text-xs font-medium mb-1 text-gray-500">
                    {msg.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div className="text-sm">{msg.content}</div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="p-3 rounded bg-white mr-8 border">
                <div className="text-xs font-medium mb-1 text-gray-500">Assistant</div>
                <div className="text-sm text-gray-500">Thinking...</div>
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="p-4 border-t bg-white">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border rounded p-2 text-sm"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !chatLoading && chatInput.trim() && analysis) {
                    sendChatMessage();
                  }
                }}
                placeholder="Ask about the analysis..."
                disabled={!analysis || chatLoading}
              />
              <button
                className="bg-black text-white rounded p-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                onClick={sendChatMessage}
                disabled={!analysis || !chatInput.trim() || chatLoading}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
