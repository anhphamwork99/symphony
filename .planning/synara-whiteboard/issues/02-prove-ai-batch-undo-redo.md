# 02 — Prove exact AI edit-batch Undo and Redo

**What to build:** Prove with the pinned real Excalidraw embed that one completed, interrupted, or failed partial AI edit batch can be recovered as exactly one user-visible Undo/Redo event without exposing individual streamed updates.

**Bounded by:** [Decision 0054](../decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md), following [Decision 0053](../decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md) — the public-boundary research failed, so fallback direction 4 is active for contract design only.

**Status:** awaiting-owner-fallback-contract-approval

- [ ] **AC1:** Multiple progressive scene updates finalize as exactly one user-visible Undo event.
- [ ] **AC2:** One Undo restores the complete pre-batch state for completed, Take-Over-interrupted, and invalid-operation partial batches.
- [ ] **AC3:** Redo restores the finalized batch result, including relevant image references.
- [ ] **AC4:** Toolbar Undo/Redo and `Cmd/Ctrl+Z` use one coherent history route.
- [ ] **AC5:** A new edit after Undo invalidates the Redo branch deterministically.
- [ ] **AC6:** Human events and AI edit batches share a bounded 20-event session history that resets after duplication or restart.
- [ ] **AC7:** If exact one-event behavior cannot be achieved with the pinned package and a Synara-owned recovery boundary, the ticket fails with reproducible evidence and blocks broad implementation.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1–AC6:** Actual embedded Excalidraw browser history boundary — prove toolbar, keyboard, progressive updates, Take Over, partial failure, images, and Redo behavior.
- **AC2, AC3:** Synara-owned pre-batch recovery boundary — verify complete scene and image-reference restoration rather than relying on undocumented editor history assumptions.
- **AC7:** Reproducible real-package feasibility report — no mocked editor may substitute for the blocking result.

## Current gate result

- Binding direction: [Decision 0051](../decisions/0051-ticket-02-exact-batch-history-direction.md).
- Bounded timing Reassessment: [Decision 0052](../decisions/0052-ticket-02-native-history-timing-probe.md).
- Owner package/public-API reassessment: [Decision 0053](../decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md).
- Public-history boundary research failure and fallback activation: [Decision 0054](../decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md).
- Initial Gate source/evidence: `2d5103b60` / `cd69bc867`.
- Timing-probe source/evidence: `49c679888` / `fe8fa88ed`.
- Review: [Ticket 02 Gate failure verification](../reviews/ticket-02-gate-failure-review.md).

Completed three-progress Synara Undo/Redo is retained as partial evidence. AC4 and AC7 fail because real Chromium observes package-native Undo becoming enabled after a human Delete despite both synchronous public `api.history.clear()` and the one authorized `queueMicrotask` post-commit clear:

```text
mutation:Undo:false:null
```

Broad WP-CORE and later work remains blocked. Decision 0054 records that the supported version/public-API research gate failed and activates the pre-authorized fallback: native Excalidraw Undo/Redo for human edits plus dedicated Synara `Undo AI batch`/`Redo AI batch` actions. No source implementation is active; the fallback contract must resolve its separate-route interaction, keyboard, cap, and cross-stack semantics first.

## Active fallback-contract phase

The public-boundary research required by Decision 0053 is complete and failed. This phase:

1. designs a bounded fallback contract for separate native human history and Synara-owned AI-batch history;
2. preserves exact AI-batch event, recovery, asset, no-op, and lifecycle obligations while making unresolved interaction semantics explicit for owner approval;
3. does not modify product acceptance details in this ticket until the fallback contract is approved;
4. does not upgrade `@excalidraw/excalidraw`, modify `bun.lock`, change runtime source, or begin broad Ticket 02 work.

Decision 0054 records the research-fail result and activates the fallback direction. It does not itself rewrite the existing acceptance criteria or authorize source implementation.

## Proposed fallback contract — owner approval required

- [Proposed dual-history contract](../designs/ticket-02-fallback-dual-history-contract.md)
- [Fallback contract challenge review](../reviews/ticket-02-fallback-contract-challenge.md)

The proposed contract is explicitly `Proposed — awaiting owner approval`. It preserves this ticket's current AC1–AC7 language until a binding owner decision deliberately replaces the affected shared-history, keyboard, cap, and native-image clauses. The proposal must not be treated as acceptance evidence or implementation authorization.

**Routing:** `awaiting-owner-fallback-contract-approval`

**Broad-work prohibition:** WP-CORE, the remaining Ticket 02 matrix, package/lockfile changes, private or undocumented integration, source implementation, and later-ticket implementation remain prohibited until the fallback contract is owner-approved, affected acceptance language is deliberately revised, and a bounded implementation route is authorized.
