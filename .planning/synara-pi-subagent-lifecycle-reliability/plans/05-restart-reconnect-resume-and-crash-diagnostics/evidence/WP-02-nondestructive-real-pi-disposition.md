# WP-02 — non-destructive controlled real-Pi disposition (Ticket 05)

**Date:** 2026-08-28
**Producer checkout:** `/Users/anhpham99/symphony` (isolated durable roots per suite; no user live-instance mutation)
**Controlled provenance:** exact PASS — see `WP-02-controlled-provider-provenance.txt` (Alfie `3fe340b4`, `@alfie/pi-subagents@0.15.0-alfie.6`, Pi SDK `0.83.0`, clean surfaces, 5/5 fixture hashes)
**Deterministic counterpart:** WP-01 evidence committed at `4090ccee8` (9 files / 118 tests, producer exit 0) — separate evidence class, never conflated below.

Evidence classes used in this disposition, kept strictly separate:

- **Deterministic (WP-01, inherited):** in-process seams, not rerun by WP-02.
- **Controlled real-Pi (this disposition):** real Pi adapter + real Alfie extension against a deterministic loopback model server, isolated roots/home/state/workspace/agent directories, run once during WP-02 execution; raw logs are the authoritative execution artifacts.
- **Environment (Bun pre-collection failure):** a producer/runtime incompatibility record, not a Ticket 05 behavior result.
- **Inherited manual destructive evidence (not rerun, not relabeled):** the accepted isolated manual zero-owned-child evidence remains inherited and reserved for its sole proof purpose per PLAN §7.

---

## Leg 1 — Restart acceptance (controlled real-Pi)

- Command: exactly the WP-02 contract command —
  `cd apps/server; ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run ../../node_modules/vitest/vitest.mjs run --project wallclock --maxWorkers=1 --no-file-parallelism src/provider/piSubagentRestartAcceptance.test.ts` with `set -o pipefail` and tee into the evidence log.
- Runner: Vitest 4.1.10 under **Bun 1.3.12** (authorized producer for this file; it does not import `node:sqlite`).
- Log: `WP-02-restart-acceptance.log` (authoritative; not overwritten).
- Result: `Test Files 1 passed (1)`, `Tests 1 passed (1)`, duration 10.74s, **producer exit 0**. Log footer binds `CANDIDATE_SHA:4090ccee8…`, `ALFIE_SHA:3fe340b4…`, `PRODUCER_EXIT:0`.
- Executed test: `"T10-AC3/AC1/AC5: a real live bridge record under the same identity refreshes observation; the no-owner view orphans; a late fenced terminal is ignored and counted"` (`piSubagentRestartAcceptance.test.ts:360`) — a real background child under real controlled Pi survives server disposal in durable truth; a fresh no-owner view reconciles it honestly; late fenced terminal evidence is ignored and counted.
- Isolation: standalone Vitest process, `--maxWorkers=1 --no-file-parallelism`, isolated durable root/home/state/workspace/agent directories, deterministic loopback model server; nothing outside the suite's temp roots was touched.

## Leg 2 — Explicit Resume acceptance (controlled real-Pi)

- Command: exactly the WP-02 contract command —
  `cd apps/server; ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run ../../node_modules/vitest/vitest.mjs run --project wallclock --maxWorkers=1 --no-file-parallelism src/provider/piSubagentResumeAcceptance.test.ts` with `set -o pipefail` and tee into the evidence log.
- Runner: Vitest 4.1.10 under **Bun 1.3.12** (authorized producer for this file; it does not import `node:sqlite`).
- Log: `WP-02-resume-acceptance.log` (authoritative; not overwritten).
- Result: `Test Files 1 passed (1)`, `Tests 1 passed (1)`, duration 4.26s, **producer exit 0**. Log footer binds `CANDIDATE_SHA:4090ccee8…`, `ALFIE_SHA:3fe340b4…`, `PRODUCER_EXIT:0`.
- Executed test: `"T14-AC1/AC4/AC6: one explicit resume creates the new child attempt under the same execution; no implicit path resumes"` (`piSubagentResumeAcceptance.test.ts:348`) — one explicit Resume over a real orphaned real-Pi execution keeps the `executionId`, creates exactly one new real child attempt, and no implicit path resumes.
- Isolation: same standalone/serialized isolation as Leg 1.

## Leg 3 — Fresh production boot on the same durable root (controlled real-Pi)

Title filter: `-t "T17 slice 4 stage 5"`; file `src/provider/piSubagentRealPiAcceptance.test.ts` (imports `DatabaseSync` from `node:sqlite` at line 53).

- **Attempt 1 (environment failure, preserved verbatim in the log):**
  - Command: the WP-02 contract command as written (Bun producer), `set -o pipefail`, tee into `WP-02-production-restart-leg.log`.
  - Runner: Vitest 4.1.10 under **Bun 1.3.12**.
  - Result: `ResolveMessage: No such built-in module: node:sqlite` at pre-collection; `Test Files 1 failed (1)`, `Tests no tests` (0 tests collected), 141ms, **producer exit 1**. Log footer binds `CANDIDATE_SHA:4090ccee8…`, `PRODUCER_EXIT:1`.
  - Classification: **environment evidence only**. Bun 1.3.12 cannot resolve Node's built-in `node:sqlite`; this is a producer incompatibility with the test file's import, NOT a Ticket 05 behavior failure. It is preserved, not relabeled.
- **Attempt 2 (supported producer, authorized by commit `d12e1a2e0`):**
  - Command: identical file/filter/isolation with the single authorized substitution `bun run` → `node` —
    `ALFIE_REPO_DIR=/Users/anhpham99/alfie node ../../node_modules/vitest/vitest.mjs run --project wallclock --maxWorkers=1 --no-file-parallelism src/provider/piSubagentRealPiAcceptance.test.ts -t "T17 slice 4 stage 5"`, `set -o pipefail`, tee appended into the same log under an explicit `--- SUPPORTED NODE PRODUCER RETRY AFTER BUN PRE-COLLECTION FAILURE ---` marker recording `RUNNER:node v24.14.1`.
  - Runner: Vitest 4.1.10 under **Node v24.14.1** (repository supported engine ≥24.10; resolves `node:sqlite`).
  - Result: `Test Files 1 passed (1)`, `Tests 1 passed | 9 skipped (10)`, duration 12.18s, **producer exit 0**. Log footer binds `SUPPORTED_PRODUCER_CANDIDATE_SHA:d12e1a2e0…`, `ALFIE_SHA:3fe340b4…`, `SUPPORTED_PRODUCER_EXIT:0`.
  - Only this Node producer supplies behavioral evidence for Leg 3.
- Executed test: `"T17 slice 4 stage 5: a fresh production WS boot on the same durable root reconciles one real nonterminal child honestly and does not auto-replay or resume it"` (`piSubagentRealPiAcceptance.test.ts:1207-1533`).

### Leg 3 exact assertions proven (source `piSubagentRealPiAcceptance.test.ts:1478-1517`; counters in the log)

| Assertion (source line) | Executed evidence |
|---|---|
| Fresh production WebSocket composition over the same isolated root/database after full disposal of the old server (:1396-1427) | Pre-restart server fully disposed with `preserveRootDir`/`preserveModelServer`; global event head read from the closed DB (`MAX(sequence)` over `orchestration_events`) before fresh boot; fresh harness + new client mounted on the same root/DB/model server |
| Reconciled card + durable aggregate under the same `executionId` (:1478-1479) | `executionId=exec_52728eaa-eda1-4b7d-870b-f53c1925705c` stable pre→post |
| Unchanged logical attempt; exactly one orphan generation fence (:1480-1486) | `attemptId=att_7cf20209-3dcc-4712-9735-80804020d8c7` unchanged; `generation=1` → `generation=2`; observedState `orphaned`; diagnostic `pi_subagent_owner_loss_orphaned` on both durable row and card |
| Zero new delegated model requests after restart (:1487) | pre `delegations=1` → post `delegations=1` (delta 0). Post `modelRequests=3` vs pre `modelRequests=2`: the single extra request is non-delegated startup/runtime traffic against the deterministic loopback server; the accepted criterion is zero NEW **delegated** requests, not zero total model requests |
| Zero fresh-server admissions (:1488-1492) | post-restart admission observation for the thread = **0** |
| Zero new Resume requests (:1493-1497) | 0 `thread.pi-subagent-execution-resume-requested` events after the shutdown-head cursor |
| Zero new parent effects after restart (:1498-1515) | 0 `thread.message-sent` events after the cursor (any occurrence would have thrown) |
| No completion outbox entry before or after (:1516-1517) | pre `outbox=0`, post `outbox=0` |
| `followUps=3` stable pre→post | replayed parent `thread.message-sent` count unchanged across restart |

Logged counters (verbatim from `WP-02-production-restart-leg.log`):

```text
T17 slice 4 stage 5 pre-restart counters:  executionId=exec_52728eaa… attemptId=att_7cf20209… generation=1 modelRequests=2 delegations=1 admissions=1 outbox=0 followUps=3
T17 slice 4 stage 5 post-restart counters: executionId=exec_52728eaa… attemptId=att_7cf20209… generation=2 modelRequests=3 delegations=1 admissions=0 outbox=0 followUps=3
```

`admissions` semantics: pre counter 1 = the one real managed admission that created the execution on the original server; post counter 0 = zero admissions on the fresh server (the fresh harness observes none). The honest orphan/generation fence advanced generation 1→2 without minting an attempt or dispatching work.

### Honest seam boundary recorded by the test itself

The suite prints its own seam note (verbatim in the log): no late old-generation terminal can be induced through the public WS + durable-read seams after disposing the original live process — a real old-generation child dies with its process and the suite has no durable write seam to fabricate stale terminal evidence. Late/stale old-generation fencing for Leg 3's filter therefore remains carried by the deterministic WP-01 rows (`"T07-AC4"`, `"T10-AC5"`, `"T14-AC2"` — executed, exit 0) plus the real fenced-terminal coverage inside Leg 1's executed real-Pi test; nothing is claimed from an unexecuted command.

---

## Evidence-class separation (verification contract)

| Class | Source | Used for |
|---|---|---|
| Deterministic WP-01 | 9 files / 118 tests, producer exit 0, commit `4090ccee8` | AC1–AC6 positive + failure/diagnostic rows, bounds/redaction, structural no-replay proof |
| Controlled real-Pi (this disposition) | Legs 1–3 above, each standalone, producer exit 0 | AC2 (real restart/orphan truth), AC4 (real explicit Resume), AC6 (fresh-boot zero-effect counters) |
| Environment record | Leg 3 Bun pre-collection failure (0 tests, exit 1) | Producer-authorization trail only; never a behavior result |
| Inherited manual destructive evidence | Prior accepted isolated manual run | Zero-owned-child destructive proof only; **not rerun by WP-02, not relabeled**; Ticket 05 makes no new destructive claim |

## Isolation and workspace safety

- Every leg ran standalone (`--project wallclock --maxWorkers=1 --no-file-parallelism`) with isolated durable roots/home/state/workspace/agent directories and a deterministic loopback model endpoint.
- No user live instance, no default dev instance, no PID enumeration or signalling, no process-tree kill, no push/release/deploy.
- Protected owner WIP (`apps/web/package.json`, `apps/web/src/main.tsx`, `bun.lock`) preserved byte-identical: diff hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`, modified-unstaged, never staged.
- No Symphony/Alfie source, test, contract, configuration, migration, manifest, or lockfile change was made or needed.
- The three raw logs listed above are the authoritative execution artifacts and were not rewritten after the runs.
