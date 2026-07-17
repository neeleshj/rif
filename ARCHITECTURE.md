# Architecture

Architecture for the RIF mutant detector. Decisions and reasoning live in the
[README development log](README.md#development-log); this document is the visual
reference. Diagrams are Mermaid, so they render on GitHub and stay in version
control.

- [System overview (local)](#system-overview-local)
- [Request flow: POST /mutant/](#request-flow-post-mutant)
- [Request flow: GET /stats/](#request-flow-get-stats)
- [Next.js layers](#nextjs-layers)
- [Scaled topology (documented, not built)](#scaled-topology-documented-not-built)

---

## System overview (local)

Three components run locally: the Next.js frontend, the Fastify API, and
PostgreSQL. Writes are decoupled from the response path by an in-process queue;
stats are served from in-memory counters that are checkpointed to the database.

```mermaid
flowchart LR
    User([User / Browser])

    subgraph Web["Next.js  ·  apps/web"]
        UI["DNA input page<br/>grid · paste · random · bulk"]
        APIR["/api route handlers<br/>validate + forward"]
    end

    subgraph API["Fastify  ·  apps/api"]
        direction TB
        RT["Routes<br/>POST /mutant/ · GET /stats/<br/>GET /health · GET /metrics"]
        VAL["Normalise + validate"]
        ALG["isMutant algorithm"]
        CNT["In-memory counters"]
        Q["Bounded write queue"]
        W["Batch flush worker"]
        MET["Prometheus registry<br/>counters · histogram · gauges"]
    end

    DB[("PostgreSQL<br/>dna_records · dna_stats")]

    User --> UI --> APIR -->|HTTP| RT
    RT --> VAL --> ALG
    ALG --> CNT
    ALG --> Q
    Q --> W -->|"batched INSERT + counter update (one txn)"| DB
    W -.->|"flush failed: roll counters back"| CNT
    Q -.->|"full: 503 load shed"| RT
    RT -->|"/stats reads"| CNT
    RT -->|"/health: SELECT 1"| DB
    Q -.->|depth / fill| MET
    DB -.->|boot load| CNT
```

Notes the diagram cannot show:

- **`/health` checks its dependency.** It runs `SELECT 1` against Postgres with a
  short timeout and answers `503` when the database is unreachable, rather than
  reporting healthy because the process happens to be alive.
- **The queue is bounded.** When it fills, `POST /mutant/` sheds load with `503`
  instead of buffering until the process dies.
- **A failed flush rolls the counters back**, so `/stats/` never reports more
  than is durably stored.

---

## Request flow: POST /mutant/

Validation is authoritative in Fastify. The response returns as soon as the
result is computed and the record is enqueued; the durable write happens
asynchronously in batches, off the response path.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant N as Next /api
    participant F as Fastify /mutant/
    participant Q as Write queue
    participant W as Batch worker
    participant DB as Postgres

    B->>N: POST /api/mutant { dna }
    N->>N: fast validation
    N->>F: forward POST /mutant/
    F->>F: normalise (uppercase) + validate (authoritative)
    alt not evaluable (non-square, bad chars, empty, or N < 4)
        F-->>B: 400 + message (nothing written)
    else queue full
        F-->>B: 503 load shed (nothing written)
        Note over F: bounded buffer, so shed rather than grow until OOM
    else evaluable
        F->>F: isMutant() -> boolean
        F->>F: increment counter (in memory, at enqueue)
        F->>Q: enqueue { dna, isMutant, ts }
        F-->>B: 200 mutant / 403 not mutant, each + message
        Note over Q,W: async, off the response path
        W->>DB: batched INSERT + UPDATE dna_stats (single txn)
        opt flush fails
            W->>F: roll counters back by the dropped batch
            Note over W,F: so /stats/ never exceeds what is durable
        end
    end
```

---

## Request flow: GET /stats/

Served entirely from in-memory counters, so it never scans the records table.
Freshness is communicated through HTTP headers, keeping the body to the spec's
exact three fields.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant F as Fastify /stats/
    participant C as In-memory counters

    B->>F: GET /api/stats/
    F->>C: read count_mutant, count_human
    F->>F: ratio = dna_ratio(m, h)
    F-->>B: 200 { count_mutant_dna, count_human_dna, ratio }<br/>Cache-Control: max-age=1, Last-Modified
```

---

## Next.js layers

The three input modes converge on one grid state before submission. The browser
only ever talks to same-origin `/api/*` route handlers, which validate and
forward to the Fastify backend.

```mermaid
flowchart TB
    subgraph Client["Browser · client components"]
        G["Grid editor"]
        P["Paste parser"]
        R["Random generator"]
        ST["Grid state"]
        SUB["Submit"]
        RES["Result + stats view"]
        G --> ST
        P --> ST
        R --> ST
        ST --> SUB
    end

    subgraph Server["Next.js server"]
        H["/api/mutant · /api/stats<br/>route handlers: validate + forward"]
    end

    FB[("Fastify backend")]

    SUB -->|fetch same-origin| H
    RES -->|fetch| H
    H -->|forward| FB
```

---

## Scaled topology (documented, not built)

How the same design reaches the top of the 100 to 1M req/s range. The app tier
scales horizontally behind a load balancer; the data tier scales separately via
a durable queue, batching, and sharding. Stats reads are absorbed by a CDN and
shared counters in Redis.

```mermaid
flowchart TB
    Users(["Clients · 100 to 1M req/s"])
    CDN["CDN<br/>caches /stats · max-age=1"]
    LB["Load balancer"]

    Users --> CDN --> LB

    subgraph Tier["Stateless API instances"]
        A1["API"]
        A2["API"]
        A3["API"]
    end

    LB --> A1
    LB --> A2
    LB --> A3

    Redis[("Redis<br/>shared counters")]
    SQS[["SQS<br/>durable write queue"]]
    Workers["Batch workers"]

    subgraph PG["Sharded PostgreSQL (by DNA hash)"]
        S1[("shard 1")]
        S2[("shard 2")]
    end

    A1 --> Redis
    A2 --> Redis
    A3 --> Redis
    A1 --> SQS
    A2 --> SQS
    A3 --> SQS
    SQS --> Workers
    Workers --> S1
    Workers --> S2
```
