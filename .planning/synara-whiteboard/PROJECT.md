# Synara Whiteboard

Owner: repository owner
Lifecycle: implementation planning
Triage: active-fallback-wp-gate
Tracker: Local Markdown

## Artifacts

- [Agent-ready spec](./spec.md)
- [Implementation tickets](./issues/)
- [Confirmed product contract](./PRODUCT-CONTRACT.md)
- [Superseded Testing Strategy Governance Decision](./decisions/0041-testing-strategy-governance.md)
- [Accepted Testing Strategy Governance Reassessment](./decisions/0047-testing-strategy-governance-reassessment.md)
- [Research evidence](./RESEARCH.md)
- [Project vocabulary](./terms.md)
- [Project decisions](./decisions/)
- [Owner-authorized Ticket 02 package/public-API reassessment](./decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md)
- [Ticket 02 public-history boundary research failure and fallback activation](./decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md)
- [Accepted Ticket 02 fallback dual-history contract](./designs/ticket-02-fallback-dual-history-contract.md)
- [Decision 0055 — owner approval of fallback dual-history contract](./decisions/0055-ticket-02-fallback-dual-history-contract-approved.md)
- [Remediated Ticket 02 fallback dual-history implementation plan](./plans/02-fallback-dual-history-implementation.md)
- [Decision 0056 — Ticket 02 WP-GATE-only authorization](./decisions/0056-ticket-02-fallback-wp-gate-authorization.md)
- [Ticket 02 fallback contract challenge review](./reviews/ticket-02-fallback-contract-challenge.md)

Owner-confirmed product discovery and targeted risk grilling completed on 2026-08-26. The refreshed spec and accepted Testing Strategy Governance Reassessment are the normative implementation handoff.

Accepted: [01 — Prove the Excalidraw integration boundary](./issues/01-prove-excalidraw-integration-boundary.md), finalized by [Decision 0050](./decisions/0050-ticket-01-final-acceptance-hold-removed.md).

Current frontier: [02 — Prove exact AI edit-batch Undo and Redo](./issues/02-prove-ai-batch-undo-redo.md).

Active bounded phase: Ticket 02 is `active-fallback-wp-gate` under [Decision 0056](./decisions/0056-ticket-02-fallback-wp-gate-authorization.md), the implementation-boundary record that authorizes only the bounded WP-GATE feasibility proof of the remediated [fallback dual-history implementation plan](./plans/02-fallback-dual-history-implementation.md). The [fallback dual-history contract](./designs/ticket-02-fallback-dual-history-contract.md) remains accepted by the owner per [Decision 0055](./decisions/0055-ticket-02-fallback-dual-history-contract-approved.md).

Current boundary: Decision 0056 authorizes exactly the Gate source/test write set and four evidence artifacts, the source-candidate-before-measurement and evidence-only-after-measurement commit ordering, focused unit tests, and two stable-Chromium runs with `pipefail`, explicit `PIPESTATUS[0]` exit capture, and separate immutable logs. It claims no AC and no Ticket 02 acceptance. All later work packages (outcomes/assets/failure, cap/lifecycle, accessibility, native-image gate, final integration), production WebSocket/lifecycle/persistence/navigation, final review and Supervisor acceptance, package/lockfile changes, protected Agentation work, and `bun fmt`/`bun lint`/`bun typecheck` remain prohibited pending post-Gate governance reassessment. A Gate PASS routes to that reassessment, not to a later WP; a Gate FAIL stops, preserves evidence, and returns to the Supervisor/owner.
