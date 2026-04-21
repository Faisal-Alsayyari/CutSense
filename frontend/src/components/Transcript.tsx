import type { Annotation } from "../lib/api";

type Props = {
  rows: Annotation[];
};

export function Transcript({ rows }: Props) {
  if (rows.length === 0) {
    return <div className="transcript empty">No annotations yet.</div>;
  }
  return (
    <ol className="transcript">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="ts">{r.t}</span>
          <span className="desc">{r.d}</span>
        </li>
      ))}
    </ol>
  );
}
