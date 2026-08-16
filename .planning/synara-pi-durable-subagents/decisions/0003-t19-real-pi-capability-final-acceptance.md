# 0003 — Ticket 19 real-Pi capability negotiation final acceptance

**Status:** Accepted

**Date:** 2026-08-16

**Decision type:** Project Supervisor final acceptance

**Integrated candidate:** Symphony
`d44c6ef630f20961c85c32268b7370673dd4f974` (chain
`42694412 → d323ec06 → d44c6ef6`); Alfie
`b34255e0c09aed5c43900254b4dbd1b8f2792fa6` (chain
`3f23ac379 → 29a1c132 → b34255e0`).

## Question

Does Ticket 19, Complete real-Pi capability negotiation, satisfy T19-AC1
through T19-AC7 under the accepted Project Contract and owner-approved Testing
Seams, and does it clear Ticket 20's Ticket-19 dependency?

## Governing references

- [PROJECT.md](../PROJECT.md) — project routing and implementation frontier.
- [spec.md](../spec.md) — managed-execution handshake and legacy semantics.
- [0001-testing-strategy-governance.md](0001-testing-strategy-governance.md) —
  evidence governance.
- [0002-t18-migration-lineage-final-acceptance.md](0002-t18-migration-lineage-final-acceptance.md)
  — accepted Issue-18 baseline.
- [19-complete-real-pi-capability-negotiation.md](../issues/19-complete-real-pi-capability-negotiation.md)
  — acceptance criteria, Testing Seams, and Implementation Report.
- Owner-approved boundaries: Issue-20 atomic production admission is not
  implemented here; commits remain local-only and no push is authorized.

## Evidence

- Independent reviewer: T19-AC1 through T19-AC7 passed and the initial
  reproducibility, listener-ownership, provenance-pin, and reporting gaps were
  repaired.
- Clean bare Alfie verification: `bun install` followed by `bun run test`
  passed 28 files and 443 tests with the tracked `pretest` build and no
  pre-existing `dist` or sibling `node_modules` dependency.
- Clean Symphony verification against the pinned Alfie worktree:
  real-extension 8/8, bridge 8/8, PiAdapter 39/39, and contracts 7/7.
- The provenance manifest verifies normalized Git origin, exact HEAD, a clean
  extension path, package identity, and SHA-256 hashes of `package.json`,
  `src/index.ts`, and `src/agent-manager.ts`. A realistic on-disk lookalike and
  an inline fixture are rejected.
- Production-boundary evidence starts the real `PiAdapter`, discovers the
  extension from disk, stores an immutable negotiated session capability, and
  proves handshake startup creates no execution or transcript side effect.
- The actual extension exposes callable `spawn`, `abort`, `abortAll`, and
  `getActiveExecutions` affordances over `AgentManager`; durable admission,
  authorization, runtime trust enforcement, and journal-first child start
  remain owned by Ticket 20.
- Follow-up verification proves one parent-abort listener owner across
  queued/running settlement and abort paths.

## Decision

**ACCEPT — final gate passed.**

- Ticket 19 is complete.
- Ticket 20's Ticket-19 dependency is satisfied.
- Both Issue-20 blockers are now cleared: Issue 18 by Decision 0002 and Issue
  19 by this decision.
- Local canonical branches were authorized and fast-forwarded to Symphony
  `d44c6ef6` and Alfie `b34255e0`.
- No remote push or publication is included in this acceptance.

## Assumptions and residual uncertainty

- Symphony's production lockfile resolves Pi runtime 0.81.1 while the Alfie
  extension declares peers `>=0.83.0`; the production-boundary test proves this
  handshake works at the actual Symphony resolution. Peer-range reconciliation
  remains a nonblocking later concern.
- Artifact provenance is an acceptance-test gate in Issue 19. Runtime trust
  enforcement belongs to Issue 20.
- Running-record abort listeners detach on promise settlement rather than
  synchronously at `dispose`; the handler is once-only and late execution is a
  no-op after manager state is cleared.
- Bridge handlers do not explicitly deregister; per-session Pi binding and
  probe caching bound current accumulation.

## Downstream and rollback implications

- Ticket 20 may consume protocol version 1, required capabilities
  `managed-spawn` and `abort-propagation`, five stable negative diagnostics,
  `context.subagentCapability`, and the `onSubagentCapability` observation
  seam.
- Ticket 20 must add runtime trust enforcement, authorization, atomic durable
  admission, server-minted identity, and fail-closed child start.
- Rollback is local: Symphony can return to `d323ec06` and Alfie to
  `29a1c132`. Neither accepted follow-up is pushed.

## Reopening conditions

Reopen only for material evidence of:

- divergence from Symphony `d44c6ef6` or Alfie `b34255e0`;
- false `managed_enabled`, handshake side effects, or a legacy Agent
  regression;
- provenance pin/hash drift;
- an unusable stored capability or observation seam for Ticket 20; or
- a change to the accepted Issue-18 migration range.

## Superseded records

None. Decisions 0001 and 0002 remain unchanged.
