// FILE: standaloneDriver.ts
// Purpose: WP3 — Pi standalone driver. Each repetition runs through the real
// Pi session boundary (fresh in-process Pi session with the same
// configuration the Synara modes use), captures startup SessionStats, the
// complete effective tool manifest through the real tool/schema API, the
// fixed two-turn stimulus, and tool-call invalidation.
import fs from "node:fs";
import path from "node:path";

import {
  createMeasurementPiSession,
  enumerateToolManifest,
  measureStandaloneTurn,
  runStimulusTurn,
  summarizeSessionManifest,
  type PiSessionHandle,
} from "./piSession.ts";
import { sanitizePathForReport, sanitizeFailureForReport } from "./sanitize.ts";
import type {
  ExposureEvidence,
  RawSessionStats,
  RepetitionRecord,
  TurnMeasurement,
} from "./types.ts";

export interface StandaloneDriverOptions {
  readonly agentDir: string;
  readonly modelId: string;
  readonly thinkingLevel: string;
  readonly workspaceCwd: string;
  readonly repetitions: number;
  readonly turnsPerRepetition: number;
  readonly localManifestDir: string | null;
  readonly harnessVersion: string;
  readonly promptHash: string;
  readonly promptBytes: number;
  readonly onDiagnostic?: (message: string) => void;
}

export interface StandaloneModeResult {
  readonly repetitions: readonly RepetitionRecord[];
  readonly diagnostics: readonly string[];
}

function toRaw(stats: { readonly tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }): RawSessionStats {
  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    total: stats.tokens.total,
  };
}

export function writeLocalManifest(
  localManifestDir: string | null,
  mode: string,
  repetitionIndex: number,
  entries: readonly ReturnType<typeof enumerateToolManifest>[number][],
): boolean {
  if (localManifestDir === null) return false;
  const manifestDir = path.resolve(localManifestDir);
  fs.mkdirSync(manifestDir, { recursive: true, mode: 0o700 });
  const target = path.join(manifestDir, `${mode}-${repetitionIndex}.manifest.json`);
  fs.writeFileSync(target, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  return true;
}

const STANDALONE_EXPOSURE: ExposureEvidence = {
  mode: "standalone",
  projectSynaraMcpDesiredState: null,
  activationSucceeded: false,
  dormantObserved: true,
  lifecycleFailures: [],
};

export async function runStandaloneMode(
  options: StandaloneDriverOptions,
): Promise<StandaloneModeResult> {
  const diagnostics: string[] = [];
  const repetitions: RepetitionRecord[] = [];
  for (let repetitionIndex = 0; repetitionIndex < options.repetitions; repetitionIndex += 1) {
    let handle: PiSessionHandle | undefined;
    const lifecycleFailures: string[] = [];
    try {
      handle = await createMeasurementPiSession({
        cwd: options.workspaceCwd,
        agentDir: options.agentDir,
        modelId: options.modelId,
        thinkingLevel: options.thinkingLevel as never,
        extensionFactories: [],
      });
      const startup = toRaw(handle.session.getSessionStats());
      const entries = enumerateToolManifest(handle.session);
      const localCaptureProduced = writeLocalManifest(
        options.localManifestDir,
        "standalone",
        repetitionIndex,
        entries,
      );
      const manifest = summarizeSessionManifest(handle.session, {
        localCaptureProduced,
        catalogComplete: true,
      });

      const turns: TurnMeasurement[] = [];
      let previousRaw = startup;
      for (let turnIndex = 1; turnIndex <= options.turnsPerRepetition; turnIndex += 1) {
        const run = await runStimulusTurn(handle, {
          onToolCall: (toolName) =>
            diagnostics.push(
              `standalone/${repetitionIndex} turn ${turnIndex}: tool call observed: ${toolName}`,
            ),
        });
        turns.push(
          measureStandaloneTurn({
            turnIndex,
            before: previousRaw,
            after: run.after,
            toolCalls: run.toolCalls,
            errorMessage: run.errorMessage,
          }),
        );
        previousRaw = run.after;
      }

      const invalidReasons = [
        ...(turns.some((turn) => turn.invalid) ? ["invalid turn(s)"] : []),
        ...(lifecycleFailures.length > 0 ? ["lifecycle failure(s)"] : []),
      ];
      repetitions.push({
        mode: "standalone",
        repetitionIndex,
        manifest,
        startup,
        turns,
        invalid: invalidReasons.length > 0,
        ...(invalidReasons.length > 0 ? { invalidReason: invalidReasons.join(" | ") } : {}),
        exposureEvidence: STANDALONE_EXPOSURE,
        config: {
          model: options.modelId,
          thinkingLevel: options.thinkingLevel,
          promptHash: options.promptHash,
          promptBytes: options.promptBytes,
          workspaceCwd: sanitizePathForReport(options.workspaceCwd),
          agentDir: sanitizePathForReport(options.agentDir),
          harnessVersion: options.harnessVersion,
        },
      });
    } catch (cause) {
      const message = sanitizeFailureForReport(cause);
      lifecycleFailures.push(message);
      diagnostics.push(`standalone/${repetitionIndex} failed: ${message}`);
      const manifest = handle
        ? summarizeSessionManifest(handle.session, {
            localCaptureProduced: false,
            catalogComplete: false,
            catalogIncompleteReason: "repetition failed during measurement",
          })
        : {
            toolNames: [],
            toolCount: 0,
            canonicalBytes: 0,
            hash: "",
            hashAlgorithm: "sha256" as const,
            method: "unavailable",
            localCaptureProduced: false,
            catalogComplete: false,
            catalogIncompleteReason: "session creation failed",
          };
      repetitions.push({
        mode: "standalone",
        repetitionIndex,
        manifest,
        startup: toRawSafe(handle),
        turns: [],
        invalid: true,
        invalidReason: message.slice(0, 500),
        exposureEvidence: { ...STANDALONE_EXPOSURE, lifecycleFailures },
        config: {
          model: options.modelId,
          thinkingLevel: options.thinkingLevel,
          promptHash: options.promptHash,
          promptBytes: options.promptBytes,
          workspaceCwd: sanitizePathForReport(options.workspaceCwd),
          agentDir: sanitizePathForReport(options.agentDir),
          harnessVersion: options.harnessVersion,
        },
      });
    } finally {
      try {
        handle?.session.dispose();
      } catch {
        // Disposal is best-effort; the in-process session has no external
        // resources beyond its transcript in memory.
      }
    }
  }
  return { repetitions, diagnostics };
}

function toRawSafe(handle: PiSessionHandle | undefined): RawSessionStats {
  try {
    if (handle) return toRaw(handle.session.getSessionStats());
  } catch {
    // fall through to zeros
  }
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}
