# 0004 — Ticket 20 atomic authorized production admission final acceptance

**Status:** Accepted with recorded nonblocking risks

**Date:** 2026-08-17

**Decision type:** Project Supervisor final acceptance

**Integrated candidates:**

- Symphony `e6f21c242397da31d7d1197ddc91c9cdb583121e`
  (`bc4b3050e → 8061a09e → e6f21c24`)
- Alfie `2a3f69bd6af47dda4ef1966eaa709d47cc0d7d39`
  (parent `b34255e0c09aed5c43900254b4dbd1b8f2792fa6`)

**Publication:** Local integration only; not pushed or published.

## Question

Does the remediated Issue 20 candidate satisfy T20-AC1 through T20-AC8 under
the project contract and owner-approved Testing Seams, including atomic
admission, trusted production authority, attempt-local lifecycle identity,
real-Pi child identity, and legacy bypass?

Two focused questions required final adjudication:

1. Whether a session-local mapping from client correlation to server-minted
   command identity leaves a blocking cross-process redelivery gap.
2. Whether refusing managed spawn in a Pi thread whose runtime mode requires
   approval preserves T20-AC5 when Pi exposes no approval request or receipt
   surface.

## Governing references

- `PROJECT.md`
- `spec.md`
- Issues 02, 03, 10, 20, and 24
- Decisions 0001, 0002, and 0003
- Issue 20's owner-approved Testing Seams

Decisions 0002 and 0003 remain authoritative for the accepted migration-lineage
and real-Pi capability-negotiation prerequisites. This decision does not reopen
them.

## Evidence

Independent review accepted T20-AC1 through T20-AC8 after inspecting the
cumulative Symphony diff and the Alfie extension change. The reviewer
independently reproduced:

- Symphony focused admission suites: 6 files, 62/62 tests
- Symphony migration suites: 3 files, 28/28 tests
- Migration-lineage checker: 1 file, 11/11 tests
- Alfie extension suites: 28 files, 451/451 tests
- Real-extension provenance: Git origin, exact Alfie commit, clean extension
  path, package identity, and all pinned SHA-256 values

The accepted implementation proves:

- production composition provides the durable repository;
- the actual managed Agent tool passes through admission before child start;
- execution, first-attempt identity, and sequence-1 accepted or rejected truth
  commit atomically;
- an injected failure between journal and aggregate writes rolls back both;
- concurrent same-identity admission converges without leaking a raw
  uniqueness error;
- cross-authority command collision fails closed without returning another
  execution's identities;
- migration 100 preserves released 098/099 data and permits attempt 2,
  generation 2, sequence 1;
- stale-generation events cannot regress the current aggregate;
- project, thread, active turn, provider, runtime approval mode, and subject
  authority derive from server truth;
- rejected and already-applied requests start no child;
- the real Alfie child receives server-minted execution, attempt, and
  generation identities;
- legacy and unhandshaked Agent behavior remains unmanaged;
- disk reopen returns the same aggregate and ordered journal.

## Decision

Accept Issue 20 with recorded nonblocking risks.

The accepted interpretation of command redelivery is bounded to the live
admission scope defined by T20-AC3. The durable repository converges concurrent
and same-server-command replays using `command_id` plus ownership fingerprint.
Pi is in-process in this feature slice, and the project contract explicitly
defers true continuation across server restart. Restart reconciliation must not
automatically replay side effects. A future externalized delivery channel that
can re-present the same command after restart reopens the need for durable
client-keyed command deduplication.

The accepted approval interpretation is fail closed. Pi exposes no approval
request or receipt surface. Therefore:

- `auto` and `full-access` preserve their existing behavior after all other
  trusted checks pass;
- `approval-required` refuses managed spawn before child start with a stable
  unauthorized diagnostic.

Silently treating an approval-required Pi thread as approved would violate the
project's authorization invariant. Admitting such work in the future requires
a real approval surface and a separate owner decision.

Issue 20 may be marked completed. Ticket 21 becomes the blocker-free
remediation frontier. Ticket 06 remains blocked until ticket 24 is accepted.

## Recorded nonblocking risks

1. **Command dedup scope:** `client_command_id` is retained for correlation but
   is not a durable dedup key. This must be revisited before accepting any
   externalized cross-restart command-delivery mechanism.
2. **Approval-required Pi threads:** managed spawn is unavailable until Pi has
   a trusted approval receipt flow.
3. **Heavyweight checks:** `bun fmt`, `bun lint`, and `bun typecheck` were not
   run because the owner did not authorize them for this task. Focused runtime,
   migration, lineage, and real-extension suites passed.
4. **Full bootstrap:** literal full-process/WebSocket bootstrap evidence
   remains assigned to T24-AC3.
5. **Lifecycle representation:** admission records one atomic sequence-1
   `accepted` or `rejected` event. `requested` remains available for the
   durable queue phase.
6. **Pre-coordinator audit gap:** snapshot-unavailable and thread-missing
   failures reject before a durable rejection row can be correlated.
7. **Hermetic child completion:** real-extension acceptance proves child
   identity receipt, not successful model completion.
8. **Runtime-version carry-over:** Symphony Pi runtime 0.81.1 remains below
   Alfie's declared peer floor; the accepted production-boundary tests prove
   the reviewed handshake and admission behavior at the actual resolution.

## Rejected alternatives

- **Reject Issue 20:** rejected because no acceptance criterion failed under
  the approved project boundary and reproduced evidence.
- **Plain acceptance without risks:** rejected because the dedup, approval,
  heavyweight-check, and integrated-bootstrap boundaries must remain visible
  downstream.
- **Require cross-process client-keyed dedup now:** rejected because no such
  redelivery channel exists in this slice and true restart continuation is
  explicitly deferred.
- **Auto-approve approval-required Pi threads:** rejected because it would
  invent authority.
- **Require two admission journal events (`requested → accepted`):** rejected
  for Issue 20; the operative AC permits one atomic admission-phase truth, and
  the durable queue phase owns a genuine requested period.

## Rollback and reopening

The accepted commits remain local. Rollback is local to the parent commits; no
remote or external publication side effect exists.

Reopen this decision if:

- reviewed contents, provenance, or hashes diverge;
- same-identity concurrent admission starts duplicate children or exposes raw
  uniqueness failures;
- migration 100 loses released data;
- another authority can receive an existing execution's identities;
- an externalized cross-restart redelivery channel becomes real;
- approval-required Pi work is admitted without a trusted approval receipt;
- contrary evidence invalidates any T20 acceptance criterion.
