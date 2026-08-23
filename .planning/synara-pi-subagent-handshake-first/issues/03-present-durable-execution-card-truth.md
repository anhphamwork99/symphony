# 03 — Present durable execution-card truth

**What to build:** As a Synara desktop user, I see a card that states whether
work is attached, running in the background, cancelling, cancellation
unverified, orphaned, succeeded, or failed based on current durable evidence
and offers only the actions that remain honest.

**Blocked by:** None — Ticket 01 was accepted by Decision 0005.

**Status:** implemented; final acceptance withheld by
[Decision 0013](../decisions/0013-t03-final-acceptance-non-acceptance.md)
(2026-08-23) solely pending owner-authorized `bun fmt`, `bun lint`, and
`bun typecheck` evidence. The independent review passes AC1–AC5; Ticket 04
remains blocked.

**Testing strategy:** [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

- [ ] **AC1:** Card projection includes bounded current-generation attachment
  and teardown-evidence data derived from existing durable state without a
  migration or schema rewrite.
- [ ] **AC2:** A card presents `Running in background` only for a current
  detached execution with a verified live owner.
- [ ] **AC3:** Desired cancellation overrides an observed `running` label;
  teardown uncertainty presents `Cancellation unverified` without a false
  stopped claim.
- [ ] **AC4:** Ownerless/no-terminal execution presents `Outcome unknown
  (orphaned)`, has no spinner or Cancel action, and offers explicit Resume
  only.
- [ ] **AC5:** Terminal and resumed generations do not inherit stale attachment
  or teardown data; snapshot, replay, reconnect, card strip, and details agree
  on the same presentation.

## Testing Seams

**Approval status:** Approved — human owner, 2026-08-21: “đồng ý, tạo testing seam trước đi”.

- **AC1:** The durable card projection boundary — committed lifecycle and
  teardown journal evidence yields bounded current-attempt/current-generation
  card fields. A lower projection seam is justified because attachment and
  teardown history cannot be safely created by UI interaction alone.
- **AC2:** The execution-card snapshot and reconnect boundary — a current
  detached lifecycle event hydrates `Running in background`; stale or terminal
  generations do not.
- **AC3:** The web execution-card presentation boundary — a card whose
  observed state is `running` and desired state is `cancelling` presents
  `Cancelling`; authenticated teardown uncertainty presents `Cancellation
  unverified` with no spinner or repeated Cancel.
- **AC4:** The web execution-card control boundary — orphaned projection shows
  `Outcome unknown (orphaned)`, hides spinner/Cancel, and exposes explicit
  Resume only.
- **AC5:** The snapshot, replay, reconnect, card-strip, and details boundaries
  consume the same whole-card presentation. A stale prior-generation terminal
  or teardown row cannot mutate the current card.

## Implementation Report

**Implementation state:** implemented at candidate `236d4119b`; the one
independent Ticket-03 review passes AC1–AC5. Decision 0013 withholds final
acceptance solely for missing mandatory workspace-check evidence.

### Delivered behavior

- The shared execution-card contract now carries backward-compatible
  `currentAttachment` and `currentTeardownEvidence` fields. Older persisted
  card events decode missing fields to `null`; every fresh server projection
  emits explicit values.
- All four durable card reads derive attachment and teardown truth from the
  existing lifecycle journal, fenced by execution identity, attempt, and
  generation. No migration, DDL, historical rewrite, or backfill was added.
- Current seq-3 detach evidence and background admission project detached
  ownership. Teardown bands project as 75 `requested`, 77 `survivors`, and 78
  `owner_unproven`; band 76 remains fenced history after proven cancellation
  advances the generation. Recorded 77/78 outcomes publish a card update only
  after the durable commit.
- One pure whole-card presentation drives card ordering, expansion, label,
  spinner, Cancel/Resume affordances, and the details header/copy. Its
  precedence is committed terminal, orphaned, teardown uncertainty,
  cancellation intent, detached running, then ordinary lifecycle state.
- The visible labels and controls are now:
  `Running in background` only for current detached running evidence;
  `Cancelling` when cancellation is desired or observed;
  `Cancellation unverified` for current survivors/owner-unproven evidence,
  with no spinner or repeated lifecycle control; and
  `Outcome unknown (orphaned)` with no spinner/Cancel and explicit Resume only.

### Grounding note for review

- **Change surface:** shared card schema; repository and snapshot read
  projection; post-commit teardown card publication; shared web presentation;
  card strip/details consumers; contract, durable projection, reconnect/store,
  component, and browser tests.
- **Callers and impact:** repository row-to-card mapping feeds snapshots and
  the execution-card bridge; orchestration events and WebSocket replay carry
  the same card through unchanged; web snapshot/event hydration stores that
  card for both strip and details.
- **Preserved invariants:** only fenced committed terminal evidence may show
  `Succeeded`/`Failed`; bands 77/78 remain non-terminal; stale attempt or
  generation evidence cannot affect the current card; old persisted events
  remain replay-decodable; pending UI state cannot invent a durable label;
  Ticket 02, the controlled artifact, Pi loader, bridge construction, desktop
  gate, Alfie, transcript scrolling, and Ticket 04 are unchanged.
- **Open questions:** none.

### Acceptance evidence

| Criterion | Evidence | Result |
| --- | --- | --- |
| AC1 | Contract old-shape/default and closed-vocabulary tests; durable card-surface tests over list, identity read, snapshot, seq-3, background admission, bands 75/77/78, and explicit fresh fields | pass |
| AC2 | Current-generation detach/background projection plus whole-card, strip, and reconnect tests for `Running in background`; attached and legacy-null cards remain `Running` | pass |
| AC3 | Desired cancellation precedence; requested versus survivors/owner-unproven state table; no-spinner/no-repeat-control assertions; recorded 77/78 post-commit event publication and replay/stale suppression | pass |
| AC4 | Whole-card, strip, dialog, and targeted ChatView browser journey prove exact orphan label, no spinner/Cancel, and explicit Resume only | pass |
| AC5 | Resume and band-76 generation fences; list/get/snapshot agreement; old-event replay compatibility; snapshot/store/reconnect field preservation; strip and details share one presentation helper | pass |

### Verification

- `cd packages/contracts && bun run test src/piSubagents.test.ts` — 34/34
  passed.
- `cd apps/server && bun run test
  src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts` — 17/17
  passed.
- `cd apps/web && bun run test
  src/lib/piSubagentExecutionCardPresentation.test.ts
  src/components/chat/PiSubagentExecutionCardStrip.test.tsx
  src/piSubagentExecutionCardStore.test.ts
  src/piSubagentExecutionCardReconnect.test.ts` — 40/40 passed.
- Dialog browser boundary — 6/6 passed.
- Targeted ChatView orphan/Resume journey — 1/1 passed.
- A full isolated-port ChatView browser run loaded and executed all 95 cases:
  82 passed, 12 skipped, and the unrelated Issue-550 timing benchmark failed
  its machine-sensitive ratio at `ChatView.browser.tsx:2219`. That benchmark
  is outside this change surface; the Ticket-03 browser journey passed both in
  the full run and in the targeted rerun.

`bun fmt`, `bun lint`, and `bun typecheck` were not run because the owner did
not authorize those heavyweight checks in this conversation.
