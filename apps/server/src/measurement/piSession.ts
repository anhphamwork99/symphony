// FILE: piSession.ts
// Purpose: WP3 core — real Pi session boundary for the standalone driver
// (Decision 34 §5). Creates a fresh Pi session through the real Pi SDK
// (the same construction the PiAdapter uses), runs the fixed two-turn
// stimulus, captures raw SessionStats at startup and after every turn,
// enumerates the complete effective tool manifest through the real
// tool/schema API (`getAllTools()`), and invalidates turns that call tools.
import path from "node:path";

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
  CreateAgentSessionServicesOptions,
} from "@earendil-works/pi-coding-agent";

import { canonicalizeManifest, summarizeManifest, toCanonicalEntries } from "./canonicalize.ts";
import { makeTurnMeasurement } from "./records.ts";
import { STIMULUS_TEXT } from "./stimulus.ts";
import type {
  CanonicalManifestSummary,
  CanonicalToolEntry,
  ManifestCaptureInput,
  RawSessionStats,
  TurnMeasurement,
} from "./types.ts";

export interface PiSdkModule {
  readonly ModelRuntime: {
    create: (input: { readonly authPath: string; readonly modelsPath: string }) => unknown;
  };
  readonly ModelRegistry: new (modelRuntime: unknown) => PiModelRegistry;
  readonly SettingsManager: {
    create: (cwd: string, agentDir?: string) => PiSettingsManager;
  };
  readonly SessionManager: {
    create: (cwd: string) => unknown;
  };
  readonly createAgentSessionServices: (
    input: CreateAgentSessionServicesOptions,
  ) => Promise<unknown>;
  readonly createAgentSessionFromServices: (input: {
    readonly services: unknown;
    readonly sessionManager: unknown;
    readonly model?: unknown;
    readonly thinkingLevel?: ThinkingLevel;
    readonly customTools?: readonly unknown[];
  }) => Promise<{ readonly session: AgentSession }>;
  readonly createBashToolDefinition: (
    cwd: string,
    options?: { readonly operations?: unknown },
  ) => unknown;
  readonly createLocalBashOperations: () => unknown;
  readonly defineTool: (definition: unknown) => unknown;
}

interface PiModelRegistry {
  readonly find: (provider: string, id: string) => unknown;
  readonly getAll: () => ReadonlyArray<{
    readonly id: string;
    readonly provider: string;
    readonly api?: unknown;
    readonly baseUrl?: unknown;
  }>;
}

/** Settings accessors the harness uses to resolve Pi's configured default model. */
export interface PiSettingsManager {
  readonly getDefaultProvider: () => string | undefined;
  readonly getDefaultModel: () => string | undefined;
}

/** Raw settings.json surface relevant to default model resolution. */
export interface PiDefaultSettings {
  readonly defaultProvider?: string | undefined;
  readonly defaultModel?: string | undefined;
}

export interface PiSessionHandle {
  readonly session: AgentSession;
  readonly agentDir: string;
  readonly cwd: string;
  readonly modelId: string | undefined;
  readonly thinkingLevel: ThinkingLevel;
}

export interface TurnRunResult {
  readonly after: RawSessionStats;
  readonly toolCalls: readonly string[];
  readonly errorMessage: string | undefined;
  readonly completed: boolean;
}

export function parseModelReference(
  modelId: string | null | undefined,
): { readonly provider?: string; readonly id: string } | undefined {
  const trimmed = modelId?.trim();
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

export function resolvePiModel(
  registry: PiModelRegistry,
  modelId: string | null | undefined,
): unknown {
  const parsed = parseModelReference(modelId);
  if (!parsed) {
    return undefined;
  }
  if (parsed.provider) {
    const direct = registry.find(parsed.provider, parsed.id);
    if (direct) return direct;
    const providerDefault = registry.getAll().find((model) => model.provider === parsed.provider);
    if (!providerDefault) return undefined;
    return {
      id: parsed.id,
      name: parsed.id,
      api: providerDefault.api,
      provider: parsed.provider,
      baseUrl: providerDefault.baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      limit: { context: 0, output: 0 },
    };
  }
  return registry
    .getAll()
    .find((model) => model.id === parsed.id || `${model.provider}/${model.id}` === parsed.id);
}

export async function loadPiSdk(): Promise<PiSdkModule> {
  // Mirrors the PiAdapter's lazy load: the SDK is imported only when Pi is
  // actually used (it brings native dependencies with it).
  return (await import("@earendil-works/pi-coding-agent")) as unknown as PiSdkModule;
}

/**
 * Resolve Pi's configured default provider/model (settings.json) against the
 * real model registry. This is the corrected impl-11 behavior: the configured
 * default is authoritative and must exist in the registry — the harness never
 * silently substitutes an arbitrary first registry model (which broke
 * configuration equivalence and produced no-credential failures). Every
 * failure mode throws a clear diagnostic naming the exact problem.
 */
export function resolveConfiguredDefaultModel(
  settings: PiDefaultSettings,
  registry: Pick<PiModelRegistry, "find">,
): { readonly provider: string; readonly id: string } {
  const provider = settings.defaultProvider?.trim();
  const id = settings.defaultModel?.trim();
  if (!provider && !id) {
    throw new Error(
      `Pi settings.json has no configured default provider/model (defaultProvider/defaultModel unset). ` +
        `Configure Pi's default model, or pass --model=<provider>/<model> explicitly.`,
    );
  }
  if (!provider || !id) {
    throw new Error(
      `Pi settings.json has an incomplete default model configuration ` +
        `(defaultProvider=${provider ?? "(unset)"}, defaultModel=${id ?? "(unset)"}); ` +
        `set both in settings.json or pass --model=<provider>/<model> explicitly.`,
    );
  }
  if (registry.find(provider, id) === undefined) {
    throw new Error(
      `Configured Pi default model '${provider}/${id}' from settings.json is not present in the ` +
        `model registry of the agent directory. Fix defaultProvider/defaultModel in settings.json ` +
        `or pass --model=<provider>/<model> explicitly.`,
    );
  }
  return { provider, id };
}

/**
 * Resolve the Pi model id used for the whole measurement matrix. The Pi SDK
 * settings manager (same semantics Pi's own model selection uses) is read
 * from the agent dir; the configured default provider/model must exist in
 * the real model registry or the run fails with a clear diagnostic.
 */
export async function resolveConfiguredModelId(
  agentDir: string,
  piSdk?: PiSdkModule,
): Promise<string> {
  const sdk = piSdk ?? (await loadPiSdk());
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
  const registry = new sdk.ModelRegistry(modelRuntime) as PiModelRegistry;
  const settings = sdk.SettingsManager.create(process.cwd(), agentDir) as PiSettingsManager;
  const configured = resolveConfiguredDefaultModel(
    {
      defaultProvider: settings.getDefaultProvider(),
      defaultModel: settings.getDefaultModel(),
    },
    registry,
  );
  return `${configured.provider}/${configured.id}`;
}

function toRawSessionStats(stats: {
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
  readonly cost?: number;
}): RawSessionStats {
  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    total: stats.tokens.total,
    ...(typeof stats.cost === "number" ? { cost: stats.cost } : {}),
  };
}

/**
 * Create a fresh Pi session for measurement. The construction mirrors the
 * PiAdapter: cwd-bound services from the real SDK, a fresh SessionManager, an
 * optional model from the real model registry, the configured thinking level,
 * and the bash tool registered the same way the adapter registers it.
 * `extensionFactories` defaults to none (Pi standalone); the Synara-mode
 * manifest enumeration passes no Synara extension because the dormant
 * extension registers no tools before activation.
 */
export async function createMeasurementPiSession(input: {
  readonly cwd: string;
  readonly agentDir: string;
  readonly modelId?: string;
  readonly thinkingLevel: ThinkingLevel;
  readonly extensionFactories?: readonly unknown[];
}): Promise<PiSessionHandle> {
  const piSdk = await loadPiSdk();
  const modelRuntime = await piSdk.ModelRuntime.create({
    authPath: path.join(input.agentDir, "auth.json"),
    modelsPath: path.join(input.agentDir, "models.json"),
  });
  const services = (await piSdk.createAgentSessionServices({
    cwd: input.cwd,
    agentDir: input.agentDir,
    modelRuntime: modelRuntime as never,
    resourceLoaderOptions: {
      extensionFactories: [...(input.extensionFactories ?? [])] as never,
    },
  })) as unknown;
  const registry = new piSdk.ModelRegistry(modelRuntime) as PiModelRegistry;
  const model = resolvePiModel(registry, input.modelId);
  // Mirrors the PiAdapter: an explicit model id that the real registry cannot
  // resolve (and that has no provider fallback) is a hard session error — the
  // session must never silently fall back to a different model, which would
  // break configuration equivalence across modes.
  if (input.modelId !== undefined && model === undefined) {
    throw new Error(
      `Pi model '${input.modelId}' is not available in agent directory '${input.agentDir}'. ` +
        `Use a discovered model or a provider-qualified custom model slug.`,
    );
  }
  const sessionManager = piSdk.SessionManager.create(input.cwd);
  const bashTool = piSdk.defineTool(
    piSdk.createBashToolDefinition(input.cwd, {
      operations: piSdk.createLocalBashOperations(),
    }),
  );
  const created = await piSdk.createAgentSessionFromServices({
    services,
    sessionManager,
    ...(model === undefined ? {} : { model }),
    thinkingLevel: input.thinkingLevel,
    customTools: [bashTool],
  });
  return {
    session: created.session,
    agentDir: input.agentDir,
    cwd: input.cwd,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
  };
}

/** Resolved model metadata for configuration-equivalence evidence. */
export function resolvedModelDescription(handle: PiSessionHandle): string {
  const model = handle.session.model;
  if (!model) return "unset";
  const { provider, id } = model as { readonly provider?: string; readonly id?: string };
  return [provider, id].filter(Boolean).join("/");
}

/** Enumerate the complete effective tool manifest through the real tool API. */
export function enumerateToolManifest(session: AgentSession): CanonicalToolEntry[] {
  return toCanonicalEntries(session.getAllTools());
}

export function summarizeSessionManifest(
  session: AgentSession,
  input: Omit<ManifestCaptureInput, "tools">,
): CanonicalManifestSummary {
  return summarizeManifest({ ...input, tools: enumerateToolManifest(session) });
}

export function manifestSummaryFromEntries(
  tools: readonly CanonicalToolEntry[],
  input: Omit<ManifestCaptureInput, "tools">,
): CanonicalManifestSummary {
  return summarizeManifest({ ...input, tools });
}

/** Canonical bytes of a manifest entry list (for local full-manifest files). */
export function canonicalBytesOf(tools: readonly CanonicalToolEntry[]): Uint8Array {
  return canonicalizeManifest(tools);
}

function hasToolCallContent(event: AgentSessionEvent): boolean {
  if (event.type !== "agent_end") return false;
  return event.messages.some((message) =>
    messageContentParts(message).some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "toolCall",
    ),
  );
}

function messageContentParts(message: unknown): readonly unknown[] {
  if (typeof message !== "object" || message === null) return [];
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? content : [];
}

/**
 * Run one stimulus turn and wait for the real agent_end boundary. Returns the
 * raw cumulative SessionStats after the turn, any observed tool calls (which
 * invalidate the turn), and the agent error message when the turn failed.
 */
export async function runStimulusTurn(
  handle: PiSessionHandle,
  input: { readonly onToolCall?: (toolName: string) => void },
): Promise<TurnRunResult> {
  const toolCalls: string[] = [];
  let errorMessage: string | undefined;
  let settled = false;
  let settleError: unknown;

  const waitForEnd = new Promise<void>((resolve, reject) => {
    const unsubscribe = handle.session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        toolCalls.push(event.toolName);
        input.onToolCall?.(event.toolName);
        return;
      }
      if (event.type === "agent_end") {
        if (hasToolCallContent(event)) {
          // Assistant content contained tool calls even if execution events
          // were not observed; treat the turn as tool-calling.
          const names = event.messages
            .flatMap((message) => messageContentParts(message))
            .filter(
              (part) =>
                typeof part === "object" &&
                part !== null &&
                (part as { type?: string }).type === "toolCall",
            )
            .map((part) => (part as { name?: string }).name)
            .filter((name): name is string => typeof name === "string");
          toolCalls.push(...names);
        }
        if (event.willRetry) {
          // A retry is pending; keep waiting for the final agent_end.
          return;
        }
        const state = handle.session.agent.state;
        if (state.errorMessage) {
          errorMessage = state.errorMessage;
        }
        settled = true;
        unsubscribe();
        resolve();
      }
    });
  });

  try {
    await handle.session.prompt(STIMULUS_TEXT);
    await waitForEnd;
  } catch (cause) {
    settleError = cause;
  }

  // The prompt promise may reject while the event boundary already settled
  // the turn (or vice versa); prefer the event boundary when it completed.
  if (settled) {
    if (settleError !== undefined && errorMessage === undefined) {
      errorMessage = causeMessage(settleError);
    }
    return {
      after: toRawSessionStats(handle.session.getSessionStats()),
      toolCalls: [...new Set(toolCalls)],
      errorMessage,
      completed: true,
    };
  }
  // The turn never reached agent_end: the run failed at the session boundary.
  throw new Error(
    `Pi stimulus turn failed: ${causeMessage(settleError ?? new Error("agent_end never observed"))}`,
  );
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Build the WP2 turn measurement for one stimulus turn, including the
 * tool-call invalidation rule (Decision 34 §2: a run that invokes a tool is
 * invalid and must be rerun or reported as failed; tool-call output is never
 * folded into startup/catalog overhead).
 */
export function measureStandaloneTurn(input: {
  readonly turnIndex: number;
  readonly before: RawSessionStats;
  readonly after: RawSessionStats;
  readonly toolCalls: readonly string[];
  readonly errorMessage: string | undefined;
}): TurnMeasurement {
  const toolCallReason =
    input.toolCalls.length > 0
      ? `tool call observed: ${[...input.toolCalls].join(", ")}`
      : undefined;
  const errorReason =
    input.errorMessage !== undefined ? `turn failed: ${input.errorMessage}` : undefined;
  const invalidReason = [toolCallReason, errorReason].filter(Boolean).join(" | ") || undefined;
  return makeTurnMeasurement({
    turnIndex: input.turnIndex,
    before: input.before,
    after: input.after,
    // Standalone observes raw SessionStats directly; the Pi→Synara
    // cross-check surface does not exist in this mode.
    skipCrossCheck: true,
    ...(invalidReason === undefined ? {} : { invalidReason }),
  });
}
