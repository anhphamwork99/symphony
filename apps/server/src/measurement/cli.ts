// FILE: cli.ts
// Purpose: WP5 — orchestrator CLI for the impl-11 token-overhead measurement
// harness. Configurable model/thinking/repetitions/output/local-manifest-dir,
// defaults to the Decision 34 matrix (3 modes × 3 repetitions × 2 turns),
// exits nonzero on incomplete or unreconciled run sets, and never writes
// secrets or raw sensitive paths into the committed report surface.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PI_THINKING_LEVEL_OPTIONS } from "@synara/contracts";

import { HARNESS_VERSION, printReportSummary, runMeasurement } from "./orchestrator.ts";
import { resolveConfiguredModelId } from "./piSession.ts";
import { prepareLocalManifestDir } from "./standaloneDriver.ts";
import {
  computeFixtureDigest,
  isolateHarnessCwd,
  probeFixtureGitCommit,
} from "./workspace.ts";
import { MEASUREMENT_MODES, type MeasurementMode } from "./types.ts";

const DEFAULT_REPETITIONS = 3;
const DEFAULT_TURNS = 2;
const DEFAULT_THINKING = "medium";
const DEFAULT_OUTPUT = "token-overhead-report.json";

interface CliOptions {
  readonly model: string | undefined;
  readonly thinking: string;
  readonly repetitions: number;
  readonly turns: number;
  readonly output: string;
  readonly localManifestDir: string | null;
  readonly modes: readonly MeasurementMode[];
  readonly agentDir: string | undefined;
  readonly port: number | undefined;
}

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = readArgument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function parseOptions(): CliOptions {
  const thinking = readArgument("thinking") ?? DEFAULT_THINKING;
  if (!(PI_THINKING_LEVEL_OPTIONS as readonly string[]).includes(thinking)) {
    throw new Error(
      `--thinking must be one of: ${PI_THINKING_LEVEL_OPTIONS.join(", ")} (got '${thinking}')`,
    );
  }
  const repetitions = readPositiveInteger("repetitions", DEFAULT_REPETITIONS);
  const turns = readPositiveInteger("turns", DEFAULT_TURNS);
  if (turns !== 2) {
    throw new Error(
      "--turns must be 2: the Decision 34 matrix measures exactly two turns per repetition " +
        "(paired-delta semantics are defined for the two-turn form).",
    );
  }
  const modesRaw = readArgument("modes");
  let modes: readonly MeasurementMode[];
  if (modesRaw === undefined) {
    modes = MEASUREMENT_MODES;
  } else {
    const requested = modesRaw.split(",").map((value) => value.trim()).filter(Boolean);
    const unknown = requested.filter(
      (value) => !(MEASUREMENT_MODES as readonly string[]).includes(value),
    );
    if (unknown.length > 0) {
      throw new Error(`--modes contains unknown modes: ${unknown.join(", ")}`);
    }
    modes = requested as MeasurementMode[];
  }
  const output = readArgument("output") ?? DEFAULT_OUTPUT;
  const localManifestDir = readArgument("local-manifest-dir") ?? null;
  const agentDir = readArgument("agent-dir");
  const portRaw = readArgument("port");
  const port = portRaw === undefined ? undefined : Number(portRaw);
  if (port !== undefined && (!Number.isSafeInteger(port) || port <= 0 || port > 65535)) {
    throw new Error("--port must be a valid TCP port (1-65535)");
  }
  return {
    model: readArgument("model"),
    thinking,
    repetitions,
    turns,
    output,
    localManifestDir,
    modes,
    agentDir,
    port,
  };
}

async function defaultAgentDir(): Promise<string> {
  // Prefer the Pi SDK's own resolution (PI_CODING_AGENT_DIR, then ~/.pi/agent).
  try {
    const piSdk = await importPiSdkConfig();
    return piSdk.getAgentDir();
  } catch {
    return path.join(os.homedir(), ".pi", "agent");
  }
}

let cachedPiSdkConfig:
  | { readonly getAgentDir: () => string; readonly VERSION: string }
  | undefined;
async function importPiSdkConfig(): Promise<{
  readonly getAgentDir: () => string;
  readonly VERSION: string;
}> {
  // The Pi SDK is imported lazily (it brings native dependencies); the CLI
  // only needs its config helpers. Dynamic import is required: the package's
  // exports map has no CommonJS "require" condition.
  if (cachedPiSdkConfig === undefined) {
    const sdk = (await import("@earendil-works/pi-coding-agent")) as unknown as {
      readonly getAgentDir: () => string;
      readonly VERSION: string;
    };
    cachedPiSdkConfig = sdk;
  }
  return cachedPiSdkConfig;
}

/**
 * Decide the model id for the whole matrix: an explicit `--model` always
 * wins; otherwise resolve Pi's configured default provider/model through the
 * SDK settings manager and verify it exists in the model registry (failing
 * clearly instead of picking an arbitrary first registry model).
 */
export async function resolveRunModelId(input: {
  readonly explicitModel: string | undefined;
  readonly agentDir: string;
}): Promise<string> {
  const explicit = input.explicitModel?.trim();
  if (explicit) {
    return explicit;
  }
  return resolveConfiguredModelId(input.agentDir);
}

export async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseOptions();
  } catch (cause) {
    process.stderr.write(
      `Token-overhead measurement configuration error: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  }

  // The harness runs real Pi sessions in-process; Pi extensions (e.g.
  // pi-alfie) write project-local `.pi` state next to process.cwd(), so the
  // harness cwd is isolated in a temp directory and invocation-relative
  // outputs are resolved against the invocation cwd first. The harness must
  // never leave repo-local runtime state behind.
  const invocationCwd = process.cwd();
  const outputPath = path.resolve(options.output);
  const localManifestDir =
    options.localManifestDir === null ? null : path.resolve(options.localManifestDir);
  const cwdIsolation = isolateHarnessCwd();

  const agentDir = options.agentDir ?? (await defaultAgentDir());
  if (!fs.existsSync(path.join(agentDir, "models.json"))) {
    cwdIsolation.restore();
    process.stderr.write(
      `Pi agent directory '${agentDir}' has no models.json; configure Pi (or pass --agent-dir) before running the measurement.\n`,
    );
    return 2;
  }
  let modelId: string;
  try {
    modelId = await resolveRunModelId({ explicitModel: options.model, agentDir });
  } catch (cause) {
    cwdIsolation.restore();
    process.stderr.write(
      `Token-overhead measurement configuration error: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  }
  const fixtureDigest = computeFixtureDigest();
  const fixtureGitCommit = probeFixtureGitCommit();
  if (localManifestDir !== null) {
    // Decision 34 §3: local full-manifest retention is allowed only in an
    // owner-only location that is either outside the repo or proven ignored
    // by git; reject the configuration up front instead of silently skipping
    // retention per repetition.
    const prepared = prepareLocalManifestDir(localManifestDir);
    if (!prepared.ok) {
      cwdIsolation.restore();
      process.stderr.write(
        `Token-overhead measurement configuration error: local manifest directory rejected (${prepared.reason}). ` +
          `Use a directory outside the repository or an ignored (gitignored) path inside it.\n`,
      );
      return 2;
    }
  }

  process.stderr.write(
    `Synara token-overhead measurement harness v${HARNESS_VERSION} (Pi SDK ${(await importPiSdkConfig()).VERSION})\n` +
      `  modes=${options.modes.join(",")} repetitions=${options.repetitions} turns=${options.turns}\n` +
      `  model=${modelId} thinking=${options.thinking} agentDir=${agentDir}\n` +
      `  fixtureDigest=${fixtureDigest} fixtureGitCommit=${fixtureGitCommit ?? "(git unavailable)"}\n`,
  );

  try {
    const result = await runMeasurement({
      agentDir,
      modelId,
      thinkingLevel: options.thinking,
      repetitions: options.repetitions,
      turnsPerRepetition: options.turns,
      localManifestDir,
      modes: options.modes,
      fixtureDigest,
      fixtureGitCommit,
      repoRoot: invocationCwd,
      ...(options.port === undefined ? {} : { serverPort: options.port }),
      onDiagnostic: (message) => process.stderr.write(`${message}\n`),
    });

    const reportJson = `${JSON.stringify(result.report, null, 2)}\n`;
    fs.writeFileSync(outputPath, reportJson, { mode: 0o600 });
    printReportSummary(result.report);

    if (result.exitCode !== 0) {
      process.stderr.write(
        `Measurement completed with insufficient evidence for: ${result.insufficientModes.join(", ")}; ` +
          `report written to ${outputPath} (exit 1).\n`,
      );
    }
    return result.exitCode;
  } catch (cause) {
    process.stderr.write(
      `Token-overhead measurement failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  } finally {
    cwdIsolation.restore();
  }
}
