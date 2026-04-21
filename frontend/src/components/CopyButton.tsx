import { useState } from "react";
import { toMarkdown } from "../lib/markdown";
import type { Annotation } from "../lib/api";

type Props = { rows: Annotation[]; disabled?: boolean };

export function CopyButton({ rows, disabled }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-btn"
      disabled={disabled || rows.length === 0}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(toMarkdown(rows));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
    >
      {copied ? "Copied!" : "Copy as Markdown"}
    </button>
  );
}
