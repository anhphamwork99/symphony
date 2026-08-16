# 0002 — Ticket 18 migration-lineage final acceptance

**Status:** Accepted

**Date:** 2026-08-16

**Decision type:** Project Supervisor final acceptance

**Integrated candidate:** `42694412`

## Question

Does Ticket 18, Reconcile released migration lineages, satisfy T18-AC1 through
T18-AC7 under the accepted Project Contract and owner-approved Testing Seams,
and does it clear Ticket 20's Ticket-18 dependency?

## Governing references

- [PROJECT.md](../PROJECT.md) — project routing and frontier.
- [spec.md](../spec.md) — migration compatibility requirements.
- [0001-testing-strategy-governance.md](0001-testing-strategy-governance.md) —
  evidence governance.
- [18-reconcile-released-migration-lineages.md](../issues/18-reconcile-released-migration-lineages.md)
  — acceptance criteria and owner-approved Testing Seams.
- Owner-approved compatibility boundaries: fresh databases, Symphony
  `v0.7.2-symphony.1/.2`, and upstream `v0.7.2`; no alias between semantically
  different migrations; data preservation; second-pass no-op.

## Evidence

- Independent reviewer audit: T18-AC1 through T18-AC7 all passed; lineage
  checker exited 0 over 84 release tags; migrations 090–096 were byte-identical
  to upstream v0.7.2; migration 097 was byte-identical to released Symphony
  migration 090 and idempotent; migrations 098–099 were non-conflicting and
  idempotent; no critical or high risk was found.
- Orchestrator reruns:
  - migration lineage checker: exit 0;
  - three-history reconciliation: 4/4 tests passed;
  - migration suite: 69/69 tests passed;
  - Pi-subagent execution repository: 8/8 tests passed.
- Supervisor source verification confirmed the exact 90→97 lineage alias,
  fail-closed unknown-divergence paths, migration ordering through 099,
  representative data preservation, three-history schema convergence, and
  second/third migration-pass no-op assertions.

## Decision

**ACCEPT — final gate passed.**

- Ticket 18 remains `completed`.
- Ticket 20's Ticket-18 dependency is satisfied.
- Ticket 19 is unaffected and remains an independent blocker for Ticket 20.
- Migrations 090–096 from upstream v0.7.2, Symphony
  `ProjectMcpActivation` at 097, Pi-subagent execution schema at 098, lease and
  progress schema at 099, and the exact historical alias
  `90 ProjectMcpActivation → 97` are authoritative for downstream work.

## Rejected alternatives

- **Reject:** no acceptance criterion failed; rejecting for report-only typos
  would not reflect the independently reproduced implementation evidence.
- **Advisory/not ready:** evidence was executed and source-verified rather than
  asserted only.

## Assumptions and residual uncertainty

- The reviewed and rerun state corresponds to integrated commit `42694412`.
- The independent reviewer's byte-identity comparison of migrations 090–096
  against upstream v0.7.2 is accepted as audit evidence.
- The Supervisor did not execute test binaries; its source verification was
  reconciled with independent reviewer and orchestrator executions.
- No material residual risk remains for the migration tier.

## Non-gating documentation corrections

- Replace invalid report command spelling `bun --cwd apps/server run test` with
  the reproduced form `bun run --cwd apps/server test`.
- Add commit `42694412` and the relevant working-tree status to Ticket 18's
  Implementation Report.
- AC4's repository test uses the fully migrated persistence layer; migration
  099's columns and idempotency are additionally proven by the reconciliation
  tests and source guards.

These corrections do not reopen Ticket 18.

## Downstream and rollback implications

- Supported fresh, Symphony, and upstream-v0.7.2 histories converge on the
  canonical schema through migration 099.
- The repair is append-only plus a metadata tracker repair gated to the exact
  released pair.
- Unknown lineage divergence and newer schemas retain fail-closed behavior.
- Released migration identities remain guarded by the lineage checker in CI.

## Reopening conditions

Reopen this decision only for material evidence of:

- data loss or corruption on a supported released lineage;
- an alias between semantically different migrations;
- divergence between the reviewed implementation and commit `42694412`; or
- a Ticket 19 resolution that must change the 090–099 migration range.

## Superseded records

None. Decision 0001 remains unchanged.
