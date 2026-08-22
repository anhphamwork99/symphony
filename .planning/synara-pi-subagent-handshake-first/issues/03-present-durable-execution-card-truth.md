# 03 — Present durable execution-card truth

**What to build:** As a Synara desktop user, I see a card that states whether
work is attached, running in the background, cancelling, cancellation
unverified, orphaned, succeeded, or failed based on current durable evidence
and offers only the actions that remain honest.

**Blocked by:** None — Ticket 01 was accepted by Decision 0005.

**Status:** ready-for-agent

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
