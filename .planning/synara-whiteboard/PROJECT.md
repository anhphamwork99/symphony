# Synara Whiteboard

Owner: repository owner
Lifecycle: implementation
Triage: ready-for-agent
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

Owner-confirmed product discovery and targeted risk grilling completed on 2026-08-26. The refreshed spec and accepted Testing Strategy Governance Reassessment are the normative implementation handoff.

Accepted: [01 — Prove the Excalidraw integration boundary](./issues/01-prove-excalidraw-integration-boundary.md), finalized by [Decision 0050](./decisions/0050-ticket-01-final-acceptance-hold-removed.md).

Current frontier: [02 — Prove exact AI edit-batch Undo and Redo](./issues/02-prove-ai-batch-undo-redo.md).

Active bounded phase: Ticket 02 is `researching-package-boundary` under [Decision 0053](./decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md). Research first reassesses Excalidraw versions and documented public APIs for a supported host-owned single-route history boundary; no package upgrade, lockfile change, or implementation is authorized before that evidence is recorded.

Current blocker: Decision 0052's real-Chromium public timing remediation remains exhausted and AC4/AC7 remain failed for the measured `0.18.1` candidate. Broad Ticket 02 work remains prohibited. If the bounded research finds no supported public boundary, the owner has pre-authorized the fallback of native Excalidraw Undo/Redo for human edits plus dedicated Synara `Undo AI batch`/`Redo AI batch` actions; that fallback is not activated until the research result and revised implementation route are recorded.
