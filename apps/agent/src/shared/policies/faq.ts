/**
 * policies/faq.ts — the live, admin-editable FAQ / canned-response store.
 *
 * Some inbound messages don't need the specialist pipeline at all: greetings
 * have a single fixed reply, and so do common questions ("what are your hours?",
 * "where are you located?"). Admins define FAQ entries here — a set of trigger
 * phrases + one canned answer — and the pipeline checks them FIRST (like the
 * greeting short-circuit). A match returns the answer and skips all specialists.
 *
 * Persisted to runtime-config/faq.json. Empty by default, so nothing changes
 * until an admin adds an entry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { log } from "../core/logger.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(HERE, "../../../runtime-config");
const FAQ_FILE = join(CONFIG_DIR, "faq.json");

/** How an entry's triggers are matched against the customer message. */
export const faqMatchModes = ["contains", "exact", "regex"] as const;
export type FaqMatchMode = (typeof faqMatchModes)[number];

export const faqEntrySchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1, "label is required"),
  enabled: z.boolean().default(true),
  match: z.enum(faqMatchModes).default("contains"),
  triggers: z.array(z.string().min(1)).min(1, "add at least one trigger phrase"),
  answer: z.string().min(1, "an answer is required"),
});
export type FaqEntryInput = z.infer<typeof faqEntrySchema>;
export interface FaqEntry extends FaqEntryInput {
  id: string;
  enabled: boolean;
  match: FaqMatchMode;
}

let cache: FaqEntry[] | null = null;

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

function readAll(): FaqEntry[] {
  if (cache) return cache;
  if (!existsSync(FAQ_FILE)) {
    cache = [];
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(FAQ_FILE, "utf8"));
    const arr = Array.isArray(raw) ? raw : [];
    const out: FaqEntry[] = [];
    for (const item of arr) {
      const parsed = faqEntrySchema.safeParse(item);
      if (parsed.success) {
        out.push({
          ...parsed.data,
          id: parsed.data.id || randomUUID(),
          enabled: parsed.data.enabled ?? true,
          match: parsed.data.match ?? "contains",
        });
      }
    }
    cache = out;
  } catch {
    cache = [];
  }
  return cache;
}

function save(entries: FaqEntry[]): void {
  ensureDir();
  writeFileSync(FAQ_FILE, JSON.stringify(entries, null, 2), "utf8");
  cache = entries;
}

/** Every FAQ entry (enabled and disabled), for the admin editor. */
export function listFaqs(): FaqEntry[] {
  return [...readAll()];
}

export function invalidateFaqCache(): void {
  cache = null;
}

/** Validate + persist one FAQ entry (create when id is absent). */
export function upsertFaq(input: unknown): FaqEntry {
  const parsed = faqEntrySchema.parse(input);
  const id = parsed.id || randomUUID();
  const entry: FaqEntry = { ...parsed, id, enabled: parsed.enabled, match: parsed.match };
  const next = readAll().filter((e) => e.id !== id);
  next.push(entry);
  save(next);
  log("config", "faq-store", "faq upserted", { id, label: entry.label });
  return entry;
}

export function deleteFaq(id: string): void {
  save(readAll().filter((e) => e.id !== id));
  log("config", "faq-store", "faq deleted", { id });
}

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Does one trigger match the message under the entry's match mode? */
function triggerHits(message: string, trigger: string, mode: FaqMatchMode): boolean {
  const m = norm(message);
  const t = norm(trigger);
  if (!t) return false;
  if (mode === "exact") return m === t;
  if (mode === "regex") {
    try {
      return new RegExp(trigger, "i").test(message);
    } catch {
      return false; // an invalid pattern simply never matches
    }
  }
  // "contains": whole-word-ish substring match on the normalized text.
  return m.includes(t);
}

export interface FaqMatch {
  id: string;
  label: string;
  answer: string;
}

/**
 * First enabled FAQ entry whose triggers match the message, or null. Checked at
 * the very start of classification so a canned answer skips the pipeline.
 */
export function matchFaq(message: string): FaqMatch | null {
  if (!message || !message.trim()) return null;
  for (const entry of readAll()) {
    if (entry.enabled === false) continue;
    if (entry.triggers.some((t) => triggerHits(message, t, entry.match))) {
      return { id: entry.id, label: entry.label, answer: entry.answer };
    }
  }
  return null;
}
