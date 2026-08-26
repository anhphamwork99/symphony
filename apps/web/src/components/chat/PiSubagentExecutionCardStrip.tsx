// Purpose: Premium active-work rail for managed Pi subagent executions above the
// composer. The strip is transparent composer chrome: each retained execution
// is one compact, non-clickable row with a live dot grid, identity, elapsed
// time, bounded progress, turn count, and its authorized action.
// Layer: Chat composer UI
// Exports: PiSubagentExecutionCardStrip

import type { PiSubagentExecutionCard } from "@synara/contracts";
import { useEffect, useState } from "react";

import {
  piSubagentExecutionCardElapsedSeconds,
  piSubagentExecutionCardIsRetainedInActiveStrip,
  piSubagentExecutionCardPresentation,
  piSubagentExecutionCardTurnLabel,
} from "~/lib/piSubagentExecutionCardPresentation";
import { cn } from "~/lib/utils";
import { LoaderIcon, RotateCcwIcon, StopIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { ComposerStackedPanelExecutionStrip } from "./ComposerStackedPanel";

const DOT_DELAYS_MS = [0, 80, 160, 80, 160, 240, 160, 240, 320] as const;

function orderCards(cards: ReadonlyArray<PiSubagentExecutionCard>): PiSubagentExecutionCard[] {
  return [...cards].toSorted((left, right) => {
    const leftPresentation = piSubagentExecutionCardPresentation(left);
    const rightPresentation = piSubagentExecutionCardPresentation(right);
    if (leftPresentation.spinner !== rightPresentation.spinner) {
      return leftPresentation.spinner ? -1 : 1;
    }
    return left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0;
  });
}

function DotGrid({
  animated,
  className,
}: {
  readonly animated: boolean;
  readonly className: string;
}) {
  return (
    <span
      className={cn("grid size-[15px] shrink-0 grid-cols-3 gap-[3px]", className)}
      aria-hidden="true"
      data-pi-subagent-dot-grid={animated ? "animated" : "static"}
    >
      {DOT_DELAYS_MS.map((delay, index) => (
        <span
          key={index}
          className={cn(
            "size-[3px] rounded-full bg-current",
            animated && "animate-pulse [animation-duration:1.2s] motion-reduce:animate-none",
          )}
          style={animated ? { animationDelay: `-${delay}ms` } : undefined}
        />
      ))}
    </span>
  );
}

interface ExecutionRowProps {
  readonly card: PiSubagentExecutionCard;
  readonly nowMs: number;
  readonly onCancel: (card: PiSubagentExecutionCard) => void;
  readonly cancelPending: boolean;
  readonly onResume?: (card: PiSubagentExecutionCard) => void;
  readonly resumePending: boolean;
}

function ExecutionRow({
  card,
  nowMs,
  onCancel,
  cancelPending,
  onResume,
  resumePending,
}: ExecutionRowProps) {
  const presentation = piSubagentExecutionCardPresentation(card);
  const spinnerEligible = presentation.spinner;
  const elapsedSeconds = piSubagentExecutionCardElapsedSeconds(card, nowMs);
  const turnLabel = piSubagentExecutionCardTurnLabel(card);
  const diagnostic =
    card.diagnosticMessage ??
    (card.diagnosticCode !== undefined ? String(card.diagnosticCode) : null);
  const spinnerFallbackText =
    presentation.kind === "cancelling"
      ? "Waiting for cancellation acknowledgement"
      : presentation.kind === "running-background"
        ? "Working"
        : card.observedState === "requested"
          ? "Starting"
          : card.observedState === "accepted"
            ? "Preparing"
            : card.observedState === "queued"
              ? "Waiting to start"
              : "Working";
  const progressText = spinnerEligible
    ? (card.lastProgressSummary ?? spinnerFallbackText)
    : (card.lastProgressSummary ?? diagnostic ?? presentation.detailMessage ?? "Outcome unverified");
  const elapsedOrUncertaintyLabel =
    presentation.kind === "orphaned"
      ? "Outcome unknown"
      : presentation.kind === "unverified"
        ? "Unverified"
        : `${elapsedSeconds}s`;
  const cancelVisible = presentation.showCancel;
  const cancelling = presentation.cancelDisabled;
  const resumeVisible = presentation.showResume && onResume !== undefined;
  const dotToneClassName =
    presentation.kind === "cancelling" || presentation.kind === "unverified"
      ? "text-amber-300/85"
      : presentation.kind === "orphaned"
        ? "text-muted-foreground/45"
        : "text-muted-foreground/55";

  return (
    <div
      className="flex min-h-7 min-w-0 items-center gap-2 px-3 py-0.5 text-xs"
      data-pi-subagent-execution-id={card.executionId}
      data-pi-subagent-execution-row="true"
    >
      <DotGrid animated={spinnerEligible} className={dotToneClassName} />
      <span className={cn("sr-only", presentation.textToneClassName)}>{presentation.label}</span>
      <span className="max-w-36 shrink-0 truncate font-medium text-foreground/85" title={card.agentType}>
        {card.agentType}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground/60">{elapsedOrUncertaintyLabel}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate whitespace-nowrap text-muted-foreground/75",
          spinnerEligible && "shimmer shimmer-duration-1800 motion-reduce:shimmer-none",
        )}
        title={progressText}
        data-pi-subagent-progress="true"
      >
        {progressText}
      </span>
      {turnLabel !== null ? (
        <span className="shrink-0 tabular-nums text-muted-foreground/60" data-pi-subagent-turn="true">
          {turnLabel}
        </span>
      ) : null}
      {cancelVisible ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0"
          disabled={cancelPending || cancelling}
          title={cancelling ? "Cancelling — waiting for server acknowledgement" : "Cancel execution"}
          aria-label={cancelling ? "Cancelling — waiting for server acknowledgement" : "Cancel execution"}
          onClick={() => onCancel(card)}
        >
          {cancelling ? <LoaderIcon className="size-3 animate-spin" /> : <StopIcon className="size-3" />}
        </Button>
      ) : null}
      {resumeVisible ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0"
          disabled={resumePending}
          title="Resume execution with a new attempt"
          aria-label={`Resume execution ${card.executionId}`}
          onClick={() => onResume(card)}
        >
          {resumePending ? <LoaderIcon className="size-3 animate-spin" /> : <RotateCcwIcon className="size-3" />}
        </Button>
      ) : null}
    </div>
  );
}

export interface PiSubagentExecutionCardStripProps {
  readonly cards: ReadonlyArray<PiSubagentExecutionCard>;
  readonly onCancelExecution: (card: PiSubagentExecutionCard) => void;
  readonly cancelPendingExecutionId: string | null;
  readonly onResumeExecution?: (card: PiSubagentExecutionCard) => void;
  readonly resumePendingExecutionId?: string | null;
  readonly attachedToPrevious?: boolean;
}

export function PiSubagentExecutionCardStrip({
  cards,
  onCancelExecution,
  cancelPendingExecutionId,
  onResumeExecution,
  resumePendingExecutionId,
  attachedToPrevious: attachedToPreviousProp,
}: PiSubagentExecutionCardStripProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const retainedCards = cards.filter(piSubagentExecutionCardIsRetainedInActiveStrip);
  const orderedCards = orderCards(retainedCards);
  const hasSpinnerEligibleRow = orderedCards.some(
    (card) => piSubagentExecutionCardPresentation(card).spinner,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!hasSpinnerEligibleRow) {
      return;
    }
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [hasSpinnerEligibleRow]);

  if (retainedCards.length === 0) {
    return null;
  }

  return (
    <ComposerStackedPanelExecutionStrip
      passthroughSideMargins
      attachedToPrevious={attachedToPrevious}
      data-testid="pi-subagent-execution-card-strip"
    >
      <div className="flex max-h-56 flex-col overflow-y-auto overscroll-contain">
        {orderedCards.map((card) => (
          <ExecutionRow
            key={card.executionId}
            card={card}
            nowMs={nowMs}
            onCancel={onCancelExecution}
            cancelPending={cancelPendingExecutionId === card.executionId}
            {...(onResumeExecution !== undefined ? { onResume: onResumeExecution } : {})}
            resumePending={resumePendingExecutionId === card.executionId}
          />
        ))}
      </div>
    </ComposerStackedPanelExecutionStrip>
  );
}
