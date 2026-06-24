// Step 3 — Sentiment detector.
// Pure function. Tone only — used later as a capped nudge to priority.
import type { Sentiment } from "../contracts/types";

export function runSentiment(message: string): Sentiment {
  const text = message.toLowerCase();
  const exclaim = (message.match(/!/g) || []).length;
  const capsWords = (message.match(/\b[A-Z]{3,}\b/g) || []).length;
  const angryWords = ["furious", "ridiculous", "unacceptable", "worst", "terrible", "angry", "scam", "useless"];
  const frustratedWords = ["again", "still", "third time", "twice now", "frustrated", "annoyed", "waiting", "no response"];

  let score = 0;
  if (angryWords.some((w) => text.includes(w))) score += 0.6;
  if (frustratedWords.some((w) => text.includes(w))) score += 0.4;
  score += Math.min(exclaim * 0.1, 0.3);
  score += Math.min(capsWords * 0.1, 0.3);
  score = Math.min(score, 1);

  let label: Sentiment["label"] = "neutral";
  if (score >= 0.7) label = "angry";
  else if (score >= 0.35) label = "frustrated";
  return { label, score: Number(score.toFixed(2)) };
}
