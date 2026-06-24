"use client";
import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { submitTicket } from "@/lib/api";
import type { PipelineState } from "@/lib/types";
import {
  AuditCard,
  ClassificationCard,
  InvestigationCard,
  ResolutionCard,
  UrgencyCard,
} from "@/components/views";

const SAMPLES = [
  "I was charged twice this month.",
  "App crashes after login and I was charged twice.",
  "Something feels wrong with my account.",
  "THIS IS THE THIRD TIME!!! Still charged twice and I want to talk to a manager!",
];

export default function Home() {
  const [message, setMessage] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [result, setResult] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!message.trim()) {
      setError("Please enter a message");
      return;
    }
    setLoading(true);
    try {
      const data = await submitTicket(message, ticketId);
      setResult(data);
      setTicketId(data.ticket_id);
      setMessage("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container max-w-3xl py-10">
      <header className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Multi-Agent Support Resolution Engine</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Classify → decompose → investigate in parallel → severity → escalate → resolve, with a full
          audit trail.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Submit a ticket</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Paste a customer message…"
              rows={3}
            />
            <div className="flex gap-2">
              <Input
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                placeholder="ticket_id (optional — set automatically for follow-ups)"
              />
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <Send />}
                {loading ? "Resolving…" : "Resolve"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((sample) => (
                <Button
                  key={sample}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMessage(sample)}
                >
                  {sample.length > 40 ? sample.slice(0, 40) + "…" : sample}
                </Button>
              ))}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {ticketId && result && (
              <p className="text-sm text-muted-foreground">
                Active ticket{" "}
                <Badge variant="secondary" className="font-mono">
                  {ticketId}
                </Badge>{" "}
                · message #{result.message_count} — next submit is a follow-up.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {result && (
        <Tabs defaultValue="resolution" className="mt-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="resolution">Resolution</TabsTrigger>
            <TabsTrigger value="investigation">Investigation</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="resolution" className="space-y-4">
            <ResolutionCard s={result} />
            <UrgencyCard s={result} />
          </TabsContent>

          <TabsContent value="investigation" className="space-y-4">
            <ClassificationCard s={result} />
            <InvestigationCard s={result} />
          </TabsContent>

          <TabsContent value="audit" className="space-y-4">
            <AuditCard s={result} />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}
