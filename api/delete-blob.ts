import type { VercelRequest, VercelResponse } from "@vercel/node";
import { del } from "@vercel/blob";

type Body = { blobUrl?: unknown };

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
  if (!blobUrl) {
    res.status(400).json({ error: "blobUrl is required" });
    return;
  }
  try {
    await del(blobUrl);
    res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}
