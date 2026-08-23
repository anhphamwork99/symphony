import crypto from "node:crypto";
import path from "node:path";
import {
  spawn as spawnChildProcess,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

import type {
  BashOperations,
  InlineExtension,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  AgentSession as PiAgentSession,
  AgentSessionEvent,
  CreateAgentSessionRuntimeFactory,
  ExtensionUIContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import {
  ApprovalRequestId,
  type ChatAttachment,
  EventId,
  type McpAuthorityBinding,
  type ProviderComposerCapabilities,
  type ProviderListCommandsResult,
  type ProviderListModelsResult,
  type ProviderListSkillsResult,
  ProviderItemId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
  type UserInputQuestion,
} from "@synara/contracts";
import { Effect, FileSystem, Layer, Option, Queue, Stream } from "effect";

import { takeSynaraHarnessPolicyForProviderSession } from "../../agentGateway/harnessPolicy.ts";
import {
  callAgentGatewayMcpTool,
  initializeAgentGatewayMcp,
  listAgentGatewayMcpTools,
  type AgentGatewayMcpFetch,
  type AgentGatewayMcpToolDescriptor,
} from "../../agentGateway/mcpInjection.ts";
import {
  AgentGatewayCredentials,
  type AgentGatewayCredentialsShape,
  type AgentGatewayMcpConnection,
} from "../../agentGateway/Services/AgentGatewayCredentials.ts";
import { resolveProviderAttachmentPath } from "../providerAttachmentPaths.ts";
import {
  DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS,
  DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ,
  DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS,
  DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP,
  DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY,
  DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP,
  DEFAULT_PI_SUBAGENT_WALL_TIME_MS,
  ServerConfig,
} from "../../config.ts";
import { lazyModule } from "../../lazyModule.ts";
import { buildProviderChildEnvironment } from "../../providerChildEnvironment.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter.ts";
import {
  PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
  type ProviderDisableSynaraMcpResult,
  type ProviderEnableSynaraMcpResult,
  type ProviderThreadSnapshot,
} from "../Services/ProviderAdapter.ts";
import { appendFileAttachmentsPromptBlock } from "../attachmentProjection.ts";
import { makeBoundedCallbackIngress } from "../boundedCallbackIngress.ts";
import { classifyPiTurnFailure } from "../piTurnFailure.ts";
import {
  compactProviderRuntimeEventForIngress,
  isTerminalProviderRuntimeEvent,
  PROVIDER_RUNTIME_CALLBACK_BUFFER_MAX_BYTES,
  PROVIDER_RUNTIME_CALLBACK_TERMINAL_RESERVE,
  providerRuntimeEventBytes,
} from "../providerRuntimeEventIngress.ts";
import { clampUsagePercent, nonNegativeFiniteNumber, positiveFiniteNumber } from "../tokenUsage.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  makePiSynaraMcpDormantExtension,
  type PiSynaraMcpDormantAdapter,
} from "../piSynaraMcpExtension.ts";
import {
  makePiSynaraMcpDiagnostics,
  makePiSynaraMcpLifecycleCoordinator,
  type PiSynaraMcpActivationSeams,
  type PiSynaraMcpAuthorityValidation,
  type PiSynaraMcpCatalogValidation,
  type PiSynaraMcpDeactivationSeams,
  type PiSynaraMcpDiagnostics,
  type PiSynaraMcpLifecycleCoordinator,
  type PiSynaraMcpStagedActivation,
} from "../piSynaraMcpLifecycle.ts";
import { disablePiSynaraMcpSession } from "../piSynaraMcpDisable.ts";
import { captureCatalogObserverEnv, makePiCatalogObserver } from "../piCatalogObserver.ts";
import {
  evaluatePiSubagentDesktopArtifactGate,
  type PiSubagentDesktopArtifactGateResult,
} from "../piSubagentDesktopArtifactGate.ts";
import {
  negotiatePiSubagentDesktopManagedBridge,
  PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
  piSubagentDesktopManagedBootstrapFailureDetail,
  piSubagentDesktopManagedExtensionDir,
} from "../piSubagentManagedRuntimeBinding.ts";
import {
  enablePiSynaraMcpSession,
  PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
} from "../piSynaraMcpEnable.ts";
import {
  makePiSynaraMcpToolExecutionRegistry,
  type PiSynaraMcpToolExecutionRegistry,
} from "../piSynaraMcpToolExecution.ts";
import type {
  PiSubagentNegotiatedCapability,
  PiSubagentSpawnCommand,
  PiSubagentSpawnResult,
} from "@synara/contracts";
import {
  attachPiSubagentManagedForegroundBinding,
  dispatchPiSubagentTeardownOwnedProcesses,
  PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
  probePiSubagentBridge,
  type PiSubagentManagedForegroundBinding,
  type PiSubagentObservationInput,
} from "../piSubagentBridge.ts";
import {
  makePiSubagentProgressCoalescer,
  makeDefaultPiSubagentProgressSchedule,
  type PiSubagentProgressCoalescer,
} from "../piSubagentProgressCoalescer.ts";
import { ingestPiSubagentTerminal } from "../piSubagentTerminalCoordinator.ts";
import {
  makePiSubagentCompletionCoordinator,
  type PiSubagentCompletionCoordinator,
  type PiSubagentCompletionCoordinatorFollowUpEntry,
  projectCompletionFollowUpEntry,
} from "../piSubagentCompletionCoordinator.ts";
import {
  buildPiSubagentCompletionDispatchCommand,
  derivePiSubagentCompletionDispatchIdentity,
  serializePiSubagentCompletionDispatchCommand,
} from "../piSubagentCompletionDispatchIdentity.ts";
import { fingerprintOrchestrationCommand } from "../../orchestration/commandFingerprint.ts";
import type { PiSubagentParentEffectDispatcher } from "../piSubagentParentEffectDispatcher.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../../persistence/Services/PiSubagentExecutionRepository.ts";
import {
  admitSubagentSpawn,
  type AdmissionSnapshotQuery,
} from "../piSubagentAdmissionCoordinator.ts";
import {
  cancelParentTurnScope,
  cancelSinglePiSubagentExecution,
} from "../piSubagentCancellationCoordinator.ts";
import { resumePiSubagentExecution as resumePiSubagentExecutionCoordinator } from "../piSubagentResumeCoordinator.ts";
import { extractPiSubagentBridge, type PiSubagentExtensionBridge } from "../piSubagentBridge.ts";
import {
  makePiSubagentControlHealth,
  type PiSubagentControlHealthShape,
  type PiSubagentControlHealthTransition,
} from "../piSubagentControlHealth.ts";
import { startPiSubagentWallTimeSweep } from "../piSubagentWallTimeSweep.ts";
import { startPiSubagentWatchdogSweep } from "../piSubagentWatchdogSweep.ts";
import { startPiSubagentProcessTeardownSweep } from "../piSubagentProcessTeardownSweep.ts";
import {
  MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS,
  PI_SUBAGENT_TEARDOWN_PROVEN_DIAGNOSTIC,
  type PiSubagentOwnedTeardownDispatchResult,
} from "../piSubagentProcessTeardown.ts";
import { ProviderProcessExitUnprovenError } from "../supervisedProcessTeardown.ts";
import { makePiSubagentSafeCorrelation } from "../piSubagentTelemetrySafety.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { McpSessionAuthority } from "../../agentGateway/Services/McpSessionAuthority.ts";

import {
  teardownChildProcessTree,
  teardownProviderProcessTree,
} from "../supervisedProcessTeardown.ts";

const PROVIDER = "pi" as const;
const DEFAULT_PI_THINKING_LEVEL: ThinkingLevel = "medium";
const PI_THINKING_OPTIONS: ReadonlyArray<{
  readonly value: ThinkingLevel;
  readonly label: string;
  readonly description: string;
  readonly isDefault?: true;
}> = [
  { value: "off", label: "Off", description: "No extra reasoning" },
  { value: "minimal", label: "Minimal", description: "Light reasoning" },
  { value: "low", label: "Low", description: "Faster reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning", isDefault: true },
  { value: "high", label: "High", description: "Deeper reasoning" },
  { value: "xhigh", label: "Extra High", description: "Extra-high reasoning" },
  { value: "max", label: "Max", description: "Maximum reasoning" },
];
const PI_DEFAULT_SUPPORTED_THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
]);
const PI_ANTHROPIC_ENSURED_MODEL_IDS = ["claude-fable-5", "claude-opus-4-8"] as const;
type PiAnthropicEnsuredModelId = (typeof PI_ANTHROPIC_ENSURED_MODEL_IDS)[number];

/**
 * Metadata used when an OAuth/extension Anthropic catalog replaced Pi's built-ins
 * and omitted Fable / Opus 4.8. Values mirror `@earendil-works/pi-ai` Anthropic models.
 */
const PI_ANTHROPIC_ENSURED_MODEL_TEMPLATES: Record<
  PiAnthropicEnsuredModelId,
  {
    readonly id: PiAnthropicEnsuredModelId;
    readonly name: string;
    readonly reasoning: true;
    readonly thinkingLevelMap: NonNullable<Model<Api>["thinkingLevelMap"]>;
    readonly compat: NonNullable<Model<Api>["compat"]>;
    readonly input: Array<"text" | "image">;
    readonly cost: Model<Api>["cost"];
    readonly contextWindow: number;
    readonly maxTokens: number;
  }
> = {
  "claude-fable-5": {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    reasoning: true,
    thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
    compat: { forceAdaptiveThinking: true },
    input: ["text", "image"],
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    compat: { forceAdaptiveThinking: true, supportsTemperature: false },
    input: ["text", "image"],
    cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
};

type PiModelRegistry = Pick<ModelRegistry, "find" | "getAll" | "getAvailable">;
type PiCodingAgentModule = typeof import("@earendil-works/pi-coding-agent");
type PiAgentRuntime = Awaited<ReturnType<PiCodingAgentModule["createAgentSessionRuntime"]>>;
type PiShellConfig = ReturnType<PiCodingAgentModule["getShellConfig"]>;

interface PiActiveProcess {
  readonly child: ChildProcess;
  teardown: Promise<void> | undefined;
  teardownRequested: boolean;
  teardownProven: boolean;
}

export interface PiBashProcessSupervisor {
  readonly operations: BashOperations;
  readonly setShellPath: (shellPath: string | undefined) => void;
  readonly teardownAll: () => Promise<void>;
}

export interface PiBashProcessSupervisorOptions {
  readonly getShellConfig: (shellPath?: string) => PiShellConfig;
  readonly spawnProcess?: (
    command: string,
    args: ReadonlyArray<string>,
    options: SpawnOptions,
  ) => ChildProcess;
  readonly teardownProcessTree?: typeof teardownProviderProcessTree;
}

export function makePiBashProcessSupervisor(
  options: PiBashProcessSupervisorOptions,
): PiBashProcessSupervisor {
  const spawnProcess = options.spawnProcess ?? spawnChildProcess;
  const teardownProcessTree = options.teardownProcessTree ?? teardownProviderProcessTree;
  const activeProcesses = new Set<PiActiveProcess>();
  let configuredShellPath: string | undefined;

  const startTeardown = (active: PiActiveProcess): Promise<void> => {
    active.teardownRequested = true;
    active.teardown ??= teardownChildProcessTree(active.child, teardownProcessTree).then(
      () => {
        active.teardownProven = true;
      },
      (cause) => {
        active.teardown = undefined;
        throw cause;
      },
    );
    return active.teardown;
  };

  const operations: BashOperations = {
    exec: async (command, cwd, execution) => {
      if (execution.signal?.aborted) {
        throw new Error("aborted");
      }
      const timeoutMs = execution.timeout === undefined ? undefined : execution.timeout * 1_000;
      if (
        execution.timeout !== undefined &&
        (!Number.isFinite(execution.timeout) || execution.timeout <= 0)
      ) {
        throw new Error("Invalid timeout: must be a finite number of seconds");
      }
      if (timeoutMs !== undefined && timeoutMs > 2_147_483_647) {
        throw new Error(`Invalid timeout: maximum is ${String(2_147_483_647 / 1_000)} seconds`);
      }
      const shell = options.getShellConfig(configuredShellPath);
      const commandFromStdin = shell.commandTransport === "stdin";
      const child = spawnProcess(
        shell.shell,
        commandFromStdin ? shell.args : [...shell.args, command],
        {
          cwd,
          detached: process.platform !== "win32",
          env: buildProviderChildEnvironment({
            provider: "pi",
            baseEnv: execution.env ?? process.env,
          }),
          stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const active: PiActiveProcess = {
        child,
        teardown: undefined,
        teardownRequested: false,
        teardownProven: false,
      };
      activeProcesses.add(active);

      if (commandFromStdin) {
        child.stdin?.on("error", () => undefined);
        child.stdin?.end(command);
      }
      child.stdout?.on("data", (chunk: Buffer | string) =>
        execution.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      child.stderr?.on("data", (chunk: Buffer | string) =>
        execution.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );

      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const requestTeardown = () => {
        void startTeardown(active).catch(() => undefined);
      };
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          timedOut = true;
          requestTeardown();
        }, timeoutMs);
      }
      execution.signal?.addEventListener("abort", requestTeardown, { once: true });

      try {
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code) => resolve(code));
        });
        if (active.teardown) {
          await active.teardown;
        }
        if (execution.signal?.aborted) {
          throw new Error("aborted");
        }
        if (timedOut) {
          throw new Error(`timeout:${String(execution.timeout)}`);
        }
        return { exitCode };
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        execution.signal?.removeEventListener("abort", requestTeardown);
        if (!active.teardownRequested || active.teardownProven) {
          activeProcesses.delete(active);
        }
      }
    },
  };

  return {
    operations,
    setShellPath: (shellPath) => {
      configuredShellPath = shellPath;
    },
    teardownAll: async () => {
      const results = await Promise.allSettled(
        Array.from(activeProcesses, (active) => startTeardown(active)),
      );
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0) {
        throw new AggregateError(failures, "Failed to prove all Pi subprocess trees exited.");
      }
      for (const active of Array.from(activeProcesses)) {
        if (active.teardownProven) activeProcesses.delete(active);
      }
    },
  };
}

// Loads the Pi SDK only when the Pi provider is actually used. The SDK brings in
// a native clipboard module, so importing it during Synara startup can bloat the
// desktop backend before any Pi session exists.
const loadPiCodingAgentModule: () => Promise<PiCodingAgentModule> = lazyModule(
  () => import("@earendil-works/pi-coding-agent"),
);

interface PiSessionContext {
  harnessPolicyDelivered?: boolean;
  readonly gatewayControlAvailable: boolean;
  readonly synaraMcp: PiSynaraMcpDormantAdapter;
  readonly synaraMcpCoordinator: PiSynaraMcpLifecycleCoordinator;
  /** impl-07: Pi-local execution registry for Synara MCP tool calls. */
  readonly synaraMcpExecutions: PiSynaraMcpToolExecutionRegistry;
  /**
   * Decision 35: per-session current lifecycle generation for the
   * measurement-only observer's activated capture (the coordinator's
   * committed activation generation after reload). Only the observer reads
   * it; runtime events keep the outer session generation.
   */
  readonly observerCurrentLifecycleGeneration?: { current: string | undefined };
  readonly lifecycleGeneration?: string;
  runtime: PiAgentRuntime;
  readonly processSupervisor: PiBashProcessSupervisor;
  modelRegistry: PiModelRegistry;
  session: ProviderSession;
  turns: PiStoredTurn[];
  activeTurnId: TurnId | undefined;
  activeAssistantItemId: RuntimeItemId | undefined;
  activeReasoningItemId: RuntimeItemId | undefined;
  activeToolItems: Map<string, PiTrackedToolCall>;
  pendingUserInputs: Map<ApprovalRequestId, PiPendingUserInput>;
  stopped: boolean;
  subagentCapability?: PiSubagentNegotiatedCapability;
  subagentOwnedTeardownOwnerKey?: string | undefined;
  /**
   * Ticket 14: session-start subject authority binding (Decision 21). The
   * explicit resume path re-runs the shared admission gates, which
   * re-validate this binding live; absent fails closed at gate time.
   */
  mcpAuthority?: McpAuthorityBinding | null;
  lastKnownTokenUsage: ThreadTokenUsageSnapshot | undefined;
  /** Ticket 23: session-scoped progress observation coalescer, when managed. */
  subagentProgressCoalescer?: PiSubagentProgressCoalescer;
  /**
   * Ticket 14: captured managed Agent-tool launcher for explicit resume.
   * Present only when the session wrapped a managed Agent tool; resume
   * re-enters the SAME tool execute path with resumed identities after the
   * durable resume committed (never re-running admission — the shared gates
   * and the resume journal write already ran in the resume coordinator).
   */
  piSubagentResumeLauncher?: (attempt: {
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly agentType: string;
    readonly prompt: string;
    readonly mode: "foreground" | "background";
    /** Ticket 14: durable delegation triplet for exact-request replay. */
    readonly delegationContext?: string;
    readonly delegationLinkReferences?: string;
    readonly delegationExpectedOutcome?: string;
    /** Ticket 14: resolved `provider/modelId` for same-provider replay. */
    readonly resolvedModel?: string;
  }) => Promise<void>;

  unsubscribe: (() => void) | undefined;
}

export function makePiRuntimeEventBase(
  context: {
    readonly lifecycleGeneration?: string;
    readonly session: Pick<ProviderSession, "threadId">;
    readonly activeTurnId: TurnId | undefined;
  },
  options?: { readonly includeTurnId?: boolean },
) {
  return {
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    ...(context.lifecycleGeneration !== undefined
      ? { lifecycleGeneration: context.lifecycleGeneration }
      : {}),
    ...(options?.includeTurnId !== false && context.activeTurnId
      ? { turnId: context.activeTurnId }
      : {}),
  };
}

interface PiStoredTurn {
  readonly id: TurnId;
  readonly items: unknown[];
  leafId?: string | null;
}

interface PiTrackedToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly itemId: RuntimeItemId;
  readonly itemType: "command_execution" | "file_change" | "dynamic_tool_call" | "web_search";
}

interface PiSubagentOwnedTeardownOwnerRecord {
  readonly bridge: PiSubagentExtensionBridge;
  referenceCount: number;
  stopped: boolean;
}

const piSubagentOwnedTeardownExecutionKey = (input: {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
}) => `${input.executionId}\u0000${input.attemptId}\u0000${String(input.generation)}`;

interface PiPendingUserInput {
  readonly resolve: (answers: ProviderUserInputAnswers) => void;
}

const safeObserve = (run: () => void): void => {
  try {
    run();
  } catch {
    // The observer must never alter any lifecycle outcome; a throwing
    // observer (contract violation) is dropped entirely.
  }
};

function resolvePiExtensionUserInput(
  context: PiSessionContext,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
): boolean {
  const pending = context.pendingUserInputs.get(requestId);
  if (!pending) return false;
  pending.resolve(answers);
  return true;
}

function recordPiItem(context: PiSessionContext, item: unknown): void {
  const turn = context.activeTurnId
    ? context.turns.find((candidate) => candidate.id === context.activeTurnId)
    : context.turns.at(-1);
  turn?.items.push(item);
}

export interface PiUserInputOptionMapping {
  readonly value: string;
  readonly option: UserInputQuestion["options"][number];
}

export interface PiSynaraMcpSessionLifecycle {
  readonly threadId: ThreadId;
  readonly adapter: PiSynaraMcpDormantAdapter;
  /** The session's lifecycle coordinator; owns every Synara MCP transition. */
  readonly coordinator: PiSynaraMcpLifecycleCoordinator;
}

export interface PiAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly spawnProcess?: PiBashProcessSupervisorOptions["spawnProcess"];
  readonly teardownProcessTree?: typeof teardownProviderProcessTree;
  readonly agentGatewayFetch?: AgentGatewayMcpFetch;
  /** Extra extension factories installed into the session resource loader. */
  readonly extensionFactories?: readonly unknown[];
  readonly onSynaraMcpSession?: (lifecycle: PiSynaraMcpSessionLifecycle) => void;
  /** Called once subagent capability has been probed for a Pi session. */
  readonly onSubagentCapability?: (event: {
    readonly threadId: ThreadId;
    readonly capability: PiSubagentNegotiatedCapability;
    readonly session: PiAgentSession;
    readonly context: unknown;
  }) => void;
  readonly snapshotQuery?: AdmissionSnapshotQuery;
  readonly controlHealth?: PiSubagentControlHealthShape;
  readonly piSubagentRepository?: PiSubagentExecutionRepositoryShape;
  /**
   * Decision 0016: composition-owned late-bound parent-effect dispatcher
   * (constructed before the provider layer to avoid the OrchestrationEngine →
   * ProviderCommandReactor → ProviderService/PiAdapter cycle; bound exactly
   * once when the engine is live). Absent routes (tests / unthrift
   * composition) leave the coordinator in `unavailable` (no retry).
   */
  readonly completionDispatchBridge?: PiSubagentParentEffectDispatcher;
  readonly onSubagentAdmission?: (event: {
    readonly threadId: ThreadId;
    readonly command: PiSubagentSpawnCommand;
    readonly result: PiSubagentSpawnResult;
  }) => void;
  /**
   * Decision 35 measurement-only observer environment; defaults to the
   * process environment. Only the isolated measurement harness sets the
   * observer variables; absent configuration produces no observer at all,
   * so normal runs never enumerate, serialize, or write catalogs.
   */
  readonly catalogObserverEnv?: NodeJS.ProcessEnv;
  /**
   * Ticket 01 test seam: environment observed by the desktop managed-artifact
   * gate. Production captures the backend process environment.
   */
  readonly piSubagentDesktopArtifactGateEnv?: NodeJS.ProcessEnv;
  /**
   * Ticket 02 test seam: the user's normal Pi agent directory that supplies
   * the desktop managed runtime's EXPLICIT auth/model paths
   * (`<dir>/auth.json`, `<dir>/models.json`). Production leaves this
   * undefined so the Pi SDK's own `getAgentDir()` resolution supplies the
   * user's normal directory; extension discovery is NEVER pointed at it
   * (Decision 0003 — the controlled agentDir stays the verified artifact's
   * `agent` subtree).
   */
  readonly piSubagentDesktopUserAgentDir?: string;
  /**
   * Ticket 23 test seam: clock for the managed-progress server coalescer.
   * Production leaves this undefined (real timers); deterministic tests
   * inject a manually-driven virtual clock so saturation evidence never
   * depends on wall-clock timing.
   */
  readonly piSubagentProgressClock?: {
    readonly now: () => number;
    readonly schedule: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
  };
  /**
   * Ticket 13 test seam: wall-time sweep clock/scheduler. Production uses
   * the server clock and a 30-second periodic timer; deterministic tests
   * inject a manually-driven scheduler.
   */
  readonly piSubagentWallTimeClock?: {
    readonly now: () => number;
    readonly schedule: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
    readonly intervalMs?: number;
  };
  /**
   * Ticket 15 test seam: watchdog escalation clock/scheduler. Production
   * uses the server clock and a 30-second periodic timer (the same cadence
   * as the wall-time sweep); deterministic tests inject a manually-driven
   * scheduler.
   */
  readonly piSubagentWatchdogClock?: {
    readonly now: () => number;
    readonly schedule: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
    readonly intervalMs?: number;
  };
  /**
   * Ticket 16 test seam: owned process-tree teardown clock/scheduler.
   * Production uses the server clock and a 30-second periodic timer (the
   * same cadence as the watchdog sweep); deterministic tests inject a
   * manually-driven scheduler.
   */
  readonly piSubagentTeardownClock?: {
    readonly now: () => number;
    readonly schedule: (delayMs: number, callback: () => void) => { readonly cancel: () => void };
    readonly intervalMs?: number;
  };
  /**
   * Ticket 16 test seam: injectable owned-teardown resolver. Production
   * resolves the owning session's process supervisor (the only kill
   * authority); deterministic tests inject a controllable supervisor
   * fixture.
   */
  readonly piSubagentTeardownResolver?: (execution: {
    readonly executionId: string;
    readonly attemptId: string;
    readonly generation: number;
    readonly parentThreadId: string;
  }) => Promise<
    | { readonly kind: "proven" | "survivors"; readonly survivorPids?: ReadonlyArray<number> }
    | undefined
  >;
  /**
   * Decision 0033 review follow-up test seam: read-only snapshot of the
   * in-memory owned-teardown registry (stopped owner bridges plus their
   * retained execution mappings). The adapter registers the getter once at
   * build; production leaves this undefined, and the getter mutates
   * nothing. Deterministic tests use it to observe bounded retention —
   * ordinary durable terminals release their mapping, while cancelling /
   * teardown-eligible executions stay mapped until the post-band-76 proven
   * diagnostic — without any production behavior change.
   */
  readonly piSubagentOwnedTeardownRegistryObserver?: (
    getStats: () => {
      readonly ownerCount: number;
      readonly stoppedOwnerCount: number;
      readonly executionCount: number;
    },
  ) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function piGatewayToolResult(result: unknown): AgentToolResult<unknown> {
  if (isRecord(result) && result.isError === true) {
    const message = Array.isArray(result.content)
      ? result.content
          .flatMap((item) =>
            isRecord(item) && item.type === "text" && typeof item.text === "string"
              ? [item.text]
              : [],
          )
          .join("\n")
      : "";
    throw new Error(message || "Synara gateway tool failed.");
  }

  const content =
    isRecord(result) && Array.isArray(result.content)
      ? result.content.flatMap((item): Array<TextContent | ImageContent> => {
          if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
            return [{ type: "text", text: item.text }];
          }
          if (
            isRecord(item) &&
            item.type === "image" &&
            typeof item.data === "string" &&
            typeof item.mimeType === "string"
          ) {
            return [{ type: "image", data: item.data, mimeType: item.mimeType }];
          }
          return [];
        })
      : [];
  return {
    content:
      content.length > 0
        ? content
        : [{ type: "text", text: JSON.stringify(result ?? null) } satisfies TextContent],
    details: result,
  };
}

/**
 * Ticket 16 production boundary: `PiBashProcessSupervisor.teardownAll()`
 * aggregates failures from every active process tree. Preserve every safely
 * known survivor PID through nested AggregateErrors; unknown failures remain
 * honest uncertainty and never become proof of zero survivors.
 */
export const resolvePiSubagentOwnedTeardown = async (processSupervisor: {
  readonly teardownAll: () => Promise<void>;
}): Promise<PiSubagentOwnedTeardownDispatchResult> => {
  try {
    await processSupervisor.teardownAll();
    return { kind: "proven" };
  } catch (cause) {
    const pending: unknown[] = [cause];
    const visited = new Set<object>();
    const survivorPids = new Set<number>();

    while (pending.length > 0) {
      const current = pending.pop();
      if (typeof current === "object" && current !== null) {
        if (visited.has(current)) continue;
        visited.add(current);
      }
      if (current instanceof AggregateError) {
        pending.push(...current.errors);
        continue;
      }
      if (current instanceof ProviderProcessExitUnprovenError) {
        for (const pid of current.remainingDescendantPids ?? []) {
          if (Number.isSafeInteger(pid) && pid > 0) {
            survivorPids.add(pid);
          }
        }
      }
    }

    const boundedSurvivorPids = Array.from(survivorPids)
      .toSorted((left, right) => left - right)
      .slice(0, MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS);
    return {
      kind: "survivors",
      ...(boundedSurvivorPids.length > 0 ? { survivorPids: boundedSurvivorPids } : {}),
    };
  }
};

/**
 * Map an already-discovered canonical gateway catalog into Pi's native
 * custom-tool API. Tool schemas and execution both remain owned by the
 * gateway; Pi only adapts the provider boundary. Used by the activation
 * apply seam so the staged catalog is exposed atomically through the
 * extension reload boundary without a second discovery round-trip. When an
 * execution registry is supplied (impl-07), every execution is fenced and
 * settled through it so disable cancels the Pi-facing call exactly once.
 */
export function mapAgentGatewayMcpToolsToPiCustomTools(input: {
  readonly tools: ReadonlyArray<AgentGatewayMcpToolDescriptor>;
  readonly connection: AgentGatewayMcpConnection;
  readonly defineTool: (tool: ToolDefinition) => ToolDefinition;
  readonly fetch?: AgentGatewayMcpFetch;
  readonly executions?: PiSynaraMcpToolExecutionRegistry;
}): ReadonlyArray<ToolDefinition> {
  return input.tools.map((tool) =>
    input.defineTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as ToolDefinition["parameters"],
      execute: async (_toolCallId, params, signal) => {
        const call = (abortSignal?: AbortSignal) =>
          callAgentGatewayMcpTool({
            connection: input.connection,
            name: tool.name,
            arguments: params as Record<string, unknown>,
            ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
            ...(abortSignal === undefined ? {} : { signal: abortSignal }),
          });
        const result =
          input.executions === undefined
            ? await call(signal)
            : await input.executions.execute({
                call,
                ...(signal === undefined ? {} : { signal }),
              });
        return piGatewayToolResult(result);
      },
    }),
  );
}

/**
 * Project the canonical MCP catalog into Pi's native custom-tool API. Tool
 * schemas and execution both remain owned by the gateway; Pi only adapts the
 * provider boundary.
 */
export async function buildPiAgentGatewayCustomTools(input: {
  readonly connection: AgentGatewayMcpConnection;
  readonly defineTool: (tool: ToolDefinition) => ToolDefinition;
  readonly fetch?: AgentGatewayMcpFetch;
}): Promise<ReadonlyArray<ToolDefinition>> {
  const tools = await listAgentGatewayMcpTools({
    connection: input.connection,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  if (tools.length === 0) {
    throw new Error("Synara MCP returned an empty tool catalog.");
  }
  return mapAgentGatewayMcpToolsToPiCustomTools({
    tools,
    connection: input.connection,
    defineTool: input.defineTool,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
}

/**
 * Session-scoped inputs for {@link makePiSessionSynaraMcpCoordinator}. The
 * session's trusted authority is the server-minted subject-bound MCP binding
 * captured at session start (Decision 21); identity is never taken from an
 * activation request. Credentials are optional so activation fails closed at
 * the credential stage when the shared gateway layer is absent.
 */
export interface PiSessionSynaraMcpCoordinatorInput {
  readonly threadId: ThreadId;
  /** The session's dormant adapter; the coordinator owns its transitions. */
  readonly adapter: PiSynaraMcpDormantAdapter;
  /** Staged-tool registry bound to the session's dormant extension factory. */
  readonly stagedTools: ToolDefinition[];
  /**
   * impl-07 Pi-local execution registry; the apply seam routes every Synara
   * MCP tool execution through it so disable fences and settles them.
   */
  readonly executions: PiSynaraMcpToolExecutionRegistry;
  /** Live Pi session runtime; the apply seam reloads it at the safe boundary. */
  readonly runtime: { readonly session: { readonly reload: () => Promise<void> } };
  /** Trusted server-minted subject-bound MCP authority (Decision 21); absent fails closed. */
  readonly mcpAuthority: McpAuthorityBinding | null | undefined;
  /**
   * Shared gateway credentials; absent fails closed at the credential stage.
   * The optional verify/cancel/retire members (impl-07) drive the
   * session-scoped gateway registry cancellation and drain barrier; the
   * retire member tombstones the exact active turn's write authority before
   * cancellation (Decision 14 step 2).
   */
  readonly credentials?: Pick<
    AgentGatewayCredentialsShape,
    "connectionForThread" | "revokeSessionToken"
  > &
    Partial<
      Pick<
        AgentGatewayCredentialsShape,
        "verifySession" | "cancelInFlightRequests" | "retireSessionTurn"
      >
    >;
  readonly fetch?: AgentGatewayMcpFetch;
  /** Drain bound for the gateway cancellation barrier (default 2000ms). */
  readonly drainTimeoutMs?: number;
  /** Optional bounded diagnostics; a per-session default is created when omitted. */
  readonly diagnostics?: PiSynaraMcpDiagnostics;
  /**
   * Optional measurement-only observer notification (Decision 35): invoked
   * synchronously when the activation commit is proven at the safe boundary
   * (staged catalog applied and the Pi runtime reload completed), after the
   * execution admission generation reset. The caller receives the exact
   * committed activation lifecycle generation
   * (`staged.lifecycleGeneration` — minted fresh per activation at commit),
   * never the outer session-start generation. The caller binds its own
   * session context; the notification is a pure signal. Must not throw; the
   * observer itself never throws, and a throwing notification is absorbed by
   * the coordinator's commit path.
   */
  readonly onActivationCommitted?: (lifecycleGeneration: string) => void;
}

/**
 * Build the one lifecycle coordinator owned by a Pi session, wired to the
 * dormant extension's adapter and staged-tool registry with production
 * seams over the existing public authority/credential/catalog/reload
 * boundaries:
 *
 * - authority: the server-minted {@link McpAuthorityBinding} captured at
 *   session start, fail-closed when missing or expired (the live registry
 *   re-validates the binding at every gateway admission).
 * - credential: a fresh per-activation bearer minted through
 *   {@link AgentGatewayCredentialsShape.connectionForThread}, revoked by
 *   {@link AgentGatewayCredentialsShape.revokeSessionToken} on cleanup.
 * - connection/discovery: the canonical gateway JSON-RPC seam
 *   {@link listAgentGatewayMcpTools}.
 * - catalog: complete, validated before any exposure; empty or malformed
 *   catalogs are rejected.
 * - apply: the complete staged catalog is installed into the extension's
 *   staged-tool registry and the Pi runtime is reloaded at the safe
 *   boundary, so the extension factory registers exactly that set
 *   atomically; cleanup clears the registry so later loads register nothing.
 */
export function makePiSessionSynaraMcpCoordinator(
  input: PiSessionSynaraMcpCoordinatorInput,
): PiSynaraMcpLifecycleCoordinator {
  const { adapter, stagedTools, runtime, threadId } = input;
  const credentials = input.credentials;
  const mcpAuthority = input.mcpAuthority;

  const validateAuthority = async (): Promise<PiSynaraMcpAuthorityValidation> => {
    // Fail closed: without a server-minted binding no activation may start.
    // The snapshot was minted server-side at session establishment, so the
    // activation request supplies no identity here.
    if (mcpAuthority === undefined || mcpAuthority === null) {
      return {
        ok: false,
        reason: "No subject-bound MCP authority is bound to this Pi session.",
      };
    }
    const now = Date.now();
    if (mcpAuthority.authExpiresAt !== null && mcpAuthority.authExpiresAt <= now) {
      return { ok: false, reason: "The bound MCP authority authentication has expired." };
    }
    if (mcpAuthority.credentialExpiresAt <= now) {
      return { ok: false, reason: "The bound MCP authority credential has expired." };
    }
    return { ok: true, authority: mcpAuthority };
  };

  const issueCredential = async (staged: PiSynaraMcpStagedActivation) => {
    if (credentials === undefined) {
      throw new Error("Agent gateway credentials are unavailable for this Pi session.");
    }
    // Fresh identity-bound bearer minted for this activation attempt only.
    const authority = staged.authority as McpAuthorityBinding;
    return credentials.connectionForThread(threadId, PROVIDER, {
      ...authority,
      lifecycleGeneration: staged.lifecycleGeneration,
    });
  };

  const connect = async (staged: PiSynaraMcpStagedActivation) => {
    // The gateway connection is the stateless streamable-HTTP endpoint plus
    // the per-thread bearer; the credential stage already mints it, so
    // connecting stages and validates that minted connection.
    const connection = staged.credential;
    if (
      !isRecord(connection) ||
      typeof connection.url !== "string" ||
      typeof connection.bearerToken !== "string"
    ) {
      throw new Error("The staged Synara MCP connection is invalid.");
    }
    await initializeAgentGatewayMcp({
      connection: connection as unknown as AgentGatewayMcpConnection,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
    return connection;
  };

  const discover = async (staged: PiSynaraMcpStagedActivation) =>
    listAgentGatewayMcpTools({
      connection: staged.connection as AgentGatewayMcpConnection,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });

  const validateCatalog = async (catalog: unknown): Promise<PiSynaraMcpCatalogValidation> => {
    if (!Array.isArray(catalog) || catalog.length === 0) {
      return { ok: false, reason: "Synara MCP returned an empty tool catalog." };
    }
    for (const tool of catalog) {
      if (
        !isRecord(tool) ||
        typeof tool.name !== "string" ||
        typeof tool.description !== "string" ||
        !isRecord(tool.inputSchema)
      ) {
        return { ok: false, reason: "Synara MCP returned an invalid tool descriptor." };
      }
    }
    return { ok: true };
  };

  const applyAtSafeBoundary = async (staged: PiSynaraMcpStagedActivation) => {
    const tools = mapAgentGatewayMcpToolsToPiCustomTools({
      tools: staged.catalog as ReadonlyArray<AgentGatewayMcpToolDescriptor>,
      connection: staged.connection as AgentGatewayMcpConnection,
      defineTool: (tool) => tool,
      executions: input.executions,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
    // Install the complete catalog, then reload so the extension factory
    // registers exactly this set atomically at the safe boundary.
    stagedTools.splice(0, stagedTools.length, ...tools);
    await runtime.session.reload();
  };

  const cleanup = async (staged: PiSynaraMcpStagedActivation) => {
    // Discard the staged registration so no later load exposes Synara tools.
    // The credential is revoked here only after the disable orchestrator has
    // settled and drained the gateway (Decision 14 ordering); the runtime
    // reload that removes the live tool surface happens through the
    // deactivation reload seam at the safe boundary (or immediately for
    // activation rollback after the apply seam already ran).
    stagedTools.splice(0, stagedTools.length);
    const connection = staged.credential;
    if (isRecord(connection) && typeof connection.bearerToken === "string") {
      credentials?.revokeSessionToken(connection.bearerToken);
    }
  };

  const deactivation: PiSynaraMcpDeactivationSeams = {
    // Settle every in-flight Pi-facing execution exactly once with the
    // structured `synara_mcp_disabled` result (Decision 14 step 3).
    settleExecutions: () => input.executions.settleAll(),
    // Cancel and drain gateway-side in-flight requests through the shared
    // in-flight request registry, keyed by the session identity of the
    // retired credential (the gateway registry owns the cancellation and its
    // drain barrier; the coordinator bounds it with the 2s timeout). When the
    // exact active turn identity is known, retire that turn's write authority
    // synchronously first (Decision 14 step 2) so a racing request can never
    // bind this bearer to a later turn, and await the retirement barrier
    // inside the bounded drain before the session-wide cancellation.
    cancelGatewayRequests: async (staged, options) => {
      const connection = staged.credential;
      if (!isRecord(connection) || typeof connection.bearerToken !== "string") {
        return;
      }
      if (credentials === undefined) {
        return;
      }
      const identity = credentials.verifySession?.(connection.bearerToken) ?? null;
      if (identity === null) {
        return;
      }
      const turnId = options?.turnId;
      if (turnId !== undefined) {
        await credentials.retireSessionTurn?.(connection.bearerToken, turnId);
      }
      await credentials.cancelInFlightRequests?.({ sessionKey: identity.sessionKey }).settled;
    },
    ...(input.drainTimeoutMs === undefined ? {} : { drainTimeoutMs: input.drainTimeoutMs }),
    // Reload the runtime so the cleared staged-tool registry unregisters the
    // Synara surface; the coordinator defers this to the safe boundary when
    // a turn is active.
    reloadAtSafeBoundary: () => runtime.session.reload(),
  };

  const seams: PiSynaraMcpActivationSeams = {
    validateAuthority,
    issueCredential,
    connect,
    discover,
    validateCatalog,
    applyAtSafeBoundary,
    cleanup,
    // The fresh execution admission generation is installed only when the
    // activation is proven at the safe-boundary commit: a re-enabled session
    // admits mapped tool calls again, the retired generation stays fenced
    // forever with its own pending map (stale executions/callbacks can never
    // enter or mutate the fresh generation), and a fresh generation created
    // while a disable was queued starts fenced.
    onActivationCommitted: (staged, options) => {
      input.executions.resetForFreshActivation(options.fenceFreshAdmission);
      // Measurement-only observer notification (Decision 35): the activation
      // is proven and the reload completed at this point. The exact committed
      // activation lifecycle generation (staged.lifecycleGeneration) is
      // passed so the observer binds the capture to the committed generation
      // — never the outer session-start generation. The observer is
      // contractually non-throwing; a bug here is absorbed by the
      // coordinator's commit path and can never roll back the activation.
      input.onActivationCommitted?.(staged.lifecycleGeneration);
    },
  };
  return makePiSynaraMcpLifecycleCoordinator({
    adapter,
    seams,
    deactivation,
    diagnostics: input.diagnostics ?? makePiSynaraMcpDiagnostics(),
  });
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return fallback;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

const PI_SUBAGENT_PROGRESS_SUMMARY_MAX_LENGTH = 200;

/**
 * Ticket 23: bounded human-readable summary derived from the latest progress
 * snapshot JSON. Never echoes the raw payload (it can embed producer content);
 * a fixed-vocabulary field order keeps the emitted `tool.progress` summary
 * small and deterministic.
 */
function summarizePiSubagentProgressJson(progressJson: string): string {
  try {
    const parsed: unknown = JSON.parse(progressJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "Subagent progress";
    }
    const record = parsed as Record<string, unknown>;
    const parts: Array<string> = [];
    const status = record["status"];
    if (typeof status === "string" && status.trim().length > 0) {
      parts.push(status.trim());
    }
    const activity = record["activity"];
    if (typeof activity === "string" && activity.trim().length > 0) {
      parts.push(activity.trim());
    }
    const turnCount = record["turnCount"];
    const maxTurns = record["maxTurns"];
    if (typeof turnCount === "number" && Number.isFinite(turnCount)) {
      parts.push(
        `turn ${Math.trunc(turnCount)}${
          typeof maxTurns === "number" && Number.isFinite(maxTurns)
            ? `/${Math.trunc(maxTurns)}`
            : ""
        }`,
      );
    }
    const summary = parts.length > 0 ? `Subagent: ${parts.join(" · ")}` : "Subagent progress";
    return summary.length > PI_SUBAGENT_PROGRESS_SUMMARY_MAX_LENGTH
      ? `${summary.slice(0, PI_SUBAGENT_PROGRESS_SUMMARY_MAX_LENGTH - 1)}…`
      : summary;
  } catch {
    return "Subagent progress";
  }
}

function isPiThinkingLevel(value: string | null | undefined): value is ThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function normalizePiThinkingLevel(value: string | null | undefined): ThinkingLevel | undefined {
  return isPiThinkingLevel(value) ? value : undefined;
}

function getLocalSupportedThinkingLevels(
  model: Pick<Model<Api>, "reasoning" | "thinkingLevelMap">,
): Set<ThinkingLevel> {
  if (!model.reasoning) {
    return new Set();
  }

  const thinkingLevelMap = model.thinkingLevelMap;
  if (thinkingLevelMap && Object.keys(thinkingLevelMap).length > 0) {
    return new Set(
      PI_THINKING_OPTIONS.filter((option) => {
        const mapped = thinkingLevelMap[option.value as keyof typeof thinkingLevelMap];
        if (mapped === null) {
          return false;
        }
        return mapped !== undefined || PI_DEFAULT_SUPPORTED_THINKING_LEVELS.has(option.value);
      }).map((option) => option.value),
    );
  }

  return new Set(PI_DEFAULT_SUPPORTED_THINKING_LEVELS);
}

// Mirrors Pi SDK clamping so model discovery does not advertise levels that will be ignored.
export function getPiSupportedThinkingOptions(
  model: Pick<Model<Api>, "reasoning" | "thinkingLevelMap">,
): ReadonlyArray<(typeof PI_THINKING_OPTIONS)[number]> {
  if (!model.reasoning) {
    return [];
  }
  const supportedLevels = getLocalSupportedThinkingLevels(model);
  return PI_THINKING_OPTIONS.filter((option) => supportedLevels.has(option.value));
}

/**
 * When Anthropic is already authenticated, ensure Fable 5 and Opus 4.8 appear even
 * if an older pi-anthropic-oauth extension replaced the built-in Anthropic catalog.
 */
export function ensurePiAnthropicCatalogModels(
  available: ReadonlyArray<Model<Api>>,
  all: ReadonlyArray<Model<Api>> = available,
): Model<Api>[] {
  const hasAnthropic = available.some((model) => model.provider === "anthropic");
  if (!hasAnthropic) {
    return [...available];
  }

  const result = [...available];
  const peer = result.find((model) => model.provider === "anthropic");
  if (!peer) {
    return result;
  }

  for (const modelId of PI_ANTHROPIC_ENSURED_MODEL_IDS) {
    if (result.some((model) => model.provider === "anthropic" && model.id === modelId)) {
      continue;
    }
    const fromAll = all.find((model) => model.provider === "anthropic" && model.id === modelId);
    if (fromAll) {
      result.push(fromAll);
      continue;
    }
    const template = PI_ANTHROPIC_ENSURED_MODEL_TEMPLATES[modelId];
    result.push({
      ...peer,
      ...template,
      id: template.id,
      name: template.name,
      provider: "anthropic",
      api: peer.api,
      baseUrl: peer.baseUrl,
    });
  }

  return result;
}

export function getPiDiscoverableModels(
  registry: Pick<ModelRegistry, "getAvailable" | "getAll">,
): ReadonlyArray<Model<Api>> {
  return ensurePiAnthropicCatalogModels(registry.getAvailable(), registry.getAll());
}

/**
 * Pi extensions own their provider catalogs, so normalize their display metadata
 * before it crosses Synara's trimmed-string RPC contract. A single malformed
 * extension model must not make the complete Pi catalog unavailable.
 */
export function toPiProviderModelDescriptor(
  model: Model<Api>,
  getProviderDisplayName: (provider: string) => string,
): ProviderListModelsResult["models"][number] | null {
  const provider = trimToUndefined(model.provider);
  const modelId = trimToUndefined(model.id);
  if (!provider || !modelId || provider !== model.provider || modelId !== model.id) {
    return null;
  }

  const slug = `${provider}/${modelId}`;
  const supportedThinkingOptions = getPiSupportedThinkingOptions(model);
  return {
    slug,
    name: trimToUndefined(model.name) ?? slug,
    upstreamProviderId: provider,
    upstreamProviderName: trimToUndefined(getProviderDisplayName(model.provider)) ?? provider,
    ...(supportedThinkingOptions.length > 0
      ? {
          supportedReasoningEfforts: supportedThinkingOptions.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description,
          })),
          ...(supportedThinkingOptions.some((option) => option.value === DEFAULT_PI_THINKING_LEVEL)
            ? { defaultReasoningEffort: DEFAULT_PI_THINKING_LEVEL }
            : {}),
        }
      : {}),
  };
}

function isPiAnthropicEnsuredModelId(modelId: string): modelId is PiAnthropicEnsuredModelId {
  return (PI_ANTHROPIC_ENSURED_MODEL_IDS as ReadonlyArray<string>).includes(modelId);
}

function parseModelReference(
  modelId: string | null | undefined,
): { readonly provider?: string; readonly id: string } | undefined {
  const trimmed = trimToUndefined(modelId);
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("/")) {
    const [provider, ...rest] = trimmed.split("/");
    const id = rest.join("/");
    if (provider && id) {
      return { provider, id };
    }
  }
  if (trimmed.includes(":")) {
    const [provider, ...rest] = trimmed.split(":");
    const id = rest.join(":");
    if (provider && id) {
      return { provider, id };
    }
  }
  return { id: trimmed };
}

function createProviderModelFallback(
  registry: PiModelRegistry,
  parsed: { readonly provider: string; readonly id: string },
): Model<Api> | undefined {
  const providerDefault = registry.getAll().find((model) => model.provider === parsed.provider);
  if (!providerDefault) {
    return undefined;
  }
  if (parsed.provider === "anthropic" && isPiAnthropicEnsuredModelId(parsed.id)) {
    const template = PI_ANTHROPIC_ENSURED_MODEL_TEMPLATES[parsed.id];
    return {
      ...providerDefault,
      ...template,
      id: template.id,
      name: template.name,
      provider: "anthropic",
      api: providerDefault.api,
      baseUrl: providerDefault.baseUrl,
    };
  }
  return {
    id: parsed.id,
    name: parsed.id,
    api: providerDefault.api,
    provider: parsed.provider,
    baseUrl: providerDefault.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...(providerDefault.compat ? { compat: providerDefault.compat } : {}),
  };
}

function findModelInRegistry(
  registry: PiModelRegistry,
  modelId: string | null | undefined,
): Model<Api> | undefined {
  const parsed = parseModelReference(modelId);
  if (!parsed) {
    return undefined;
  }
  if (parsed.provider) {
    return (
      registry.find(parsed.provider, parsed.id) ??
      createProviderModelFallback(registry, { provider: parsed.provider, id: parsed.id })
    );
  }
  return registry
    .getAll()
    .find((model) => model.id === parsed.id || `${model.provider}/${model.id}` === parsed.id);
}

function extractResumeSessionFile(resumeCursor: unknown): string | undefined {
  if (typeof resumeCursor === "string" && resumeCursor.trim().length > 0) {
    return resumeCursor;
  }
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const record = resumeCursor as Record<string, unknown>;
  for (const key of ["sessionFile", "sessionFilePath", "nativeHandle", "path"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Ticket 09: bounded follow-up turn text for a completion batch. Each entry
 * carries the stable dedupe identity (the parent-effect key, Decision 0013
 * F4), the execution identity, the terminal state, and a bounded summary
 * excerpt — never unbounded raw output. The parent is told where full
 * results live (transcript reference / result tool).
 */
function formatPiSubagentCompletionFollowUp(
  parentThreadId: string,
  entries: readonly PiSubagentCompletionCoordinatorFollowUpEntry[],
): string {
  const lines = entries.map((entry, index) => {
    const label = entries.length > 1 ? `Subagent ${index + 1}` : "Subagent";
    const reference =
      entry.transcriptRef !== null ? `\nFull transcript: ${entry.transcriptRef}` : "";
    return `${label} finished (${entry.terminalState}) — execution ${entry.executionId}:\n${entry.summary}${reference}`;
  });
  const header =
    entries.length > 1
      ? `${entries.length} background subagents finished:`
      : "A background subagent finished:";
  return `${header}\n\n${lines.join("\n\n")}\n\nThe results above are bounded excerpts; full outputs remain retrievable by execution id.`;
}

function getSessionFile(session: PiAgentSession): string | undefined {
  return session.sessionFile ?? session.sessionManager.getSessionFile();
}

function makeSessionSnapshot(context: PiSessionContext): ProviderSession {
  const resumeCursor = getSessionFile(context.runtime.session);
  return {
    provider: PROVIDER,
    status: context.stopped ? "closed" : context.activeTurnId ? "running" : "ready",
    runtimeMode: context.session.runtimeMode,
    threadId: context.session.threadId,
    createdAt: context.session.createdAt,
    updatedAt: new Date().toISOString(),
    ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
    ...(context.session.model ? { model: context.session.model } : {}),
    ...(resumeCursor ? { resumeCursor } : {}),
    ...(context.activeTurnId ? { activeTurnId: context.activeTurnId } : {}),
    ...(context.session.lastError ? { lastError: context.session.lastError } : {}),
  };
}

function normalizeTokenUsage(
  stats: ReturnType<PiAgentSession["getSessionStats"]>,
  contextWindow?: number | null,
): ThreadTokenUsageSnapshot | undefined {
  const inputTokens = stats.tokens.input;
  const cachedInputTokens = stats.tokens.cacheRead;
  const outputTokens = stats.tokens.output;
  const totalProcessedTokens = stats.tokens.total;
  const contextUsage = stats.contextUsage;
  const contextUsageWindowValue = positiveFiniteNumber(contextUsage?.contextWindow);
  const contextUsageWindow =
    contextUsageWindowValue !== undefined ? Math.floor(contextUsageWindowValue) : undefined;
  const fallbackWindowValue = positiveFiniteNumber(contextWindow);
  const fallbackWindow =
    fallbackWindowValue !== undefined ? Math.floor(fallbackWindowValue) : undefined;
  const maxTokens = contextUsageWindow ?? fallbackWindow;
  const contextUsageTokenValue = nonNegativeFiniteNumber(contextUsage?.tokens);
  const contextUsageTokens =
    contextUsageTokenValue !== undefined ? Math.round(contextUsageTokenValue) : undefined;
  const usedPercent = clampUsagePercent(contextUsage?.percent);
  const usedTokensFromPercent =
    contextUsageTokens === undefined && usedPercent !== undefined && maxTokens !== undefined
      ? Math.round((usedPercent / 100) * maxTokens)
      : undefined;
  const usedTokens =
    contextUsageTokens ??
    usedTokensFromPercent ??
    (contextUsage
      ? 0
      : maxTokens !== undefined
        ? Math.min(totalProcessedTokens, maxTokens)
        : totalProcessedTokens);
  if (
    usedTokens <= 0 &&
    inputTokens <= 0 &&
    cachedInputTokens <= 0 &&
    outputTokens <= 0 &&
    maxTokens === undefined &&
    usedPercent === undefined
  ) {
    return undefined;
  }
  return {
    usedTokens,
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {}),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    lastUsedTokens: usedTokens,
    lastInputTokens: inputTokens,
    lastCachedInputTokens: cachedInputTokens,
    lastOutputTokens: outputTokens,
  };
}

function isPiReloadCommand(text: string): boolean {
  return /^\/reload(?:\s|$)/iu.test(text.trim());
}

function classifyPiRuntimeError(
  message: string,
): "provider_error" | "transport_error" | "permission_error" | "validation_error" | "unknown" {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("network") ||
    normalized.includes("connection") ||
    normalized.includes("timeout") ||
    normalized.includes("econn") ||
    normalized.includes("fetch failed")
  ) {
    return "transport_error";
  }
  if (
    normalized.includes("api key") ||
    normalized.includes("auth") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("permission")
  ) {
    return "permission_error";
  }
  if (
    normalized.includes("invalid") ||
    normalized.includes("validation") ||
    normalized.includes("not available")
  ) {
    return "validation_error";
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("usage limit") ||
    normalized.includes("overloaded") ||
    normalized.includes("provider")
  ) {
    return "provider_error";
  }
  return "unknown";
}

function runtimeErrorDetail(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...(cause.stack ? { stack: cause.stack } : {}),
    };
  }
  return cause;
}

function textFromContent(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

function toolRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstStringValue(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function textFromToolResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result;
  }
  const record = toolRecord(result);
  if (!record) {
    return undefined;
  }
  const directText = firstStringValue(record, [
    "output",
    "stdout",
    "stderr",
    "text",
    "summary",
    "message",
    "error",
  ]);
  if (directText) {
    return directText;
  }
  const content = Array.isArray(record.content) ? record.content : [];
  const parts = content.flatMap((block) => {
    const blockRecord = toolRecord(block);
    return blockRecord?.type === "text" && typeof blockRecord.text === "string"
      ? [blockRecord.text]
      : [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Normalize only the canonical detail string. Provider-native output remains
 * untouched in lifecycle data and raw event payloads for diagnostics.
 */
export function normalizePiToolDetail(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toolExitCode(result: unknown): number | null | undefined {
  const record = toolRecord(result);
  if (!record) return undefined;
  const exitCode = record.exitCode;
  if (typeof exitCode === "number" && Number.isFinite(exitCode)) return exitCode;
  const code = record.code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  return null;
}

function toolRawOutput(result: unknown): Record<string, unknown> | undefined {
  if (result === undefined) return undefined;
  const text = textFromToolResult(result);
  const exitCode = toolExitCode(result);
  if (typeof result === "string") {
    return { stdout: result, content: result };
  }
  if (result === null) {
    return {};
  }
  const record = toolRecord(result);
  if (!record) {
    return text ? { stdout: text, content: text } : undefined;
  }
  return {
    ...record,
    ...(text ? { stdout: text, content: text } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function toolPath(args: unknown): string | undefined {
  return firstStringValue(toolRecord(args), ["path", "filePath", "file", "relativePath"]);
}

function toolCommand(args: unknown): string | undefined {
  return firstStringValue(toolRecord(args), ["command", "cmd"]);
}

function toolSearchQuery(toolName: string, args: unknown): string | undefined {
  const record = toolRecord(args);
  if (!record) return undefined;
  if (toolName === "grep" || toolName === "find") {
    return firstStringValue(record, ["pattern", "query"]);
  }
  return firstStringValue(record, ["query", "pattern"]);
}

function toolEditEntries(args: unknown): ReadonlyArray<Record<string, unknown>> | undefined {
  const record = toolRecord(args);
  if (!record) return undefined;
  if (Array.isArray(record.edits)) {
    return record.edits.flatMap((edit) => {
      const editRecord = toolRecord(edit);
      return editRecord ? [editRecord] : [];
    });
  }
  const oldText = firstStringValue(record, ["oldText", "old_string", "oldString"]);
  const newText = firstStringValue(record, ["newText", "new_string", "newString"]);
  if (oldText !== undefined || newText !== undefined) {
    return [
      {
        ...(oldText !== undefined ? { oldText } : {}),
        ...(newText !== undefined ? { newText } : {}),
      },
    ];
  }
  return undefined;
}

function toolItemType(toolName: string): PiTrackedToolCall["itemType"] {
  switch (toolName) {
    case "bash":
      return "command_execution";
    case "edit":
    case "write":
      return "file_change";
    case "grep":
    case "find":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function toolTitle(toolName: string, args: unknown): string {
  const command = toolName === "bash" ? toolCommand(args) : undefined;
  if (command) return command;
  const filePath = toolPath(args);
  if (
    filePath &&
    (toolName === "read" || toolName === "edit" || toolName === "write" || toolName === "ls")
  ) {
    return `${toolName} ${filePath}`;
  }
  const query = toolSearchQuery(toolName, args);
  if (query && (toolName === "find" || toolName === "grep")) {
    return `${toolName} ${query}`;
  }
  return toolName;
}

function toolLifecycleData(input: {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
}): Record<string, unknown> {
  const { toolCallId, toolName, args } = input;
  const output = input.result ?? input.partialResult;
  const rawOutput = toolRawOutput(output);
  const path = toolPath(args);
  const query = toolSearchQuery(toolName, args);
  const command = toolCommand(args);
  const edits = toolEditEntries(args);
  const content = toolRecord(args)?.content;
  const outputDetails = toolRecord(rawOutput?.details);
  const unifiedDiff = firstStringValue(outputDetails, ["diff"]);
  const base: Record<string, unknown> = {
    toolCallId,
    callId: toolCallId,
    toolName,
    name: toolName,
    tool: toolName,
    kind: toolName,
    args,
    input: args,
    rawInput: args,
    ...(rawOutput ? { rawOutput } : {}),
    ...(input.partialResult !== undefined ? { partialResult: input.partialResult } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.isError !== undefined ? { isError: input.isError } : {}),
  };

  switch (toolName) {
    case "bash":
      return {
        ...base,
        kind: "execute",
        ...(command ? { command } : {}),
        ...(rawOutput?.exitCode !== undefined ? { exitCode: rawOutput.exitCode } : {}),
      };
    case "read":
      return {
        ...base,
        kind: "read",
        ...(path
          ? {
              path,
              filePath: path,
              files: [{ path }],
              commandActions: [{ type: "read", name: "read", path }],
            }
          : {}),
      };
    case "edit":
      return {
        ...base,
        kind: "edit",
        ...(path ? { path, filePath: path, files: [{ path }], changes: [{ path }] } : {}),
        ...(edits
          ? {
              edits: edits.map((edit) =>
                path === undefined ? Object.assign({}, edit) : Object.assign({}, edit, { path }),
              ),
            }
          : {}),
        ...(unifiedDiff ? { unifiedDiff } : {}),
      };
    case "write":
      return {
        ...base,
        kind: "write",
        ...(path ? { path, filePath: path, files: [{ path }], changes: [{ path }] } : {}),
        ...(typeof content === "string" ? { content } : {}),
      };
    case "find":
      return {
        ...base,
        kind: "search",
        searchKind: "find",
        ...(query ? { query } : {}),
        ...(path ? { path } : {}),
        ...(query || path
          ? { commandActions: [{ type: "search", name: "find", query, path }] }
          : {}),
      };
    case "grep":
      return {
        ...base,
        kind: "search",
        searchKind: "grep",
        ...(query ? { query } : {}),
        ...(path ? { path } : {}),
        ...(query || path
          ? { commandActions: [{ type: "search", name: "grep", query, path }] }
          : {}),
      };
    case "ls":
      return {
        ...base,
        kind: "listFiles",
        ...(path
          ? {
              path,
              query: path,
              commandActions: [{ type: "listFiles", name: "ls", path }],
            }
          : {}),
      };
    default:
      return base;
  }
}

export function mapPiToolLifecyclePayload(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly result?: unknown;
  readonly partialResult?: unknown;
  readonly isError?: boolean;
}): {
  readonly detail?: string;
  readonly data: Record<string, unknown>;
} {
  const output = input.result ?? input.partialResult;
  const detail = normalizePiToolDetail(textFromToolResult(output));
  return {
    ...(detail === undefined ? {} : { detail }),
    data: toolLifecycleData(input),
  };
}

function mapMessageHistory(session: PiAgentSession): unknown[] {
  const items: unknown[] = [];
  const pendingTools = new Map<string, { toolName: string; args: unknown }>();
  for (const message of session.messages) {
    if (message.role === "user") {
      const text = textFromContent(message.content);
      if (text) items.push({ type: "user_message", text });
      continue;
    }
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "text" && content.text) {
          items.push({ type: "assistant_message", text: content.text });
          continue;
        }
        if (content.type === "thinking" && content.thinking) {
          items.push({ type: "reasoning", text: content.thinking });
          continue;
        }
        if (content.type === "toolCall") {
          pendingTools.set(content.id, { toolName: content.name, args: content.arguments });
          items.push({
            type: "tool_call",
            status: "started",
            callId: content.id,
            toolName: content.name,
            itemType: toolItemType(content.name),
            title: toolTitle(content.name, content.arguments),
            args: content.arguments,
            data: toolLifecycleData({
              toolCallId: content.id,
              toolName: content.name,
              args: content.arguments,
            }),
          });
        }
      }
      continue;
    }
    if (message.role === "toolResult") {
      const pending = pendingTools.get(message.toolCallId);
      pendingTools.delete(message.toolCallId);
      const toolName = pending?.toolName ?? message.toolName;
      const args = pending?.args;
      const result = { content: message.content };
      items.push({
        type: "tool_call",
        status: message.isError ? "failed" : "completed",
        callId: message.toolCallId,
        toolName,
        itemType: toolItemType(toolName),
        title: toolTitle(toolName, args),
        output: textFromContent(message.content),
        isError: message.isError,
        data: toolLifecycleData({
          toolCallId: message.toolCallId,
          toolName,
          args,
          result,
          isError: message.isError,
        }),
      });
    }
  }
  return items;
}

function makeAgentDir(
  agentDir: string | undefined,
  piSdk: Pick<PiCodingAgentModule, "getAgentDir">,
): string {
  return trimToUndefined(agentDir) ?? piSdk.getAgentDir();
}

// Keep session runtimes isolated so project extension provider registrations
// cannot leak between threads that share an agent directory.
export async function createPiModelRuntime(
  agentDir: string,
  piSdk: Pick<PiCodingAgentModule, "ModelRuntime">,
): Promise<ModelRuntime> {
  return piSdk.ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
}

function modelRegistryFacade(
  modelRuntime: ModelRuntime,
  piSdk: Pick<PiCodingAgentModule, "ModelRegistry">,
): ModelRegistry {
  return new piSdk.ModelRegistry(modelRuntime);
}

function extensionDisplayName(extension: {
  readonly path: string;
  readonly sourceInfo?: { readonly source?: string };
}): string {
  const source = trimToUndefined(extension.sourceInfo?.source);
  if (source) return source;
  const extensionPath = trimToUndefined(extension.path);
  return extensionPath ? path.basename(extensionPath).replace(/\.(?:ts|js)$/u, "") : "extension";
}

function makePiUserInputOption(label: string): UserInputQuestion["options"][number] {
  const normalizedLabel = trimToUndefined(label) ?? "Option";
  return { label: normalizedLabel, description: normalizedLabel };
}

export function makePiUserInputOptions(
  labels: ReadonlyArray<string>,
): ReadonlyArray<PiUserInputOptionMapping> {
  const labelCounts = new Map<string, number>();
  return labels.map((label, index) => {
    const baseLabel = trimToUndefined(label) ?? `Option ${index + 1}`;
    const count = (labelCounts.get(baseLabel) ?? 0) + 1;
    labelCounts.set(baseLabel, count);
    const displayLabel = count === 1 ? baseLabel : `${baseLabel} (${count})`;
    return {
      value: label,
      option: { label: displayLabel, description: baseLabel },
    };
  });
}

function firstPiUserInputAnswer(
  answers: ProviderUserInputAnswers,
  questionId: string,
): string | undefined {
  const answer = answers[questionId];
  if (typeof answer === "string") {
    return trimToUndefined(answer);
  }
  if (Array.isArray(answer)) {
    return trimToUndefined(answer.find((entry) => typeof entry === "string"));
  }
  return undefined;
}

export const PLAIN_PI_EXTENSION_THEME = {
  fg(_color: string, text: string) {
    return text;
  },
  bg(_color: string, text: string) {
    return text;
  },
  bold(text: string) {
    return text;
  },
  italic(text: string) {
    return text;
  },
  underline(text: string) {
    return text;
  },
  inverse(text: string) {
    return text;
  },
  strikethrough(text: string) {
    return text;
  },
  getFgAnsi() {
    return "";
  },
  getBgAnsi() {
    return "";
  },
  getColorMode() {
    return "truecolor";
  },
  getThinkingBorderColor() {
    return (text: string) => text;
  },
  getBashModeBorderColor() {
    return (text: string) => text;
  },
} as unknown as ExtensionUIContext["theme"];

const makePiAdapter = (options?: PiAdapterLiveOptions) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    // Decision 35 measurement-only observer. Absent in normal runs: only the
    // isolated harness child server sets the observer environment, and the
    // observer is a non-throwing no-op when it cannot be built. The observer
    // configuration is captured exactly once here and then scrubbed from the
    // process environment, so no unrelated child/tool process spawned later
    // (Pi bash tools, gateway helpers, …) can inherit the measurement
    // configuration (Decision 35 confinement); the scrub runs even when the
    // observer is absent or disabled so inherited observer variables never
    // leak into unrelated children.
    const catalogObserver = makePiCatalogObserver(
      captureCatalogObserverEnv(options?.catalogObserverEnv ?? process.env),
    );
    // Optional so adapter tests can run without the gateway layer; when
    // present, activation mints per-attempt Synara MCP credentials through it.
    const agentGatewayCredentials = Option.getOrUndefined(
      yield* Effect.serviceOption(AgentGatewayCredentials),
    );
    const injectedPiSubagentRepository = options?.piSubagentRepository;
    const piSubagentRepository =
      injectedPiSubagentRepository ??
      Option.getOrUndefined(yield* Effect.serviceOption(PiSubagentExecutionRepository));
    // Ticket 21: ONE adapter-lifetime managed control-health controller is
    // shared by every Pi session in this adapter. It is auto-created here so
    // production always fail-closes managed admissions when durable
    // lifecycle writes become unavailable; `options.controlHealth` remains
    // the explicit test override. The controller is deliberately NOT a
    // service: its lifetime is the adapter, and degradation/recovery of the
    // durable store is a property of this adapter's persistence path, shared
    // across all managed sessions.
    const adapterControlHealth = options?.controlHealth ?? (yield* makePiSubagentControlHealth());
    // Decision 21 live authority registry. The PiAdapter captures the service
    // so the admission boundary can re-validate the server-minted binding at
    // spawn time (assertAdmittable against server truth). Absent (tests or a
    // graph without the gateway layer), admission fails closed when a binding
    // exists.
    const mcpSessionAuthority = Option.getOrUndefined(
      yield* Effect.serviceOption(McpSessionAuthority),
    );
    // Genuine server read service (projection snapshot) resolved once at
    // adapter build, or the injected test seam. The admission boundary never
    // fabricates a snapshot from extension params.
    const adapterSnapshotQuery =
      options?.snapshotQuery ??
      Option.getOrUndefined(yield* Effect.serviceOption(ProjectionSnapshotQuery));
    const runtimeEventQueue = yield* Queue.bounded<ProviderRuntimeEvent>(
      PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
    );
    const sessions = new Map<ThreadId, PiSessionContext>();
    const piSubagentOwnedTeardownOwners = new Map<string, PiSubagentOwnedTeardownOwnerRecord>();
    const piSubagentOwnedTeardownExecutions = new Map<string, { readonly ownerKey: string }>();

    const releasePiSubagentOwnedTeardownExecution = (input: {
      readonly executionId: string;
      readonly attemptId: string;
      readonly generation: number;
    }) => {
      const executionKey = piSubagentOwnedTeardownExecutionKey(input);
      const ownedExecution = piSubagentOwnedTeardownExecutions.get(executionKey);
      if (ownedExecution === undefined) {
        return;
      }
      piSubagentOwnedTeardownExecutions.delete(executionKey);
      const owner = piSubagentOwnedTeardownOwners.get(ownedExecution.ownerKey);
      if (owner === undefined) {
        return;
      }
      owner.referenceCount = Math.max(0, owner.referenceCount - 1);
      if (owner.stopped && owner.referenceCount === 0) {
        piSubagentOwnedTeardownOwners.delete(ownedExecution.ownerKey);
      }
    };

    const registerPiSubagentOwnedTeardownOwner = (context: PiSessionContext) => {
      context.subagentOwnedTeardownOwnerKey = undefined;
      if (
        context.subagentCapability?.isManaged !== true ||
        context.subagentCapability.capabilities?.includes(
          PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
        ) !== true
      ) {
        return;
      }
      const bridge = extractPiSubagentBridge(context.runtime.session);
      // Decision 0033 §6 fail-closed guard: the capability may be cached on
      // the session while the live bridge (or its child-owner endpoint) is
      // absent — a mixed-version or mid-lifecycle extension. Both absences
      // return with NO owner registered, so no execution ever binds an
      // owner record and the teardown sweep resolves `undefined` for it:
      // the honest non-terminal band-78 owner-unproven path with no band
      // 76, no cancelled settlement, and no generation fence.
      if (bridge === undefined || typeof bridge.teardownOwnedProcesses !== "function") {
        return;
      }
      const ownerKey = crypto.randomUUID();
      piSubagentOwnedTeardownOwners.set(ownerKey, {
        bridge,
        referenceCount: 0,
        stopped: false,
      });
      context.subagentOwnedTeardownOwnerKey = ownerKey;
    };

    const registerPiSubagentOwnedTeardownExecution = (
      context: PiSessionContext,
      input: {
        readonly executionId: string;
        readonly attemptId: string;
        readonly generation: number;
      },
    ) => {
      const ownerKey = context.subagentOwnedTeardownOwnerKey;
      if (ownerKey === undefined) {
        return;
      }
      const owner = piSubagentOwnedTeardownOwners.get(ownerKey);
      if (owner === undefined) {
        context.subagentOwnedTeardownOwnerKey = undefined;
        return;
      }
      const executionKey = piSubagentOwnedTeardownExecutionKey(input);
      const existing = piSubagentOwnedTeardownExecutions.get(executionKey);
      if (existing?.ownerKey === ownerKey) {
        return;
      }
      if (existing !== undefined) {
        releasePiSubagentOwnedTeardownExecution(input);
      }
      piSubagentOwnedTeardownExecutions.set(executionKey, { ownerKey });
      owner.referenceCount += 1;
    };

    const markPiSubagentOwnedTeardownOwnerStopped = (context: PiSessionContext) => {
      const ownerKey = context.subagentOwnedTeardownOwnerKey;
      if (ownerKey === undefined) {
        return;
      }
      const owner = piSubagentOwnedTeardownOwners.get(ownerKey);
      if (owner === undefined) {
        context.subagentOwnedTeardownOwnerKey = undefined;
        return;
      }
      owner.stopped = true;
      if (owner.referenceCount === 0) {
        piSubagentOwnedTeardownOwners.delete(ownerKey);
      }
    };

    // Decision 0033 review follow-up test seam (read-only): see the option
    // docs above. Registered once so the getter always observes the live
    // adapter-lifetime maps.
    options?.piSubagentOwnedTeardownRegistryObserver?.(() => ({
      ownerCount: piSubagentOwnedTeardownOwners.size,
      stoppedOwnerCount: Array.from(piSubagentOwnedTeardownOwners.values()).filter(
        (owner) => owner.stopped,
      ).length,
      executionCount: piSubagentOwnedTeardownExecutions.size,
    }));
    // Decision 0016: adapter-lifetime per-thread completion coordinator — the
    // production consumer of the Ticket 08 durable outbox (Decision 0013 F3).
    // One coordinator spans every managed Pi session of this adapter;
    // per-thread state is keyed by parentThreadId. The coordinator dispatches
    // the batch's frozen deterministic internal `thread.turn.start` command
    // through the narrow parent-effect dispatcher port; the parent effect is
    // accepted exactly when the OrchestrationEngine commits a
    // fingerprint-matched accepted receipt. The coordinator NEVER calls Pi
    // `session.prompt` directly. It is created only when a repository exists
    // (same condition as the managed terminal path). The composition-owned
    // bridge may be absent (tests / simplified composition): the coordinator
    // then reports dispatch `unavailable` and consumes no retry budget.
    const completionBridge = options?.completionDispatchBridge;
    // Threads whose live managed session advertises completion-delivery
    // ownership — the bounded recovery-scan eligibility set. Never synthesized:
    // absent lazy sessions are not failure (Decision 0016 §5).
    const coordinatorEligibleThreads = new Set<string>();
    const coordinatorRecoveryScanActive = {
      timer: undefined as ReturnType<typeof setInterval> | undefined,
    };
    const triggerCoordinatorRecoveryScans = () => {
      if (piSubagentCompletionCoordinator === undefined || coordinatorEligibleThreads.size === 0) {
        return;
      }
      piSubagentCompletionCoordinator.triggerScan([...coordinatorEligibleThreads]);
    };
    const piSubagentCompletionCoordinator: PiSubagentCompletionCoordinator | undefined =
      piSubagentRepository === undefined
        ? undefined
        : makePiSubagentCompletionCoordinator({
            get repository() {
              // The repository is adapter-lifetime and was present at
              // construction; the getter keeps the lazy test-binding seam.
              if (piSubagentRepository === undefined) {
                throw new Error("piSubagentCompletionCoordinator: repository unavailable");
              }
              return piSubagentRepository;
            },
            batchWindowMs:
              serverConfig.piSubagentCompletionBatchWindowMs ??
              DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS,
            retryLimit: serverConfig.piSubagentCompletionRetryLimit,
            maxBatchEntries: serverConfig.piSubagentCompletionMaxBatchEntries,
            isParentBusy: (parentThreadId) => {
              const context = sessions.get(parentThreadId as ThreadId);
              return context?.activeTurnId !== undefined;
            },
            parentSessionAvailable: (parentThreadId) => {
              const context = sessions.get(parentThreadId as ThreadId);
              return context !== undefined && !context.stopped;
            },
            parentEffectDispatcher: completionBridge,
            buildBatchContent: ({ parentThreadId, members, createdAt }) => {
              const context = sessions.get(parentThreadId as ThreadId);
              if (context === undefined || context.stopped) {
                throw new Error(
                  `completion batch content: parent session for thread '${parentThreadId}' is unavailable`,
                );
              }
              // Freeze the complete fingerprint-bearing command at batch
              // creation: timestamp, dispatch mode (queue), origin (agent),
              // runtime/interaction/assistant-delivery modes, deterministic
              // message id, parent thread, and the bounded parent message
              // including the CURRENT harness-policy header (Decision 0016 §3,
              // accepted implementation choice). Retry submits the STORED
              // content byte-for-byte — never rebuilt from session/config/times.
              const harnessPolicy = takeSynaraHarnessPolicyForProviderSession(context, {
                provider: PROVIDER,
                scopedGatewayConnectionAvailable: context.gatewayControlAvailable,
              });
              const entries = members.map((entry) => projectCompletionFollowUpEntry(entry));
              const parentMessageText = [
                harnessPolicy,
                formatPiSubagentCompletionFollowUp(parentThreadId, entries),
              ]
                .filter(Boolean)
                .join("\n\n");
              const outboxIds = members.map((member) => member.outboxId);
              const identity = derivePiSubagentCompletionDispatchIdentity({
                parentThreadId,
                outboxIds,
              });
              const command = buildPiSubagentCompletionDispatchCommand({
                identity,
                commandInput: {
                  parentThreadId,
                  parentMessageText,
                  runtimeMode: context.session.runtimeMode,
                  interactionMode: "default",
                  assistantDeliveryMode: "buffered",
                  createdAt,
                },
              });
              const fingerprint = fingerprintOrchestrationCommand(command);
              return {
                batchId: identity.batchId,
                parentCommandId: identity.parentCommandId,
                parentMessageId: identity.parentMessageId,
                fingerprintVersion: fingerprint.version,
                commandFingerprint: fingerprint.value,
                membership: outboxIds,
                parentMessageText,
                commandPayloadJson: serializePiSubagentCompletionDispatchCommand(command),
              };
            },
            onDiagnostic: (event) => {
              const context = sessions.get(event.parentThreadId as ThreadId);
              if (context === undefined) {
                return;
              }
              offerRuntimeEvent({
                ...makeEventBase(context),
                type: "runtime.warning",
                payload: {
                  message: `Pi subagent completion delivery [${event.diagnosticCode}]: ${event.diagnosticMessage}`,
                  detail: {
                    diagnosticCode: event.diagnosticCode,
                    ...(event.executionId !== undefined ? { executionId: event.executionId } : {}),
                    ...(event.batchId !== undefined ? { batchId: event.batchId } : {}),
                  },
                },
                raw: {
                  source: "pi.sdk.event",
                  method: "subagents/completion-delivery-diagnostic",
                  payload: {
                    diagnosticCode: event.diagnosticCode,
                    ...(event.executionId !== undefined ? { executionId: event.executionId } : {}),
                    ...(event.batchId !== undefined ? { batchId: event.batchId } : {}),
                  },
                },
              } satisfies ProviderRuntimeEvent);
            },
          });
    // Decision 0016 §5/§9: binding the bridge fires a recovery scan for the
    // hydrated managed parents. The adapter subscribes at construction; the
    // single bind in main.ts triggers recovery without needing a new terminal.
    if (piSubagentCompletionCoordinator !== undefined && completionBridge !== undefined) {
      completionBridge.onBound(() => {
        triggerCoordinatorRecoveryScans();
      });
    }
    // Decision 0016 §5: a bounded ongoing Ticket 09 scan while eligible managed
    // sessions exist. It never synthesizes sessions — only the threads whose
    // sessions currently advertise the ownership capability are scanned.
    if (piSubagentCompletionCoordinator !== undefined) {
      coordinatorRecoveryScanActive.timer = setInterval(
        () => triggerCoordinatorRecoveryScans(),
        10_000,
      );
      coordinatorRecoveryScanActive.timer.unref?.();
    }
    const ownsNativeEventLogger = options?.nativeEventLogger === undefined;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const runtimeEventIngress = yield* makeBoundedCallbackIngress<
      ProviderRuntimeEvent,
      never,
      never
    >(
      (event) =>
        (nativeEventLogger && event.raw
          ? nativeEventLogger.write(event.raw, event.threadId).pipe(Effect.ignore)
          : Effect.void
        ).pipe(Effect.andThen(Queue.offer(runtimeEventQueue, event)), Effect.asVoid),
      {
        capacity: PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
        maxBufferedBytes: PROVIDER_RUNTIME_CALLBACK_BUFFER_MAX_BYTES,
        terminalReserve: PROVIDER_RUNTIME_CALLBACK_TERMINAL_RESERVE,
        isTerminal: isTerminalProviderRuntimeEvent,
        sizeOf: providerRuntimeEventBytes,
      },
    );

    const toDesktopGateUnavailableError = (
      method: string,
      result: Extract<PiSubagentDesktopArtifactGateResult, { kind: "unavailable" }>,
    ) =>
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method,
        detail: `Managed Pi subagents are unavailable (${result.reason}): ${result.detail}`,
      });

    /**
     * Shared desktop managed-artifact gate evaluation. Returns the pass
     * (non-desktop, or desktop with the Ticket 02 trusted controlled-runtime
     * binding) or throws the fail-closed denial before any Pi SDK import.
     */
    const evaluateDesktopPiArtifactGate = async (
      method: string,
    ): Promise<PiSubagentDesktopArtifactGateResult> => {
      const result = await evaluatePiSubagentDesktopArtifactGate(serverConfig.mode, {
        env: options?.piSubagentDesktopArtifactGateEnv ?? process.env,
      });
      if (result.kind === "unavailable") {
        throw toDesktopGateUnavailableError(method, result);
      }
      return result;
    };

    const assertDesktopPiArtifactGate = async (method: string): Promise<void> => {
      await evaluateDesktopPiArtifactGate(method);
    };

    const loadPiSdkPromise = async (
      method: string,
      precomputedGate?: PiSubagentDesktopArtifactGateResult,
    ): Promise<PiCodingAgentModule> => {
      // A caller that already evaluated the gate (startSession needs the
      // trusted binding) passes its result here so the artifact tree is
      // verified exactly once per session start.
      if (precomputedGate === undefined) {
        await assertDesktopPiArtifactGate(method);
      } else if (precomputedGate.kind === "unavailable") {
        throw toDesktopGateUnavailableError(method, precomputedGate);
      }
      return loadPiCodingAgentModule();
    };

    const toPiSdkRequestError = (method: string, cause: unknown, fallback: string) =>
      cause instanceof ProviderAdapterRequestError
        ? cause
        : new ProviderAdapterRequestError({
            provider: PROVIDER,
            method,
            detail: toMessage(cause, fallback),
            cause,
          });

    const loadPiSdk = (method: string, precomputedGate?: PiSubagentDesktopArtifactGateResult) =>
      Effect.tryPromise({
        try: () => loadPiSdkPromise(method, precomputedGate),
        catch: (cause) => toPiSdkRequestError(method, cause, "Failed to load Pi SDK."),
      });

    const makeEventBase = makePiRuntimeEventBase;

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) => {
      runtimeEventIngress.offer(compactProviderRuntimeEventForIngress(event));
    };

    // Ticket 13 (T13-AC3/AC5): one adapter-lifetime wall-time sweep over
    // durable execution truth. Expiry journals the band-60 escalation
    // trigger but never aborts a child or settles projection; ticket 15 owns
    // those stages. The operator warning carries safe correlation metadata
    // only — never prompt, result, transcript, or secret content.
    const piSubagentWallTimeSweep =
      piSubagentRepository === undefined
        ? undefined
        : startPiSubagentWallTimeSweep({
            repository: piSubagentRepository,
            wallTimeMs: serverConfig.piSubagentWallTimeMs ?? DEFAULT_PI_SUBAGENT_WALL_TIME_MS,
            ...(options?.piSubagentWallTimeClock?.now
              ? { nowMs: options.piSubagentWallTimeClock.now }
              : {}),
            ...(options?.piSubagentWallTimeClock?.schedule
              ? { schedule: options.piSubagentWallTimeClock.schedule }
              : {}),
            ...(options?.piSubagentWallTimeClock?.intervalMs !== undefined
              ? { intervalMs: options.piSubagentWallTimeClock.intervalMs }
              : {}),
            onExpiryRecorded: (trigger) => {
              const safeCorrelation = makePiSubagentSafeCorrelation({
                executionId: trigger.executionId,
                attemptId: trigger.attemptId,
                threadId: trigger.parentThreadId,
                generation: trigger.generation,
                diagnosticCode: trigger.diagnosticCode,
              });
              const safeDetail = {
                ...safeCorrelation,
                wallTimeMs: trigger.wallTimeMs,
              };
              void Effect.runPromise(
                Effect.logWarning("pi.subagent.walltime_expired", safeDetail),
              ).catch(() => undefined);
              offerRuntimeEvent({
                ...makePiRuntimeEventBase(
                  {
                    session: {
                      threadId: ThreadId.makeUnsafe(trigger.parentThreadId),
                    },
                    activeTurnId: undefined,
                  },
                  { includeTurnId: false },
                ),
                type: "runtime.warning",
                payload: {
                  message: `Pi subagent wall-time budget expired (${trigger.diagnosticCode}); durable watchdog escalation is pending`,
                  detail: safeDetail,
                },
                raw: {
                  source: "pi.sdk.event",
                  method: "subagents/walltime-expired",
                  payload: safeDetail,
                },
              } satisfies ProviderRuntimeEvent);
            },
          });

    // Ticket 21: bounded, safe operator diagnostics for managed control
    // health transitions only (never per-rejection). The payload is limited
    // to fixed-vocabulary status/code/timestamp metadata scoped to the
    // admission thread that drove the transition; prompt, result, raw SQL,
    // and rejection-reason content are never included.
    const offerSubagentControlHealthWarning = (transition: PiSubagentControlHealthTransition) => {
      const threadId = transition.threadId;
      if (threadId === undefined) {
        // Cannot scope the warning to an admission thread; never emit an
        // unscoped control-health event.
        return;
      }
      const diagnosticCode = transition.diagnosticCode ?? "pi_subagent_control_degraded";
      const safeDetail = {
        from: transition.from,
        to: transition.to,
        diagnosticCode,
        occurredAt: transition.occurredAt,
      };
      const message =
        transition.to === "degraded"
          ? `Pi subagent managed control health degraded (${diagnosticCode}): new managed subagent admissions fail closed until durable lifecycle writes recover`
          : `Pi subagent managed control health recovered (${diagnosticCode}): managed subagent admissions are available again`;
      offerRuntimeEvent({
        ...makeEventBase(
          { session: { threadId }, activeTurnId: undefined },
          {
            includeTurnId: false,
          },
        ),
        type: "runtime.warning",
        payload: { message, detail: safeDetail },
        raw: {
          source: "pi.sdk.event",
          method: "subagents/control-health-transition",
          payload: safeDetail,
        },
      } satisfies ProviderRuntimeEvent);
    };

    const offerRuntimeError = (
      context: PiSessionContext,
      input: {
        readonly message: string;
        readonly cause?: unknown;
        readonly method: string;
        readonly messageType?: string;
      },
    ) => {
      offerRuntimeEvent({
        ...makeEventBase(context, { includeTurnId: false }),
        type: "runtime.error",
        payload: {
          message: input.message,
          class: classifyPiRuntimeError(input.message),
          ...(input.cause !== undefined ? { detail: runtimeErrorDetail(input.cause) } : {}),
        },
        raw: {
          source: "pi.sdk.event",
          method: input.method,
          ...(input.messageType ? { messageType: input.messageType } : {}),
          payload: input.cause ?? { message: input.message },
        },
      } satisfies ProviderRuntimeEvent);
    };

    const requestPiExtensionUserInput = (
      context: PiSessionContext,
      input: {
        readonly method: string;
        readonly question: UserInputQuestion;
        readonly opts?: Parameters<ExtensionUIContext["select"]>[2];
        readonly rawPayload?: Record<string, unknown>;
      },
    ): Promise<ProviderUserInputAnswers> => {
      if (context.stopped || input.opts?.signal?.aborted) {
        return Promise.resolve({});
      }

      const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
      const runtimeRequestId = RuntimeRequestId.makeUnsafe(requestId);

      return new Promise((resolve) => {
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let abort: () => void;

        const cleanup = () => {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          input.opts?.signal?.removeEventListener("abort", abort);
        };
        const finish = (answers: ProviderUserInputAnswers) => {
          if (settled) return;
          settled = true;
          cleanup();
          context.pendingUserInputs.delete(requestId);
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "user-input.resolved",
            requestId: runtimeRequestId,
            payload: { answers },
            raw: {
              source: "pi.sdk.event",
              method: `${input.method}/answered`,
              payload: { requestId, answers },
            },
          } satisfies ProviderRuntimeEvent);
          resolve(answers);
        };
        abort = () => finish({});

        context.pendingUserInputs.set(requestId, { resolve: finish });
        if (typeof input.opts?.timeout === "number" && input.opts.timeout > 0) {
          timeoutId = setTimeout(abort, input.opts.timeout);
        }
        input.opts?.signal?.addEventListener("abort", abort, { once: true });

        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "user-input.requested",
          requestId: runtimeRequestId,
          payload: { questions: [input.question] },
          raw: {
            source: "pi.sdk.event",
            method: input.method,
            payload: input.rawPayload ?? { requestId, question: input.question },
          },
        } satisfies ProviderRuntimeEvent);
      });
    };

    // Bridges the common Pi extension UI primitives onto Synara's existing
    // pending user-input flow; terminal/TUI-only APIs remain no-op by design.
    const makePiExtensionUIContext = (context: PiSessionContext): ExtensionUIContext => {
      const unsupportedWarnings = new Set<string>();
      const statusTexts = new Map<string, string>();
      let workingMessage: string | undefined;
      const warnUnsupported = (method: string) => {
        if (unsupportedWarnings.has(method)) return;
        unsupportedWarnings.add(method);
        offerRuntimeEvent({
          ...makeEventBase(context, { includeTurnId: false }),
          type: "runtime.warning",
          payload: {
            message: `Pi extension UI API '${method}' is not supported in Synara yet.`,
            detail: { method },
          },
          raw: {
            source: "pi.sdk.event",
            method: "extension/ui-unsupported",
            payload: { method },
          },
        } satisfies ProviderRuntimeEvent);
      };
      const emitPluginProgress = (summary: string) => {
        const normalized = trimToUndefined(summary);
        if (!normalized) return;
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "tool.progress",
          payload: { toolName: "Pi plugin", summary: normalized },
          raw: {
            source: "pi.sdk.event",
            method: "extension/ui-progress",
            payload: { summary: normalized },
          },
        } satisfies ProviderRuntimeEvent);
      };

      const uiContext: ExtensionUIContext = {
        async select(title, options, opts) {
          const questionId = "selection";
          const optionMappings = makePiUserInputOptions(options);
          const answers = await requestPiExtensionUserInput(context, {
            method: "extension/ui/select",
            opts,
            question: {
              id: questionId,
              header: trimToUndefined(title) ?? "Pi plugin",
              question: trimToUndefined(title) ?? "Choose an option.",
              options: optionMappings.map((mapping) => mapping.option),
            },
            rawPayload: { title, options },
          });
          const answer = firstPiUserInputAnswer(answers, questionId);
          return optionMappings.find((mapping) => mapping.option.label === answer)?.value;
        },
        async confirm(title, message, opts) {
          const questionId = "confirmation";
          const answers = await requestPiExtensionUserInput(context, {
            method: "extension/ui/confirm",
            opts,
            question: {
              id: questionId,
              header: trimToUndefined(title) ?? "Pi plugin",
              question:
                trimToUndefined(message) ?? trimToUndefined(title) ?? "Confirm this action?",
              options: [makePiUserInputOption("Yes"), makePiUserInputOption("No")],
            },
            rawPayload: { title, message },
          });
          return firstPiUserInputAnswer(answers, questionId) === "Yes";
        },
        async input(title, placeholder, opts) {
          const questionId = "input";
          const answers = await requestPiExtensionUserInput(context, {
            method: "extension/ui/input",
            opts,
            question: {
              id: questionId,
              header: trimToUndefined(title) ?? "Pi plugin",
              question:
                trimToUndefined(placeholder) ?? trimToUndefined(title) ?? "Type a response.",
              options: [],
            },
            rawPayload: { title, placeholder },
          });
          return firstPiUserInputAnswer(answers, questionId);
        },
        notify(message, type) {
          const normalized = trimToUndefined(message);
          if (!normalized) return;
          if (type === "warning" || type === "error") {
            offerRuntimeEvent({
              ...makeEventBase(context),
              type: "runtime.warning",
              payload: { message: normalized, detail: { type: type ?? "info" } },
              raw: {
                source: "pi.sdk.event",
                method: "extension/ui/notify",
                payload: { message: normalized, type },
              },
            } satisfies ProviderRuntimeEvent);
            return;
          }
          emitPluginProgress(normalized);
        },
        onTerminalInput() {
          warnUnsupported("onTerminalInput");
          return () => undefined;
        },
        setStatus(key, text) {
          const normalizedKey = trimToUndefined(key) ?? "status";
          const normalizedText = trimToUndefined(text);
          if (!normalizedText) {
            statusTexts.delete(normalizedKey);
            return;
          }
          if (statusTexts.get(normalizedKey) === normalizedText) return;
          statusTexts.set(normalizedKey, normalizedText);
          emitPluginProgress(`${normalizedKey}: ${normalizedText}`);
        },
        setWorkingMessage(message) {
          const normalizedMessage = trimToUndefined(message);
          if (!normalizedMessage || normalizedMessage === workingMessage) return;
          workingMessage = normalizedMessage;
          emitPluginProgress(normalizedMessage);
        },
        setWorkingVisible() {},
        setWorkingIndicator() {},
        setHiddenThinkingLabel() {},
        setWidget() {
          warnUnsupported("setWidget");
        },
        setFooter() {
          warnUnsupported("setFooter");
        },
        setHeader() {
          warnUnsupported("setHeader");
        },
        setTitle(title) {
          if (title) emitPluginProgress(title);
        },
        async custom() {
          warnUnsupported("custom");
          return undefined as never;
        },
        pasteToEditor() {
          warnUnsupported("pasteToEditor");
        },
        setEditorText() {
          warnUnsupported("setEditorText");
        },
        getEditorText() {
          return "";
        },
        editor(title, prefill) {
          return uiContext.input(title, prefill);
        },
        addAutocompleteProvider() {
          warnUnsupported("addAutocompleteProvider");
        },
        setEditorComponent() {
          warnUnsupported("setEditorComponent");
        },
        getEditorComponent() {
          return undefined;
        },
        theme: PLAIN_PI_EXTENSION_THEME,
        getAllThemes() {
          return [];
        },
        getTheme() {
          return undefined;
        },
        setTheme() {
          return { success: false, error: "Synara does not expose Pi themes." };
        },
        getToolsExpanded() {
          return false;
        },
        setToolsExpanded() {},
      };
      return uiContext;
    };

    const completePromptRejection = (context: PiSessionContext, turnId: TurnId, cause: unknown) => {
      if (context.activeTurnId !== turnId) {
        return;
      }

      const message = toMessage(cause, "Pi turn failed.");
      const failure = classifyPiTurnFailure(message);
      const completionBase = makeEventBase(context);
      if (failure.state === "failed") {
        offerRuntimeError(context, { message, method: "prompt", cause });
      }
      // Decision 0016: a parent turn reached a safe boundary. Generic settle /
      // session events only TRIGGER a recovery check — they can never
      // acknowledge a batch by themselves (only a fingerprint-matched accepted
      // receipt can).
      if (piSubagentCompletionCoordinator) {
        const settledThreadId = String(context.session.threadId);
        piSubagentCompletionCoordinator.onParentTurnSettled(settledThreadId);
        piSubagentCompletionCoordinator.onManagedSessionHydrated(settledThreadId);
      }
      context.activeTurnId = undefined;
      context.activeAssistantItemId = undefined;
      context.activeReasoningItemId = undefined;
      context.activeToolItems.clear();
      context.session = makeSessionSnapshot(context);
      offerRuntimeEvent({
        ...completionBase,
        type: "turn.completed",
        payload: {
          state: failure.state,
          stopReason: failure.stopReason,
          errorMessage: message,
        },
        raw: { source: "pi.sdk.event", method: "prompt", payload: cause },
      } satisfies ProviderRuntimeEvent);
    };

    const requireSession = Effect.fn("PiAdapter.requireSession")(function* (threadId: ThreadId) {
      const context = sessions.get(threadId);
      if (!context) {
        return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
      }
      if (context.stopped) {
        return yield* new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
      }
      return context;
    });

    const disposeSessionContext = async (context: PiSessionContext) => {
      context.unsubscribe?.();
      context.unsubscribe = undefined;
      // Fence and finalize the Synara MCP lifecycle before the runtime dies:
      // new MCP admissions fail fast, pending activations are superseded,
      // in-flight executions are settled exactly once, candidate credentials
      // revoked, and the staged-tool registry cleared.
      context.synaraMcpExecutions.fence();
      await context.synaraMcpCoordinator.dispose();
      // Ticket 23: release every per-execution observation slot and timer
      // owned by this session before the runtime dies (T23-AC6 cleanup).
      context.subagentProgressCoalescer?.disposeAll().catch(() => undefined);
      for (const pending of Array.from(context.pendingUserInputs.values())) {
        pending.resolve({});
      }
      context.pendingUserInputs.clear();
      context.stopped = true;
      markPiSubagentOwnedTeardownOwnerStopped(context);
      let runtimeFailure: unknown;
      try {
        await context.runtime.dispose();
      } catch (cause) {
        runtimeFailure = cause;
      }
      let processFailure: unknown;
      try {
        await context.processSupervisor.teardownAll();
      } catch (cause) {
        processFailure = cause;
      }
      if (runtimeFailure !== undefined && processFailure !== undefined) {
        throw new AggregateError(
          [runtimeFailure, processFailure],
          "Failed to dispose the Pi runtime and prove its subprocess trees exited.",
        );
      }
      if (processFailure !== undefined) throw processFailure;
      if (runtimeFailure !== undefined) throw runtimeFailure;
    };

    const handleMessageUpdate = (
      context: PiSessionContext,
      event: Extract<AgentSessionEvent, { type: "message_update" }>,
    ) => {
      if (event.message.role !== "assistant") return;
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        if (!context.activeAssistantItemId) {
          context.activeAssistantItemId = RuntimeItemId.makeUnsafe(
            `pi-assistant-${crypto.randomUUID()}`,
          );
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: context.activeAssistantItemId,
            type: "item.started",
            payload: { itemType: "assistant_message", status: "inProgress", title: "Assistant" },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
        }
        recordPiItem(context, { type: "assistant_message", delta: update.delta });
        offerRuntimeEvent({
          ...makeEventBase(context),
          itemId: context.activeAssistantItemId,
          type: "content.delta",
          payload: {
            streamKind: "assistant_text",
            delta: update.delta,
            contentIndex: update.contentIndex,
          },
          raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
        } satisfies ProviderRuntimeEvent);
        return;
      }
      if (update.type === "thinking_delta") {
        if (!context.activeReasoningItemId) {
          context.activeReasoningItemId = RuntimeItemId.makeUnsafe(
            `pi-reasoning-${crypto.randomUUID()}`,
          );
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: context.activeReasoningItemId,
            type: "item.started",
            payload: { itemType: "reasoning", status: "inProgress", title: "Reasoning" },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
        }
        recordPiItem(context, { type: "reasoning", delta: update.delta });
        offerRuntimeEvent({
          ...makeEventBase(context),
          itemId: context.activeReasoningItemId,
          type: "content.delta",
          payload: {
            streamKind: "reasoning_text",
            delta: update.delta,
            contentIndex: update.contentIndex,
          },
          raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
        } satisfies ProviderRuntimeEvent);
      }
    };

    const handleSessionEvent = (context: PiSessionContext, event: AgentSessionEvent) => {
      switch (event.type) {
        case "agent_start":
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "thread.state.changed",
            payload: { state: "active" },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        case "turn_start":
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "turn.started",
            payload: {
              ...(context.runtime.session.model
                ? {
                    model: `${context.runtime.session.model.provider}/${context.runtime.session.model.id}`,
                  }
                : {}),
              effort: context.runtime.session.thinkingLevel,
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        case "message_update":
          handleMessageUpdate(context, event);
          return;
        case "tool_execution_start": {
          const itemId = RuntimeItemId.makeUnsafe(`pi-tool-${event.toolCallId}`);
          const tracked: PiTrackedToolCall = {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            itemId,
            itemType: toolItemType(event.toolName),
          };
          context.activeToolItems.set(event.toolCallId, tracked);
          const title = toolTitle(event.toolName, event.args);
          recordPiItem(context, {
            type: "tool_call",
            status: "started",
            toolName: event.toolName,
            args: event.args,
          });
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId,
            providerRefs: { providerItemId: ProviderItemId.makeUnsafe(event.toolCallId) },
            type: "item.started",
            payload: {
              itemType: tracked.itemType,
              status: "inProgress",
              title,
              data: toolLifecycleData({
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
              }),
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "tool_execution_update": {
          const tracked = context.activeToolItems.get(event.toolCallId);
          if (!tracked) return;
          const lifecycle = mapPiToolLifecyclePayload({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: tracked.args,
            partialResult: event.partialResult,
          });
          recordPiItem(context, {
            type: "tool_call",
            status: "updated",
            toolName: event.toolName,
            output: lifecycle.detail,
          });
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: tracked.itemId,
            providerRefs: { providerItemId: ProviderItemId.makeUnsafe(event.toolCallId) },
            type: "item.updated",
            payload: {
              itemType: tracked.itemType,
              status: "inProgress",
              title: toolTitle(event.toolName, tracked.args),
              ...lifecycle,
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "tool_execution_end": {
          const tracked = context.activeToolItems.get(event.toolCallId) ?? {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: undefined,
            itemId: RuntimeItemId.makeUnsafe(`pi-tool-${event.toolCallId}`),
            itemType: toolItemType(event.toolName),
          };
          context.activeToolItems.delete(event.toolCallId);
          const lifecycle = mapPiToolLifecyclePayload({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: tracked.args,
            result: event.result,
            isError: event.isError,
          });
          recordPiItem(context, {
            type: "tool_call",
            status: event.isError ? "failed" : "completed",
            toolName: event.toolName,
            output: lifecycle.detail,
            result: event.result,
          });
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId: tracked.itemId,
            providerRefs: { providerItemId: ProviderItemId.makeUnsafe(event.toolCallId) },
            type: "item.completed",
            payload: {
              itemType: tracked.itemType,
              status: event.isError ? "failed" : "completed",
              title: toolTitle(event.toolName, tracked.args),
              ...lifecycle,
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "compaction_start": {
          const itemId = RuntimeItemId.makeUnsafe(`pi-compaction-${crypto.randomUUID()}`);
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId,
            type: "item.updated",
            payload: {
              itemType: "context_compaction",
              status: "inProgress",
              title: "Compacting context",
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "compaction_end": {
          const itemId = RuntimeItemId.makeUnsafe(`pi-compaction-${crypto.randomUUID()}`);
          offerRuntimeEvent({
            ...makeEventBase(context),
            itemId,
            type: "item.completed",
            payload: {
              itemType: "context_compaction",
              status: event.aborted ? "failed" : "completed",
              title: "Context compacted",
              data: event,
            },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        case "agent_end": {
          const stats = context.runtime.session.getSessionStats();
          const usage = normalizeTokenUsage(stats, context.runtime.session.model?.contextWindow);
          context.lastKnownTokenUsage = usage;
          const turnId = context.activeTurnId;
          const errorMessage = context.runtime.session.agent.state.errorMessage;
          const failure = errorMessage ? classifyPiTurnFailure(errorMessage) : undefined;
          const leafId = context.runtime.session.sessionManager.getLeafId();
          const turn = turnId
            ? context.turns.find((candidate) => candidate.id === turnId)
            : undefined;
          if (turn) turn.leafId = leafId;
          if (context.activeAssistantItemId) {
            offerRuntimeEvent({
              ...makeEventBase(context),
              itemId: context.activeAssistantItemId,
              type: "item.completed",
              payload: {
                itemType: "assistant_message",
                status: errorMessage ? "failed" : "completed",
                title: "Assistant",
              },
              raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
            } satisfies ProviderRuntimeEvent);
          }
          if (context.activeReasoningItemId) {
            offerRuntimeEvent({
              ...makeEventBase(context),
              itemId: context.activeReasoningItemId,
              type: "item.completed",
              payload: {
                itemType: "reasoning",
                status: errorMessage ? "failed" : "completed",
                title: "Reasoning",
              },
              raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
            } satisfies ProviderRuntimeEvent);
          }
          if (usage) {
            offerRuntimeEvent({
              ...makeEventBase(context),
              type: "thread.token-usage.updated",
              payload: { usage },
              raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
            } satisfies ProviderRuntimeEvent);
          }
          if (errorMessage && failure?.state === "failed") {
            offerRuntimeError(context, {
              message: errorMessage,
              method: "prompt",
              messageType: event.type,
              cause: event,
            });
          }
          const completionBase = makeEventBase(context);
          context.activeTurnId = undefined;
          context.activeAssistantItemId = undefined;
          context.activeReasoningItemId = undefined;
          context.activeToolItems.clear();
          context.session = makeSessionSnapshot(context);
          // Decision 0016: the parent turn reached a safe boundary. A settle
          // event only TRIGGERS a recovery check (the pending batch may now
          // dispatch, or an accepted batch may finalize). It NEVER
          // acknowledges a batch by itself — only the exact accepted receipt
          // does (Decision 0016 §6). Previously the message_end handler
          // acknowledged the outstanding follow-up; that is removed.
          if (piSubagentCompletionCoordinator) {
            const settledThreadId = String(context.session.threadId);
            piSubagentCompletionCoordinator.onParentTurnSettled(settledThreadId);
            piSubagentCompletionCoordinator.onManagedSessionHydrated(settledThreadId);
          }
          offerRuntimeEvent({
            ...completionBase,
            type: "turn.completed",
            payload:
              errorMessage && failure
                ? {
                    state: failure.state,
                    stopReason: failure.stopReason,
                    errorMessage,
                    usage: stats,
                  }
                : { state: "completed", stopReason: null, usage: stats },
            raw: { source: "pi.sdk.event", messageType: event.type, payload: event },
          } satisfies ProviderRuntimeEvent);
          return;
        }
        default:
          return;
      }
    };

    const createSdkRuntime = async (input: {
      sdk: PiCodingAgentModule;
      cwd: string;
      agentDir: string;
      sessionManager: SessionManager;
      modelId?: string;
      thinkingLevel?: ThinkingLevel;
      processSupervisor: PiBashProcessSupervisor;
      /**
       * Ticket 02 desktop managed bootstrap (Decision 0003): when present,
       * `agentDir` is the verified artifact's controlled `agent` subtree while
       * the model/auth runtime reads the USER's normal Pi agent directory
       * directly (explicit `auth.json`/`models.json` paths — never copied,
       * never a broad directory), extension loading is isolated to the
       * release-controlled extension directory only (no user-global/project/
       * settings-injected extensions, no caller-supplied factories), and the
       * caller must still complete the mandatory handshake before publishing.
       */
      desktopManaged?: {
        readonly userAgentDir: string;
        readonly extensionPath: string;
      };
    }) => {
      const modelRuntime = await createPiModelRuntime(
        input.desktopManaged?.userAgentDir ?? input.agentDir,
        input.sdk,
      );
      const synaraMcp = makePiSynaraMcpDormantExtension();
      // The live options accept opaque caller-supplied factories (tests and
      // measurement drivers pass real InlineExtension factories, incl. the
      // synara.pi.subagents.bridge brand symbol); narrow to the loader's
      // expected shape at this seam. Desktop managed sessions load ONLY the
      // release-controlled artifact extension plus the server-internal
      // dormant Synara MCP extension — caller factories are not an alternate
      // desktop Agent path (Decision 0003 / spec Implementation Decision 3).
      const extraExtensionFactories = (options?.extensionFactories ??
        []) as readonly InlineExtension[];
      const resourceLoaderOptions = input.desktopManaged
        ? {
            // Direct SDK-supported extension isolation: with noExtensions,
            // the loader resolves ONLY the explicitly provided extension
            // paths — no user-global tree, no project `.pi` auto-discovery,
            // no settings/packages injection.
            noExtensions: true,
            additionalExtensionPaths: [input.desktopManaged.extensionPath],
            extensionFactories: [synaraMcp.extension],
          }
        : {
            extensionFactories: [synaraMcp.extension, ...extraExtensionFactories],
          };
      // Keep one settings owner for the lifetime of this runtime. The SDK
      // currently invokes the runtime factory once, but the immutable
      // artifact guarantee must not depend on that implementation detail.
      const desktopManagedSettingsManager = input.desktopManaged
        ? input.sdk.SettingsManager.inMemory()
        : undefined;
      const createRuntime: CreateAgentSessionRuntimeFactory = async ({
        cwd,
        agentDir,
        sessionManager,
        sessionStartEvent,
      }) => {
        const services = await input.sdk.createAgentSessionServices({
          cwd,
          agentDir,
          modelRuntime,
          resourceLoaderOptions,
          // Desktop-managed sessions must never persist writable settings
          // into the verified artifact tree: Pi SDK 0.83's session.setModel
          // persists defaultProvider/defaultModel through SettingsManager to
          // `<agentDir>/settings.json`, which is not in manifest.json, so the
          // next desktop artifact gate fails closed with `unlisted_entry` and
          // quarantines the thread. One session-scoped in-memory
          // SettingsManager per createSdkRuntime invocation keeps the SDK's
          // supported `settingsManager` seam while guaranteeing zero file
          // I/O against the immutable closure. Non-desktop sessions keep the
          // SDK default file-backed SettingsManager exactly as before.
          ...(desktopManagedSettingsManager
            ? { settingsManager: desktopManagedSettingsManager }
            : {}),
        });
        const registry = modelRegistryFacade(services.modelRuntime, input.sdk);
        const model = findModelInRegistry(registry, input.modelId);
        if (input.modelId && !model) {
          throw new Error(
            `Pi model '${input.modelId}' is not available. Use a discovered model or a provider-qualified custom model slug like 'openai/gpt-5.5'.`,
          );
        }
        const shellPath = services.settingsManager.getShellPath();
        const commandPrefix = services.settingsManager.getShellCommandPrefix();
        input.processSupervisor.setShellPath(shellPath);
        return {
          ...(await input.sdk.createAgentSessionFromServices({
            services,
            sessionManager,
            ...(sessionStartEvent ? { sessionStartEvent } : {}),
            ...(model ? { model } : {}),
            thinkingLevel: input.thinkingLevel ?? DEFAULT_PI_THINKING_LEVEL,
            customTools: [
              input.sdk.defineTool(
                input.sdk.createBashToolDefinition(cwd, {
                  operations: input.processSupervisor.operations,
                  ...(commandPrefix === undefined ? {} : { commandPrefix }),
                  ...(shellPath === undefined ? {} : { shellPath }),
                }),
              ),
            ],
          })),
          services,
          diagnostics: services.diagnostics,
        };
      };
      const runtime = await input.sdk.createAgentSessionRuntime(createRuntime, {
        cwd: input.sessionManager.getCwd(),
        agentDir: input.agentDir,
        sessionManager: input.sessionManager,
      });
      return {
        runtime,
        modelRegistry: modelRegistryFacade(runtime.services.modelRuntime, input.sdk),
        synaraMcp,
      };
    };

    const startSession: PiAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const cwd = trimToUndefined(input.cwd) ?? serverConfig.cwd;
        // Ticket 02: evaluate the desktop managed-artifact gate exactly once
        // per session start, BEFORE the Pi SDK import. In desktop mode the
        // pass carries the trusted controlled-runtime binding (verified
        // artifact root → controlled `<root>/agent` agentDir + trusted
        // metadata); every other mode passes through unchanged (Decision
        // 0004 §4-§6 / Decision 0003).
        const gateResult = yield* Effect.tryPromise({
          try: () => evaluateDesktopPiArtifactGate("session/start"),
          catch: (cause) => toPiSdkRequestError("session/start", cause, "Failed to load Pi SDK."),
        });
        const piSdk = yield* loadPiSdk("session/start", gateResult);
        // Ticket 02 desktop managed bootstrap inputs (Decision 0003): the
        // controlled agentDir is the verified artifact's `agent` subtree —
        // NEVER a user/request-supplied directory; extension loading is
        // isolated to the release-controlled extension directory inside it;
        // the model/auth runtime reads the USER's normal Pi agent directory
        // directly (explicit auth.json/models.json paths, never a copy).
        const desktopManagedBinding =
          gateResult.kind === "pass" && "managed" in gateResult
            ? {
                agentDir: gateResult.managed.agentDir,
                userAgentDir:
                  trimToUndefined(options?.piSubagentDesktopUserAgentDir) ?? piSdk.getAgentDir(),
                extensionPath: piSubagentDesktopManagedExtensionDir(gateResult.managed.agentDir),
              }
            : undefined;
        const processSupervisor = makePiBashProcessSupervisor({
          getShellConfig: () => piSdk.getShellConfig(),
          ...(options?.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
          ...(options?.teardownProcessTree
            ? { teardownProcessTree: options.teardownProcessTree }
            : {}),
        });
        const agentDir = desktopManagedBinding
          ? desktopManagedBinding.agentDir
          : makeAgentDir(input.providerOptions?.pi?.agentDir, piSdk);
        const sessionFile = extractResumeSessionFile(input.resumeCursor);
        const sessionManager = sessionFile
          ? piSdk.SessionManager.open(sessionFile, undefined, cwd)
          : piSdk.SessionManager.create(cwd);
        const modelId =
          input.modelSelection?.provider === "pi" ? input.modelSelection.model : undefined;
        const thinkingLevel =
          input.modelSelection?.provider === "pi"
            ? normalizePiThinkingLevel(input.modelSelection.options?.thinkingLevel)
            : undefined;
        const existingContext = sessions.get(input.threadId);
        if (existingContext) {
          yield* Effect.tryPromise({
            try: () => disposeSessionContext(existingContext),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/restart",
                detail: toMessage(cause, "Failed to dispose previous Pi session."),
                cause,
              }),
          });
          if (sessions.get(input.threadId) === existingContext) {
            sessions.delete(input.threadId);
            coordinatorEligibleThreads.delete(String(input.threadId));
          }
        }
        const { runtime, modelRegistry, synaraMcp } = yield* Effect.tryPromise({
          try: () =>
            createSdkRuntime({
              sdk: piSdk,
              cwd,
              agentDir,
              sessionManager,
              ...(modelId ? { modelId } : {}),
              ...(thinkingLevel ? { thinkingLevel } : {}),
              processSupervisor,
              ...(desktopManagedBinding
                ? {
                    desktopManaged: {
                      userAgentDir: desktopManagedBinding.userAgentDir,
                      extensionPath: desktopManagedBinding.extensionPath,
                    },
                  }
                : {}),
            }),
          catch: (cause) =>
            // Ticket 02 WP-B (AC5): a DESKTOP-ONLY runtime creation failure —
            // the empirically real vector is an explicitly selected model id
            // unavailable from the registry, whose raw message embeds the
            // user's model id — maps to the fixed bounded detail with NO
            // retained cause/stack/error object. Non-desktop sessions keep
            // the historical raw behavior (message + cause) exactly.
            desktopManagedBinding
              ? new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/start",
                  detail: PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
                })
              : new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/start",
                  detail: toMessage(cause, "Failed to start Pi session."),
                  cause,
                }),
        });
        // One lifecycle coordinator per Pi session, created with the dormant
        // extension and owned for the whole session lifetime: safe-boundary
        // notifications reach it through the extension's agent_end hook, and
        // session disposal disposes it before the runtime tears down. The
        // execution registry fences and settles Synara MCP tool calls on
        // disable (impl-07).
        const synaraMcpExecutions = makePiSynaraMcpToolExecutionRegistry();
        // Decision 35: the generation the observer's capture must still match
        // is the coordinator's committed activation lifecycle generation (a
        // fresh generation minted per activation at the safe-boundary commit),
        // never the outer session-start generation. This per-session cell
        // tracks the committed generation after reload for the observer's
        // activated capture only; runtime events keep the outer session
        // generation, so the cell never changes event/accounting semantics.
        const observerCurrentLifecycleGeneration =
          catalogObserver === null ? undefined : { current: input.lifecycleGeneration };
        const synaraMcpCoordinator = makePiSessionSynaraMcpCoordinator({
          threadId: input.threadId,
          adapter: synaraMcp.adapter,
          stagedTools: synaraMcp.stagedTools,
          executions: synaraMcpExecutions,
          runtime,
          mcpAuthority: input.mcpAuthority,
          ...(agentGatewayCredentials === undefined
            ? {}
            : { credentials: agentGatewayCredentials }),
          ...(options?.agentGatewayFetch === undefined ? {} : { fetch: options.agentGatewayFetch }),
          // Decision 35: the measurement-only observer learns the proven
          // activation commit (reload completed) through this seam together
          // with the exact committed activation lifecycle generation. The
          // generation it records is the one the capture must still match; a
          // changed generation declines the capture.
          ...(catalogObserver === null
            ? {}
            : {
                onActivationCommitted: (lifecycleGeneration) => {
                  observerCurrentLifecycleGeneration!.current = lifecycleGeneration;
                  safeObserve(() =>
                    catalogObserver.onActivationCommitted({
                      threadId: String(input.threadId),
                      lifecycleGeneration,
                    }),
                  );
                },
              }),
        });
        const now = new Date().toISOString();
        const model = runtime.session.model
          ? `${runtime.session.model.provider}/${runtime.session.model.id}`
          : modelId;
        const resumeCursor = getSessionFile(runtime.session);
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          threadId: input.threadId,
          createdAt: now,
          updatedAt: now,
          ...(model ? { model } : {}),
          ...(resumeCursor ? { resumeCursor } : {}),
        };
        const context: PiSessionContext = {
          ...(input.lifecycleGeneration !== undefined
            ? { lifecycleGeneration: input.lifecycleGeneration }
            : {}),
          ...(observerCurrentLifecycleGeneration === undefined
            ? {}
            : { observerCurrentLifecycleGeneration }),
          runtime,
          gatewayControlAvailable: false,
          synaraMcp: synaraMcp.adapter,
          synaraMcpCoordinator,
          synaraMcpExecutions,
          processSupervisor,
          modelRegistry,
          session,
          turns: [],
          activeTurnId: undefined,
          activeAssistantItemId: undefined,
          activeReasoningItemId: undefined,
          activeToolItems: new Map(),
          pendingUserInputs: new Map(),
          stopped: false,
          lastKnownTokenUsage: undefined,
          unsubscribe: undefined,
          ...(input.mcpAuthority !== undefined ? { mcpAuthority: input.mcpAuthority } : {}),
        };
        context.unsubscribe = runtime.session.subscribe((event) =>
          handleSessionEvent(context, event),
        );
        // Ticket 02 desktop managed bootstrap ordering (spec Implementation
        // Decision 5 / Decision 0002): the mandatory seven-capability
        // handshake runs AFTER extension binding but BEFORE any session
        // publication (`sessions.set`), capability callback, or managed
        // Agent exposure. A desktop handshake failure is FATAL at this
        // boundary — the staged runtime is disposed, no durable/session
        // side effect remains, and there is NO legacy warning fallback.
        // Non-desktop keeps the historical order exactly (publish → bind →
        // non-fatal default three-capability probe with warning fallback).
        let desktopManagedCapability: PiSubagentNegotiatedCapability | undefined;
        if (desktopManagedBinding) {
          const capability = yield* Effect.tryPromise({
            try: async () => {
              await runtime.session.bindExtensions({
                uiContext: makePiExtensionUIContext(context),
              });
              const negotiated = await negotiatePiSubagentDesktopManagedBridge(runtime.session);
              if (!negotiated.isManaged) {
                throw new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/start",
                  detail: piSubagentDesktopManagedBootstrapFailureDetail(negotiated),
                });
              }
              return negotiated;
            },
            catch: (cause) =>
              cause instanceof ProviderAdapterRequestError
                ? cause
                : new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "extension/bind",
                    detail: toMessage(cause, "Failed to bind Pi extensions."),
                    cause,
                  }),
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* Effect.tryPromise({
                  try: () => disposeSessionContext(context),
                  catch: (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/start-cleanup",
                      detail: toMessage(cause, "Failed to prove Pi startup cleanup completed."),
                      cause,
                    }),
                });
                if (sessions.get(input.threadId) === context) {
                  sessions.delete(input.threadId);
                  coordinatorEligibleThreads.delete(String(input.threadId));
                }
                return yield* Effect.fail(error);
              }),
            ),
          );
          desktopManagedCapability = capability;
          sessions.set(input.threadId, context);
        } else {
          sessions.set(input.threadId, context);
          yield* Effect.tryPromise({
            try: () =>
              runtime.session.bindExtensions({ uiContext: makePiExtensionUIContext(context) }),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "extension/bind",
                detail: toMessage(cause, "Failed to bind Pi extensions."),
                cause,
              }),
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* Effect.tryPromise({
                  try: () => disposeSessionContext(context),
                  catch: (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/start-cleanup",
                      detail: toMessage(cause, "Failed to prove Pi startup cleanup completed."),
                      cause,
                    }),
                });
                if (sessions.get(input.threadId) === context) {
                  sessions.delete(input.threadId);
                  coordinatorEligibleThreads.delete(String(input.threadId));
                }
                return yield* Effect.fail(error);
              }),
            ),
          );
        }
        options?.onSynaraMcpSession?.({
          threadId: input.threadId,
          adapter: synaraMcp.adapter,
          coordinator: synaraMcpCoordinator,
        });
        const subagentCapability: PiSubagentNegotiatedCapability = desktopManagedBinding
          ? // Desktop managed: the mandatory seven-capability handshake already
            // completed successfully above (fatal otherwise). Its cached result is
            // the session's capability truth — no second probe, no cached legacy
            // probe, no warning fallback, and no post-publication renegotiation
            // that could fail after the session is already live.
            (desktopManagedCapability ??
            (yield* Effect.die(
              new Error(
                "Pi desktop managed bootstrap invariant violated: missing handshake result.",
              ),
            )))
          : yield* Effect.tryPromise({
              try: () => probePiSubagentBridge(runtime.session),
              catch: (cause): PiSubagentNegotiatedCapability => ({
                status: "bridge_error",
                diagnosticCode: "pi_subagent_bridge_error",
                isManaged: false,
                diagnosticMessage: toMessage(cause, "Failed to probe Pi subagent bridge."),
              }),
            }).pipe(
              // A failed probe is capability DATA (bridge_error), not a session-start
              // failure: recover it into the success channel so the session still
              // starts and managed execution is disabled downstream.
              Effect.catch((error) => Effect.succeed(error)),
            );
        context.subagentCapability = subagentCapability;
        registerPiSubagentOwnedTeardownOwner(context);
        options?.onSubagentCapability?.({
          threadId: input.threadId,
          capability: subagentCapability,
          session: runtime.session,
          context,
        });
        // Decision 0016 §5: a relevant managed parent session hydrated/started.
        // Mark it eligible for the bounded Ticket 09 recovery scan (only when
        // the extension acknowledged completion-delivery ownership; legacy
        // sessions keep the legacy nudge path) and run a recovery check for
        // the parent thread. Absent/lazy sessions are never synthesized.
        if (
          piSubagentCompletionCoordinator !== undefined &&
          subagentCapability.capabilities?.includes("completion-delivery-ownership") === true
        ) {
          const hydratedThreadId = String(input.threadId);
          coordinatorEligibleThreads.add(hydratedThreadId);
          piSubagentCompletionCoordinator.onManagedSessionHydrated(hydratedThreadId);
        }
        // Decision 0002 (Ticket 02): the legacy warning fallback below is
        // NON-DESKTOP ONLY. A desktop managed session whose handshake did not
        // succeed never reaches this point — it failed fatally above before
        // publication, with no legacy/unmanaged fallback.
        if (
          !desktopManagedBinding &&
          (subagentCapability.status === "unsupported_version" ||
            subagentCapability.status === "capability_mismatch" ||
            subagentCapability.status === "bridge_malformed_response" ||
            subagentCapability.status === "bridge_error")
        ) {
          offerRuntimeEvent({
            ...makeEventBase(context, { includeTurnId: false }),
            type: "runtime.warning",
            payload: {
              message: `Pi subagent managed execution is disabled (${subagentCapability.status}): ${subagentCapability.diagnosticMessage ?? subagentCapability.diagnosticCode}`,
              detail: {
                status: subagentCapability.status,
                diagnosticCode: subagentCapability.diagnosticCode,
                ...(subagentCapability.offeredVersion !== undefined
                  ? { offeredVersion: subagentCapability.offeredVersion }
                  : {}),
                ...(subagentCapability.supportedVersions !== undefined
                  ? { supportedVersions: subagentCapability.supportedVersions }
                  : {}),
                ...(subagentCapability.missingCapabilities !== undefined
                  ? { missingCapabilities: subagentCapability.missingCapabilities }
                  : {}),
              },
            },
            raw: {
              source: "pi.sdk.event",
              method: "capability/probe",
              payload: subagentCapability,
            },
          } satisfies ProviderRuntimeEvent);
        }
        const loadedExtensions = runtime.session.resourceLoader.getExtensions().extensions;

        if (subagentCapability.isManaged && piSubagentRepository) {
          // Server-minted command identity scope: each managed Agent tool call
          // receives a durable commandId minted here, keyed by the client
          // correlation identity (params.commandId ?? toolCallId) for the
          // lifetime of this session. Redelivery of the same tool call in the
          // same session replays the same minted identity (→ already_applied);
          // a different session/thread/turn/tool can never collide with it,
          // and the repository additionally validates the ownership fingerprint
          // before any already_applied answer.
          const mintedCommandIds = new Map<string, string>();

          // Ticket 23 server-side progress coalescer: one session-scoped
          // registry, one latest-slot + trailing-edge timer per execution
          // (1/rateHz from resolved server config). Observation failures are
          // swallowed here — progress is never control truth, so a failing
          // durable UPDATE or event offer must neither reject back to the
          // extension nor degrade control health.
          const progressRateHz =
            serverConfig.piSubagentProgressRateHz ?? DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ;
          const heartbeatIntervalMs =
            serverConfig.piSubagentHeartbeatIntervalMs ?? DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS;
          const leaseDurationMs =
            serverConfig.piSubagentLeaseDurationMs ?? DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS;
          const subagentProgressCoalescer = makePiSubagentProgressCoalescer({
            now: options?.piSubagentProgressClock?.now ?? (() => Date.now()),
            schedule: (delayMs, callback) =>
              options?.piSubagentProgressClock !== undefined
                ? options.piSubagentProgressClock.schedule(delayMs, callback)
                : makeDefaultPiSubagentProgressSchedule()(delayMs, callback),
            flushIntervalMs: Math.round(1000 / progressRateHz),
            idleTtlMs: Math.max(leaseDurationMs, 2 * heartbeatIntervalMs),
            onFlush: (flush) => {
              // Emission surface mirrors emitPluginProgress (tool.progress,
              // bounded summary) — the only runtime-event kind progress may
              // produce; projected as non-message activity by the web layer.
              const toolCallId =
                typeof flush.meta === "string" && flush.meta.length > 0 ? flush.meta : undefined;
              const summary = summarizePiSubagentProgressJson(flush.progressJson);
              offerRuntimeEvent({
                ...makeEventBase(context),
                type: "tool.progress",
                payload: {
                  toolName: "Agent",
                  summary,
                  ...(toolCallId !== undefined ? { toolCallId } : {}),
                },
                raw: {
                  source: "pi.sdk.event",
                  method: "subagents/observation-progress",
                  payload: {
                    executionId: flush.executionId,
                    coalescedCount: flush.coalescedCount,
                  },
                },
              } satisfies ProviderRuntimeEvent);
              // Durable latest-snapshot UPDATE (never journal, never state).
              void Effect.runPromise(
                piSubagentRepository.recordProgressObservation({
                  executionId: flush.executionId,
                  progressJson: flush.progressJson,
                  occurredAt: new Date().toISOString(),
                  droppedCountDelta: flush.coalescedCount,
                }),
              ).catch(() => {
                // Swallowed: observation is not control (T23-AC5/AC6).
              });
            },
          });
          context.subagentProgressCoalescer = subagentProgressCoalescer;

          // Ticket 14: per-attempt observation runtime factory — shared by the
          // spawn path (post-admission identities) and the explicit resume
          // launcher (resumed identities). One code path journals every
          // observation (started/detached seq 2/3, coalesced progress,
          // heartbeat lease refresh, terminal ingest + outbox).
          const makeAttemptObservationRuntime = (
            identities: { executionId: string; attemptId: string; generation: number },
            correlationToolCallId: string,
            foregroundWaitMs: number,
          ) => {
            let startedPromise: Promise<void> | undefined;
            let detachedPromise: Promise<void> | undefined;

            const recordHeartbeatObservation = (occurredAt: string): void => {
              // Fire-and-forget lease refresh (T23-AC3): heartbeat is
              // observation, not control — failures are swallowed and never
              // degrade control health, never reject the producer.
              const leaseExpiresAt = new Date(
                Date.parse(occurredAt) + leaseDurationMs,
              ).toISOString();
              void Effect.runPromise(
                piSubagentRepository.recordHeartbeatObservation({
                  executionId: identities.executionId,
                  occurredAt,
                  leaseExpiresAt,
                }),
              ).catch(() => {
                // Swallowed: observation is not control.
              });
            };

            const reportObservation = async (
              obsInput: PiSubagentObservationInput,
            ): Promise<void> => {
              if (
                !obsInput ||
                (obsInput.kind !== "started" &&
                  obsInput.kind !== "detached" &&
                  obsInput.kind !== "progress" &&
                  obsInput.kind !== "heartbeat" &&
                  obsInput.kind !== "terminal")
              ) {
                throw new Error(
                  "Invalid observation kind: expected 'started', 'detached', 'progress', 'heartbeat', or 'terminal'",
                );
              }

              const occurredAt =
                typeof obsInput.occurredAt === "string" && obsInput.occurredAt.trim().length > 0
                  ? obsInput.occurredAt.trim()
                  : new Date().toISOString();

              // Ticket 07 terminal path (T07-AC1..AC7): terminal evidence
              // is control truth — it NEVER enters the progress coalescer
              // (T07-AC6) and is journaled first; notification happens
              // strictly post-commit. Unlike progress/heartbeat, a failed
              // terminal write degrades control health and rejects the
              // producer: an undurable terminal must never be swallowed
              // into a silent success-shaped handle.
              if (obsInput.kind === "terminal") {
                const payload = obsInput.terminal;
                if (
                  !payload ||
                  (payload.state !== "succeeded" && payload.state !== "failed") ||
                  typeof payload.summary !== "string"
                ) {
                  throw new Error(
                    "Invalid terminal observation: expected state 'succeeded'|'failed' and a string summary",
                  );
                }
                let durableOrdinaryTerminal:
                  | {
                      readonly executionId: string;
                      readonly attemptId: string;
                      readonly generation: number;
                    }
                  | undefined;
                const ingest = await Effect.runPromise(
                  Effect.result(
                    ingestPiSubagentTerminal({
                      repository: piSubagentRepository,
                      summaryMaxChars: serverConfig.piSubagentTerminalSummaryMaxChars,
                      observation: {
                        executionId: identities.executionId,
                        attemptId: identities.attemptId,
                        generation: identities.generation,
                        state: payload.state,
                        occurredAt,
                        summary: payload.summary,
                        transcriptRef:
                          typeof payload.transcriptRef === "string" &&
                          payload.transcriptRef.trim().length > 0
                            ? payload.transcriptRef.trim()
                            : undefined,
                        outcomeState:
                          typeof payload.outcomeState === "string" &&
                          payload.outcomeState.trim().length > 0
                            ? payload.outcomeState.trim()
                            : undefined,
                        diagnosticMessage:
                          typeof payload.diagnosticMessage === "string" &&
                          payload.diagnosticMessage.trim().length > 0
                            ? payload.diagnosticMessage.trim()
                            : undefined,
                      },
                      onTerminalPersisted: (event) => {
                        // Decision 0033 review follow-up: capture the exact
                        // committed aggregate below. `onTerminalPersisted` is
                        // the post-commit seam (it fires ONLY for a `recorded`
                        // terminal — journal row + aggregate + outbox all
                        // committed in one transaction), so this is the only
                        // place the ordinary-terminal release below can learn
                        // the durable truth it must gate on.
                        if (
                          (event.result.execution.observedState === "succeeded" ||
                            event.result.execution.observedState === "failed") &&
                          event.result.execution.desiredState ===
                            event.result.execution.observedState
                        ) {
                          durableOrdinaryTerminal = {
                            executionId: event.result.execution.executionId,
                            attemptId: event.result.execution.attemptId,
                            generation: event.result.execution.generation,
                          };
                        }
                        // T07-AC1: completion delivery may begin only now
                        // (journal + aggregate are committed). Ticket 08:
                        // the durable completion-outbox entry was created
                        // in the SAME transaction — announce the pending
                        // completion on the operator runtime-event surface
                        // (bounded payload only). Ticket 09 owns the
                        // parent follow-up-turn consumer.
                        offerRuntimeEvent({
                          ...makeEventBase(context),
                          type: "runtime.warning",
                          payload: {
                            message: `Pi subagent execution ${event.result.execution.observedState} with durable terminal evidence [${event.result.execution.executionId}]`,
                            detail: {
                              executionId: event.result.execution.executionId,
                              observedState: event.result.execution.observedState,
                            },
                          },
                          raw: {
                            source: "pi.sdk.event",
                            method: "subagents/terminal-settled",
                            payload: {
                              executionId: event.result.execution.executionId,
                              observedState: event.result.execution.observedState,
                              attemptId: event.result.execution.attemptId,
                              generation: event.result.execution.generation,
                            },
                          },
                        } satisfies ProviderRuntimeEvent);
                        if (event.result.kind === "recorded") {
                          // Ticket 09: the durable pending entry now has a
                          // production consumer. When the session's
                          // extension acknowledged completion-delivery
                          // ownership (capability handshake), drive the
                          // per-thread coordinator (batching + safe
                          // boundary + follow-up). Otherwise the legacy
                          // extension nudge owns delivery: disposition the
                          // entry as legacy-delivered so it never
                          // accumulates and Synara never double-notifies
                          // (T09-AC5 mixed-version boundary).
                          const ownsDelivery =
                            subagentCapability.capabilities?.includes(
                              "completion-delivery-ownership",
                            ) === true;
                          if (ownsDelivery && piSubagentCompletionCoordinator) {
                            piSubagentCompletionCoordinator.onCompletionPending({
                              parentThreadId: String(input.threadId),
                            });
                          } else {
                            const outboxId = `outbox_${event.result.execution.executionId}_${event.result.execution.attemptId}_gen${event.result.execution.generation}`;
                            const now = new Date().toISOString();
                            void Effect.runPromise(
                              Effect.gen(function* () {
                                yield* piSubagentRepository.markCompletionDelivered({
                                  outboxId,
                                  now,
                                });
                                yield* piSubagentRepository.markCompletionAcknowledged({
                                  outboxId,
                                  now,
                                });
                              }),
                            ).catch(() => {
                              // The entry stays recoverable-pending; Ticket
                              // 10 startup recovery re-dispositions it.
                            });
                            offerRuntimeEvent({
                              ...makeEventBase(context),
                              type: "runtime.warning",
                              payload: {
                                message: `Pi subagent completion delivery owned by legacy extension [${event.result.execution.executionId}]`,
                                detail: {
                                  executionId: event.result.execution.executionId,
                                  ownership: "legacy",
                                },
                              },
                              raw: {
                                source: "pi.sdk.event",
                                method: "subagents/completion-legacy-owned",
                                payload: {
                                  executionId: event.result.execution.executionId,
                                  attemptId: event.result.execution.attemptId,
                                  generation: event.result.execution.generation,
                                  outboxId,
                                },
                              },
                            } satisfies ProviderRuntimeEvent);
                          }
                          offerRuntimeEvent({
                            ...makeEventBase(context),
                            type: "runtime.warning",
                            payload: {
                              message: `Pi subagent completion outbox pending [${event.result.execution.executionId}]`,
                              detail: {
                                executionId: event.result.execution.executionId,
                                attemptId: event.result.execution.attemptId,
                                generation: event.result.execution.generation,
                                deliveryState: "pending",
                              },
                            },
                            raw: {
                              source: "pi.sdk.event",
                              method: "subagents/completion-outbox-pending",
                              payload: {
                                executionId: event.result.execution.executionId,
                                attemptId: event.result.execution.attemptId,
                                generation: event.result.execution.generation,
                                outboxId: `outbox_${event.result.execution.executionId}_${event.result.execution.attemptId}_gen${event.result.execution.generation}`,
                                terminalState: event.result.execution.observedState,
                              },
                            },
                          } satisfies ProviderRuntimeEvent);
                        }
                      },
                      onDiagnostic: (event) => {
                        offerRuntimeEvent({
                          ...makeEventBase(context),
                          type: "runtime.warning",
                          payload: {
                            message: `Pi subagent terminal diagnostic [${event.diagnosticCode}]: ${event.diagnosticMessage}`,
                            detail: {
                              executionId: event.executionId,
                              diagnosticCode: event.diagnosticCode,
                            },
                          },
                          raw: {
                            source: "pi.sdk.event",
                            method: "subagents/terminal-diagnostic",
                            payload: {
                              executionId: event.executionId,
                              diagnosticCode: event.diagnosticCode,
                            },
                          },
                        } satisfies ProviderRuntimeEvent);
                      },
                      onTerminalPersistenceFailed: (event) => {
                        if (adapterControlHealth) {
                          void Effect.runPromise(
                            adapterControlHealth.markDegraded(
                              `Failed to persist terminal evidence: ${event.diagnosticMessage}`,
                              "pi_subagent_terminal_persistence_failed",
                              { threadId: input.threadId },
                            ),
                          ).then((transition) => {
                            if (transition) {
                              offerSubagentControlHealthWarning(transition);
                            }
                          });
                        }
                      },
                    }),
                  ),
                );
                if (ingest._tag === "Failure") {
                  const err = new Error("pi_subagent_terminal_persistence_failed");
                  (err as any).diagnosticCode = "pi_subagent_terminal_persistence_failed";
                  throw err;
                }
                if (durableOrdinaryTerminal !== undefined) {
                  // Decision 0033 review follow-up (bounded lifecycle): this
                  // is the ONLY ordinary release path for the opaque owner
                  // execution mapping. It runs strictly AFTER the durable
                  // terminal commit made this exact execution terminal —
                  // never on the observation alone, never on a stale
                  // (`ignored_stale`/`already_applied` returns nothing above)
                  // or failed persistence (the Failure branch threw), and
                  // never for a cancelling/teardown-eligible execution (the
                  // guard in onTerminalPersisted requires the committed
                  // observed AND desired state to be the ordinary terminal
                  // succeeded/failed). A durably succeeded/failed execution
                  // never enters the band-74 teardown scan, so keeping the
                  // mapping would pin a stopped owner bridge for the adapter
                  // lifetime; cancelling executions keep theirs until the
                  // post-band-76 proven diagnostic clears them.
                  releasePiSubagentOwnedTeardownExecution(durableOrdinaryTerminal);
                }
                // A child terminal observation is not child-process-tree
                // proof: a Bash root can settle while a captured descendant
                // remains alive. A cancelling/teardown-eligible execution
                // therefore retains the opaque owner endpoint until the
                // Ticket-16 coordinator durably commits band 76/fences the
                // exact generation; only that post-proof path releases it.
                return;
              }

              // Ticket 23 observation kinds take the coalescing/UPDATE-only
              // paths — they never journal and never touch desired/observed
              // state. Only started/detached keep the ticket-22 lifecycle
              // journal semantics (T23-AC5: lifecycle is never discarded by
              // the progress queue because it never enters it).
              if (obsInput.kind === "progress") {
                const progressJson =
                  typeof obsInput.progressJson === "string" ? obsInput.progressJson : "";
                await subagentProgressCoalescer.recordProgress(
                  identities.executionId,
                  progressJson,
                  correlationToolCallId,
                );
                return;
              }
              if (obsInput.kind === "heartbeat") {
                recordHeartbeatObservation(occurredAt);
                return;
              }

              if (obsInput.kind === "started") {
                if (startedPromise) {
                  return startedPromise;
                }
                startedPromise = (async () => {
                  const eventId = `evt_${identities.executionId}_${identities.attemptId}_gen${identities.generation}_seq2_started`;
                  const metadata = {
                    phase: "started",
                    occurredAt,
                    attachmentMode: "foreground",
                    foregroundWaitMs,
                  };
                  const recordEffect = piSubagentRepository.recordLifecycleEvent({
                    eventId,
                    executionId: identities.executionId,
                    attemptId: identities.attemptId,
                    generation: identities.generation,
                    sequence: 2,
                    state: "running",
                    occurredAt,
                    metadataJson: JSON.stringify(metadata),
                  });
                  const result = await Effect.runPromise(Effect.result(recordEffect));
                  if (result._tag === "Failure") {
                    const error = result.failure;
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (adapterControlHealth) {
                      const transition = await Effect.runPromise(
                        adapterControlHealth.markDegraded(
                          `Failed to persist execution lifecycle truth: ${errorMessage}`,
                          "pi_subagent_lifecycle_persistence_failed",
                          { threadId: input.threadId },
                        ),
                      );
                      if (transition) {
                        offerSubagentControlHealthWarning(transition);
                      }
                    }
                    const err = new Error("pi_subagent_lifecycle_persistence_failed");
                    (err as any).diagnosticCode = "pi_subagent_lifecycle_persistence_failed";
                    throw err;
                  }
                })();
                return startedPromise;
              }

              // detached observation
              if (detachedPromise) {
                return detachedPromise;
              }
              if (!startedPromise) {
                throw new Error("Cannot record detached before started observation");
              }
              detachedPromise = (async () => {
                // Sequence 2 must settle before sequence 3
                await startedPromise;
                const eventId = `evt_${identities.executionId}_${identities.attemptId}_gen${identities.generation}_seq3_detached`;
                const metadata = {
                  phase: "detached",
                  occurredAt,
                  attachmentMode: "foreground",
                  foregroundWaitMs,
                };
                const recordEffect = piSubagentRepository.recordLifecycleEvent({
                  eventId,
                  executionId: identities.executionId,
                  attemptId: identities.attemptId,
                  generation: identities.generation,
                  sequence: 3,
                  state: "running",
                  occurredAt,
                  metadataJson: JSON.stringify(metadata),
                });
                const result = await Effect.runPromise(Effect.result(recordEffect));
                if (result._tag === "Failure") {
                  const error = result.failure;
                  const errorMessage = error instanceof Error ? error.message : String(error);
                  if (adapterControlHealth) {
                    const transition = await Effect.runPromise(
                      adapterControlHealth.markDegraded(
                        `Failed to persist execution lifecycle truth: ${errorMessage}`,
                        "pi_subagent_lifecycle_persistence_failed",
                        { threadId: input.threadId },
                      ),
                    );
                    if (transition) {
                      offerSubagentControlHealthWarning(transition);
                    }
                  }
                  const err = new Error("pi_subagent_lifecycle_persistence_failed");
                  (err as any).diagnosticCode = "pi_subagent_lifecycle_persistence_failed";
                  throw err;
                }
              })();
              return detachedPromise;
            };
            return { reportObservation };
          };

          const wrapAgentTool = (target: any) => {
            if (!target || target.__synaraAdmissionWrapped) {
              return;
            }
            const exec =
              typeof target.execute === "function" ? target.execute : target.definition?.execute;
            if (typeof exec !== "function") {
              return;
            }
            const targetObj = typeof target.execute === "function" ? target : target.definition;
            const originalExecute = exec.bind(targetObj);
            // Ticket 14: expose the ORIGINAL (pre-wrap) execute for the
            // explicit-resume launcher — resume must not re-run admission.
            (targetObj as any).__synaraOriginalExecute = originalExecute;
            target.__synaraAdmissionWrapped = true;
            targetObj.__synaraAdmissionWrapped = true;
            targetObj.execute = async (
              toolCallId: string,
              params: any,
              signal?: any,
              onUpdate?: any,
              ctx?: any,
            ) => {
              const clientCommandKey =
                typeof params?.commandId === "string" && params.commandId.trim().length > 0
                  ? params.commandId.trim()
                  : toolCallId;
              let mintedCommandId = mintedCommandIds.get(clientCommandKey);
              if (mintedCommandId === undefined) {
                mintedCommandId = `cmd_${crypto.randomUUID()}`;
                mintedCommandIds.set(clientCommandKey, mintedCommandId);
              }
              const agentType =
                typeof params?.subagent_type === "string" && params.subagent_type.trim().length > 0
                  ? params.subagent_type.trim()
                  : typeof params?.agentType === "string" && params.agentType.trim().length > 0
                    ? params.agentType.trim()
                    : "general-purpose";
              const prompt =
                typeof params?.task === "string" && params.task.trim().length > 0
                  ? params.task.trim()
                  : typeof params?.prompt === "string" && params.prompt.trim().length > 0
                    ? params.prompt.trim()
                    : "";
              const mode = params?.run_in_background
                ? ("background" as const)
                : params?.mode === "background"
                  ? ("background" as const)
                  : ("foreground" as const);

              // Server truth only: thread/project/turn derive from the session
              // input, the server-tracked active turn, and the orchestration
              // snapshot — never from extension params.
              if (adapterSnapshotQuery === undefined) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Subagent spawn rejected [pi_subagent_admission_unauthorized]: server projection snapshot is unavailable; admission cannot be authorized`,
                    },
                  ],
                  isError: true,
                  status: "rejected",
                  diagnosticCode: "pi_subagent_admission_unauthorized",
                  rejectionReason:
                    "server projection snapshot is unavailable; admission cannot be authorized",
                };
              }
              const snapshotResult = await Effect.runPromise(
                Effect.result(adapterSnapshotQuery.getSnapshot()),
              );
              if (snapshotResult._tag === "Failure") {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Subagent spawn rejected [pi_subagent_admission_unauthorized]: server projection snapshot failed to load`,
                    },
                  ],
                  isError: true,
                  status: "rejected",
                  diagnosticCode: "pi_subagent_admission_unauthorized",
                  rejectionReason: "server projection snapshot failed to load",
                };
              }
              const thread = snapshotResult.success.threads.find((t) => t.id === input.threadId);
              if (!thread) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Subagent spawn rejected [pi_subagent_admission_unauthorized]: parent thread '${input.threadId}' not found in server projection`,
                    },
                  ],
                  isError: true,
                  status: "rejected",
                  diagnosticCode: "pi_subagent_admission_unauthorized",
                  rejectionReason: `Parent thread '${input.threadId}' not found in server projection`,
                };
              }

              // Ticket 14: persist the admission-time delegation triplet so
              // an explicit resume can rebuild the exact four-string
              // delegation request the Agent tool validates.
              const delegationContext =
                typeof params.context === "string" && params.context.trim().length > 0
                  ? params.context.trim()
                  : undefined;
              const delegationLinkReferences =
                typeof params.link_references === "string" &&
                params.link_references.trim().length > 0
                  ? params.link_references.trim()
                  : undefined;
              const delegationExpectedOutcome =
                typeof params.expected_outcome === "string" &&
                params.expected_outcome.trim().length > 0
                  ? params.expected_outcome.trim()
                  : undefined;
              // Ticket 14: the resolved child model at tool-call time, so an
              // explicit resume runs the new attempt on the SAME provider.
              const ctxModel = ctx?.model;
              const resolvedModel =
                ctxModel && typeof ctxModel.provider === "string" && typeof ctxModel.id === "string"
                  ? `${ctxModel.provider}/${ctxModel.id}`
                  : undefined;
              const command: PiSubagentSpawnCommand = {
                commandId: mintedCommandId,
                clientCommandId: clientCommandKey,
                projectId: thread.projectId,
                parentThreadId: input.threadId,
                parentTurnId: context.activeTurnId ?? null,
                parentToolCallId: toolCallId,
                agentType,
                prompt,
                ...(delegationContext === undefined ? {} : { delegationContext }),
                ...(delegationLinkReferences === undefined ? {} : { delegationLinkReferences }),
                ...(delegationExpectedOutcome === undefined ? {} : { delegationExpectedOutcome }),
                ...(resolvedModel === undefined ? {} : { resolvedModel }),
                mode,
                cancellationScope: "parent_turn",
              };

              let admissionResult: PiSubagentSpawnResult;
              try {
                admissionResult = await Effect.runPromise(
                  admitSubagentSpawn({
                    command,
                    sessionCapability: subagentCapability,
                    snapshotQuery: adapterSnapshotQuery,
                    repository: piSubagentRepository,
                    controlHealth: adapterControlHealth,
                    onHealthTransition: (transition) => {
                      offerSubagentControlHealthWarning(transition);
                    },
                    trustedContext: {
                      trustedThreadId: input.threadId,
                      trustedProjectId: thread.projectId,
                      trustedActiveTurnId: context.activeTurnId ?? null,
                      trustedProvider: PROVIDER,
                      mcpAuthority: input.mcpAuthority ?? null,
                    },
                    admissionPolicy: {
                      providerConcurrency:
                        serverConfig.piSubagentProviderConcurrency ??
                        DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY,
                      serverQueueCap:
                        serverConfig.piSubagentServerQueueCap ??
                        DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP,
                      projectQueueCap:
                        serverConfig.piSubagentProjectQueueCap ??
                        DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP,
                    },
                    ...(mcpSessionAuthority === undefined
                      ? {}
                      : { authorityRegistry: mcpSessionAuthority }),
                  }),
                );
              } catch (cause) {
                const message = cause instanceof Error ? cause.message : String(cause);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Subagent spawn rejected [pi_subagent_admission_rejected]: ${message}`,
                    },
                  ],
                  isError: true,
                  status: "rejected",
                  diagnosticCode: "pi_subagent_admission_rejected",
                  rejectionReason: message,
                };
              }

              options?.onSubagentAdmission?.({
                threadId: input.threadId,
                command,
                result: admissionResult,
              });

              if (admissionResult.status === "rejected") {
                // Ticket 13 (T13-AC5): default logs carry correlation IDs and
                // stable diagnostic code only. Never log command.prompt,
                // rejectionReason, result content, transcript, or secrets.
                void Effect.runPromise(
                  Effect.logWarning(
                    "pi.subagent.admission_rejected",
                    makePiSubagentSafeCorrelation({
                      executionId: admissionResult.executionId,
                      attemptId: admissionResult.attemptId,
                      threadId: String(input.threadId),
                      generation: admissionResult.generation,
                      diagnosticCode: admissionResult.diagnosticCode,
                    }),
                  ),
                ).catch(() => undefined);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Subagent spawn rejected [${admissionResult.diagnosticCode}]: ${admissionResult.rejectionReason ?? admissionResult.diagnosticCode}`,
                    },
                  ],
                  isError: true,
                  status: "rejected",
                  diagnosticCode: admissionResult.diagnosticCode,
                  rejectionReason: admissionResult.rejectionReason,
                };
              }

              if (admissionResult.status === "already_applied") {
                // Redelivery must not rebind child ownership. The original
                // accepted execution is the only one that created the child
                // and registered its opaque endpoint; a newer parent session
                // may receive this idempotent reply but owns no child to tear
                // down. Replacing the retained mapping here would discard the
                // actual old owner and turn an eligible handoff into band 78.
                return {
                  content: [
                    {
                      type: "text",
                      text: `Subagent spawn already applied [pi_subagent_already_applied]: executionId=${admissionResult.executionId}, attemptId=${admissionResult.attemptId}, generation=${admissionResult.generation}`,
                    },
                  ],
                  executionId: admissionResult.executionId,
                  attemptId: admissionResult.attemptId,
                  generation: admissionResult.generation,
                };
              }

              const childParams = {
                ...params,
                executionId: admissionResult.executionId,
                attemptId: admissionResult.attemptId,
                generation: admissionResult.generation,
              };
              registerPiSubagentOwnedTeardownExecution(context, {
                executionId: admissionResult.executionId,
                attemptId: admissionResult.attemptId,
                generation: admissionResult.generation,
              });

              const baseCtx = ctx ?? {
                ui: makePiExtensionUIContext(context),
                cwd: context.session.cwd,
              };

              const foregroundWaitMs =
                serverConfig.piSubagentForegroundWaitMs ?? DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS;

              // Ticket 14: the shared per-attempt observation runtime (spawn
              // path — post-admission identities; the explicit resume launcher
              // re-enters the same factory with resumed identities).
              const { reportObservation } = makeAttemptObservationRuntime(
                {
                  executionId: admissionResult.executionId,
                  attemptId: admissionResult.attemptId,
                  generation: admissionResult.generation,
                },
                toolCallId,
                foregroundWaitMs,
              );

              const binding: PiSubagentManagedForegroundBinding = Object.freeze({
                executionId: admissionResult.executionId,
                attemptId: admissionResult.attemptId,
                generation: admissionResult.generation,
                cancellationScope: "parent_turn" as const,
                foregroundWaitMs,
                reportObservation,
                // Ticket 23 policy pass-through: resolved server config knobs
                // (guard-validated range) so a managed extension coalesces at
                // the server-configured cadence and heartbeats the lease the
                // server expects.
                progress: { rateHz: progressRateHz },
                heartbeat: { intervalMs: heartbeatIntervalMs, leaseMs: leaseDurationMs },
              });

              const effectiveCtx = attachPiSubagentManagedForegroundBinding(baseCtx, binding);

              try {
                const res = await originalExecute(
                  toolCallId,
                  childParams,
                  signal,
                  onUpdate,
                  effectiveCtx,
                );
                if (res && typeof res === "object" && !res.isError) {
                  return {
                    ...res,
                    executionId: admissionResult.executionId,
                    attemptId: admissionResult.attemptId,
                    generation: admissionResult.generation,
                  };
                }
                return res;
              } finally {
                // Inline completion releases observation ownership for this
                // execution: pending latest snapshot is flushed once, timers
                // are cancelled, and the per-execution slot is removed
                // (T23-AC6). Detached executions rely on the idle-TTL
                // self-cleanup instead.
                await subagentProgressCoalescer
                  .dispose(admissionResult.executionId)
                  .catch(() => undefined);
              }
            };
          };

          for (const ext of loadedExtensions) {
            if (ext && ext.tools instanceof Map && ext.tools.has("Agent")) {
              const agentEntry = ext.tools.get("Agent");
              if (agentEntry) {
                wrapAgentTool(agentEntry.definition ?? agentEntry);
              }
            }
          }
          const allTools = runtime.session.getAllTools();
          const sessionAgentTool = allTools.find((t: any) => t.name === "Agent");
          if (sessionAgentTool) {
            wrapAgentTool(sessionAgentTool);
          }

          // Ticket 14 (T14-AC1/AC6): capture the ORIGINAL (unwrapped) Agent
          // tool execute plus this session's per-attempt runtime for explicit
          // resume. The resume coordinator has ALREADY run the shared
          // admission gates and durably committed the new attempt (queued,
          // advanced generation) — so the launcher must NOT re-enter the
          // wrapped path (which mints a fresh admission) and instead starts
          // the child exactly like a spawn post-admission: identities in
          // params, observation/binding machinery attached, one child start.
          // getAllTools() returns name/description snapshots (no execute); the
          // wrap itself targeted the extension registry entry (or its
          // `definition`), so the resume launcher resolves the original from
          // exactly those objects.
          const resumeToolEntry = loadedExtensions
            .filter((ext: any) => ext && ext.tools instanceof Map && ext.tools.has("Agent"))
            .map((ext: any) => ext.tools.get("Agent"))
            .map((entry: any) => (typeof entry?.execute === "function" ? entry : entry?.definition))
            .find((entry: any) => entry?.__synaraOriginalExecute !== undefined);
          const originalAgentExecute =
            typeof (resumeToolEntry as any)?.__synaraOriginalExecute === "function"
              ? ((resumeToolEntry as any).__synaraOriginalExecute as (
                  toolCallId: string,
                  params: any,
                  signal?: any,
                  onUpdate?: any,
                  ctx?: any,
                ) => Promise<unknown>)
              : undefined;
          if (originalAgentExecute) {
            context.piSubagentResumeLauncher = async (attempt) => {
              // Ticket 14: rebuild the four-string delegation request from
              // the durable admission triplet. Legacy rows (NULL columns)
              // stamp explicit gap-naming placeholders — the resume never
              // fabricates the original context silently.
              const delegationContext =
                attempt.delegationContext ??
                "Original context was not persisted before resume support; this explicit resume replays the original task only.";
              const delegationLinkReferences = attempt.delegationLinkReferences ?? "None";
              const delegationExpectedOutcome =
                attempt.delegationExpectedOutcome ??
                "Outcome was not persisted before resume support; complete the original task.";
              const childParams = {
                subagent_type: attempt.agentType,
                task: attempt.prompt,
                context: delegationContext,
                link_references: delegationLinkReferences,
                expected_outcome: delegationExpectedOutcome,
                run_in_background: attempt.mode === "background",
                mode: attempt.mode,
                executionId: attempt.executionId,
                attemptId: attempt.attemptId,
                generation: attempt.generation,
              };
              // Mirror the spawn path EXACTLY (post-admission): attach the
              // per-attempt observation runtime + managed foreground binding
              // so the resumed child reports started/running/progress/
              // terminal through the same durable machinery as a fresh
              // spawn. Without this the attempt stays `queued` forever —
              // the durable journal never sees the child truth.
              const foregroundWaitMs =
                serverConfig.piSubagentForegroundWaitMs ?? DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS;
              const { reportObservation } = makeAttemptObservationRuntime(
                {
                  executionId: attempt.executionId,
                  attemptId: attempt.attemptId,
                  generation: attempt.generation,
                },
                `resume_${attempt.executionId}_${attempt.attemptId}`,
                foregroundWaitMs,
              );
              const binding: PiSubagentManagedForegroundBinding = Object.freeze({
                executionId: attempt.executionId,
                attemptId: attempt.attemptId,
                generation: attempt.generation,
                cancellationScope: "parent_turn" as const,
                foregroundWaitMs,
                reportObservation,
                progress: { rateHz: progressRateHz },
                heartbeat: { intervalMs: heartbeatIntervalMs, leaseMs: leaseDurationMs },
              });
              registerPiSubagentOwnedTeardownExecution(context, {
                executionId: attempt.executionId,
                attemptId: attempt.attemptId,
                generation: attempt.generation,
              });
              // The Agent tool execute contract expects an ExtensionContext-
              // shaped object. The runner's live context is not exposed to
              // adapters, so rebuild the exact fields the subagent runner
              // consumes (agent-runner: cwd, sessionManager identity,
              // system prompt, model + registry resolution, UI bridge) from
              // the production session context.
              // Same-provider replay: resolve the STORED model selection
              // through the session registry; fall back to the current
              // session model only when the stored selection is missing
              // (legacy row) or no longer installed.
              let replayModel =
                attempt.resolvedModel !== undefined ? undefined : context.runtime.session.model;
              if (attempt.resolvedModel !== undefined) {
                const slash = attempt.resolvedModel.indexOf("/");
                if (slash > 0) {
                  replayModel =
                    context.modelRegistry.find(
                      attempt.resolvedModel.slice(0, slash),
                      attempt.resolvedModel.slice(slash + 1),
                    ) ?? context.runtime.session.model;
                }
              }
              const baseCtx = {
                ui: makePiExtensionUIContext(context),
                cwd: context.session.cwd,
                sessionManager: context.runtime.session.sessionManager,
                modelRegistry: context.modelRegistry,
                model: replayModel,
                getSystemPrompt: () => "",
              };
              await originalAgentExecute(
                `resume_${attempt.executionId}_${attempt.attemptId}`,
                childParams,
                undefined,
                undefined,
                attachPiSubagentManagedForegroundBinding(baseCtx, binding),
              );
            };
          }
        }

        if (loadedExtensions.length > 0) {
          const extensionNames = loadedExtensions.map(extensionDisplayName);
          offerRuntimeEvent({
            ...makeEventBase(context, { includeTurnId: false }),
            type: "runtime.warning",
            payload: {
              message:
                "Pi extensions are loaded with Synara's limited UI bridge. select/confirm/input/notify/status are supported; TUI-only widgets and editor hooks are ignored.",
              detail: {
                extensionCount: loadedExtensions.length,
                extensions: extensionNames,
              },
            },
            raw: {
              source: "pi.sdk.event",
              method: "extension/ui-limited-warning",
              payload: { extensionCount: loadedExtensions.length, extensions: extensionNames },
            },
          } satisfies ProviderRuntimeEvent);
        }
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "session.started",
          payload: { message: "Pi session started", resume: session.resumeCursor },
        } satisfies ProviderRuntimeEvent);
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "thread.started",
          payload: { providerThreadId: runtime.session.sessionId },
        } satisfies ProviderRuntimeEvent);
        const initialUsage = normalizeTokenUsage(
          runtime.session.getSessionStats(),
          runtime.session.model?.contextWindow,
        );
        context.lastKnownTokenUsage = initialUsage;
        if (initialUsage) {
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "thread.token-usage.updated",
            payload: { usage: initialUsage },
          } satisfies ProviderRuntimeEvent);
        }
        // Decision 35 default-mode capture: the session reached its normal
        // ready state; the observer records the complete live manifest before
        // the first measured turn. The observer is non-throwing and absent in
        // normal runs.
        safeObserve(() =>
          catalogObserver?.onSessionReady({
            threadId: String(input.threadId),
            session: runtime.session,
            lifecycleGeneration: input.lifecycleGeneration,
          }),
        );
        return session;
      });

    const buildPromptPayload = (input: {
      readonly input?: string | undefined;
      readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
    }) =>
      Effect.gen(function* () {
        const text =
          appendFileAttachmentsPromptBlock({
            text: input.input,
            attachments: input.attachments,
            attachmentsDir: serverConfig.attachmentsDir,
            include: "all-files",
          }) ?? "";
        const images = yield* Effect.forEach(
          input.attachments ?? [],
          (attachment) =>
            Effect.gen(function* () {
              if (attachment.type !== "image" || !attachment.mimeType) return undefined;
              const attachmentPath = resolveProviderAttachmentPath({
                attachmentsDir: serverConfig.attachmentsDir,
                attachment,
              });
              if (!attachmentPath) {
                return yield* new ProviderAdapterValidationError({
                  provider: PROVIDER,
                  operation: "turn/start",
                  issue: `Invalid attachment id '${attachment.id}'.`,
                });
              }
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "turn/start",
                      detail: toMessage(cause, "Failed to read attachment file."),
                      cause,
                    }),
                ),
              );
              return {
                type: "image" as const,
                data: Buffer.from(bytes).toString("base64"),
                mimeType: attachment.mimeType,
              };
            }),
          { concurrency: 1 },
        );
        return {
          text,
          images: images.filter((image): image is ImageContent => image !== undefined),
        };
      });

    const sendTurn: PiAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        if (context.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "A Pi turn is already active for this thread.",
          });
        }
        if (input.modelSelection?.provider === "pi") {
          const model = findModelInRegistry(context.modelRegistry, input.modelSelection.model);
          if (!model) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "model/set",
              issue: `Pi model '${input.modelSelection.model}' is not available. Use a discovered model or a provider-qualified custom model slug like 'openai/gpt-5.5'.`,
            });
          }
          yield* Effect.tryPromise({
            try: () => context.runtime.session.setModel(model),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "model/set",
                detail: toMessage(cause, "Failed to set Pi model."),
                cause,
              }),
          });
          const thinkingLevel = normalizePiThinkingLevel(
            input.modelSelection.options?.thinkingLevel,
          );
          if (thinkingLevel) {
            context.runtime.session.setThinkingLevel(thinkingLevel);
          }
        }
        const payload = yield* buildPromptPayload(input);
        const turnId = TurnId.makeUnsafe(crypto.randomUUID());
        context.activeTurnId = turnId;
        context.turns.push({ id: turnId, items: [] });
        context.session = makeSessionSnapshot(context);
        if (payload.images.length === 0 && isPiReloadCommand(payload.text)) {
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "turn.started",
            payload: {
              ...(context.runtime.session.model
                ? {
                    model: `${context.runtime.session.model.provider}/${context.runtime.session.model.id}`,
                  }
                : {}),
              effort: context.runtime.session.thinkingLevel,
            },
            raw: { source: "pi.sdk.event", method: "reload", payload: { command: payload.text } },
          } satisfies ProviderRuntimeEvent);
          yield* Effect.tryPromise({
            try: () => context.runtime.session.reload(),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/reload",
                detail: toMessage(cause, "Failed to reload Pi resources."),
                cause,
              }),
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                const message = error.message;
                offerRuntimeEvent({
                  ...makeEventBase(context),
                  type: "turn.completed",
                  payload: { state: "failed", stopReason: "error", errorMessage: message },
                  raw: { source: "pi.sdk.event", method: "reload", payload: error },
                } satisfies ProviderRuntimeEvent);
                offerRuntimeError(context, {
                  message,
                  method: "session/reload",
                  cause: error,
                });
                context.activeTurnId = undefined;
                context.session = makeSessionSnapshot(context);
                return yield* Effect.fail(error);
              }),
            ),
          );
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "turn.completed",
            payload: { state: "completed", stopReason: "reload" },
            raw: { source: "pi.sdk.event", method: "reload", payload: { command: payload.text } },
          } satisfies ProviderRuntimeEvent);
          context.activeTurnId = undefined;
          context.session = makeSessionSnapshot(context);
          return {
            threadId: input.threadId,
            turnId,
            resumeCursor: getSessionFile(context.runtime.session),
          };
        }
        const harnessPolicy = takeSynaraHarnessPolicyForProviderSession(context, {
          provider: PROVIDER,
          scopedGatewayConnectionAvailable: context.gatewayControlAvailable,
        });
        const providerText = [harnessPolicy, payload.text].filter(Boolean).join("\n\n");
        // Decision 35 activated-mode capture: the first prompt in the
        // resulting catalog state (the enable command never reaches sendTurn;
        // it is owned by the command boundary). The observer records the
        // complete live manifest only after the proven activation commit,
        // while the committed activation lifecycle generation is still
        // current, and never throws.
        safeObserve(() =>
          catalogObserver?.onTurnPrompt({
            threadId: String(input.threadId),
            session: context.runtime.session,
            lifecycleGeneration: context.observerCurrentLifecycleGeneration?.current,
          }),
        );
        void context.runtime.session
          .prompt(providerText, payload.images.length > 0 ? { images: payload.images } : undefined)
          .catch((cause) => {
            completePromptRejection(context, turnId, cause);
          });
        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: getSessionFile(context.runtime.session),
        };
      });

    const steerTurn: NonNullable<PiAdapterShape["steerTurn"]> = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        const payload = yield* buildPromptPayload(input);
        const harnessPolicy = takeSynaraHarnessPolicyForProviderSession(context, {
          provider: PROVIDER,
          scopedGatewayConnectionAvailable: context.gatewayControlAvailable,
        });
        const providerText = [harnessPolicy, payload.text].filter(Boolean).join("\n\n");
        const turnId = context.activeTurnId ?? TurnId.makeUnsafe(crypto.randomUUID());
        if (!context.activeTurnId) {
          context.activeTurnId = turnId;
          context.turns.push({ id: turnId, items: [] });
        }
        if (context.runtime.session.isStreaming) {
          yield* Effect.tryPromise({
            try: () => context.runtime.session.steer(providerText, payload.images),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "turn/steer",
                detail: toMessage(cause, "Failed to steer Pi turn."),
                cause,
              }),
          });
        } else {
          void context.runtime.session
            .prompt(
              providerText,
              payload.images.length > 0 ? { images: payload.images } : undefined,
            )
            .catch((cause) => {
              completePromptRejection(context, turnId, cause);
            });
        }
        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: getSessionFile(context.runtime.session),
        };
      });

    const interruptTurn: PiAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (turnId !== undefined && turnId !== context.activeTurnId) {
          yield* Effect.logWarning("pi.stale_interrupt_ignored", {
            threadId,
            requestedTurnId: turnId,
            activeTurnId: context.activeTurnId,
          });
          return;
        }
        // Ticket 06: durable parent-turn cancellation runs BEFORE the
        // provider-turn interrupt — the cancellation intent is journaled
        // first (T06-AC1), then dispatched to every managed child in the
        // parent-turn scope (T06-AC2) with bounded retry and acknowledgement
        // waits. The provider-turn interrupt below is the FIRST ESCALATION
        // STAGE (T06-AC6) and runs regardless of the coordinator outcome:
        // its own `session.abort()` resolution is never treated as
        // termination proof (T06-AC5).
        if (context.subagentCapability?.isManaged && piSubagentRepository) {
          const bridgeForCancel =
            context.subagentCapability.capabilities?.includes("durable-cancellation") === true
              ? extractPiSubagentBridge(context.runtime.session)
              : undefined;
          const cancelOutcome = yield* cancelParentTurnScope({
            threadId,
            repository: piSubagentRepository,
            bridge: bridgeForCancel,
            isOwnerGenerationDead: () => false,
            listActive: () =>
              typeof bridgeForCancel?.getActiveExecutions === "function"
                ? bridgeForCancel.getActiveExecutions()
                : undefined,
            cancelAckTimeoutMs: serverConfig.piSubagentCancelAckTimeoutMs,
            cancelRetryLimit: serverConfig.piSubagentCancelRetryLimit,
            leaseDurationMs: serverConfig.piSubagentLeaseDurationMs,
            onDiagnostic: (event: {
              readonly executionId: string;
              readonly diagnosticCode: string;
              readonly diagnosticMessage: string;
            }) => {
              offerRuntimeEvent({
                ...makeEventBase(context),
                type: "runtime.warning",
                payload: {
                  message: `Pi subagent cancellation remains pending [${event.diagnosticCode}]: ${event.diagnosticMessage}`,
                  detail: {
                    executionId: event.executionId,
                    diagnosticCode: event.diagnosticCode,
                  },
                },
                raw: {
                  source: "pi.sdk.event",
                  method: "subagents/cancel-diagnostic",
                  payload: {
                    executionId: event.executionId,
                    diagnosticCode: event.diagnosticCode,
                  },
                },
              } satisfies ProviderRuntimeEvent);
            },
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "subagents/cancel-parent-turn",
                  detail: toMessage(cause, "Failed to run durable parent-turn cancellation."),
                  cause,
                }),
            ),
          );
          for (const outcome of cancelOutcome.outcomes) {
            if (outcome.kind === "cancelled_ack" || outcome.kind === "cancelled_owner_death") {
              // Cancellation acknowledgement/owner death settles this
              // lifecycle attempt but is not root-and-descendant teardown
              // proof. Keep the exact opaque child owner for a later
              // Ticket-16 handoff; only durable band 76 may release it.
              offerRuntimeEvent({
                ...makeEventBase(context),
                type: "runtime.warning",
                payload: {
                  message: `Pi subagent execution cancelled with termination evidence [${outcome.executionId}]`,
                  detail: {
                    executionId: outcome.executionId,
                    evidence: outcome.kind,
                  },
                },
                raw: {
                  source: "pi.sdk.event",
                  method: "subagents/cancel-settled",
                  payload: {
                    executionId: outcome.executionId,
                    evidence: outcome.kind,
                  },
                },
              } satisfies ProviderRuntimeEvent);
            }
          }
        }
        yield* Effect.tryPromise({
          try: () => context.runtime.session.abort(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/interrupt",
              detail: toMessage(cause, "Failed to interrupt Pi turn."),
              cause,
            }),
        });
      });

    // Ticket 14 (T14-AC1..AC6): per-execution explicit resume driven by the
    // orphaned execution card. The card command is authorization-correlated
    // (thread existence + provider routing); the resume coordinator re-runs
    // the SAME shared admission gates as a fresh spawn, durably commits the
    // new attempt (queued, advanced generation) BEFORE any child start, then
    // launches exactly one child attempt through this session's captured
    // launcher. Unmanaged sessions or missing launchers surface a denial
    // diagnostic instead of a silent no-op.
    const resumePiSubagentExecution: PiAdapterShape["resumePiSubagentExecution"] = (
      threadId,
      executionId,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!context.subagentCapability?.isManaged || !piSubagentRepository) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "subagents/resume-execution",
            detail:
              "Pi subagent managed execution is not enabled for this session; the execution cannot be resumed through the explicit path.",
          });
        }
        const launcher = context.piSubagentResumeLauncher;
        if (launcher === undefined) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "subagents/resume-execution",
            detail:
              "No managed Agent tool launcher is available for this session; the execution cannot be resumed.",
          });
        }
        if (adapterSnapshotQuery === undefined) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "subagents/resume-execution",
            detail: "Server projection snapshot is unavailable; resume cannot be authorized.",
          });
        }
        // Server truth only: the trusted project derives from the orchestration
        // snapshot thread — never from the command or the execution row.
        const snapshotForResume = yield* Effect.result(adapterSnapshotQuery.getSnapshot());
        if (snapshotForResume._tag === "Failure") {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "subagents/resume-execution",
            detail: "Server projection snapshot failed to load; resume cannot be authorized.",
          });
        }
        const resumeThread = snapshotForResume.success.threads.find((t) => t.id === threadId);
        if (!resumeThread) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "subagents/resume-execution",
            detail: `Parent thread '${threadId}' not found in server projection.`,
          });
        }
        const trustedProjectId = resumeThread.projectId;
        const outcome = yield* resumePiSubagentExecutionCoordinator({
          executionId,
          threadId: String(threadId),
          sessionCapability: context.subagentCapability,
          snapshotQuery: adapterSnapshotQuery,
          repository: piSubagentRepository,
          ...(adapterControlHealth === undefined ? {} : { controlHealth: adapterControlHealth }),
          onHealthTransition: (transition) => {
            offerSubagentControlHealthWarning(transition);
          },
          trustedContext: {
            trustedThreadId: threadId,
            trustedProjectId,
            trustedActiveTurnId: context.activeTurnId ?? null,
            trustedProvider: PROVIDER,
            mcpAuthority: context.mcpAuthority ?? null,
          },
          ...(mcpSessionAuthority === undefined ? {} : { authorityRegistry: mcpSessionAuthority }),
          admissionPolicy: {
            providerConcurrency:
              serverConfig.piSubagentProviderConcurrency ??
              DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY,
            serverQueueCap:
              serverConfig.piSubagentServerQueueCap ?? DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP,
            projectQueueCap:
              serverConfig.piSubagentProjectQueueCap ?? DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP,
          },
          launchChildAttempt: (attempt) =>
            launcher({
              executionId: attempt.executionId,
              attemptId: attempt.attemptId,
              generation: attempt.generation,
              agentType: attempt.execution.agentType,
              prompt: attempt.execution.prompt,
              mode: attempt.execution.mode,
              ...(attempt.execution.delegationContext === undefined
                ? {}
                : { delegationContext: attempt.execution.delegationContext }),
              ...(attempt.execution.delegationLinkReferences === undefined
                ? {}
                : { delegationLinkReferences: attempt.execution.delegationLinkReferences }),
              ...(attempt.execution.delegationExpectedOutcome === undefined
                ? {}
                : { delegationExpectedOutcome: attempt.execution.delegationExpectedOutcome }),
              ...(attempt.execution.resolvedModel === undefined
                ? {}
                : { resolvedModel: attempt.execution.resolvedModel }),
            }),
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "subagents/resume-execution",
                detail: toMessage(cause, "Failed to run the explicit subagent execution resume."),
                cause,
              }),
          ),
        );
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "runtime.warning",
          payload: {
            message: `Pi subagent execution resume settled [${outcome.kind}]: ${outcome.executionId}`,
            detail: {
              executionId: outcome.executionId,
              outcome: outcome.kind,
              ...("attemptId" in outcome ? { attemptId: outcome.attemptId } : {}),
              ...("diagnosticCode" in outcome ? { diagnosticCode: outcome.diagnosticCode } : {}),
            },
          },
          raw: {
            source: "pi.sdk.event",
            method: "subagents/resume-settled",
            payload: {
              executionId: outcome.executionId,
              outcome: outcome.kind,
              ...("attemptId" in outcome ? { attemptId: outcome.attemptId } : {}),
              ...("generation" in outcome ? { generation: outcome.generation } : {}),
              ...("diagnosticCode" in outcome ? { diagnosticCode: outcome.diagnosticCode } : {}),
            },
          },
        } satisfies ProviderRuntimeEvent);
        if (outcome.kind !== "resumed" && outcome.kind !== "already_applied") {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "subagents/resume-execution",
            detail: `Pi subagent resume denied [${outcome.kind}]: ${
              "rejectionReason" in outcome && typeof outcome.rejectionReason === "string"
                ? outcome.rejectionReason
                : "diagnosticMessage" in outcome && typeof outcome.diagnosticMessage === "string"
                  ? outcome.diagnosticMessage
                  : "error" in outcome && typeof outcome.error === "string"
                    ? outcome.error
                    : `execution ${outcome.executionId}`
            }`,
          });
        }
      });

    // Ticket 11 (T11-AC6): per-execution durable cancel driven by the
    // execution card. The card command is authorization-correlated (thread
    // existence + provider routing); the coordinator enforces the same
    // journal-first, fenced, evidence-settled protocol as the parent-turn
    // scope. Unmanaged sessions surface a denial diagnostic instead of a
    // silent no-op, and the provider turn is NOT interrupted — the card cancel
    // targets the child only.
    const cancelPiSubagentExecution: PiAdapterShape["cancelPiSubagentExecution"] = (
      threadId,
      executionId,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!context.subagentCapability?.isManaged || !piSubagentRepository) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "subagents/cancel-execution",
            detail:
              "Pi subagent managed execution is not enabled for this session; the execution cannot be cancelled through the durable path.",
          });
        }
        const bridgeForCancel =
          context.subagentCapability.capabilities?.includes("durable-cancellation") === true
            ? extractPiSubagentBridge(context.runtime.session)
            : undefined;
        const result = yield* cancelSinglePiSubagentExecution({
          threadId: String(threadId),
          executionId,
          repository: piSubagentRepository,
          bridge: bridgeForCancel,
          isOwnerGenerationDead: () => false,
          listActive: () =>
            typeof bridgeForCancel?.getActiveExecutions === "function"
              ? bridgeForCancel.getActiveExecutions()
              : undefined,
          cancelAckTimeoutMs: serverConfig.piSubagentCancelAckTimeoutMs,
          cancelRetryLimit: serverConfig.piSubagentCancelRetryLimit,
          leaseDurationMs: serverConfig.piSubagentLeaseDurationMs,
          onDiagnostic: (event: {
            readonly executionId: string;
            readonly diagnosticCode: string;
            readonly diagnosticMessage: string;
          }) => {
            offerRuntimeEvent({
              ...makeEventBase(context),
              type: "runtime.warning",
              payload: {
                message: `Pi subagent cancellation remains pending [${event.diagnosticCode}]: ${event.diagnosticMessage}`,
                detail: {
                  executionId: event.executionId,
                  diagnosticCode: event.diagnosticCode,
                },
              },
              raw: {
                source: "pi.sdk.event",
                method: "subagents/cancel-diagnostic",
                payload: {
                  executionId: event.executionId,
                  diagnosticCode: event.diagnosticCode,
                },
              },
            } satisfies ProviderRuntimeEvent);
          },
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "subagents/cancel-execution",
                detail: toMessage(cause, "Failed to run durable execution cancellation."),
                cause,
              }),
          ),
        );
        const outcome = result.outcome;
        if (outcome.kind === "cancelled_ack" || outcome.kind === "cancelled_owner_death") {
          // See parent-turn cancellation: acknowledgement is lifecycle
          // evidence, not child process-tree proof, so it cannot release
          // this exact owner mapping before a durable band-76 fence.
          offerRuntimeEvent({
            ...makeEventBase(context),
            type: "runtime.warning",
            payload: {
              message: `Pi subagent execution cancelled with termination evidence [${outcome.executionId}]`,
              detail: {
                executionId: outcome.executionId,
                evidence: outcome.kind,
              },
            },
            raw: {
              source: "pi.sdk.event",
              method: "subagents/cancel-settled",
              payload: {
                executionId: outcome.executionId,
                evidence: outcome.kind,
              },
            },
          } satisfies ProviderRuntimeEvent);
        }
      });

    const respondUnsupported = (threadId: ThreadId, method: string) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method,
          detail: `Pi does not expose Synara approval/user-input requests for thread ${threadId}.`,
        }),
      );

    const respondToUserInput: PiAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!resolvePiExtensionUserInput(context, requestId, answers)) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "user-input/respond",
            detail: `Unknown pending Pi user-input request: ${requestId}`,
          });
        }
      });

    const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) return;
        yield* Effect.tryPromise({
          try: () => disposeSessionContext(context),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/stop",
              detail: toMessage(cause, "Failed to stop Pi session."),
              cause,
            }),
        });
        if (sessions.get(threadId) === context) {
          sessions.delete(threadId);
          coordinatorEligibleThreads.delete(String(threadId));
        }
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "thread.state.changed",
          payload: { state: "closed", detail: { reason: "stopped" } },
        } satisfies ProviderRuntimeEvent);
        offerRuntimeEvent({
          ...makeEventBase(context),
          type: "session.exited",
          payload: { reason: "stopped", exitKind: "graceful" },
        } satisfies ProviderRuntimeEvent);
      });

    // Ticket 15: one adapter-lifetime watchdog escalation sweep — the
    // production consumer of the ticket 13 band-60 wall-time triggers and
    // the production lease-expiry sweep driver Ticket 10 recorded as Ticket
    // 15 scope. Stage 1 reuses the ticket 06 durable cancel protocol; stage
    // 2 interrupts the live provider turn; stage 3 stops the provider
    // session through the adapter's own stop path (which disposes the
    // runtime and proves its subprocess trees exited). The watchdog never
    // settles projection: uncertain cleanup journals the teardown-handoff
    // record owned by Ticket 16.
    const piSubagentWatchdogSweep =
      piSubagentRepository === undefined
        ? undefined
        : startPiSubagentWatchdogSweep({
            repository: piSubagentRepository,
            resolveBridge: (threadId) => {
              const context = sessions.get(ThreadId.makeUnsafe(threadId));
              if (
                context === undefined ||
                context.stopped ||
                !context.subagentCapability?.isManaged ||
                context.subagentCapability.capabilities?.includes("durable-cancellation") !== true
              ) {
                return undefined;
              }
              return extractPiSubagentBridge(context.runtime.session);
            },
            isOwnerGenerationDead: () => false,
            interruptProviderTurn: async (threadId) => {
              const context = sessions.get(ThreadId.makeUnsafe(threadId));
              if (context === undefined || context.stopped) {
                return;
              }
              await context.runtime.session.abort();
            },
            stopProviderSession: async (threadId) => {
              const target = ThreadId.makeUnsafe(threadId);
              const context = sessions.get(target);
              if (context === undefined) {
                // No live session: nothing to stop — cleanup is uncertain and
                // the teardown stage owns the proof (T15-AC6).
                return "uncertain" as const;
              }
              try {
                await Effect.runPromise(stopSession(target));
                return sessions.has(target) ? ("uncertain" as const) : ("stopped" as const);
              } catch {
                return "uncertain" as const;
              }
            },
            stageTimeoutMs: serverConfig.piSubagentWatchdogStageTimeoutMs,
            cancelRetryLimit: serverConfig.piSubagentCancelRetryLimit,
            leaseDurationMs: serverConfig.piSubagentLeaseDurationMs,
            idleAfterMs: serverConfig.piSubagentOrphanAfterMs,
            // AC1 entry/stage diagnostics reach the operator surface through
            // the same safe-correlation runtime-warning path as the ticket 13
            // wall-time trigger (fixed vocabulary + correlation only).
            onDiagnostic: (event) => {
              const safeCorrelation = makePiSubagentSafeCorrelation({
                executionId: event.executionId,
                attemptId: event.attemptId,
                threadId: event.parentThreadId,
                generation: event.generation,
                diagnosticCode: event.diagnosticCode,
              });
              const context = sessions.get(ThreadId.makeUnsafe(event.parentThreadId));
              const logWarning = Effect.logWarning("pi.subagent.watchdog_diagnostic", {
                ...safeCorrelation,
                message: event.diagnosticMessage,
              });
              void Effect.runPromise(logWarning).catch(() => undefined);
              if (context !== undefined) {
                offerRuntimeEvent({
                  ...makePiRuntimeEventBase(context),
                  type: "runtime.warning",
                  payload: {
                    message: `Pi subagent watchdog [${event.diagnosticCode}]: ${event.diagnosticMessage}`,
                    detail: safeCorrelation,
                  },
                  raw: {
                    source: "pi.sdk.event",
                    method: "subagents/watchdog-diagnostic",
                    payload: safeCorrelation,
                  },
                } satisfies ProviderRuntimeEvent);
              }
            },
            ...(options?.piSubagentWatchdogClock?.now
              ? { now: options.piSubagentWatchdogClock.now }
              : {}),
            ...(options?.piSubagentWatchdogClock?.schedule
              ? { schedule: options.piSubagentWatchdogClock.schedule }
              : {}),
            ...(options?.piSubagentWatchdogClock?.intervalMs !== undefined
              ? { intervalMs: options.piSubagentWatchdogClock.intervalMs }
              : {}),
            onEscalation: (escalation) => {
              const safeDetail = makePiSubagentSafeCorrelation({
                executionId: escalation.executionId,
                attemptId: escalation.attemptId,
                threadId: escalation.parentThreadId,
                generation: escalation.generation,
                diagnosticCode: "pi_subagent_watchdog_stage_timeout",
              });
              void Effect.runPromise(
                Effect.logWarning("pi.subagent.watchdog_escalated", {
                  ...safeDetail,
                  trigger: escalation.trigger,
                  outcome: escalation.outcomeKind,
                }),
              ).catch(() => undefined);
              offerRuntimeEvent({
                ...makePiRuntimeEventBase(
                  {
                    session: { threadId: ThreadId.makeUnsafe(escalation.parentThreadId) },
                    activeTurnId: undefined,
                  },
                  { includeTurnId: false },
                ),
                type: "runtime.warning",
                payload: {
                  message: `Pi subagent watchdog escalated [${escalation.trigger}] → ${escalation.outcomeKind}`,
                  detail: {
                    ...safeDetail,
                    trigger: escalation.trigger,
                    outcome: escalation.outcomeKind,
                  },
                },
                raw: {
                  source: "pi.sdk.event",
                  method: "subagents/watchdog-escalated",
                  payload: safeDetail,
                },
              } satisfies ProviderRuntimeEvent);
            },
          });

    // Ticket 16 / Decision 0033: one adapter-lifetime owned process-tree
    // teardown sweep — the production consumer of the ticket 15 band-74
    // teardown handoffs. Managed-child teardown NEVER falls back to the
    // parent process supervisor. It resolves only the exact admitted
    // execution's retained opaque owner endpoint and dispatches only the
    // identity-fenced `teardownOwnedProcesses` bridge helper; every
    // absent/malformed/mismatched/thrown/unavailable path degrades to
    // `undefined` so the coordinator journals the honest band-78
    // owner-unproven outcome with no kill and no fence.
    const piSubagentTeardownSweep =
      piSubagentRepository === undefined
        ? undefined
        : startPiSubagentProcessTeardownSweep({
            repository: piSubagentRepository,
            resolveOwnedTeardown: async (execution) => {
              if (options?.piSubagentTeardownResolver !== undefined) {
                return options.piSubagentTeardownResolver(execution);
              }
              const ownedExecution = piSubagentOwnedTeardownExecutions.get(
                piSubagentOwnedTeardownExecutionKey(execution),
              );
              if (ownedExecution === undefined) {
                return undefined;
              }
              const owner = piSubagentOwnedTeardownOwners.get(ownedExecution.ownerKey);
              if (owner === undefined) {
                piSubagentOwnedTeardownExecutions.delete(
                  piSubagentOwnedTeardownExecutionKey(execution),
                );
                return undefined;
              }
              const dispatch = await dispatchPiSubagentTeardownOwnedProcesses(
                owner.bridge,
                {
                  commandId: `teardowncmd_${execution.executionId}_${execution.attemptId}_gen${String(
                    execution.generation,
                  )}_${execution.parentThreadId}`,
                  executionId: execution.executionId,
                  expectedAttemptId: execution.attemptId,
                  expectedGeneration: execution.generation,
                },
                // Decision 0033 §6 host-side bound reuses the existing Pi
                // watchdog stage timeout (T15-AC1 default/bounds; no new
                // knob): a hung opaque owner endpoint degrades to the
                // non-terminal band-78 owner-unproven path below so the
                // sweep still completes and schedules its next pass.
                { timeoutMs: serverConfig.piSubagentWatchdogStageTimeoutMs },
              );
              if (dispatch.kind !== "validated") {
                return undefined;
              }
              if (dispatch.result.status === "proven") {
                // Keep the exact opaque owner mapping until the coordinator
                // commits band 76 plus its cancellation/fence transaction.
                // A valid endpoint reply alone is not durable proof; if that
                // write fails, the next pass must be able to ask this owner
                // again instead of degrading to a synthetic owner-unproven.
                return { kind: "proven" };
              }
              if (dispatch.result.status === "survivors") {
                return {
                  kind: "survivors",
                  ...(dispatch.result.survivorPids === undefined
                    ? {}
                    : { survivorPids: dispatch.result.survivorPids }),
                };
              }
              return undefined;
            },
            onDiagnostic: (event) => {
              if (event.diagnosticCode === PI_SUBAGENT_TEARDOWN_PROVEN_DIAGNOSTIC) {
                // teardownOne emits this diagnostic only after
                // recordTeardownOutcome durably committed the proven
                // settlement/fence. This is the first safe moment to
                // release the retained child-owner endpoint.
                releasePiSubagentOwnedTeardownExecution({
                  executionId: event.executionId,
                  attemptId: event.attemptId,
                  generation: event.generation,
                });
              }
              const safeCorrelation = makePiSubagentSafeCorrelation({
                executionId: event.executionId,
                attemptId: event.attemptId,
                threadId: event.parentThreadId,
                generation: event.generation,
                diagnosticCode: event.diagnosticCode,
              });
              const context = sessions.get(ThreadId.makeUnsafe(event.parentThreadId));
              const logWarning = Effect.logWarning("pi.subagent.teardown_diagnostic", {
                ...safeCorrelation,
                message: event.diagnosticMessage,
              });
              void Effect.runPromise(logWarning).catch(() => undefined);
              if (context !== undefined) {
                offerRuntimeEvent({
                  ...makePiRuntimeEventBase(context),
                  type: "runtime.warning",
                  payload: {
                    message: `Pi subagent teardown [${event.diagnosticCode}]: ${event.diagnosticMessage}`,
                    detail: safeCorrelation,
                  },
                  raw: {
                    source: "pi.sdk.event",
                    method: "subagents/teardown-diagnostic",
                    payload: safeCorrelation,
                  },
                } satisfies ProviderRuntimeEvent);
              }
            },
            ...(options?.piSubagentTeardownClock?.now
              ? { now: options.piSubagentTeardownClock.now }
              : {}),
            ...(options?.piSubagentTeardownClock?.schedule
              ? { schedule: options.piSubagentTeardownClock.schedule }
              : {}),
            ...(options?.piSubagentTeardownClock?.intervalMs !== undefined
              ? { intervalMs: options.piSubagentTeardownClock.intervalMs }
              : {}),
            onOutcome: (outcome) => {
              const safeDetail = makePiSubagentSafeCorrelation({
                executionId: outcome.executionId,
                attemptId: outcome.attemptId,
                threadId: outcome.parentThreadId,
                generation: outcome.generation,
                // Truthful per-outcome code from the sweep driver — never a
                // hardcoded proof literal (review remediation).
                diagnosticCode: outcome.diagnosticCode,
              });
              void Effect.runPromise(
                Effect.logWarning("pi.subagent.teardown_outcome", {
                  ...safeDetail,
                  outcome: outcome.outcomeKind,
                }),
              ).catch(() => undefined);
            },
          });

    const enableSynaraMcp: NonNullable<PiAdapterShape["enableSynaraMcp"]> = (input) =>
      Effect.gen(function* () {
        const context = sessions.get(input.threadId);
        if (context === undefined) {
          // No live Pi session: activation cannot be proven (fail-closed).
          // The wait-set member is an unsafe disappearance for the
          // operation and drives the project rollback (Decisions 10/16).
          return {
            state: "unavailable",
            detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
          } satisfies ProviderEnableSynaraMcpResult;
        }
        const outcome = yield* Effect.tryPromise({
          try: () =>
            enablePiSynaraMcpSession({
              threadId: input.threadId,
              coordinator: context.synaraMcpCoordinator,
              adapter: context.synaraMcp,
              expectedSessionGeneration: input.expectedSessionGeneration,
              liveSessionGeneration: input.liveSessionGeneration,
              // A running turn keeps its tool surface until agent_end; an
              // idle session has no active turn, so the safe boundary is
              // immediate (pumped locally by the enable helper).
              ...(context.activeTurnId === undefined ? {} : { activeTurnId: context.activeTurnId }),
              isStillIdle: () => context.activeTurnId === undefined,
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "synara-mcp/enable",
              detail: toMessage(cause, "Failed to enable Synara MCP for the Pi session."),
              cause,
            }),
        });
        if (outcome.state === "unavailable") {
          yield* Effect.logWarning("pi.synara_mcp_enable_unavailable", {
            threadId: input.threadId,
          });
        }
        return outcome;
      });

    const disableSynaraMcp: NonNullable<PiAdapterShape["disableSynaraMcp"]> = (input) =>
      Effect.gen(function* () {
        const context = sessions.get(input.threadId);
        if (context === undefined) {
          // No live Pi session: nothing to fence, drain, or revoke. The
          // durable desired-disabled acceptance is already journaled by the
          // command boundary; this is an idempotent no-op.
          return {
            state: "dormant",
            alreadyDisabled: true,
          } satisfies ProviderDisableSynaraMcpResult;
        }
        const outcome = yield* Effect.tryPromise({
          try: () =>
            disablePiSynaraMcpSession({
              coordinator: context.synaraMcpCoordinator,
              executions: context.synaraMcpExecutions,
              // The exact turn active at disable time: its write authority is
              // retired before the gateway cancellation (Decision 14 step 2).
              ...(context.activeTurnId === undefined ? {} : { activeTurnId: context.activeTurnId }),
              // A running turn keeps its tool surface until agent_end; an idle
              // session has no active turn, so the safe boundary is immediate.
              awaitSafeBoundary: context.activeTurnId !== undefined,
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "synara-mcp/disable",
              detail: toMessage(cause, "Failed to disable Synara MCP for the Pi session."),
              cause,
            }),
        });
        if (outcome.state === "unavailable") {
          yield* Effect.logWarning("pi.synara_mcp_disable_unavailable", {
            threadId: input.threadId,
          });
        }
        return outcome;
      });

    const listSessions: PiAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values()).map(makeSessionSnapshot));

    const hasSession: PiAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const snapshotThread = (context: PiSessionContext): ProviderThreadSnapshot => {
      const historyItems = mapMessageHistory(context.runtime.session);
      const activeTurn = context.activeTurnId
        ? context.turns.find((turn) => turn.id === context.activeTurnId)
        : undefined;
      const turns = [
        ...(historyItems.length > 0
          ? [
              {
                id: TurnId.makeUnsafe(`pi-history-${context.runtime.session.sessionId}`),
                items: historyItems,
              },
            ]
          : []),
        ...(activeTurn ? [{ id: activeTurn.id, items: [...activeTurn.items] }] : []),
      ];
      return {
        threadId: context.session.threadId,
        ...(context.session.cwd ? { cwd: context.session.cwd } : {}),
        turns:
          turns.length > 0
            ? turns
            : context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
      };
    };

    const readThread: PiAdapterShape["readThread"] = (threadId) =>
      requireSession(threadId).pipe(Effect.map(snapshotThread));

    const rollbackThread: PiAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const nextLength = Math.max(0, context.turns.length - Math.max(0, numTurns));
        context.turns.splice(nextLength);
        const leafId = context.turns.at(-1)?.leafId;
        if (leafId) {
          context.runtime.session.sessionManager.branch(leafId);
        } else if (nextLength === 0) {
          context.runtime.session.sessionManager.resetLeaf();
        }
        return snapshotThread(context);
      });

    const compactThread: NonNullable<PiAdapterShape["compactThread"]> = (threadId) =>
      requireSession(threadId).pipe(
        Effect.flatMap((context) =>
          Effect.tryPromise({
            try: () => context.runtime.session.compact(),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "thread/compact",
                detail: toMessage(cause, "Failed to compact Pi thread."),
                cause,
              }),
          }),
        ),
        Effect.asVoid,
      );

    const stopAll: PiAdapterShape["stopAll"] = () =>
      Effect.sync(() => {
        piSubagentWallTimeSweep?.stop();
        piSubagentWatchdogSweep?.stop();
        piSubagentTeardownSweep?.stop();
      }).pipe(
        Effect.andThen(
          Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
            concurrency: "unbounded",
            discard: true,
          }),
        ),
        Effect.asVoid,
      );

    const listModels: NonNullable<PiAdapterShape["listModels"]> = (input) =>
      Effect.tryPromise({
        try: async () => {
          const piSdk = await loadPiSdkPromise("model/list");
          const agentDir = makeAgentDir(input.agentDir, piSdk);
          const cwd = trimToUndefined(input.cwd) ?? serverConfig.cwd;
          const modelRuntime = await createPiModelRuntime(agentDir, piSdk);
          const services = await piSdk.createAgentSessionServices({
            cwd,
            agentDir,
            modelRuntime,
          });
          const registry = modelRegistryFacade(services.modelRuntime, piSdk);
          const extensionCount = services.resourceLoader.getExtensions().extensions.length;
          const models = getPiDiscoverableModels(registry).flatMap((model) => {
            const descriptor = toPiProviderModelDescriptor(
              model,
              registry.getProviderDisplayName.bind(registry),
            );
            return descriptor ? [descriptor] : [];
          });
          return {
            models,
            source: extensionCount > 0 ? "pi.sdk+extensions" : "pi.sdk",
            cached: false,
          } satisfies ProviderListModelsResult;
        },
        catch: (cause) => toPiSdkRequestError("model/list", cause, "Failed to list Pi models."),
      });

    const listSkills: NonNullable<PiAdapterShape["listSkills"]> = (input) =>
      Effect.tryPromise({
        try: async () => {
          const active = input.threadId
            ? sessions.get(ThreadId.makeUnsafe(input.threadId))
            : undefined;
          const loader = active?.runtime.session.resourceLoader;
          if (active && input.forceReload) {
            await active.runtime.session.reload();
          }
          let services:
            | Awaited<ReturnType<PiCodingAgentModule["createAgentSessionServices"]>>
            | undefined;
          if (!loader) {
            const piSdk = await loadPiSdkPromise("skill/list");
            services = await piSdk.createAgentSessionServices({
              cwd: input.cwd,
              agentDir: makeAgentDir(input.agentDir, piSdk),
            });
          }
          if (services && input.forceReload) {
            await services.resourceLoader.reload();
          }
          const resourceLoader = loader ?? services?.resourceLoader;
          if (!resourceLoader) {
            throw new Error("Failed to create Pi resource loader.");
          }
          const result = resourceLoader.getSkills();
          return {
            skills: result.skills.map((skill) => {
              const description = trimToUndefined(skill.description);
              const scope = trimToUndefined(skill.sourceInfo.source);
              const mappedSkill: {
                name: string;
                path: string;
                enabled: boolean;
                description?: string;
                scope?: string;
              } = {
                name: skill.name,
                path: skill.filePath,
                enabled: !skill.disableModelInvocation,
              };
              if (description !== undefined) mappedSkill.description = description;
              if (scope !== undefined) mappedSkill.scope = scope;
              return mappedSkill;
            }),
            source: "pi.sdk",
            cached: false,
          } satisfies ProviderListSkillsResult;
        },
        catch: (cause) => toPiSdkRequestError("skill/list", cause, "Failed to list Pi skills."),
      });

    const listCommands: NonNullable<PiAdapterShape["listCommands"]> = (input) =>
      Effect.tryPromise({
        try: async () => {
          const active = input.threadId
            ? sessions.get(ThreadId.makeUnsafe(input.threadId))
            : undefined;
          const session = active?.runtime.session;
          const reloadCommand = {
            name: "reload",
            description: "Reload Pi extensions, skills, prompts, themes, tools, and settings",
          };
          if (session) {
            if (input.forceReload) {
              await session.reload();
            }
            const extensionCommands = session.extensionRunner
              .getRegisteredCommands()
              .map((command) => ({
                name: command.invocationName,
                description: trimToUndefined(command.description) ?? "Extension command",
              }));
            const promptCommands = session.promptTemplates.map((template) => ({
              name: template.name,
              description: trimToUndefined(template.description) ?? "Prompt template",
            }));
            const skillCommands = session.resourceLoader.getSkills().skills.map((skill) => ({
              name: `skill:${skill.name}`,
              description: trimToUndefined(skill.description) ?? "Skill",
            }));
            return {
              commands: [reloadCommand, ...extensionCommands, ...promptCommands, ...skillCommands],
              source: "pi.sdk",
              cached: false,
            } satisfies ProviderListCommandsResult;
          }
          const piSdk = await loadPiSdkPromise("command/list");
          const services = await piSdk.createAgentSessionServices({
            cwd: input.cwd,
            agentDir: makeAgentDir(input.agentDir, piSdk),
          });
          if (input.forceReload) {
            await services.resourceLoader.reload();
          }
          const promptCommands = services.resourceLoader.getPrompts().prompts.map((template) => ({
            name: template.name,
            description: trimToUndefined(template.description) ?? "Prompt template",
          }));
          const skillCommands = services.resourceLoader.getSkills().skills.map((skill) => ({
            name: `skill:${skill.name}`,
            description: trimToUndefined(skill.description) ?? "Skill",
          }));
          return {
            commands: [reloadCommand, ...promptCommands, ...skillCommands],
            source: "pi.sdk",
            cached: false,
          } satisfies ProviderListCommandsResult;
        },
        catch: (cause) => toPiSdkRequestError("command/list", cause, "Failed to list Pi commands."),
      });

    const getComposerCapabilities: NonNullable<PiAdapterShape["getComposerCapabilities"]> = () =>
      Effect.succeed({
        provider: PROVIDER,
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: true,
        supportsThreadCompaction: true,
        supportsThreadImport: false,
      } satisfies ProviderComposerCapabilities);

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.orDie,
        Effect.andThen(
          Effect.sync(() => {
            if (coordinatorRecoveryScanActive.timer !== undefined) {
              clearInterval(coordinatorRecoveryScanActive.timer);
              coordinatorRecoveryScanActive.timer = undefined;
            }
          }),
        ),
        Effect.andThen(runtimeEventIngress.stop),
        Effect.ensuring(
          ownsNativeEventLogger && nativeEventLogger
            ? nativeEventLogger.close().pipe(Effect.ignore)
            : Effect.void,
        ),
        Effect.ensuring(Queue.shutdown(runtimeEventQueue)),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
        supportsSkillMentions: true,
        supportsSkillDiscovery: true,
        supportsNativeSlashCommandDiscovery: true,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: true,
        supportsTurnSteering: true,
      },
      startSession,
      sendTurn,
      steerTurn,
      interruptTurn,
      cancelPiSubagentExecution,
      resumePiSubagentExecution,
      respondToRequest: (threadId) => respondUnsupported(threadId, "request/respond"),
      respondToUserInput,
      stopSession,
      enableSynaraMcp,
      disableSynaraMcp,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      compactThread,
      stopAll,
      listModels,
      listSkills,
      listCommands,
      getComposerCapabilities,
      get streamEvents() {
        return Stream.fromQueue(runtimeEventQueue);
      },
    } satisfies PiAdapterShape;
  });

export const PiAdapterLive = Layer.effect(PiAdapter, makePiAdapter());

export function makePiAdapterLive(options?: PiAdapterLiveOptions) {
  return Layer.effect(PiAdapter, makePiAdapter(options));
}
