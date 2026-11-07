# expense-assistant

[![CI](https://github.com/lcylamb/expense-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/lcylamb/expense-assistant/actions/workflows/ci.yml)

**[中文](README.zh-CN.md)**

Ask a natural-language question about an expense report and get a **structured, verifiable answer**: a conclusion, the fields it is based on, and whether the data was insufficient. Answers stream over SSE.

**Live demo: <https://assistant-demo-0rgz.onrender.com>** — free-tier instance, the first request may take ~40s to wake up. Or run it locally: `npm run dev`, then open <http://localhost:5173>; the default provider is a mock, so no API key is required.

## Features

- **Structured output** — the model must return JSON; the complete answer is validated field by field, and malformed output results in `502` instead of a partial answer.
- **Verifiable evidence** — `evidence` only accepts fields returned by tools actually called during this request; unknown fields are removed and logged.
- **Tool calling** — the model fetches data through three read-only tools. The expense ID is bound by the server and cannot be chosen by the model.
- **Login, then visibility** — real username/password login (scrypt hashes, signed session cookie); the server decides which expenses you can see. Querying one you cannot see returns the same `404` as a nonexistent code, so codes cannot be enumerated. Rules live in one place (`viewer.ts`) and are shared by the list endpoint, the ask guard, and the tool queries.
- **Streaming** — the conclusion is extracted incrementally from partial JSON; streaming and non-streaming responses share the same final validation. True token-by-token streaming with a real provider; the mock simulates chunks.
- **Multi-turn** — the client sends back the previous turn's validated conclusion; the server keeps no session state.
- **Policy Q&A (RAG)** — a second module answers questions about the (fictional) expense policy handbook: document splitting, local embeddings, retrieval, and a LangGraph quality gate that rewrites the query and retries when retrieval comes back irrelevant.
- **Evaluated** — 24 cases cover tool trajectories, prompt injection, and cross-record access, run against a real database in CI.
- **A real front end, not a demo page** — React 18 + TypeScript + Ant Design 5, routed with react-router, built with Vite into `public/` and served by the same Nest process (same origin, no CORS). Identity and data live in separate contexts; the UI is componentized and covered by Testing Library tests. Source lives in `web/`, build artifacts are not committed.
- **Observable** — request IDs, access logs, latency / time-to-first-token / token / cost metrics, and rejected-request counters.
- **Mock-first** — a rule-based provider makes the full test suite reproducible without network access or credentials.

## Quick start

Requires Node 22.12+ and Docker.

```bash
cp .env.example .env      # defaults to PostgreSQL on localhost:5433
npm install
npm run db:up             # start PostgreSQL
npm run db:migrate        # create tables
npm run db:seed           # insert 10 fictional expense reports
npm run dev               # API :3100 + web :5173 (hot reload — open 5173)
```

`npm run dev` starts two processes: Nest in `--watch` mode on 3100 (backend edits restart it), and Vite on 5173 (frontend edits hot-swap without a page reload). **Open 5173 while developing.** 3100 is the API; the page it also serves is whatever the last `npm run build` left in `public/`, so `/` redirects to 5173 instead of showing a stale build.

Only three kinds of change need a manual restart: `.env`, `prisma/schema.prisma`, and new dependencies.

Useful scripts:

| Command | Description |
|---|---|
| `npm run db:reset` | Reset the database and re-seed |
| `npm run db:studio` | Database browser (localhost:5555) |
| `npm run probe:stream` | Call the streaming endpoint and print arrival time per chunk |
| `npm run mcp` | Start the MCP server (stdio) exposing the read-only tools |
| `npm run eval` / `eval:real` | Run the evaluation suite with mock / a real model |
| `npm run lint` / `npm test` / `npm run test:e2e` | Static checks and tests |
| `npm run dev:web` | Vite dev server for the front end (proxies `/auth`, `/assistant` to :3100) |
| `npm run test:web` | Front-end component tests (Testing Library, jsdom) |
| `docker compose up --build` | Database + migrations + app in containers |

## Accounts and visibility

The web UI is a real login form. Passwords are stored as scrypt hashes with a per-user salt; a successful login returns a signed JWT in an **httpOnly** cookie (8h TTL, `SameSite=Lax`). The token carries only the user id — the name and role are read from the database on every request, so a role change takes effect immediately instead of waiting out the token.

Seeded accounts (password `demo1234` for all of them — public on purpose, they are demo data):

| Username | Name | Role | Sees |
|---|---|---|---|
| `zhangsan` / `lisi` / `wangwu` / `zhaoliu` / `sunqi` | 张三 / 李四 / 王五 / 赵六 / 孙七 | `applicant` | Only their own reports |
| `wangjl` | 王经理 | `approver` | Everything except `DRAFT` |
| `zhengshi` | 郑十 | `auditor` | Everything, including drafts (read-only reconciliation) |

Visibility is enforced in three places from one implementation (`viewer.ts`): the list endpoint filters the collection, `prepare()` rejects invisible codes before a session starts, and every tool query carries the same condition in its `where` — so even a bug in the binding layer cannot leak rows. Ownership is checked against `applicantId`, not the applicant's name: two people named 张三 exist in real companies.

Asking for someone else's report returns exactly the same `404` as asking for a code that does not exist. The API never confirms that another person's report exists.

What is deliberately **not** here, rather than hidden:

- **Identity is never an input.** The request body has no `viewer` field; posting one is rejected with `400`. The old client-declared identity is gone — one `curl` used to be enough to act as an approver.
- **No revocation list.** Sessions are stateless, so logout clears the cookie but a copied token stays valid until it expires. That is the price of not maintaining a session table, and the reason the token is httpOnly (page scripts cannot copy it).
- **Login shares the per-IP throttle** with the ask endpoints. Three wrong passwords in a minute will also block questions for that minute.
- **No password reset / user management.** Accounts come from the seed.

Set `SESSION_SECRET` (≥32 chars) in production. Without it the app still boots, but generates a random key per process — every restart invalidates all sessions, and multiple instances will not recognise each other's tokens. `COOKIE_SECURE` overrides the `Secure` flag when TLS terminates in front of the app.

## MCP server

The same read-only tools the model uses are also exposed as an MCP server (stdio transport), so any MCP client — Claude Code, Cursor, etc. — can query the expense data directly:

```
expense-assistant (mcp/server.ts)
  ├─ list_expenses        discover reports (optionally filter by status)
  ├─ get_expense_summary  header of one report, by code
  ├─ list_expense_items   line items + total, by code
  └─ get_approval_record  status / decidedAt / approverName / approvalNote / rejectReason, by code
```

Register it in your MCP client config (adjust the absolute paths):

```json
{
  "mcpServers": {
    "expense-assistant": {
      "command": "/path/to/expense-assistant/node_modules/.bin/tsx",
      "args": ["/path/to/expense-assistant/mcp/server.ts"]
    }
  }
}
```

Requires the same setup as the app (`.env` with `DATABASE_URL`, Postgres running and seeded). The server reads `.env` from the repo root regardless of the client's working directory, and fails fast at startup if the database is unreachable.

Note on the security boundary: the web app binds the expense ID server-side so the model cannot choose which report to read. The MCP caller is the operator on their own machine — an equivalent of direct read access — which is why the tools accept a `code` parameter and a discovery tool exists here. What does not change: every tool is read-only, and there is no free-form SQL surface.

## Usage

### Single question

```bash
# 1. Log in once; the cookie jar keeps the session for the next call.
curl -c /tmp/ea.jar -X POST localhost:3100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"zhengshi","password":"demo1234"}'

# 2. Ask. No identity in the body — the server reads it from the session.
curl -b /tmp/ea.jar -X POST localhost:3100/assistant/ask \
  -H 'Content-Type: application/json' \
  -d '{"code":"BX-2026-0003","question":"Why was this report rejected?"}'
```

```json
{
  "conclusion": "BX-2026-0003 was rejected because the entertainment expense exceeded the department's monthly budget and the attendee list was missing.",
  "evidence": ["code", "status", "rejectReason"],
  "insufficient": false,
  "trace": [{ "tool": "get_approval_record", "ok": true }],
  "metrics": {
    "elapsedMs": 912,
    "ttftMs": null,
    "modelCalls": 2,
    "toolMs": 18,
    "usage": { "promptTokens": 1820, "completionTokens": 96 }
  }
}
```

When the data does not contain an answer, the response says so explicitly:

```json
{
  "conclusion": "BX-2026-0005 has not reached approval yet (draft), so there is no approval comment in the data.",
  "evidence": ["code", "status"],
  "insufficient": true,
  "trace": [{ "tool": "get_approval_record", "ok": true }]
}
```

### Streaming

`POST /assistant/askStream` takes the same body and returns `text/event-stream`:

```
event: delta
data: {"text":"This "}

event: delta
data: {"text":"report "}

event: done
data: {"conclusion":"…","evidence":["status"],"insufficient":false,"trace":[…],"metrics":{…}}

event: error
data: {"message":"Model call failed, please retry"}
```

`delta` contains incremental text that may be revised by later chunks; only `done` is final, and its payload has exactly the same shape as `/assistant/ask`. When the stream is idle for longer than `SSE_HEARTBEAT_MS`, the server sends an SSE comment frame (`: ping`), which clients should ignore per the SSE specification.

### Multi-turn

Pass `history` in the request body, containing previously validated conclusions:

```json
{
  "code": "BX-2026-0002",
  "question": "What was that money spent on?",
  "history": [
    {
      "question": "What is the total amount of this report?",
      "conclusion": "The reimbursement amount of BX-2026-0002 is ¥12800.00.",
      "evidence": ["code", "amount"],
      "insufficient": false
    }
  ]
}
```

At most 3 turns. History is context only; it does not expand which fields may be cited in the current turn.

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | `{username, password}` → session cookie + profile (public) |
| `POST` | `/auth/logout` | Clears the session cookie (public) |
| `GET` | `/auth/me` | Current profile, or `401` |
| `POST` | `/assistant/ask` | Returns an `AskResult` |
| `POST` | `/assistant/askStream` | SSE: `delta` → `done`, or `error` |
| `GET` | `/assistant/expenses[?category=TRAVEL]` | Expenses visible to the logged-in account + summary |
| `GET` | `/assistant/metrics` | In-process metrics snapshot |
| `GET` | `/health` | Runs `select 1` and checks that the required tables exist; returns `503` when the database is unavailable or a table is missing |

Every endpoint except `/auth/login`, `/auth/logout` and `/health` requires a session cookie (`401` otherwise). Every response carries `X-Request-Id`; logs are JSON lines that carry the same value as `reqId`.

| Status | Meaning |
|---|---|
| `400` | Request validation failed |
| `404` | Expense report not found — also returned when the identity has no visibility over it, so codes cannot be enumerated |
| `429` | Rate limit, concurrency limit, or daily quota exceeded |
| `502` | Model call failed, or output failed format validation |
| `503` | Database unavailable |
| `504` | Overall request budget exceeded |

Once the streaming endpoint has written response headers, the status code can no longer change. Model failures, format errors, and mid-stream database failures therefore appear as `200` + an `error` frame.

## Design at a glance

```
request → validation → rate/concurrency guards → load expense → agent loop (model ↔ tools) → parse & filter → response
```

Key choices:

- **Model output is not trusted.** The complete answer is type-checked; cited fields must come from this request's tool results, otherwise they are removed. `502` is reserved for format errors, not for imperfect wording.
- **The expense ID is not a tool argument.** The server binds it, and there is no search-all or query-by-filter tool. The data a model can reach is decided by the server.
- **Streaming does not get its own parser.** Both endpoints share `prepare()` and `settle()`; incremental text is still validated in full when the stream ends.
- **Cancellation is wired before headers are sent.** The streaming endpoint listens for connection close before loading the expense, so an early client disconnect does not call the model or consume quota.
- **Three independent limits.** Rate, concurrency, and daily quota address scripted abuse, request pile-up, and budget exhaustion respectively.
- **Errors are classified by source.** Vendor failures are `502`, database failures `503`, timeouts `504`, and client cancellations are not counted as errors.

Detailed design notes: [docs/design.md](docs/design.md) (Chinese).

## Policy Q&A (RAG)

`POST /knowledge/ask` answers questions about the expense policy handbook — the
complement to the assistant module: one looks up what happened to a report, the
other looks up what the policy says. Pipeline: splitting → local embeddings →
vector retrieval → citation-checked generation, with a LangGraph node that
grades retrieval quality and rewrites the query once before giving up
(`queryRewritten: true` marks that path; out-of-scope questions are answered as
"not covered", with empty `sources`).

The vector store is a 60-line in-memory implementation behind the standard
`VectorStore` interface (`@langchain/community` v1 dropped MemoryVectorStore),
so switching to pgvector later touches one file. Embeddings run locally —
DeepSeek has no embeddings endpoint.

Requires a real model (`LLM_API_KEY`) and a one-time ~90MB local embedding
model download; the index is built lazily on the first question. Memory note:
the embedding model puts the process at ~714MB RSS, so small-memory hosts
(Render free tier: 512MB) must set `KNOWLEDGE_ENABLED=false`. Details:
[docs/knowledge.md](docs/knowledge.md) (Chinese).

## Evaluation

24 cases, each sent to both endpoints. Most expected values are computed from the database rather than hard-coded.

```
npm run eval        (mock)      : 14 passed,  9 known gaps, 0 unexpected
npm run eval:real   (DeepSeek)  : 24 passed,  0 known gaps, 0 unexpected
```

- Structural checks are never waived: cited fields must exist, amounts and dates must be traceable, tools must not fail, and both endpoints must return the same conclusion under a deterministic provider.
- Trajectory checks require each case to call a designated tool, so a coincidentally correct answer does not pass.
- The 9 known gaps on mock correspond to capabilities the rule table lacks; all pass with a real model.
- The suite has been mutation-tested to fail when a defense is removed, so an all-green run is meaningful.

Case table, grading layers, and real-model results: [docs/evaluation.md](docs/evaluation.md) (Chinese).

## Testing and CI

```bash
npm test          # unit tests, no database required
npm run test:e2e  # end-to-end tests and evaluation, requires a database
npm run lint      # oxlint with type-aware checks
```

CI runs `lint` → `tsc --noEmit` → `build` → unit tests → end-to-end tests on every push to `main` and on pull requests. The database is provided by an Actions service container, migrated and seeded from scratch each run. The pipeline ends by building and starting the real container to verify health checks, one live request, no secrets in the image, a non-root process, and a clean `docker stop`.

CI runs the mock only; real-model evaluation is run locally.

## Configuration

Main variables:

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` or `openai` (OpenAI-compatible protocol) |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | — | Required when `LLM_PROVIDER=openai` |
| `LLM_THINKING` | off | Vendor reasoning mode; `enabled` turns it on (breaks the prompt-injection defence) |
| `HF_MIRROR` | unset | HuggingFace mirror for the local embedding model download (set when hf.co is unreachable) |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per IP per minute |
| `MAX_CONCURRENT_ASKS` | `8` | Max in-flight model requests; `0` disables |
| `LLM_DAILY_LIMIT` | off | Daily model-call quota |
| `ASK_TIMEOUT_MS` | `90000` | Total budget for one question |
| `LLM_TIMEOUT_MS` | `30000` | Per-call timeout |
| `SSE_HEARTBEAT_MS` | `15000` | Idle heartbeat interval for streams |
| `TRUST_PROXY` | unset | Number of trusted proxy hops; set only behind a proxy |

To use a real model, change `.env` only — no code changes:

```bash
LLM_PROVIDER=openai
LLM_API_KEY=...
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-flash
```

`npm run eval:real` then runs the same suite against that provider.

Thinking mode stays **off** (`LLM_THINKING` defaults to off). DeepSeek's
current models enable it by default, and with it on the model follows
instructions embedded in the question — the prompt-injection case fails
eight times out of eight, echoing a fake amount back as the conclusion.
The same model with thinking disabled refuses that question instead.

Full list and notes: [`.env.example`](.env.example) and [docs/operations.md](docs/operations.md) (Chinese).

## Deployment

```bash
docker compose up --build   # database + migrations + app
```

The image is built in five stages, runs as a non-root user, and contains no secrets. The app verifies the database on startup and does not wait for active connections on shutdown. The deployment target is Render + Neon; migrations are run manually from a local machine.

Details: [docs/operations.md](docs/operations.md) (Chinese).

## Known limitations

This is a practice project, not a production system:

- Permissions stop at three roles and one visibility rule — nothing per-department or tiered by amount — and there is no multi-tenant isolation: one deployment serves one organisation.
- Metrics, rate limits, concurrency limits, and daily quota are in-process. Multiple instances count independently, and restarts reset them.
- No tracing, log aggregation, or cross-instance aggregation.
- The incremental parser does not guarantee `conclusion` is a top-level key; the full validation after the stream ends is the safety net.
- Cost estimates exclude cache pricing and are therefore an upper bound, not a bill.
- Mock token counts are estimated from character length, not tokenizer output.
- Real-model evaluation is a single sample; outputs are not guaranteed to be reproducible.

Out of scope: RAG (the data is structured, so querying the database directly is the right approach), complex agent orchestration, and conversation persistence. **No approval workflow** — there are no approval nodes, no routing between approvers, no countersigning or reminders, and no approval-history table: a report only carries the outcome of a decision (status, decided-at time, approver, approval note or rejection reason). The three-tier approval described in the policy handbook is a clause of the fictional company policy, not a capability this system implements.

## Data

All data in this repository is fictional: names are placeholders such as "Zhang San / Li Si / Wang Wu", with no real people, ID numbers, phone numbers, or data from any real business system. Amounts are invented as well.

The seed inserts 10 expense reports covering draft, pending approval, approved, rejected, and paid states, used by both normal-path and edge-case evaluations. Decided reports also carry an approver and an approval note — so asking "what was the approval comment?" on an approved or paid report gets the comment itself, while draft and pending ones correctly answer "not enough information".

## License

[MIT](LICENSE)
