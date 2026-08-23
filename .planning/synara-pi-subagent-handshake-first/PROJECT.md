# Synara Pi Subagent Handshake-First Handoff

## Routing metadata

- **Owner:** anhpham99
- **Lifecycle:** Implementation in progress — Ticket 01, its runtime-closure
  remediation Ticket 01b, its prompt-closure remediation Ticket 01c, and
  Ticket 02 are accepted. Ticket 03 is implemented and behaviorally passes
  AC1–AC5. Its authorized remediation at `03cfdc8c8` makes `bun fmt` and
  `bun lint` pass and clears every Ticket-03 type error, but Decision 0013
  continues to withhold final acceptance because workspace `bun typecheck`
  is blocked by 22 pre-existing Ticket-01c/02 errors outside Ticket 03's
  current write authority.
- **Triage status:** 02 accepted; 03 needs verification remediation; 04
  remains blocked by 03.
- **Tracker:** Local Markdown
- **Related historical project:**
  `.planning/synara-pi-durable-subagents/`

## Authoritative artifacts

- [spec.md](spec.md) — normative handshake-first feature specification.
- [terms.md](terms.md) — project-scoped vocabulary.
- [design-tree.md](design-tree.md) — settled decision tree and implementation
  facts collected during discovery.
- [issues/](issues/) — normative implementation tickets in dependency order.
- [decisions/0001-release-controlled-extension.md](decisions/0001-release-controlled-extension.md)
  — owner-approved extension artifact policy.
- [decisions/0002-no-legacy-managed-subagent-fallback.md](decisions/0002-no-legacy-managed-subagent-fallback.md)
  — owner-approved no-fallback policy and reconciliation of historical
  mixed-version fallback decisions.
- [decisions/0003-controlled-extension-with-user-runtime-configuration.md](decisions/0003-controlled-extension-with-user-runtime-configuration.md)
  — owner-approved authentication/model-configuration boundary.
- [decisions/0005-t01-final-acceptance.md](decisions/0005-t01-final-acceptance.md)
  — final acceptance of Ticket 01’s packaged artifact and fail-close boundary,
  artifact-closure premise amended by Decision 0006.
- [decisions/0006-t01-runtime-closure-reassessment.md](decisions/0006-t01-runtime-closure-reassessment.md)
  — binding Supervisor reassessment: the Ticket 01 artifact is an
  insufficient runtime closure for the real pinned Alfie extension; opened
  remediation Ticket 01b, stopped Ticket 02 real-runtime acceptance, and
  amended Decisions 0004/0005 narrowly.
- [decisions/0007-t01b-host-peer-compatibility-reassessment.md](decisions/0007-t01b-host-peer-compatibility-reassessment.md)
  — binding Supervisor reassessment: the real pinned artifact declares Pi
  peers `>=0.83.0`, while the current packaged host is `0.81.1`; AC4 requires
  host alignment or an Alfie-source-authoritative exact-tuple exception.
- [decisions/0008-t01b-normal-dependency-host-alias-reassessment.md](decisions/0008-t01b-normal-dependency-host-alias-reassessment.md)
  — binding Supervisor reassessment: the Pi loader's host alias for normal
  `@sinclair/typebox` cannot satisfy AC4 unless it is exact lock-identical or
  upstream-authoritatively compatible; prefer artifact-local resolution.
- [decisions/0009-t01b-final-acceptance.md](decisions/0009-t01b-final-acceptance.md)
  — binding final acceptance: Ticket 01b AC1–AC6 are accepted; its
  complete-executable-closure and Ticket-02-unblocking conclusions were
  narrowly amended by Decision 0010 and are restored by Decision 0011, all
  other findings stand.
- [decisions/0010-t01c-prompt-closure-reassessment.md](decisions/0010-t01c-prompt-closure-reassessment.md)
  — binding Supervisor reassessment (historical finding unamended): the
  accepted Ticket 01b artifact omitted the pinned extension's required
  `agent/system` prompt-file closure; opened remediation Ticket 01c with
  mechanical prompt-dependency derivation, returned Ticket 02 to
  blocked-by-01c for real-runtime acceptance, and narrowly amended Decision
  0009 while preserving all Decisions 0001–0008 security boundaries. Its
  suspension clauses are discharged by Decision 0011.
- [decisions/0011-t01c-final-acceptance.md](decisions/0011-t01c-final-acceptance.md)
  — **Authoritative** binding final acceptance: Ticket 01c at candidate
  `6ccc674b9` (independent PASS review persisted at `c470acffd`; 143 tests
  / 6 files) is accepted on AC1–AC7. It discharged Decision 0010's
  suspension of Decision 0009's complete-executable-closure,
  real-child-execution, Decision-0006 discharge, and Ticket-02-block
  conclusions.
- [decisions/0012-t02-final-acceptance.md](decisions/0012-t02-final-acceptance.md)
  — **Authoritative** binding final acceptance: Ticket 02 at candidate
  `c9c8278eb` (independent PASS review persisted at `2c7979cba`) is accepted
  on AC1–AC5. Ticket 04 remains blocked by Ticket 03.
- [decisions/0013-t03-final-acceptance-non-acceptance.md](decisions/0013-t03-final-acceptance-non-acceptance.md)
  — **Authoritative** binding final-acceptance non-acceptance: Ticket 03
  candidate `236d4119b` and its independent PASS review support AC1–AC5, but
  final acceptance is withheld solely because the mandatory workspace
  formatting, lint, and typecheck pass was not authorized or run. The one
  Ticket-03 final consultation is exhausted; fresh authorized check evidence
  must route as a reassessment.
- [../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md](../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)
  — accepted feature-level Testing Strategy Governance reused by this
  follow-on durable-subagent work.
- The related historical Project Home routes binding decisions for bounded
  foreground attachment, journal-first terminal truth, restart reconciliation,
  watchdog/teardown, explicit resume, and managed-child process ownership.

## Current implementation frontier

- **01 — Package and fail-close the managed Pi artifact** is accepted by
  Decision 0005 (fail-close boundary; not reopened). Its runtime-closure
  remediation is tracked as Ticket 01b.
- **01b — Remediate the verified managed Pi runtime closure** is accepted by
  Decision 0009. Its proven extension/shared/npm closure, host alignment, and
  artifact-local TypeBox resolution stand; per Decision 0011, its
  complete-executable-closure characterization and Ticket-02 unblocking
  (suspended by Decision 0010) are restored through the Ticket 01c-extended
  artifact.
- **01c — Remediate the verified managed Pi prompt closure** is accepted by
  Decision 0011 (candidate `6ccc674b9`; independent PASS review persisted at
  `c470acffd`; 143 focused tests / 6 files). The same release-owned,
  manifest-exact artifact now carries the pinned extension's mechanically
  derived `agent/system` prompt-file runtime closure under all existing
  security boundaries, and a real delegated child spawn reaches at least
  its first real child model request from the release alone.
- **02 — Bootstrap the verified managed harness and prove detached terminal
  lifecycle** is accepted by Decision 0012 (candidate `c9c8278eb`; independent
  PASS review persisted at `2c7979cba`). Its real controlled-artifact
  AC1–AC5 evidence proves artifact-only loading, handshake-before-admission,
  one normal durable admission, post-detach liveness through one fenced
  terminal commit, and redacted zero-effect bootstrap/runtime failures.
- **03 — Present durable execution-card truth** is implemented at
  `236d4119b`, with verification remediation at `03cfdc8c8`; its independent
  review passes AC1–AC5, `bun fmt` and `bun lint` pass, and all Ticket-03
  type errors are fixed. Decision 0013 still withholds final acceptance until
  the 22 pre-existing out-of-scope Ticket-01c/02 workspace typecheck errors are
  remediated and the complete `bun typecheck` passes.
- **04 — Prove desktop production composition and complete acceptance** is
  blocked by Ticket 03; it remains packaged desktop/server final composition
  only and does not absorb the verification remediation.
