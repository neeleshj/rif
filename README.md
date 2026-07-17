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
  - [Build](#build)

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

- [x] **1. Algorithm:** `isMutant` in `apps/api/src/algorithm`, O(N^2) with
      early-exit at the second sequence.
- [x] **2. REST API:** `POST /mutant/` (Fastify): 200 mutant, 403 evaluable but
      not a mutant, 400 not evaluable, each with a message explaining itself.
- [x] **3. Database:** PostgreSQL, append-only `dna_records` plus materialised
      `dna_stats`.
- [x] **4. Stats endpoint:** `GET /stats/` returning the counts and ratio from
      maintained counters.
- [x] **5. Scalability:** queue + batched writes and cached-counter reads built
      locally; the 100 to 1M req/s path is designed and documented (not deployed).
- [x] **6. Automated tests:** Vitest, 265 tests. `apps/api` 94.25%, `apps/web`
      98.45%, `packages/shared` 100%, with the thresholds enforced rather than
      only reported.
- [x] **7. Frontend:** Next.js console with grid, paste, random, and bulk-generate
      input modes.
- [x] **8. Architecture diagram:** see [ARCHITECTURE.md](ARCHITECTURE.md).
- [x] **9. README:** run instructions below; this file is also the dev log.

---

## How to Run

**Prerequisites:** Node 20+ and PostgreSQL 14+ (or a cloud connection string).
npm ships with Node, so there is nothing else to install.

```bash
# 1. Install all workspaces
npm install

# 2. Configure environment
cp .env.example .env
#    then set DATABASE_URL (and any overrides) in .env

# 3. Create the schema (tables, dna_ratio function, seed row)
npm run db:setup

# 4. Run everything (API on :3001, web on :3000)
npm run dev
```

Other scripts: `npm test` (all tests with coverage), `npm run build`,
`npm run lint`, `npm run typecheck`.

**Testing the API directly:** import
`postman/RIF-Mutant-Detector.postman_collection.json` into Postman and hit Run.
It covers every endpoint and the whole error contract, and each request asserts
its expected status and body. It also runs headless:

```bash
npx newman run postman/RIF-Mutant-Detector.postman_collection.json
```

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
   stays fast and correct. The counter is briefly ahead of durable rows until the
   batch commits, the same eventual-consistency trade.
6. **Reconcile on a failed flush:** enqueue-time counting has a sharp edge I did
   not think through at first. If a batch fails to commit (Postgres restarts, the
   connection drops), the batch is already spliced out of the buffer and lost, but
   those records were counted. The counter would then stay permanently ahead of
   what is durable, and `/stats/` would over-report until the next restart, at
   which point `counters.load()` re-seeds from `dna_stats` and the numbers
   visibly *decrease*. Silent over-reporting that resolves as a jump backwards is
   worse than either failure alone. So a dropped batch now rolls its mutant/human
   tally back out of the counters and logs the reconcile. I kept the enqueue-time
   increment: it is the whole point of the fast path. Only the failure path
   reconciles. I deliberately do **not** re-buffer the failed batch: a persistent
   failure would then grow the buffer without bound, defeating the very cap that
   makes load shedding work. The batch stays lost (at-most-once), and the counters
   now tell the truth about that. The queue reports the dropped tally through an
   `onFlushFailure` callback rather than importing the counters, so it stays free
   of any stats dependency.

The queue sits behind a small interface (`enqueue()` / a worker that drains), so
the local in-process implementation swaps cleanly for a durable, shared one.

**Measured, not just claimed.** Rather than assert the design works, I load
tested both paths against a single local instance.

**Write path** (`POST /mutant/`, 50 connections, 20s, every request persists a row):

| Metric | Result |
| ------ | ------ |
| Throughput | **23,453 req/s** average (p97.5 25,295, min 17,903) |
| Latency | p50 **1 ms**, p97.5 **3 ms**, p99 **4 ms** (avg 1.55 ms) |
| Volume | **469,060** requests in 20.01s, 460 MB read |
| Errors | **0** shed (503), **0** 4xx |

**Read path** (`GET /stats/`, 100 connections at pipelining 10, 15s):

| Metric | Result |
| ------ | ------ |
| Throughput | **39,245 req/s** average (p97.5 40,031, min 36,261) |
| Latency | p50 **19 ms**, p97.5 **46 ms**, p99 **49 ms** (avg 24.96 ms) |
| Volume | **590,000** requests in 15.02s, 603 MB read |

The interesting number on the write path is not the throughput, it is the **flat
latency**. Nearly half a million writes went through at a p99 of 4 ms, because
the request never waits on Postgres: it computes the result, enqueues, and acks,
while the batch worker persists in the background. Ack latency is decoupled from
database write throughput, which is the whole point of the queue.

Reads out-throughput writes by about **1.7x** (39.2k vs 23.5k req/s), which is
the expected shape: `/stats/` answers from the in-memory counters and never
touches the database, so it is bounded by CPU rather than by durable writes.

**The two latency figures are not comparable, and it would be misleading to read
them as reads being slower.** The runs use deliberately different load shapes:
the write test holds 50 requests in flight (50 connections, no pipelining), while
the read test holds roughly 1,000 (100 connections at pipelining 10). Pipelining
buys throughput by queueing requests, and queueing shows up as per-request
latency. The read path's higher latency is that trade, not a slower endpoint.

Zero load shedding in that first run is expected rather than lucky: at 50
requests in flight the accept rate never outruns the flush rate, so the buffer
never fills and nothing needs shedding. To see backpressure, it has to be
provoked.

**Saturation** (`npm run mutant:saturate`: 200 connections at pipelining 10,
about 2,000 in flight, 15s):

| Metric | Result |
| ------ | ------ |
| Accepted (2xx) | **115,000** |
| Shed (503) | **268,187** |
| 4xx | **0** |
| Throughput | **25,545 req/s** average, sustained throughout |
| Latency | p50 **69 ms**, p99 **147 ms** (max 5,194 ms) |

This is the design working, not failing. The arithmetic says why: the API accepts
at roughly 25.5k/s while the worker flushes durably at `BATCH_SIZE` /
`BATCH_INTERVAL_MS` = 500 per 100ms = **5k/s**. The buffer fills at ~20k/s net,
so a 100,000-slot queue saturates in about five seconds, and everything beyond it
is shed. The service **absorbed what it could durably persist, rejected the rest
with 503, kept serving at 25.5k req/s, and never grew memory until it died**.
That is the whole purpose of a bounded buffer: fail predictably at the edge
rather than collapse in the middle.

The tail is honest too: a 5.2s max latency shows queueing under heavy contention,
which is exactly what the p99 of 147ms at 2,000 in flight implies.

A non-zero 503 count here is healthy behaviour, which is why the metrics count
shed load (`rif_load_shed_total`) separately from real errors
(`rif_errors_total`). Conflating them would make correct backpressure fire an
error-rate alert.

Scripts and a guide to reading the output are in [load/README.md](load/README.md).

**Local vs deployed:**

- **Local (built):** in-process bounded queue, single Fastify instance, Postgres.
  Measured above: flat ack latency and a bounded DB write rate while the buffer
  absorbs the burst.
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

- **`fastify-api`**: the backend: Fastify routing and schema validation, the
  Postgres data layer, and the queue, batch worker, and counters. Owns the error
  contract (400 for malformed input, 403 for valid-but-non-mutant).
- **`nextjs-frontend`**: the Next.js DNA-input page and API calls. Delegates
  visual/UX work to the existing design skills.
- **`test-author`**: Vitest unit and integration tests, targeting >80% coverage,
  biased toward the algorithm edge cases.
- **`performance`**: load testing (autocannon), queue backpressure checks,
  and Lighthouse on the frontend.

**Reused, not rebuilt:**

- **UX/UI**: the existing `frontend-design` and `ui-ux-pro-max` skills, invoked
  by `nextjs-frontend`.
- **Review**: the `code-reviewer` agent and the `setup-code-review` post-commit
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

- `N < 4`: no sequence is possible, so the pure function returns `false`. It
  keeps this guard so it stays total for any `N x N` input, but in practice the
  API layer rejects a sub-4 grid with a `400` before it ever reaches here (see
  the API section for that interpretation). The guard is the algorithm's
  business; the HTTP meaning is the route's.
- Input is **normalised** (uppercased) and validated at the API layer; the pure
  function assumes a well-formed `N x N` grid of `A/T/C/G`. Input that cannot be
  evaluated (non-square, characters outside `ATCG`, empty, or smaller than
  `4x4`) is rejected there with a `400`.

### API

**`POST /mutant/`**

- Request: `{ "dna": ["ATGCGA", ...] }`, `Content-Type: application/json`.
- Responses: `200` mutant, `403` not mutant, `400` malformed or not evaluable,
  with a small body `{ "isMutant": true|false, "message": "..." }`. The status
  code is the contract; the body is a convenience for the frontend.
- Persistence: a record is written on `200` and `403` only; a `400` writes
  nothing.
- Note: the spec repurposes `403` to mean "not a mutant" rather than its usual
  "forbidden". If auth were ever added, auth failures would use `401`, keeping
  `403` for the spec's meaning.

**Every response explains itself**

I added a `message` field to the `200` and `403` bodies, matching the `message`
the `400`s already returned. Previously a non-mutant returned a bare
`{ "isMutant": false }`, which is correct but uninformative: "I evaluated this
and found fewer than two sequences" and "this grid could never contain a
sequence" produced an identical body. Each outcome now carries its own accurate
message, and `isMutant` is unchanged, so the addition is purely additive for
clients.

**Interpretation: a grid smaller than 4x4 is a `400`, not a `403`**

I read a sub-4 grid as a client error rather than "not a mutant", in the same
spirit as the "1 record per DNA" reading:

- A grid below `4x4` cannot contain a sequence of four, so it cannot be
  meaningfully evaluated against the rule at all. Reporting "not a mutant" for
  an input that was never evaluable is less informative than saying why.
- A `403` persists the record, which would inflate `count_human_dna` with
  inputs that were never evaluated, polluting the stats. A `400` writes nothing
  and keeps the counters meaningful.

The honest caveat: the spec defines the input as an `N x N` table and sets no
minimum for `N`, so this is my reading rather than something the spec mandates.
A reviewer who reads the spec strictly would expect `403` here.

The rule lives in `packages/shared` (`validateDna`, with a `MIN_GRID_SIZE`
constant beside the `maxGridSize` cap rather than a magic number), so the API
and the frontend share one contract definition. `403` therefore now has exactly
one meaning: evaluable DNA with fewer than two sequences.

**`GET /health`**

- Response `200`: `{ "status": "ok", "checks": { "database": "ok" } }`.
- Response `503`: `{ "status": "error", "checks": { "database": "error" } }`.

It started as a probe that returned `200` whenever the process was alive, which
made it useless as a load-balancer probe: the API would report healthy with a
dead database, so the balancer would keep routing traffic to an instance that
could not serve it. It now verifies the one dependency the API has with a cheap
`SELECT 1`, reports each check by name, and answers `503` rather than a raw
`500` when the database is unreachable. The query is raced against a short
timeout (1s), so a hung database fails the probe fast instead of hanging it,
which is the failure mode that actually hurts: a probe that never answers ties
up the balancer's check slots.

On liveness vs readiness: strictly these are different questions, and this
endpoint answers both. Liveness asks "is this process broken, should I restart
it?" and should **not** check dependencies, because a dead database is not a
reason to kill an otherwise healthy process (it would restart every instance
during a database blip, adding a thundering herd to an outage). Readiness asks
"can this instance serve traffic right now?" and **should** check dependencies.
A single dependency-checking `/health` is the pragmatic choice for a local,
single-process project. A production setup would split them: `/health` for
liveness (process-only, no dependency checks) and `/ready` for readiness (the
`SELECT 1`), with the orchestrator restarting on the former and pulling
instances out of the load-balancer pool on the latter.

Worth noting what I found while exercising this: if the database is already
unreachable at boot, the process never starts serving at all, because the
counters load from Postgres before `listen`. So the `503` path only applies to a
database that dies underneath a running API, which is exactly the case a
readiness probe exists to catch. I verified it against a running instance by
proxying the connection and killing the proxy mid-flight.

**`GET /stats/`**

- Response `200`: `{ "count_mutant_dna", "count_human_dna", "ratio" }`.
- Served from the in-memory counters (O(1)); `ratio = mutant / human`, and `0`
  when there are no humans.
- **On `ratio: 0` with zero humans.** This is a deliberate choice with a real
  trade-off, so I want to state it plainly rather than let it read as an
  oversight. `mutant / 0` has no meaningful value, and the spec fixes `ratio` as
  a number, so the alternatives were `null` (off-contract), `Infinity` (not valid
  JSON), or `0`. I chose `0`. The cost: `0` is ambiguous. "100 mutants and no
  humans" and "no mutants at all" both report `ratio: 0`, and a client cannot
  tell them apart from the ratio alone. I accept that because the two counts sit
  right beside it in the same response, so the disambiguating information is
  never actually missing: `count_mutant_dna` separates the two cases exactly. The
  ambiguity is confined to one field of a response that already carries the
  answer. `dna_ratio()` in SQL returns `0` for the same input, so the API and the
  database agree on the edge case.
- Freshness is exposed via HTTP headers (`Last-Modified`, `Cache-Control:
  max-age=1`, `Age`), not the body, so the body stays exactly the spec's three
  fields. Stats are eventually consistent with bounded staleness (about one
  second) in the deployed config, and effectively live when run locally.

**Validation and normalisation**

- Normalise: uppercase the input.
- Reject as `400`: missing `dna`, not a non-empty array of strings, any string
  whose length differs from the array length (`N x N`), any character outside
  `A/T/C/G`, a grid smaller than `MIN_GRID_SIZE` (`4`, see the interpretation
  above), a grid larger than a max size cap (guards oversized-grid abuse), or a
  body over the size limit.
- Gate order matters: the size bounds are checked before squareness, so a `2x2`
  input reports "too small" rather than a misleading squareness error.

**Cross-cutting, implemented**

- Backpressure / load-shedding: `503` when the write queue is full. Protects the
  system; distinct from per-client rate limiting.
- CORS for the frontend origin.
- Security headers (`@fastify/helmet`).
- `GET /health` for readiness / liveness, checking its dependencies (below).
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

**The coverage bar is enforced, not aspirational.** I had configured coverage
reporters but no thresholds, so the number was only ever *printed*. Coverage
could have rotted to 60% and `npm test` would still have exited `0`, quietly
failing a requirement the spec states outright. A bar nobody enforces is a
comment. The API config now sets real `thresholds`, so the suite fails below
them. I set them just under the current actuals (about 94% statements) rather
than at the 80% floor: pinning to the floor would license a 14-point silent
slide back down. I proved the failure is real by breaching a threshold
deliberately and watching the run exit non-zero with all 80 tests still passing.

**Backend:**

- **Unit (algorithm):** the mutant example, a clear non-mutant, the one-sequence
  boundary (false), all four directions, a long run counted once, `N < 4`, and
  normalisation / validation cases.
- **Integration (API):** the `200` / `403` / `400` paths (including a sub-4 grid
  as a `400` that writes nothing), the explanatory `message` on each outcome, a
  record written on 200/403 but not 400, `/health` on both the ok and the
  database-down path, and `/stats/` counts and ratio (including `ratio: 0` with
  no humans).
- **Queue:** batched flush occurs, backpressure sheds load (`503`) when full, and
  counters stay consistent with accepted requests. A failed flush drops its batch
  and rolls the counters back, so `/stats/` never reports more than is durable;
  the load-bearing test drives that end to end through `buildServer`.
- **Metrics:** a queue-full `503` increments `rif_load_shed_total` and leaves
  `rif_errors_total` at zero, while a genuine `5xx` (including a `503` from
  `/health` on a dead database) still counts as an error.
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

**Measured** (`npm test`):

| Package | Tests | Statements | Branches | Functions |
| ------- | ----: | ---------: | -------: | --------: |
| `packages/shared` | 15 | 100% | 100% | 100% |
| `apps/api` | 80 | 94.25% | 97.35% | 94.87% |
| `apps/web` | 170 | 98.45% | 97.17% | 96.92% |
| **Total** | **265** | | | |

All comfortably past the spec's 80% bar, but the headline percentage is the least
interesting part. **Every module carrying real logic is at 100%**: `isMutant`,
`writeQueue`, `counters`, all three routes, `config`, and `env`. The shortfall is
concentrated in bootstrap and glue, which is the right shape. 94% spread evenly,
with holes in the algorithm, would be a far worse result than 94% with the
algorithm at 100%.

The thresholds are **enforced rather than reported**: vitest fails the run when
coverage drops below them, so it cannot quietly regress. Reporting alone would
have let the spec's requirement rot silently.

What is deliberately uncovered, and why:

- **`apps/api/src/index.ts` (65%)**: the `start()` bootstrap, `listen`, and
  SIGTERM path. Covering it means binding a port and killing a process, so it is
  verified by running the app instead. `buildServer`, which holds the logic, is
  dependency-injected and fully covered.
- **`apps/web/lib/grid.ts` line 196**: the run-free fill's abandon-and-retry
  branch. It needs four different three-in-a-rows of distinct bases converging on
  one cell, roughly 1 grid in 5,000 at `n=12`. It is reachable, so the code
  handles it, but no seed in 1,800 attempts hit it; `blockedBases` is tested
  directly instead.
- **`apps/api/src/db/client.ts` (50% funcs)**: a thin connection factory.

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

Locally I expose a simple `GET /metrics` as a demonstration of this: a Prometheus
text endpoint with a latency histogram (`rif_request_duration_seconds` by route),
counters (`rif_requests_total` labelled by route and status, plus
`rif_mutant_total` / `rif_human_total` / `rif_errors_total` /
`rif_load_shed_total`), and gauges for the two load-bearing signals,
`rif_queue_depth` and `rif_buffer_fill_ratio` (the buffer fill approaching `1.0`
is the onset of `503` load shedding).

**Shed load is not an error.** I originally counted every `5xx` into
`rif_errors_total`, which quietly contradicted my own stance elsewhere in this
log: the `503` from a full write queue is the system working as designed, not a
fault. As written, any error-rate alert would fire precisely when backpressure
was working correctly, which is the fastest way to teach a team to ignore the
alert. The write path's `503` now increments its own `rif_load_shed_total`, so
shed load stays fully observable without being mistaken for a server fault, and
`rif_errors_total` means what its name says. The split is deliberately narrow: a
`503` from `/health` means the database is unreachable, which *is* a real fault
and still counts as an error. Both counters are unlabelled, so this costs two
series and no cardinality. This also lines up the backend with the frontend,
where `bulk.ts` already tallied `503` separately from errors. Timing is
wired through a Fastify `onRequest` / `onResponse` hook, and labels are kept to
`route` (the matched route pattern) and `status` only, never DNA or ids, so the
series count stays bounded at any request volume. I added `prom-client` for this:
it is the idiomatic, lightweight way to aggregate metrics in-process for a Node
service and render Prometheus text, with no framework baggage. The full stack
(Prometheus + Grafana + log aggregation + tracing) remains a documented
production concern. Load scripts that exercise these paths live in `load/`.

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

- **Package manager: npm workspaces.** npm ships with Node, so there is no extra
  tooling to install. Chosen over pnpm to keep setup friction minimal for a
  reviewer who may not have pnpm or corepack configured.
- **`packages/shared`** holds the request/response types and light validation
  helpers used by both the API and the frontend, so the contract lives in one
  place.

**Environment variables** (documented in `.env.example`):

- API: `API_PORT`, `DATABASE_URL`, `NODE_ENV`, `MAX_GRID_SIZE`, `QUEUE_MAX_SIZE`,
  `BATCH_SIZE`, `BATCH_INTERVAL_MS`, `LOG_LEVEL`, `LOG_SAMPLE_RATE`.
- Web: `BACKEND_URL` (server-side only, used by the `/api` route handlers to
  forward to Fastify). The web port is Next's default 3000; to change it set
  `PORT` in the shell, not in `.env`, since Next reads the port before `.env`
  loads.

**Loading the root `.env` (`dotenv`).** I kept the single repo-root `.env` as the
one place a reviewer configures, which is deliberate: two apps, one file to edit.
Nothing actually loaded it, though, so the documented setup path was broken.
`npm run db:setup` failed with "Missing required environment variable
DATABASE_URL" because npm runs workspace scripts with cwd `apps/api`, and Next
auto-loads `.env` only from `apps/web`, not the monorepo root, so `BACKEND_URL`
was undefined for the server-side route handlers too. Both apps now load the root
file explicitly, which is why I added `dotenv`, the one new dependency here. I
resolve the path from the module's own URL rather than cwd, so it holds whether
the API runs from `src` under tsx or from the built `dist`. Node's native
`--env-file` would have avoided the dependency, but it needs Node 20.6+ and would
have to work through tsx and Next alike, so dotenv was the safer choice. Real
environment variables still win over file values, keeping CI and shell overrides
working.

**Turbo and the environment.** Turborepo does not read `.env` files, so the
in-process loading above is what makes config work. Turbo 2 defaults to strict
env mode, though, so I declared the project's variables in `globalEnv` for tasks
to inherit them when they are set in the real environment, and listed the root
`.env` in `globalDependencies` so editing config invalidates the cache instead of
serving a stale build or test result.

Exercising the setup path end to end turned up two more breakages in it. Turbo
2.10 refuses to resolve the workspace without a `packageManager` field in the
root `package.json`, so every `turbo` script, including the documented
`npm run dev`, failed before it started; I pinned `npm@10.9.0`, matching the npm
that ships with Node 22. And `npm test` exited non-zero because `packages/shared`
had no test files and `vitest run` treats that as a failure.

**Package manager: npm over pnpm.** I originally reached for pnpm, the idiomatic
Turborepo pairing, but switched. pnpm needs `corepack enable` or a global install
as a prerequisite, and the broken corepack on my machine proved the point: for a
test whose whole value is that a reviewer can clone and run it, one fewer setup
step wins. npm ships with Node and npm workspaces cover everything needed here.

**Fixes from running the documented commands.** Continuing to exercise each
command a reviewer might type turned up four more issues, none of which tests or
typecheck could have caught:

- `npm run lint` failed because `packages/shared` had a `lint` script but no
  ESLint config and no ESLint dependency, so it was never functional. Removed it,
  matching `apps/api`, which also has none. Linting therefore covers the Next app
  (via `eslint-config-next`), with strict TypeScript carrying the rest. Adding
  full ESLint across every package is a reasonable follow-up.
- `npm start -w @rif/api` crashed: `@rif/shared` shipped raw TypeScript, so plain
  node could not import it and the built artifact was unrunnable even though
  `npm run build` passed. `@rif/shared` is now compiled (`tsc` to `dist`, with
  `exports` pointing at the built output and a `prepare` script so `npm install`
  builds it automatically). `turbo`'s `dev` task now also `dependsOn: ["^build"]`.
- `WEB_PORT` never worked. `next dev -p ${WEB_PORT:-3000}` is shell expansion,
  evaluated before any config loads, so it always used 3000 while advertising
  itself as configurable. Removed rather than faked; the port is Next's default
  and `PORT` in the shell overrides it.
- Test files were not typechecked (`tsconfig.json` included only `src`). Split
  into `tsconfig.json` (src + test, for typecheck and the editor) and
  `tsconfig.build.json` (src only, so tests stay out of `dist`).

`packages/shared` now has its own tests for the validation helpers, so
`--passWithNoTests` is gone. Writing them promptly repaid the effort: the suite
immediately caught a bad test of mine.

**API collection.** `postman/` holds an importable Postman collection covering
every endpoint and the full error contract, with assertions on each request so it
can be run as a suite (also runnable headless via
`npx newman run postman/RIF-Mutant-Detector.postman_collection.json`).

Full diagrams are in [ARCHITECTURE.md](ARCHITECTURE.md); the phased build plan
with agent delegation is in [PLAN.md](PLAN.md).

### Build

The build followed [PLAN.md](PLAN.md), with the main agent scaffolding and
coordinating and each phase delegated to its sub-agent (as defined in
`.claude/agents/`), consistent with the working model.

**What was built:**

- **`apps/api`** (Fastify): the pure `isMutant` algorithm, the postgres.js data
  layer with the batched-insert-plus-counter transaction, the bounded write queue
  with backpressure and SIGTERM drain, the `/mutant/`, `/stats/`, `/health`, and
  `/metrics` routes, normalisation/validation, CORS, helmet, and sampled logging.
- **`apps/web`** (Next.js): a single console page with the grid, paste, and random
  input modes over one grid state, the `/api` route handlers forwarding to the
  backend, client-side validation, and an accessible themed UI.
- **`packages/shared`**: the request/response contract and validation helpers used
  by both sides.
- **`load/`**: autocannon load scripts with a run guide.

**Verification (in this environment):**

- Backend: 59 Vitest tests, ~93% coverage; the algorithm verified against every
  spec case.
- Frontend: 87 Vitest tests, ~98% coverage; typecheck and lint clean. Playwright
  E2E specs are authored and run locally once `@playwright/test` is installed.
- Performance: the real server (against an in-memory DB stand-in) sustained
  ~24.5k req/s on `/mutant/` (p99 3 ms) and ~37.4k req/s on `/stats/`, and
  backpressure shed load as designed under saturation. Lighthouse: accessibility
  1.0, performance 0.75.
- Not runnable here: the DB-backed paths and full-flow load, which need a live
  PostgreSQL. The code is dependency-injected so these are covered by mocked tests
  and are straightforward to run locally per How to Run.
