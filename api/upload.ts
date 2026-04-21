import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put } from "@vercel/blob";
import {
  MAX_FILE_BYTES,
  SUPPORTED_VIDEO_MIME_TYPES,
} from "./lib/geminiClient.js";

export const config = { maxDuration: 60 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const filename =
    typeof req.query.filename === "string" ? req.query.filename : "";
  const mimeType =
    typeof req.headers["content-type"] === "string"
      ? req.headers["content-type"]
      : "";
  const buffer = req.body as Buffer;

  if (!filename || !mimeType) {
    res
      .status(400)
      .json({ error: "filename query param and Content-Type header required" });
    return;
  }

  if (!(SUPPORTED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    res.status(400).json({ error: `Unsupported mimeType: ${mimeType}` });
    return;
  }

  if (!Buffer.isBuffer(buffer) || buffer.length <= 0 || buffer.length > MAX_FILE_BYTES) {
    res.status(400).json({
      error: `File size invalid (max ${(MAX_FILE_BYTES / 1024 ** 3).toFixed(0)}GB)`,
    });
    return;
  }

  try {
    const blob = await put(filename, buffer, {
      contentType: mimeType,
      access: "public",
    });
    res.status(200).json({ blobUrl: blob.url, size: buffer.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
