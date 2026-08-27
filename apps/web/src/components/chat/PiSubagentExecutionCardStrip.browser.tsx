// Purpose: Browser proof for the premium transparent Pi active-work rail at
// the 1500x805 feedback viewport: surface geometry, one-line progress,
// elapsed ticker, reduced-motion behavior, and authorized actions.

import "../../index.css";

import type { PiSubagentExecutionCard } from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerColumnFrame } from "./ComposerColumnFrame";
import { PiSubagentExecutionCardStrip } from "./PiSubagentExecutionCardStrip";

const VIEWPORT = { width: 1_500, height: 805 };

const dotGridForExecution = (executionId: string) =>
  document.querySelector<HTMLElement>(
    `[data-pi-subagent-execution-id="${executionId}"] [data-pi-subagent-dot-grid]`,
  );

function makeCard(
  executionId: string,
  overrides: Partial<PiSubagentExecutionCard> = {},
): PiSubagentExecutionCard {
  return {
    executionId,
    attemptId: `${executionId}_att1`,
    generation: 1,
    projectId: "project-browser",
    parentThreadId: "thread-browser",
    parentTurnId: null,
    parentToolCallId: null,
    agentType: "worker",
    mode: "foreground",
    cancellationScope: "parent_turn",
    desiredState: "running",
    observedState: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    turnCount: 2,
    maxTurns: 4,
    ...overrides,
  } as PiSubagentExecutionCard;
}

function RailHarness() {
  const cards = [
    makeCard("exec-live", {
      agentType: "browser-agent",
      lastProgressSummary:
        "This deliberately long progress update proves that active work remains a single truncated line in the composer rail.",
    }),
    makeCard("exec-orphaned", {
      observedState: "orphaned",
      desiredState: "running",
      diagnosticMessage: "Owner lost after restart",
    }),
  ];

  return (
    <ComposerColumnFrame>
      <div style={{ width: "620px" }}>
        <PiSubagentExecutionCardStrip
          cards={cards}
          onCancelExecution={vi.fn()}
          cancelPendingExecutionId={null}
          onResumeExecution={vi.fn()}
          resumePendingExecutionId={null}
        />
      </div>
    </ComposerColumnFrame>
  );
}

function ToneHarness() {
  const cards = [
    makeCard("exec-running"),
    makeCard("exec-cancelling", { desiredState: "cancelling" }),
    makeCard("exec-unverified", { currentTeardownEvidence: "survivors" }),
    makeCard("exec-orphaned", { observedState: "orphaned" }),
  ];

  return (
    <ComposerColumnFrame>
      <div style={{ width: "620px" }}>
        <PiSubagentExecutionCardStrip
          cards={cards}
          onCancelExecution={vi.fn()}
          cancelPendingExecutionId={null}
          onResumeExecution={vi.fn()}
          resumePendingExecutionId={null}
        />
      </div>
    </ComposerColumnFrame>
  );
}

describe("PiSubagentExecutionCardStrip browser rail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("at 1500x805 is transparent, one-line truncated, live-ticking, and action-complete", async () => {
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
    const screen = await render(<RailHarness />);

    const strip = document.querySelector<HTMLElement>(
      '[data-testid="pi-subagent-execution-card-strip"]',
    );
    const progress = document.querySelector<HTMLElement>('[data-pi-subagent-progress="true"]');
    expect(strip).not.toBeNull();
    expect(progress).not.toBeNull();
    expect(getComputedStyle(strip!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(progress!).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(progress!).textOverflow).toBe("ellipsis");
    expect(progress!.scrollWidth).toBeGreaterThan(progress!.clientWidth);
    expect(document.querySelectorAll('[data-pi-subagent-dot-grid="animated"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-pi-subagent-dot-grid="static"]')).toHaveLength(1);
    for (const row of document.querySelectorAll<HTMLElement>(
      "[data-pi-subagent-execution-row='true']",
    )) {
      expect(row.getBoundingClientRect().height).toBe(32);
    }
    expect(document.body.textContent).toContain("2/4 turns");
    expect(document.body.textContent).toContain("Owner lost after restart");

    const initialElapsed = document.querySelector<HTMLElement>(
      '[data-pi-subagent-execution-id="exec-live"]',
    )?.textContent;
    await new Promise((resolve) => window.setTimeout(resolve, 1_100));
    await vi.waitFor(() => {
      const nextElapsed = document.querySelector<HTMLElement>(
        '[data-pi-subagent-execution-id="exec-live"]',
      )?.textContent;
      expect(nextElapsed).not.toBe(initialElapsed);
    });

    await page.getByRole("button", { name: "Cancel execution" }).click();
    await page.getByRole("button", { name: /Resume execution exec-orphaned/u }).click();
    expect(document.querySelectorAll("button")).toHaveLength(2);

    await screen.unmount();
  });

  it("uses neutral live/orphaned dots and restrained amber uncertainty dots", async () => {
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
    const screen = await render(<ToneHarness />);

    const runningGrid = dotGridForExecution("exec-running");
    const cancellingGrid = dotGridForExecution("exec-cancelling");
    const unverifiedGrid = dotGridForExecution("exec-unverified");
    const orphanedGrid = dotGridForExecution("exec-orphaned");

    expect(runningGrid?.className).toContain("text-muted-foreground/55");
    expect(runningGrid?.className).not.toMatch(/text-(?:sky|cyan)/u);
    expect(cancellingGrid?.className).toContain("text-amber-300/85");
    expect(unverifiedGrid?.className).toContain("text-amber-300/85");
    expect(orphanedGrid?.className).toContain("text-muted-foreground/45");

    await screen.unmount();
  });

  it("ships static reduced-motion fallbacks for both the dot grid and shimmer", async () => {
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
    const screen = await render(<RailHarness />);

    const dot = document.querySelector<HTMLElement>('[data-pi-subagent-dot-grid="animated"] span');
    const progress = document.querySelector<HTMLElement>('[data-pi-subagent-progress="true"]');
    expect(dot).not.toBeNull();
    expect(progress).not.toBeNull();
    expect(dot?.className).toContain("motion-reduce:animate-none");
    expect(progress?.className).toContain("motion-reduce:shimmer-none");
    expect(progress?.className).toContain("shimmer-duration-1800");

    await screen.unmount();
  });
});
