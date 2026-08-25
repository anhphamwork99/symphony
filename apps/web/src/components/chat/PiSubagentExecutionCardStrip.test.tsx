// Purpose: Focused unit coverage for the transparent Pi execution active-work
// rail: retention, compact row structure, motion eligibility, truthful static
// diagnostics, turn labels, and durable action authorization.

import type { PiSubagentExecutionCard } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PiSubagentExecutionCardStrip } from "./PiSubagentExecutionCardStrip";

vi.mock("~/lib/icons", () => ({
  LoaderIcon: ({ className }: { className?: string }) => <span className={className} />,
  RotateCcwIcon: () => <span data-testid="resume-icon" />,
  StopIcon: () => <span data-testid="stop-icon" />,
}));

vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("./ComposerStackedPanel", () => ({
  ComposerStackedPanelExecutionStrip: ({ children, ...props }: { children: React.ReactNode }) => (
    <div {...props} data-testid="composer-stacked-panel">
      {children}
    </div>
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
    turnCount: null,
    maxTurns: null,
    ...overrides,
  } as PiSubagentExecutionCard;
}

const render = (cards: ReadonlyArray<PiSubagentExecutionCard>) =>
  renderToStaticMarkup(
    <PiSubagentExecutionCardStrip
      cards={cards}
      onCancelExecution={() => {}}
      cancelPendingExecutionId={null}
      onResumeExecution={() => {}}
      resumePendingExecutionId={null}
    />,
  );

describe("PiSubagentExecutionCardStrip", () => {
  it("hides every committed terminal outcome and returns null when none are retained", () => {
    for (const observedState of ["succeeded", "failed", "cancelled", "rejected"] as const) {
      expect(render([makeCard({ observedState, desiredState: observedState })])).toBe("");
    }
  });

  it("retains orphaned and teardown-unverified rows as static truthful diagnostics", () => {
    const markup = render([
      makeCard({
        executionId: "orphaned-exec",
        observedState: "orphaned",
        desiredState: "running",
        diagnosticMessage: "Owner lost after restart",
      }),
      makeCard({
        executionId: "unverified-exec",
        observedState: "running",
        desiredState: "cancelling",
        currentTeardownEvidence: "survivors",
      }),
    ]);

    expect(markup).toContain("Owner lost after restart");
    expect(markup).toContain("could not be proven stopped");
    expect(markup).toContain('data-pi-subagent-dot-grid="static"');
    expect(markup).not.toContain("shimmer");
    expect(markup).not.toContain("animate-pulse");
  });

  it("renders a live row as a nine-dot grid with shimmer progress and fallback", () => {
    const markup = render([
      makeCard({
        lastProgressSummary: null,
        turnCount: 2,
        maxTurns: 4,
      }),
    ]);

    expect(markup).toContain('data-pi-subagent-dot-grid="animated"');
    expect(markup.match(/animate-pulse/g)).toHaveLength(9);
    expect(markup).toContain("[animation-duration:1.2s]");
    expect(markup).toContain("motion-reduce:animate-none");
    expect(markup).toContain("shimmer shimmer-duration-1800 motion-reduce:shimmer-none");
    expect(markup).toContain("Working…");
    expect(markup).toContain("2/4 turns");
  });

  it("keeps the row flat and non-disclosable with the fixed content order", () => {
    const markup = render([
      makeCard({
        agentType: "researcher",
        lastProgressSummary: "Inspecting the workspace",
        turnCount: 1,
        maxTurns: null,
        deliveryState: "acknowledged",
      }),
    ]);

    expect(markup.indexOf("researcher")).toBeLessThan(markup.indexOf("Inspecting the workspace"));
    expect(markup.indexOf("Inspecting the workspace")).toBeLessThan(markup.indexOf("1 turn"));
    expect(markup).not.toContain("delivery:");
    expect(markup).not.toContain("disclosure");
    expect(markup).not.toContain("Expand");
    expect(markup).not.toContain("Collapse");
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it("preserves only the authorized cancel/resume controls", () => {
    const liveMarkup = render([makeCard({ observedState: "running", desiredState: "running" })]);
    expect(liveMarkup).toContain('title="Cancel execution"');
    expect(liveMarkup).not.toContain("Resume execution with a new attempt");

    const orphanedMarkup = render([
      makeCard({ observedState: "orphaned", desiredState: "running" }),
    ]);
    expect(orphanedMarkup).not.toContain("Cancel execution");
    expect(orphanedMarkup).toContain("Resume execution with a new attempt");

    const failedMarkup = render([makeCard({ observedState: "failed", desiredState: "failed" })]);
    expect(failedMarkup).toBe("");
  });
});
