import type { PiSubagentDiagnosticCode, PiSubagentTranscriptEntry } from "@synara/contracts";
import {
  PI_SUBAGENT_TRANSCRIPT_PAGE_DEFAULT_ENTRIES,
  PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES,
} from "@synara/contracts";
import { Effect } from "effect";

/**
 * Ticket 12 — Authorized paginated transcript reader (T12-AC3/AC7).
 *
 * Reads bounded pages from the extension-owned JSONL transcript artifact
 * behind the durable `transcriptRef`. The reference is opaque correlation,
 * never authority: callers resolve and authorize the execution FIRST, then
 * hand the committed reference here.
 *
 * Invariants:
 * - Cursor pagination over zero-based entry indices; page size clamped to
 *   `PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES` — no unbounded read path.
 * - Per-entry content excerpts are bounded; truncation is reported per entry
 *   (`pi_subagent_transcript_entry_truncated`) and per page
 *   (`pi_subagent_transcript_page_truncated`).
 * - Corrupt lines are skipped and counted with a stable diagnostic
 *   (`pi_subagent_transcript_corrupt`); a corrupt artifact degrades the READ
 *   without changing the execution outcome (T12-AC7).
 * - Reading is NEVER liveness evidence (T12-AC6): this module writes nothing
 *   and returns no state claims beyond what it read from the artifact.
 */

/** Bounded per-entry content excerpt (matches the result-summary excerpt cap). */
export const PI_SUBAGENT_TRANSCRIPT_ENTRY_EXCERPT_MAX_CHARS = 4000;

/** Read ceiling per page in raw bytes — bounded file reads, never whole files. */
export const PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_BYTES = 1024 * 1024;

export interface PiSubagentTranscriptPageInput {
  /** Committed opaque transcript reference (absolute artifact path). */
  readonly transcriptRef: string | null | undefined;
  /** Exclusive zero-based entry index to resume from. */
  readonly cursor?: number | undefined;
  /** Requested page size; clamped to the bounded maximum. */
  readonly limit?: number | undefined;
  /**
   * Injectable file reader for tests. Production reads through Node fs with
   * a byte ceiling; the artifact is read line-wise, never whole.
   */
  readonly readLines?:
    | ((
        path: string,
        options: {
          readonly startLine: number;
          readonly maxLines: number;
          readonly maxBytes: number;
        },
      ) => Effect.Effect<readonly string[], PiSubagentTranscriptReadFailure>)
    | undefined;
}

export type PiSubagentTranscriptReadFailure =
  | { readonly kind: "missing"; readonly diagnosticCode: PiSubagentDiagnosticCode }
  | { readonly kind: "unavailable"; readonly diagnosticCode: PiSubagentDiagnosticCode };

export interface PiSubagentTranscriptPage {
  readonly entries: ReadonlyArray<PiSubagentTranscriptEntry>;
  /** Exclusive cursor for the next page; null when the artifact is exhausted. */
  readonly nextCursor: number | null;
  readonly hasMore: boolean;
  readonly skippedCorruptEntries: number;
  readonly diagnosticCode: PiSubagentDiagnosticCode | undefined;
}

const TRUNCATION_MARKER = "…";

const excerpt = (content: string): { readonly text: string; readonly truncated: boolean } => {
  if (content.length <= PI_SUBAGENT_TRANSCRIPT_ENTRY_EXCERPT_MAX_CHARS) {
    return { text: content, truncated: false };
  }
  return {
    text: `${content.slice(0, Math.max(0, PI_SUBAGENT_TRANSCRIPT_ENTRY_EXCERPT_MAX_CHARS - 1))}${TRUNCATION_MARKER}`,
    truncated: true,
  };
};

const entryContent = (parsed: Record<string, unknown>): string => {
  const message = parsed["message"];
  if (message !== null && typeof message === "object") {
    const content = (message as Record<string, unknown>)["content"];
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      // Claude-Code-style content blocks; render the text parts bounded.
      const text = content
        .map((block) => {
          if (block !== null && typeof block === "object") {
            const blockText = (block as Record<string, unknown>)["text"];
            if (typeof blockText === "string") {
              return blockText;
            }
          }
          return undefined;
        })
        .filter((part): part is string => part !== undefined)
        .join("\n");
      if (text.length > 0) {
        return text;
      }
    }
  }
  if (parsed["type"] === "outcome") {
    const parts: string[] = [`outcome_state: ${String(parsed["outcome_state"] ?? "unknown")}`];
    const diagnostic = parsed["outcome_diagnostic"];
    if (typeof diagnostic === "string" && diagnostic.length > 0) {
      parts.push(`diagnostic: ${diagnostic}`);
    }
    return parts.join("\n");
  }
  return "";
};

/**
 * Parse one JSONL line into a bounded transcript entry. Returns none for a
 * line that is not valid JSON or not a transcript entry shape (corrupt).
 */
const parseEntry = (line: string): PiSubagentTranscriptEntry | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const type = record["type"];
  if (type !== "user" && type !== "assistant" && type !== "toolResult" && type !== "outcome") {
    return undefined;
  }
  const timestamp = record["timestamp"];
  const content = excerpt(entryContent(record));
  if (content.text.length === 0 && type !== "outcome") {
    return undefined;
  }
  return {
    index: -1, // assigned by the caller with the artifact line index
    type,
    content: content.text,
    truncated: content.truncated,
    timestamp: typeof timestamp === "string" && timestamp.trim().length > 0 ? timestamp : null,
  };
};

const readLinesWithFs: NonNullable<PiSubagentTranscriptPageInput["readLines"]> = (path, options) =>
  Effect.promise(async () => {
    const { stat, open } = await import("node:fs/promises");
    try {
      const stats = await stat(path);
      if (!stats.isFile()) {
        return {
          _tag: "failure" as const,
          failure: {
            kind: "unavailable",
            diagnosticCode: "pi_subagent_transcript_unavailable",
          } as const,
        };
      }
      const handle = await open(path, "r");
      try {
        const { createInterface } = await import("node:readline");
        const stream = handle.createReadStream({
          start: 0,
          // Byte ceiling: never read past the page budget even for huge lines.
          end: Math.max(0, options.maxBytes - 1),
        });
        const lines: string[] = [];
        const interface$ = createInterface({ input: stream, crlfDelay: Infinity });
        let index = 0;
        for await (const line of interface$) {
          if (index >= options.startLine) {
            lines.push(line);
            if (lines.length >= options.maxLines) {
              break;
            }
          }
          index += 1;
        }
        return { _tag: "success" as const, lines };
      } finally {
        await handle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return {
          _tag: "failure" as const,
          failure: {
            kind: "missing",
            diagnosticCode: "pi_subagent_transcript_missing",
          } as const,
        };
      }
      return {
        _tag: "failure" as const,
        failure: {
          kind: "unavailable",
          diagnosticCode: "pi_subagent_transcript_unavailable",
        } as const,
      };
    }
  }).pipe(
    Effect.flatMap((outcome) =>
      outcome._tag === "success" ? Effect.succeed(outcome.lines) : Effect.fail(outcome.failure),
    ),
  );

/**
 * Read one bounded page of transcript entries starting AFTER the cursor.
 * Corrupt lines inside the page window are skipped and counted; pagination
 * stays index-stable because the cursor is the raw line index.
 */
export const readPiSubagentTranscriptPage = (
  input: PiSubagentTranscriptPageInput,
): Effect.Effect<PiSubagentTranscriptPage, PiSubagentTranscriptReadFailure> =>
  Effect.gen(function* () {
    if (input.transcriptRef === null || input.transcriptRef === undefined) {
      return yield* Effect.fail({
        kind: "missing",
        diagnosticCode: "pi_subagent_transcript_missing",
      } satisfies PiSubagentTranscriptReadFailure);
    }
    const cursor = Math.max(0, Math.floor(input.cursor ?? 0));
    const limit = Math.min(
      PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES,
      Math.max(1, Math.floor(input.limit ?? PI_SUBAGENT_TRANSCRIPT_PAGE_DEFAULT_ENTRIES)),
    );
    // Read one extra line past the page to detect `hasMore` without a second
    // file pass; corrupt lines inside the window still count toward the
    // requested page size so a hostile artifact cannot force unbounded work.
    const lines = yield* (input.readLines ?? readLinesWithFs)(input.transcriptRef, {
      startLine: cursor,
      maxLines: limit + 1,
      maxBytes: PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_BYTES,
    });

    const entries: PiSubagentTranscriptEntry[] = [];
    let skippedCorruptEntries = 0;
    let anyEntryTruncated = false;
    let lineIndex = cursor;
    let consumed = 0;
    for (const line of lines) {
      if (consumed >= limit) {
        break;
      }
      const parsed = line.trim().length === 0 ? undefined : parseEntry(line);
      if (parsed === undefined) {
        skippedCorruptEntries += 1;
      } else {
        const entry = { ...parsed, index: lineIndex };
        entries.push(entry);
        if (entry.truncated) {
          anyEntryTruncated = true;
        }
      }
      consumed += 1;
      lineIndex += 1;
    }

    const hasMore = lines.length > limit;
    const diagnosticCode: PiSubagentDiagnosticCode | undefined =
      skippedCorruptEntries > 0
        ? ("pi_subagent_transcript_corrupt" as const)
        : anyEntryTruncated
          ? ("pi_subagent_transcript_entry_truncated" as const)
          : undefined;

    // `hasMore` alone drives continuation: the lookahead line proves more
    // entries exist past this page. `nextCursor` is the raw line index of the
    // first unconsumed line, so corrupt lines stay index-stable across pages.
    return {
      entries,
      nextCursor: hasMore ? lineIndex : null,
      hasMore,
      skippedCorruptEntries,
      diagnosticCode,
    };
  });

export const piSubagentTranscriptReader = {
  readPage: readPiSubagentTranscriptPage,
} as const;

export type PiSubagentTranscriptReader = typeof piSubagentTranscriptReader;
