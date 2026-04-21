/**
 * VideoSource abstraction.
 *
 * For MVP this yields a single source representing the entire uploaded file.
 * When chunking is added later (FFmpeg, Cloud Run worker, etc.), replace the
 * iterator with one that yields multiple sources with offsetSec populated.
 * The annotation endpoint then loops over sources, adding offsetSec to each
 * streamed timestamp.
 */

export type VideoSource = {
  kind: "gemini-file";
  fileName: string;
  /** Seconds to add to any timestamp produced by the model for this source. */
  offsetSec: number;
};

export async function* iterateSources(
  fileName: string
): AsyncIterable<VideoSource> {
  yield { kind: "gemini-file", fileName, offsetSec: 0 };
}
