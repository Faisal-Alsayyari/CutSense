type Props = {
  fraction: number;
  label?: string;
};

export function ProgressBar({ fraction, label }: Props) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="progress">
      {label && <div className="progress-label">{label} · {pct}%</div>}
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
