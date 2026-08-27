# Synara Whiteboard

Owner: repository owner
Lifecycle: implementation
Triage: awaiting-owner-fallback-contract-approval
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
- [Proposed Ticket 02 fallback dual-history contract](./designs/ticket-02-fallback-dual-history-contract.md)
- [Ticket 02 fallback contract challenge review](./reviews/ticket-02-fallback-contract-challenge.md)

Owner-confirmed product discovery and targeted risk grilling completed on 2026-08-26. The refreshed spec and accepted Testing Strategy Governance Reassessment are the normative implementation handoff.

Accepted: [01 — Prove the Excalidraw integration boundary](./issues/01-prove-excalidraw-integration-boundary.md), finalized by [Decision 0050](./decisions/0050-ticket-01-final-acceptance-hold-removed.md).

Current frontier: [02 — Prove exact AI edit-batch Undo and Redo](./issues/02-prove-ai-batch-undo-redo.md).

Active bounded phase: Ticket 02 is `awaiting-owner-fallback-contract-approval` under [Decision 0054](./decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md). The proposed [fallback dual-history contract](./designs/ticket-02-fallback-dual-history-contract.md) and [challenge review](./reviews/ticket-02-fallback-contract-challenge.md) synthesize the completed UX design and independent risk review and are explicitly awaiting owner approval.

Current blocker: Decision 0052's real-Chromium public timing remediation remains exhausted and AC4/AC7 remain failed for the measured `0.18.1` candidate. Decision 0054 activated fallback direction 4 for contract design only: native Excalidraw Undo/Redo for human edits plus dedicated Synara `Undo AI batch`/`Redo AI batch` actions. Existing `PRODUCT-CONTRACT.md`, `spec.md`, and Ticket 02 acceptance language remain unchanged until the owner approves a binding amendment. Broad source work, package/lockfile changes, and WP-CORE remain prohibited.
