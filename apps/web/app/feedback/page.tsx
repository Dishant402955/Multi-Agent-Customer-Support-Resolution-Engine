"use client";
// Feedback dashboard — every thumbs up/down a customer left on an AI reply.
// Read-only review surface: KPIs, search, rating filter, and a detail table.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminHeader } from "@/components/admin-nav";
import { listFeedback } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import type { FeedbackRow } from "@/lib/types";

type RatingFilter = "all" | "up" | "down";

export default function FeedbackPage() {
  const account = useRequireRole("admin");
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RatingFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listFeedback());
    setLoading(false);
  }, []);
  useEffect(() => {
    if (account) void load();
  }, [account, load]);

  const stats = useMemo(() => {
    const up = rows.filter((r) => r.rating === "up").length;
    const down = rows.length - up;
    const pct = rows.length ? Math.round((up / rows.length) * 100) : 0;
    return { total: rows.length, up, down, pct };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.rating !== filter) return false;
      if (!q) return true;
      return (
        r.customer_name?.toLowerCase().includes(q) ||
        r.display_id?.toLowerCase().includes(q) ||
        r.question?.toLowerCase().includes(q) ||
        r.answer?.toLowerCase().includes(q) ||
        r.comment?.toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminHeader
        title="Feedback"
        subtitle="Thumbs up/down customers left on AI replies"
        role="admin"
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="mx-auto max-w-6xl px-6 py-6">
        {/* KPIs */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatPill label="Total ratings" value={stats.total} />
          <StatPill label="Helpful" value={stats.up} tone="up" />
          <StatPill label="Not helpful" value={stats.down} tone="down" />
          <StatPill label="Satisfaction" value={`${stats.pct}%`} />
        </div>

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by customer, ticket, question, answer…"
            className="input max-w-sm flex-1"
          />
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {(["all", "up", "down"] as RatingFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                  (filter === f
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {f === "all" ? "All" : f === "up" ? "Helpful" : "Not helpful"}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Rating</th>
                <th className="px-3 py-2 font-medium">Ticket</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Question</th>
                <th className="px-3 py-2 font-medium">AI answer</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/60 align-top last:border-0 hover:bg-secondary/20">
                  <td className="px-3 py-3">
                    {r.rating === "up" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-500">
                        <ThumbsUp className="size-3.5" /> Helpful
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <ThumbsDown className="size-3.5" /> Not helpful
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="outline">{r.display_id || "—"}</Badge>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.customer_name}</td>
                  <td className="max-w-[260px] px-3 py-3 text-muted-foreground">
                    <p className="line-clamp-3">{r.question || "—"}</p>
                  </td>
                  <td className="max-w-[320px] px-3 py-3 text-muted-foreground">
                    <p className="line-clamp-3">{r.answer || "—"}</p>
                    {r.comment && (
                      <p className="mt-1 line-clamp-2 text-xs italic text-foreground/70">“{r.comment}”</p>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-sm text-muted-foreground">
                    No feedback yet. Ratings appear here as customers thumb replies up or down.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "up" | "down";
}) {
  const color =
    tone === "up" ? "text-emerald-500" : tone === "down" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={"mt-1 text-2xl font-semibold tabular-nums " + color}>{value}</p>
    </div>
  );
}
