import crypto from "node:crypto";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type AntigravityModelOptions,
  EventId,
  type ProviderComposerCapabilities,
  type ProviderListModelsResult,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@synara/contracts";
import { Effect, Layer, Option, Queue, Stream } from "effect";

import {
  type AcpStdioProxySpawn,
  buildAntigravityMcpPluginConfig,
  SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN_ENV,
  SYNARA_AGENT_GATEWAY_URL_ENV,
} from "../../agentGateway/mcpInjection.ts";
import {
  type SynaraHarnessPolicyDeliveryState,
  takeSynaraHarnessPolicyForProviderSession,
} from "../../agentGateway/harnessPolicy.ts";
import {
  AgentGatewayCredentials,
  type AgentGatewayMcpConnection,
} from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import {
  acquireAgentGatewaySessionLease,
  cancelAgentGatewayTurn,
  type AgentGatewaySessionLease,
} from "../../agentGateway/sessionLease.ts";
import type { McpAuthorityBinding } from "../../agentGateway/mcpSessionAuthority.ts";
import {
  MAX_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
  MAX_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
  MAX_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
  MAX_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
  MAX_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
  MIN_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
  MIN_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
  MIN_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
  MIN_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
  MIN_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_LIFECYCLE,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
  type AntigravityTerminalRecoveryMode,
  ServerConfig,
} from "../../config.ts";
import { buildProviderChildEnvironment } from "../../providerChildEnvironment.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import {
  AntigravityAdapter,
  type AntigravityAdapterShape,
} from "../Services/AntigravityAdapter.ts";
import {
  PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
  type ProviderThreadSnapshot,
} from "../Services/ProviderAdapter.ts";
import { appendFileAttachmentsPromptBlock } from "../attachmentProjection.ts";
import { makeBoundedCallbackIngress } from "../boundedCallbackIngress.ts";
import {
  compactProviderRuntimeEventForIngress,
  isTerminalProviderRuntimeEvent,
  PROVIDER_RUNTIME_CALLBACK_BUFFER_MAX_BYTES,
  PROVIDER_RUNTIME_CALLBACK_TERMINAL_RESERVE,
  providerRuntimeEventBytes,
} from "../providerRuntimeEventIngress.ts";
import {
  ProviderProcessExitUnprovenError,
  teardownChildProcessTree,
} from "../supervisedProcessTeardown.ts";

const PROVIDER = "antigravity" as const;
const DEFAULT_MODEL = "Gemini 3.5 Flash";
const PRINT_TIMEOUT = "30m";
const POLL_INTERVAL_MS = 75;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const PLUGIN_INSTALL_TIMEOUT_MS = 30_000;
const HELPER_OUTPUT_MAX_CHARS = 128 * 1024;
const WINDOWS_PROMPT_MAX_CHARS = 24_000;
const DEFAULT_TERMINAL_RECOVERY_GRACE_MS = 15_000;
const QUARANTINE_REAP_INTERVAL_MS = 1_000;
export const SYNARA_ANTIGRAVITY_STOP_IDLE_ENV = "SYNARA_ANTIGRAVITY_STOP_IDLE";
export const SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS_ENV =
  "SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS";

type TranscriptStep = {
  readonly step_index?: number;
  readonly source?: string;
  readonly type?: string;
  readonly status?: string;
  readonly content?: string;
  readonly tool_calls?: ReadonlyArray<{
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  }> | null;
  readonly [key: string]: unknown;
};

type PendingTool = {
  readonly stepIndex: number;
  readonly itemId: RuntimeItemId;
  readonly itemType: "command_execution" | "file_change" | "dynamic_tool_call" | "web_search";
  readonly name: string;
};

type StoredTurn = {
  readonly id: TurnId;
  readonly items: unknown[];
};

type RecoveryOwnership = {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly lifecycleGeneration?: string;
  readonly child: AntigravityChildProcess;
  readonly runDir: string;
  readonly gatewaySessionLease?: AgentGatewaySessionLease;
};

type CompletionCandidate = {
  readonly stepIndex: number;
  readonly activityRevision: number;
};

type RecoveryTeardownOutcome =
  | {
      readonly kind: "proven";
      readonly result: Awaited<ReturnType<typeof teardownChildProcessTree>>;
    }
  | { readonly kind: "unproven"; readonly cause: unknown };

type TerminalClaimant =
  | "normal-close"
  | "watchdog"
  | "process-error"
  | "stop-hook"
  | "stop-idle"
  | "interrupt"
  | "session-stop";

type RecoveryState =
  | {
      readonly phase: "ineligible";
      readonly activityRevision: number;
      readonly lastActivityAtMs: number;
    }
  | {
      readonly phase: "grace";
      readonly activityRevision: number;
      readonly lastActivityAtMs: number;
      readonly candidate: CompletionCandidate;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  | {
      readonly phase: "shadowed";
      readonly activityRevision: number;
      readonly lastActivityAtMs: number;
      readonly candidate: CompletionCandidate;
    }
  | {
      readonly phase: "final-drain";
      readonly activityRevision: number;
      readonly lastActivityAtMs: number;
      readonly candidate: CompletionCandidate;
      readonly ownership: RecoveryOwnership;
    }
  | {
      readonly phase: "teardown";
      readonly activityRevision: number;
      readonly lastActivityAtMs: number;
      readonly candidate: CompletionCandidate;
      readonly ownership: RecoveryOwnership;
      readonly closeObserved: boolean;
      readonly teardownOutcome: Promise<RecoveryTeardownOutcome>;
    };

/** Stop-idle lifecycle state; presence alone suppresses legacy recovery. */
type StopIdleState = {
  phase: "background-active" | "close-wait";
  observations: number;
  idleConfirmed: boolean;
  capReached: boolean;
  timer?: ReturnType<typeof setTimeout>;
  emitted: { active: boolean; idle: boolean; finalizing: boolean };
};

type QuarantineRecord = {
  readonly ownership: RecoveryOwnership;
  readonly runDir: string;
  readonly gatewaySessionLease?: AgentGatewaySessionLease;
  stopRequested: boolean;
  retryTimer?: ReturnType<typeof setTimeout>;
  reapInFlight: boolean;
  reapPromise?: Promise<boolean>;
  exitObserved?: boolean;
  cleanupUnconfirmedDiagnostic?: string;
  cleanupUnconfirmedReported?: boolean;
};

type PreparationCleanupFence = {
  readonly runDir: string;
  readonly gatewaySessionLease?: AgentGatewaySessionLease;
  readonly admissionGeneration: number;
  stopRequested: boolean;
  retryTimer?: ReturnType<typeof setTimeout>;
  cleanupPromise?: Promise<boolean>;
};

type AntigravitySessionContext = {
  session: ProviderSession;
  gatewaySessionLease?: AgentGatewaySessionLease;
  /**
   * Server-minted subject-bound authority snapshot resolved at session start
   * (Decision 21). Antigravity mints its gateway lease lazily per turn, so the
   * binding is carried here and never inferred from thread/provider state.
   */
  readonly mcpAuthority?: McpAuthorityBinding | null;
  harnessPolicyDelivered?: boolean;
  readonly lifecycleGeneration?: string;
  readonly binaryPath: string;
  readonly turns: StoredTurn[];
  activeTurnId?: TurnId | undefined;
  activeProcess?: AntigravityChildProcess | undefined;
  activeRunDir?: string | undefined;
  activePrompt?: string | undefined;
  eventFile?: string | undefined;
  transcriptPath?: string | undefined;
  conversationId?: string | undefined;
  modelName?: string | undefined;
  modelOptions?: AntigravityModelOptions | undefined;
  processedHookBytes: number;
  processedTranscriptBytes: number;
  processedTranscriptPath?: string | undefined;
  processedSteps: Set<number>;
  latestUserStepIndex?: number;
  pendingTools: PendingTool[];
  nextToolSequence: number;
  sawAssistant: boolean;
  /** Set once the turn emits any user-visible output (assistant text or tool activity). */
  turnOutputProduced: boolean;
  interrupted: boolean;
  stopped: boolean;
  stopRequested: boolean;
  /** Guards against double turn.completed (process close + interrupt/stop). */
  turnTerminalEmitted: boolean;
  recovery: RecoveryState;
  stopIdle?: StopIdleState;
  quarantine?: QuarantineRecord;
  preparationCleanupFence?: PreparationCleanupFence;
  pollInFlight?: Promise<void>;
  pollTimer?: ReturnType<typeof setInterval>;
  admissionGeneration: number;
  terminalClaimant?: TerminalClaimant;
  terminalTeardown?: Promise<RecoveryTeardownOutcome>;
  terminalSettlement?: Promise<void>;
};

function makeRawAntigravityEvent(messageType: string, payload: unknown) {
  return {
    source: "antigravity.cli.event" as const,
    messageType,
    payload,
  };
}

function clearRecoveryTimer(recovery: RecoveryState): void {
  if (recovery.phase === "grace") clearTimeout(recovery.timer);
}

function captureOwnership(context: AntigravitySessionContext): RecoveryOwnership | undefined {
  if (
    context.activeTurnId === undefined ||
    context.activeProcess === undefined ||
    context.activeRunDir === undefined
  ) {
    return;
  }
  return {
    threadId: context.session.threadId,
    turnId: context.activeTurnId,
    ...(context.lifecycleGeneration !== undefined
      ? { lifecycleGeneration: context.lifecycleGeneration }
      : {}),
    child: context.activeProcess,
    runDir: context.activeRunDir,
    ...(context.gatewaySessionLease !== undefined
      ? { gatewaySessionLease: context.gatewaySessionLease }
      : {}),
  };
}

function claimTerminal(context: AntigravitySessionContext, claimant: TerminalClaimant): boolean {
  if (context.terminalClaimant === undefined) {
    context.terminalClaimant = claimant;
    return true;
  }
  return context.terminalClaimant === claimant;
}

function currentTurn(context: AntigravitySessionContext): StoredTurn | undefined {
  return context.activeTurnId
    ? context.turns.find((turn) => turn.id === context.activeTurnId)
    : undefined;
}

function snapshot(context: AntigravitySessionContext): ProviderThreadSnapshot {
  return {
    threadId: context.session.threadId,
    ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
    turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
  };
}

async function noopMaybeRecoverTerminalAnswer(_context: AntigravitySessionContext): Promise<void> {
  return undefined;
}

function messageFromCause(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function trim(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result ? result : undefined;
}

function parseTranscriptStep(value: unknown): TranscriptStep | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.type !== "string" ||
    !Number.isInteger(record.step_index) ||
    (record.step_index as number) < 0
  ) {
    return undefined;
  }
  if (record.content !== undefined && typeof record.content !== "string") return undefined;
  if (record.tool_calls !== undefined && record.tool_calls !== null) {
    if (!Array.isArray(record.tool_calls)) return undefined;
    for (const call of record.tool_calls) {
      if (!call || typeof call !== "object" || Array.isArray(call)) return undefined;
      const callRecord = call as Record<string, unknown>;
      if (callRecord.name !== undefined && typeof callRecord.name !== "string") return undefined;
      if (
        callRecord.args !== undefined &&
        (!callRecord.args || typeof callRecord.args !== "object" || Array.isArray(callRecord.args))
      ) {
        return undefined;
      }
    }
  }
  return value as TranscriptStep;
}

/** Sanitized Stop observation fields the capture hook persists. */
type StopIdleObservation = {
  readonly fullyIdle: boolean;
  readonly continued?: boolean;
  readonly continuationLimit?: number;
  readonly executionNum?: number;
  readonly terminationReason?: string;
};

// Only a boolean fullyIdle selects the stop-idle lifecycle; anything else is
// the legacy fail-open Stop path with unchanged settlement behavior.
function parseStopIdleObservation(
  payload: Record<string, unknown>,
): StopIdleObservation | undefined {
  const fullyIdle = payload.fullyIdle;
  if (typeof fullyIdle !== "boolean") return undefined;
  const continued = typeof payload.continued === "boolean" ? payload.continued : undefined;
  const continuationLimit =
    typeof payload.continuationLimit === "number" &&
    Number.isInteger(payload.continuationLimit) &&
    payload.continuationLimit >= 0
      ? payload.continuationLimit
      : undefined;
  const executionNum =
    typeof payload.executionNum === "number" &&
    Number.isInteger(payload.executionNum) &&
    payload.executionNum >= 0
      ? payload.executionNum
      : undefined;
  const terminationReason = trim(payload.terminationReason)?.slice(0, 200);
  return {
    fullyIdle,
    ...(continued !== undefined ? { continued } : {}),
    ...(continuationLimit !== undefined ? { continuationLimit } : {}),
    ...(executionNum !== undefined ? { executionNum } : {}),
    ...(terminationReason !== undefined ? { terminationReason } : {}),
  };
}

function resumeConversationId(value: unknown): string | undefined {
  if (typeof value === "string") return trim(value);
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["conversationId", "providerThreadId", "id"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

function transcriptPathForConversation(conversationId: string): string {
  return path.join(
    os.homedir(),
    ".gemini",
    "antigravity-cli",
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
}

function shellQuote(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Hook output when capture is inactive (the session is not Synara-managed).
 * Antigravity requires PreToolUse output to carry a `decision`: an empty
 * object is treated as a denial with an empty reason, which blocks every tool
 * call because the hook is installed globally with `matcher: "*"` (#490).
 * "ask" preserves the permission flow the user would have without the hook.
 * `{}` stays correct for the other hook points, including Stop, where an
 * inactive hook must not force a decision over Antigravity's default.
 *
 * Active Stop hooks must also stay neutral (`{}`). Returning
 * `{"decision":"stop"}` is not a valid Antigravity/Claude stop decision
 * (only `"block"` is recognized to prevent exit) and can leave the print
 * process hung after the assistant has already finished, so the UI stays
 * "Working" and Cancel has nothing left to kill (#465).
 */
function inactiveHookOutput(event: string): string {
  return event === "pre-tool" ? '{"decision":"ask"}' : "{}";
}

export function buildAntigravityCaptureCommand(
  executablePath: string,
  scriptPath: string,
  event: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const invocation = `${shellQuote(executablePath, platform)} ${shellQuote(scriptPath, platform)} ${shellQuote(event, platform)}`;
  const fallback = inactiveHookOutput(event);
  if (platform === "win32") {
    return `if not defined SYNARA_ANTIGRAVITY_EVENTS (more >nul 2>nul & echo ${fallback}) else (set "ELECTRON_RUN_AS_NODE=1" && ${invocation})`;
  }
  return `if [ -z "\${SYNARA_ANTIGRAVITY_EVENTS:-}" ]; then cat >/dev/null 2>&1 || :; printf '%s\\n' '${fallback}'; else ELECTRON_RUN_AS_NODE=1 ${invocation}; fi`;
}

export function hookScriptSource(): string {
  return `const fs = require("node:fs");
const event = process.argv[2] || "unknown";
let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", () => {
  const target = process.env.SYNARA_ANTIGRAVITY_EVENTS;
  if (!target) {
    // Mirrors the shell wrapper's inactive fallback: PreToolUse must carry a
    // decision or Antigravity denies the tool call with an empty reason.
    process.stdout.write((event === "pre-tool" ? '{"decision":"ask"}' : "{}") + "\\n");
    return;
  }
  let capturedPayload = payload.trim();
  // Neutral for every hook except pre-tool's permission decision and the
  // stop-idle continuation below.
  let hookOutput = "{}";
  if (event === "pre-tool" || event === "post-tool") {
    try {
      const input = JSON.parse(capturedPayload);
      const sanitized = {};
      for (const key of ["conversationId", "transcriptPath", "modelName"]) {
        if (typeof input[key] === "string" && input[key].trim()) sanitized[key] = input[key];
      }
      if (Number.isInteger(input.stepIdx) && input.stepIdx >= 0) sanitized.stepIdx = input.stepIdx;
      if (event === "pre-tool") {
        const name = input.toolCall && typeof input.toolCall.name === "string"
          ? input.toolCall.name.trim()
          : "";
        if (name) sanitized.toolCall = { name };
      } else {
        sanitized.failed = typeof input.error === "string" && input.error.trim().length > 0;
      }
      capturedPayload = JSON.stringify(sanitized);
    } catch {
      capturedPayload = "{}";
    }
  } else if (event === "stop") {
    // Stop carries the aggregate background-idle contract (fullyIdle). Only
    // sanitized bounded fields are persisted; the continuation decision is
    // bounded by the server-provided budget so a runaway loop cannot spin.
    // Missing/malformed fullyIdle stays legacy fail-open: record what is
    // recognizable and answer "{}" so the agent may exit.
    try {
      const input = JSON.parse(capturedPayload);
      const sanitized = {};
      for (const key of ["conversationId", "transcriptPath", "modelName"]) {
        if (typeof input[key] === "string" && input[key].trim()) sanitized[key] = input[key];
      }
      if (Number.isInteger(input.executionNum) && input.executionNum >= 0) {
        sanitized.executionNum = input.executionNum;
      }
      if (typeof input.terminationReason === "string" && input.terminationReason.trim()) {
        sanitized.terminationReason = input.terminationReason.trim().slice(0, 200);
      }
      if (typeof input.error === "string" && input.error.trim()) {
        sanitized.error = input.error.trim().slice(0, 500);
      }
      if (typeof input.fullyIdle === "boolean") {
        sanitized.fullyIdle = input.fullyIdle;
        if (process.env.SYNARA_ANTIGRAVITY_STOP_IDLE === "1") {
          const parsedLimit = Number(process.env.SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS);
          const continuationLimit =
            Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 0;
          if (input.fullyIdle) {
            sanitized.continued = false;
          } else {
            // Stop's official executionNum is the zero-based continuation
            // sequence, so the decision stays O(1) regardless of event-file size.
            const continued =
              Number.isInteger(input.executionNum) &&
              input.executionNum >= 0 &&
              input.executionNum < continuationLimit;
            sanitized.continued = continued;
            sanitized.continuationLimit = continuationLimit;
            if (continued) hookOutput = '{"decision":"continue"}';
          }
        }
      }
      capturedPayload = JSON.stringify(sanitized);
    } catch {
      capturedPayload = "{}";
    }
  }
  fs.appendFileSync(target, event + "\\t" + capturedPayload + "\\n");
  if (event === "pre-tool") {
    const decision = process.env.SYNARA_ANTIGRAVITY_HOOK_DECISION === "allow" ? "allow" : "ask";
    hookOutput = JSON.stringify({ decision });
  }
  process.stdout.write(hookOutput + "\\n");
});
`;
}

export function buildAntigravityHookConfig(
  command: (event: string) => string,
): Record<string, unknown> {
  const hook = (event: string) => ({ type: "command", command: command(event) });
  return {
    "synara-capture": {
      PreToolUse: [{ matcher: "*", hooks: [hook("pre-tool")] }],
      PostToolUse: [{ matcher: "*", hooks: [hook("post-tool")] }],
      PreInvocation: [hook("pre-invocation")],
      PostInvocation: [hook("post-invocation")],
      Stop: [hook("stop")],
    },
  };
}

function appendBoundedOutput(current: string, chunk: unknown): string {
  const next = current + String(chunk);
  return next.length > HELPER_OUTPUT_MAX_CHARS ? next.slice(-HELPER_OUTPUT_MAX_CHARS) : next;
}

export async function runAntigravityHelperProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: buildProviderChildEnvironment({ provider: PROVIDER }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = options.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new Error(
            `Antigravity helper timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
          ),
        ),
      );
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout = appendBoundedOutput(stdout, chunk)));
    child.stderr.on("data", (chunk) => (stderr = appendBoundedOutput(stderr, chunk)));
    child.once("error", (cause) => finish(() => reject(cause)));
    child.once("close", (code) => finish(() => resolve({ stdout, stderr, code: code ?? 1 })));
  });
}

export async function readCompleteAntigravityLines(
  filePath: string,
  offset: number,
): Promise<{ lines: string[]; nextOffset: number }> {
  const file = await fs.open(filePath, "r");
  try {
    const stats = await file.stat();
    const start = offset <= stats.size ? offset : 0;
    const remaining = stats.size - start;
    if (remaining === 0) return { lines: [], nextOffset: start };
    const buffer = Buffer.allocUnsafe(remaining);
    const { bytesRead } = await file.read(buffer, 0, remaining, start);
    const contents = buffer.subarray(0, bytesRead);
    const lastNewline = contents.lastIndexOf(0x0a);
    if (lastNewline < 0) return { lines: [], nextOffset: start };
    return {
      lines: contents
        .subarray(0, lastNewline + 1)
        .toString("utf8")
        .split(/\r?\n/g)
        .filter(Boolean),
      nextOffset: start + lastNewline + 1,
    };
  } finally {
    await file.close();
  }
}

type AntigravityHelperRunner = typeof runAntigravityHelperProcess;

export async function ensureCapturePlugin(
  binaryPath: string,
  stdioProxy?: AcpStdioProxySpawn,
  options: {
    readonly homeDir?: string;
    readonly runHelper?: AntigravityHelperRunner;
  } = {},
): Promise<void> {
  const pluginDir = path.join(
    options.homeDir ?? os.homedir(),
    ".gemini",
    "antigravity-cli",
    "plugins",
    "synara-capture",
  );
  const scriptPath = path.join(pluginDir, "capture.cjs");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "plugin.json"),
    `${JSON.stringify(
      {
        $schema: "https://antigravity.google/schemas/v1/plugin.json",
        name: "synara-capture",
        description: "Streams Antigravity CLI lifecycle events to Synara when requested.",
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(scriptPath, hookScriptSource(), { mode: 0o700 });
  const command = (event: string) =>
    buildAntigravityCaptureCommand(process.execPath, scriptPath, event);
  await fs.writeFile(
    path.join(pluginDir, "hooks.json"),
    `${JSON.stringify(buildAntigravityHookConfig(command), null, 2)}\n`,
  );
  const mcpConfigPath = path.join(pluginDir, "mcp_config.json");
  if (stdioProxy) {
    await fs.writeFile(
      mcpConfigPath,
      `${JSON.stringify(buildAntigravityMcpPluginConfig(stdioProxy), null, 2)}\n`,
    );
  } else {
    await fs.rm(mcpConfigPath, { force: true });
  }
  const installed = await (options.runHelper ?? runAntigravityHelperProcess)(
    binaryPath,
    ["plugin", "install", pluginDir],
    { timeoutMs: PLUGIN_INSTALL_TIMEOUT_MS },
  );
  if (installed.code !== 0) {
    throw new Error(installed.stderr.trim() || installed.stdout.trim() || "Plugin install failed.");
  }
}

export function buildAntigravityTurnProcessEnvironment(input: {
  readonly eventFile: string;
  readonly gatewayConnection?: Pick<AgentGatewayMcpConnection, "url">;
  readonly gatewayBootstrapToken?: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** Present only when the Stop-idle lifecycle is enabled for this turn. */
  readonly stopIdle?: { readonly maxContinuations: number };
}): NodeJS.ProcessEnv {
  const hasGatewayBootstrap =
    input.gatewayConnection !== undefined && input.gatewayBootstrapToken !== undefined;
  const gatewayKeys = hasGatewayBootstrap
    ? [SYNARA_AGENT_GATEWAY_URL_ENV, SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN_ENV]
    : [];
  const stopIdleKeys = input.stopIdle
    ? [SYNARA_ANTIGRAVITY_STOP_IDLE_ENV, SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS_ENV]
    : [];
  const gatewayEnvironment = hasGatewayBootstrap
    ? {
        [SYNARA_AGENT_GATEWAY_URL_ENV]: input.gatewayConnection!.url,
        [SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN_ENV]: input.gatewayBootstrapToken!,
      }
    : {};
  return buildProviderChildEnvironment({
    provider: PROVIDER,
    ...(input.baseEnv === undefined ? {} : { baseEnv: input.baseEnv }),
    inheritedSynaraKeys: [
      "SYNARA_ANTIGRAVITY_EVENTS",
      "SYNARA_ANTIGRAVITY_HOOK_DECISION",
      ...stopIdleKeys,
      ...gatewayKeys,
    ],
    overrides: {
      SYNARA_ANTIGRAVITY_EVENTS: input.eventFile,
      SYNARA_ANTIGRAVITY_HOOK_DECISION: "allow",
      ...(input.stopIdle
        ? {
            [SYNARA_ANTIGRAVITY_STOP_IDLE_ENV]: "1",
            [SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS_ENV]: String(
              input.stopIdle.maxContinuations,
            ),
          }
        : {}),
      ...gatewayEnvironment,
    },
  });
}

export function buildAntigravityTurnPrompt(
  state: SynaraHarnessPolicyDeliveryState,
  input: {
    readonly prompt: string;
    readonly hasGatewaySessionLease: boolean;
  },
): string {
  const harnessPolicy = takeSynaraHarnessPolicyForProviderSession(state, {
    provider: PROVIDER,
    scopedGatewayConnectionAvailable: input.hasGatewaySessionLease,
  });
  return [harnessPolicy, input.prompt].filter(Boolean).join("\n\n");
}

const DEFAULT_EFFORT_BY_MODEL: Readonly<Record<string, string>> = {
  "Gemini 3.6 Flash": "medium",
  "Gemini 3.5 Flash": "medium",
  "Gemini 3.1 Pro": "low",
  "Claude Sonnet 4.6": "thinking",
  "Claude Opus 4.6": "thinking",
  "GPT-OSS 120B": "medium",
};

const EFFORT_ORDER = ["low", "medium", "high", "thinking"] as const;

function effortLabel(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function parseAntigravityCliModelLabel(
  value: string,
): { model: string; effort?: string } | null {
  // oxlint-disable-next-line no-control-regex -- ANSI color stripping intentionally matches ESC.
  const stripped = value.replace(/\u001B\[[0-9;]*m/gu, "").trim();
  if (!stripped) return null;

  // Newer `agy models` rows are `slug<TAB>Display Name (Effort)`. Older builds
  // printed only the display label. Prefer the display column when present so
  // Synara never treats `slug\tName` as a single model id at dispatch.
  const tabIndex = stripped.indexOf("\t");
  const labelColumn =
    tabIndex >= 0 ? stripped.slice(tabIndex + 1).trim() : stripped.replace(/^(?:[*•-]\s+)+/u, "");
  const trimmed = labelColumn.replace(/^(?:[*•-]\s+)+/u, "").trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.*?)\s+\(([^()]+)\)$/u);
  if (!match?.[1] || !match[2]) return { model: trimmed };
  return {
    model: match[1].trim(),
    effort: match[2].trim().toLowerCase(),
  };
}

export function antigravityPromptCommandLineIssue(
  prompt: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== "win32" || prompt.length <= WINDOWS_PROMPT_MAX_CHARS) {
    return null;
  }
  return `Antigravity prompts on Windows are limited to ${WINDOWS_PROMPT_MAX_CHARS.toLocaleString("en-US")} characters because the CLI accepts print-mode prompts as command-line arguments. Shorten the prompt or attach the content as files.`;
}

export function parseAntigravityModelLines(output: string): ProviderListModelsResult["models"] {
  const groups = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/g)) {
    const parsed = parseAntigravityCliModelLabel(line);
    if (!parsed) continue;
    const efforts = groups.get(parsed.model) ?? [];
    if (parsed.effort && !efforts.includes(parsed.effort)) efforts.push(parsed.effort);
    groups.set(parsed.model, efforts);
  }
  return [...groups.entries()].map(([model, discoveredEfforts]) => {
    const efforts = discoveredEfforts.toSorted((left, right) => {
      const leftIndex = EFFORT_ORDER.indexOf(left as (typeof EFFORT_ORDER)[number]);
      const rightIndex = EFFORT_ORDER.indexOf(right as (typeof EFFORT_ORDER)[number]);
      return (
        (leftIndex < 0 ? EFFORT_ORDER.length : leftIndex) -
        (rightIndex < 0 ? EFFORT_ORDER.length : rightIndex)
      );
    });
    const defaultEffort = DEFAULT_EFFORT_BY_MODEL[model] ?? efforts[0];
    if (efforts.length === 0) {
      return { slug: model, name: model };
    }
    const supportedReasoningEfforts = efforts.map((effort) => ({
      value: effort,
      label: effortLabel(effort),
    }));
    return defaultEffort
      ? {
          slug: model,
          name: model,
          supportedReasoningEfforts,
          defaultReasoningEffort: defaultEffort,
        }
      : { slug: model, name: model, supportedReasoningEfforts };
  });
}

export function resolveAntigravityCliModelLabel(
  model: string,
  options?: AntigravityModelOptions,
  discoveredDefaultEffort?: string,
): string {
  const parsed = parseAntigravityCliModelLabel(model);
  if (!parsed) return model;
  const effort =
    parsed.effort ??
    options?.reasoningEffort?.trim().toLowerCase() ??
    discoveredDefaultEffort?.trim().toLowerCase() ??
    DEFAULT_EFFORT_BY_MODEL[parsed.model];
  // Always rebuild the CLI display label. Returning the raw input would preserve
  // corrupted `slug\tName (Effort)` rows from older discovery parsing.
  return effort ? `${parsed.model} (${effortLabel(effort)})` : parsed.model;
}

function parseModelLines(output: string): ProviderListModelsResult["models"] {
  return parseAntigravityModelLines(output);
}

function toolItemType(name: string): PendingTool["itemType"] {
  if (name === "run_command") return "command_execution";
  if (
    name === "write_to_file" ||
    name === "replace_file_content" ||
    name === "multi_replace_file_content"
  ) {
    return "file_change";
  }
  if (name === "search_web" || name.startsWith("browser_")) return "web_search";
  return "dynamic_tool_call";
}

export function makeAntigravityRuntimeEventBase(input: {
  readonly threadId: ThreadId;
  readonly lifecycleGeneration?: string;
  readonly eventId?: EventId;
  readonly createdAt?: string;
}) {
  return {
    eventId: input.eventId ?? EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: input.threadId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.lifecycleGeneration !== undefined
      ? { lifecycleGeneration: input.lifecycleGeneration }
      : {}),
  };
}

type AntigravityChildProcess = ChildProcess & {
  readonly stdout: NonNullable<ChildProcess["stdout"]>;
  readonly stderr: NonNullable<ChildProcess["stderr"]>;
};

export interface AntigravityAdapterDependencies {
  readonly ensurePlugin?: typeof ensureCapturePlugin;
  readonly teardownProcessTree?: typeof teardownChildProcessTree;
  readonly spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => AntigravityChildProcess;
  readonly createRunDir?: () => Promise<string>;
  readonly now?: () => number;
  readonly terminalRecoveryMode?: AntigravityTerminalRecoveryMode;
  readonly terminalRecoveryGraceMs?: number;
  readonly stopIdleLifecycle?: boolean;
  readonly stopIdleMaxContinuations?: number;
  readonly stopIdleBackgroundDeadlineMs?: number;
  readonly stopIdleCloseWaitMs?: number;
  readonly stopIdleStableEofQuietMs?: number;
  readonly stopIdleFinalDrainMs?: number;
  readonly onRecoveryDiagnostic?: (name: string, fields: Readonly<Record<string, unknown>>) => void;
}

const makeAntigravityAdapter = (dependencies: AntigravityAdapterDependencies = {}) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const teardownProcessTree = dependencies.teardownProcessTree ?? teardownChildProcessTree;
    const nowMs = dependencies.now ?? (() => performance.now());
    const terminalRecoveryMode =
      dependencies.terminalRecoveryMode ??
      serverConfig.antigravityTerminalRecoveryMode ??
      "enforce";
    const configuredRecoveryGraceMs =
      dependencies.terminalRecoveryGraceMs ??
      serverConfig.antigravityTerminalRecoveryGraceMs ??
      DEFAULT_TERMINAL_RECOVERY_GRACE_MS;
    const terminalRecoveryGraceMs =
      Number.isInteger(configuredRecoveryGraceMs) &&
      configuredRecoveryGraceMs > 0 &&
      configuredRecoveryGraceMs <= 2_147_483_647
        ? configuredRecoveryGraceMs
        : DEFAULT_TERMINAL_RECOVERY_GRACE_MS;
    const boundedStopIdleInt = (
      value: number | undefined,
      fallback: number,
      minimum: number,
      maximum: number,
    ): number =>
      value !== undefined && Number.isInteger(value) && value >= minimum && value <= maximum
        ? value
        : fallback;
    const stopIdleLifecycle =
      dependencies.stopIdleLifecycle ??
      serverConfig.antigravityStopIdleLifecycle ??
      DEFAULT_ANTIGRAVITY_STOP_IDLE_LIFECYCLE;
    const stopIdleMaxContinuations = boundedStopIdleInt(
      dependencies.stopIdleMaxContinuations ?? serverConfig.antigravityStopIdleMaxContinuations,
      DEFAULT_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
      MIN_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
      MAX_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
    );
    const stopIdleBackgroundDeadlineMs = boundedStopIdleInt(
      dependencies.stopIdleBackgroundDeadlineMs ??
        serverConfig.antigravityStopIdleBackgroundDeadlineMs,
      DEFAULT_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
      MIN_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
      MAX_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
    );
    const stopIdleCloseWaitMs = boundedStopIdleInt(
      dependencies.stopIdleCloseWaitMs ?? serverConfig.antigravityStopIdleCloseWaitMs,
      DEFAULT_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
      MIN_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
      MAX_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
    );
    const stopIdleStableEofQuietMs = boundedStopIdleInt(
      dependencies.stopIdleStableEofQuietMs ?? serverConfig.antigravityStopIdleStableEofQuietMs,
      DEFAULT_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
      MIN_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
      MAX_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
    );
    const stopIdleFinalDrainMs = boundedStopIdleInt(
      dependencies.stopIdleFinalDrainMs ?? serverConfig.antigravityStopIdleFinalDrainMs,
      DEFAULT_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
      MIN_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
      MAX_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
    );
    const agentGatewayCredentials = Option.getOrUndefined(
      yield* Effect.serviceOption(AgentGatewayCredentials),
    );
    const eventQueue = yield* Queue.bounded<ProviderRuntimeEvent>(
      PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
    );
    const sessions = new Map<ThreadId, AntigravitySessionContext>();
    const cleanedRunDirs = new Set<string>();
    const cleaningRunDirs = new Map<string, Promise<boolean>>();
    const releasedGatewayLeases = new WeakSet<object>();
    const rememberCleanedRunDir = (runDir: string): void => {
      cleanedRunDirs.add(runDir);
      if (cleanedRunDirs.size <= 1_024) return;
      const oldest = cleanedRunDirs.values().next().value;
      if (oldest !== undefined) cleanedRunDirs.delete(oldest);
    };
    const defaultEffortByModel = new Map(Object.entries(DEFAULT_EFFORT_BY_MODEL));

    const invokeTeardown = async (
      child: AntigravityChildProcess,
    ): Promise<Awaited<ReturnType<typeof teardownProcessTree>>> => {
      const emitter = child as unknown as {
        listeners?: (event: string) => Function[];
        removeListener?: (event: string, listener: Function) => unknown;
      };
      const before = new Set(emitter.listeners?.("exit") ?? []);
      try {
        return await teardownProcessTree(child);
      } catch (cause) {
        for (const listener of emitter.listeners?.("exit") ?? []) {
          if (!before.has(listener)) emitter.removeListener?.("exit", listener);
        }
        throw cause;
      }
    };

    const diagnose = (name: string, fields: Readonly<Record<string, unknown>>): void => {
      dependencies.onRecoveryDiagnostic?.(name, fields);
      Effect.runFork(Effect.logInfo(name, fields));
    };

    const eventIngress = yield* makeBoundedCallbackIngress<ProviderRuntimeEvent, never, never>(
      (event) => Queue.offer(eventQueue, event).pipe(Effect.asVoid),
      {
        capacity: PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
        maxBufferedBytes: PROVIDER_RUNTIME_CALLBACK_BUFFER_MAX_BYTES,
        terminalReserve: PROVIDER_RUNTIME_CALLBACK_TERMINAL_RESERVE,
        isTerminal: isTerminalProviderRuntimeEvent,
        sizeOf: providerRuntimeEventBytes,
      },
    );

    const offer = (event: ProviderRuntimeEvent) => {
      eventIngress.offer(compactProviderRuntimeEventForIngress(event));
    };

    const base = (
      context: AntigravitySessionContext,
      options?: { includeTurn?: boolean; itemId?: RuntimeItemId },
    ) => ({
      ...makeAntigravityRuntimeEventBase({
        threadId: context.session.threadId,
        ...(context.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: context.lifecycleGeneration }
          : {}),
      }),
      ...(options?.includeTurn !== false && context.activeTurnId
        ? { turnId: context.activeTurnId }
        : {}),
      ...(options?.itemId ? { itemId: options.itemId } : {}),
      ...(context.conversationId
        ? { providerRefs: { providerThreadId: context.conversationId } }
        : {}),
    });

    const raw = makeRawAntigravityEvent;

    const recoveryFields = (
      context: AntigravitySessionContext,
      extra: Readonly<Record<string, unknown>> = {},
    ) => ({
      provider: PROVIDER,
      cliVersion: "1.1.13-or-compatible",
      threadId: context.session.threadId,
      ...(context.activeTurnId !== undefined ? { turnId: context.activeTurnId } : {}),
      ...(context.lifecycleGeneration !== undefined
        ? { lifecycleGeneration: context.lifecycleGeneration }
        : {}),
      pendingToolCount: context.pendingTools.length,
      ...extra,
    });

    let maybeRecoverTerminalAnswer = noopMaybeRecoverTerminalAnswer;

    const clearTurnScheduling = (context: AntigravitySessionContext): void => {
      clearRecoveryTimer(context.recovery);
      const stopIdle = context.stopIdle;
      if (stopIdle?.timer !== undefined) clearTimeout(stopIdle.timer);
      delete context.stopIdle;
      if (context.pollTimer !== undefined) {
        clearInterval(context.pollTimer);
        delete context.pollTimer;
      }
    };

    const ownsRecovery = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
    ): boolean =>
      sessions.get(ownership.threadId) === context &&
      !context.stopped &&
      context.session.threadId === ownership.threadId &&
      context.lifecycleGeneration === ownership.lifecycleGeneration &&
      context.activeTurnId === ownership.turnId &&
      context.activeProcess === ownership.child;

    const setIneligible = (
      context: AntigravitySessionContext,
      reason: string,
      diagnoseCancellation = true,
    ): void => {
      const previous = context.recovery;
      clearRecoveryTimer(previous);
      if (
        diagnoseCancellation &&
        previous.phase !== "ineligible" &&
        terminalRecoveryMode !== "off"
      ) {
        diagnose(
          "antigravity.completion_candidate_cancelled",
          recoveryFields(context, {
            candidateStepIndex: previous.candidate.stepIndex,
            cancellationReason: reason,
          }),
        );
      }
      context.recovery = {
        phase: "ineligible",
        activityRevision: previous.activityRevision,
        lastActivityAtMs: nowMs(),
      };
    };

    const scheduleCandidate = (context: AntigravitySessionContext, stepIndex: number): void => {
      if (terminalRecoveryMode === "off") return;
      if (context.stopIdle !== undefined) {
        setIneligible(context, "stop-idle-active", false);
        return;
      }
      const ownership = captureOwnership(context);
      if (!ownership || context.pendingTools.length > 0 || context.turnTerminalEmitted) {
        setIneligible(context, "candidate-preconditions-lost", false);
        return;
      }
      clearRecoveryTimer(context.recovery);
      const revision = context.recovery.activityRevision;
      const candidate = { stepIndex, activityRevision: revision } satisfies CompletionCandidate;
      const timer = setTimeout(() => {
        if (!ownsRecovery(context, ownership)) return;
        const settlement = maybeRecoverTerminalAnswer(context);
        context.terminalSettlement = settlement;
        void settlement.finally(() => {
          if (context.terminalSettlement === settlement) delete context.terminalSettlement;
        });
      }, terminalRecoveryGraceMs);
      context.recovery = {
        phase: "grace",
        activityRevision: revision,
        lastActivityAtMs: context.recovery.lastActivityAtMs,
        candidate,
        timer,
      };
      diagnose(
        "antigravity.completion_candidate_started",
        recoveryFields(context, {
          candidateStepIndex: stepIndex,
        }),
      );
    };

    const noteActivity = (
      context: AntigravitySessionContext,
      input: { readonly invalidate: boolean; readonly reason: string },
    ): void => {
      if (terminalRecoveryMode === "off") return;
      const previous = context.recovery;
      clearRecoveryTimer(previous);
      const nextRevision = previous.activityRevision + 1;
      const lastActivityAtMs = nowMs();
      if (previous.phase === "teardown") {
        context.recovery = {
          ...previous,
          activityRevision: nextRevision,
          lastActivityAtMs,
        };
        return;
      }
      if (input.invalidate || previous.phase === "ineligible") {
        if (input.invalidate && previous.phase !== "ineligible") {
          diagnose(
            "antigravity.completion_candidate_cancelled",
            recoveryFields(context, {
              candidateStepIndex: previous.candidate.stepIndex,
              cancellationReason: input.reason,
            }),
          );
        }
        context.recovery = {
          phase: "ineligible",
          activityRevision: nextRevision,
          lastActivityAtMs,
        };
        return;
      }
      context.recovery = {
        phase: "ineligible",
        activityRevision: nextRevision,
        lastActivityAtMs,
      };
      diagnose(
        "antigravity.completion_candidate_cancelled",
        recoveryFields(context, {
          candidateStepIndex: previous.candidate.stepIndex,
          cancellationReason: "activity-reset",
        }),
      );
      scheduleCandidate(context, previous.candidate.stepIndex);
    };

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<AntigravitySessionContext, ProviderAdapterSessionNotFoundError> => {
      const context = sessions.get(threadId);
      return context
        ? Effect.succeed(context)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    };

    const releaseTurnGatewayLease = (
      context: AntigravitySessionContext,
      lease: AgentGatewaySessionLease | undefined = context.gatewaySessionLease,
    ): void => {
      if (lease && !releasedGatewayLeases.has(lease)) {
        releasedGatewayLeases.add(lease);
        lease.release();
      }
      if (context.gatewaySessionLease === lease) delete context.gatewaySessionLease;
    };

    const cleanupOwnedTurnResources = async (
      context: AntigravitySessionContext,
      lease: AgentGatewaySessionLease | undefined,
      runDir: string,
    ): Promise<boolean> => {
      if (cleanedRunDirs.has(runDir)) {
        releaseTurnGatewayLease(context, lease);
        return true;
      }
      const previous = cleaningRunDirs.get(runDir);
      if (previous) return previous;
      const cleanup = (async () => {
        try {
          await fs.rm(runDir, { recursive: true, force: true });
          rememberCleanedRunDir(runDir);
          releaseTurnGatewayLease(context, lease);
          return true;
        } catch (cause) {
          if ((cause as { code?: unknown })?.code === "ENOENT") {
            rememberCleanedRunDir(runDir);
            releaseTurnGatewayLease(context, lease);
            return true;
          }
          diagnose("antigravity.stale_recovery_ignored", {
            provider: PROVIDER,
            threadId: context.session.threadId,
            ...(context.activeTurnId !== undefined ? { turnId: context.activeTurnId } : {}),
            cancellationReason: "run-dir-cleanup-failed",
          });
          return false;
        } finally {
          cleaningRunDirs.delete(runDir);
        }
      })();
      cleaningRunDirs.set(runDir, cleanup);
      return cleanup;
    };

    const schedulePreparationCleanup = (
      context: AntigravitySessionContext,
      fence: PreparationCleanupFence,
    ): void => {
      if (
        fence.stopRequested ||
        context.stopRequested ||
        context.stopped ||
        fence.retryTimer !== undefined ||
        fence.cleanupPromise !== undefined
      ) {
        return;
      }
      fence.retryTimer = setTimeout(() => {
        delete fence.retryTimer;
        const cleanup = cleanupOwnedTurnResources(context, fence.gatewaySessionLease, fence.runDir);
        fence.cleanupPromise = cleanup;
        void cleanup.then((cleaned) => {
          if (fence.cleanupPromise === cleanup) delete fence.cleanupPromise;
          if (!cleaned) {
            schedulePreparationCleanup(context, fence);
            return;
          }
          if (context.preparationCleanupFence !== fence) return;
          delete context.preparationCleanupFence;
          diagnose("antigravity.quarantined_process_reaped", {
            provider: PROVIDER,
            threadId: context.session.threadId,
            settlementSource: "turn-preparation-cleanup",
          });
          if (sessions.get(context.session.threadId) !== context) return;
          if (context.stopped) {
            sessions.delete(context.session.threadId);
            offer({
              ...base(context, { includeTurn: false }),
              type: "session.exited",
              payload: { reason: "stopped", exitKind: "graceful" },
            } satisfies ProviderRuntimeEvent);
            return;
          }
          const { lastError: _lastError, ...sessionWithoutError } = context.session;
          context.session = {
            ...sessionWithoutError,
            status: "ready",
            updatedAt: new Date().toISOString(),
          };
          offer({
            ...base(context, { includeTurn: false }),
            type: "session.state.changed",
            payload: {
              state: "ready",
              reason: "Antigravity turn preparation cleanup completed.",
            },
            raw: raw("turn-preparation-cleanup-completed", {
              threadId: context.session.threadId,
              settlementSource: "turn-preparation-cleanup",
            }),
          } satisfies ProviderRuntimeEvent);
        });
      }, QUARANTINE_REAP_INTERVAL_MS);
    };

    const cleanupPreparedTurnResources = async (
      context: AntigravitySessionContext,
      admissionGeneration: number,
      runDir: string,
      lease?: AgentGatewaySessionLease,
    ): Promise<boolean> => {
      const cleaned = await cleanupOwnedTurnResources(context, lease, runDir);
      if (cleaned) return true;
      const existing = context.preparationCleanupFence;
      const fence =
        existing?.runDir === runDir
          ? existing
          : ({
              runDir,
              ...(lease !== undefined ? { gatewaySessionLease: lease } : {}),
              admissionGeneration,
              stopRequested: context.stopRequested || context.stopped,
            } satisfies PreparationCleanupFence);
      context.preparationCleanupFence = fence;
      const metadata = {
        provider: PROVIDER,
        threadId: context.session.threadId,
        settlementSource: "turn-preparation-cleanup",
        cancellationReason: "run-dir-cleanup-failed",
      };
      diagnose("antigravity.quarantine_entered", metadata);
      if (sessions.get(context.session.threadId) === context) {
        context.session = {
          ...context.session,
          status: "error",
          lastError: fence.stopRequested
            ? "Antigravity turn preparation cleanup remains unconfirmed after the final shutdown attempt."
            : "Antigravity turn preparation cleanup failed; new turns are blocked until cleanup succeeds.",
          updatedAt: new Date().toISOString(),
        };
        if (fence.stopRequested) {
          diagnose("antigravity.preparation_cleanup_unconfirmed", metadata);
        }
        offer({
          ...base(context, { includeTurn: false }),
          type: "session.state.changed",
          payload: { state: "error", reason: context.session.lastError },
          raw: raw("turn-preparation-cleanup-failed", metadata),
        } satisfies ProviderRuntimeEvent);
      }
      if (!fence.stopRequested) schedulePreparationCleanup(context, fence);
      return false;
    };

    const teardownActiveProcess = (
      context: AntigravitySessionContext,
      method: string,
    ): Effect.Effect<void, ProviderAdapterRequestError> => {
      const child = context.activeProcess;
      if (!child) return Effect.void;
      return Effect.tryPromise({
        try: () => invokeTeardown(child),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method,
            detail: messageFromCause(cause, "Failed to stop the Antigravity process tree."),
            cause,
          }),
      }).pipe(Effect.asVoid);
    };

    /**
     * Emit a single terminal turn.completed for the active turn and mark the
     * session idle. Idempotent so process-close, interrupt, and stop-hook
     * paths can all call it without double-settling (#465).
     */
    const settleActiveTurn = (
      context: AntigravitySessionContext,
      input: {
        readonly state: "completed" | "interrupted" | "failed";
        readonly stopReason: "model_stop" | "interrupted" | "error";
        readonly errorMessage?: string;
        readonly raw?: ReturnType<typeof raw>;
        readonly claimant?: TerminalClaimant;
      },
    ): boolean => {
      if (input.claimant !== undefined && !claimTerminal(context, input.claimant)) {
        diagnose(
          "antigravity.duplicate_terminal_suppressed",
          recoveryFields(context, { settlementSource: input.claimant }),
        );
        return false;
      }
      if (context.turnTerminalEmitted || context.activeTurnId === undefined) {
        diagnose(
          "antigravity.duplicate_terminal_suppressed",
          recoveryFields(context, { settlementSource: input.stopReason }),
        );
        return false;
      }
      const completionBase = base(context);
      setIneligible(context, "turn-settled", false);
      if (context.pollTimer !== undefined) {
        clearInterval(context.pollTimer);
        delete context.pollTimer;
      }
      context.turnTerminalEmitted = true;
      delete context.terminalTeardown;
      const settledStopIdle = context.stopIdle;
      if (settledStopIdle?.timer !== undefined) clearTimeout(settledStopIdle.timer);
      delete context.stopIdle;
      delete context.activeProcess;
      delete context.activeRunDir;
      delete context.activeTurnId;
      const {
        activeTurnId: _activeTurnId,
        lastError: _lastError,
        ...inactiveSession
      } = context.session;
      const failed = input.state === "failed";
      context.session = {
        ...inactiveSession,
        status: failed ? "error" : "ready",
        ...(context.conversationId ? { resumeCursor: context.conversationId } : {}),
        updatedAt: new Date().toISOString(),
        ...(failed && input.errorMessage ? { lastError: input.errorMessage } : {}),
      };
      offer({
        ...completionBase,
        type: "turn.completed",
        payload:
          input.state === "interrupted"
            ? { state: "interrupted", stopReason: "interrupted" }
            : input.state === "failed"
              ? {
                  state: "failed",
                  stopReason: "error",
                  errorMessage: input.errorMessage ?? "Antigravity turn failed.",
                }
              : { state: "completed", stopReason: "model_stop" },
        ...(input.raw ? { raw: input.raw } : {}),
      } satisfies ProviderRuntimeEvent);
      return true;
    };

    const emitTextItem = (
      context: AntigravitySessionContext,
      step: TranscriptStep,
      itemType: "assistant_message" | "reasoning",
      streamKind: "assistant_text" | "reasoning_text",
    ) => {
      const content = trim(step.content);
      if (!content) return;
      const itemId = RuntimeItemId.makeUnsafe(
        `antigravity-${context.activeTurnId ?? "turn"}-${step.step_index ?? crypto.randomUUID()}-${itemType}`,
      );
      offer({
        ...base(context, { itemId }),
        type: "item.started",
        payload: {
          itemType,
          status: "inProgress",
          title: itemType === "reasoning" ? "Reasoning" : "Assistant",
        },
        raw: raw(step.type ?? "transcript", step),
      } satisfies ProviderRuntimeEvent);
      offer({
        ...base(context, { itemId }),
        type: "content.delta",
        payload: { streamKind, delta: content },
        raw: raw(step.type ?? "transcript", step),
      } satisfies ProviderRuntimeEvent);
      offer({
        ...base(context, { itemId }),
        type: "item.completed",
        payload: {
          itemType,
          status: "completed",
          title: itemType === "reasoning" ? "Reasoning" : "Assistant",
          ...(itemType === "reasoning" ? { detail: content } : {}),
          data: step,
        },
        raw: raw(step.type ?? "transcript", step),
      } satisfies ProviderRuntimeEvent);
      if (itemType === "assistant_message") context.sawAssistant = true;
      context.turnOutputProduced = true;
      noteActivity(context, { invalidate: false, reason: `${itemType}-emitted` });
    };

    const processTranscriptStep = (context: AntigravitySessionContext, step: TranscriptStep) => {
      if (!parseTranscriptStep(step)) return;
      const stepIndex = step.step_index;
      if (typeof stepIndex !== "number" || context.processedSteps.has(stepIndex)) return;
      context.processedSteps.add(stepIndex);
      currentTurn(context)?.items.push(step);

      if (step.type === "PLANNER_RESPONSE") {
        const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
        if (calls.length > 0) {
          noteActivity(context, { invalidate: true, reason: "tool-bearing-planner-response" });
          emitTextItem(context, step, "reasoning", "reasoning_text");
        } else {
          emitTextItem(context, step, "assistant_message", "assistant_text");
          if (trim(step.content) && context.pendingTools.length === 0) {
            scheduleCandidate(context, stepIndex);
          } else {
            setIneligible(context, "empty-response-or-pending-tools");
          }
        }
        return;
      }
      noteActivity(context, { invalidate: true, reason: "later-transcript-step" });
    };

    const readTranscript = async (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
    ) => {
      if (!context.transcriptPath) return;
      const isInitialRead = context.processedTranscriptPath !== context.transcriptPath;
      if (isInitialRead) context.processedTranscriptBytes = 0;
      let batch: Awaited<ReturnType<typeof readCompleteAntigravityLines>>;
      try {
        batch = await readCompleteAntigravityLines(
          context.transcriptPath,
          context.processedTranscriptBytes,
        );
      } catch {
        return;
      }
      if (context.stopped || !ownsRecovery(context, ownership)) {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: "transcript-read" }),
        );
        return;
      }
      context.processedTranscriptBytes = batch.nextOffset;
      context.processedTranscriptPath = context.transcriptPath;
      for (const _line of batch.lines) {
        noteActivity(context, { invalidate: false, reason: "transcript-record" });
      }
      const steps = batch.lines.flatMap((line) => {
        try {
          const parsed = parseTranscriptStep(JSON.parse(line));
          return parsed ? [parsed] : [];
        } catch {
          return [];
        }
      });
      const latestUserIndex = steps.reduce(
        (latest, step) =>
          step.type === "USER_INPUT" && typeof step.step_index === "number"
            ? Math.max(latest, step.step_index)
            : latest,
        context.latestUserStepIndex ?? -1,
      );
      const priorUserIndex = context.latestUserStepIndex ?? -1;
      if (latestUserIndex > priorUserIndex) {
        context.latestUserStepIndex = latestUserIndex;
        setIneligible(context, "user-input-boundary");
      }
      for (const step of steps) {
        if (
          context.latestUserStepIndex !== undefined &&
          typeof step.step_index === "number" &&
          step.step_index > context.latestUserStepIndex
        ) {
          processTranscriptStep(context, step);
        }
      }
    };

    const markExistingTranscriptStepsProcessed = async (context: AntigravitySessionContext) => {
      if (!context.transcriptPath) return;
      try {
        const batch = await readCompleteAntigravityLines(context.transcriptPath, 0);
        context.processedTranscriptBytes = batch.nextOffset;
        context.processedTranscriptPath = context.transcriptPath;
      } catch {
        return;
      }
    };

    const pollHookFile = async (context: AntigravitySessionContext) => {
      if (context.stopped) return;
      if (!context.eventFile) return;
      const ownership = captureOwnership(context);
      if (!ownership) return;
      let batch: Awaited<ReturnType<typeof readCompleteAntigravityLines>>;
      try {
        batch = await readCompleteAntigravityLines(context.eventFile, context.processedHookBytes);
      } catch {
        return;
      }
      if (context.stopped || !ownsRecovery(context, ownership)) {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: "hook-read" }),
        );
        return;
      }
      context.processedHookBytes = batch.nextOffset;
      for (const line of batch.lines) {
        noteActivity(context, { invalidate: false, reason: "hook-record" });
        const tab = line.indexOf("\t");
        if (tab < 0) continue;
        const eventName = line.slice(0, tab);
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(line.slice(tab + 1)) as Record<string, unknown>;
        } catch {
          continue;
        }
        const conversationId =
          typeof payload.conversationId === "string" ? payload.conversationId : undefined;
        const transcriptPath =
          typeof payload.transcriptPath === "string" ? payload.transcriptPath : undefined;
        const modelName = typeof payload.modelName === "string" ? payload.modelName : undefined;
        const learnedConversation = conversationId && conversationId !== context.conversationId;
        if (conversationId) context.conversationId = conversationId;
        if (transcriptPath && transcriptPath !== context.transcriptPath) {
          context.transcriptPath = transcriptPath;
          context.processedTranscriptBytes = 0;
          delete context.processedTranscriptPath;
        }
        if (modelName) context.modelName = modelName;
        if (learnedConversation) {
          context.session = {
            ...context.session,
            resumeCursor: conversationId,
            updatedAt: new Date().toISOString(),
          };
          offer({
            ...base(context, { includeTurn: false }),
            type: "thread.started",
            payload: { providerThreadId: conversationId },
            raw: raw(eventName, payload),
          } satisfies ProviderRuntimeEvent);
        }
        const stepIndex =
          typeof payload.stepIdx === "number" &&
          Number.isInteger(payload.stepIdx) &&
          payload.stepIdx >= 0
            ? payload.stepIdx
            : undefined;
        if (eventName === "pre-tool" && stepIndex !== undefined) {
          noteActivity(context, { invalidate: true, reason: "tool-started" });
          const toolCall =
            payload.toolCall && typeof payload.toolCall === "object"
              ? (payload.toolCall as Record<string, unknown>)
              : undefined;
          const name = typeof toolCall?.name === "string" ? trim(toolCall.name) : undefined;
          if (name) {
            const itemId = RuntimeItemId.makeUnsafe(
              `antigravity-${context.activeTurnId ?? "turn"}-tool-${context.nextToolSequence++}`,
            );
            const pending = {
              stepIndex,
              itemId,
              itemType: toolItemType(name),
              name,
            } satisfies PendingTool;
            context.pendingTools.push(pending);
            noteActivity(context, { invalidate: true, reason: "pending-tool-added" });
            context.turnOutputProduced = true;
            offer({
              ...base(context, { itemId }),
              type: "item.started",
              payload: {
                itemType: pending.itemType,
                status: "inProgress",
                title: pending.name,
                data: { toolCallId: pending.itemId, toolName: pending.name },
              },
              raw: raw("tool-lifecycle", { eventName, stepIdx: stepIndex, name }),
            } satisfies ProviderRuntimeEvent);
          }
        } else if (eventName === "post-tool" && stepIndex !== undefined) {
          noteActivity(context, { invalidate: true, reason: "tool-finished" });
          const pendingIndex = context.pendingTools.findIndex(
            (pending) => pending.stepIndex === stepIndex,
          );
          const pending =
            pendingIndex >= 0 ? context.pendingTools.splice(pendingIndex, 1)[0] : undefined;
          if (pending) {
            noteActivity(context, { invalidate: true, reason: "pending-tool-removed" });
            const failed =
              payload.failed === true ||
              (typeof payload.error === "string" && payload.error.trim().length > 0);
            offer({
              ...base(context, { itemId: pending.itemId }),
              type: "item.completed",
              payload: {
                itemType: pending.itemType,
                status: failed ? "failed" : "completed",
                title: pending.name,
                data: { toolCallId: pending.itemId, toolName: pending.name },
              },
              raw: raw("tool-lifecycle", {
                eventName,
                stepIdx: stepIndex,
                name: pending.name,
                failed,
              }),
            } satisfies ProviderRuntimeEvent);
          }
        }
        // Agent finished: if the print process lingers, tear it down so the
        // close handler (or interrupt fallback) can settle the turn (#465).
        // With the stop-idle lifecycle enabled, a boolean fullyIdle hands the
        // terminal to the stop-idle path instead: background work keeps the
        // single `agy -p` process alive until the hook reports idle or a
        // bounded timer forces the proven teardown path.
        if (
          eventName === "stop" &&
          stopIdleLifecycle &&
          context.activeProcess &&
          !context.turnTerminalEmitted
        ) {
          const stopObservation = parseStopIdleObservation(payload);
          if (stopObservation !== undefined) {
            noteActivity(context, { invalidate: true, reason: "stop-hook" });
            if (context.recovery.phase === "teardown" || context.terminalClaimant !== undefined)
              continue;
            const stopOwnership = captureOwnership(context);
            if (!stopOwnership) continue;
            observeStopIdle(context, stopOwnership, stopObservation);
            continue;
          }
        }
        if (eventName === "stop" && context.activeProcess && !context.turnTerminalEmitted) {
          noteActivity(context, { invalidate: true, reason: "stop-hook" });
          if (context.recovery.phase === "teardown" || context.terminalClaimant !== undefined)
            continue;
          const ownership = captureOwnership(context);
          if (!ownership || !claimTerminal(context, "stop-hook")) continue;
          const settlement = settleStopHook(context, ownership);
          context.terminalSettlement = settlement;
          void settlement.finally(() => {
            if (context.terminalSettlement === settlement) delete context.terminalSettlement;
          });
        }
      }
      if (context.stopped || !ownsRecovery(context, ownership)) return;
      await readTranscript(context, ownership);
    };

    const pollActiveTurn = (context: AntigravitySessionContext): Promise<void> => {
      if (context.pollInFlight) return context.pollInFlight;
      const polling = pollHookFile(context).finally(() => {
        if (context.pollInFlight === polling) delete context.pollInFlight;
      });
      context.pollInFlight = polling;
      return polling;
    };

    const emitRecoveryWarning = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      metadata: Readonly<Record<string, unknown>>,
      quarantined = false,
    ): void => {
      offer({
        ...base(context, { includeTurn: false }),
        turnId: ownership.turnId,
        type: "runtime.warning",
        payload: {
          message: quarantined
            ? "Antigravity delivered a final answer without a terminal event. Synara recovered the turn, but process cleanup is unconfirmed; new turns are blocked until cleanup succeeds."
            : "Antigravity delivered a final answer without a terminal event; Synara recovered the turn and cleaned up the owned process.",
        },
        raw: raw("missing-terminal-recovery", metadata),
      } satisfies ProviderRuntimeEvent);
    };

    const emitStopCleanupWarning = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      metadata: Readonly<Record<string, unknown>>,
    ): void => {
      offer({
        ...base(context, { includeTurn: false }),
        turnId: ownership.turnId,
        type: "runtime.warning",
        payload: {
          message:
            "Antigravity emitted Stop, but process cleanup is unconfirmed; new turns are blocked until cleanup succeeds.",
        },
        raw: raw("stop-cleanup-unconfirmed", metadata),
      } satisfies ProviderRuntimeEvent);
    };

    const scheduleQuarantineReap = (
      context: AntigravitySessionContext,
      record: QuarantineRecord,
    ): void => {
      if (
        context.quarantine !== record ||
        record.stopRequested ||
        record.retryTimer !== undefined ||
        record.reapPromise !== undefined
      ) {
        return;
      }
      record.retryTimer = setTimeout(() => {
        delete record.retryTimer;
        void reapQuarantine(context, record);
      }, QUARANTINE_REAP_INTERVAL_MS);
    };

    const quarantineStoppedProcess = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      cause: unknown,
    ): void => {
      const record: QuarantineRecord = {
        ownership,
        runDir: ownership.runDir,
        ...(ownership.gatewaySessionLease !== undefined
          ? { gatewaySessionLease: ownership.gatewaySessionLease }
          : {}),
        stopRequested: true,
        reapInFlight: false,
        cleanupUnconfirmedDiagnostic: "antigravity.session_cleanup_unconfirmed",
        cleanupUnconfirmedReported: true,
      };
      context.quarantine = record;
      const metadata = recoveryFields(context, {
        teardownStage: "session-stop",
        settlementSource: "session-stop",
        captureComplete:
          cause instanceof ProviderProcessExitUnprovenError ? cause.captureComplete : false,
        remainingDescendantCount:
          cause instanceof ProviderProcessExitUnprovenError
            ? (cause.remainingDescendantPids?.length ?? null)
            : null,
      });
      diagnose("antigravity.session_cleanup_unconfirmed", metadata);
      diagnose("antigravity.quarantine_entered", metadata);
      context.session = {
        ...context.session,
        status: "error",
        lastError:
          "Antigravity session cleanup is unconfirmed; shutdown will complete after the owned process is reaped.",
        updatedAt: new Date().toISOString(),
      };
      offer({
        ...base(context, { includeTurn: false }),
        type: "session.state.changed",
        payload: {
          state: "error",
          reason:
            "Antigravity session cleanup is unconfirmed; shutdown will complete after the owned process is reaped.",
        },
        raw: raw("session-stop-quarantine", metadata),
      } satisfies ProviderRuntimeEvent);
      scheduleQuarantineReap(context, record);
    };

    const performReapQuarantine = async (
      context: AntigravitySessionContext,
      record: QuarantineRecord,
      assumeExited = false,
    ): Promise<boolean> => {
      if (
        record.reapInFlight ||
        context.quarantine !== record ||
        sessions.get(record.ownership.threadId) !== context ||
        context.lifecycleGeneration !== record.ownership.lifecycleGeneration
      ) {
        return false;
      }
      record.reapInFlight = true;
      try {
        if (!assumeExited && !record.exitObserved) {
          await invokeTeardown(record.ownership.child);
        }
        if (
          context.quarantine !== record ||
          sessions.get(record.ownership.threadId) !== context ||
          context.lifecycleGeneration !== record.ownership.lifecycleGeneration
        ) {
          diagnose(
            "antigravity.stale_recovery_ignored",
            recoveryFields(context, { settlementSource: "quarantine-reap" }),
          );
          return false;
        }
        if (record.retryTimer !== undefined) clearTimeout(record.retryTimer);
        const resourcesCleaned = await cleanupOwnedTurnResources(
          context,
          record.gatewaySessionLease,
          record.runDir,
        );
        if (!resourcesCleaned) {
          if (!record.stopRequested) scheduleQuarantineReap(context, record);
          return false;
        }
        if (context.quarantine !== record) return false;
        delete context.quarantine;
        diagnose(
          "antigravity.quarantined_process_reaped",
          recoveryFields(context, { settlementSource: "quarantine-reap" }),
        );
        if (record.stopRequested) {
          sessions.delete(record.ownership.threadId);
          offer({
            ...base(context, { includeTurn: false }),
            type: "session.exited",
            payload: { reason: "stopped", exitKind: "graceful" },
          } satisfies ProviderRuntimeEvent);
        } else {
          const { lastError: _lastError, ...sessionWithoutError } = context.session;
          context.session = {
            ...sessionWithoutError,
            status: "ready",
            updatedAt: new Date().toISOString(),
          };
          offer({
            ...base(context, { includeTurn: false }),
            type: "session.state.changed",
            payload: {
              state: "ready",
              reason: "Antigravity quarantined process cleanup completed.",
            },
            raw: raw("quarantined-process-reaped", {
              threadId: record.ownership.threadId,
              turnId: record.ownership.turnId,
              lifecycleGeneration: record.ownership.lifecycleGeneration,
              settlementSource: "quarantine-reap",
            }),
          } satisfies ProviderRuntimeEvent);
        }
        return true;
      } catch (cause) {
        if (context.quarantine === record) {
          diagnose(
            record.cleanupUnconfirmedDiagnostic ?? "antigravity.cleanup_unconfirmed",
            recoveryFields(context, {
              teardownStage: "quarantine-reap",
              remainingDescendantCount:
                cause instanceof ProviderProcessExitUnprovenError
                  ? (cause.remainingDescendantPids?.length ?? null)
                  : null,
              captureComplete:
                cause instanceof ProviderProcessExitUnprovenError ? cause.captureComplete : false,
            }),
          );
          if (!record.stopRequested) scheduleQuarantineReap(context, record);
        }
        return false;
      } finally {
        record.reapInFlight = false;
      }
    };

    const reapQuarantine = async (
      context: AntigravitySessionContext,
      record: QuarantineRecord,
      assumeExited = false,
    ): Promise<boolean> => {
      if (record.reapPromise) return record.reapPromise;
      const operation = performReapQuarantine(context, record, assumeExited);
      record.reapPromise = operation;
      try {
        return await operation;
      } finally {
        if (record.reapPromise === operation) delete record.reapPromise;
      }
    };

    const quarantineExitedTurnCleanup = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      settlementSource: string,
      stopRequested = false,
    ): void => {
      if (context.quarantine?.ownership === ownership) return;
      const record: QuarantineRecord = {
        ownership,
        runDir: ownership.runDir,
        ...(ownership.gatewaySessionLease !== undefined
          ? { gatewaySessionLease: ownership.gatewaySessionLease }
          : {}),
        stopRequested,
        reapInFlight: false,
        exitObserved: true,
      };
      context.quarantine = record;
      const metadata = {
        provider: PROVIDER,
        threadId: ownership.threadId,
        turnId: ownership.turnId,
        ...(ownership.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: ownership.lifecycleGeneration }
          : {}),
        settlementSource,
        cancellationReason: "run-dir-cleanup-failed",
      };
      diagnose("antigravity.quarantine_entered", metadata);
      context.session = {
        ...context.session,
        status: "error",
        lastError:
          "Antigravity owned-resource cleanup failed; new turns are blocked until cleanup succeeds.",
        updatedAt: new Date().toISOString(),
      };
      offer({
        ...base(context, { includeTurn: false }),
        type: "session.state.changed",
        payload: { state: "error", reason: context.session.lastError },
        raw: raw("owned-resource-cleanup-failed", metadata),
      } satisfies ProviderRuntimeEvent);
      scheduleQuarantineReap(context, record);
      if (stopRequested) void reapQuarantine(context, record, true);
    };

    const installExitedCleanupFence = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      cleanupUnconfirmedDiagnostic: string,
    ): QuarantineRecord | undefined => {
      if (!ownsRecovery(context, ownership) || context.quarantine !== undefined) return;
      const record: QuarantineRecord = {
        ownership,
        runDir: ownership.runDir,
        ...(ownership.gatewaySessionLease !== undefined
          ? { gatewaySessionLease: ownership.gatewaySessionLease }
          : {}),
        stopRequested: context.stopRequested,
        reapInFlight: false,
        exitObserved: true,
        cleanupUnconfirmedDiagnostic,
        cleanupUnconfirmedReported: false,
      };
      context.quarantine = record;
      return record;
    };

    const reportExitedCleanupFailure = (
      context: AntigravitySessionContext,
      record: QuarantineRecord,
      settlementSource: string,
    ): void => {
      if (
        context.quarantine !== record ||
        sessions.get(record.ownership.threadId) !== context ||
        context.lifecycleGeneration !== record.ownership.lifecycleGeneration ||
        record.cleanupUnconfirmedReported
      ) {
        return;
      }
      record.cleanupUnconfirmedReported = true;
      const metadata = {
        provider: PROVIDER,
        threadId: record.ownership.threadId,
        turnId: record.ownership.turnId,
        ...(record.ownership.lifecycleGeneration !== undefined
          ? { lifecycleGeneration: record.ownership.lifecycleGeneration }
          : {}),
        settlementSource,
        cancellationReason: "run-dir-cleanup-failed",
      };
      diagnose(record.cleanupUnconfirmedDiagnostic ?? "antigravity.cleanup_unconfirmed", metadata);
      diagnose("antigravity.quarantine_entered", metadata);
      context.session = {
        ...context.session,
        status: "error",
        lastError:
          "Antigravity owned-resource cleanup failed; new turns are blocked until cleanup succeeds.",
        updatedAt: new Date().toISOString(),
      };
      offer({
        ...base(context, { includeTurn: false }),
        type: "session.state.changed",
        payload: { state: "error", reason: context.session.lastError },
        raw: raw("owned-resource-cleanup-failed", metadata),
      } satisfies ProviderRuntimeEvent);
      if (!record.stopRequested) scheduleQuarantineReap(context, record);
    };

    const cleanupSettledTurnResources = async (
      context: AntigravitySessionContext,
      record: QuarantineRecord,
      settlementSource: string,
    ): Promise<boolean> => {
      const cleaned = await cleanupOwnedTurnResources(
        context,
        record.gatewaySessionLease,
        record.runDir,
      );
      if (
        context.quarantine !== record ||
        sessions.get(record.ownership.threadId) !== context ||
        context.lifecycleGeneration !== record.ownership.lifecycleGeneration
      ) {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: `${settlementSource}-cleanup` }),
        );
        return false;
      }
      if (!cleaned) {
        reportExitedCleanupFailure(context, record, settlementSource);
        return false;
      }
      delete context.quarantine;
      return true;
    };

    const settleStopHook = async (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
    ): Promise<void> => {
      if (!ownsRecovery(context, ownership)) return;
      const teardownOutcome = invokeTeardown(ownership.child).then<
        RecoveryTeardownOutcome,
        RecoveryTeardownOutcome
      >(
        (result) => ({ kind: "proven", result }),
        (cause) => ({ kind: "unproven", cause }),
      );
      context.terminalTeardown = teardownOutcome;
      const outcome = await teardownOutcome;
      if (context.terminalTeardown === teardownOutcome) delete context.terminalTeardown;
      if (!ownsRecovery(context, ownership) || context.terminalClaimant !== "stop-hook") return;
      await pollActiveTurn(context).catch(() => undefined);
      if (!ownsRecovery(context, ownership) || context.terminalClaimant !== "stop-hook") return;
      const finalDrainRevision = context.recovery.activityRevision;
      await pollActiveTurn(context).catch(() => undefined);
      if (
        !ownsRecovery(context, ownership) ||
        context.terminalClaimant !== "stop-hook" ||
        context.recovery.activityRevision !== finalDrainRevision
      ) {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: "stop-hook-final-drain" }),
        );
        return;
      }
      const metadata = recoveryFields(context, {
        teardownStage: outcome.kind === "proven" ? "graceful" : "stop-hook",
        settlementSource: "stop-hook",
        captureComplete:
          outcome.kind === "unproven" && outcome.cause instanceof ProviderProcessExitUnprovenError
            ? outcome.cause.captureComplete
            : outcome.kind === "proven",
        remainingDescendantCount:
          outcome.kind === "unproven" && outcome.cause instanceof ProviderProcessExitUnprovenError
            ? (outcome.cause.remainingDescendantPids?.length ?? null)
            : 0,
      });
      if (outcome.kind === "unproven") {
        const record: QuarantineRecord = {
          ownership,
          runDir: ownership.runDir,
          ...(ownership.gatewaySessionLease !== undefined
            ? { gatewaySessionLease: ownership.gatewaySessionLease }
            : {}),
          stopRequested: context.stopRequested,
          reapInFlight: false,
          cleanupUnconfirmedDiagnostic: "antigravity.stop_cleanup_unconfirmed",
          cleanupUnconfirmedReported: true,
        };
        context.quarantine = record;
        diagnose("antigravity.stop_cleanup_unconfirmed", metadata);
        diagnose("antigravity.quarantine_entered", metadata);
        emitStopCleanupWarning(context, ownership, metadata);
        settleActiveTurn(context, {
          state: "completed",
          stopReason: "model_stop",
          claimant: "stop-hook",
          raw: raw("stop-hook-recovery", metadata),
        });
        context.session = {
          ...context.session,
          status: "error",
          lastError:
            "Antigravity Stop cleanup is unconfirmed; new turns are blocked until cleanup succeeds.",
          updatedAt: new Date().toISOString(),
        };
        offer({
          ...base(context, { includeTurn: false }),
          type: "session.state.changed",
          payload: { state: "error", reason: context.session.lastError },
          raw: raw("stop-hook-quarantine", metadata),
        } satisfies ProviderRuntimeEvent);
        scheduleQuarantineReap(context, record);
        return;
      }
      const cleanupFence = installExitedCleanupFence(
        context,
        ownership,
        "antigravity.stop_cleanup_unconfirmed",
      );
      if (!cleanupFence) return;
      settleActiveTurn(context, {
        state: "completed",
        stopReason: "model_stop",
        claimant: "stop-hook",
        raw: raw("stop-hook-recovery", metadata),
      });
      await cleanupSettledTurnResources(context, cleanupFence, "stop-hook-cleanup");
    };

    // ---- Stop `fullyIdle` aggregate background lifecycle --------------------

    const emitStopIdleActivity = (
      context: AntigravitySessionContext,
      state: "active" | "idle" | "finalizing",
      detail?: string,
    ): void => {
      const stopIdle = context.stopIdle;
      if (!stopIdle || stopIdle.emitted[state]) return;
      stopIdle.emitted[state] = true;
      offer({
        ...base(context),
        type: "turn.background-activity.changed",
        payload: {
          state,
          source: "provider_stop",
          ...(detail ? { detail: detail.slice(0, 180) } : {}),
        },
      } satisfies ProviderRuntimeEvent);
    };

    const clearStopIdleTimer = (context: AntigravitySessionContext): void => {
      const stopIdle = context.stopIdle;
      if (stopIdle?.timer !== undefined) {
        clearTimeout(stopIdle.timer);
        delete stopIdle.timer;
      }
    };

    const armStopIdleTimer = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      kind: "background-deadline" | "close-wait",
    ): void => {
      const stopIdle = context.stopIdle;
      if (!stopIdle) return;
      clearStopIdleTimer(context);
      const timer = setTimeout(
        () => {
          if (context.stopIdle !== stopIdle) return;
          delete stopIdle.timer;
          const settlement = settleStopIdleTimeout(context, ownership, kind);
          context.terminalSettlement = settlement;
          void settlement.finally(() => {
            if (context.terminalSettlement === settlement) delete context.terminalSettlement;
          });
        },
        kind === "background-deadline" ? stopIdleBackgroundDeadlineMs : stopIdleCloseWaitMs,
      );
      stopIdle.timer = timer;
    };

    const observeStopIdle = (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      observation: StopIdleObservation,
    ): void => {
      if (!ownsRecovery(context, ownership)) return;
      if (context.turnTerminalEmitted || context.terminalClaimant !== undefined) return;
      if (!observation.fullyIdle) {
        const state: StopIdleState = context.stopIdle ?? {
          phase: "background-active",
          observations: 0,
          idleConfirmed: false,
          capReached: false,
          emitted: { active: false, idle: false, finalizing: false },
        };
        context.stopIdle = state;
        state.observations += 1;
        if (observation.continued === false) state.capReached = true;
        // The Stop contract owns this turn's terminal from here on: legacy
        // completion candidates and the watchdog must stay out regardless of
        // pendingTools.
        setIneligible(context, "stop-idle-observed", false);
        diagnose(
          "antigravity.background_continue",
          recoveryFields(context, {
            settlementSource: "provider_stop",
            observationCount: state.observations,
            continued: observation.continued ?? null,
            continuationLimit: observation.continuationLimit ?? null,
            ...(observation.executionNum !== undefined
              ? { executionNum: observation.executionNum }
              : {}),
            ...(observation.terminationReason !== undefined
              ? { terminationReason: observation.terminationReason }
              : {}),
          }),
        );
        if (state.phase === "close-wait") return;
        emitStopIdleActivity(context, "active", observation.terminationReason);
        if (state.timer === undefined) armStopIdleTimer(context, ownership, "background-deadline");
        return;
      }
      diagnose(
        "antigravity.background_idle_observed",
        recoveryFields(context, {
          settlementSource: "provider_stop",
          ...(observation.executionNum !== undefined
            ? { executionNum: observation.executionNum }
            : {}),
        }),
      );
      const existing = context.stopIdle;
      if (existing) {
        if (existing.phase === "close-wait") return;
        existing.phase = "close-wait";
        existing.idleConfirmed = true;
        if (existing.emitted.active) emitStopIdleActivity(context, "idle");
        armStopIdleTimer(context, ownership, "close-wait");
        return;
      }
      context.stopIdle = {
        phase: "close-wait",
        observations: 0,
        idleConfirmed: true,
        capReached: false,
        emitted: { active: false, idle: false, finalizing: false },
      };
      setIneligible(context, "stop-idle-observed", false);
      armStopIdleTimer(context, ownership, "close-wait");
    };

    const stopIdleDrainMarker = (context: AntigravitySessionContext): string =>
      `${context.processedHookBytes}:${context.processedTranscriptBytes}:${context.recovery.activityRevision}`;

    const drainStopIdleStableEof = async (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
    ): Promise<void> => {
      const startedAt = nowMs();
      let quietSince = nowMs();
      let marker = stopIdleDrainMarker(context);
      for (;;) {
        await pollActiveTurn(context).catch(() => undefined);
        if (!ownsRecovery(context, ownership)) return;
        const next = stopIdleDrainMarker(context);
        if (next !== marker) {
          marker = next;
          quietSince = nowMs();
        }
        if (nowMs() - quietSince >= stopIdleStableEofQuietMs) return;
        if (nowMs() - startedAt >= stopIdleFinalDrainMs) return;
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    };

    const closeDanglingStopIdleTools = (context: AntigravitySessionContext): void => {
      for (const pending of context.pendingTools.splice(0)) {
        offer({
          ...base(context, { itemId: pending.itemId }),
          type: "item.completed",
          payload: {
            itemType: pending.itemType,
            status: "failed",
            title: pending.name,
            detail:
              "Background tool never reported a result before the Antigravity process closed.",
            data: { toolCallId: pending.itemId, toolName: pending.name },
          },
          raw: raw("stop-idle-tool-closeout", { name: pending.name }),
        } satisfies ProviderRuntimeEvent);
      }
    };

    const finalizeStopIdleTurn = async (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      input: {
        readonly outcome: "natural-close" | "close-wait-timeout" | "background-deadline";
        readonly closeCode?: number | null;
        readonly stderr?: string;
        readonly teardownOutcome?: RecoveryTeardownOutcome;
      },
    ): Promise<void> => {
      if (!ownsRecovery(context, ownership) || context.turnTerminalEmitted) return;
      const stopIdle = context.stopIdle;
      const idleConfirmed = stopIdle?.idleConfirmed ?? false;
      closeDanglingStopIdleTools(context);
      const stopIdleSettle = (settle: Parameters<typeof settleActiveTurn>[1]): void => {
        if (context.quarantine !== undefined) {
          // The quarantine record already owns resource cleanup and its reaper;
          // never install a second cleanup fence beside it.
          settleActiveTurn(context, settle);
          return;
        }
        const cleanupFence = installExitedCleanupFence(
          context,
          ownership,
          "antigravity.stop_idle_cleanup_unconfirmed",
        );
        if (!cleanupFence) return;
        settleActiveTurn(context, settle);
        void cleanupSettledTurnResources(context, cleanupFence, "stop-idle-cleanup");
      };
      const metadata = recoveryFields(context, {
        settlementSource: "stop-idle",
        stopIdleOutcome: input.outcome,
        idleConfirmed,
        ...(stopIdle?.capReached ? { continuationCapReached: true } : {}),
        ...(stopIdle?.observations !== undefined && stopIdle.observations > 0
          ? { observationCount: stopIdle.observations }
          : {}),
        ...(input.closeCode !== undefined ? { exitCode: input.closeCode } : {}),
        ...(input.teardownOutcome
          ? {
              teardownStage: input.teardownOutcome.kind === "proven" ? "graceful" : "stop-idle",
              captureComplete:
                input.teardownOutcome.kind === "unproven" &&
                input.teardownOutcome.cause instanceof ProviderProcessExitUnprovenError
                  ? input.teardownOutcome.cause.captureComplete
                  : input.teardownOutcome.kind === "proven",
              remainingDescendantCount:
                input.teardownOutcome.kind === "unproven" &&
                input.teardownOutcome.cause instanceof ProviderProcessExitUnprovenError
                  ? (input.teardownOutcome.cause.remainingDescendantPids?.length ?? null)
                  : 0,
            }
          : {}),
      });
      if (input.outcome === "background-deadline") {
        stopIdleSettle({
          state: "failed",
          stopReason: "error",
          errorMessage:
            "Antigravity background work exceeded its deadline and the turn was torn down (background_deadline_exceeded).",
          claimant: "stop-idle",
          raw: raw("stop-idle-deadline", metadata),
        });
        return;
      }
      if (!idleConfirmed) {
        diagnose("antigravity.background_idle_unconfirmed", metadata);
        stopIdleSettle({
          state: "failed",
          stopReason: "error",
          errorMessage:
            "Antigravity closed before confirming background work was idle (background_idle_unconfirmed).",
          claimant: "stop-idle",
          raw: raw("stop-idle-idle-unconfirmed", metadata),
        });
        return;
      }
      if (input.outcome === "natural-close" && input.closeCode !== null && input.closeCode !== 0) {
        offer({
          ...base(context, { includeTurn: false }),
          type: "runtime.warning",
          payload: {
            message:
              input.stderr?.trim() ||
              `Antigravity CLI exited with code ${input.closeCode} after background work went idle.`,
          },
          raw: raw("stop-idle-nonzero-exit", { code: input.closeCode }),
        } satisfies ProviderRuntimeEvent);
      }
      stopIdleSettle({
        state: "completed",
        stopReason: "model_stop",
        claimant: "stop-idle",
        raw: raw(
          input.outcome === "close-wait-timeout"
            ? "stop-idle-close-wait-timeout"
            : "stop-idle-close",
          metadata,
        ),
      });
    };

    const settleStopIdleClose = async (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      input: {
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly stdout?: string;
        readonly stderr?: string;
      },
    ): Promise<void> => {
      if (context.turnTerminalEmitted) return;
      if (!claimTerminal(context, "stop-idle")) return;
      clearStopIdleTimer(context);
      await Effect.runPromise(
        cancelAgentGatewayTurn(ownership.gatewaySessionLease, ownership.turnId),
      );
      if (!ownsRecovery(context, ownership) || context.turnTerminalEmitted) return;
      emitStopIdleActivity(context, "finalizing");
      await drainStopIdleStableEof(context, ownership);
      if (!ownsRecovery(context, ownership) || context.turnTerminalEmitted) return;
      if (!context.sawAssistant && input.stdout) {
        emitTextItem(
          context,
          { step_index: Number.MAX_SAFE_INTEGER, type: "PRINT_OUTPUT", content: input.stdout },
          "assistant_message",
          "assistant_text",
        );
      }
      await finalizeStopIdleTurn(context, ownership, {
        outcome: "natural-close",
        closeCode: input.code,
        ...(input.stderr ? { stderr: input.stderr } : {}),
      });
    };

    const settleStopIdleTimeout = async (
      context: AntigravitySessionContext,
      ownership: RecoveryOwnership,
      kind: "background-deadline" | "close-wait",
    ): Promise<void> => {
      if (context.turnTerminalEmitted || !ownsRecovery(context, ownership)) return;
      if (!claimTerminal(context, "stop-idle")) return;
      const stopIdle = context.stopIdle;
      clearStopIdleTimer(context);
      diagnose(
        kind === "background-deadline"
          ? "antigravity.background_deadline_exceeded"
          : "antigravity.background_close_wait_timeout",
        recoveryFields(context, {
          settlementSource: kind,
          observationCount: stopIdle?.observations ?? 0,
          idleConfirmed: stopIdle?.idleConfirmed ?? false,
        }),
      );
      await Effect.runPromise(
        cancelAgentGatewayTurn(ownership.gatewaySessionLease, ownership.turnId),
      );
      if (!ownsRecovery(context, ownership) || context.turnTerminalEmitted) return;
      const outcome = await invokeTeardown(ownership.child).then<
        RecoveryTeardownOutcome,
        RecoveryTeardownOutcome
      >(
        (result) => ({ kind: "proven", result }),
        (cause) => ({ kind: "unproven", cause }),
      );
      if (outcome.kind === "unproven") {
        const quarantineMetadata = recoveryFields(context, {
          teardownStage: kind,
          settlementSource: "stop-idle",
          captureComplete:
            outcome.cause instanceof ProviderProcessExitUnprovenError
              ? outcome.cause.captureComplete
              : false,
          remainingDescendantCount:
            outcome.cause instanceof ProviderProcessExitUnprovenError
              ? (outcome.cause.remainingDescendantPids?.length ?? null)
              : null,
        });
        const record: QuarantineRecord = {
          ownership,
          runDir: ownership.runDir,
          ...(ownership.gatewaySessionLease !== undefined
            ? { gatewaySessionLease: ownership.gatewaySessionLease }
            : {}),
          stopRequested: context.stopRequested,
          reapInFlight: false,
          cleanupUnconfirmedDiagnostic: "antigravity.background_teardown_unconfirmed",
          cleanupUnconfirmedReported: true,
        };
        context.quarantine = record;
        diagnose("antigravity.background_teardown_unconfirmed", quarantineMetadata);
        diagnose("antigravity.quarantine_entered", quarantineMetadata);
        if (!record.stopRequested) scheduleQuarantineReap(context, record);
      }
      if (!ownsRecovery(context, ownership) || context.turnTerminalEmitted) return;
      emitStopIdleActivity(context, "finalizing");
      await drainStopIdleStableEof(context, ownership);
      if (!ownsRecovery(context, ownership) || context.turnTerminalEmitted) return;
      await finalizeStopIdleTurn(context, ownership, {
        outcome: kind === "background-deadline" ? "background-deadline" : "close-wait-timeout",
        teardownOutcome: outcome,
      });
      // An unproven teardown leaves the quarantine record owning cleanup; the
      // terminal above resets the session to ready, so the error admission
      // fence is re-asserted after settlement, mirroring the watchdog path.
      if (outcome.kind === "unproven" && sessions.get(ownership.threadId) === context) {
        context.session = {
          ...context.session,
          status: "error",
          lastError:
            "Antigravity background teardown is unconfirmed; new turns are blocked until cleanup succeeds.",
          updatedAt: new Date().toISOString(),
        };
        offer({
          ...base(context, { includeTurn: false }),
          type: "session.state.changed",
          payload: { state: "error", reason: context.session.lastError },
          raw: raw("stop-idle-teardown-quarantine", {
            threadId: ownership.threadId,
            turnId: ownership.turnId,
            ...(ownership.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: ownership.lifecycleGeneration }
              : {}),
            settlementSource: "stop-idle",
            teardownStage: kind,
          }),
        } satisfies ProviderRuntimeEvent);
      }
    };

    maybeRecoverTerminalAnswer = async (context) => {
      const recovery = context.recovery;
      if (recovery.phase !== "grace") return;
      if (context.stopIdle !== undefined) {
        setIneligible(context, "stop-idle-active");
        return;
      }
      const ownership = captureOwnership(context);
      if (
        !ownership ||
        !ownsRecovery(context, ownership) ||
        context.interrupted ||
        context.stopped ||
        context.turnTerminalEmitted ||
        context.pendingTools.length > 0 ||
        nowMs() - recovery.lastActivityAtMs < terminalRecoveryGraceMs
      ) {
        setIneligible(context, "grace-revalidation-failed");
        return;
      }
      clearRecoveryTimer(recovery);
      context.recovery = { ...recovery, phase: "final-drain", ownership };
      diagnose(
        "antigravity.missing_terminal_recovery_started",
        recoveryFields(context, {
          candidateStepIndex: recovery.candidate.stepIndex,
          quietDurationMs: nowMs() - recovery.lastActivityAtMs,
          settlementSource: terminalRecoveryMode === "shadow" ? "shadow" : "watchdog",
        }),
      );
      await pollActiveTurn(context);
      if (
        !ownsRecovery(context, ownership) ||
        context.recovery.phase !== "final-drain" ||
        context.recovery.activityRevision !== recovery.activityRevision
      ) {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: "final-drain" }),
        );
        return;
      }
      await pollActiveTurn(context);
      if (
        !ownsRecovery(context, ownership) ||
        context.recovery.phase !== "final-drain" ||
        context.recovery.activityRevision !== recovery.activityRevision ||
        context.pendingTools.length > 0
      ) {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: "final-drain-revision-changed" }),
        );
        return;
      }
      if (terminalRecoveryMode === "shadow") {
        context.recovery = { ...context.recovery, phase: "shadowed" };
        diagnose(
          "antigravity.missing_terminal_recovery_completed",
          recoveryFields(context, {
            candidateStepIndex: recovery.candidate.stepIndex,
            quietDurationMs: nowMs() - recovery.lastActivityAtMs,
            settlementSource: "shadow",
          }),
        );
        return;
      }
      if (!claimTerminal(context, "watchdog")) return;
      let resolveTeardown!: (outcome: RecoveryTeardownOutcome) => void;
      const teardownOutcome = new Promise<RecoveryTeardownOutcome>((resolve) => {
        resolveTeardown = resolve;
      });
      context.recovery = {
        ...context.recovery,
        phase: "teardown",
        closeObserved: false,
        teardownOutcome,
      };
      context.terminalTeardown = teardownOutcome;
      // The teardown phase and claimant are latched before invoking code that
      // may synchronously emit the child's close event.
      void invokeTeardown(ownership.child).then(
        (result) => resolveTeardown({ kind: "proven", result }),
        (cause) => resolveTeardown({ kind: "unproven", cause }),
      );
      const outcome = await teardownOutcome;
      const teardownResult = outcome.kind === "proven" ? outcome.result : undefined;
      const teardownFailure = outcome.kind === "unproven" ? outcome.cause : undefined;
      if (!ownsRecovery(context, ownership) || context.recovery.phase !== "teardown") {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: "teardown" }),
        );
        return;
      }
      const diagnosticMetadata = recoveryFields(context, {
        candidateStepIndex: recovery.candidate.stepIndex,
        quietDurationMs: nowMs() - recovery.lastActivityAtMs,
        teardownStage: teardownResult?.escalated ? "forced" : "graceful",
        settlementSource: "watchdog",
        captureComplete:
          teardownFailure instanceof ProviderProcessExitUnprovenError
            ? teardownFailure.captureComplete
            : teardownFailure === undefined,
        remainingDescendantCount:
          teardownFailure instanceof ProviderProcessExitUnprovenError
            ? (teardownFailure.remainingDescendantPids?.length ?? null)
            : 0,
      });
      if (teardownFailure !== undefined) {
        const record: QuarantineRecord = {
          ownership,
          runDir: ownership.runDir,
          ...(ownership.gatewaySessionLease !== undefined
            ? { gatewaySessionLease: ownership.gatewaySessionLease }
            : {}),
          stopRequested: context.stopRequested,
          reapInFlight: false,
          cleanupUnconfirmedDiagnostic: "antigravity.missing_terminal_teardown_failed",
          cleanupUnconfirmedReported: true,
        };
        context.quarantine = record;
        diagnose("antigravity.missing_terminal_teardown_failed", diagnosticMetadata);
        diagnose("antigravity.quarantine_entered", diagnosticMetadata);
        emitRecoveryWarning(context, ownership, diagnosticMetadata, true);
        settleActiveTurn(context, {
          state: "completed",
          stopReason: "model_stop",
          claimant: "watchdog",
          raw: raw("missing-terminal-recovery", diagnosticMetadata),
        });
        context.session = {
          ...context.session,
          status: "error",
          lastError:
            "Antigravity process cleanup could not be confirmed; new turns are blocked until cleanup succeeds.",
          updatedAt: new Date().toISOString(),
        };
        offer({
          ...base(context, { includeTurn: false }),
          type: "session.state.changed",
          payload: {
            state: "error",
            reason:
              "Antigravity process cleanup could not be confirmed; new turns are blocked until cleanup succeeds.",
          },
          raw: raw("quarantine-entered", diagnosticMetadata),
        } satisfies ProviderRuntimeEvent);
        if (!record.stopRequested) scheduleQuarantineReap(context, record);
        return;
      }
      await Effect.runPromise(
        cancelAgentGatewayTurn(ownership.gatewaySessionLease, ownership.turnId),
      );
      if (!ownsRecovery(context, ownership) || context.recovery.phase !== "teardown") {
        diagnose(
          "antigravity.stale_recovery_ignored",
          recoveryFields(context, { settlementSource: "post-teardown-cancel" }),
        );
        return;
      }
      const cleanupFence = installExitedCleanupFence(
        context,
        ownership,
        "antigravity.missing_terminal_cleanup_unconfirmed",
      );
      if (!cleanupFence) return;
      emitRecoveryWarning(context, ownership, diagnosticMetadata);
      diagnose("antigravity.missing_terminal_recovery_completed", diagnosticMetadata);
      settleActiveTurn(context, {
        state: "completed",
        stopReason: "model_stop",
        claimant: "watchdog",
        raw: raw("missing-terminal-recovery", diagnosticMetadata),
      });
      await cleanupSettledTurnResources(context, cleanupFence, "watchdog-cleanup");
    };

    const startSession: AntigravityAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.runtimeMode !== "full-access") {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "session/start",
            issue:
              "Antigravity CLI print mode cannot pause for interactive approvals. Select Full access to use this provider.",
          });
        }
        const binaryPath = trim(input.providerOptions?.antigravity?.binaryPath) ?? "agy";
        yield* Effect.tryPromise({
          try: () =>
            (dependencies.ensurePlugin ?? ensureCapturePlugin)(
              binaryPath,
              agentGatewayCredentials?.stdioProxy,
            ),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "plugin/install",
              detail: messageFromCause(cause, "Failed to install the Synara capture hook."),
              cause,
            }),
        });
        const existing = sessions.get(input.threadId);
        if (existing) {
          if (existing.quarantine || existing.preparationCleanupFence) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "session/start",
              issue:
                "Antigravity cleanup is still in progress for this thread. Stop the session or wait for cleanup before restarting it.",
            });
          }
          existing.stopped = true;
          existing.interrupted = true;
          existing.admissionGeneration += 1;
          claimTerminal(existing, "session-stop");
          setIneligible(existing, "session-replacement");
          clearTurnScheduling(existing);
          const existingOwnership = captureOwnership(existing);
          const existingRunDir = existing.activeRunDir;
          const existingLease = existing.gatewaySessionLease;
          yield* cancelAgentGatewayTurn(existing.gatewaySessionLease, existing.activeTurnId);
          let replacementTeardownFailure: unknown;
          yield* teardownActiveProcess(existing, "session/restart").pipe(
            Effect.catch((cause) =>
              Effect.sync(() => {
                replacementTeardownFailure =
                  cause instanceof ProviderAdapterRequestError && cause.cause !== undefined
                    ? cause.cause
                    : cause;
              }),
            ),
          );
          if (replacementTeardownFailure !== undefined) {
            if (existingOwnership) {
              quarantineStoppedProcess(existing, existingOwnership, replacementTeardownFailure);
            }
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/restart",
              detail:
                "The previous Antigravity process exit could not be confirmed; restart is fenced until cleanup succeeds.",
              cause: replacementTeardownFailure,
            });
          }
          if (existingRunDir !== undefined) {
            const cleaned = yield* Effect.promise(() =>
              cleanupOwnedTurnResources(existing, existingLease, existingRunDir),
            );
            if (!cleaned) {
              const ownership = captureOwnership(existing);
              if (ownership) {
                quarantineExitedTurnCleanup(existing, ownership, "session-replacement-cleanup");
              }
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/restart",
                detail:
                  "The previous Antigravity session stopped, but its owned resources could not be removed; restart is fenced until cleanup succeeds.",
              });
            }
          } else {
            releaseTurnGatewayLease(existing, existingLease);
          }
        }
        const now = new Date().toISOString();
        const conversationId = resumeConversationId(input.resumeCursor);
        const modelSelection =
          input.modelSelection?.provider === PROVIDER ? input.modelSelection : undefined;
        const model = modelSelection?.model ?? DEFAULT_MODEL;
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: trim(input.cwd) ?? serverConfig.cwd,
          model,
          threadId: input.threadId,
          ...(conversationId ? { resumeCursor: conversationId } : {}),
          createdAt: now,
          updatedAt: now,
        };
        const context: AntigravitySessionContext = {
          session,
          ...(input.mcpAuthority !== undefined && input.mcpAuthority !== null
            ? { mcpAuthority: input.mcpAuthority }
            : {}),
          ...(input.lifecycleGeneration !== undefined
            ? { lifecycleGeneration: input.lifecycleGeneration }
            : {}),
          binaryPath,
          turns: [],
          ...(conversationId ? { conversationId } : {}),
          ...(modelSelection?.options ? { modelOptions: modelSelection.options } : {}),
          ...(conversationId
            ? { transcriptPath: transcriptPathForConversation(conversationId) }
            : {}),
          processedHookBytes: 0,
          processedTranscriptBytes: 0,
          processedSteps: new Set(),
          pendingTools: [],
          nextToolSequence: 0,
          sawAssistant: false,
          turnOutputProduced: false,
          interrupted: false,
          stopped: false,
          stopRequested: false,
          turnTerminalEmitted: false,
          recovery: {
            phase: "ineligible",
            activityRevision: 0,
            lastActivityAtMs: nowMs(),
          },
          admissionGeneration: 0,
        };
        sessions.set(input.threadId, context);
        offer({
          ...base(context, { includeTurn: false }),
          type: "session.started",
          payload: {
            message: "Antigravity CLI session started",
            ...(conversationId ? { resume: conversationId } : {}),
          },
        } satisfies ProviderRuntimeEvent);
        offer({
          ...base(context, { includeTurn: false }),
          type: "thread.started",
          payload: conversationId ? { providerThreadId: conversationId } : {},
        } satisfies ProviderRuntimeEvent);
        return session;
      });

    const sendTurn: AntigravityAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        if (context.quarantine || context.preparationCleanupFence) {
          diagnose(
            "antigravity.quarantine_admission_blocked",
            recoveryFields(context, { settlementSource: "turn-admission" }),
          );
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue:
              "Antigravity cleanup is still in progress for this thread. Wait for cleanup or stop the session before starting another turn.",
          });
        }
        if (context.activeProcess) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "An Antigravity turn is already active for this thread.",
          });
        }
        const admissionGeneration = context.admissionGeneration + 1;
        context.admissionGeneration = admissionGeneration;
        const ownsAdmission = () =>
          sessions.get(input.threadId) === context &&
          !context.stopped &&
          !context.quarantine &&
          !context.preparationCleanupFence &&
          context.admissionGeneration === admissionGeneration;
        const prompt = appendFileAttachmentsPromptBlock({
          text: input.input,
          attachments: input.attachments,
          attachmentsDir: serverConfig.attachmentsDir,
          include: "all-files",
        });
        const normalizedPrompt = trim(prompt);
        if (!normalizedPrompt) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "A prompt or file attachment is required.",
          });
        }
        const canBootstrapGateway =
          agentGatewayCredentials !== undefined && context.mcpAuthority != null;
        const providerPrompt = buildAntigravityTurnPrompt(context, {
          prompt: normalizedPrompt,
          hasGatewaySessionLease: canBootstrapGateway,
        });
        const promptIssue = antigravityPromptCommandLineIssue(providerPrompt);
        if (promptIssue) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: promptIssue,
          });
        }
        const turnId = TurnId.makeUnsafe(crypto.randomUUID());
        const modelSelection =
          input.modelSelection?.provider === PROVIDER ? input.modelSelection : undefined;
        const model = modelSelection?.model ?? context.session.model ?? DEFAULT_MODEL;
        const modelOptions = modelSelection?.options ?? context.modelOptions;
        const cliModel = resolveAntigravityCliModelLabel(
          model,
          modelOptions,
          defaultEffortByModel.get(model),
        );
        const runDir = yield* Effect.tryPromise({
          try: () =>
            dependencies.createRunDir?.() ??
            fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-")),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/prepare",
              detail: messageFromCause(cause, "Failed to prepare Antigravity turn files."),
              cause,
            }),
        });
        if (!ownsAdmission()) {
          const cleaned = yield* Effect.promise(() =>
            cleanupPreparedTurnResources(context, admissionGeneration, runDir),
          );
          if (!cleaned) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/prepare",
              detail:
                "Antigravity turn admission became stale and its run directory could not be removed; cleanup is fenced and will be retried.",
            });
          }
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "Antigravity turn admission became stale before process launch.",
          });
        }
        const eventFile = path.join(runDir, "hooks.ndjson");
        const logFile = path.join(runDir, "agy.log");
        yield* Effect.tryPromise({
          try: async () => {
            try {
              await fs.writeFile(eventFile, "");
            } catch (cause) {
              const cleaned = await cleanupPreparedTurnResources(
                context,
                admissionGeneration,
                runDir,
              );
              throw new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "turn/prepare",
                detail: `${messageFromCause(cause, "Failed to create the Antigravity hook stream.")}${
                  cleaned
                    ? ""
                    : " The run directory could not be removed; cleanup is fenced and will be retried."
                }`,
                cause,
              });
            }
          },
          catch: (cause) =>
            cause instanceof ProviderAdapterRequestError
              ? cause
              : new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "turn/prepare",
                  detail: messageFromCause(cause, "Failed to create the Antigravity hook stream."),
                  cause,
                }),
        });
        if (!ownsAdmission()) {
          const cleaned = yield* Effect.promise(() =>
            cleanupPreparedTurnResources(context, admissionGeneration, runDir),
          );
          if (!cleaned) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/prepare",
              detail:
                "Antigravity turn admission became stale and its run directory could not be removed; cleanup is fenced and will be retried.",
            });
          }
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "Antigravity turn admission became stale before process launch.",
          });
        }
        const gatewaySessionLease = acquireAgentGatewaySessionLease(
          agentGatewayCredentials,
          input.threadId,
          PROVIDER,
          context.mcpAuthority,
        );
        if (!ownsAdmission()) {
          const cleaned = yield* Effect.promise(() =>
            cleanupPreparedTurnResources(context, admissionGeneration, runDir, gatewaySessionLease),
          );
          if (!cleaned) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/prepare",
              detail:
                "Antigravity turn admission became stale and its owned resources could not be removed; cleanup is fenced and will be retried.",
            });
          }
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "Antigravity turn admission became stale before process launch.",
          });
        }
        const gatewayBootstrapToken = gatewaySessionLease?.issueStdioBootstrapToken?.();
        if (gatewaySessionLease && !gatewayBootstrapToken) {
          const cleaned = yield* Effect.promise(() =>
            cleanupPreparedTurnResources(context, admissionGeneration, runDir, gatewaySessionLease),
          );
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/prepare",
            detail: `The Synara gateway credential is no longer active for this provider turn.${
              cleaned
                ? ""
                : " Owned-resource cleanup failed; admission is fenced and cleanup will be retried."
            }`,
          });
        }
        if (gatewaySessionLease) context.gatewaySessionLease = gatewaySessionLease;
        context.activeTurnId = turnId;
        context.activePrompt = providerPrompt;
        if (modelOptions) {
          context.modelOptions = modelOptions;
        } else {
          delete context.modelOptions;
        }
        context.eventFile = eventFile;
        context.activeRunDir = runDir;
        context.processedHookBytes = 0;
        context.processedSteps.clear();
        delete context.latestUserStepIndex;
        yield* Effect.promise(() => markExistingTranscriptStepsProcessed(context));
        if (!ownsAdmission()) {
          delete context.activeTurnId;
          delete context.activeRunDir;
          const cleaned = yield* Effect.promise(() =>
            cleanupPreparedTurnResources(context, admissionGeneration, runDir, gatewaySessionLease),
          );
          if (!cleaned) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/prepare",
              detail:
                "Antigravity turn admission became stale and its owned resources could not be removed; cleanup is fenced and will be retried.",
            });
          }
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "Antigravity turn admission became stale before process launch.",
          });
        }
        context.pendingTools = [];
        context.nextToolSequence = 0;
        context.sawAssistant = false;
        context.turnOutputProduced = false;
        context.interrupted = false;
        context.turnTerminalEmitted = false;
        delete context.terminalClaimant;
        const priorStopIdle = context.stopIdle;
        if (priorStopIdle?.timer !== undefined) clearTimeout(priorStopIdle.timer);
        delete context.stopIdle;
        clearRecoveryTimer(context.recovery);
        context.recovery = {
          phase: "ineligible",
          activityRevision: 0,
          lastActivityAtMs: nowMs(),
        };
        context.turns.push({ id: turnId, items: [] });
        context.session = {
          ...context.session,
          status: "running",
          model,
          activeTurnId: turnId,
          updatedAt: new Date().toISOString(),
        };
        offer({
          ...base(context),
          type: "turn.started",
          payload: { model },
        } satisfies ProviderRuntimeEvent);

        const conversationId = context.conversationId;
        const args: string[] = [
          ...(conversationId ? ["--conversation", conversationId] : ["--new-project"]),
          "--dangerously-skip-permissions",
          "--model",
          cliModel,
          "--log-file",
          logFile,
          "--print-timeout",
          PRINT_TIMEOUT,
          "-p",
          providerPrompt,
        ];
        let child: AntigravityChildProcess;
        try {
          const spawnProcess =
            dependencies.spawnProcess ??
            ((command: string, spawnArgs: readonly string[], options: SpawnOptions) =>
              spawn(command, spawnArgs, options) as AntigravityChildProcess);
          child = spawnProcess(context.binaryPath, args, {
            cwd: context.session.cwd ?? serverConfig.cwd,
            env: buildAntigravityTurnProcessEnvironment({
              eventFile,
              ...(stopIdleLifecycle
                ? { stopIdle: { maxContinuations: stopIdleMaxContinuations } }
                : {}),
              ...(gatewaySessionLease && gatewayBootstrapToken
                ? {
                    gatewayConnection: gatewaySessionLease.connection,
                    gatewayBootstrapToken,
                  }
                : {}),
            }),
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (cause) {
          delete context.activeRunDir;
          delete context.activeTurnId;
          context.turns.pop();
          const cleaned = yield* Effect.promise(() =>
            cleanupPreparedTurnResources(context, admissionGeneration, runDir, gatewaySessionLease),
          );
          if (cleaned) {
            const { activeTurnId: _activeTurnId, ...inactiveSession } = context.session;
            context.session = {
              ...inactiveSession,
              status: "ready",
              updatedAt: new Date().toISOString(),
            };
          }
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: `${messageFromCause(cause, "Failed to launch Antigravity CLI.")}${
              cleaned
                ? ""
                : " Owned-resource cleanup failed; admission is fenced and cleanup will be retried."
            }`,
            cause,
          });
        }
        context.activeProcess = child;
        const ownsTurn = () =>
          sessions.get(input.threadId) === context &&
          !context.stopped &&
          context.activeProcess === child &&
          context.activeTurnId === turnId;
        let stdout = "";
        let stderr = "";
        let turnResourcesReleased = false;
        let turnResourceCleanup: Promise<boolean> | undefined;
        const turnOwnership: RecoveryOwnership = {
          threadId: input.threadId,
          turnId,
          ...(context.lifecycleGeneration !== undefined
            ? { lifecycleGeneration: context.lifecycleGeneration }
            : {}),
          child,
          runDir,
          ...(gatewaySessionLease !== undefined ? { gatewaySessionLease } : {}),
        };
        const cleanupTurnResources = async (quarantineOnFailure = true) => {
          if (turnResourcesReleased) return true;
          if (turnResourceCleanup) return turnResourceCleanup;
          const cleanup = cleanupOwnedTurnResources(context, gatewaySessionLease, runDir).then(
            (cleaned) => {
              if (cleaned) {
                turnResourcesReleased = true;
              } else if (quarantineOnFailure) {
                quarantineExitedTurnCleanup(context, turnOwnership, "turn-settlement-cleanup");
              }
              return cleaned;
            },
          );
          turnResourceCleanup = cleanup;
          try {
            return await cleanup;
          } finally {
            if (turnResourceCleanup === cleanup) turnResourceCleanup = undefined;
          }
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          if (ownsTurn()) noteActivity(context, { invalidate: false, reason: "stdout" });
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          if (ownsTurn()) noteActivity(context, { invalidate: false, reason: "stderr" });
        });
        const timer = setInterval(() => {
          if (ownsTurn()) void pollActiveTurn(context);
        }, POLL_INTERVAL_MS);
        context.pollTimer = timer;
        child.once("error", (_cause) => {
          clearInterval(timer);
          if (context.pollTimer === timer) delete context.pollTimer;
          if (!ownsTurn()) return;
          if (!claimTerminal(context, "process-error")) return;
          const stopIdleUnconfirmed =
            context.stopIdle !== undefined && !context.stopIdle.idleConfirmed;
          clearStopIdleTimer(context);
          delete context.stopIdle;
          noteActivity(context, { invalidate: true, reason: "process-error" });
          queueMicrotask(() => {
            void (async () => {
              if (!ownsTurn()) return;
              if (
                context.recovery.phase === "teardown" &&
                context.recovery.ownership.child === child
              ) {
                return;
              }
              const outputRecovered = !stopIdleUnconfirmed && context.turnOutputProduced;
              const processErrorMessage = stopIdleUnconfirmed
                ? "Antigravity errored before confirming background work was idle (background_idle_unconfirmed)."
                : "Antigravity process failed before emitting a close event.";
              const errorOwnership = captureOwnership(context);
              let errorQuarantine: QuarantineRecord | undefined;
              let teardownFailure: unknown;
              if (child.pid !== undefined && errorOwnership) {
                const errorTeardown = invokeTeardown(child).then<
                  RecoveryTeardownOutcome,
                  RecoveryTeardownOutcome
                >(
                  (result) => ({ kind: "proven", result }),
                  (cause) => ({ kind: "unproven", cause }),
                );
                context.terminalTeardown = errorTeardown;
                const errorOutcome = await errorTeardown;
                if (context.terminalTeardown === errorTeardown) delete context.terminalTeardown;
                if (errorOutcome.kind === "unproven") teardownFailure = errorOutcome.cause;
                if (!ownsRecovery(context, errorOwnership)) return;
                if (teardownFailure !== undefined) {
                  errorQuarantine = {
                    ownership: errorOwnership,
                    runDir: errorOwnership.runDir,
                    ...(errorOwnership.gatewaySessionLease !== undefined
                      ? { gatewaySessionLease: errorOwnership.gatewaySessionLease }
                      : {}),
                    stopRequested: false,
                    reapInFlight: false,
                    cleanupUnconfirmedDiagnostic: "antigravity.process_error_cleanup_unconfirmed",
                    cleanupUnconfirmedReported: true,
                  };
                  context.quarantine = errorQuarantine;
                }
              }
              await Effect.runPromise(cancelAgentGatewayTurn(gatewaySessionLease, turnId));
              if (!ownsTurn()) return;
              const cleanupFence =
                errorQuarantine ??
                (errorOwnership
                  ? installExitedCleanupFence(
                      context,
                      errorOwnership,
                      "antigravity.process_error_cleanup_unconfirmed",
                    )
                  : undefined);
              if (errorOwnership && !cleanupFence) return;
              if (stopIdleUnconfirmed) {
                diagnose(
                  "antigravity.background_idle_unconfirmed",
                  recoveryFields(context, {
                    settlementSource: "process-error",
                    stopIdleOutcome: "process-error",
                    idleConfirmed: false,
                  }),
                );
                offer({
                  ...base(context, { includeTurn: false }),
                  type: "runtime.error",
                  payload: {
                    message: processErrorMessage,
                    class: "transport_error",
                  },
                  raw: raw("process-error-idle-unconfirmed", {
                    threadId: input.threadId,
                    turnId,
                    lifecycleGeneration: context.lifecycleGeneration,
                    settlementSource: "process-error",
                  }),
                } satisfies ProviderRuntimeEvent);
              } else if (outputRecovered) {
                offer({
                  ...base(context, { includeTurn: false }),
                  type: "runtime.warning",
                  payload: {
                    message:
                      "Antigravity process errored after delivering usable output; Synara completed the turn.",
                  },
                  raw: raw("process-error-after-output", {
                    threadId: input.threadId,
                    turnId,
                    lifecycleGeneration: context.lifecycleGeneration,
                    settlementSource: "process-error",
                  }),
                } satisfies ProviderRuntimeEvent);
              } else {
                offer({
                  ...base(context, { includeTurn: false }),
                  type: "runtime.error",
                  payload: {
                    message: processErrorMessage,
                    class: "transport_error",
                  },
                  raw: raw("process-error", {
                    threadId: input.threadId,
                    turnId,
                    lifecycleGeneration: context.lifecycleGeneration,
                    settlementSource: "process-error",
                  }),
                } satisfies ProviderRuntimeEvent);
              }
              settleActiveTurn(context, {
                state: outputRecovered ? "completed" : "failed",
                stopReason: outputRecovered ? "model_stop" : "error",
                claimant: "process-error",
                ...(!outputRecovered ? { errorMessage: processErrorMessage } : {}),
                raw: raw("process-error-settlement", {
                  threadId: input.threadId,
                  turnId,
                  lifecycleGeneration: context.lifecycleGeneration,
                  settlementSource: "process-error",
                }),
              });
              if (errorQuarantine && errorOwnership) {
                const metadata = {
                  threadId: input.threadId,
                  turnId,
                  lifecycleGeneration: context.lifecycleGeneration,
                  teardownStage: "process-error",
                  settlementSource: "process-error",
                  captureComplete:
                    teardownFailure instanceof ProviderProcessExitUnprovenError
                      ? teardownFailure.captureComplete
                      : false,
                  remainingDescendantCount:
                    teardownFailure instanceof ProviderProcessExitUnprovenError
                      ? (teardownFailure.remainingDescendantPids?.length ?? null)
                      : null,
                };
                diagnose("antigravity.process_error_cleanup_unconfirmed", metadata);
                diagnose("antigravity.quarantine_entered", metadata);
                context.session = {
                  ...context.session,
                  status: "error",
                  lastError:
                    "Antigravity process error cleanup is unconfirmed; new turns are blocked until cleanup succeeds.",
                  updatedAt: new Date().toISOString(),
                };
                offer({
                  ...base(context, { includeTurn: false }),
                  type: "session.state.changed",
                  payload: {
                    state: "error",
                    reason:
                      "Antigravity process error cleanup is unconfirmed; new turns are blocked until cleanup succeeds.",
                  },
                  raw: raw("process-error-quarantine", metadata),
                } satisfies ProviderRuntimeEvent);
                scheduleQuarantineReap(context, errorQuarantine);
              } else {
                if (cleanupFence) {
                  await cleanupSettledTurnResources(context, cleanupFence, "process-error-cleanup");
                } else {
                  await cleanupTurnResources();
                }
              }
            })();
          });
        });
        child.once("close", (code, signal) => {
          clearInterval(timer);
          if (context.pollTimer === timer) delete context.pollTimer;
          void (async () => {
            if (!ownsTurn()) {
              const quarantine = context.quarantine;
              if (quarantine?.ownership.child === child) {
                quarantine.exitObserved = true;
                if (quarantine.retryTimer !== undefined) {
                  clearTimeout(quarantine.retryTimer);
                  delete quarantine.retryTimer;
                }
                await reapQuarantine(context, quarantine, true);
              } else {
                await cleanupTurnResources();
              }
              return;
            }
            if (
              context.terminalClaimant === "process-error" ||
              context.terminalClaimant === "stop-hook" ||
              context.terminalClaimant === "stop-idle" ||
              context.terminalClaimant === "interrupt" ||
              context.terminalClaimant === "session-stop"
            ) {
              return;
            }
            if (
              context.stopIdle !== undefined &&
              !context.turnTerminalEmitted &&
              context.terminalClaimant === undefined
            ) {
              const stopIdleOwnership = captureOwnership(context);
              if (stopIdleOwnership) {
                const settlement = settleStopIdleClose(context, stopIdleOwnership, {
                  code,
                  signal,
                  ...(stdout.trim() ? { stdout: stdout.trim() } : {}),
                  ...(stderr.trim() ? { stderr: stderr.trim() } : {}),
                });
                context.terminalSettlement = settlement;
                void settlement.finally(() => {
                  if (context.terminalSettlement === settlement) delete context.terminalSettlement;
                });
              }
              return;
            }
            if (
              context.recovery.phase === "teardown" &&
              context.recovery.ownership.child === child
            ) {
              await pollActiveTurn(context).catch(() => undefined);
              if (!ownsTurn() || context.recovery.phase !== "teardown") return;
              if (!context.sawAssistant && stdout.trim()) {
                emitTextItem(
                  context,
                  {
                    step_index: Number.MAX_SAFE_INTEGER,
                    type: "PRINT_OUTPUT",
                    content: stdout.trim(),
                  },
                  "assistant_message",
                  "assistant_text",
                );
              }
              context.recovery = { ...context.recovery, closeObserved: true };
              return;
            }
            if (!claimTerminal(context, "normal-close")) return;
            noteActivity(context, { invalidate: true, reason: "process-close" });
            // Another path may already have settled (interrupt / stop-hook kill).
            // Still drain hooks/stdout before deciding, but never double-complete.
            const completedTurnId = turnId;
            await Effect.runPromise(cancelAgentGatewayTurn(gatewaySessionLease, completedTurnId));
            if (!ownsTurn()) {
              await cleanupTurnResources();
              return;
            }
            // Each `agy -p` invocation owns a fresh gateway session. Revoke it as
            // soon as that process exits, before post-processing or a later turn
            // can begin, so an unconsumed bootstrap from this turn cannot cross
            // into the next turn's authority.
            // Process death is proven at close; revoke the per-turn authority
            // before final-drain so a following turn cannot inherit it.
            await pollActiveTurn(context).catch(() => undefined);
            if (!ownsTurn()) {
              await cleanupTurnResources();
              return;
            }
            if (!context.sawAssistant && stdout.trim()) {
              emitTextItem(
                context,
                {
                  step_index: Number.MAX_SAFE_INTEGER,
                  type: "PRINT_OUTPUT",
                  content: stdout.trim(),
                },
                "assistant_message",
                "assistant_text",
              );
            }
            if (context.turnTerminalEmitted) {
              if (context.activeProcess === child) delete context.activeProcess;
              delete context.activeRunDir;
              await cleanupTurnResources();
              return;
            }
            const interrupted = context.interrupted || signal !== null;
            const failed = !interrupted && (code ?? 1) !== 0;
            // A non-zero exit after the turn already produced user-visible
            // output (assistant text, tools, or stdout fallback) is treated as
            // a completed turn with a warning instead of a hard failure: the
            // Antigravity CLI can abort its finalization wait (e.g. "Error:
            // timeout waiting for response") after streaming is fully delivered.
            const outputRecovered = failed && context.turnOutputProduced;
            const settledState = interrupted
              ? "interrupted"
              : outputRecovered
                ? "completed"
                : failed
                  ? "failed"
                  : "completed";
            const settledStopReason = interrupted
              ? "interrupted"
              : outputRecovered
                ? "model_stop"
                : failed
                  ? "error"
                  : "model_stop";
            if (failed && !outputRecovered && stderr.trim()) {
              offer({
                ...base(context, { includeTurn: false }),
                type: "runtime.error",
                payload: { message: stderr.trim(), class: "provider_error" },
                raw: raw("stderr", { code, stderr }),
              } satisfies ProviderRuntimeEvent);
            } else if (outputRecovered) {
              offer({
                ...base(context, { includeTurn: false }),
                type: "runtime.warning",
                payload: {
                  message:
                    stderr.trim() ||
                    `Antigravity CLI exited with code ${code ?? 1} after producing output.`,
                },
                raw: raw("stderr", { code, stderr }),
              } satisfies ProviderRuntimeEvent);
            }
            const resourcesCleaned = await cleanupTurnResources(false);
            settleActiveTurn(context, {
              state: settledState,
              stopReason: settledStopReason,
              claimant: "normal-close",
              ...(failed && !outputRecovered
                ? {
                    errorMessage: stderr.trim() || `Antigravity CLI exited with code ${code ?? 1}.`,
                  }
                : {}),
              raw: raw("process-exit", { code, signal, stdout, stderr }),
            });
            if (!resourcesCleaned) {
              quarantineExitedTurnCleanup(context, turnOwnership, "turn-settlement-cleanup");
            }
          })();
        });
        return {
          threadId: input.threadId,
          turnId,
          ...(context.conversationId ? { resumeCursor: context.conversationId } : {}),
        };
      });

    const interruptTurn: AntigravityAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (turnId !== undefined && turnId !== context.activeTurnId) {
          yield* Effect.logWarning("antigravity.stale_interrupt_ignored", {
            threadId,
            requestedTurnId: turnId,
            activeTurnId: context.activeTurnId,
          });
          return;
        }
        const activeTurnId = turnId ?? context.activeTurnId;
        if (context.recovery.phase === "teardown") {
          diagnose(
            "antigravity.duplicate_terminal_suppressed",
            recoveryFields(context, { settlementSource: "interrupt-after-watchdog" }),
          );
          return;
        }
        noteActivity(context, { invalidate: true, reason: "user-interrupt" });
        yield* Effect.all(
          [
            Effect.gen(function* () {
              context.interrupted = true;
              const hadProcess = context.activeProcess !== undefined;
              const ownership = captureOwnership(context);
              if (claimTerminal(context, "interrupt")) {
                const interruptStopIdle = context.stopIdle;
                if (interruptStopIdle?.timer !== undefined) clearTimeout(interruptStopIdle.timer);
                delete context.stopIdle;
              }
              if (hadProcess) {
                // Prefer process close for settlement so stdout/hooks still drain.
                // If teardown cannot prove exit, force-settle so Cancel never no-ops (#465).
                yield* teardownActiveProcess(context, "turn/interrupt").pipe(
                  Effect.catch((error) =>
                    Effect.gen(function* () {
                      const detail = "Antigravity interrupt cleanup could not be confirmed.";
                      yield* Effect.logWarning("antigravity.interrupt_teardown_failed", {
                        threadId,
                        detail,
                      });
                      if (ownership && ownsRecovery(context, ownership)) {
                        const record: QuarantineRecord = {
                          ownership,
                          runDir: ownership.runDir,
                          ...(ownership.gatewaySessionLease !== undefined
                            ? { gatewaySessionLease: ownership.gatewaySessionLease }
                            : {}),
                          stopRequested: false,
                          reapInFlight: false,
                          cleanupUnconfirmedDiagnostic: "antigravity.interrupt_cleanup_unconfirmed",
                          cleanupUnconfirmedReported: true,
                        };
                        context.quarantine = record;
                        const metadata = recoveryFields(context, {
                          teardownStage: "interrupt",
                          captureComplete:
                            error instanceof ProviderAdapterRequestError &&
                            error.cause instanceof ProviderProcessExitUnprovenError
                              ? error.cause.captureComplete
                              : false,
                          remainingDescendantCount:
                            error instanceof ProviderAdapterRequestError &&
                            error.cause instanceof ProviderProcessExitUnprovenError
                              ? (error.cause.remainingDescendantPids?.length ?? null)
                              : null,
                          settlementSource: "interrupt",
                        });
                        diagnose("antigravity.interrupt_cleanup_unconfirmed", metadata);
                        diagnose("antigravity.quarantine_entered", metadata);
                        settleActiveTurn(context, {
                          state: "interrupted",
                          stopReason: "interrupted",
                          claimant: "interrupt",
                          raw: raw("interrupt-quarantine", metadata),
                        });
                        context.session = {
                          ...context.session,
                          status: "error",
                          lastError:
                            "Antigravity interrupt cleanup is unconfirmed; new turns are blocked until cleanup succeeds.",
                          updatedAt: new Date().toISOString(),
                        };
                        offer({
                          ...base(context, { includeTurn: false }),
                          type: "session.state.changed",
                          payload: {
                            state: "error",
                            reason:
                              "Antigravity interrupt cleanup is unconfirmed; new turns are blocked until cleanup succeeds.",
                          },
                          raw: raw("interrupt-quarantine", metadata),
                        } satisfies ProviderRuntimeEvent);
                        scheduleQuarantineReap(context, record);
                        return;
                      }
                      if (ownership) {
                        diagnose(
                          "antigravity.stale_recovery_ignored",
                          recoveryFields(context, { settlementSource: "interrupt" }),
                        );
                        return;
                      }
                      settleActiveTurn(context, {
                        state: "interrupted",
                        stopReason: "interrupted",
                        claimant: "interrupt",
                        raw: raw("interrupt-teardown-failed", {
                          threadId,
                          turnId: activeTurnId,
                          lifecycleGeneration: context.lifecycleGeneration,
                          settlementSource: "interrupt",
                        }),
                      });
                    }),
                  ),
                );
              }
              if (ownership && !ownsRecovery(context, ownership) && !context.quarantine) {
                diagnose(
                  "antigravity.stale_recovery_ignored",
                  recoveryFields(context, { settlementSource: "interrupt-post-teardown" }),
                );
                return;
              }
              const cleanupFence =
                ownership && !context.quarantine
                  ? installExitedCleanupFence(
                      context,
                      ownership,
                      "antigravity.interrupt_cleanup_unconfirmed",
                    )
                  : undefined;
              if (ownership && !context.quarantine && !cleanupFence) return;
              // Process already gone (or never attached) but turn still open — Cancel
              // must still unlock the composer.
              if (!context.turnTerminalEmitted && context.activeTurnId !== undefined) {
                settleActiveTurn(context, {
                  state: "interrupted",
                  stopReason: "interrupted",
                  claimant: "interrupt",
                  raw: raw("interrupt-without-process", {
                    hadProcess,
                  }),
                });
              }
              if (cleanupFence) {
                yield* Effect.promise(() =>
                  cleanupSettledTurnResources(context, cleanupFence, "interrupt-cleanup"),
                );
              }
            }),
            cancelAgentGatewayTurn(context.gatewaySessionLease, activeTurnId),
          ] as const,
          { concurrency: "unbounded" },
        ).pipe(Effect.asVoid);
      });

    const unsupported = (threadId: ThreadId, method: string) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method,
          detail: `Antigravity CLI print mode does not expose interactive requests for ${threadId}.`,
        }),
      );

    const stopSession: AntigravityAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) return;
        context.stopRequested = true;
        context.admissionGeneration += 1;
        const existingClaimant = context.terminalClaimant;
        const stopOwnsTerminal =
          existingClaimant === undefined
            ? claimTerminal(context, "session-stop")
            : existingClaimant === "session-stop";

        if (!stopOwnsTerminal) {
          const existingQuarantine = context.quarantine;
          if (existingQuarantine) {
            existingQuarantine.stopRequested = true;
            if (existingQuarantine.retryTimer !== undefined) {
              clearTimeout(existingQuarantine.retryTimer);
              delete existingQuarantine.retryTimer;
            }
          }
          const settlement = context.terminalSettlement;
          if (settlement) yield* Effect.promise(() => settlement);
          if (sessions.get(threadId) !== context) return;
          context.stopped = true;
          context.interrupted = true;
          clearTurnScheduling(context);
          if (context.quarantine) {
            const record = context.quarantine;
            record.stopRequested = true;
            if (record.retryTimer !== undefined) {
              clearTimeout(record.retryTimer);
              delete record.retryTimer;
            }
            // The terminal claimant already owns process teardown. A losing
            // session Stop must not start a second teardown attempt; the
            // single managed close watcher will finish resource cleanup once
            // process exit is observed.
            if (record.exitObserved === true) {
              yield* Effect.promise(() => reapQuarantine(context, record, true));
            }
            return;
          }
          sessions.delete(threadId);
          offer({
            ...base(context, { includeTurn: false }),
            type: "session.exited",
            payload: { reason: "stopped", exitKind: "graceful" },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        const ownership = captureOwnership(context);
        const stoppedTurnId = context.activeTurnId;
        const stoppedLease = context.gatewaySessionLease;
        context.stopped = true;
        context.interrupted = true;
        setIneligible(context, "session-stop");
        clearTurnScheduling(context);
        if (context.preparationCleanupFence) {
          const fence = context.preparationCleanupFence;
          fence.stopRequested = true;
          if (fence.retryTimer !== undefined) {
            clearTimeout(fence.retryTimer);
            delete fence.retryTimer;
          }
          const cleaned = yield* Effect.promise(() =>
            cleanupPreparedTurnResources(
              context,
              fence.admissionGeneration,
              fence.runDir,
              fence.gatewaySessionLease,
            ),
          );
          if (!cleaned) return;
        }
        if (context.quarantine) {
          const record = context.quarantine;
          record.stopRequested = true;
          if (record.retryTimer !== undefined) {
            clearTimeout(record.retryTimer);
            delete record.retryTimer;
          }
          // Preserve the quarantine owner's single teardown attempt. Stop
          // suppresses retries and lets the close watcher perform the final
          // resource cleanup without re-signalling the process.
          if (record.exitObserved === true) {
            yield* Effect.promise(() => reapQuarantine(context, record, true));
          }
          return;
        }
        yield* cancelAgentGatewayTurn(stoppedLease, stoppedTurnId);
        if (sessions.get(threadId) !== context) return;

        let teardownFailure: unknown;
        if (context.terminalTeardown && ownership) {
          const outcome = yield* Effect.promise(() => context.terminalTeardown!);
          if (sessions.get(threadId) !== context) return;
          if (outcome.kind === "unproven") teardownFailure = outcome.cause;
        } else if (ownership) {
          yield* teardownActiveProcess(context, "session/stop").pipe(
            Effect.catch((cause) =>
              Effect.sync(() => {
                teardownFailure =
                  cause instanceof ProviderAdapterRequestError && cause.cause !== undefined
                    ? cause.cause
                    : cause;
              }),
            ),
          );
          if (sessions.get(threadId) !== context) return;
        }

        if (teardownFailure !== undefined && ownership) {
          quarantineStoppedProcess(context, ownership, teardownFailure);
          return;
        }
        if (ownership) {
          const cleaned = yield* Effect.promise(() =>
            cleanupOwnedTurnResources(context, stoppedLease, ownership.runDir),
          );
          if (!cleaned) {
            quarantineExitedTurnCleanup(context, ownership, "session-stop-cleanup", true);
            return;
          }
        } else {
          releaseTurnGatewayLease(context, stoppedLease);
        }
        if (sessions.get(threadId) !== context) return;
        sessions.delete(threadId);
        offer({
          ...base(context, { includeTurn: false }),
          type: "session.exited",
          payload: { reason: "stopped", exitKind: "graceful" },
        } satisfies ProviderRuntimeEvent);
      });

    const rollbackThread: AntigravityAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      requireSession(threadId).pipe(
        Effect.map((context) => {
          context.turns.splice(Math.max(0, context.turns.length - Math.max(0, numTurns)));
          // Antigravity has no rollback cursor; ProviderService will rebuild local context.
          delete context.conversationId;
          delete context.transcriptPath;
          delete context.processedTranscriptPath;
          context.processedTranscriptBytes = 0;
          context.processedSteps.clear();
          delete context.latestUserStepIndex;
          const { resumeCursor: _resumeCursor, ...sessionWithoutResume } = context.session;
          context.session = sessionWithoutResume;
          return snapshot(context);
        }),
      );

    const listModels: NonNullable<AntigravityAdapterShape["listModels"]> = (input) =>
      Effect.tryPromise({
        try: async () => {
          const result = await runAntigravityHelperProcess(
            trim(input.binaryPath) ?? "agy",
            ["models"],
            {
              ...(input.cwd ? { cwd: input.cwd } : {}),
              timeoutMs: MODEL_DISCOVERY_TIMEOUT_MS,
            },
          );
          if (result.code !== 0) throw new Error(result.stderr || "agy models failed");
          const models = parseModelLines(result.stdout);
          for (const model of models) {
            if (model.defaultReasoningEffort) {
              defaultEffortByModel.set(model.slug, model.defaultReasoningEffort);
            }
          }
          return {
            models,
            source: "antigravity.cli",
            cached: false,
          } satisfies ProviderListModelsResult;
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "model/list",
            detail: messageFromCause(cause, "Failed to list Antigravity models."),
            cause,
          }),
      });

    const stopAll = () =>
      Effect.forEach([...sessions.keys()], (threadId) => stopSession(threadId), {
        concurrency: "unbounded",
        discard: true,
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const context of sessions.values()) {
              if (context.quarantine?.retryTimer !== undefined) {
                clearTimeout(context.quarantine.retryTimer);
                delete context.quarantine.retryTimer;
              }
              if (context.preparationCleanupFence?.retryTimer !== undefined) {
                clearTimeout(context.preparationCleanupFence.retryTimer);
                delete context.preparationCleanupFence.retryTimer;
              }
              clearRecoveryTimer(context.recovery);
              if (context.pollTimer !== undefined) clearInterval(context.pollTimer);
            }
          }),
        ),
        Effect.asVoid,
      );

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.ignore,
        Effect.andThen(eventIngress.stop),
        Effect.andThen(Queue.shutdown(eventQueue)),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "restart-session",
        conversationRollback: "restart-session",
        supportsRuntimeModelList: true,
        supportsLiveTurnDiffPatch: false,
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest: (threadId) => unsupported(threadId, "request/respond"),
      respondToUserInput: (threadId) => unsupported(threadId, "user-input/respond"),
      stopSession,
      listSessions: () =>
        Effect.sync(() => [...sessions.values()].map((context) => context.session)),
      hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
      readThread: (threadId) => requireSession(threadId).pipe(Effect.map(snapshot)),
      rollbackThread,
      stopAll,
      listModels,
      getComposerCapabilities: () =>
        Effect.succeed({
          provider: PROVIDER,
          supportsSkillMentions: true,
          supportsSkillDiscovery: true,
          supportsNativeSlashCommandDiscovery: false,
          supportsPluginMentions: false,
          supportsPluginDiscovery: false,
          supportsRuntimeModelList: true,
          supportsThreadCompaction: false,
          supportsThreadImport: false,
        } satisfies ProviderComposerCapabilities),
      get streamEvents() {
        return Stream.fromQueue(eventQueue);
      },
    } satisfies AntigravityAdapterShape;
  });

export const AntigravityAdapterLive = Layer.effect(AntigravityAdapter, makeAntigravityAdapter());

export function makeAntigravityAdapterLive(dependencies: AntigravityAdapterDependencies = {}) {
  return Layer.effect(AntigravityAdapter, makeAntigravityAdapter(dependencies));
}
