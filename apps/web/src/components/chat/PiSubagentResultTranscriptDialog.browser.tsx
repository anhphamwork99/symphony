// FILE: PiSubagentResultTranscriptDialog.browser.tsx
// Purpose: Ticket 12 (T12-AC3/AC4) browser result/transcript view boundary
// with large output and continuation fixtures: bounded pages load by cursor,
// "Load more" continues through the artifact, truncation and availability
// diagnostics render, and the durable observed state is echoed verbatim
// (transcript availability is never presented as liveness — T12-AC6).

import "../../index.css";

import type {
  PiSubagentExecutionCard,
  PiSubagentResultReadResult,
  PiSubagentTranscriptEntry,
} from "@synara/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PiSubagentResultTranscriptDialog } from "./PiSubagentResultTranscriptDialog";

function makeCard(overrides: Partial<PiSubagentExecutionCard> = {}): PiSubagentExecutionCard {
  return {
    executionId: "exec-t12-ui",
    attemptId: "exec-t12-ui_att1",
    generation: 1,
    projectId: "project-1",
    parentThreadId: "thread-pi-ui",
    parentTurnId: null,
    parentToolCallId: null,
    agentType: "worker",
    mode: "foreground",
    cancellationScope: "parent_turn",
    desiredState: "succeeded",
    observedState: "succeeded",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:01:00.000Z",
    ...overrides,
  } as PiSubagentExecutionCard;
}

const makeEntry = (index: number, content: string): PiSubagentTranscriptEntry => ({
  index,
  type: index % 2 === 0 ? "assistant" : "user",
  content,
  truncated: false,
  timestamp: "2026-08-19T00:00:30.000Z",
});

describe("Pi subagent result/transcript dialog", () => {
  it("loads the bounded result and first page, then continues through Load more (T12-AC3)", async () => {
    const pages = [
      {
        entries: Array.from({ length: 3 }, (_, i) => makeEntry(i, `page1 entry ${i}`)),
        nextCursor: 3,
        hasMore: true,
        skippedCorruptEntries: 0,
        observedState: "succeeded",
      },
      {
        entries: [makeEntry(3, "page2 final entry")],
        nextCursor: null,
        hasMore: false,
        skippedCorruptEntries: 0,
        observedState: "succeeded",
      },
    ];
    const readTranscriptPage = vi
      .fn()
      .mockResolvedValueOnce(pages[0])
      .mockResolvedValueOnce(pages[1]);
    const readResult = vi.fn().mockResolvedValue({
      executionId: "exec-t12-ui",
      observedState: "succeeded",
      terminalState: "succeeded",
      summary: "Delegated work completed with a bounded summary.",
      summaryTruncated: false,
      transcriptRef: "/tmp/pi-subagents-x/tasks/exec.output",
    } satisfies PiSubagentResultReadResult);

    const mounted = await render(
      <PiSubagentResultTranscriptDialog
        card={makeCard()}
        open
        onOpenChange={() => undefined}
        readResult={readResult}
        readTranscriptPage={readTranscriptPage}
      />,
    );

    await expect
      .element(page.getByText("Delegated work completed with a bounded summary."))
      .toBeInTheDocument();
    await expect.element(page.getByText("page1 entry 0")).toBeInTheDocument();

    const loadMore = page.getByTestId("pi-subagent-transcript-load-more");
    await loadMore.click();

    await expect.element(page.getByText("page2 final entry")).toBeInTheDocument();
    expect(readTranscriptPage).toHaveBeenCalledTimes(2);
    expect(readTranscriptPage).toHaveBeenLastCalledWith({
      executionId: "exec-t12-ui",
      cursor: 3,
      limit: 50,
    });
    // The continuation button disappears when the artifact is exhausted.
    expect(page.getByTestId("pi-subagent-transcript-load-more").elements()).toHaveLength(0);
    await mounted.unmount();
  });

  it("renders the truncation diagnostic and continuation for a capped summary (T12-AC4)", async () => {
    const readResult = vi.fn().mockResolvedValue({
      executionId: "exec-t12-ui",
      observedState: "succeeded",
      terminalState: "succeeded",
      summary: "x".repeat(4000),
      summaryTruncated: true,
      diagnosticCode: "pi_subagent_result_truncated",
      transcriptRef: "/tmp/pi-subagents-x/tasks/exec.output",
    } satisfies PiSubagentResultReadResult);
    const readTranscriptPage = vi.fn().mockResolvedValue({
      entries: [makeEntry(0, "transcript continuation entry")],
      nextCursor: null,
      hasMore: false,
      skippedCorruptEntries: 0,
      observedState: "succeeded",
    });

    const mounted = await render(
      <PiSubagentResultTranscriptDialog
        card={makeCard()}
        open
        onOpenChange={() => undefined}
        readResult={readResult}
        readTranscriptPage={readTranscriptPage}
      />,
    );

    await expect.element(page.getByTestId("pi-subagent-result-truncated")).toBeInTheDocument();
    await expect.element(page.getByText("transcript continuation entry")).toBeInTheDocument();
    await mounted.unmount();
  });

  it("renders the stable unavailable diagnostic and never claims liveness (T12-AC6/AC7)", async () => {
    const readResult = vi.fn().mockResolvedValue({
      executionId: "exec-t12-ui",
      observedState: "orphaned",
      summary: null,
      summaryTruncated: false,
      transcriptRef: null,
    } satisfies PiSubagentResultReadResult);
    const readTranscriptPage = vi.fn().mockResolvedValue({
      entries: [],
      nextCursor: null,
      hasMore: false,
      skippedCorruptEntries: 0,
      observedState: "orphaned",
      diagnosticCode: "pi_subagent_transcript_missing",
    });

    const mounted = await render(
      <PiSubagentResultTranscriptDialog
        card={makeCard({ observedState: "orphaned", desiredState: "running" })}
        open
        onOpenChange={() => undefined}
        readResult={readResult}
        readTranscriptPage={readTranscriptPage}
      />,
    );

    await expect.element(page.getByText(/no longer available on the server/i)).toBeInTheDocument();
    await expect.element(page.getByTestId("pi-subagent-transcript-empty")).toBeInTheDocument();
    // The header echoes the durable observed state verbatim — "Orphaned",
    // never "Running": an available transcript is not liveness evidence.
    await expect.element(page.getByText("Orphaned")).toBeInTheDocument();
    await mounted.unmount();
  });

  it("surfaces read denials without corrupting the view (T12-AC1/AC2)", async () => {
    const readResult = vi.fn().mockRejectedValue(new Error("Subagent execution not found."));
    const readTranscriptPage = vi.fn().mockResolvedValue({
      entries: [],
      nextCursor: null,
      hasMore: false,
      skippedCorruptEntries: 0,
      observedState: "succeeded",
    });

    const mounted = await render(
      <PiSubagentResultTranscriptDialog
        card={makeCard()}
        open
        onOpenChange={() => undefined}
        readResult={readResult}
        readTranscriptPage={readTranscriptPage}
      />,
    );

    await expect.element(page.getByText("Subagent execution not found.")).toBeInTheDocument();
    await mounted.unmount();
  });

  it("stops continuing after a page that returns zero entries (all-corrupt stretch guard)", async () => {
    const readResult = vi.fn().mockResolvedValue({
      executionId: "exec-t12-ui",
      observedState: "succeeded",
      terminalState: "succeeded",
      summary: "done",
      summaryTruncated: false,
      transcriptRef: "/tmp/pi-subagents-x/tasks/exec.output",
    } satisfies PiSubagentResultReadResult);
    const readTranscriptPage = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [makeEntry(0, "first entry")],
        nextCursor: 1,
        hasMore: true,
        skippedCorruptEntries: 0,
        observedState: "succeeded",
      })
      // An all-corrupt stretch: the server claims more but returns nothing.
      .mockResolvedValueOnce({
        entries: [],
        nextCursor: 5,
        hasMore: true,
        skippedCorruptEntries: 4,
        observedState: "succeeded",
        diagnosticCode: "pi_subagent_transcript_corrupt",
      });

    const mounted = await render(
      <PiSubagentResultTranscriptDialog
        card={makeCard()}
        open
        onOpenChange={() => undefined}
        readResult={readResult}
        readTranscriptPage={readTranscriptPage}
      />,
    );

    await expect.element(page.getByText("first entry")).toBeInTheDocument();
    const loadMore = page.getByTestId("pi-subagent-transcript-load-more");
    await loadMore.click();

    // The empty-but-hasMore page must NOT keep the continuation affordance
    // alive — that would loop empty fetches forever.
    await vi.waitFor(() => {
      expect(page.getByTestId("pi-subagent-transcript-load-more").elements()).toHaveLength(0);
    });
    expect(readTranscriptPage).toHaveBeenCalledTimes(2);
    await mounted.unmount();
  });
});
