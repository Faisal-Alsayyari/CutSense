import { useCallback, useRef, useState } from "react";
import { Dropzone } from "./components/Dropzone";
import { ProgressBar } from "./components/ProgressBar";
import { Transcript } from "./components/Transcript";
import { CopyButton } from "./components/CopyButton";
import {
  uploadToBlob,
  blobToGemini,
  streamAnnotations,
  deleteBlob,
  type Annotation,
} from "./lib/api";
import "./App.css";

type Phase =
  | "idle"
  | "uploading-to-blob"
  | "processing"
  | "streaming"
  | "done"
  | "error";

function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [hints, setHints] = useState("");
  const [uploadFraction, setUploadFraction] = useState(0);
  const [rows, setRows] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setFile(null);
    setUploadFraction(0);
    setRows([]);
    setError(null);
  }, []);

  const run = useCallback(async () => {
    if (!file) return;
    setRows([]);
    setError(null);
    setUploadFraction(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let blobUrl: string | null = null;
    try {
      setPhase("uploading-to-blob");
      const uploaded = await uploadToBlob(file, setUploadFraction, ctrl.signal);
      blobUrl = uploaded.blobUrl;

      setPhase("processing");
      const { fileName } = await blobToGemini(
        uploaded.blobUrl,
        uploaded.mimeType,
        uploaded.size,
        ctrl.signal
      );

      await streamAnnotations(
        fileName,
        hints || undefined,
        {
          onStatus: (p) => {
            if (p === "streaming") setPhase("streaming");
          },
          onAnnotation: (a) => setRows((prev) => [...prev, a]),
          onDone: () => {
            setPhase("done");
            if (blobUrl) void deleteBlob(blobUrl);
          },
          onError: (msg) => {
            setError(msg);
            setPhase("error");
            if (blobUrl) void deleteBlob(blobUrl);
          },
        },
        ctrl.signal
      );
    } catch (err) {
      if (blobUrl) void deleteBlob(blobUrl);
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [file, hints]);

  const busy =
    phase === "uploading-to-blob" ||
    phase === "processing" ||
    phase === "streaming";

  return (
    <div className="app">
      <header className="app-header">
        <h1>CutSense MVP</h1>
        <p>Drop raw footage, get a timestamped transcript.</p>
      </header>

      <main className="app-main">
        <section className="controls">
          <Dropzone onFile={setFile} disabled={busy} />

          {file && (
            <div className="file-info">
              <div className="file-name">{file.name}</div>
              <div className="file-meta">
                {(file.size / (1024 * 1024)).toFixed(1)} MB ·{" "}
                {file.type || "unknown"}
              </div>
            </div>
          )}

          <label className="hints">
            <span>Hints (optional)</span>
            <textarea
              value={hints}
              onChange={(e) => setHints(e.target.value)}
              placeholder="e.g. focus on the UI refactor and any error messages"
              disabled={busy}
              rows={3}
            />
          </label>

          <div className="actions">
            <button
              className="primary"
              onClick={run}
              disabled={!file || busy}
            >
              {busy ? "Working…" : "Annotate"}
            </button>
            <button
              className="secondary"
              onClick={reset}
              disabled={phase === "idle"}
            >
              {busy ? "Cancel" : "Reset"}
            </button>
          </div>

          <StatusLine
            phase={phase}
            uploadFraction={uploadFraction}
            error={error}
          />
        </section>

        <section className="output">
          <div className="output-header">
            <h2>
              Transcript{" "}
              {rows.length > 0 && <span className="count">({rows.length})</span>}
            </h2>
            <CopyButton rows={rows} disabled={busy} />
          </div>
          <Transcript rows={rows} />
        </section>
      </main>
    </div>
  );
}

function StatusLine({
  phase,
  uploadFraction,
  error,
}: {
  phase: Phase;
  uploadFraction: number;
  error: string | null;
}) {
  if (phase === "idle") return null;
  if (phase === "error")
    return <div className="status error">Error: {error}</div>;
  if (phase === "uploading-to-blob")
    return <ProgressBar fraction={uploadFraction} label="Uploading" />;
  if (phase === "processing")
    return <div className="status">Sending to Gemini…</div>;
  if (phase === "streaming")
    return <div className="status pulse">Annotating live…</div>;
  if (phase === "done") return <div className="status success">Done.</div>;
  return null;
}

export default App;
