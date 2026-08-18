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
- **Frontier track:** tickets 01–08 complete. Ticket 07 (journal-first
  terminal lifecycle, Symphony `fe4d1fa3`+`d44f624f`, Alfie
  `bcfe6edda`+`608c1c57d`, `0.13.0-alfie.1`) was accepted by Decision 0012
  with recorded nonblocking risks F3 summaryMaxChars MAX-guard symmetry
  (remediated in Ticket 08) and F4 cancelled-background reporter-entry
  retention (owner: ticket 10). Ticket 08 (durable completion outbox) was
  accepted by Decision 0013 at Symphony `78e58a6d`, Alfie unchanged at
  `608c1c57d`, `0.13.0-alfie.1`. Recorded nonblocking risks: F1
  recovery-scan clamping of journal-extracted metadata (owner: ticket 10),
  F2 stale-terminal transient recovery entries (owner: ticket 10), F3 absent
  production pump/recovery drivers (owners: tickets 09/10), F4 fence
  fail-open + at-least-once race note for the Ticket 09 consumer.
- **Blocker-free frontier:** ticket 09 — Per-thread completion coordinator
  (sole blocker, ticket 08, satisfied). Ticket 09 must wire the production
  completion pump over the accepted outbox (consuming the
  `SYNARA_PI_SUBAGENT_COMPLETION_RETRY_LIMIT` policy), implement per-thread
  batching, at-most-one outstanding follow-up per thread, and
  safe-parent-boundary delivery, and use the stable outbox identity as the
  parent-effect dedupe key (Decision 0013 invariants + F4). Ticket 09 cannot
  be accepted leaving live-process pending completions without a production
  pump. Ticket 10 must additionally invoke journal-first outbox recovery at
  startup and disposition Decision-0013 F1/F2 before that recovery ships.
  Standing obligation from Decisions 0009–0013 remains: any lease-based
  control must validate/re-derive lease authority server-side
  (producer-supplied occurredAt is not trusted); `session.abort()`
  resolution, timeouts, or temporary absence are never termination evidence.
- Every implementation ticket owns an `Implementation Report`; an implementer
  must complete that report with exact evidence before requesting review.

## Supporting context

- [Synara Pi Coding Agent MCP Project Home](../synara-pi-coding-agent-mcp/PROJECT.md) —
  prior Synara–Pi integration decisions and domain vocabulary.
