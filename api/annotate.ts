import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPartFromUri } from "@google/genai";
import { getClient, waitUntilActive } from "./lib/geminiClient.js";
import {
  GEMINI_MODEL,
  SYSTEM_INSTRUCTION,
  buildUserPrompt,
} from "./lib/prompt.js";
import { iterateSources } from "./lib/videoSource.js";

export const config = {
  // Long-running stream; requires Vercel Pro for the full 300s.
  maxDuration: 300,
};

type Body = { fileName?: unknown; hints?: unknown };

type Annotation = { t: string; d: string };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const body = (req.body ?? {}) as Body;
  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const hints = typeof body.hints === "string" ? body.hints : undefined;

  if (!fileName) {
    res.status(400).json({ error: "fileName is required" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const sendRaw = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    send("status", { phase: "waiting-for-active" });
    const file = await waitUntilActive(fileName);
    if (!file.uri) throw new Error("File has no URI after becoming ACTIVE");

    send("status", { phase: "streaming" });

    const ai = getClient();

    for await (const source of iterateSources(file.name)) {
      if (aborted) break;

      const videoPart = createPartFromUri(file.uri, file.mimeType);
      const textPart = { text: buildUserPrompt(hints) };

      const stream = await ai.models.generateContentStream({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [videoPart, textPart] }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.3,
        },
      });

      let buffer = "";
      for await (const chunk of stream) {
        if (aborted) break;
        const text = chunk.text ?? "";
        if (!text) continue;
        buffer += text;

        // Split on newlines; keep trailing partial line in buffer.
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          const rawLine = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          const parsed = tryParseAnnotation(rawLine);
          if (parsed) sendRaw(applyOffset(parsed, source.offsetSec));
        }
      }
      // Flush any final unterminated line.
      const tail = buffer.trim();
      if (tail) {
        const parsed = tryParseAnnotation(tail);
        if (parsed) sendRaw(applyOffset(parsed, source.offsetSec));
      }
    }

    if (!aborted) send("done", {});
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send("error", { message });
    res.end();
  }
}

function tryParseAnnotation(line: string): Annotation | null {
  if (!line) return null;
  // Strip stray commas or array brackets that the model might emit despite prompt.
  const cleaned = line.replace(/^[\[,\s]+|[\],\s]+$/g, "");
  if (!cleaned.startsWith("{")) return null;
  try {
    const obj = JSON.parse(cleaned) as unknown;
    if (
      obj &&
      typeof obj === "object" &&
      typeof (obj as { t?: unknown }).t === "string" &&
      typeof (obj as { d?: unknown }).d === "string"
    ) {
      return { t: (obj as Annotation).t, d: (obj as Annotation).d };
    }
  } catch {
    // Incomplete or malformed line; drop.
  }
  return null;
}

function applyOffset(a: Annotation, offsetSec: number): Annotation {
  if (!offsetSec) return a;
  const total = parseHms(a.t) + offsetSec;
  return { t: formatHms(total), d: a.d };
}

function parseHms(s: string): number {
  const parts = s.split(":").map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function formatHms(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
