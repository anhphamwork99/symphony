# Synara Pi Durable Subagents

## Routing metadata

- **Owner:** anhpham99
- **Lifecycle:** Specification ready for implementation planning
- **Triage status:** ready-for-agent
- **Tracker:** Local Markdown

## Authoritative routing

- [spec.md](spec.md) — normative feature specification.
- [decisions/0001-testing-strategy-governance.md](decisions/0001-testing-strategy-governance.md) —
  accepted project-scoped testing strategy.
- [decisions/0002-t18-migration-lineage-final-acceptance.md](decisions/0002-t18-migration-lineage-final-acceptance.md) —
  accepted migration-lineage baseline for downstream persistence work.
- [decisions/0003-t19-real-pi-capability-final-acceptance.md](decisions/0003-t19-real-pi-capability-final-acceptance.md) —
  accepted real-Pi handshake and capability baseline.
- [decisions/0004-t20-atomic-authorized-production-admission-final-acceptance.md](decisions/0004-t20-atomic-authorized-production-admission-final-acceptance.md) —
  accepted atomic authorized production-admission baseline and recorded
  nonblocking risks.
- [decisions/0005-t21-production-fail-closed-control-health-final-acceptance.md](decisions/0005-t21-production-fail-closed-control-health-final-acceptance.md) —
  accepted production fail-closed control-health baseline and recorded
  nonblocking risks.
- [decisions/0006-t22-bounded-foreground-attachment-technical-direction.md](decisions/0006-t22-bounded-foreground-attachment-technical-direction.md) —
  accepted cross-repository technical direction for Ticket 22 bounded
  foreground attachment.
- [decisions/0007-t22-real-bounded-foreground-attachment-final-acceptance.md](decisions/0007-t22-real-bounded-foreground-attachment-final-acceptance.md) —
  accepted then reopened; historical reopening evidence, superseded by
  Decision 0008 for this ticket.
- [decisions/0008-t22-real-bounded-foreground-attachment-final-acceptance-remediation.md](decisions/0008-t22-real-bounded-foreground-attachment-final-acceptance-remediation.md) —
  accepted remediation baseline: Ticket 22 final acceptance at Symphony
  `8a5e8dac` + Alfie `82406bd8`; M2 nonblocking risk recorded; per-file
  standalone invocations are the binding envelope acceptance method.
- [decisions/0009-t23-production-progress-heartbeat-and-saturation-final-acceptance.md](decisions/0009-t23-production-progress-heartbeat-and-saturation-final-acceptance.md) —
  accepted Ticket 23 baseline: Symphony `6d646fe1` + Alfie `d35644a3b`
  (`0.11.0-alfie.1`, capability `coalesced-progress`); nonblocking risks
  recorded (lease trusts producer occurredAt — the first lease consumer must
  validate server-side before any lease-based control).
- [decisions/0010-t24-integrated-remediation-final-acceptance.md](decisions/0010-t24-integrated-remediation-final-acceptance.md) —
  accepted Ticket 24 integrated gate: Symphony `625d256a` + Alfie
  `d35644a3b`; authorizes tickets 01–05 re-completion (second matrix, 31/31
  rows); frontier advances to ticket 06, which inherits the lease-occurredAt
  validation obligation.
- [decisions/0011-t06-durable-parent-turn-cancellation-final-acceptance.md](decisions/0011-t06-durable-parent-turn-cancellation-final-acceptance.md) —
  accepted Ticket 06: Symphony `df38bfcb` + remediation `f92ad194` + Alfie
  `53f84bb56` (`0.12.0-alfie.1`, capability `durable-cancellation`);
  nonblocking risks F1/F3/F4 recorded with follow-up owners (tickets 10/15/13);
  frontier advances to ticket 07 — journal-first terminal lifecycle.
- [decisions/0012-t07-journal-first-terminal-lifecycle-final-acceptance.md](decisions/0012-t07-journal-first-terminal-lifecycle-final-acceptance.md) —
  accepted Ticket 07: Symphony `fe4d1fa3` + remediation `d44f624f` + Alfie
  `bcfe6edda` + remediation `608c1c57d` (`0.13.0-alfie.1`, capability
  `journal-terminal-lifecycle`, host-gated terminal reporting); review F1/F2
  remediated, F3–F5 recorded with follow-up owners (tickets 08/10); frontier
  advances to ticket 08 — durable completion outbox.
- [decisions/0013-t08-durable-completion-outbox-final-acceptance.md](decisions/0013-t08-durable-completion-outbox-final-acceptance.md) —
  accepted Ticket 08: Symphony `78e58a6d`, Alfie unchanged at `608c1c57d` /
  `0.13.0-alfie.1` (no extension change); review F1/F2 (LOW) accepted as
  Ticket 10 follow-ups, F3/F4 (INFO) recorded with Ticket 09/10 ownership;
  frontier advances to ticket 09 — per-thread completion coordinator.
- [decisions/0014-t10-restart-reconciliation-final-acceptance.md](decisions/0014-t10-restart-reconciliation-final-acceptance.md) —
  accepted Ticket 10: Symphony `e58ff719` plus the disclosed Ticket-10
  hunks in `98b9e990`; T10-AC1–AC7 and Decision-0013 F1/F2/F3 pass;
  restart reconciliation is journal-first, generation-fenced,
  replay-free, and derives lease authority server-side. Ticket 10 is
  complete; Ticket 09 remains awaiting its separate acceptance, after
  which Ticket 11 becomes blocker-free.
- [decisions/0015-t09-per-thread-completion-coordinator-final-acceptance-remediation.md](decisions/0015-t09-per-thread-completion-coordinator-final-acceptance-remediation.md) —
  Ticket 09 final acceptance returned NEEDS REMEDIATION: T09-AC1/2/3/5/6
  pass, but T09-AC4 fails because `delivered` is persisted before the parent
  effect and a process crash can strand an unrecoverable completion. Ticket
  09 remains the active frontier; Ticket 11 remains blocked.
- [decisions/0016-t09-crash-safe-parent-effect-technical-direction.md](decisions/0016-t09-crash-safe-parent-effect-technical-direction.md) —
  binding Ticket 09 remediation direction: immutable durable completion
  batches use deterministic internal `thread.turn.start` commands and exact
  orchestration command receipts as the idempotent parent-effect boundary;
  Ticket 09 owns recovery, Ticket 10/Alfie remain unchanged.
  - [decisions/0014-t13-ac4-metrics-surface-approval-authority.md](decisions/0014-t13-ac4-metrics-surface-approval-authority.md) —
    binding adjudication: the persisted T13-AC4 `serverGetDiagnostics` mapping
    is an ordinary ticket-level seam but still requires fresh human-owner
    approval before the first metrics-surface test.
  - [decisions/0017-t13-admission-quotas-and-safe-telemetry-final-acceptance.md](decisions/0017-t13-admission-quotas-and-safe-telemetry-final-acceptance.md) —
    accepted Ticket 13: finite provider-session/server/project admission
    budgets, journal-only wall-time escalation trigger, owner-approved safe
    `serverGetDiagnostics.piSubagents` telemetry, bounded saturation, and
    finite invalid-config fallback; Ticket 15's Ticket-13 blocker is satisfied.
- [plans/22-real-bounded-foreground-attachment/](plans/22-real-bounded-foreground-attachment/) —
  delegation-ready implementation plan and Work Packages for Ticket 22.
- [issues/](issues/) — normative implementation tickets in dependency order;
  work the blocker-free frontier one ticket at a time.

## Current implementation frontier

- **Review history for tickets 01–05:** not accepted on 2026-08-16 (ticket 01
  partial, tickets 02–05 failed); the reviewed defects were remediated through
  tickets 18–23 and proven fixed by the ticket-24 integrated acceptance path.
  Tickets 01–05 are complete again per Decision 0010 (second matrix in the
  ticket-24 report, 31/31 rows).
- **Remediation track:** tickets 18–24 — all accepted (Decisions 0002–0010).
- **Frontier track:** tickets 01–10, 13 are complete. Ticket 09 (per-thread
  completion coordinator) was rejected by Decision 0015 (crash window:
  durable `delivered` before the parent effect), remediated under Decision
  0016's crash-safe direction (immutable dispatch batch ledger migration 103,
  deterministic frozen `thread.turn.start`, accepted fingerprint-matched
  orchestration command receipt as the sole parent-effect acceptance proof),
  and accepted by Decision 0018 at Symphony `ebf224a6` (Alfie unchanged at
  `489acd626` / `0.14.0-alfie.1`). Review findings F1–F6 dispositioned:
  F1 → Ticket 11 success-diagnostic literal; F2/F3 → Ticket 17 test
  hardening; F4/F5/F6 recorded as intended semantics.
- [decisions/0018-t09-crash-safe-per-thread-completion-coordinator-final-acceptance.md](decisions/0018-t09-crash-safe-per-thread-completion-coordinator-final-acceptance.md) —
  accepted the remediated Ticket 09: Decision 0015 superseded, T09-AC1..AC6
  all pass with both T09-AC4 crash positions closed.
- **Next dependency unlock:** Ticket 11 is implemented at Symphony `95b9e169`
  (working-tree commit; review/acceptance pending) with its Implementation
  Report complete in the issue. Ticket 12 remains
  blocked by Ticket 11 and owns production transcript/result reading.
  Ticket 15 owns the production lease-expiry/watchdog sweep driver; its
  Ticket-10 and Ticket-13 blockers are satisfied, so it is blocker-free.
  - **Accepted out-of-frontier ticket:** Ticket 13 — admission quotas and safe
    telemetry — is complete per Decision 0017.
- Every implementation ticket owns an `Implementation Report`; an implementer
  must complete that report with exact evidence before requesting review.

## Supporting context

- [Synara Pi Coding Agent MCP Project Home](../synara-pi-coding-agent-mcp/PROJECT.md) —
  prior Synara–Pi integration decisions and domain vocabulary.
