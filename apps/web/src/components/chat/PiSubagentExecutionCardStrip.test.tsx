// FILE: PiSubagentExecutionCardStrip.test.tsx
// Purpose: Ticket 11 (T11-AC4/AC8) web execution-card component boundary over
// complete lifecycle and legacy fixtures: every managed lifecycle state
// renders its label and applicable diagnostics, cancel visibility follows the
// live/cancelling rules, delivery badges and terminal summaries appear, and
// the legacy unmanaged label renders only for legacy sessions.
// Layer: Web chat component tests
// Depends on: renderToStaticMarkup (SSR-safe presentation contracts).

import type { PiSubagentExecutionCard } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PiSubagentExecutionCardStrip } from "./PiSubagentExecutionCardStrip";

vi.mock("~/lib/icons", () => ({
  LoaderIcon: () => null,
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
      ["orphaned", "Orphaned"],
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
