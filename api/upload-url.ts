import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createResumableUpload,
  MAX_FILE_BYTES,
  SUPPORTED_VIDEO_MIME_TYPES,
} from "./lib/geminiClient.js";

type Body = {
  filename?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const body = (req.body ?? {}) as Body;
  const filename = typeof body.filename === "string" ? body.filename : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const sizeBytes =
    typeof body.sizeBytes === "number" ? body.sizeBytes : Number(body.sizeBytes);

  if (!filename) {
    res.status(400).json({ error: "filename is required" });
    return;
  }
  if (!mimeType || !isSupportedMime(mimeType)) {
    res.status(400).json({
      error: `Unsupported mimeType. Allowed: ${SUPPORTED_VIDEO_MIME_TYPES.join(", ")}`,
    });
    return;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    res.status(400).json({ error: "sizeBytes must be a positive number" });
    return;
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    res.status(400).json({
      error: `File exceeds 2 GB limit (got ${sizeBytes} bytes)`,
    });
    return;
  }

  try {
    const { uploadUrl } = await createResumableUpload({
      displayName: filename,
      mimeType,
      sizeBytes,
    });
    res.status(200).json({ uploadUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}

function isSupportedMime(m: string): boolean {
  return (SUPPORTED_VIDEO_MIME_TYPES as readonly string[]).includes(m);
}
