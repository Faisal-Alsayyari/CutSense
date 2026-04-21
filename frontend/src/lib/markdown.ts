import type { Annotation } from "./api";

export function toMarkdown(rows: Annotation[]): string {
  return rows.map((r) => `- **${r.t}** — ${r.d}`).join("\n");
}
