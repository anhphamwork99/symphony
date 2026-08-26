# 02 — Prove exact AI edit-batch Undo and Redo

**What to build:** Prove with the pinned real Excalidraw embed that one completed, interrupted, or failed partial AI edit batch can be recovered as exactly one user-visible Undo/Redo event without exposing individual streamed updates.

**Bounded by:** [Decision 0053](../decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md) — first research/reassess Excalidraw versions and documented public APIs; if no supported public boundary exists, the owner has pre-authorized the native-human plus dedicated-AI-history fallback.

**Status:** researching-package-boundary

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
- Initial Gate source/evidence: `2d5103b60` / `cd69bc867`.
- Timing-probe source/evidence: `49c679888` / `fe8fa88ed`.
- Review: [Ticket 02 Gate failure verification](../reviews/ticket-02-gate-failure-review.md).

Completed three-progress Synara Undo/Redo is retained as partial evidence. AC4 and AC7 fail because real Chromium observes package-native Undo becoming enabled after a human Delete despite both synchronous public `api.history.clear()` and the one authorized `queueMicrotask` post-commit clear:

```text
mutation:Undo:false:null
```

Broad WP-CORE and later work remains blocked. The owner decision is now recorded in Decision 0053: research supported versions and documented public APIs first; if no supported public boundary exists, use the pre-authorized native-human plus dedicated-AI-history fallback. No implementation direction is active until that research outcome is recorded.

## Active reassessment phase

The owner has now ordered **package/version/public-API research first**. This phase:

1. researches supported Excalidraw versions and documented public APIs for a host-owned single effective history route;
2. records pass/fail against the no-transient native-route, human-capture, exact AI-batch, image/file-restore, and mixed-history criteria in Decision 0053;
3. does not upgrade `@excalidraw/excalidraw`, modify `bun.lock`, change runtime source, or begin broad Ticket 02 work;
4. does not claim that the current `0.18.1` failure proves all versions impossible.

If no supported public boundary passes the research gate, Decision 0053 pre-authorizes the fallback product direction: native Excalidraw Undo/Redo for human edits plus dedicated Synara `Undo AI batch`/`Redo AI batch` actions. That direction changes the mixed human/AI history contract only after the research-fail result is recorded; it does not authorize source implementation in this phase.

**Broad-work prohibition:** WP-CORE, the remaining Ticket 02 matrix, package/lockfile changes, private or undocumented integration, and later-ticket implementation remain prohibited until the reassessment outcome is recorded and a bounded implementation route is authorized.
