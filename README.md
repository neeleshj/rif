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
  chosen next, under tech choice).
