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
- [issues/](issues/) — normative implementation tickets in dependency order;
  work the blocker-free frontier one ticket at a time.

## Current implementation frontier

- **Review verdict for tickets 01–05:** not accepted on 2026-08-16; ticket 01
  was partial and tickets 02–05 failed. The focused fixture suites passed, but
  production wiring, migration compatibility, persistence correctness,
  authorization, and real-Pi/restart evidence did not.
- **Remediation track:** tickets 18–24.
- **Accepted remediation prerequisites:** tickets 18 and 19.
- **Blocker-free frontier:** ticket 20 — Atomic authorized production admission.
- **Downstream gate:** ticket 06 remains blocked until ticket 24 is accepted.
- Every remediation ticket owns an `Implementation Report`; an implementer must
  complete that report with exact evidence before requesting review.

## Supporting context

- [Synara Pi Coding Agent MCP Project Home](../synara-pi-coding-agent-mcp/PROJECT.md) —
  prior Synara–Pi integration decisions and domain vocabulary.
