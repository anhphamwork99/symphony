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
  accepted then **reopened**: post-acceptance review found production-path
  config wiring (T22-AC5) and post-detach settlement cleanup (T22-AC7)
  contrary evidence; remediation re-enters through the plan directory.
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
- **Accepted remediation tickets:** tickets 18, 19, 20, and 21.
- **Reopened remediation ticket:** ticket 22 — post-acceptance review reopened
  Decision 0007 (T22-AC5 production config wiring, T22-AC7 post-detach
  settlement cleanup, plus evidence-strength gaps for AC1/AC2/AC6); remediation
  packages are WP-06/WP-07 in the ticket-22 plan directory.
- **Blocker-free frontier:** ticket 22 remediation (WP-06 Alfie, WP-07
  Symphony; parallel-safe across repositories, WP-07 provenance re-pin
  serialized after WP-06 lands). Ticket 23 must not begin before ticket 22 is
  re-accepted.
- **Downstream gate:** ticket 06 remains blocked until ticket 24 is accepted.
- Every remediation ticket owns an `Implementation Report`; an implementer must
  complete that report with exact evidence before requesting review.

## Supporting context

- [Synara Pi Coding Agent MCP Project Home](../synara-pi-coding-agent-mcp/PROJECT.md) —
  prior Synara–Pi integration decisions and domain vocabulary.
