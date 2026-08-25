// FILE: piSubagentExecutionCardPresentation.test.ts
// Purpose: Ticket 03 (T03-AC2–AC5) exhaustive whole-card presentation table
// tests: the accepted precedence (terminal; orphaned; teardown uncertainty;
// cancellation intent; detached current running; ordinary observed state),
// exact labels, live/spinner truth, control affordances, old-shape null
// conservatism, and stale-field immunity. Pure-function boundary — no React.
// Layer: Web presentation logic tests
// Depends on: @synara/contracts card type.

import type { PiSubagentExecutionCard } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_CANCELLATION_UNVERIFIED_LABEL,
  PI_SUBAGENT_CANCELLING_LABEL,
  PI_SUBAGENT_ORPHANED_LABEL,
  PI_SUBAGENT_RUNNING_IN_BACKGROUND_LABEL,
  piSubagentExecutionCardElapsedSeconds,
  piSubagentExecutionCardIsRetainedInActiveStrip,
  piSubagentExecutionCardPresentation,
  piSubagentExecutionCardTurnLabel,
} from "./piSubagentExecutionCardPresentation";
import type { PiSubagentExecutionCardPresentationKind } from "./piSubagentExecutionCardPresentation";

function makeCard(overrides: Partial<PiSubagentExecutionCard> = {}): PiSubagentExecutionCard {
  return {
    executionId: "exec-t03",
    attemptId: "exec-t03_att1",
    generation: 1,
    projectId: "project-1",
    parentThreadId: "thread-pi-1",
    parentTurnId: null,
    parentToolCallId: null,
    agentType: "worker",
    mode: "foreground",
    cancellationScope: "parent_turn",
    desiredState: "running",
    observedState: "running",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:01.000Z",
    ...overrides,
  } as PiSubagentExecutionCard;
}

describe("Ticket 03 whole-card presentation precedence (T03-AC2–AC5)", () => {
  it("T03-AC2: current detached running with a live owner presents Running in background", () => {
    const presentation = piSubagentExecutionCardPresentation(
      makeCard({ observedState: "running", currentAttachment: "detached" }),
    );
    expect(presentation.kind).toBe("running-background");
    expect(presentation.label).toBe(PI_SUBAGENT_RUNNING_IN_BACKGROUND_LABEL);
    expect(presentation.live).toBe(true);
    expect(presentation.spinner).toBe(true);
    expect(presentation.showCancel).toBe(true);
    expect(presentation.cancelDisabled).toBe(false);
    expect(presentation.showResume).toBe(false);
  });

  it("T03-AC2: attached or old-null (absent-field) running NEVER presents Running in background", () => {
    for (const currentAttachment of ["attached", null] as const) {
      const presentation = piSubagentExecutionCardPresentation(
        makeCard({ observedState: "running", currentAttachment }),
      );
      expect(presentation.kind).toBe("observed");
      expect(presentation.label).toBe("Running");
      expect(presentation.live).toBe(true);
      expect(presentation.spinner).toBe(true);
      expect(presentation.showCancel).toBe(true);
    }
    // A card whose fields are entirely ABSENT (pre-Ticket-03 replay shape)
    // decodes to null and falls back conservatively the same way.
    const legacy = { ...makeCard({ observedState: "running" }) } as Record<string, unknown>;
    delete legacy.currentAttachment;
    delete legacy.currentTeardownEvidence;
    const legacyPresentation = piSubagentExecutionCardPresentation(
      legacy as unknown as PiSubagentExecutionCard,
    );
    expect(legacyPresentation.kind).toBe("observed");
    expect(legacyPresentation.label).toBe("Running");
  });

  it("T03-AC3: desired cancellation overrides an observed running label", () => {
    const presentation = piSubagentExecutionCardPresentation(
      makeCard({
        observedState: "running",
        desiredState: "cancelling",
        currentAttachment: "detached",
      }),
    );
    expect(presentation.kind).toBe("cancelling");
    expect(presentation.label).toBe(PI_SUBAGENT_CANCELLING_LABEL);
    expect(presentation.live).toBe(true);
    expect(presentation.spinner).toBe(true);
    // Cancel stays visible but disabled while durable cancellation is in flight.
    expect(presentation.showCancel).toBe(true);
    expect(presentation.cancelDisabled).toBe(true);
    expect(presentation.showResume).toBe(false);
  });

  it("T03-AC3: observed cancelling presents Cancelling even without a desired-state change", () => {
    const presentation = piSubagentExecutionCardPresentation(
      makeCard({ observedState: "cancelling", desiredState: "running" }),
    );
    expect(presentation.kind).toBe("cancelling");
    expect(presentation.label).toBe(PI_SUBAGENT_CANCELLING_LABEL);
  });

  it("T03-AC3: survivors and owner_unproven present Cancellation unverified without a stopped claim", () => {
    for (const currentTeardownEvidence of ["survivors", "owner_unproven"] as const) {
      const presentation = piSubagentExecutionCardPresentation(
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence,
        }),
      );
      expect(presentation.kind).toBe("unverified");
      expect(presentation.label).toBe(PI_SUBAGENT_CANCELLATION_UNVERIFIED_LABEL);
      expect(presentation.live).toBe(false);
      expect(presentation.spinner).toBe(false);
      expect(presentation.showCancel).toBe(false);
      expect(presentation.cancelDisabled).toBe(false);
      expect(presentation.showResume).toBe(false);
      // Bounded static explanatory copy distinguishes the two bands and never
      // makes a POSITIVE stopped/cancelled claim — the hedge sentence is the
      // only place those words may appear, and it asserts the opposite.
      expect(presentation.detailMessage).not.toBeNull();
      const detail = presentation.detailMessage!;
      const positiveClaim = /\b(?:is|was|has)\s+(?:stopped|cancelled)\b/i;
      for (const sentence of detail.split(".")) {
        if (positiveClaim.test(sentence) && !/cannot claim/i.test(sentence)) {
          expect.unreachable(`detail copy makes an unbacked claim: ${sentence}`);
        }
      }
      expect(detail).toMatch(/cannot claim/i);
    }
    // The two bands carry distinct copy.
    const survivors = piSubagentExecutionCardPresentation(
      makeCard({ currentTeardownEvidence: "survivors" }),
    );
    const ownerUnproven = piSubagentExecutionCardPresentation(
      makeCard({ currentTeardownEvidence: "owner_unproven" }),
    );
    expect(survivors.detailMessage).not.toBe(ownerUnproven.detailMessage);
  });

  it("T03-AC3: teardown band requested alone does not relabel beyond durable cancellation intent", () => {
    // With cancellation intent: follows the intent (Cancelling), not uncertainty.
    const withIntent = piSubagentExecutionCardPresentation(
      makeCard({
        observedState: "running",
        desiredState: "cancelling",
        currentTeardownEvidence: "requested",
      }),
    );
    expect(withIntent.kind).toBe("cancelling");
    expect(withIntent.label).toBe(PI_SUBAGENT_CANCELLING_LABEL);
    expect(withIntent.detailMessage).toBeNull();

    // Without cancellation intent: ordinary observed truth — no uncertainty,
    // no relabel, no detail copy.
    const withoutIntent = piSubagentExecutionCardPresentation(
      makeCard({
        observedState: "running",
        desiredState: "running",
        currentAttachment: "detached",
        currentTeardownEvidence: "requested",
      }),
    );
    expect(withoutIntent.kind).toBe("running-background");
    expect(withoutIntent.label).toBe(PI_SUBAGENT_RUNNING_IN_BACKGROUND_LABEL);
    expect(withoutIntent.detailMessage).toBeNull();
  });

  it("T03-AC4: orphaned presents the exact label with no spinner, no Cancel, and Resume only", () => {
    const presentation = piSubagentExecutionCardPresentation(
      makeCard({
        observedState: "orphaned",
        desiredState: "running",
        // Stale attachment truth must not rescue the label (T03-AC5).
        currentAttachment: "detached",
        currentTeardownEvidence: "none",
      }),
    );
    expect(presentation.kind).toBe("orphaned");
    expect(presentation.label).toBe(PI_SUBAGENT_ORPHANED_LABEL);
    expect(presentation.label).toBe("Outcome unknown (orphaned)");
    expect(presentation.live).toBe(false);
    expect(presentation.spinner).toBe(false);
    expect(presentation.showCancel).toBe(false);
    expect(presentation.showResume).toBe(true);
    expect(presentation.detailMessage).not.toBeNull();
  });

  it("T03-AC5: committed terminal truth ignores stale attachment and teardown fields", () => {
    for (const observedState of ["succeeded", "failed"] as const) {
      const presentation = piSubagentExecutionCardPresentation(
        makeCard({
          observedState,
          desiredState: observedState,
          // Stale live-work truth must never mutate a settled card.
          currentAttachment: "detached",
          currentTeardownEvidence: "survivors",
        }),
      );
      expect(presentation.kind).toBe("terminal");
      expect(presentation.label).toBe(observedState === "succeeded" ? "Succeeded" : "Failed");
      expect(presentation.live).toBe(false);
      expect(presentation.spinner).toBe(false);
      expect(presentation.showCancel).toBe(false);
      expect(presentation.showResume).toBe(false);
      expect(presentation.detailMessage).toBeNull();
    }
  });

  it("T03: ordinary observed states fall through to the per-state presentation", () => {
    const cases: ReadonlyArray<[PiSubagentExecutionCard["observedState"], string, boolean]> = [
      ["requested", "Requested", true],
      ["accepted", "Accepted", true],
      ["queued", "Queued", true],
      ["running", "Running", true],
      ["cancelled", "Cancelled", false],
      ["rejected", "Rejected", false],
    ];
    for (const [observedState, label, live] of cases) {
      const presentation = piSubagentExecutionCardPresentation(
        makeCard({ observedState, desiredState: observedState }),
      );
      expect(presentation.kind).toBe("observed");
      expect(presentation.label).toBe(label);
      expect(presentation.live).toBe(live);
      expect(presentation.spinner).toBe(live);
      expect(presentation.showCancel).toBe(live);
      expect(presentation.showResume).toBe(false);
    }
  });

  it("T03: exhaustive precedence table — every band wins over the bands below it", () => {
    // Each row's card carries ALL lower-precedence truth; only the top band
    // may decide the presentation.
    const table: ReadonlyArray<
      [string, PiSubagentExecutionCard, string, PiSubagentExecutionCardPresentationKind]
    > = [
      [
        "terminal over everything",
        makeCard({
          observedState: "succeeded",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence: "survivors",
        }),
        "Succeeded",
        "terminal",
      ],
      [
        "orphaned over uncertainty/cancel/detach",
        makeCard({
          observedState: "orphaned",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence: "owner_unproven",
        }),
        PI_SUBAGENT_ORPHANED_LABEL,
        "orphaned",
      ],
      [
        "uncertainty over cancel intent and detach",
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence: "survivors",
        }),
        PI_SUBAGENT_CANCELLATION_UNVERIFIED_LABEL,
        "unverified",
      ],
      [
        "cancel intent over detached running",
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence: "none",
        }),
        PI_SUBAGENT_CANCELLING_LABEL,
        "cancelling",
      ],
      [
        "detached current running is its own band",
        makeCard({
          observedState: "running",
          desiredState: "running",
          currentAttachment: "detached",
          currentTeardownEvidence: "none",
        }),
        PI_SUBAGENT_RUNNING_IN_BACKGROUND_LABEL,
        "running-background",
      ],
      [
        "attached running is ordinary",
        makeCard({
          observedState: "running",
          desiredState: "running",
          currentAttachment: "attached",
          currentTeardownEvidence: "none",
        }),
        "Running",
        "observed",
      ],
    ];
    for (const [name, card, label, kind] of table) {
      const presentation = piSubagentExecutionCardPresentation(card);
      expect(presentation.kind, name).toBe(kind);
      expect(presentation.label, name).toBe(label);
    }
  });
});

describe("Ticket 11 active-strip card helpers", () => {
  it("retains active states, orphaned cards, and teardown-unverified cards", () => {
    const activeStates: Array<PiSubagentExecutionCard["observedState"]> = [
      "requested",
      "accepted",
      "queued",
      "running",
      "cancelling",
      "orphaned",
    ];
    for (const observedState of activeStates) {
      expect(
        piSubagentExecutionCardIsRetainedInActiveStrip(
          makeCard({ observedState, desiredState: observedState }),
        ),
        observedState,
      ).toBe(true);
    }

    expect(
      piSubagentExecutionCardIsRetainedInActiveStrip(
        makeCard({ observedState: "running", currentTeardownEvidence: "survivors" }),
      ),
    ).toBe(true);
  });

  it("excludes every committed outcome, including stale live evidence", () => {
    for (const observedState of ["succeeded", "failed", "cancelled", "rejected"] as const) {
      expect(
        piSubagentExecutionCardIsRetainedInActiveStrip(
          makeCard({
            observedState,
            desiredState: "cancelling",
            currentAttachment: "detached",
            currentTeardownEvidence: "survivors",
          }),
        ),
        observedState,
      ).toBe(false);
    }
  });

  it("derives elapsed whole seconds and clamps invalid or future timestamps", () => {
    const nowMs = Date.parse("2026-08-21T00:00:11.999Z");
    expect(
      piSubagentExecutionCardElapsedSeconds(
        makeCard({ createdAt: "2026-08-21T00:00:00.000Z" }),
        nowMs,
      ),
    ).toBe(11);
    expect(
      piSubagentExecutionCardElapsedSeconds(
        makeCard({ createdAt: "2026-08-21T00:00:12.000Z" }),
        nowMs,
      ),
    ).toBe(0);
    expect(
      piSubagentExecutionCardElapsedSeconds(makeCard({ createdAt: "not-a-date" }), nowMs),
    ).toBe(0);
    expect(piSubagentExecutionCardElapsedSeconds(makeCard(), Number.NaN)).toBe(0);
  });

  it("formats bounded and unbounded turn labels, including edge counts", () => {
    expect(
      piSubagentExecutionCardTurnLabel(makeCard({ turnCount: 1, maxTurns: 3 })),
    ).toBe("1/3 turns");
    expect(
      piSubagentExecutionCardTurnLabel(makeCard({ turnCount: 3, maxTurns: 3 })),
    ).toBe("3/3 turns");
    expect(
      piSubagentExecutionCardTurnLabel(makeCard({ turnCount: 4, maxTurns: 3 })),
    ).toBe("4 turns");
    expect(piSubagentExecutionCardTurnLabel(makeCard({ turnCount: 1, maxTurns: null }))).toBe(
      "1 turn",
    );
    expect(piSubagentExecutionCardTurnLabel(makeCard({ turnCount: 0, maxTurns: null }))).toBe(
      "0 turns",
    );
    expect(piSubagentExecutionCardTurnLabel(makeCard({ turnCount: null, maxTurns: 3 }))).toBeNull();
  });
});
