# User Flow

End-to-end journeys through the system, from the customer's perspective and the
admin/agent perspective.

**Docs chain:** `README.md` → `user-flow.md` → `technical-spec.md` → `lld.md`

---

## 1. Customer — single-issue ticket

```
Customer opens http://localhost:3100
  └─ types: "My order hasn't arrived."

  UI shows live step progress (SSE streaming):
    ● Screening for hard signals        [rule]
    ● Classifying intent                [LLM]  → orders (0.91)
    ● Reading sentiment                 [LLM]  → neutral (0.1)
    ● Splitting into sub-problems       [LLM]  → 1 sub-problem
    ● Orders agent investigating        [LLM]  → tools: orderLookup
    ● Assessing severity                [rule] → low / P3
    ● Checking escalation               [rule] → none needed
    ● Composing your reply              [LLM]

  AI reply displayed with:
    - Resolution summary
    - Collapsible "1 agent · 8 steps" thought trail
    - 👍 / 👎 feedback bar

  Customer submits feedback → stored in DB
```

---

## 2. Customer — multi-issue ticket (parallel agents)

```
Customer types: "My checkout keeps failing and I was charged twice."

  Classify → technical (0.82) + billing (0.78) → is_multi_issue: true
  Decompose → SP-1: technical · SP-2: billing
  Investigate (Promise.all):
    ├─ Technical agent → lookupErrorCode("CART-422") → checkout error found
    └─ Billing agent   → subscriptionLookup() → duplicate charge confirmed
  Merge → overall_status: partial (technical resolved, billing unresolved)
  Severity → medium / P2 (findings contain "duplicate charge")
  Escalate → frustration_repeat rule → NOT triggered (first message, neutral tone)
  Synthesize → unified reply covering both issues

  Admin sees in Trace → Agents tab:
    Fan-out diagram  [ ticket ] →→→ [ Technical ✓ ]
                              └→→→ [ Billing ⚠ ]  →→→ [ merged: partial ]
```

---

## 3. Customer — frustrated, repeat contact

```
Turn 1: "My refund is still pending."
  → Sentiment: neutral · P3 · no escalation

Turn 2: "THIS IS STILL NOT RESOLVED!! talk to a manager!!"
  → Guard: force_escalation (matched "talk to a manager")
  → Sentiment: angry (0.82) · frustration: true · trend: rising
  → Severity: high / P1
  → Escalation: triggered (force_escalation + frustration_repeat)
    └─ Assigned to: Maya Fernandez (Billing) — least-loaded agent

  Customer sees: "A human agent will contact you shortly."

  Agent (Maya) receives:
    - In-app notification bell
    - Case appears in /escalations as P1
    - Case sheet shows: customer mood card, suggested resolution, conversation

  Agent replies → customer receives notification → sees reply in chat poll
  Agent can: Reply · Handoff to manager · Resolve
```

---

## 4. Customer — FAQ match

```
Customer types: "What is your return policy?"

  FAQ check runs before classifier
    matchFaq("What is your return policy?") → matches "return policy" (contains)
    category: "faq" · faq_answer: "We accept returns within 30 days..."

  Classifier short-circuited — no LLM call, no specialist agent
  Synthesizer returns faq_answer directly

  Observability: category shown as "faq" (violet badge)
  No ticket created (non-support category)
```

---

## 5. Customer — low-confidence / ambiguous

```
Customer types: "Something feels off with my account."

  Classify → all intents below threshold → fallback: true
  Route → policy agent (safe catch-all)
  Agent → policy review, asks for more detail
  Severity → low / P3

  UI shows: fallback badge visible in Trace → Pipeline Flow
```

---

## 6. Admin — working the escalation queue

```
Admin/agent logs in → role: "agent" → redirected to /escalations

My Cases list (filtered to assignee_id = me):
  - P1 · billing · Maya Fernandez · "Double charge, very angry"

Click row → Case sheet slides in:
  - Customer mood: Angry · rising · "strong negative wording; repeat contact"
  - Suggested resolution: "Refund has been confirmed by Billing agent…"
  - Conversation thread (polled every 6s)
  - Team notes section

  Agent types a reply → POST /api/escalations/:id/reply
    → Customer notified
    → Team activity emitted: "Maya replied to …"
    → Collaboration dashboard shows the event live

  Agent adds a note: "Checked the transaction logs — charge ID 9982 confirmed duplicate"
    → POST /api/escalations/:id/note
    → Visible to team on /collaboration, not to customer

  Agent resolves → POST /api/escalations/:id/resolve
    → Customer notified "Your case is resolved"
    → Activity: "Maya resolved …"
```

---

## 7. Admin — real-time team view

```
Admin opens /collaboration

  Roster (grouped by department):
    Billing
      ● Maya Fernandez   [■■■□□] 3 open   online
      ● Tom Becker       [■□□□□] 1 open   online
      ○ Priya Nair       [□□□□□] 0 open   5m ago
    Technical
      ● Sofia Rossi      [■■□□□] 2 open   online

  Live activity feed (SSE):
    ↗ New P1 case → Maya Fernandez (Billing)    just now
    💬 Maya replied to John Smith               2m ago
    ✓  Tom resolved #0041                       5m ago

  Team notes (recent):
    Maya: "Checked transaction ID 9982 — confirmed dup"   3m ago
```

---

## 8. Admin — suggested KB article

```
Admin goes to /platform → Knowledge Base

  "Suggest an article from a resolved ticket"
  Selects: #0039 — "Checkout error + double charge" (status: resolved)
  Clicks "Generate draft"

  → POST /api/platform/kb/suggest { ticket_id: "..." }
  → Agent assembles KbSource from run: question + resolution + findings + actions
  → callLLM generates clean Markdown article
  → Draft loaded into editor:
      filename: checkout_payment_errors.md
      title: "Checkout Errors and Duplicate Charge Resolution"
      content: "# Overview\n Customers may encounter..."

  Admin edits → clicks Save
  → PUT /api/platform/kb/:file → writes to library/
  → Article live on next ticket retrieval
```

---

## 9. Admin — observability + trace

```
Admin opens /observability

  Table of all pipeline runs:
    ID     | Message preview    | Category | Mood      | Intent  | Agents | Steps
    #0042  | "checkout failing" | support  | 😠 Angry  | billing |   2    |   9

  Click row → sheet slides in:
    Signals: intent · multi-issue · sentiment · severity · priority · LLM calls
    Pipeline flow: animated step graph (all 8 steps with status + details)
    Agent verdicts: Technical ✓ 88% · Billing ⚠ 72%
    Resolution summary

  "Open full trace in new tab" → /trace/:ticketId

  Trace page:
    Ticket summary band (title, customer, runs, badges incl. mood)
    Lifecycle stepper: Created → Understood → Investigated → Assessed → Escalated

    Run #1 — Agent Collaboration Flow
    [Pipeline Flow tab]    [Agents tab]         [Audit tab]
    Step graph:            Fan-out diagram       Full typed audit trail
      guard ✓              ticket → Technical    + step timings
      classify ✓                 → Billing       + raw state JSON
      sentiment ✓          → merged: partial
      decompose ✓
      investigate ✓        Agent report cards
      severity ✓           (findings/actions/
      escalation ✓          reasoning/evidence)
      synthesize ✓

    Below: All runs collapsible list (RunTraceCard)
```

---

## 10. Admin — platform policy control

```
Admin opens /platform → Policies

  Hard checks (guard signals):
    ✅ talk to a manager   ✅ chargeback   ✅ legal action   ✅ data breach

  Escalation rules:
    ✅ High severity      ✅ Unresolved   ✅ Conflicts
    ✅ Specialist handoff ✅ Frustration + repeat

  Intent thresholds:
    technical   0.35  billing  0.40  policy  0.30  orders  0.35  products  0.30

Admin opens /platform → FAQ

  Label: "Return policy"
  Match: contains
  Triggers: ["return policy", "can I return", "refund my order"]
  Answer: "We accept returns within 30 days of purchase…"
  Enabled ✅

Admin opens /platform → Specialists

  technical · billing · policy · orders · products  (built-in)
  [+ Add custom agent]
    Name: "Loyalty"   Domain: loyalty
    Description: "Handles loyalty points, rewards, tier status"
    Keywords: points, rewards, tier, loyalty
    Team: Customer Success
  → Materialized at runtime, appears in classifier and router immediately
```
