import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "stream";
import {
  SUPPORTED_VIDEO_MIME_TYPES,
  MAX_FILE_BYTES,
  createResumableUpload,
  waitUntilActive,
} from "./lib/geminiClient.js";

export const config = { maxDuration: 60 };

type Body = {
  blobUrl?: unknown;
  mimeType?: unknown;
  size?: unknown;
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
  const blobUrl = typeof body.blobUrl === "string" ? body.blobUrl : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const size =
    typeof body.size === "number" ? body.size : Number(body.size);

  if (!blobUrl) {
    res.status(400).json({ error: "blobUrl is required" });
    return;
  }
  if (!mimeType || !(SUPPORTED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    res.status(400).json({ error: `Unsupported mimeType: ${mimeType}` });
    return;
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
    res.status(400).json({ error: "Invalid size" });
    return;
  }

  try {
    // 1. Fetch the blob as a stream.
    const blobRes = await fetch(blobUrl);
    if (!blobRes.ok || !blobRes.body) {
      throw new Error(`Failed to fetch blob (${blobRes.status})`);
    }

    // 2. Initiate Gemini resumable upload.
    const { uploadUrl } = await createResumableUpload({
      displayName: `cutsense-${Date.now()}`,
      mimeType,
      sizeBytes: size,
    });

    // 3. Stream the blob directly into Gemini (no buffering).
    const nodeReadable = Readable.fromWeb(
      blobRes.body as Parameters<typeof Readable.fromWeb>[0]
    );
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(size),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: nodeReadable as unknown as ReadableStream<Uint8Array>,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    if (!putRes.ok) {
      const text = await putRes.text().catch(() => "");
      throw new Error(`Gemini upload failed (${putRes.status}): ${text}`);
    }

    const data = (await putRes.json()) as { file?: { name?: string } };
    const fileName = data.file?.name;
    if (!fileName) {
      throw new Error("Upload response missing file.name");
    }

    // 4. Poll until ACTIVE so /api/annotate can call generateContent immediately.
    const file = await waitUntilActive(fileName, { timeoutMs: 45_000 });

    res.status(200).json({ fileName: file.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
