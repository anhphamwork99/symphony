// FILE: PiSubagentExecutionCardStrip.tsx
// Purpose: Ticket 11 (T11-AC4/AC5/AC6/AC8) reconnectable execution-card strip
// stacked above the composer: one row per managed Pi subagent execution of the
// active thread (live states first, then terminal). Rows render the lifecycle
// state (all eight states), the bounded diagnostics, the terminal summary, and
// the completion-delivery badge; an authorized Cancel button dispatches the
// durable per-execution cancel command and stays visibly `cancelling` until
// the server's journal-first acknowledgement projects a new card. Card state
// changes never touch the transcript auto-follow path (T11-AC7) — the strip is
// composer chrome, not a transcript message.
// Layer: Chat composer UI
// Exports: PiSubagentExecutionCardStrip

import type { PiSubagentExecutionCard } from "@synara/contracts";
import { useEffect, useState } from "react";

import { FileIcon, LoaderIcon, RotateCcwIcon, StopIcon } from "~/lib/icons";
import {
  PI_SUBAGENT_LEGACY_UNMANAGED_LABEL,
  piSubagentExecutionStatePresentation,
} from "~/lib/piSubagentExecutionCardPresentation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { ComposerStackedPanel } from "./ComposerStackedPanel";

/** Live-first, oldest-first ordering for stable rendering. */
function orderCards(cards: ReadonlyArray<PiSubagentExecutionCard>): PiSubagentExecutionCard[] {
  return [...cards].toSorted((left, right) => {
    const leftLive = piSubagentExecutionStatePresentation(left.observedState).live ? 0 : 1;
    const rightLive = piSubagentExecutionStatePresentation(right.observedState).live ? 0 : 1;
    if (leftLive !== rightLive) {
      return leftLive - rightLive;
    }
    return left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0;
  });
}

function formatCardTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toLocaleTimeString();
}

interface ExecutionRowProps {
  readonly card: PiSubagentExecutionCard;
  readonly onRowExpandedChange: (executionId: string, expanded: boolean) => void;
  readonly expanded: boolean;
  readonly onCancel: (card: PiSubagentExecutionCard) => void;
  readonly cancelPending: boolean;
  /** Ticket 14 (T14-AC6): explicit resume of ONE orphaned execution. */
  readonly onResume?: (card: PiSubagentExecutionCard) => void;
  readonly resumePending?: boolean;
  /** Ticket 12 (T12-AC3/AC4): opens the authorized result/transcript view. */
  readonly onOpenDetails: (card: PiSubagentExecutionCard) => void;
}

function ExecutionRow({
  card,
  onRowExpandedChange,
  expanded,
  onCancel,
  cancelPending,
  onResume,
  resumePending,
  onOpenDetails,
}: ExecutionRowProps) {
  const presentation = piSubagentExecutionStatePresentation(card.observedState);
  const diagnostic =
    card.diagnosticMessage ??
    (card.diagnosticCode !== undefined ? String(card.diagnosticCode) : null);
  const hasDetails =
    diagnostic !== null ||
    card.terminalSummary != null ||
    card.lastProgressSummary != null ||
    card.droppedProgressCount !== undefined;
  const cancelVisible = presentation.live;
  // `cancelling` desired state (or observed) keeps the cancel affordance
  // disabled: the durable intent is recorded and the card stays visibly
  // cancelling until the server acknowledges (T11-AC6).
  const cancelling = card.desiredState === "cancelling" || card.observedState === "cancelling";

  return (
    <div className="flex flex-col gap-1" data-pi-subagent-execution-id={card.executionId}>
      <div className="flex items-center gap-2">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", presentation.dotClassName)}
          aria-hidden="true"
        />
        <span className={cn("text-xs font-medium", presentation.textToneClassName)}>
          {presentation.label}
        </span>
        {presentation.live ? (
          <LoaderIcon className={cn("size-3 animate-spin", presentation.textToneClassName)} />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
          {card.agentType}
        </span>
        {card.deliveryState !== undefined ? (
          <span className="shrink-0 rounded bg-muted-foreground/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/60">
            delivery: {card.deliveryState.replace("_", " ")}
          </span>
        ) : null}
        {cancelVisible ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 shrink-0"
            disabled={cancelPending || cancelling}
            title={
              cancelling ? "Cancelling — waiting for server acknowledgement" : "Cancel execution"
            }
            onClick={() => onCancel(card)}
          >
            {cancelling ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <StopIcon className="size-3" />
            )}
          </Button>
        ) : null}
        {/* Ticket 14 (T14-AC6): explicit resume affordance — ONLY an orphaned
            execution offers it. The dispatch is the explicit user action; no
            automatic path produces the resume command. */}
        {card.observedState === "orphaned" && onResume ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 shrink-0"
            disabled={resumePending === true}
            title="Resume execution with a new attempt"
            aria-label={`Resume execution ${card.executionId}`}
            onClick={() => onResume(card)}
          >
            {resumePending === true ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <RotateCcwIcon className="size-3" />
            )}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0"
          title="View result and transcript"
          aria-label={`View result and transcript for execution ${card.executionId}`}
          onClick={() => onOpenDetails(card)}
        >
          <FileIcon className="size-3" />
        </Button>
        {hasDetails ? (
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:bg-muted-foreground/10"
            aria-label={expanded ? "Collapse execution details" : "Expand execution details"}
            onClick={() => onRowExpandedChange(card.executionId, !expanded)}
          >
            <DisclosureChevron open={expanded} className="size-3.5" />
          </button>
        ) : null}
      </div>
      {hasDetails ? (
        <DisclosureRegion open={expanded}>
          <div className="flex flex-col gap-1 pl-3.5 pr-1 text-xs text-muted-foreground/75">
            {card.lastProgressSummary ? (
              <span className="truncate" title={card.lastProgressSummary}>
                {card.lastProgressSummary}
                {formatCardTimestamp(card.lastProgressAt) !== null
                  ? ` · ${formatCardTimestamp(card.lastProgressAt)}`
                  : ""}
              </span>
            ) : null}
            {card.terminalSummary ? (
              <span className="line-clamp-3 whitespace-pre-wrap">{card.terminalSummary}</span>
            ) : null}
            {card.observedState === "orphaned" ? (
              <span className="text-amber-300/80">
                Owner lost after restart; partial side effects may already exist. Inspect the
                workspace before resuming.
              </span>
            ) : null}
            {diagnostic !== null ? (
              <span className="text-muted-foreground/60">{diagnostic}</span>
            ) : null}
            {card.droppedProgressCount !== undefined && card.droppedProgressCount > 0 ? (
              <span className="text-muted-foreground/50">
                {card.droppedProgressCount} coalesced progress update(s) not shown
              </span>
            ) : null}
            <span className="text-muted-foreground/45">
              execution {card.executionId} · attempt {card.attemptId} · gen {card.generation}
              {card.transcriptRef ? " · transcript ref available" : ""}
            </span>
          </div>
        </DisclosureRegion>
      ) : null}
    </div>
  );
}

export interface PiSubagentExecutionCardStripProps {
  readonly cards: ReadonlyArray<PiSubagentExecutionCard>;
  /**
   * Ticket 11 (T11-AC8): when the parent turn invoked the Pi `Agent` tool
   * without managed-execution identity (legacy/unmanaged session), the strip
   * labels it instead of fabricating a managed record.
   */
  readonly legacyAgentToolActive: boolean;
  readonly onCancelExecution: (card: PiSubagentExecutionCard) => void;
  readonly cancelPendingExecutionId: string | null;
  /** Ticket 14 (T14-AC6): explicit resume dispatcher (orphaned cards only). */
  readonly onResumeExecution?: (card: PiSubagentExecutionCard) => void;
  readonly resumePendingExecutionId?: string | null;
  /** Ticket 12 (T12-AC3/AC4): opens the authorized result/transcript view. */
  readonly onOpenExecutionDetails?: (card: PiSubagentExecutionCard) => void;
  readonly attachedToPrevious?: boolean;
}

export function PiSubagentExecutionCardStrip({
  cards,
  legacyAgentToolActive,
  onCancelExecution,
  cancelPendingExecutionId,
  onResumeExecution,
  resumePendingExecutionId,
  onOpenExecutionDetails,
  attachedToPrevious: attachedToPreviousProp,
}: PiSubagentExecutionCardStripProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const [expandedByExecutionId, setExpandedByExecutionId] = useState<Record<string, boolean>>({});

  // Live (non-terminal) rows start expanded so diagnostics are visible on
  // arrival; terminal rows start collapsed. Only applied once per card.
  useEffect(() => {
    setExpandedByExecutionId((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const card of cards) {
        if (!(card.executionId in next)) {
          next[card.executionId] = piSubagentExecutionStatePresentation(card.observedState).live;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [cards]);

  if (cards.length === 0 && !legacyAgentToolActive) {
    return null;
  }

  const ordered = orderCards(cards);

  return (
    <ComposerStackedPanel
      passthroughSideMargins
      attachedToPrevious={attachedToPrevious}
      data-testid="pi-subagent-execution-card-strip"
    >
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/55">
          <span>Managed subagent executions</span>
          <span className="text-muted-foreground/35">{ordered.length}</span>
        </div>
        {legacyAgentToolActive ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <span
              className="size-1.5 shrink-0 rounded-full bg-muted-foreground/25"
              aria-hidden="true"
            />
            <span>{PI_SUBAGENT_LEGACY_UNMANAGED_LABEL}</span>
            <span className="min-w-0 flex-1 truncate">
              this session runs without the managed-execution bridge
            </span>
          </div>
        ) : null}
        {ordered.map((card) => (
          <ExecutionRow
            key={card.executionId}
            card={card}
            expanded={expandedByExecutionId[card.executionId] ?? false}
            onRowExpandedChange={(executionId, open) =>
              setExpandedByExecutionId((previous) => ({
                ...previous,
                [executionId]: open,
              }))
            }
            onCancel={onCancelExecution}
            cancelPending={cancelPendingExecutionId === card.executionId}
            {...(onResumeExecution !== undefined ? { onResume: onResumeExecution } : {})}
            resumePending={resumePendingExecutionId === card.executionId}
            onOpenDetails={onOpenExecutionDetails ?? (() => undefined)}
          />
        ))}
      </div>
    </ComposerStackedPanel>
  );
}
