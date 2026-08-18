import type {
  ServerDiagnosticsChildProcess,
  ServerDiagnosticsPiSubagents,
  ServerDiagnosticsResult,
} from "@synara/contracts";

export interface BuildServerDiagnosticsResultInput {
  readonly generatedAt: string;
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly memory: {
    readonly rss: number;
    readonly heapTotal: number;
    readonly heapUsed: number;
    readonly external: number;
    readonly arrayBuffers: number;
  };
  readonly childProcesses: ReadonlyArray<ServerDiagnosticsChildProcess>;
  readonly projection: {
    readonly projectCount: number;
    readonly threadCount: number;
  };
  readonly piSubagents: ServerDiagnosticsPiSubagents;
  readonly maxChildProcesses: number;
}

const nonNegativeInt = (value: number): number =>
  Math.max(0, Math.round(Number.isFinite(value) ? value : 0));

/**
 * Closed result builder for `serverGetDiagnostics`.
 *
 * The Pi metrics input is already aggregate-only and the returned shape has no
 * content-bearing execution fields, preventing prompts/results/transcripts
 * from entering the default operator surface.
 */
export function buildServerDiagnosticsResult(
  input: BuildServerDiagnosticsResultInput,
): ServerDiagnosticsResult {
  return {
    generatedAt: input.generatedAt,
    process: {
      pid: nonNegativeInt(input.pid),
      uptimeSeconds: nonNegativeInt(input.uptimeSeconds),
      memory: {
        rssBytes: nonNegativeInt(input.memory.rss),
        heapTotalBytes: nonNegativeInt(input.memory.heapTotal),
        heapUsedBytes: nonNegativeInt(input.memory.heapUsed),
        externalBytes: nonNegativeInt(input.memory.external),
        arrayBuffersBytes: nonNegativeInt(input.memory.arrayBuffers),
      },
    },
    childProcesses: input.childProcesses.slice(0, nonNegativeInt(input.maxChildProcesses)),
    childProcessTotalCount: input.childProcesses.length,
    childProcessTotalRssBytes: input.childProcesses.reduce(
      (total, processRow) => total + processRow.rssBytes,
      0,
    ),
    projection: input.projection,
    piSubagents: input.piSubagents,
  };
}
