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
- [plans/22-real-bounded-foreground-attachment/](plans/22-real-bounded-foreground-attachment/) —
  delegation-ready implementation plan and Work Packages for Ticket 22.
- [issues/](issues/) — normative implementation tickets in dependency order;
  work the blocker-free frontier one ticket at a time.

## Current implementation frontier

- **Review verdict for tickets 01–05:** not accepted on 2026-08-16; ticket 01
  was partial and tickets 02–05 failed. The focused fixture suites passed, but
  production wiring, migration compatibility, persistence correctness,
  authorization, and real-Pi/restart evidence did not.
- **Remediation track:** tickets 18–24.
- **Accepted remediation tickets:** tickets 18, 19, 20, 21, and 22
  (re-accepted via Decision 0008 after the Decision 0007 reopening).
- **Blocker-free frontier:** ticket 23 — Production coalesced progress and
  heartbeat delivery.
- **Downstream gate:** ticket 06 remains blocked until ticket 24 is accepted.
- Every remediation ticket owns an `Implementation Report`; an implementer must
  complete that report with exact evidence before requesting review.

## Supporting context

- [Synara Pi Coding Agent MCP Project Home](../synara-pi-coding-agent-mcp/PROJECT.md) —
  prior Synara–Pi integration decisions and domain vocabulary.
