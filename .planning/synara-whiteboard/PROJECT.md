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
- [Ticket 02 public-history boundary research failure and fallback activation](./decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md)

Owner-confirmed product discovery and targeted risk grilling completed on 2026-08-26. The refreshed spec and accepted Testing Strategy Governance Reassessment are the normative implementation handoff.

Accepted: [01 — Prove the Excalidraw integration boundary](./issues/01-prove-excalidraw-integration-boundary.md), finalized by [Decision 0050](./decisions/0050-ticket-01-final-acceptance-hold-removed.md).

Current frontier: [02 — Prove exact AI edit-batch Undo and Redo](./issues/02-prove-ai-batch-undo-redo.md).

Active bounded phase: Ticket 02 is `designing-fallback-history-contract` under [Decision 0054](./decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md). The Decision 0053 version/public-API research gate failed: no examined supported surface provides the required host-owned single-route history boundary. Direction 4 is active for fallback-contract design only; no package upgrade, lockfile change, or source implementation is authorized.

Current blocker: Decision 0052's real-Chromium public timing remediation remains exhausted and AC4/AC7 remain failed for the measured `0.18.1` candidate. The public-boundary research is now recorded as FAIL, and fallback direction 4 is active: native Excalidraw Undo/Redo for human edits plus dedicated Synara `Undo AI batch`/`Redo AI batch` actions. The separate-route interaction, keyboard, cap, and cross-stack semantics still require a fallback contract and owner approval. Existing product acceptance details remain unchanged until that contract is approved; broad Ticket 02 work remains prohibited.
