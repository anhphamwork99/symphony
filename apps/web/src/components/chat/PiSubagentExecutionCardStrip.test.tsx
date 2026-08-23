// FILE: PiSubagentExecutionCardStrip.test.tsx
// Purpose: Ticket 11 (T11-AC4/AC8) + Ticket 03 (T03-AC2–AC5) web
// execution-card component boundary: every managed lifecycle state renders
// its whole-card label, cancel/resume visibility follows the durable
// whole-card truth, detached current running renders Running in background,
// desired cancellation overrides an observed running label, teardown
// uncertainty renders Cancellation unverified without lifecycle controls, and
// the legacy unmanaged label renders only for legacy sessions.
// Layer: Web chat component tests
// Depends on: renderToStaticMarkup (SSR-safe presentation contracts).

import type { PiSubagentExecutionCard } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PiSubagentExecutionCardStrip } from "./PiSubagentExecutionCardStrip";

vi.mock("~/lib/icons", () => ({
  FileIcon: () => null,
  // Spinner affordances render a marker span carrying the animate-spin
  // class so static markup can prove whole-card spinner eligibility.
  LoaderIcon: ({ className }: { className?: string }) => (
    <span data-testid="card-loader" className={className} />
  ),
  RotateCcwIcon: () => null,
  StopIcon: () => null,
}));

vi.mock("../ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} data-testid="card-cancel-button" />
  ),
}));

vi.mock("../ui/DisclosureChevron", () => ({
  DisclosureChevron: () => <span data-testid="disclosure-chevron" />,
}));

vi.mock("../ui/DisclosureRegion", () => ({
  DisclosureRegion: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="disclosure-region">{children}</div>
  ),
}));

vi.mock("./ComposerStackedPanel", () => ({
  ComposerStackedPanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composer-stacked-panel">{children}</div>
  ),
}));

function makeCard(overrides: Partial<PiSubagentExecutionCard> = {}): PiSubagentExecutionCard {
  return {
    executionId: "exec-ui-1",
    attemptId: "exec-ui-1_att1",
    generation: 1,
    projectId: "project-1",
    parentThreadId: "thread-pi-ui",
    parentTurnId: null,
    parentToolCallId: null,
    agentType: "worker",
    mode: "foreground",
    cancellationScope: "parent_turn",
    desiredState: "running",
    observedState: "running",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:01.000Z",
    ...overrides,
  } as PiSubagentExecutionCard;
}

const render = (props: Parameters<typeof PiSubagentExecutionCardStrip>[0]) =>
  renderToStaticMarkup(<PiSubagentExecutionCardStrip {...props} />);

describe("PiSubagentExecutionCardStrip (Ticket 11 component boundary)", () => {
  it("T11-AC4: renders every managed lifecycle state label", () => {
    const cases: ReadonlyArray<[PiSubagentExecutionCard["observedState"], string]> = [
      ["requested", "Requested"],
      ["accepted", "Accepted"],
      ["queued", "Queued"],
      ["running", "Running"],
      ["cancelling", "Cancelling"],
      ["cancelled", "Cancelled"],
      ["succeeded", "Succeeded"],
      ["failed", "Failed"],
      ["orphaned", "Outcome unknown (orphaned)"],
    ];
    for (const [observedState, label] of cases) {
      const markup = render({
        cards: [makeCard({ observedState, desiredState: observedState })],
        legacyAgentToolActive: false,
        onCancelExecution: () => {},
        cancelPendingExecutionId: null,
      });
      expect(markup).toContain(label);
    }
  });

  it("T11-AC4: renders applicable diagnostics, terminal summary, delivery badge, and orphaned guidance", () => {
    const markup = render({
      cards: [
        makeCard({
          observedState: "succeeded",
          desiredState: "succeeded",
          terminalSummary: "Delegated work completed with a bounded summary.",
          deliveryState: "acknowledged",
        }),
        makeCard({
          executionId: "exec-ui-2",
          attemptId: "exec-ui-2_att1",
          observedState: "orphaned",
          desiredState: "orphaned",
          diagnosticCode: "pi_subagent_owner_loss_orphaned",
          diagnosticMessage: "Owner lost after restart",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(markup).toContain("delivery: acknowledged");
    expect(markup).toContain("Owner lost after restart");
    expect(markup).toContain("Inspect the workspace before resuming");
    expect(markup).toContain("exec-ui-1");
    expect(markup).toContain("exec-ui-2");
  });
  it("T11-AC6: cancel affordance renders for live states and disabling text appears while cancelling", () => {
    const liveMarkup = render({
      cards: [makeCard({ observedState: "running" })],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(liveMarkup).toContain("Cancel execution");

    const cancellingMarkup = render({
      cards: [makeCard({ observedState: "running", desiredState: "cancelling" })],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(cancellingMarkup).toContain("waiting for server acknowledgement");
  });

  it("T11-AC6: denial surface — a failed card state never renders a cancel affordance", () => {
    const markup = render({
      cards: [makeCard({ observedState: "failed", desiredState: "failed" })],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(markup).not.toContain("Cancel execution");
    expect(markup).toContain("Failed");
  });

  it("T11-AC8: legacy sessions render the unmanaged label and never a managed record", () => {
    const markup = render({
      cards: [],
      legacyAgentToolActive: true,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(markup).toContain("Unmanaged (legacy)");
    expect(markup).not.toContain("data-pi-subagent-execution-id");

    // Managed sessions never see the legacy label.
    const managedMarkup = render({
      cards: [makeCard()],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(managedMarkup).not.toContain("Unmanaged (legacy)");
    expect(managedMarkup).toContain("data-pi-subagent-execution-id");
  });

  it("T14-AC6: explicit resume affordance renders ONLY for orphaned cards", () => {
    const orphanedMarkup = render({
      cards: [makeCard({ observedState: "orphaned", desiredState: "running" })],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
      onResumeExecution: () => {},
      resumePendingExecutionId: null,
    });
    expect(orphanedMarkup).toContain("Resume execution with a new attempt");

    // A running card never offers resume (it has a live owner path).
    const runningMarkup = render({
      cards: [makeCard({ observedState: "running" })],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
      onResumeExecution: () => {},
      resumePendingExecutionId: null,
    });
    expect(runningMarkup).not.toContain("Resume execution with a new attempt");

    // Terminal cards never offer resume.
    const terminalMarkup = render({
      cards: [makeCard({ observedState: "failed", desiredState: "failed" })],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
      onResumeExecution: () => {},
      resumePendingExecutionId: null,
    });
    expect(terminalMarkup).not.toContain("Resume execution with a new attempt");
  });

  it("T14-AC6: resume pending keeps the affordance disabled while the explicit command is in flight", () => {
    const markup = render({
      cards: [makeCard({ observedState: "orphaned", desiredState: "running" })],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
      onResumeExecution: () => {},
      resumePendingExecutionId: "exec-ui-1",
    });
    expect(markup).toContain('disabled=""');
  });

  it("renders nothing without cards and without a legacy session", () => {
    expect(
      render({
        cards: [],
        legacyAgentToolActive: false,
        onCancelExecution: () => {},
        cancelPendingExecutionId: null,
      }),
    ).toBe("");
  });
});

describe("PiSubagentExecutionCardStrip (Ticket 03 whole-card truth)", () => {
  it("T03-AC2: current detached running renders Running in background with spinner evidence and Cancel", () => {
    const markup = render({
      cards: [
        makeCard({
          observedState: "running",
          desiredState: "running",
          currentAttachment: "detached",
          currentTeardownEvidence: "none",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(markup).toContain("Running in background");
    // Spinner eligibility (the mock renders LoaderIcon as null, but the
    // whole-card spinner flag still gates the animate-spin class).
    expect(markup).toContain("animate-spin");
    expect(markup).toContain('title="Cancel execution"');
  });

  it("T03-AC2: attached and old-null running render the ordinary Running label", () => {
    for (const currentAttachment of ["attached", null] as const) {
      const markup = render({
        cards: [
          makeCard({
            observedState: "running",
            desiredState: "running",
            currentAttachment,
            currentTeardownEvidence: "none",
          }),
        ],
        legacyAgentToolActive: false,
        onCancelExecution: () => {},
        cancelPendingExecutionId: null,
      });
      expect(markup).toContain(">Running<");
      expect(markup).not.toContain("Running in background");
    }
  });

  it("T03-AC3: desired cancelling overrides an observed running label even while detached", () => {
    const markup = render({
      cards: [
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence: "none",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(markup).toContain(">Cancelling<");
    expect(markup).not.toContain("Running in background");
    // Cancel stays visible but disabled while the durable intent is recorded.
    expect(markup).toContain("waiting for server acknowledgement");
  });

  it("T03-AC3: a requested teardown band alone follows cancellation intent and never claims uncertainty", () => {
    const withIntent = render({
      cards: [
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentAttachment: "detached",
          currentTeardownEvidence: "requested",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(withIntent).toContain(">Cancelling<");
    expect(withIntent).not.toContain("Cancellation unverified");

    const withoutIntent = render({
      cards: [
        makeCard({
          observedState: "running",
          desiredState: "running",
          currentAttachment: "detached",
          currentTeardownEvidence: "requested",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(withoutIntent).toContain("Running in background");
    expect(withoutIntent).not.toContain("Cancellation unverified");
  });

  it("T03-AC3: survivors and owner_unproven render Cancellation unverified with no spinner or lifecycle controls", () => {
    for (const currentTeardownEvidence of ["survivors", "owner_unproven"] as const) {
      const markup = render({
        cards: [
          makeCard({
            observedState: "running",
            desiredState: "cancelling",
            currentAttachment: "detached",
            currentTeardownEvidence,
          }),
        ],
        legacyAgentToolActive: false,
        onCancelExecution: () => {},
        cancelPendingExecutionId: null,
        onResumeExecution: () => {},
        resumePendingExecutionId: null,
      });
      expect(markup).toContain(">Cancellation unverified<");
      // No spinner: the row is not live work.
      expect(markup).not.toContain("animate-spin");
      // No Cancel and no Resume: no honest lifecycle action remains.
      expect(markup).not.toContain("Cancel execution");
      expect(markup).not.toContain("Resume execution with a new attempt");
      // Bounded static uncertainty copy renders and never claims stopped.
      expect(markup).toContain("cannot claim the execution was cancelled");
    }
    // The two bands carry distinct explanatory copy.
    const survivors = render({
      cards: [
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentTeardownEvidence: "survivors",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    const unproven = render({
      cards: [
        makeCard({
          observedState: "running",
          desiredState: "cancelling",
          currentTeardownEvidence: "owner_unproven",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(survivors).toContain("could not be proven stopped");
    expect(unproven).toContain("owner could not prove teardown");
  });

  it("T03-AC4: orphaned renders the exact label with no spinner, no Cancel, and Resume only", () => {
    const markup = render({
      cards: [
        makeCard({
          observedState: "orphaned",
          desiredState: "running",
          currentAttachment: null,
          currentTeardownEvidence: null,
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
      onResumeExecution: () => {},
      resumePendingExecutionId: null,
    });
    expect(markup).toContain(">Outcome unknown (orphaned)<");
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("Cancel execution");
    expect(markup).toContain('title="Resume execution with a new attempt"');
  });

  it("T03-AC5: committed terminal labels ignore stale attachment and teardown fields", () => {
    for (const [observedState, label] of [
      ["succeeded", "Succeeded"],
      ["failed", "Failed"],
    ] as const) {
      const markup = render({
        cards: [
          makeCard({
            observedState,
            desiredState: "cancelling",
            // Stale live-work truth must not mutate the settled card.
            currentAttachment: "detached",
            currentTeardownEvidence: "survivors",
          }),
        ],
        legacyAgentToolActive: false,
        onCancelExecution: () => {},
        cancelPendingExecutionId: null,
        onResumeExecution: () => {},
        resumePendingExecutionId: null,
      });
      expect(markup).toContain(`>${label}<`);
      expect(markup).not.toContain("Cancellation unverified");
      expect(markup).not.toContain("Running in background");
      expect(markup).not.toContain("animate-spin");
      expect(markup).not.toContain("Cancel execution");
      expect(markup).not.toContain("Resume execution with a new attempt");
    }
  });

  it("T03: local cancel/resume pending only disables an allowed action and never changes the label", () => {
    const base = render({
      cards: [
        makeCard({
          observedState: "running",
          currentAttachment: "detached",
          currentTeardownEvidence: "none",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    expect(base).toContain("Running in background");
    expect(base).not.toContain('disabled=""');

    const pending = render({
      cards: [
        makeCard({
          observedState: "running",
          currentAttachment: "detached",
          currentTeardownEvidence: "none",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: "exec-ui-1",
    });
    // The durable label is unchanged; only the cancel button is disabled.
    expect(pending).toContain("Running in background");
    expect(pending).toContain("Cancel execution");
    expect(pending).toContain('disabled=""');
  });

  it("T03-AC5: ordering places live whole-card work before non-live unverified/orphaned rows", () => {
    const markup = render({
      cards: [
        makeCard({
          executionId: "exec-order-unverified",
          createdAt: "2026-08-19T00:00:00.000Z",
          observedState: "running",
          desiredState: "cancelling",
          currentTeardownEvidence: "owner_unproven",
        }),
        makeCard({
          executionId: "exec-order-live",
          createdAt: "2026-08-19T00:00:05.000Z",
          observedState: "running",
          desiredState: "running",
          currentAttachment: "detached",
          currentTeardownEvidence: "none",
        }),
      ],
      legacyAgentToolActive: false,
      onCancelExecution: () => {},
      cancelPendingExecutionId: null,
    });
    const liveIndex = markup.indexOf("exec-order-live");
    const unverifiedIndex = markup.indexOf("exec-order-unverified");
    expect(liveIndex).toBeGreaterThan(-1);
    expect(unverifiedIndex).toBeGreaterThan(-1);
    // The NEWER live card still sorts before the OLDER unverified card.
    expect(liveIndex).toBeLessThan(unverifiedIndex);
  });
});
