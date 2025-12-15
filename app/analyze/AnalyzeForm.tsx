"use client";

import { useState } from "react";

export default function AnalyzeForm() {
  const [inputType, setInputType] = useState<"asin" | "idea">("idea");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

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
      setResult(data.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Sellerev – Analyze (Test)</h1>

      <div style={{ marginTop: 16 }}>
        <label>Input type</label>
        <br />
        <select
          value={inputType}
          onChange={(e) => setInputType(e.target.value as "asin" | "idea")}
        >
          <option value="idea">Idea / Keyword</option>
          <option value="asin">ASIN</option>
        </select>
      </div>

      <div style={{ marginTop: 16 }}>
        <label>Input value</label>
        <br />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={analyze} disabled={loading || !inputValue}>
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {error && (
        <p style={{ color: "red", marginTop: 16 }}>{error}</p>
      )}

      {result && (
        <pre
          style={{
            marginTop: 24,
            padding: 16,
            background: "#f5f5f5",
            overflowX: "auto",
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
