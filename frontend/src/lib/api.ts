export type Annotation = { t: string; d: string };

/** Dev-only proxy: forward /api/* to `vercel dev` when running `vite` standalone. */
export const API_BASE = "";

export async function requestUploadUrl(file: File): Promise<{ uploadUrl: string }> {
  const res = await fetch(`${API_BASE}/api/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `upload-url failed (${res.status})`);
  }
  return res.json();
}

/**
 * PUT the file bytes directly to the Gemini resumable upload URL,
 * with XHR so we can report byte-level progress.
 *
 * Returns the resulting `fileName` (e.g. "files/abc123") from Gemini.
 */
export function uploadToGemini(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("Content-Length", String(file.size));
    xhr.setRequestHeader("X-Goog-Upload-Offset", "0");
    xhr.setRequestHeader("X-Goog-Upload-Command", "upload, finalize");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as {
          file?: { name?: string };
        };
        const name = body.file?.name;
        if (!name) {
          reject(new Error("Upload response missing file.name"));
          return;
        }
        resolve(name);
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

export type SSEHandlers = {
  onAnnotation: (a: Annotation) => void;
  onStatus?: (phase: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

/**
 * POST /api/annotate and read the SSE stream via fetch + ReadableStream.
 * (EventSource can't POST, so we parse SSE manually.)
 */
export async function streamAnnotations(
  fileName: string,
  hints: string | undefined,
  handlers: SSEHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/annotate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, hints }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`annotate failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line.
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      handleEvent(rawEvent, handlers);
    }
  }
}

function handleEvent(raw: string, h: SSEHandlers): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  const dataStr = dataLines.join("\n");
  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return;
  }

  if (event === "done") {
    h.onDone?.();
  } else if (event === "error") {
    const msg =
      data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : "Unknown error";
    h.onError?.(msg);
  } else if (event === "status") {
    const phase =
      data && typeof data === "object" && "phase" in data
        ? String((data as { phase: unknown }).phase)
        : "";
    if (phase) h.onStatus?.(phase);
  } else if (event === "message") {
    if (
      data &&
      typeof data === "object" &&
      typeof (data as Annotation).t === "string" &&
      typeof (data as Annotation).d === "string"
    ) {
      h.onAnnotation(data as Annotation);
    }
  }
}
