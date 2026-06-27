# Multi-Agent Customer Support Resolution Engine — Base

An **e-commerce** customer-support engine. It takes a shopper's message,
classifies intent, splits multi-issue tickets, runs specialist agents **in
parallel**, assesses severity, escalates when needed, and returns one
customer-ready resolution with reasoning + evidence — plus a full audit trail.

Five specialist domains cover the store journey: **Technical** (login,
checkout/site errors), **Billing** (charges, refunds, payments), **Policy**
(returns, cancellation, warranty), **Orders** (status, tracking, delivery,
cancel/change), and **Products** (availability, price, variants, specs).

Specialist agents are **LLM-backed** through a small shared framework: each agent
is described by **declarative JSON use cases** with a scoped knowledge base and a
tool pool, all routed through a **single LLM gateway** (Azure OpenAI by default).
Every pipeline step is a typed function you can run on its own, and the whole
thing **degrades to deterministic heuristics when no LLM key is set** — so it
runs offline too.

```
Next.js (web, dark UI)  →  Express API + SQLite  →  Agent System (LangGraph, TS)
                                                         │
                                          shared/ framework: LLM gateway · KB · tools
```

Pipeline: `guard → classify → sentiment → decompose → investigate (parallel) →
severity → escalation → respond → audit`.

---

## Prerequisites

- **Node.js 22.5+ (24.x recommended)** — uses the built-in `node:sqlite` module,
  global `fetch`, and ESM. No native build tools required.
- **npm 9+**

> Node prints a one-line `ExperimentalWarning` for `node:sqlite` — expected and harmless.

---

## Run it

```bash
cd C:\dishant\techathon
npm install
copy .env.example .env      # optional; sensible defaults are baked in
npm run dev:all             # starts agent (5000), api (4100), web (3100)
```

Open **http://localhost:3100**.

Prefer separate terminals?

```bash
npm run dev:agent   # Agent System  → http://localhost:5000
npm run dev:api     # Application API → http://localhost:4100
npm run dev:web     # Frontend       → http://localhost:3100
```

| Service        | URL                     | Command            |
|----------------|-------------------------|--------------------|
| Frontend (web) | http://localhost:3100   | `npm run dev:web`     |
| API + SQLite   | http://localhost:4100   | `npm run dev:api`     |
| Agent System   | http://localhost:5000   | `npm run dev:agent`   |

Ports avoid 3000/4000/4500. Change them in `.env` (`API_PORT`, `AGENT_PORT`),
the web port in `apps/web/package.json`, and the browser→API URL in
`apps/web/.env.local`.

---

## LLM setup (company endpoint)

The agents call an LLM through one gateway (`apps/agent/src/shared/gateway`). The
company gateway is **OpenAI-compatible** (model in the body, base URL ending at
`/v1`, bearer-token auth), so you set exactly **three** values in `.env`:

```bash
LLM_ENDPOINT=https://openaiqc.gep.com/summerintern/openai/v1  # base URL up to /v1
LLM_MODEL=gpt-5.2                                             # model sent in the body
LLM_API_KEY=your-bearer-token                                # Authorization: Bearer <token>
```

This maps 1:1 to the curl: the SDK appends `/chat/completions` to `LLM_ENDPOINT`,
puts `LLM_MODEL` in the request body, and sends `LLM_API_KEY` as a bearer header.
When `LLM_ENDPOINT` is set the engine selects this endpoint automatically (no
`LLM_PROVIDER` needed) and uses a normal chat-completions body (it accepts
`temperature` for a `gpt-5.x` model name).

**No key? It still runs.** With no provider configured, intent routing, agent
answers, and final synthesis fall back to deterministic heuristics (keyword
routing + KB/tool-grounded templates) — handy for offline demos. Standard
OpenAI/Anthropic/Groq/Gemini and native Azure are also supported (see
`.env.example`).

---

## Developing agents independently

A hard requirement of the design: **each agent and each step is an importable
unit** with typed input/output you can build and test in isolation, without
running the rest of the system. Steps (`guard`, `classify`, …) are pure
functions; each specialist agent is a self-contained framework agent (its own
use cases + KB scope) you can invoke on its own.

### Run a single agent (LLM-backed specialist)

```bash
npm --workspace apps/agent run agent -- billing "I was charged twice"
npm --workspace apps/agent run agent -- technical "Checkout keeps failing"
npm --workspace apps/agent run agent -- policy "What is your return policy?"
npm --workspace apps/agent run agent -- orders "Where is my order ORD-1001?"
npm --workspace apps/agent run agent -- products "Is the Wireless Earbuds Pro in stock?"
```

### Run a single pipeline step

```bash
npm --workspace apps/agent run step -- classify  "App crashes and I was charged twice"
npm --workspace apps/agent run step -- guard      "I want to talk to a manager"
npm --workspace apps/agent run step -- sentiment  "THIS IS THE THIRD TIME!!!"
npm --workspace apps/agent run step -- decompose  "Crash on login and double charge"
npm --workspace apps/agent run step -- investigate "Crash on login and double charge"
```

### Run the whole pipeline (no API/web)

```bash
npm --workspace apps/agent run pipeline -- "App crashes after login and I was charged twice"
```

### Import an agent as a function

Each specialist is a framework agent exposed through an adapter to the pipeline
contract:

```ts
import { getAgent } from "apps/agent/src/agents/registry";

const report = await getAgent("billing").run(
  { id: "SP-1", domain: "billing", description: "charged twice" },
  { message: "I was charged twice", history: [] }
);
```

Under the hood `apps/agent/src/agents/billing/index.ts` is just
`createAgent({ name: "billing", useCasesDir: "./usecases" })` — the shared
factory pointed at this agent's own JSON use cases.

**To add a new use case:** drop a JSON file in `apps/agent/src/agents/<domain>/
usecases/` (id, description, example utterances, prompt, allowed tools + KB
files). The classifier and execution graph pick it up automatically — no code.

**To add a new agent (domain):** copy `agents/billing/index.ts`, point it at a
new `usecases/` folder, and add one line to `apps/agent/src/agents/registry.ts`
via `adaptAgent(...)`. The orchestrator routes to it by domain.

---

## Build plan — 6 logical components

The system is split into **6 logical components**. Each is ownable by one person,
talks to the others only through the **shared pipeline-state JSON** (so nothing is
imported across boundaries except types), and is testable in isolation with the
`agent` / `step` / `pipeline` CLI. Build order is roughly top-to-bottom, but with
mock state any component can be built in parallel.

> **Golden rule:** a component only *reads* fields earlier steps added and only
> *writes* its own fields onto the same state object. Never delete another
> component's fields.

---

### 1. Intent Router

**Job:** Read the raw message and decide what it is and where it goes. Detect
intent (`technical | billing | policy | orders | products | mixed | unknown`), attach a confidence
per intent, set `is_multi_issue`, and raise `fallback: true` when confidence is
low (route to a safe path instead of guessing). Also owns the hard-signal
**guard** (explicit phrases like "talk to a manager", "chargeback" → set
`force_escalation`, but never stop the pipeline).

- **Owns:** `apps/agent/src/steps/classifier.ts`, `apps/agent/src/steps/guard.ts`
- **Reads:** `message`
- **Writes:** `classification`, `guard`
- **Run alone:** `npm --workspace apps/agent run step -- classify "…"` /
  `… run step -- guard "…"`
- **Done when:** clear single-intent → high confidence; mixed message →
  `is_multi_issue: true`; gibberish → `fallback: true`; manager/chargeback phrase
  → `guard.force_escalation: true`.

---

### 2. Parallel Decomposer

**Job:** Turn the classification into the work plan. Split a mixed ticket into
independent **sub-problems** (one domain each, `SP-1`, `SP-2`, …); for a single
issue, emit one sub-problem. This is what makes the parallel fan-out possible.

- **Owns:** `apps/agent/src/steps/decomposer.ts` (+ the fan-out half of
  `apps/agent/src/steps/orchestrator.ts`)
- **Reads:** `message`, `classification`
- **Writes:** `sub_problems[]`
- **Run alone:** `npm --workspace apps/agent run step -- decompose "…"`
- **Done when:** "crash on login and charged twice" → two sub-problems
  (technical + billing); single issue → exactly one; unknown → one safe (policy)
  sub-problem.

---

### 3. Specialized Agents

**Job:** Investigate one sub-problem in one domain and return a structured report
(`findings`, `actions`, `reasoning`, `evidence`, `status`, `confidence`). Each
agent is an **LLM-backed framework agent**: it routes the sub-ticket to one of
its **declarative JSON use cases**, gathers grounding from its scoped **tools**
and **knowledge base**, then asks the LLM (via the shared gateway) for a
structured answer. Follow-up history and the specific sub-problem are passed in
as focus. With no LLM key it falls back to keyword routing + KB/tool-grounded
templates, so the signature and contract never change.

- **Owns:** `apps/agent/src/agents/<domain>/{index.ts,usecases/*.json}`,
  `agents/{adapter,registry,base}.ts`, and the `apps/agent/src/shared/` framework
  (gateway, core, handlers, tools, kb)
- **Reads:** a `SubProblem` + `{ message, history }`
- **Writes:** one `AgentReport` (collected into `agent_reports[]`)
- **Run alone:** `npm --workspace apps/agent run agent -- billing "…"`
- **Add a use case:** a JSON file in the agent's `usecases/`. **Add an agent:**
  one `createAgent` + a `usecases/` folder + a line in `registry.ts`.
- **Done when:** each domain returns relevant findings + evidence refs (tool/KB
  sources) and sets an honest `status`.

---

### 4. Output Combiner

**Job:** Take all the agent reports and produce the final answer. Merge findings,
detect conflicts, compute an `overall_status`, and synthesize **one**
customer-ready `resolution` that always includes reasoning + evidence (and the
escalation note when present). Synthesis is **LLM-backed** (the gateway merges
overlapping points into one coherent, empathetic reply) with a deterministic
template merge as fallback; reasoning + evidence always come from the agents,
never invented by the model.

- **Owns:** the merge half of `apps/agent/src/steps/orchestrator.ts` +
  `apps/agent/src/steps/synthesizer.ts`
- **Reads:** `agent_reports[]`, `escalation`
- **Writes:** `investigation`, `resolution`
- **Run alone:** `npm --workspace apps/agent run step -- investigate "…"` (merge),
  full `pipeline` for the synthesized resolution
- **Done when:** a mixed ticket yields one coherent answer covering both issues
  with combined evidence; conflicting agent outcomes surface in
  `investigation.conflicts`.

---

### 5. Severity & Escalation Engine

**Job:** Decide how urgent this is and whether a human is needed. Detect
**sentiment** (tone only), score **severity** from the agent *findings* (impact —
not customer wording) and **priority** (severity + a capped sentiment nudge), then
run the **escalation gate** (force-signal, high impact, unresolved, conflict, or
frustration-with-repeat-contact) and build the handoff plan.

- **Owns:** `apps/agent/src/steps/sentiment.ts`, `severity.ts`, `escalation.ts`
- **Reads:** `message`, `agent_reports[]`, `investigation`, `guard`,
  `message_count`
- **Writes:** `sentiment`, `severity`, `escalation`
- **Run alone:** `npm --workspace apps/agent run step -- sentiment "…"`
- **Done when:** duplicate-charge → medium/P2; "locked out / all users" → high/P1;
  manager/chargeback or unresolved+repeat → `escalation.escalate: true` with a
  team + urgency; frustration alone on a solved issue does **not** escalate.

---

### 6. Orchestration & Audit Backbone

**Job:** Wire everything together and make it traceable. Owns the LangGraph graph,
the shared state object, the order of steps, the per-step **audit trail**, and the
API-side persistence/context that lets follow-ups reuse a ticket's history.

- **Owns:** `apps/agent/src/{nodes,graph,pipeline,run,server}.ts` +
  `apps/api/src/{server,db,agentClient}.ts`
- **Reads/Writes:** assembles the whole `PipelineState`; appends to
  `audit_trail[]` on every step; persists runs + messages
- **Run alone:** `npm run dev:agent` then `POST /run`, or
  `npm --workspace apps/agent run pipeline -- "…"`
- **Done when:** every step emits an audit event you can trace the final answer
  back to; follow-ups on the same `ticket_id` carry prior history; a node error
  falls back to the linear runner instead of crashing.

---

### Who reads / writes what (shared state)

| Field added | Component |
|-------------|-----------|
| `guard`, `classification` | 1 · Intent Router |
| `sub_problems` | 2 · Parallel Decomposer |
| `agent_reports[]` | 3 · Specialized Agents |
| `investigation`, `resolution` | 4 · Output Combiner |
| `sentiment`, `severity`, `escalation` | 5 · Severity & Escalation Engine |
| `audit_trail`, persistence, run order | 6 · Orchestration & Audit Backbone |

---

## Project structure

```text
techathon/
├── apps/
│   ├── web/                  # Next.js + shadcn/ui (dark-only)
│   │   ├── app/              # layout, page, globals.css
│   │   ├── components/ui/    # shadcn primitives (button, card, badge, tabs, …)
│   │   └── components/views.tsx
│   ├── api/                  # Express API + node:sqlite (tickets, runs, audit)
│   │   └── src/{server,db,agentClient,env}.ts
│   └── agent/                # LangGraph (TS) agent pipeline
│       └── src/
│           ├── steps/        # guard, classifier, sentiment, decomposer,
│           │                 #   orchestrator, severity, escalation, synthesizer
│           ├── agents/       # technical/ billing/ policy/ orders/ products/
│           │                 #   (index + usecases/*.json) + adapter, registry, base
│           ├── shared/       # the LLM agent framework:
│           │   ├── gateway/  #   single LLM door (azure/openai/… adapters)
│           │   ├── core/     #   per-agent classify → graph → report
│           │   ├── handlers/ #   one declarative handler runs any JSON use case
│           │   ├── tools/    #   shared tool pool (mocked data sources)
│           │   ├── kb/       #   central knowledge base + retriever
│           │   └── config/   #   single env reader
│           ├── nodes.ts      # pipeline nodes (shared)
│           ├── graph.ts      # LangGraph StateGraph wiring
│           ├── pipeline.ts   # linear fallback runner
│           ├── run.ts        # entry (graph → linear fallback)
│           ├── server.ts     # POST /run
│           └── cli.ts        # pipeline | step | agent
└── .env.example
```

---

## How the backend handles the agent

`POST /api/tickets` (Express) validates input, creates/loads the ticket in
SQLite, builds the pipeline-entry JSON (with prior history + message count for
follow-ups), calls the Agent System over HTTP (`POST /run`), saves the full
pipeline result + audit, and returns it to the frontend. `GET /api/tickets/:id`
returns the latest saved run.

The Agent System runs the LangGraph `StateGraph`; if the graph executor ever
fails to load it transparently falls back to an identical linear runner, so a
run never hard-fails.

---

## Demo scenarios

| Message | What you see |
|---------|--------------|
| `I was charged twice this month.` | Billing-only → one agent → refund + invoice evidence |
| `Checkout keeps failing and I was charged twice.` | **Mixed** → split → Technical + Billing **in parallel** → merged |
| `Where is my order and is the keyboard back in stock?` | **Mixed** → split → Orders + Products **in parallel** → merged |
| `Something feels wrong with my account.` | Low confidence → **fallback** (policy review) |
| `THIS IS THE THIRD TIME!!! … talk to a manager!` | Sentiment + hard-signal guard → **escalation** |
| Submit again with same ticket id | **Follow-up** keeps context (message count rises) |
| Empty message | Graceful error, no crash |

---

## Notes / limitations

- Agents are **LLM-backed** through the shared gateway (Azure OpenAI by default).
  With no key configured the system falls back to deterministic heuristics, so it
  always runs.
- **Tools are mocked.** The shared tool pool (`shared/tools`) returns realistic
  in-memory data rather than calling live external services — there are no
  outbound network APIs to stand up. Swap a tool's `run()` for a real call later;
  the use cases and pipeline don't change.
- The **knowledge base** ships markdown policies under `shared/kb/library` with
  tiered (keyword/TF-IDF) retrieval; embeddings can slot in behind the same
  interface.
- SQLite is Node's built-in `node:sqlite` (no `better-sqlite3`, no compiler).
- Every agent interaction is logged to a durable JSONL **audit trail**
  (`logs/audit.jsonl`; set `AUDIT_LOG=off` to disable the file).
- Dark mode only by design.
