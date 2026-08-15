// FILE: synaraDriver.ts
// Purpose: WP4 — drive the isolated Synara server through the real RPC/WS
// APIs for the dormant default and successful activated modes. Each
// repetition uses a fresh project/thread/session. Raw turn accounting comes
// from the server's canonical provider event log (`turn.completed` with raw
// SessionStats); normalized snapshots come from the thread detail projection
// (`context-window.updated` activities); activation/exposure evidence comes
// from the real project/thread state over WS. The isolated server is always
// torn down and its temp state removed.
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  type ClientOrchestrationCommand,
  type OrchestrationThreadActivity,
  type OrchestrationThreadDetailSnapshot,
  type PiThinkingLevel,
} from "@synara/contracts";

import {
  SYNARA_MCP_ENABLE_COMMAND,
  SYNARA_MCP_SUCCEEDED_ACTIVITY_KIND,
  SYNARA_MCP_FAILED_ACTIVITY_KIND,
} from "../orchestration/synaraMcpCommand.ts";

import {
  createMeasurementPiSession,
  enumerateToolManifest,
  manifestSummaryFromEntries,
} from "./piSession.ts";
import { writeLocalManifest } from "./standaloneDriver.ts";
import { sanitizePathForReport, sanitizeFailureForReport } from "./sanitize.ts";
import { extractTurnCompletedUsage, reconcileSessionStats } from "./reconciliation.ts";
import { makeTurnMeasurement } from "./records.ts";
import { STIMULUS_TEXT } from "./stimulus.ts";
import { startIsolatedServer, removeIsolatedHomeDir, type IsolatedServer } from "./serverProcess.ts";
import { connectSynaraClient, type SynaraClient } from "./synaraClient.ts";
import type {
  CanonicalManifestSummary,
  ExposureEvidence,
  NormalizedTokenSnapshot,
  RawSessionStats,
  RepetitionRecord,
  TurnMeasurement,
} from "./types.ts";

export const SYNARA_MCP_ACTIVATION_TIMEOUT_MS = 150_000;
export const TURN_COMPLETION_TIMEOUT_MS = 180_000;
export const CANONICAL_LOG_POLL_MS = 250;

export interface SynaraDriverOptions {
  readonly mode: "synara-default" | "synara-activated";
  readonly agentDir: string;
  /** Resolved Pi model id (provider/id) — required so every mode measures the same model. */
  readonly modelId: string;
  readonly thinkingLevel: string;
  readonly workspaceCwd: string;
  readonly repetitions: number;
  readonly turnsPerRepetition: number;
  readonly localManifestDir: string | null;
  readonly harnessVersion: string;
  readonly promptHash: string;
  readonly promptBytes: number;
  readonly serverPort?: number;
  readonly onDiagnostic?: (message: string) => void;
}

export interface SynaraModeResult {
  readonly repetitions: readonly RepetitionRecord[];
  readonly diagnostics: readonly string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  description: string,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms.`);
}

function isoNow(): string {
  return new Date().toISOString();
}

function piModelSelection(modelId: string, thinkingLevel: string) {
  return {
    provider: "pi" as const,
    model: modelId,
    ...(thinkingLevel === "medium"
      ? {}
      : { options: { thinkingLevel: thinkingLevel as PiThinkingLevel } }),
  };
}

export async function runSynaraMode(
  options: SynaraDriverOptions,
): Promise<SynaraModeResult> {
  const diagnosticsLog: string[] = [];
  const onDiagnostic = (message: string) => {
    diagnosticsLog.push(message);
    options.onDiagnostic?.(message);
  };
  let server: IsolatedServer | null = null;
  let client: SynaraClient | null = null;
  const repetitions: RepetitionRecord[] = [];
  try {
    server = await startIsolatedServer({
      ...(options.serverPort === undefined ? {} : { port: options.serverPort }),
    });
    client = await connectSynaraClient(server.port);

    for (let repetitionIndex = 0; repetitionIndex < options.repetitions; repetitionIndex += 1) {
      const record = await runSynaraRepetition({
        client,
        server,
        options,
        repetitionIndex,
        onDiagnostic,
      });
      repetitions.push(record);
    }
  } finally {
    await client?.close().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    if (server) {
      removeIsolatedHomeDir(server.homeDir);
      server = null;
    }
  }
  return { repetitions, diagnostics: diagnosticsLog };
}

interface RepetitionContext {
  readonly client: SynaraClient;
  readonly server: IsolatedServer;
  readonly options: SynaraDriverOptions;
  readonly repetitionIndex: number;
  readonly onDiagnostic: (message: string) => void;
}

async function runSynaraRepetition(context: RepetitionContext): Promise<RepetitionRecord> {
  const { client, server, options, repetitionIndex } = context;
  const projectId = ProjectId.makeUnsafe(randomUUID());
  const threadId = ThreadId.makeUnsafe(randomUUID());
  const lifecycleFailures: string[] = [];
  // Mutable builder for the exposure evidence; the final record is immutable.
  type MutableExposure = { -readonly [K in keyof ExposureEvidence]: ExposureEvidence[K] };
  const exposure: MutableExposure = {
    mode: options.mode,
    projectSynaraMcpDesiredState: null,
    activationSucceeded: false,
    dormantObserved: false,
    lifecycleFailures,
  };

  const guard = async <A>(label: string, run: () => Promise<A>): Promise<A | undefined> => {
    try {
      return await run();
    } catch (cause) {
      const message = sanitizeFailure(cause);
      lifecycleFailures.push(`${label}: ${message}`);
      context.onDiagnostic(`repetition ${repetitionIndex} failed at ${label}: ${message}`);
      return undefined;
    }
  };

  // 1. Fresh project + thread through the real RPC API.
  const projectCreated = await guard("project.create", () =>
    client.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe(randomUUID()),
      projectId,
      kind: "project",
      title: `token-overhead-${repetitionIndex}`,
      workspaceRoot: options.workspaceCwd,
      createWorkspaceRootIfMissing: false,
      defaultModelSelection: piModelSelection(options.modelId, options.thinkingLevel),
      createdAt: isoNow(),
    } satisfies ClientOrchestrationCommand),
  );
  if (projectCreated === undefined) {
    return invalidRepetition(context, exposure, undefined, "project.create failed");
  }

  const threadCreated = await guard("thread.create", () =>
    client.dispatchCommand({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(randomUUID()),
      threadId,
      projectId,
      title: `token-overhead-thread-${repetitionIndex}`,
      modelSelection: piModelSelection(options.modelId, options.thinkingLevel),
      runtimeMode: "full-access",
      interactionMode: "default",
      envMode: "local",
      branch: null,
      worktreePath: null,
      workingDirectory: null,
      createdAt: isoNow(),
    } satisfies ClientOrchestrationCommand),
  );
  if (threadCreated === undefined) {
    return invalidRepetition(context, exposure, undefined, "thread.create failed");
  }

  // 2. Activated mode: a real session must exist before the enable wait-set
  // captures it. Run one unmeasured bootstrap turn (same stimulus) to start
  // the Pi session through the real provider boundary, then enable.
  let bootstrapRaw: RawSessionStats | undefined;
  let completedTurnCount = 0;
  let accountedToolCallCount = 0;
  if (options.mode === "synara-activated") {
    const bootstrap = await guard("bootstrap turn", () =>
      runSynaraTurn(context, threadId, "bootstrap", 1),
    );
    if (bootstrap === undefined) {
      return invalidRepetition(
        context,
        exposure,
        undefined,
        "bootstrap turn failed: activation requires a started session",
      );
    }
    bootstrapRaw = bootstrap.after;
    completedTurnCount = 1;
    accountedToolCallCount = bootstrap.toolCalls.length;
    context.onDiagnostic(
      `bootstrap turn (dormant catalog, unmeasured): input=${bootstrapRaw.input} output=${bootstrapRaw.output} cacheRead=${bootstrapRaw.cacheRead} cacheWrite=${bootstrapRaw.cacheWrite} total=${bootstrapRaw.total}`,
    );
    if (bootstrap.toolCalls.length > 0) {
      context.onDiagnostic(
        `bootstrap turn observed tool calls (recorded, not measured): ${bootstrap.toolCalls.join(", ")}`,
      );
    }

    const activation = await guard("enable Synara MCP", () =>
      runSynaraMcpEnable(context, threadId, projectId, exposure),
    );
    if (activation === undefined || !activation) {
      return invalidRepetition(
        context,
        exposure,
        undefined,
        "Synara MCP activation did not reach its real successful terminal state",
      );
    }
  }

  // 3. The two (or more) measured turns.
  const turns: TurnMeasurement[] = [];
  let previousRaw: RawSessionStats = bootstrapRaw ?? zeroStats();
  const manifest = await captureSynaraManifest(context);
  for (let turnIndex = 1; turnIndex <= options.turnsPerRepetition; turnIndex += 1) {
    const expectedCompleted = completedTurnCount + 1;
    const turnRun = await guard(`measured turn ${turnIndex}`, () =>
      runSynaraTurn(context, threadId, `measured-${turnIndex}`, expectedCompleted),
    );
    if (turnRun === undefined) {
      turns.push(
        makeTurnMeasurement({
          turnIndex,
          before: previousRaw,
          after: previousRaw,
          invalidReason: `turn ${turnIndex} did not complete (lifecycle failure)`,
        }),
      );
      continue;
    }
    completedTurnCount = expectedCompleted;
    const toolCalls = turnRun.toolCalls.slice(accountedToolCallCount);
    accountedToolCallCount += toolCalls.length;
    const measurement = makeTurnMeasurement({
      turnIndex,
      before: previousRaw,
      after: turnRun.after,
      ...(turnRun.normalized === undefined ? {} : { normalized: turnRun.normalized }),
      ...(toolCalls.length > 0
        ? { invalidReason: `tool call observed: ${toolCalls.join(", ")}` }
        : {}),
    });
    turns.push(measurement);
    previousRaw = turnRun.after;
  }
  // 4. Exposure evidence finalization.
  const snapshot = await client
    .getSnapshot()
    .catch(() => null);
  const project = snapshot?.projects.find((candidate) => candidate.id === projectId) ?? null;
  exposure.projectSynaraMcpDesiredState =
    project?.synaraMcpDesiredState ?? (options.mode === "synara-default" ? "absent" : null);
  if (options.mode === "synara-default") {
    exposure.dormantObserved =
      exposure.projectSynaraMcpDesiredState !== "enabled" &&
      !turns.some((turn) => turn.invalidReason?.includes("tool call observed: synara_"));
    const detail = await client.getThreadDetailSnapshot(threadId).catch(() => null);
    const synaraActivities = detail?.thread.activities.filter((activity) =>
      activity.kind.startsWith("synara.mcp.command."),
    );
    exposure.dormantObserved =
      exposure.dormantObserved && (synaraActivities === undefined || synaraActivities.length === 0);
  }

  const invalidReasons: string[] = [
    ...(turns.some((turn) => turn.invalid) ? ["invalid turn(s)"] : []),
    ...(lifecycleFailures.length > 0 ? ["lifecycle failure(s)"] : []),
  ];
  if (options.mode === "synara-activated" && !exposure.activationSucceeded) {
    invalidReasons.push("activation did not succeed");
  }
  if (options.mode === "synara-default" && !exposure.dormantObserved) {
    invalidReasons.push("dormancy not observed");
  }

  return {
    mode: options.mode,
    repetitionIndex,
    manifest,
    startup: bootstrapRaw ?? zeroStats(),
    turns,
    invalid: invalidReasons.length > 0,
    ...(invalidReasons.length > 0 ? { invalidReason: invalidReasons.join(" | ") } : {}),
    exposureEvidence: exposure,
    config: {
      model: options.modelId,
      thinkingLevel: options.thinkingLevel,
      promptHash: options.promptHash,
      promptBytes: options.promptBytes,
      workspaceCwd: sanitizePathForReport(options.workspaceCwd),
      agentDir: sanitizePathForReport(options.agentDir),
      harnessVersion: options.harnessVersion,
    },
  };
}

function invalidRepetition(
  context: RepetitionContext,
  exposure: ExposureEvidence,
  manifest: CanonicalManifestSummary | undefined,
  reason: string,
): RepetitionRecord {
  const { options, repetitionIndex } = context;
  return {
    mode: context.options.mode,
    repetitionIndex: context.repetitionIndex,
    manifest: manifest ?? {
      toolNames: [],
      toolCount: 0,
      canonicalBytes: 0,
      hash: "",
      hashAlgorithm: "sha256",
      method: "unavailable",
      localCaptureProduced: false,
      catalogComplete: false,
      catalogIncompleteReason: "repetition failed before manifest capture",
    },
    startup: zeroStats(),
    turns: [],
    invalid: true,
    invalidReason: reason,
    exposureEvidence: exposure,
    config: {
      model: context.options.modelId,
      thinkingLevel: context.options.thinkingLevel,
      promptHash: context.options.promptHash,
      promptBytes: context.options.promptBytes,
      workspaceCwd: sanitizePathForReport(context.options.workspaceCwd),
      agentDir: sanitizePathForReport(context.options.agentDir),
      harnessVersion: context.options.harnessVersion,
    },
  };
}

function zeroStats(): RawSessionStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function sanitizeFailure(cause: unknown): string {
  // Never surface credentials, tokens, or raw filesystem paths in the report.
  return sanitizeFailureForReport(cause)
    .replace(/\s\/[^\s]+/g, " <path-redacted>");
}

interface SynaraTurnResult {
  readonly after: RawSessionStats;
  readonly normalized: NormalizedTokenSnapshot | undefined;
  readonly toolCalls: readonly string[];
}

async function runSynaraTurn(
  context: RepetitionContext,
  threadId: ThreadId,
  label: string,
  expectedCompletedCount: number,
): Promise<SynaraTurnResult> {
  const { client, server, options } = context;
  const createdAt = isoNow();
  const command: ClientOrchestrationCommand = {
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(randomUUID()),
    threadId,
    message: {
      messageId: MessageId.makeUnsafe(randomUUID()),
      role: "user",
      text: STIMULUS_TEXT,
      attachments: [],
    },
    modelSelection: piModelSelection(options.modelId, options.thinkingLevel),
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt,
  };
  await client.dispatchCommand(command);

  // Wait for the turn we just dispatched (its requestedAt is >= the command's
  // createdAt) to reach a completed/error/interrupted terminal state.
  const detail = await poll(
    () => client.getThreadDetailSnapshot(threadId).then((value) => value ?? null),
    (value) =>
      value !== null &&
      value.thread.latestTurn !== null &&
      value.thread.latestTurn.requestedAt >= createdAt &&
      value.thread.latestTurn.completedAt !== null,
    `turn '${label}' to complete`,
    TURN_COMPLETION_TIMEOUT_MS,
  );
  const latestTurn = detail!.thread.latestTurn;
  if (latestTurn === null || latestTurn.state === "error" || latestTurn.state === "interrupted") {
    throw new Error(
      `Turn '${label}' ended in state '${latestTurn?.state ?? "unknown"}' with no completed accounting.`,
    );
  }

  // Raw accounting: canonical provider event log (turn.completed with raw
  // usage). The log is append-only, so the expected Nth completed record for
  // this thread is the one to read; earlier records belong to earlier turns.
  const [raw, toolCallEvents] = await Promise.all([
    readTurnCompletedUsage(
      server.providerEventLogPath,
      String(threadId),
      expectedCompletedCount,
    ),
    readToolCallEvents(server.providerEventLogPath, String(threadId)),
  ]);

  // Normalized snapshot: the thread detail's context-window.updated activity
  // for this turn (the projection of thread.token-usage.updated).
  const normalized = readNormalizedFromActivities(detail!, latestTurn.turnId);

  return { after: raw, normalized, toolCalls: toolCallEvents };
}

async function readTurnCompletedUsage(
  logPath: string,
  threadId: string,
  expectedCount: number,
): Promise<RawSessionStats> {
  const deadline = Date.now() + 30_000;
  let lastFailure: string | undefined;
  while (Date.now() < deadline) {
    try {
      const content = fs.readFileSync(logPath, "utf8");
      const completed = parseCanonicalTurnCompletedEvents(content, threadId);
      if (completed.length >= expectedCount) {
        const extracted = extractTurnCompletedUsage(completed[expectedCount - 1]!);
        if (extracted.ok) {
          const reconciled = reconcileSessionStats(extracted.value.usage);
          if (reconciled.ok) {
            return extracted.value.usage;
          }
          lastFailure = reconciled.failures.join("; ");
        } else {
          lastFailure = extracted.failures.join("; ");
        }
      }
    } catch (cause) {
      lastFailure = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(CANONICAL_LOG_POLL_MS);
  }
  throw new Error(
    `No reconcilable turn.completed raw usage (expected ${expectedCount} completed turns) found in the canonical event log for thread ${threadId}${lastFailure ? ` (last failure: ${lastFailure})` : ""}.`,
  );
}

export function parseCanonicalTurnCompletedEvents(
  logContent: string,
  threadId: string,
): readonly Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of logContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const jsonStart = trimmed.indexOf("{");
    if (jsonStart < 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed.slice(jsonStart));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    if (record.type !== "turn.completed") continue;
    if (record.threadId !== threadId) continue;
    if (typeof record.payload !== "object" || record.payload === null) continue;
    events.push(record.payload as Record<string, unknown>);
  }
  return events;
}

/**
 * Tool-call evidence from the canonical event log: every `item.started`
 * event for the thread whose payload data carries a tool name (the Pi
 * adapter emits one per `tool_execution_start`). Tool-call output is never
 * folded into startup/catalog overhead (Decision 34 §2).
 */
export function parseCanonicalToolCallEvents(
  logContent: string,
  threadId: string,
): readonly string[] {
  const toolNames: string[] = [];
  for (const line of logContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const jsonStart = trimmed.indexOf("{");
    if (jsonStart < 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed.slice(jsonStart));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    if (record.type !== "item.started") continue;
    if (record.threadId !== threadId) continue;
    if (typeof record.payload !== "object" || record.payload === null) continue;
    const payload = record.payload as Record<string, unknown>;
    const data = typeof payload.data === "object" && payload.data !== null ? (payload.data as Record<string, unknown>) : undefined;
    const toolName = typeof data?.toolName === "string" ? data.toolName : undefined;
    if (toolName !== undefined) {
      toolNames.push(toolName);
    }
  }
  return toolNames;
}

async function readToolCallEvents(
  logPath: string,
  threadId: string,
): Promise<readonly string[]> {
  try {
    const content = fs.readFileSync(logPath, "utf8");
    return parseCanonicalToolCallEvents(content, threadId);
  } catch {
    return [];
  }
}

function readNormalizedFromActivities(
  detail: OrchestrationThreadDetailSnapshot,
  turnId: string,
): NormalizedTokenSnapshot | undefined {
  const candidates = detail.thread.activities.filter(
    (activity) =>
      activity.kind === "context-window.updated" && activity.turnId === turnId,
  );
  const latest = candidates.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )[candidates.length - 1];
  if (!latest) return undefined;
  return readUsageFromActivityPayload(latest.payload);
}

function readUsageFromActivityPayload(payload: unknown): NormalizedTokenSnapshot | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const usedTokens = record.usedTokens;
  if (typeof usedTokens !== "number") return undefined;
  const optionalNumber = (key: string): number | undefined =>
    typeof record[key] === "number" ? (record[key] as number) : undefined;
  const result: NormalizedTokenSnapshot = { usedTokens };
  for (const key of [
    "usedPercent",
    "totalProcessedTokens",
    "maxTokens",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "lastUsedTokens",
    "lastInputTokens",
    "lastCachedInputTokens",
    "lastOutputTokens",
  ] as const) {
    const value = optionalNumber(key);
    if (value !== undefined) {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

async function runSynaraMcpEnable(
  context: RepetitionContext,
  threadId: ThreadId,
  projectId: ProjectId,
  exposure: { -readonly [K in keyof ExposureEvidence]: ExposureEvidence[K] },
): Promise<boolean> {
  const { client, options } = context;
  const command: ClientOrchestrationCommand = {
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(randomUUID()),
    threadId,
    message: {
      messageId: MessageId.makeUnsafe(randomUUID()),
      role: "user",
      text: SYNARA_MCP_ENABLE_COMMAND,
      attachments: [],
    },
    modelSelection: piModelSelection(options.modelId, options.thinkingLevel),
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: isoNow(),
  };
  await client.dispatchCommand(command);

  const deadline = Date.now() + SYNARA_MCP_ACTIVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [detail, snapshot] = await Promise.all([
      client.getThreadDetailSnapshot(threadId).catch(() => null),
      client.getSnapshot().catch(() => null),
    ]);
    const activities = detail?.thread.activities ?? [];
    const terminal = findSynaraMcpTerminalActivity(activities);
    if (terminal) {
      exposure.activationDetail = sanitizeFailure(terminal.payload);
      if (terminal.status === "succeeded") {
        exposure.activationSucceeded = true;
      }
      if (terminal.status === "failed") {
        return false;
      }
    }
    const project = snapshot?.projects.find((candidate) => candidate.id === projectId) ?? null;
    if (project?.synaraMcpDesiredState !== undefined) {
      exposure.projectSynaraMcpDesiredState = project.synaraMcpDesiredState;
    }
    if (terminal && exposure.activationSucceeded) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function findSynaraMcpTerminalActivity(
  activities: readonly OrchestrationThreadActivity[],
): { readonly status: "succeeded" | "failed"; readonly payload: unknown } | null {
  for (const activity of activities) {
    if (activity.kind === SYNARA_MCP_SUCCEEDED_ACTIVITY_KIND) {
      return { status: "succeeded", payload: activity.payload };
    }
    if (activity.kind === SYNARA_MCP_FAILED_ACTIVITY_KIND) {
      return { status: "failed", payload: activity.payload };
    }
  }
  return null;
}

/**
 * Capture the complete effective coding-tool manifest for a Synara mode
 * through the real Pi tool/schema API with the same configuration the
 * isolated server resolves (same agent dir, cwd, model, thinking level; no
 * Synara extension — the dormant extension registers no tools before
 * activation, and the spec guarantees default sessions contain exactly the
 * configured coding-agent tool set). The full manifest is retained locally
 * when a local manifest dir is configured; committed output contains only
 * names/count/bytes/hash/method.
 */
async function captureSynaraManifest(
  context: RepetitionContext,
): Promise<CanonicalManifestSummary> {
  const { options, repetitionIndex } = context;
  let localCaptureProduced = false;
  let catalogComplete = true;
  let catalogIncompleteReason: string | undefined;
  let summary: CanonicalManifestSummary | undefined;

  try {
    const session = await createMeasurementPiSession({
      cwd: options.workspaceCwd,
      agentDir: options.agentDir,
      ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
      thinkingLevel: options.thinkingLevel as never,
      extensionFactories: [],
    });
    const entries = enumerateToolManifest(session.session);
    session.session.dispose();
    if (options.mode === "synara-activated") {
      // The Synara MCP gateway catalog is served by the isolated server's
      // gateway with in-memory per-session bearer credentials that no
      // external process can obtain; the coding-tool portion is complete and
      // real, and the synara_* portion is recorded as not externally
      // capturable (Decision 34 fail-closed: no partial catalog is presented
      // as complete). This makes the activated-mode catalog-size claim
      // insufficient evidence while every accounting component stays real.
      catalogComplete = false;
      catalogIncompleteReason =
        "synara-mcp-catalog-not-externally-capturable: the isolated server's gateway " +
        "credentials are in-memory per-session tokens; no WS/RPC/event surface " +
        "enumerates the effective Pi tool catalog, so the synara_* schema bytes " +
        "cannot be measured at the harness boundary (Decision 34 §3 fail-closed).";
    }
    summary = manifestSummaryFromEntries(entries, {
      localCaptureProduced: false,
      catalogComplete,
      ...(catalogIncompleteReason === undefined
        ? {}
        : { catalogIncompleteReason }),
    });
    localCaptureProduced = writeLocalManifest(
      options.localManifestDir,
      options.mode,
      repetitionIndex,
      entries,
    );
    if (localCaptureProduced) {
      summary = manifestSummaryFromEntries(entries, {
        localCaptureProduced: true,
        catalogComplete,
        ...(catalogIncompleteReason === undefined
          ? {}
          : { catalogIncompleteReason }),
      });
    }
    return summary;
  } catch (cause) {
    context.onDiagnostic(
      `manifest capture failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return {
      toolNames: [],
      toolCount: 0,
      canonicalBytes: 0,
      hash: "",
      hashAlgorithm: "sha256",
      method: "in-process-pi-tool-api",
      localCaptureProduced,
      catalogComplete: false,
      catalogIncompleteReason:
        "manifest capture failed: " +
        (cause instanceof Error ? cause.message : String(cause)).slice(0, 300),
    };
  }
}

