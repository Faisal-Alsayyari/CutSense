import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import {
  MAX_FILE_BYTES,
  SUPPORTED_VIDEO_MIME_TYPES,
} from "./lib/geminiClient.js";

/**
 * Mints short-lived client-upload tokens so the browser can PUT directly
 * to Vercel Blob storage (CORS-safe, no server bandwidth).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req as unknown as Request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: [...SUPPORTED_VIDEO_MIME_TYPES],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // No-op for MVP; blob is deleted explicitly after annotation completes.
      },
    });
    res.status(200).json(jsonResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
}
