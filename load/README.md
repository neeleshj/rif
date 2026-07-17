# Load tests

Load scripts for the RIF mutant-detector API. They demonstrate the scalability
**patterns** from the [README dev log](../README.md#scalability), not a 1M req/s
benchmark: a single local process cannot ingest that, and it is not meant to.
The point is to show flat ack latency on the write path, a bounded DB write
rate, backpressure (`503`) under saturation, and cached O(1) reads on the stats
path, then report real local numbers.

Runner is [autocannon](https://github.com/mcollina/autocannon), one dependency,
no separate binary to install.

## Prerequisites

1. A running API with a reachable Postgres (the write path persists in batches,
   and the server loads counters from `dna_stats` on boot). From the repo root:

   ```sh
   npm run db:setup            # apply schema.sql once
   npm run dev -w @rif/api
   ```

   The API listens on `http://localhost:3001` by default. Confirm with
   `curl localhost:3001/health`.

2. Install the load deps (autocannon):

   ```sh
   cd load && npm install
   ```

## Running

From `load/`:

```sh
npm run mutant            # POST /mutant/ at a steady rate (default 50 conns, 20s)
npm run mutant:saturate   # POST /mutant/ hard, to provoke 503 load shedding
npm run stats             # GET /stats/ (default 100 conns x10 pipelining, 15s)
```

All knobs are environment variables (see the header of each script):

```sh
URL=http://localhost:3001 CONNECTIONS=100 DURATION=30 PIPELINING=10 npm run mutant
BODY=human npm run mutant     # exercise the 403 (non-mutant) path
```

Raw CLI form, without the wrapper scripts:

```sh
npx autocannon -m POST -H 'content-type=application/json' \
  -b '{"dna":["ATGCGA","CAGTGC","TTATGT","AGAAGG","CCCCTA","TCACTG"]}' \
  -c 50 -d 20 http://localhost:3001/mutant/

npx autocannon -c 100 -p 10 -d 15 http://localhost:3001/stats/
```

## What to look for

**`POST /mutant/` (write path):**

- **Flat ack latency.** The handler runs `isMutant`, enqueues, and acks; the
  durable Postgres write happens in the batched background worker. So p50/p99
  ack latency should stay low and roughly constant as the accept rate rises,
  decoupled from database write throughput.
- **Bounded DB write rate.** However hard you push, the worker flushes fixed
  batches on a fixed interval, so durable writes are capped by
  `BATCH_SIZE / BATCH_INTERVAL_MS`, not by the request rate. Watch it on the
  `/metrics` gauges (below), or in the row count of `dna_records` over time.
- **`503` under saturation.** `npm run mutant:saturate` pushes hard; with a small
  `QUEUE_MAX_SIZE` (or a slow database) the buffer fills and further writes
  return `503` rather than growing unbounded. A non-zero 503 count here is the
  correct, healthy behaviour, not a failure. To force it deterministically,
  start the API with a tiny buffer, for example `QUEUE_MAX_SIZE=500`.
- Note: a non-mutant grid answers `403` by design, which autocannon counts as
  "non-2xx". The default body is a mutant (`200`) so the output reads cleanly;
  set `BODY=human` to drive the 403 path on purpose.

**`GET /stats/` (read path):**

- **High req/s, flat low latency.** Served from the in-process counters (RAM),
  never a `COUNT(*)` or table scan, so throughput is high and latency is flat
  regardless of how many rows exist. Expect it to substantially out-throughput
  the write path.
- **`Cache-Control: max-age=1`** is set on the response. Locally there is no CDN,
  so the run shows the raw single-instance ceiling; that header is what makes a
  deployed origin see roughly one request per second per edge node.

## Watch the metrics while a test runs

The API exposes Prometheus metrics at `GET /metrics`. During a run, in another
terminal:

```sh
watch -n1 'curl -s localhost:3001/metrics | grep -E "rif_queue_depth|rif_buffer_fill_ratio|rif_requests_total|rif_(mutant|human|errors)_total"'
```

`rif_queue_depth` and `rif_buffer_fill_ratio` show the buffer filling and
draining; `rif_buffer_fill_ratio` approaching `1.0` is the onset of load
shedding. `rif_request_duration_seconds` carries the latency histogram
(p50/p95/p99 by route).

## Reaching the top of the range (documented, not run here)

A single box tops out in the tens of thousands of req/s. The design reaches the
1M req/s end of the spec by **replication**, not by one process: stateless API
instances behind a load balancer, a durable shared queue (SQS) feeding the
batched-insert worker, Redis for shared stats counters behind the CDN, and
sharded Postgres for durable write throughput. That topology is documented in
[ARCHITECTURE.md](../ARCHITECTURE.md) and the dev log; it is not provisioned in
this repo, which runs locally only.
