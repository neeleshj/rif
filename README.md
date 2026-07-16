# RIF Technical Test: Mutant Detector

```
    A=T    G=C    T=A    C=G    A=T    G=C
     \ \  / /      \ \  / /      \ \  / /
      \ \/ /        \ \/ /        \ \/ /
       \/\/          \/\/          \/\/
       /\/\          /\/\          /\/\
      / /\ \        / /\ \        / /\ \
     / /  \ \      / /  \ \      / /  \ \
    C=G    A=T    G=C    T=A    C=G    A=T
```

> **Rent It Furnished, Technical Test 2026**
> Detect whether a human is a mutant based on their DNA sequence.

This README doubles as a **development log**. AI assistance was permitted for this
test on the condition that I fully understand every part of the solution, so the
log at the bottom records the decisions, reasoning, and steps taken throughout,
not just the final instructions.

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [Deliverables](#deliverables-from-the-test)
- [How to Run](#how-to-run)
- [Development Log](#development-log)
  - [Approach](#approach)
  - [Order of work](#order-of-work)
  - [Stack](#stack)
  - [Backend and data](#backend-and-data)
  - [Scalability](#scalability)
  - [Architecture sketch](#architecture-sketch)
  - [AI tooling](#ai-tooling)
  - [Algorithm](#algorithm)
  - [API](#api)
  - [Database](#database)
  - [Frontend](#frontend)
  - [Testing](#testing)
  - [Observability](#observability)
  - [Repository and setup](#repository-and-setup)

---

## Problem Statement

Implement a function with the signature:

```
boolean isMutant(String[] dna)
```

**Input:** an array of strings representing the rows of an `N x N` grid. Every
character is one of `A`, `T`, `C`, `G` (the four nitrogenous bases).

**Rule:** a human is a **mutant** if the grid contains **more than one** sequence
of **four identical letters** in a straight line, checked **horizontally**,
**vertically**, or **diagonally** (both diagonal directions).

- "More than one" means **two or more** four-in-a-row sequences are required for `true`.
- Fewer than two means not a mutant.

**Worked example (mutant, returns `true`):**

```
ATGCGA
CAGTGC
TTATGT
AGAAGG
CCCCTA
TCACTG
```

---

## Deliverables (from the test)

- [ ] **1. Algorithm:** implement `isMutant` as efficiently as possible.
- [ ] **2. REST API:** `POST /mutant/` accepting `{"dna":[...]}`; returns
      **200 OK** if mutant, **403 Forbidden** otherwise.
- [ ] **3. Database:** persist every verified DNA, **one record per DNA**.
- [ ] **4. Stats endpoint:** `GET /stats/` returning
      `{"count_mutant_dna", "count_human_dna", "ratio"}`.
- [ ] **5. Scalability:** tolerate traffic from **100 to 1,000,000 req/s**.
- [ ] **6. Automated tests:** code coverage **> 80%**.
- [ ] **7. Frontend:** a UI to input the DNA strings.
- [ ] **8. Architecture diagram:** of the overall solution.
- [ ] **9. README:** instructions on how to run everything (this file).

---

## How to Run

> The repository scaffold is created in the build phase (see [PLAN.md](PLAN.md));
> these are the intended run instructions.

**Prerequisites:** Node 20+, PostgreSQL 14+ (or a cloud connection string), and
corepack (bundled with Node).

```bash
# 1. Enable pnpm (no global install needed)
corepack enable

# 2. Install all workspaces
pnpm install

# 3. Configure environment
cp .env.example .env
#    then set DATABASE_URL (and any overrides) in .env

# 4. Create the schema (tables, dna_ratio function, seed row)
pnpm db:setup

# 5. Run everything (API on :3001, web on :3000)
pnpm dev
```

Other scripts: `pnpm test` (all tests with coverage), `pnpm build`, `pnpm lint`.

---

## Development Log

### Approach

Plan before building. With AI-assisted development the leverage is in planning
and fast iteration, so I settle decisions and design up front, then execute
quickly against a clear plan.

**Algorithmic framing.** The mutant check is Connect Four's win condition, not
tic-tac-toe: I slide a length-4 window across an arbitrary `N x N` grid in four
directions (horizontal, vertical, both diagonals) and count matches, with early
exit the moment the second sequence is found.

### Order of work

1. Initialise the git repository, with meaningful commits from the start.
2. Stack choice (language / runtime).
3. Tech choice (frameworks, libraries, DB, tooling).
4. Architecture.
5. AI tooling: define project-specific skills / sub-agents tuned to the stack.
6. Plan all remaining elements, one requirement at a time.
7. Rough plan of the API and the frontend.
8. Build the API.
9. Build the frontend.
10. Test.

The project runs locally. Deployment is out of scope, as it is not a graded
requirement. Scalability is treated as a design-and-justify item: an in-process
cache plus async writes, with the horizontal-scaling approach documented in the
architecture diagram rather than physically deployed.

### Stack

- **Language / runtime:** Node.js with TypeScript, for type safety and one
  language across the whole project.
- **Architecture:** separate backend and frontend, rather than a single
  full-stack app. This keeps a clean API/UI boundary and mirrors a realistic
  service split.
- **Frontend:** Next.js. Slightly heavy for a single input page, but it gives me
  a fast, well-understood React setup with good tooling.
- **Backend:** a dedicated Node/TypeScript API service (framework and database
  under Backend and data, below).

### Backend and data

- **Framework:** Fastify. Fast, first-class TypeScript, and built-in JSON-schema
  validation, which I want anyway to validate the `dna` payload and return clean
  `400`s (distinct from the spec's `403` for a valid-but-non-mutant DNA).
- **Database:** PostgreSQL. Records are stored as **append-only rows**
  `(id, dna, is_mutant, created_at)`.
- **Interpretation of "1 record per DNA":** the spec line is ambiguous. I read
  it as *one row per submitted DNA payload* (not one row per grid string), stored
  append-only, rather than as a deduplication / uniqueness constraint. This is a
  deliberate reading, documented so it is clearly a choice and not an oversight;
  the strict alternative would be a unique constraint on the DNA. Consequence:
  the stats counts reflect **total verifications**, not unique DNAs.
- **Stats:** computed from **maintained counters** (write-time aggregation), not
  a `COUNT(*)` scan. Two counters (`count_mutant`, `count_human`) are updated as
  records are written, so `/stats/` is an O(1) read. Ratio = mutant / human
  (matching the spec example: 40 / 100 = 0.4).

### Scalability

The API must tolerate 100 to 1M req/s. A single-process local demo cannot
literally ingest 1M req/s: the network stack and event loop cap out in the tens
of thousands per process. So I build the correct patterns locally and document
how a deployed system reaches the top of the range. Deployment itself is out of
scope. **1M req/s is unattainable in a demo like this; the design is the
deliverable, and that volume is reached by replication, not by one box.**

**Read path (`/stats/`), read-heavy:**

1. Never compute on read: maintained counters make each read O(1).
2. Serve from an in-process cache per instance, refreshed on a short interval, so
   reads hit local RAM rather than the database.
3. Send a short-TTL cache header (`max-age=1`) so a CDN or reverse proxy absorbs
   the flood; the origin then sees at most roughly one request per second per
   edge node.
4. Scale horizontally: stateless instances behind a load balancer, reading shared
   counters to refresh their local cache.

Trade-off: `/stats/` becomes eventually consistent with bounded staleness (about
a second). Acceptable for an aggregate ratio, and chosen deliberately.

**Write path (`/mutant/`), write-heavy:**

The key move is to take Postgres's write throughput off the per-request critical
path with a **queue**:

1. Compute the result, push `{dna, isMutant, ts}` onto a queue, and ack in well
   under a millisecond.
2. A background worker flushes to Postgres in **batches** (on a size or time
   threshold) via multi-row `INSERT`. Batching is what lets bounded DB write
   capacity keep up with a much higher accept rate.
3. **Bounded buffer + backpressure:** cap the queue and shed load (`503` / `429`)
   when full, rather than growing unbounded until OOM.
4. **Graceful shutdown:** a `SIGTERM` handler drains the buffer before exit. A
   hard crash still loses the un-flushed batch: in-process buffering is
   at-most-once for whatever is in memory.
5. **Counter timing:** increment at enqueue (in memory, atomic), so `/stats/`
   stays fast and correct. A failed batch leaves the counter slightly ahead of
   durable rows, the same eventual-consistency trade.

The queue sits behind a small interface (`enqueue()` / a worker that drains), so
the local in-process implementation swaps cleanly for a durable, shared one.

**Local vs deployed:**

- **Local (built):** in-process bounded queue, single Fastify instance, Postgres.
  Demonstrable with a load generator (`autocannon` / `k6`) showing flat ack
  latency and a bounded DB write rate while the buffer absorbs a burst.
- **Deployed (documented in the architecture diagram):** swap the in-process
  queue for a durable shared queue (SQS), run stateless API instances behind a
  load balancer, use Redis for shared stats counters, and shard Postgres (by DNA
  hash) for durable write throughput. SQS is managed and elastic, so it absorbs
  the "aggressive fluctuations" from the spec with no ops overhead, and its batch
  receive feeds the batched-insert worker directly. A load balancer scales the
  app tier; the data tier scales separately via batching, the queue, and
  sharding.

### Architecture sketch

A rough first pass at the base local architecture. Polished diagrams (including
the scaled topology) come later, with the detailed plan.

Three components, all running locally:

- **Frontend (Next.js):** a page to enter the DNA strings and show the result.
  Calls the backend over HTTP.
- **Backend API (Fastify):** exposes `POST /mutant/` and `GET /stats/`. Holds the
  `isMutant` algorithm, request validation, the in-memory stats counters, and the
  in-process write queue with its batch-flush worker.
- **Database (PostgreSQL):** the append-only records table and the persisted
  counters.

Request flow:

- **`POST /mutant/`:** validate the payload, run `isMutant`, increment the
  matching stats counter, enqueue the record, and respond `200` (mutant) or `403`
  (not). The batch worker drains the queue into Postgres asynchronously.
- **`GET /stats/`:** read the in-memory counters and return the counts and ratio.

```
  +--------------+       HTTP         +-------------------------------+
  |   Frontend   |  POST /mutant/     |          Backend API          |
  |  (Next.js)   |  GET  /stats/      |           (Fastify)           |
  |              | <----------------> |                               |
  +--------------+                    |  validation                   |
                                      |  isMutant algorithm           |
                                      |  stats counters (in memory)   |
                                      |  write queue + batch worker   |
                                      +---------------+---------------+
                                                      | batched INSERT
                                                      v
                                             +------------------+
                                             |    PostgreSQL    |
                                             |  records table   |
                                             |  counters        |
                                             +------------------+
```

### AI tooling

AI assistance is allowed for this test, so I am treating the AI workflow itself
as part of the engineering. The setup is deliberately proportionate: build
custom sub-agents only where there is a real gap, and reuse the strong tooling
that already exists for the rest.

**Working model.** The main agent is used for planning, coordination, and
maintaining this development log. All build, test, and design work is delegated
to focused sub-agents, so each task runs with the right expertise and a clean
context.

**Custom sub-agents** (in `.claude/agents/`), one per gap:

- **`fastify-api`** — the backend: Fastify routing and schema validation, the
  Postgres data layer, and the queue, batch worker, and counters. Owns the error
  contract (400 for malformed input, 403 for valid-but-non-mutant).
- **`nextjs-frontend`** — the Next.js DNA-input page and API calls. Delegates
  visual/UX work to the existing design skills.
- **`test-author`** — Vitest unit and integration tests, targeting >80% coverage,
  biased toward the algorithm edge cases.
- **`performance`** — load testing (autocannon / k6), queue backpressure checks,
  and Lighthouse on the frontend.

**Reused, not rebuilt:**

- **UX/UI** — the existing `frontend-design` and `ui-ux-pro-max` skills, invoked
  by `nextjs-frontend`.
- **Review** — the `code-reviewer` agent and the `setup-code-review` post-commit
  hook, both part of my existing global setup, so nothing is installed per-project
  here.

**Grounding.** A repo-root `CLAUDE.md` holds the shared project context every
agent reads: stack, structure, conventions, scope guardrails, the encoded
decisions above, and the delegation policy.

### Algorithm

Signature: `isMutant(dna: string[]): boolean`.

**Definitions:**

- A **sequence** is a run of **four or more** identical letters in a straight
  line, in any of four directions: horizontal, vertical, and both diagonals
  (the spec's "obliquely"). At least four; a longer run is still one valid
  sequence, not disqualified for exceeding four.
- A grid is a **mutant** only with **more than one** sequence (two or more),
  counted as **distinct maximal runs**. A single run, however long, is never
  enough.

This is confirmed by the spec's mutant example, which has three separate
sequences: a diagonal `AAAA`, a vertical `GGGG`, and a horizontal `CCCC`.

**Method:**

- Scan the grid, checking the four forward directions (right, down, down-right,
  down-left) from each cell for a run of 4+ equal letters. Count each maximal run
  once and skip past it, so a long run is not counted repeatedly.
- Only two sequences are ever needed. Keep a counter and stop the instant it
  reaches two, returning `true`. Whether the grid has two or five sequences is
  irrelevant, so the scan never counts past the second.

To count each maximal run exactly once, a run is only counted at its **start**:
if the previous cell in the same direction holds the same letter, the current
cell is mid-run and is skipped. This handles long runs (a six-run counts once)
without separate skip bookkeeping.

**Pseudocode:**

```
function isMutant(dna):            # dna is normalised, validated, N x N
    N = length(dna)
    if N < 4:
        return false

    directions = [(0, 1),          # horizontal, right
                  (1, 0),          # vertical, down
                  (1, 1),          # diagonal, down-right
                  (1, -1)]         # diagonal, down-left
    sequences = 0

    for r in 0 .. N-1:
        for c in 0 .. N-1:
            letter = dna[r][c]
            for (dr, dc) in directions:
                # skip if there is no room for a 4-run in this direction
                # (a >=4 run's start always has 4 cells ahead, so this misses nothing)
                if not inBounds(r + 3*dr, c + 3*dc, N):
                    continue

                # only start counting at the beginning of a run
                pr, pc = r - dr, c - dc
                if inBounds(pr, pc, N) and dna[pr][pc] == letter:
                    continue

                # measure the run length forward from here
                length = 1
                nr, nc = r + dr, c + dc
                while inBounds(nr, nc, N) and dna[nr][nc] == letter:
                    length += 1
                    nr, nc = nr + dr, nc + dc

                if length >= 4:
                    sequences += 1
                    if sequences == 2:
                        return true    # two is enough, stop

    return false
```

**Complexity:** O(N^2) time, O(1) extra space. This is optimal: confirming a
non-mutant requires reading essentially every cell. Alternatives (line
decomposition, run-length DP, regex per line, bitboards) are all O(N^2) too and
differ only in constant factor and clarity; the direct scan is chosen for being
the simplest with a clean early-exit.

**Edge cases:**

- `N < 4`: no sequence is possible, so it returns `false`.
- Input is **normalised** (uppercased) and validated at the API layer; the pure
  function assumes a well-formed `N x N` grid of `A/T/C/G`. Malformed input
  (non-square, characters outside `ATCG`, empty) is rejected there with a `400`.

### API

**`POST /mutant/`**

- Request: `{ "dna": ["ATGCGA", ...] }`, `Content-Type: application/json`.
- Responses: `200` mutant, `403` not mutant, `400` malformed, with a small body
  `{ "isMutant": true|false }`. The status code is the contract; the body is a
  convenience for the frontend.
- Persistence: a record is written on `200` and `403` only; a `400` writes
  nothing.
- Note: the spec repurposes `403` to mean "not a mutant" rather than its usual
  "forbidden". If auth were ever added, auth failures would use `401`, keeping
  `403` for the spec's meaning.

**`GET /stats/`**

- Response `200`: `{ "count_mutant_dna", "count_human_dna", "ratio" }`.
- Served from the in-memory counters (O(1)); `ratio = mutant / human`, and `0`
  when there are no humans.
- Freshness is exposed via HTTP headers (`Last-Modified`, `Cache-Control:
  max-age=1`, `Age`), not the body, so the body stays exactly the spec's three
  fields. Stats are eventually consistent with bounded staleness (about one
  second) in the deployed config, and effectively live when run locally.

**Validation and normalisation**

- Normalise: uppercase the input.
- Reject as `400`: missing `dna`, not a non-empty array of strings, any string
  whose length differs from the array length (`N x N`), any character outside
  `A/T/C/G`, a grid larger than a max size cap (guards oversized-grid abuse), or
  a body over the size limit.
- `N < 4` is valid DNA and returns `403` (not a mutant), not `400`.

**Cross-cutting, implemented**

- Backpressure / load-shedding: `503` when the write queue is full. Protects the
  system; distinct from per-client rate limiting.
- CORS for the frontend origin.
- Security headers (`@fastify/helmet`).
- `GET /health` for readiness / liveness.
- Structured logging (pino, built into Fastify), sampled at high volume.
- Consistent error body `{ error, message }` for all `400`s.

**Cross-cutting, documented (production only)**

- Auth (API key / JWT): not in the spec, and this is a public utility. Would use
  `401` so `403` stays "not mutant".
- Per-client rate limiting at the gateway, keyed per client. In tension with the
  "absorb 100 to 1M req/s" goal if applied naively, so it belongs at the edge and
  tuned, not as a blanket cap.

### Database

Two tables: an append-only record store and a materialised counters row.

**`dna_records`** (source of truth, append-only)

```
id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
dna         TEXT NOT NULL          -- normalised rows joined by newline
is_mutant   BOOLEAN NOT NULL
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

- `BIGINT` id (monotonic, index-friendly) over a random UUID.
- No unique constraint on `dna`: append-only, per the "one row per submission"
  reading of "1 record per DNA".
- Primary key only; minimal indexing to protect write throughput.

**`dna_stats`** (materialised counters, single row)

```
id            BOOLEAN PRIMARY KEY DEFAULT true CHECK (id)  -- exactly one row
count_mutant  BIGINT NOT NULL DEFAULT 0
count_human   BIGINT NOT NULL DEFAULT 0
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```

- `BIGINT` counters (overflow-safe at high volume).
- Updated **once per batch, in the same transaction** as the record inserts, so
  it stays exactly consistent with durably-written rows.
- Loaded into the in-memory counters on **boot**, so restart is O(1) rather than
  a full `COUNT(*)`.
- `updated_at` is set on each update and surfaced as the stats `Last-Modified`.
- Hot-row caveat: a single counter row serialises writes. Mitigated by updating
  once per batch (not per request), and in the deployed design by moving the
  shared counters to Redis (`INCR`).

**Ratio function** (canonical definition, in SQL)

```sql
CREATE OR REPLACE FUNCTION dna_ratio(mutant BIGINT, human BIGINT)
RETURNS NUMERIC AS $$
  SELECT CASE WHEN human = 0 THEN 0
              ELSE ROUND(mutant::numeric / human, 4)
         END;
$$ LANGUAGE sql IMMUTABLE;
```

- Pure and `IMMUTABLE`; div-by-zero returns `0`.
- The ratio is **never stored** (derived, to avoid staleness). This function is
  the reference; the in-memory fast path mirrors the same rule.

**Access layer and setup**

- A lightweight client (`postgres.js` / `pg`), not an ORM, for direct control of
  multi-row batch `INSERT` and the transactional counter update.
- Schema ships as `schema.sql` (both tables, the function, and a seed of the one
  `dna_stats` row), applied via `npm run db:setup` and documented in How to Run.
- Optional fallback: a pre-provisioned cloud Postgres with the schema already
  applied, for anyone who prefers not to install Postgres locally. Kept optional
  because it adds an external dependency and a shared write DB.

### Frontend

A single Next.js page to input DNA, submit it, and show the result. Visual design
uses the `frontend-design` / `ui-ux-pro-max` skills for a clean, professional
theme.

**Input, three modes over one grid model:**

- **Grid entry:** an `N x N` grid of single-character cells constrained to
  `A/T/C/G`, with a size control for `N`.
- **Paste:** a textarea that parses pasted DNA (newline-separated rows or a JSON
  array) into the grid.
- **Random generation:** fills the grid with a valid random sequence, optionally
  biased to sometimes produce a mutant for a satisfying demo.
- All three converge on one grid state, then submit.

**API access:**

- The browser calls same-origin `/api/*` (Next.js), which forwards to the Fastify
  backend. Implemented as **route handlers** (not just rewrites) so the `/api`
  layer can do a fast client-facing validation pass and response shaping.
- Validation therefore exists in three places (grid UI, `/api` layer, Fastify).
  **Fastify remains the authoritative validator**; the other two are for fast
  feedback and rejection only.

**Validation:** client-side (valid letters, square, `N` in range) for instant
feedback, with the API as source of truth. Handles the response contract: `200`
mutant, `403` not, `400` invalid.

### Testing

Vitest across both apps, targeting **> 80% coverage** in a test-pyramid shape,
owned by the `test-author` agent.

**Backend:**

- **Unit (algorithm):** the mutant example, a clear non-mutant, the one-sequence
  boundary (false), all four directions, a long run counted once, `N < 4`, and
  normalisation / validation cases.
- **Integration (API):** the `200` / `403` / `400` paths, a record written on
  200/403 but not 400, and `/stats/` counts and ratio (including `ratio: 0` with
  no humans).
- **Queue:** batched flush occurs, backpressure sheds load (`503`) when full, and
  counters stay consistent with accepted requests.
- **DB isolation:** a dedicated local test database with transaction rollback or
  truncate between tests, for deterministic, independent runs.

**Frontend:**

- **Component / unit:** Vitest + React Testing Library + happy-dom, with **MSW**
  mocking the `/api` calls. Covers grid entry, paste parsing, random generation,
  validation messages, and result rendering per response code.
- The Next `/api` route handlers get their own unit tests (validation and
  forwarding, downstream mocked).
- **E2E:** a few Playwright smokes (happy path plus a validation-error path) for
  whole-flow confidence, not for coverage.

### Observability

Discussion and documentation only, beyond a basic local demonstration.

The key inversion for high throughput: **metrics are primary, logs are sampled
and secondary.** Logs scale with request volume (1M req/s means 1M lines/s, which
is unmanageable), while metrics scale with the bounded number of series.

- **Logging:** sample successful requests aggressively but keep **all errors**;
  structured JSON via pino, written async off the hot path; log metadata (size,
  result, latency, status, correlation id), **never the full DNA payload**; ship
  to a central store in production rather than blocking on I/O.
- **Metrics:** aggregate in-process and expose a Prometheus `/metrics` endpoint
  (O(1) per scrape). Counters (requests, mutants, humans, errors), histograms
  (latency p50/p95/p99), gauges (queue depth, buffer fill, in-flight). The
  load-bearing ones here: queue depth / buffer fill, the `503` load-shedding
  rate, and batch flush size / DB write latency. Keep label cardinality bounded
  (endpoint, status); never label with DNA or request id. The mutant/human
  counters already double as metrics.
- **Tracing:** optional, OpenTelemetry with heavy sampling in the deployed config.

Locally we could expose a simple `/metrics` with a few counters and a latency
histogram; the full stack (Prometheus + Grafana + log aggregation + tracing) is a
documented production concern.

### Repository and setup

**Turborepo monorepo.** One repo holds both apps and shared code, so a single
install and a single `dev` command run everything, with Turbo caching
build/test/lint across packages.

```
rif/
  apps/
    api/         Fastify backend
    web/         Next.js frontend
  packages/
    shared/      shared TypeScript types and validation helpers
  schema.sql     tables, dna_ratio function, seed stats row
  turbo.json
  package.json   workspaces + root scripts
  .env.example
```

- **Package manager: pnpm via corepack** (`corepack enable`), so no global
  install is needed; the idiomatic Turborepo pairing.
- **`packages/shared`** holds the request/response types and light validation
  helpers used by both the API and the frontend, so the contract lives in one
  place.

**Environment variables** (documented in `.env.example`):

- API: `API_PORT`, `DATABASE_URL`, `NODE_ENV`, `MAX_GRID_SIZE`, `QUEUE_MAX_SIZE`,
  `BATCH_SIZE`, `BATCH_INTERVAL_MS`, `LOG_LEVEL`, `LOG_SAMPLE_RATE`.
- Web: `WEB_PORT`, `BACKEND_URL` (server-side only, used by the `/api` route
  handlers to forward to Fastify).

Full diagrams are in [ARCHITECTURE.md](ARCHITECTURE.md); the phased build plan
with agent delegation is in [PLAN.md](PLAN.md).
