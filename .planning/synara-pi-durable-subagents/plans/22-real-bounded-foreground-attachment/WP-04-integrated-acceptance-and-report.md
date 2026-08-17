# WP-04 — Integrated real-Pi acceptance and Implementation Report

**State:** blocked until WP-03 completes

**Owner role:** worker

**Repository:** `/Users/anhpham99/symphony`; Alfie is read-only at the pin

**Dependencies:** WP-03 integrated candidate and exact clean Alfie pin

## Task

Create the smallest maintainable acceptance fixtures that prove T22-AC1
through T22-AC8 at the approved public seams, run the integrated evidence
matrix, and complete every section of Issue 22's Implementation Report.

## Context and authority

[Issue 22](../../issues/22-real-bounded-foreground-attachment.md) contains
owner-approved Testing Seams:

- actual Pi parent-tool boundary for AC1/2/3/5/6/8;
- production persistence reopen boundary for AC4;
- session lifecycle and resource-observation boundary for AC7.

Decision 0001 requires real-Pi evidence and failure pairing. Decision 0006
fixes the timing, cleanup, lifecycle order, and provenance contract.

## Allowed write set

- One new real-Pi acceptance test under
  `apps/server/src/provider/`
- One new file-backed reopen test under
  `apps/server/src/provider/` or the existing repository test directory,
  whichever is the highest stable existing seam
- Narrow additive edits to
  `apps/server/src/provider/piSubagentRealExtension.test.ts` only when its
  existing harness must expose a reusable helper
- `.planning/synara-pi-durable-subagents/issues/22-real-bounded-foreground-attachment.md`
  — Implementation Report only

This package is evidence-only. Do not edit production source, provenance,
contracts, config, migrations, or Alfie. A production defect returns to the
owning WP.

## Acceptance matrix

### T22-AC1 — Fast inline

- Load and verify the actual pinned extension.
- Actual child finishes inside a short configured budget.
- Result remains the normal inline child result.
- Journal is sequence 1 accepted, sequence 2 running/started, with no sequence
  3 detach.
- No follow-up delivery or background nudge is created.

### T22-AC2 and T22-AC3 — Long detach, same child

- Actual child exceeds a valid short budget.
- Record start and return elapsed time; handle returns no later than
  `budget + 500 ms` on a functioning loop.
- Exactly one child exists before and after detach.
- Execution ID, attempt ID, generation, concrete record/session, operation
  token, promise, and `parent_turn` listener/scope remain unchanged.
- Detached child continues and can later settle under manager ownership.

### T22-AC4 — Disk reopen

- Use file-backed SQLite, not an in-memory-only reconstruction.
- Detach, close the database-backed harness, reopen the same file.
- Recover the same non-terminal running aggregate and ordered journal:
  seq1 accepted → seq2 running/started → seq3 running/detached.
- Compare identities and bounded metadata field-by-field.
- Do not claim that the in-process child survived a server process death.

### T22-AC5 — Production config path

- Prove default `10000`, one valid short budget, both valid endpoints, and
  representative invalid classes falling back to `10000`.
- Record resolved values and elapsed behavior.
- Avoid a mandatory 10-second wait when a direct production-policy observation
  proves the default; one timed path must still traverse the actual Agent.

### T22-AC6 — Isolation

- Run at least two concurrent managed executions with independent bindings and
  outcomes.
- Run an adjacent actual legacy session.
- Compare identities, results, deadlines, lifecycle rows, resource snapshots,
  and legacy behavior independently.

### T22-AC7 — Cleanup and failure surface

Prove zero Ticket-22 timers/live attachment entries after:

- inline child settlement;
- successful detach (parent attachment removed while child remains manager-owned);
- eventual detached-child settlement;
- startup failure;
- parent abort;
- session disposal;
- explicit cleanup;
- sequence-2 report failure;
- sequence-3 report failure.

For every targeted cleanup, prove an unrelated managed or legacy child remains
unaffected. Record exact resource counts before and after.

### T22-AC8 — Real source only

- Verify Git origin, exact Alfie HEAD, clean extension path, package identity,
  and all pinned hashes.
- Invoke the actual registered Agent production path.
- Preserve tests that reject inline factory and on-disk lookalike evidence.
- No synthetic replacement Agent may satisfy any real-Pi or reopen row.

## Test construction sequence

1. Reuse existing real-extension provenance/session helpers; extract only when
   duplication would otherwise be unavoidable.
2. Add deterministic file-backed reopen and returned-persistence-failure cases.
3. Add real-timer fast/long/concurrent/legacy and cleanup cases.
4. Run focused suites until stable.
5. Run full Alfie extension and Symphony server suites once on the final
   candidate.
6. Populate the report from captured outputs; do not write claims first.

## Verification

```bash
cd /Users/anhpham99/symphony/apps/server
bun run test src/provider/piSubagentForegroundReopen.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentForegroundAcceptance.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentRealExtension.test.ts

bun run test

cd /Users/anhpham99/alfie/agent/extensions/pi-subagents
bun run test
```

When running a workspace-level command that must receive `ALFIE_REPO_DIR`, use
the accepted Ticket-21 command `bun run test -- --env-mode=loose`; Issue 21's
Implementation Report records that Turbo's strict environment otherwise drops
the variable. Prevent or clean `.pi/notifications.jsonl` and other runtime test
artifacts before reporting working-tree status.

## Required report contents

Complete all existing Issue 22 report sections with:

- delivered scope and explicit attachment-vs-execution-lifetime distinction;
- exact production call-chain trace;
- AC1–AC8 source and verification matrix;
- invalid config, child/start/report failure, disposal, and cleanup diagnostics;
- exact commands, elapsed times, exit codes, test counts, identity comparisons,
  and resource counts;
- Ticket-18 migration/reopen compatibility reference;
- real-Pi origin/commit/hash evidence and continued-child proof;
- deviations, event-loop/timing caveats, and any untested case;
- Alfie and Symphony commits plus clean working-tree status;
- shortest reviewer reproductions for fast, detached, reopen, concurrent, and
  cleanup paths.

Do not mark the ticket accepted; that belongs to WP-05.

## Completion and commit rule

- Every AC row has concrete source and verification evidence.
- Focused and full suites pass or a real blocker is recorded.
- Create at most two local Symphony commits:
  `test(pi): prove real bounded foreground attachment (issue 22)` and
  `docs(planning): complete issue 22 implementation report`.
- Do not push.

## Challenge conditions

Stop if timing repeatedly violates the accepted envelope, if a lifecycle store
operation hangs, if reopen requires schema change, if real evidence requires a
synthetic tool, or if any production change is needed outside prior WPs.
