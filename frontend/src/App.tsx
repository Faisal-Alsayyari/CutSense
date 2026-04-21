import { useState } from "react";
import "./App.css";

type Moment = { timestamp: string; summary: string };

type Phase = "idle" | "uploading" | "done" | "error";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [moments, setMoments] = useState<Moment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (!file) return;
    setPhase("uploading");
    setError(null);
    setMoments([]);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as Moment[];
      setMoments(data);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  return (
    <div className="app">
      <h1>CutSense</h1>
      <p className="sub">Upload a short video. Get timestamped summaries.</p>

      <div className="row">
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={phase === "uploading"}
        />
        <button
          onClick={run}
          disabled={!file || phase === "uploading"}
          className="primary"
        >
          {phase === "uploading" ? "Processing…" : "Summarize"}
        </button>
      </div>

      {file && (
        <div className="meta">
          {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
        </div>
      )}

      {phase === "error" && <div className="error">Error: {error}</div>}

      {moments.length > 0 && (
        <table className="moments">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {moments.map((m, i) => (
              <tr key={i}>
                <td>{m.timestamp}</td>
                <td>{m.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
