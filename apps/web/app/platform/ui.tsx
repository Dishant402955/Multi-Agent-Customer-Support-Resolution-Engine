"use client";

export function ErrorNote({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {msg}
    </p>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-secondary/30">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
          (checked ? "bg-primary" : "bg-secondary")
        }
      >
        <span
          className={
            "inline-block size-4 transform rounded-full bg-background shadow transition-transform " +
            (checked ? "translate-x-4" : "translate-x-0.5")
          }
        />
      </button>
    </label>
  );
}

export function ThresholdField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className="font-mono text-sm tabular-nums text-primary">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-primary"
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
