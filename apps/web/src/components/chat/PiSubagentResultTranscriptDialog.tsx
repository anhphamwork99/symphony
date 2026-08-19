// FILE: PiSubagentResultTranscriptDialog.tsx
// Purpose: Ticket 12 (T12-AC3/AC4) authorized paginated result/transcript
// view for one managed Pi subagent execution. Opens from the execution card,
// fetches the bounded result read and cursor-paged transcript entries through
// the authorized server boundary, and renders stable truncation/availability
// diagnostics. Transcript availability is never presented as liveness
// (T12-AC6): the header renders the durable observed state verbatim.
// Layer: Chat presentation component
// Exports: PiSubagentResultTranscriptDialog

import type {
  PiSubagentExecutionCard,
  PiSubagentResultReadResult,
  PiSubagentTranscriptEntry,
} from "@synara/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { LoaderIcon } from "~/lib/icons";
import { piSubagentExecutionStatePresentation } from "~/lib/piSubagentExecutionCardPresentation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from "../ui/dialog";

/** Bounded page size for the pager (server clamps to the same maximum). */
const PAGE_SIZE = 50;

export interface PiSubagentResultTranscriptDialogProps {
  readonly card: PiSubagentExecutionCard | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readResult: (input: {
    readonly executionId: string;
  }) => Promise<PiSubagentResultReadResult>;
  readonly readTranscriptPage: (input: {
    readonly executionId: string;
    readonly cursor?: number;
    readonly limit?: number;
  }) => Promise<{
    readonly entries: ReadonlyArray<PiSubagentTranscriptEntry>;
    readonly nextCursor: number | null;
    readonly hasMore: boolean;
    readonly skippedCorruptEntries: number;
    readonly observedState: string;
    readonly diagnosticCode?: string | undefined;
  }>;
}

type LoadState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string };

const TRANSCRIPT_DIAGNOSTIC_COPY: Record<string, string> = {
  pi_subagent_transcript_missing:
    "The transcript artifact is no longer available on the server. The execution outcome is unchanged.",
  pi_subagent_transcript_unavailable:
    "The transcript artifact could not be read. The execution outcome is unchanged.",
  pi_subagent_transcript_corrupt:
    "Some transcript entries could not be parsed and were skipped. The execution outcome is unchanged.",
  pi_subagent_transcript_entry_truncated:
    "Long entries are excerpted on the server; each excerpt is bounded.",
};

export function PiSubagentResultTranscriptDialog({
  card,
  open,
  onOpenChange,
  readResult,
  readTranscriptPage,
}: PiSubagentResultTranscriptDialogProps) {
  const [result, setResult] = useState<PiSubagentResultReadResult | null>(null);
  const [entries, setEntries] = useState<ReadonlyArray<PiSubagentTranscriptEntry>>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [diagnosticCode, setDiagnosticCode] = useState<string | undefined>(undefined);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const executionId = card?.executionId ?? null;
  // Track the execution this state belongs to so reopening for another card
  // resets the pager instead of appending foreign entries.
  const stateExecutionIdRef = useRef<string | null>(null);

  const resetFor = useCallback((id: string) => {
    stateExecutionIdRef.current = id;
    setResult(null);
    setEntries([]);
    setNextCursor(null);
    setHasMore(false);
    setDiagnosticCode(undefined);
    setLoadState({ kind: "idle" });
    setError(null);
  }, []);

  const loadInitial = useCallback(
    async (id: string) => {
      setLoadState({ kind: "loading" });
      try {
        const resultRead = await readResult({ executionId: id });
        setResult(resultRead);
        const firstPage = await readTranscriptPage({ executionId: id, limit: PAGE_SIZE });
        setEntries([...firstPage.entries]);
        setNextCursor(firstPage.nextCursor);
        setHasMore(firstPage.hasMore);
        setDiagnosticCode(firstPage.diagnosticCode);
        setLoadState({ kind: "idle" });
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The read failed. The execution state is unchanged.",
        );
        setLoadState({ kind: "error", message: cause instanceof Error ? cause.message : "" });
      }
    },
    [readResult, readTranscriptPage],
  );

  useEffect(() => {
    if (!open || executionId === null) {
      return;
    }
    if (stateExecutionIdRef.current !== executionId) {
      resetFor(executionId);
    }
    if (stateExecutionIdRef.current === executionId && loadState.kind === "idle" && !result) {
      void loadInitial(executionId);
    }
    // loadState/result are intentionally excluded: the effect only seeds the
    // first load for the open execution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, executionId]);

  const loadMore = useCallback(async () => {
    if (executionId === null || nextCursor === null || loadState.kind === "loading") {
      return;
    }
    setLoadState({ kind: "loading" });
    try {
      const page = await readTranscriptPage({
        executionId,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setEntries((previous) => [...previous, ...page.entries]);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setDiagnosticCode(page.diagnosticCode);
      setLoadState({ kind: "idle" });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The page failed to load. Already-loaded entries are unchanged.",
      );
      setLoadState({ kind: "idle" });
    }
  }, [executionId, nextCursor, loadState.kind, readTranscriptPage]);

  if (!card || !executionId) {
    return null;
  }

  const presentation = piSubagentExecutionStatePresentation(card.observedState);
  const loading = loadState.kind === "loading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span className={cn("size-2 rounded-full", presentation.dotClassName)} aria-hidden />
            <span className={cn("font-medium", presentation.textToneClassName)}>
              {presentation.label}
            </span>
            <span className="font-chat-code text-[11px] text-muted-foreground/60">
              {card.agentType} · execution {executionId}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[min(60vh,32rem)] flex-col gap-3 overflow-y-auto px-4 pb-4">
          {error !== null ? (
            <div className="rounded-md border border-border/50 bg-background/60 px-3 py-2 text-xs text-foreground/85">
              {error}
            </div>
          ) : null}
          <section className="space-y-1.5" data-testid="pi-subagent-result-section">
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
              Result
            </h3>
            {result === null && loadState.kind === "loading" ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                <LoaderIcon className="size-3 animate-spin" /> Loading result…
              </div>
            ) : result?.summary != null ? (
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/85">
                {result.summary}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/60">
                No bounded result summary is stored for this execution yet.
              </p>
            )}
            {result?.summaryTruncated ? (
              <p
                className="text-[11px] text-amber-300/80"
                data-testid="pi-subagent-result-truncated"
              >
                The stored result summary is truncated. The full transcript below carries the
                remainder.
              </p>
            ) : null}
          </section>
          <section className="space-y-1.5" data-testid="pi-subagent-transcript-section">
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
              Transcript
            </h3>
            {diagnosticCode !== undefined && TRANSCRIPT_DIAGNOSTIC_COPY[diagnosticCode] ? (
              <p className="text-[11px] text-muted-foreground/70">
                {TRANSCRIPT_DIAGNOSTIC_COPY[diagnosticCode]}
              </p>
            ) : null}
            {entries.length === 0 && loadState.kind === "loading" ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                <LoaderIcon className="size-3 animate-spin" /> Loading transcript…
              </div>
            ) : entries.length === 0 ? (
              <p
                className="text-xs text-muted-foreground/60"
                data-testid="pi-subagent-transcript-empty"
              >
                {diagnosticCode === "pi_subagent_transcript_missing" ||
                diagnosticCode === "pi_subagent_transcript_unavailable"
                  ? "No transcript is available for this execution."
                  : "No transcript entries yet."}
              </p>
            ) : (
              <ol className="space-y-1.5">
                {entries.map((entry) => (
                  <li
                    key={`${entry.index}-${entry.type}`}
                    className="rounded-md border border-border/40 bg-background/50 px-2.5 py-2"
                    data-entry-index={entry.index}
                  >
                    <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                      <span>{entry.type}</span>
                      {entry.truncated ? <span title="Entry excerpted">excerpt</span> : null}
                    </div>
                    <p className="whitespace-pre-wrap break-words font-chat-code text-[11px] leading-relaxed text-foreground/85">
                      {entry.content}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {hasMore && nextCursor !== null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start text-xs"
                disabled={loading}
                onClick={() => void loadMore()}
                data-testid="pi-subagent-transcript-load-more"
              >
                {loading ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  `Load more (${entries.length} loaded)`
                )}
              </Button>
            ) : null}
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
