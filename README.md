# Multi-Agent Customer Support Resolution Engine — Base

Takes a customer message, classifies intent, splits multi-issue tickets, runs
specialist agents **in parallel**, assesses severity, escalates when needed, and
returns one customer-ready resolution with reasoning + evidence — plus a full
audit trail.

This is the **base**: agents return **hard-coded** answers (no LLM, no external
APIs). Every agent and step is a **pure function** you can run on its own.

```
Next.js (web, dark UI)  →  Express API + SQLite  →  Agent System (LangGraph, TS)
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

## Developing agents independently

This is a hard requirement of the design: **each agent and each step is a pure,
importable function** with typed input/output — no DB, no HTTP, no LLM. You can
build/test one in isolation without running the rest of the system.

### Run a single agent (hard-coded specialist)

```bash
npm --workspace apps/agent run agent -- billing "I was charged twice"
npm --workspace apps/agent run agent -- technical "App crashes after login"
npm --workspace apps/agent run agent -- policy "Refund after 45 days?"
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

Each specialist is exported as a plain function:

```ts
import { investigateBilling } from "apps/agent/src/agents/billing";

const report = investigateBilling(
  { id: "SP-1", domain: "billing", description: "charged twice" },
  { message: "I was charged twice", history: [] }
);
```

**To add a new agent:** create `apps/agent/src/agents/<name>.ts` implementing the
`SpecialistAgent` interface, then add one line to
`apps/agent/src/agents/registry.ts`. The orchestrator picks it up by domain.

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
│           ├── agents/       # technical, billing, policy + registry (pure fns)
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
| `App crashes after login and I was charged twice.` | **Mixed** → split → Technical + Billing **in parallel** → merged |
| `Something feels wrong with my account.` | Low confidence → **fallback** (policy review) |
| `THIS IS THE THIRD TIME!!! … talk to a manager!` | Sentiment + hard-signal guard → **escalation** |
| Submit again with same ticket id | **Follow-up** keeps context (message count rises) |
| Empty message | Graceful error, no crash |

---

## Notes / limitations (base)

- Agent answers are **hard-coded** (deterministic, keyword-aware) — no LLM, no
  external services. Swap any agent's function body for real logic later; the
  signatures and pipeline don't change.
- SQLite is Node's built-in `node:sqlite` (no `better-sqlite3`, no compiler).
- Dark mode only by design.
