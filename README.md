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

_To be written once the implementation is underway._

---

## Development Log

### Approach

Plan before building. With AI-assisted development the leverage is in planning
and fast iteration, so we settle decisions and design up front, then execute
quickly against a clear plan.

**Algorithmic framing.** The mutant check is Connect Four's win condition, not
tic-tac-toe: we slide a length-4 window across an arbitrary `N x N` grid in four
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
- **Frontend:** Next.js. Slightly heavy for a single input page, but it gives us
  a fast, well-understood React setup with good tooling.
- **Backend:** a dedicated Node/TypeScript API service (framework and database
  under Backend and data, below).

### Backend and data

- **Framework:** Fastify. Fast, first-class TypeScript, and built-in JSON-schema
  validation, which we want anyway to validate the `dna` payload and return clean
  `400`s (distinct from the spec's `403` for a valid-but-non-mutant DNA).
- **Database:** PostgreSQL. Records are stored as **append-only rows**
  `(id, dna, is_mutant, created_at)`.
- **Interpretation of "1 record per DNA":** the spec line is ambiguous. We read
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
of thousands per process. So we build the correct patterns locally and document
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
  queue for a durable shared queue (Redis Stream / Kafka), run stateless API
  instances behind a load balancer, use Redis for shared stats counters, and
  shard Postgres (by DNA hash) for durable write throughput. A load balancer
  scales the app tier; the data tier scales separately via batching, the queue,
  and sharding.
