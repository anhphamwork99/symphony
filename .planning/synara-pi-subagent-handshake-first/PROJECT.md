# Synara Pi Subagent Handshake-First Handoff

## Routing metadata

- **Owner:** anhpham99
- **Lifecycle:** Implementation in progress — Ticket 01, its runtime-closure
  remediation Ticket 01b, and its prompt-closure remediation Ticket 01c are
  accepted; Decision 0011 closes Decision 0010's suspension of Decision
  0009's complete-executable-closure/unblock conclusions.
- **Triage status:** 02 unblocked (in progress, not accepted — full real
  controlled-artifact AC1–AC5 rerun required after its pending test-only
  SQLite observation repair); 03 ready-for-agent; 04 remains blocked by
  02 + 03
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
  / 6 files) is accepted on AC1–AC7. Discharges exactly Decision 0010's
  suspension of Decision 0009's complete-executable-closure,
  real-child-execution, Decision-0006 discharge, and Ticket-02-block
  conclusions. Ticket 02 is unblocked but **not accepted** — its full real
  controlled-artifact AC1–AC5 suite must rerun after its pending test-only
  SQLite observation repair. Ticket 04 remains blocked by 02 + 03.
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
  lifecycle** is unblocked by Decision 0011 and in progress, but **not
  accepted** — no acceptance criterion is complete. It retains exclusive
  ownership of controlled-runtime construction, user authentication/model
  configuration, mandatory lifecycle handshake, and managed Agent-wrapper
  exposure. Its pending test-only AC2/AC5 SQLite live-WAL observation repair
  is permitted within its approved write set, after which the full real
  controlled-artifact AC1–AC5 suite must be rerun; evidence produced before
  01c acceptance does not carry.
- **03 — Present durable execution-card truth** is unblocked and
  ready-for-agent.
- **04 — Prove desktop production composition and complete acceptance** is
  blocked by tickets 02 and 03; it remains packaged desktop/server
  final composition only and does not absorb the remediation.
