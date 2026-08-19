import type { PiSubagentTranscriptEntry } from "@synara/contracts";
import { PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES } from "@synara/contracts";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_TRANSCRIPT_ENTRY_EXCERPT_MAX_CHARS,
  readPiSubagentTranscriptPage,
} from "./piSubagentTranscriptReader.ts";

/**
 * Ticket 12 — authorized paginated transcript reader contracts at the
 * approved command-boundary seam (Testing Seams: pagination, missing, and
 * corrupt fixtures).
 *
 * T12-AC3: cursor/page based retrieval with bounded page sizes.
 * T12-AC7: missing/corrupt artifacts produce stable diagnostics.
 */

let artifactDir: string;

beforeAll(async () => {
  artifactDir = await mkdtemp(join(tmpdir(), "synara-t12-reader-"));
});

afterAll(async () => {
  await rm(artifactDir, { recursive: true, force: true });
});

const entryLine = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    isSidechain: true,
    agentId: "agent-1",
    type: "assistant",
    message: { role: "assistant", content: "hello from the child" },
    timestamp: "2026-08-19T00:00:00.000Z",
    cwd: "/w",
    ...overrides,
  });

describe("Pi subagent paginated transcript reader (Issue 12)", () => {
  it("T12-AC3: pages entries by cursor with bounded page size", async () => {
    const path = join(artifactDir, "paged.output");
    await writeFile(
      path,
      Array.from({ length: 7 }, (_, i) =>
        entryLine({ message: { role: "assistant", content: `entry-${i}` } }),
      ).join("\n") + "\n",
      "utf-8",
    );

    const first = await Effect.runPromise(
      readPiSubagentTranscriptPage({ transcriptRef: path, cursor: 0, limit: 3 }),
    );
    expect(first.entries.map((entry) => entry.content)).toEqual(["entry-0", "entry-1", "entry-2"]);
    expect(first.entries.map((entry: PiSubagentTranscriptEntry) => entry.index)).toEqual([0, 1, 2]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(3);
    expect(first.diagnosticCode).toBeUndefined();

    const second = await Effect.runPromise(
      readPiSubagentTranscriptPage({ transcriptRef: path, cursor: first.nextCursor!, limit: 3 }),
    );
    expect(second.entries.map((entry) => entry.content)).toEqual(["entry-3", "entry-4", "entry-5"]);
    expect(second.hasMore).toBe(true);
    expect(second.nextCursor).toBe(6);

    const third = await Effect.runPromise(
      readPiSubagentTranscriptPage({ transcriptRef: path, cursor: second.nextCursor!, limit: 3 }),
    );
    expect(third.entries.map((entry) => entry.content)).toEqual(["entry-6"]);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
  });

  it("T12-AC3: clamps oversized and invalid limits to the bounded page size", async () => {
    const path = join(artifactDir, "clamped.output");
    await writeFile(
      path,
      Array.from({ length: PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES + 10 }, (_, i) =>
        entryLine({ message: { role: "assistant", content: `row-${i}` } }),
      ).join("\n") + "\n",
      "utf-8",
    );

    const page = await Effect.runPromise(
      readPiSubagentTranscriptPage({ transcriptRef: path, limit: 1_000_000 }),
    );
    expect(page.entries).toHaveLength(PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(PI_SUBAGENT_TRANSCRIPT_PAGE_MAX_ENTRIES);
  });

  it("T12-AC3: bounds per-entry excerpts with a stable truncation diagnostic", async () => {
    const path = join(artifactDir, "big-entry.output");
    await writeFile(
      path,
      entryLine({
        message: {
          role: "assistant",
          content: "x".repeat(PI_SUBAGENT_TRANSCRIPT_ENTRY_EXCERPT_MAX_CHARS + 5000),
        },
      }) + "\n",
      "utf-8",
    );

    const page = await Effect.runPromise(readPiSubagentTranscriptPage({ transcriptRef: path }));
    expect(page.entries).toHaveLength(1);
    const entry = page.entries[0]!;
    expect(entry.truncated).toBe(true);
    expect(entry.content.length).toBeLessThanOrEqual(
      PI_SUBAGENT_TRANSCRIPT_ENTRY_EXCERPT_MAX_CHARS,
    );
    expect(page.diagnosticCode).toBe("pi_subagent_transcript_entry_truncated");
  });

  it("T12-AC7: a missing artifact reports the stable missing diagnostic", async () => {
    const failure = await Effect.runPromise(
      readPiSubagentTranscriptPage({
        transcriptRef: join(artifactDir, "does-not-exist.output"),
      }).pipe(Effect.flip),
    );
    expect(failure.kind).toBe("missing");
    expect(failure.diagnosticCode).toBe("pi_subagent_transcript_missing");

    const nullRef = await Effect.runPromise(
      readPiSubagentTranscriptPage({ transcriptRef: null }).pipe(Effect.flip),
    );
    expect(nullRef.diagnosticCode).toBe("pi_subagent_transcript_missing");
  });

  it("T12-AC7: corrupt lines are skipped, counted, and never change entry indices", async () => {
    const path = join(artifactDir, "corrupt.output");
    await writeFile(
      path,
      [
        entryLine({ message: { role: "assistant", content: "good-0" } }),
        "{not json",
        entryLine({ message: { role: "assistant", content: "good-2" } }),
        JSON.stringify({ isSidechain: true, type: "unknown-shape" }),
        entryLine({ message: { role: "assistant", content: "good-4" } }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const page = await Effect.runPromise(readPiSubagentTranscriptPage({ transcriptRef: path }));
    expect(page.entries.map((entry) => entry.content)).toEqual(["good-0", "good-2", "good-4"]);
    expect(page.entries.map((entry) => entry.index)).toEqual([0, 2, 4]);
    expect(page.skippedCorruptEntries).toBe(2);
    expect(page.diagnosticCode).toBe("pi_subagent_transcript_corrupt");
  });

  it("T12-AC7: outcome entries render bounded outcome state and diagnostics", async () => {
    const path = join(artifactDir, "outcome.output");
    await writeFile(
      path,
      [
        entryLine({ message: { role: "user", content: "do the thing" }, type: "user" }),
        JSON.stringify({
          isSidechain: true,
          agentId: "agent-1",
          type: "outcome",
          outcome_state: "done",
          outcome_diagnostic: "parser diagnostic text",
          timestamp: "2026-08-19T00:02:00.000Z",
          cwd: "/w",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const page = await Effect.runPromise(readPiSubagentTranscriptPage({ transcriptRef: path }));
    expect(page.entries).toHaveLength(2);
    const outcome = page.entries[1]!;
    expect(outcome.type).toBe("outcome");
    expect(outcome.content).toContain("outcome_state: done");
    expect(outcome.content).toContain("diagnostic: parser diagnostic text");
  });

  it("T12-AC3: an unavailable (non-file) reference reports the stable unavailable diagnostic", async () => {
    const failure = await Effect.runPromise(
      readPiSubagentTranscriptPage({ transcriptRef: artifactDir }).pipe(Effect.flip),
    );
    expect(failure.kind).toBe("unavailable");
    expect(failure.diagnosticCode).toBe("pi_subagent_transcript_unavailable");
  });
});
