import type { VercelRequest, VercelResponse } from "@vercel/node";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readdir, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 60,
  api: { bodyParser: false },
};

const FRAME_INTERVAL_SEC = 10;
const MODEL = "gemini-2.5-flash";

type Moment = { timestamp: string; summary: string };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    return;
  }

  const jobId = randomUUID();
  const workDir = path.join(tmpdir(), `cutsense-${jobId}`);
  const videoPath = path.join(workDir, "input.mp4");
  const framesDir = path.join(workDir, "frames");

  try {
    await mkdir(framesDir, { recursive: true });

    // 1. Stream uploaded body to disk.
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(videoPath);
      req.pipe(ws);
      ws.on("finish", () => resolve());
      ws.on("error", reject);
      req.on("error", reject);
    });

    // 2. Extract one frame every FRAME_INTERVAL_SEC seconds at 512px wide.
    await runFfmpeg([
      "-i",
      videoPath,
      "-vf",
      `fps=1/${FRAME_INTERVAL_SEC},scale=512:-2`,
      "-q:v",
      "5",
      path.join(framesDir, "frame-%05d.jpg"),
    ]);

    const frameFiles = (await readdir(framesDir))
      .filter((f) => f.endsWith(".jpg"))
      .sort();

    if (frameFiles.length === 0) {
      res.status(400).json({ error: "No frames extracted (video too short?)" });
      return;
    }

    // 3. Build one multimodal prompt with every frame labeled by timestamp.
    const ai = new GoogleGenAI({ apiKey });
    const parts: Array<
      { inlineData: { mimeType: string; data: string } } | { text: string }
    > = [];

    const timestamps: string[] = [];
    for (let i = 0; i < frameFiles.length; i++) {
      const sec = (i + 1) * FRAME_INTERVAL_SEC;
      const ts = toHms(sec);
      timestamps.push(ts);
      const data = await readFile(path.join(framesDir, frameFiles[i]));
      parts.push({ text: `Frame at ${ts}:` });
      parts.push({
        inlineData: { mimeType: "image/jpeg", data: data.toString("base64") },
      });
    }

    parts.push({
      text:
        "For each frame above, write a short one-sentence summary of what is visible. " +
        "Return ONLY a JSON array with this exact shape, no prose, no markdown fences:\n" +
        `[${timestamps
          .map((t) => `{"timestamp":"${t}","summary":"..."}`)
          .join(",")}]`,
    });

    const result = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: { temperature: 0.3 },
    });

    const moments = parseMoments(result.text ?? "");
    res.status(200).json(moments);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function parseMoments(text: string): Moment[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((m) => {
      if (
        m &&
        typeof m === "object" &&
        typeof (m as Moment).timestamp === "string" &&
        typeof (m as Moment).summary === "string"
      ) {
        return [
          {
            timestamp: (m as Moment).timestamp,
            summary: (m as Moment).summary,
          },
        ];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as unknown as string) ?? "ffmpeg";
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function toHms(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
