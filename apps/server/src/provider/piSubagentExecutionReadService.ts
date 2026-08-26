import type {
  PiSubagentDiagnosticCode,
  PiSubagentExecutionReadInput,
  PiSubagentExecutionRecord,
  PiSubagentLifecycleState,
  PiSubagentResultReadResult,
  PiSubagentTranscriptReadResult,
} from "@synara/contracts";
import { WsRpcError } from "@synara/contracts";
import { PI_SUBAGENT_RESULT_SUMMARY_EXCERPT_MAX_CHARS } from "@synara/contracts";
import { Effect, Option } from "effect";

import {
  DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
} from "../config.ts";
import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  readPiSubagentTranscriptPage,
  type PiSubagentTranscriptPage,
  type PiSubagentTranscriptPageInput,
  type PiSubagentTranscriptReadFailure,
} from "./piSubagentTranscriptReader.ts";
import { truncateWithEllipsis } from "./piSubagentBoundedText.ts";

/**
 * Ticket 12 — Authorized paginated result/transcript read boundary
 * (T12-AC1/AC2/AC6).
 *
 * The execution identity is correlation, never authority. Every read:
 *
 * 1. resolves the execution from DURABLE truth (`piSubagentExecutionRepository`),
 * 2. authorizes the caller's project/thread authority by verifying the
 *    execution's parent thread EXISTS in the server's projection read model
 *    and its trusted `projectId` matches the execution row (a forged or
 *    cross-project row cannot be read even with a known `executionId`),
 * 3. only then returns bounded content.
 *
 * Denials are indistinguishable from unknown ids at the payload level: no
 * metadata, result, transcript, or filesystem reference is returned (T12-AC2).
 *
 * Reading NEVER writes execution state and NEVER claims liveness: the
 * `observedState` echoed in responses is the durable aggregate's state at read
 * time, so an available transcript on an `orphaned` execution stays an honest
 * orphaned read (T12-AC6).
 */

export type PiSubagentReadDenied =
  | { readonly kind: "not_found" }
  | { readonly kind: "denied"; readonly diagnosticCode: PiSubagentDiagnosticCode };

/**
 * Stable WS denial mapping shared by both ticket-12 read handlers: unknown
 * ids and authorization denials surface as distinct, non-retryable RPC
 * errors, and the mapping itself is a pure seam the boundary tests pin
 * (T12-AC1/AC2).
 */
export const piSubagentReadDenialToWsRpcError = (denial: PiSubagentReadDenied): WsRpcError =>
  new WsRpcError({
    message:
      denial.kind === "not_found"
        ? "Subagent execution not found."
        : "Not authorized to read this subagent execution.",
    code:
      denial.kind === "not_found" ? "PI_SUBAGENT_EXECUTION_NOT_FOUND" : "PI_SUBAGENT_READ_DENIED",
    retryable: false,
  });

export interface PiSubagentExecutionReadServiceInput {
  readonly repository: PiSubagentExecutionRepositoryShape;
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getThreadShellById">;
  /**
   * Optional caller-authorization hook (T12-AC1): invoked AFTER the
   * execution resolves and its project/thread binding verifies, with the
   * durable record's parent thread. Production wires the MCP session
   * authority thread binding (Decision 21): a connection holding an
   * authority may only read executions whose parent thread is bound to the
   * SAME authority. Connections without an authority (owner/browser) rely
   * on the trusted transport boundary, exactly like thread-detail snapshots.
   */
  readonly authorizeCaller?:
    | ((input: {
        readonly executionId: string;
        readonly parentThreadId: string;
      }) => Effect.Effect<
        | { readonly kind: "authorized" }
        | { readonly kind: "denied"; readonly diagnosticCode: PiSubagentDiagnosticCode },
        never
      >)
    | undefined;
  /** Injectable transcript reader (defaults to the file-backed reader). */
  readonly transcriptReader?:
    | ((
        input: PiSubagentTranscriptPageInput,
      ) => Effect.Effect<PiSubagentTranscriptPage, PiSubagentTranscriptReadFailure>)
    | undefined;
  /**
   * Server-resolved terminal summary cap — the same knob that bounded the
   * stored summary at ingest. A stored summary whose length meets the cap is
   * reported as truncated with a stable diagnostic and a retrievable
   * continuation (T12-AC4). Falls back to the config default when absent.
   */
  readonly summaryMaxChars?: number | undefined;
  /**
   * Optional exact-live supplement seam. The durable snapshot is always
   * resolved first; this callback is never invoked for a durable terminal.
   */
  readonly liveSupplement?:
    | ((input: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly generation: number;
      }) => Effect.Effect<
        | { readonly kind: "available"; readonly observedState: PiSubagentLifecycleState }
        | { readonly kind: "unavailable" },
        never
      >)
    | undefined;
}

export interface PiSubagentExecutionReadService {
  readonly readResult: (
    input: PiSubagentExecutionReadInput,
  ) => Effect.Effect<PiSubagentResultReadResult, PiSubagentReadDenied>;
  readonly readTranscriptPage: (input: PiSubagentExecutionReadInput & {
    readonly cursor?: number | undefined;
    readonly limit?: number | undefined;
  }) => Effect.Effect<PiSubagentTranscriptReadResult, PiSubagentReadDenied>;
}

const MAX_PUBLIC_EXECUTION_ID_CHARS = 256;

type NormalizedReadInput = {
  readonly executionId: string;
  readonly attemptId?: string | undefined;
  readonly generation?: number | undefined;
  readonly aliasUsed: boolean;
};

const normalizeReadInput = (
  input: PiSubagentExecutionReadInput,
): Effect.Effect<NormalizedReadInput, PiSubagentReadDenied> => {
  const executionId = input.executionId?.trim() ?? "";
  const alias = input.agent_id?.trim() ?? "";
  if (executionId.length === 0 && alias.length === 0) {
    return Effect.fail({
      kind: "denied",
      diagnosticCode: "pi_subagent_read_missing_durable_evidence",
    });
  }
  // A deprecated alias-only request is treated as the public executionId.
  // Provider-local ids therefore resolve only if they happen to equal a
  // durable public identity; an unknown provider-like value remains a normal
  // not-found result without provider access or metadata leakage.
  if (executionId.length > MAX_PUBLIC_EXECUTION_ID_CHARS || alias.length > MAX_PUBLIC_EXECUTION_ID_CHARS) {
    return Effect.fail({
      kind: "denied",
      diagnosticCode: "pi_subagent_read_payload_bounded",
    });
  }
  if (executionId.length > 0 && alias.length > 0 && executionId !== alias) {
    return Effect.fail({ kind: "denied", diagnosticCode: "pi_subagent_read_alias_conflict" });
  }
  return Effect.succeed({
    executionId: executionId || alias,
    ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
    ...(input.generation === undefined ? {} : { generation: input.generation }),
    aliasUsed: alias.length > 0,
  });
};

const summaryExcerpt = (summary: string): string =>
  truncateWithEllipsis(summary, PI_SUBAGENT_RESULT_SUMMARY_EXCERPT_MAX_CHARS);

export const makePiSubagentExecutionReadService = (
  input: PiSubagentExecutionReadServiceInput,
): PiSubagentExecutionReadService => {
  const transcriptReader = input.transcriptReader ?? readPiSubagentTranscriptPage;
  // Same defensive guard as the terminal coordinator: a caller-supplied cap
  // outside the configuration range falls back to the default.
  const summaryMaxChars =
    input.summaryMaxChars !== undefined &&
    Number.isInteger(input.summaryMaxChars) &&
    input.summaryMaxChars >= MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS &&
    input.summaryMaxChars <= MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS
      ? input.summaryMaxChars
      : DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;

  const resolveAuthorized = (rawInput: PiSubagentExecutionReadInput) =>
    Effect.gen(function* () {
      const normalized = yield* normalizeReadInput(rawInput);
      const snapshotOption = input.repository.getExecutionReadSnapshot
        ? yield* input.repository.getExecutionReadSnapshot(normalized.executionId).pipe(
            Effect.mapError(
              (): PiSubagentReadDenied => ({
                kind: "denied",
                diagnosticCode: "pi_subagent_read_denied",
              }),
            ),
          )
        : Option.none();
      let executionOption: Option.Option<PiSubagentExecutionRecord>;
      if (Option.isSome(snapshotOption)) {
        executionOption = Option.some(snapshotOption.value.execution);
      } else {
        executionOption = yield* input.repository.getById(normalized.executionId).pipe(
          Effect.mapError(
            (): PiSubagentReadDenied => ({
              kind: "denied",
              diagnosticCode: "pi_subagent_read_denied",
            }),
          ),
        );
      }
      if (Option.isNone(executionOption)) {
        return yield* Effect.fail<PiSubagentReadDenied>({ kind: "not_found" });
      }
      const execution = executionOption.value;
      if (
        (normalized.attemptId !== undefined && normalized.attemptId !== execution.attemptId) ||
        (normalized.generation !== undefined && normalized.generation !== execution.generation)
      ) {
        return yield* Effect.fail<PiSubagentReadDenied>({
          kind: "denied",
          diagnosticCode: "pi_subagent_read_stale_attempt_or_generation",
        });
      }
      // Project/thread authority: the parent thread must exist in the
      // server's read model AND its trusted projectId must match the
      // execution row. Any mismatch denies exactly like an unknown id —
      // knowing an executionId grants nothing (T12-AC2).
      const threadOption = yield* input.snapshotQuery
        .getThreadShellById(execution.parentThreadId)
        .pipe(
          Effect.mapError(
            (): PiSubagentReadDenied => ({
              kind: "denied",
              diagnosticCode: "pi_subagent_read_denied",
            }),
          ),
        );
      if (Option.isNone(threadOption) || threadOption.value.projectId !== execution.projectId) {
        return yield* Effect.fail<PiSubagentReadDenied>({
          kind: "denied",
          diagnosticCode: "pi_subagent_read_unauthorized_or_out_of_scope",
        });
      }
      // Caller authorization (T12-AC1): after the durable binding verifies,
      // the transport-supplied caller hook decides. Absent hook = the trusted
      // transport boundary (tests, local service use).
      if (input.authorizeCaller !== undefined) {
        const caller = yield* input.authorizeCaller({
          executionId: execution.executionId,
          parentThreadId: execution.parentThreadId,
        });
        if (caller.kind === "denied") {
          return yield* Effect.fail<PiSubagentReadDenied>({
            kind: "denied",
            diagnosticCode: caller.diagnosticCode,
          });
        }
      }
      let evidence: {
        readonly terminalSummary: string | null;
        readonly terminalTranscriptRef: string | null;
        readonly staleTerminalEvents: number;
      };
      if (Option.isSome(snapshotOption)) {
        evidence = snapshotOption.value.terminalEvidence;
      } else {
        const evidenceOption = yield* input.repository.getTerminalEvidence(normalized.executionId).pipe(
          Effect.mapError(
            (): PiSubagentReadDenied => ({
              kind: "denied",
              diagnosticCode: "pi_subagent_read_denied",
            }),
          ),
        );
        evidence = Option.isSome(evidenceOption)
          ? evidenceOption.value
          : { terminalSummary: null, terminalTranscriptRef: null, staleTerminalEvents: 0 };
      }
      return { execution, evidence, normalized };
    });

  const readResult: PiSubagentExecutionReadService["readResult"] = (rawInput) =>
    Effect.gen(function* () {
      const { execution, evidence, normalized } = yield* resolveAuthorized(rawInput);
      const storedSummary = evidence.terminalSummary;
      const transcriptRefStored = evidence.terminalTranscriptRef;
      // The stored summary was bounded at ingest by the SAME config knob; the
      // ingest path appends an ellipsis marker when it truncates, so "at the
      // cap AND ending in the marker" is the honest truncation signal for
      // the stable diagnostic + retrievable continuation (T12-AC4). An
      // untruncated summary that happens to be exactly the cap length does
      // not claim truncation; a config change since ingest can only make the
      // signal conservative (never fabricates truncation for short
      // summaries).
      const summaryTruncated =
        storedSummary !== null &&
        storedSummary.length >= summaryMaxChars &&
        storedSummary.endsWith("…");
      const terminalState =
        execution.observedState === "succeeded" ||
        execution.observedState === "failed" ||
        execution.observedState === "cancelled"
          ? execution.observedState
          : null;
      const durableTerminal = terminalState !== null;
      const diagnostics: PiSubagentDiagnosticCode[] = [];
      if (normalized.aliasUsed) diagnostics.push("pi_subagent_read_alias_deprecated");
      if (durableTerminal && input.liveSupplement !== undefined) {
        diagnostics.push("pi_subagent_read_durable_terminal_precedence");
      }
      if (durableTerminal && storedSummary === null && transcriptRefStored === null) {
        diagnostics.push("pi_subagent_read_missing_durable_evidence");
      }
      if (summaryTruncated) {
        diagnostics.push("pi_subagent_result_truncated", "pi_subagent_read_payload_bounded");
      }
      let liveObservedState: PiSubagentLifecycleState | null = null;
      if (!durableTerminal && input.liveSupplement !== undefined) {
        const live = yield* input.liveSupplement({
          executionId: execution.executionId,
          attemptId: execution.attemptId,
          generation: execution.generation,
        });
        if (live.kind === "available") {
          liveObservedState = live.observedState;
        } else {
          diagnostics.push("pi_subagent_read_live_record_unavailable");
        }
      }
      const result: PiSubagentResultReadResult = {
        executionId: execution.executionId,
        attemptId: execution.attemptId,
        generation: execution.generation,
        observedState: execution.observedState,
        liveObservedState,
        terminalState,
        summary:
          storedSummary !== null && storedSummary.trim().length > 0
            ? summaryExcerpt(storedSummary)
            : null,
        summaryTruncated,
        ...(summaryTruncated
          ? { diagnosticCode: "pi_subagent_result_truncated" as PiSubagentDiagnosticCode }
          : diagnostics.length > 0
            ? { diagnosticCode: diagnostics[0]! }
            : {}),
        transcriptRef: transcriptRefStored,
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      };
      return result;
    });

  const readTranscriptPage: PiSubagentExecutionReadService["readTranscriptPage"] = (rawInput) =>
    Effect.gen(function* () {
      const { execution, evidence } = yield* resolveAuthorized(rawInput);
      const transcriptRef = evidence.terminalTranscriptRef;
      const { cursor, limit } = rawInput;
      // Artifact read failures are STABLE READ DIAGNOSTICS, never execution
      // outcome changes and never denials: a missing/expired artifact reports
      // `pi_subagent_transcript_missing`/`_unavailable` on an empty page so
      // the caller can distinguish an unavailable artifact from an
      // unauthorized read (T12-AC7).
      const page = yield* transcriptReader({ transcriptRef, cursor, limit }).pipe(
        Effect.catch((failure: { diagnosticCode: PiSubagentDiagnosticCode }) =>
          Effect.succeed({
            entries: [],
            nextCursor: null,
            hasMore: false,
            skippedCorruptEntries: 0,
            diagnosticCode: failure.diagnosticCode,
          }),
        ),
      );
      const result: PiSubagentTranscriptReadResult = {
        executionId: execution.executionId,
        observedState: execution.observedState,
        entries: [...page.entries],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        skippedCorruptEntries: page.skippedCorruptEntries,
        ...(page.diagnosticCode !== undefined ? { diagnosticCode: page.diagnosticCode } : {}),
      };
      return result;
    });

  return { readResult, readTranscriptPage };
};
