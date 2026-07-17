# CLAUDE.md

Project context for AI agents working in this repository. Read this before
making changes. The narrative reasoning behind these decisions lives in the
Development Log in `README.md`.

## Project

Mutant detector for the RIF technical test. A human is a mutant if their `N x N`
DNA grid contains **more than one** run of four identical letters (`A/T/C/G`)
horizontally, vertically, or diagonally. The core function is
`isMutant(String[] dna) -> boolean`, exposed over a REST API with a frontend and
a database, plus a usage-stats endpoint.

## Stack

- **Language / runtime:** Node.js with TypeScript.
- **Backend:** Fastify (`api/`).
- **Frontend:** Next.js (`web/`).
- **Database:** PostgreSQL.
- **Tests:** Vitest.
- Backend and frontend are separate apps. Folder layout is finalised when
  scaffolding; keep the two apps independent.

## Working model (delegation)

- The **main agent plans, coordinates, and maintains the `README.md` dev log.**
- **All build, test, and design work is delegated to sub-agents.** Do not
  implement features from the main agent; route them.

Sub-agents (`.claude/agents/`):

| Agent             | Use for                                                        |
| ----------------- | -------------------------------------------------------------- |
| `fastify-api`     | Backend: routes, validation, data layer, queue, counters      |
| `nextjs-frontend` | Frontend: the DNA-input page and API calls                    |
| `test-author`     | Vitest unit/integration tests, coverage                        |
| `performance`     | Load tests, backpressure checks, Lighthouse                    |

Reused tooling: `frontend-design` and `ui-ux-pro-max` skills for UX/UI (via
`nextjs-frontend`); the `code-reviewer` agent and `setup-code-review` hook for
review (part of the maintainer's existing global setup, not installed
per-project).

## Encoded decisions

- **Error contract:** `200` for a mutant. `403` for **evaluable** DNA (`N >= 4`)
  with fewer than two sequences. `400` for input that cannot be evaluated:
  non-square, characters outside `ATCG`, empty, missing, or a grid smaller than
  `4x4`. **Nothing is persisted on a `400`.** Every `/mutant/` response carries a
  `message` explaining its outcome, so a `403` says *why* it is a `403`.
- **Minimum grid size:** `N < 4` is a **`400`, not a `403`**. A sub-4 grid can
  never contain a sequence of four, so it is a client error rather than "not a
  mutant", and rejecting it keeps unevaluable input out of the stats. This is a
  deliberate reading: the spec sets no minimum for `N`. The rule lives in
  `packages/shared` (`MIN_GRID_SIZE`) so the API and frontend share one
  definition; do not hardcode `4` elsewhere.
- **Health:** `GET /health` verifies the database (`SELECT 1`, short timeout) and
  returns `503` when it is down. It does not report healthy on a dead DB.
- **Algorithm:** slide a length-4 window in four directions; **early-exit the
  moment the second sequence is found**.
- **Persistence:** append-only rows `(id, dna, is_mutant, created_at)`. "1 record
  per DNA" is read as one row per submission, not deduplication.
- **Stats:** maintained counters (no `COUNT(*)` scans). Counts reflect **total
  verifications**. `ratio = count_mutant / count_human`.
- **Scale:** decouple writes with a queue + batched flush; serve stats from
  cached counters. Details in the dev log Scalability section.

## Scope guardrails

- The project **runs locally**. Deployment is out of scope: no Docker or EC2
  provisioning, no cloud infra.
- Do not add new dependencies without a noted reason.
- Scaled/deployed topology (load balancer, SQS, Redis, sharding) is
  **documented, not built**.

## Definition of done

A change is done when its tests pass **and** the behaviour has been exercised
(run the affected flow), not merely typechecked. Use the `verify` skill.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, etc.).
  No `Co-Authored-By` trailer.
- **Writing:** no em dashes anywhere (prose, code comments, commit messages).
- **Dev log:** `README.md` is a living development log. Append significant
  decisions in first person singular ("I"), with no timestamps.
