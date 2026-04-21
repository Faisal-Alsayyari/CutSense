import { GoogleGenAI } from "@google/genai";

/**
 * Supported video MIME types per Gemini Files API.
 */
export const SUPPORTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/avi",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
] as const;

// support 2 GB for now (Gemini max for free tier)
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

const FILES_API_BASE = "https://generativelanguage.googleapis.com";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

export function getClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: getApiKey() });
}

/**
 * Initiate a resumable upload against the Gemini Files API.
 * Returns a one-time upload URL the browser can PUT bytes to directly,
 * plus the `fileName` (e.g. "files/abc123") to reference in generateContent.
 */
export async function createResumableUpload(params: {
  displayName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ uploadUrl: string }> {
  const res = await fetch(`${FILES_API_BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": getApiKey(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(params.sizeBytes),
      "X-Goog-Upload-Header-Content-Type": params.mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: params.displayName } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to initiate resumable upload (${res.status}): ${text}`
    );
  }

  const uploadUrl = res.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Files API did not return an upload URL");
  }
  return { uploadUrl };
}

/**
 * Poll files.get until state === "ACTIVE" or a terminal state is reached.
 * Returns the final file metadata.
 */
export async function waitUntilActive(
  fileName: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<{ name: string; uri: string; mimeType: string; state: string }> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  const ai = getClient();

  // Accept both "files/abc" and bare "abc".
  const name = fileName.startsWith("files/") ? fileName : `files/${fileName}`;

  while (Date.now() < deadline) {
    const file = await ai.files.get({ name });
    const state = String(file.state ?? "");
    if (state === "ACTIVE") {
      return {
        name: file.name ?? name,
        uri: file.uri ?? "",
        mimeType: file.mimeType ?? "",
        state,
      };
    }
    if (state === "FAILED") {
      throw new Error(`Gemini Files API processing failed for ${name}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${name} to become ACTIVE`);
}
