export type Annotation = { t: string; d: string };

const API_BASE = "";

export function uploadToBlob(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<{ blobUrl: string; size: number; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText) as {
          blobUrl: string;
          size: number;
        };
        resolve({ blobUrl: data.blobUrl, size: data.size, mimeType: file.type });
      } else {
        const data = JSON.parse(xhr.responseText) as { error?: string };
        reject(new Error(data.error ?? `Upload failed (${xhr.status})`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(Object.assign(new Error("AbortError"), { name: "AbortError" })));
    signal?.addEventListener("abort", () => xhr.abort());

    xhr.open("POST", `${API_BASE}/api/upload?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

export async function blobToGemini(
  blobUrl: string,
  mimeType: string,
  size: number,
  signal?: AbortSignal
): Promise<{ fileName: string }> {
  const res = await fetch(`${API_BASE}/api/blob-to-gemini`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blobUrl, mimeType, size }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (err as { error?: string }).error ?? `blob-to-gemini failed (${res.status})`
    );
  }
  return res.json();
}

export async function deleteBlob(blobUrl: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/delete-blob`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrl }),
      keepalive: true,
    });
  } catch {
    // ignore
  }
}

export type SSEHandlers = {
  onAnnotation: (a: Annotation) => void;
  onStatus?: (phase: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

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
