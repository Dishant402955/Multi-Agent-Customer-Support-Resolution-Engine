# Technical Specification

Multi-Agent Customer Support Resolution Engine — e-commerce domain

---

## 1. Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | Next.js 15 · shadcn/ui · Tailwind CSS | Dark theme only; RSC + client islands |
| **API** | Express 4 · TypeScript | REST + SSE; `node:sqlite` (no native build) |
| **Agent pipeline** | LangGraph (`@langchain/langgraph`) · TypeScript | StateGraph + identical linear fallback |
| **LLM gateway** | Single `callLLM()` abstraction | OpenAI-compat / Azure / Groq / Gemini adapters |
| **Database** | `node:sqlite` (Node 22 built-in) | 12+ tables; no ORM |
| **Real-time** | Server-Sent Events (SSE) | Pipeline streaming + collab feed; no WebSocket |
| **Auth** | Bearer token sessions (SQLite) | Roles: `user` · `agent` · `admin` |
| **Email** | Resend (optional, best-effort) | Customer notifications only |

---

## 2. Service ports

| Service | Default port | Env var |
|---------|-------------|---------|
| Frontend (web) | 3100 | `PORT` in `apps/web/package.json` |
| API | 4100 | `API_PORT` |
| Agent | 5000 | `AGENT_PORT` |

---

## 3. Agent pipeline components

### 3.1 Hard-signal guard

- **File:** `apps/agent/src/steps/guard.ts`
- **Kind:** rule (regex, no LLM)
- **Config:** `runtime-config/policies.json → guard.signals[]`
- **Output:** `Guard { force_escalation, matched_phrase?, reason }`
- Phrases: `"talk to a manager"`, `"chargeback"`, `"legal"`, `"lawsuit"`, `"data breach"` (admin-editable)

### 3.2 Intent classifier

- **File:** `apps/agent/src/steps/classifier.ts`
- **Kind:** LLM → TF-IDF keyword fallback
- **Output:** `Classification { primary_intent, intents[], is_multi_issue, fallback, category, faq_answer? }`
- FAQ short-circuit: `matchFaq(message)` runs first; if matched, skips LLM entirely
- Dynamic prompt built from `listAgentRecords()` — adding a domain auto-updates the prompt
- Confidence thresholds from `runtime-config/policies.json → intents.*`

### 3.3 Sentiment detector

- **File:** `apps/agent/src/steps/sentiment.ts`
- **Kind:** LLM (conversation-aware) → heuristic fallback
- **Output:** `Sentiment { label, score, frustration, drivers[], trend }`
- Considers full conversation history (last 8 turns)
- Detects `frustrated` from repeated messages even when latest turn is polite

### 3.4 Decomposer

- **File:** `apps/agent/src/steps/decomposer.ts`
- **Kind:** LLM → clause-scoring heuristic fallback
- **Output:** `SubProblem[] { id, domain, description }`
- Dynamic prompt from `listAgentRecords()`

### 3.5 Orchestrator (fan-out + merge)

- **File:** `apps/agent/src/steps/orchestrator.ts`
- **Kind:** `Promise.all` fan-out; deterministic merge
- **Output:** `AgentReport[]`, `Investigation { overall_status, conflicts[] }`
- Wall-clock vs agent-sum timing logged in audit trail
- Conflict detection: checks for contradictions across report fields

### 3.6 Specialist agents (5 built-in + runtime-addable)

| Agent | Path | Tools | KB scope |
|-------|------|-------|----------|
| Technical | `agents/technical/` | lookupErrorCode | troubleshooting.md |
| Billing | `agents/billing/` | subscriptionLookup, dbQuery | billing_policy.md, refund_policy.md |
| Policy | `agents/policy/` | dbQuery | refund_policy.md, cancellation_policy.md, amendment_policy.md |
| Orders | `agents/orders/` | orderLookup | shipping_delivery.md |
| Products | `agents/products/` | productLookup | product_catalog.md |

**Use case format** (`usecases/*.json`):
```json
{
  "id": string,
  "description": string,
  "example_utterances": string[],
  "prompt": string,
  "tools": [{ "name": string }],
  "knowledge_base": [{ "knowledge_file": string }]
}
```

**Agent factory:** `createAgent({ name, useCasesDir })` — routes sub-problem to best use case, retrieves KB, runs tools, calls LLM, returns `AgentReport`.

### 3.7 Severity assessor

- **File:** `apps/agent/src/steps/severity.ts`
- **Kind:** rule (keyword match on agent findings, not customer wording)
- **Output:** `Severity { level, priority, reasoning }`
- Priority modifiers: +1 angry, +1 repeat contact, +1 conflict (capped at P1)

### 3.8 Escalation engine

- **File:** `apps/agent/src/steps/escalation.ts`
- **Kind:** rule gate → LLM handoff plan → deterministic fallback
- **Output:** `Escalation { escalate, reasons[], recommended_team, urgency, assigned_agent, internal_actions, reason }`
- 5 individually-toggled rules in `policies.json`
- Handoff plan uses KB `escalation_matrix.md` for team routing context

### 3.9 Response synthesizer

- **File:** `apps/agent/src/steps/synthesizer.ts`
- **Kind:** template merge → LLM (temperature 0.3) → template fallback
- **Output:** `Resolution { summary, findings[], actions[], reasoning, evidence[] }`
- Evidence and reasoning always come from agent reports — never invented by the model

### 3.10 Sentiment analysis (extended)

- **File:** `apps/agent/src/steps/sentiment.ts`
- LLM-first with full conversation context; heuristic always runs as safety net
- Result surfaces in `Sentiment { label, score, frustration, drivers[], trend }`
- Drivers (e.g. "repeat contact", "ALL-CAPS words") shown in UI

### 3.11 KB article generator

- **File:** `apps/agent/src/shared/kb/generate.ts`
- LLM-generates a clean GitHub-flavored Markdown article from resolved ticket data
- `templateDraft()` produces a structured fallback with no LLM dependency
- Never auto-saves — admin reviews and saves via `PUT /admin/kb/:file`

---

## 4. Shared framework (`apps/agent/src/shared/`)

### 4.1 LLM gateway

- **File:** `shared/gateway/index.ts`
- Single function: `callLLM<T>(req: LLMRequest): Promise<T>`
- Provider adapters: OpenAI-compat (custom endpoint), Azure OpenAI, standard OpenAI, Anthropic, Groq, Gemini
- Retry logic: 2 retries with 300ms × attempt backoff
- JSON mode: strips code fences, `JSON.parse`; throws → caller falls back to heuristic

### 4.2 KB subsystem

| File | Responsibility |
|------|---------------|
| `kb/store.ts` | CRUD over `library/*.md` (safe filename validation) |
| `kb/retriever.ts` | TF-IDF section scorer; returns `RetrievalResult[]` ranked by query relevance |
| `kb/generate.ts` | LLM article draft from `KbSource`; template fallback |

**Library files:** `troubleshooting.md`, `billing_policy.md`, `refund_policy.md`, `cancellation_policy.md`, `shipping_delivery.md`, `product_catalog.md`, `escalation_matrix.md`, `amendment_policy.md`, `account_help.md`, `demo_policy.md`

### 4.3 Tool registry

All tools implement `{ name: string; run(args): Promise<unknown> }`.

| Tool | Mock data models |
|------|-----------------|
| `orderLookup` | Order status, carrier, ETA, tracking link |
| `productLookup` | SKU, availability, price, variants, specs |
| `lookupErrorCode` | Error code → cause, fix, severity |
| `subscriptionLookup` | Billing plan, charge history, refund eligibility |
| `dbQuery` | Account status, policy flags |
| `accountStatus` | Account health, flags |

### 4.4 Guardrails

- **File:** `shared/core/guardrails.ts`
- `GUARDRAILS_BLOCK` prepended to every LLM system prompt across all steps
- Rules: anti-injection, domain-scope, no-fabrication, no-secrets, strict-JSON output

### 4.5 Live config stores

| Store | File | Config file |
|-------|------|------------|
| Policies | `shared/policies/store.ts` | `runtime-config/policies.json` |
| Agents | `shared/policies/agents.ts` | `runtime-config/agents.json` |
| FAQ | `shared/policies/faq.ts` | `runtime-config/faq.json` |

Pattern: Zod-validated schema, in-memory cache with explicit `reload()`, `invalidateCache()`.

---

## 5. API layer (`apps/api/src/`)

### Key modules

| File | Responsibility |
|------|---------------|
| `server.ts` | All REST + SSE routes (~1100 lines) |
| `db.ts` | Schema DDL + all read/write functions |
| `collab.ts` | In-memory SSE pub/sub broker (no Redis) |
| `agentAdmin.ts` | HTTP proxy to agent admin routes |
| `humans.ts` | Human agent roster, department routing, load balancing |
| `notify.ts` | In-app + Resend email notifications |
| `auth.ts` | Session tokens, `requireRole` middleware |
| `agentClient.ts` | HTTP client to agent `/run` and `/run/stream` |

### Ticket lifecycle

```
POST /api/tickets
  → validate (empty check, length)
  → getOrCreateTicket()
  → addMessage(customer)
  → countCustomerMessages() → message_count
  → getLatestRunContext() → prior_context (for follow-ups)
  → runAgentPipeline(state) [or stream variant]
  → saveRun(runId, ticketId, state)
  → if state.escalation.escalate:
      createEscalation() OR reuse open escalation
      pickAssignee(dept, countOpenByAssignee())
      recordTeamActivity()
      emitCollab()
  → return { run, state }
```

---

## 6. Frontend (`apps/web/`)

### Pages

| Route | Component | Key features |
|-------|-----------|-------------|
| `/` | `page.tsx` | Customer chat, SSE streaming, thoughts, feedback bar |
| `/tickets` | `tickets/page.tsx` | Dashboard with mood column, lifecycle stepper, side sheet |
| `/escalations` | `escalations/page.tsx` | Case management, reply, handoff, team notes, heartbeat |
| `/collaboration` | `collaboration/page.tsx` | SSE feed, roster, presence, activity, notes |
| `/observability` | `observability/page.tsx` | Run browser, pipeline flow in sheet, sentiment |
| `/trace/[ticketId]` | `trace/page.tsx` | 3-tab flow viewer: Pipeline Flow · Agents · Audit |
| `/feedback` | `feedback/page.tsx` | Thumbs ratings table, KPIs |
| `/platform` | `platform/page.tsx` | Policies · Specialists · FAQ · KB · Agents · Audit |

### Key shared components

| Component | Purpose |
|-----------|---------|
| `flow.tsx → PipelineFlow` | Animated step graph (guard → synthesize) driven by SSE progress |
| `views.tsx → RunTraceCard` | Collapsible run card with agent reports + audit trail |
| `views.tsx → AgentReportDetails` | Per-agent findings/actions/evidence/reasoning card |
| `views.tsx → ChatActivity` | Collapsible in-chat "what agents did" collapse |
| `views.tsx → LifecycleStepper` | 5-stage ticket lifecycle visual |
| `sentiment-badge.tsx` | Mood pill (label + score + trend icon) |
| `admin-nav.tsx` | Sticky header + nav tabs + notification bell |

---

## 7. Type contracts

### `PipelineState` (agent-side, `contracts/types.ts`)

Core fields: `run_id`, `message`, `ticket_id`, `customer_id`, `message_count`, `history[]`, `prior_context?`, `guard?`, `classification?`, `sentiment?`, `sub_problems[]`, `agent_reports[]`, `investigation?`, `severity?`, `escalation?`, `resolution?`, `audit_trail[]`.

### Frontend types (`apps/web/lib/types.ts`)

Key interfaces: `TicketDashboardRow` (+ `sentiment`, `frustration`), `RunSessionRow` (+ `sentiment_score`, `frustration`, `sentiment_trend`), `CollabOverview`, `CollabAgent`, `TeamActivity`, `CaseNote`, `FeedbackRow`, `KbDraft`, `FaqEntry`, `PolicyConfig`, `SpecialistAgentRecord`.

---

## 8. Observability and tracing

| Surface | What it shows |
|---------|--------------|
| **Chat thoughts** | Live SSE step progress + collapsible audit trail per reply |
| **Trace page → Pipeline Flow tab** | Animated step graph for the selected run |
| **Trace page → Agents tab** | Fan-out diagram + per-agent report cards + merge result |
| **Trace page → Audit tab** | Full typed audit trail + step timings + raw state JSON |
| **Observability page** | All runs table (sentiment, intent, severity, stats); pipeline flow in run sheet |
| **Tickets page** | Sentiment badge + lifecycle stepper in side sheet |
| **Escalations page** | Customer mood card with drivers |
| **JSONL audit log** | `logs/audit.jsonl` — every step, every run, machine-readable |
