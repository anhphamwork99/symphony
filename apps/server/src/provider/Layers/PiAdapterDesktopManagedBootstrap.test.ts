// FILE: PiAdapterDesktopManagedBootstrap.test.ts
// Purpose: Ticket 02 focused integration evidence for the desktop managed
// bootstrap at the `makePiAdapterLive` seam (AC1 / AC2 / AC5; spec
// Implementation Decisions 2/3/4/5; Decisions 0002–0004).
// Layer: Provider adapter integration tests (deterministic SDK mock).
// Depends: the REAL production desktop artifact gate + artifact verifier
// (against a real on-disk valid mini artifact fixture), the real gate→
// binding→bootstrap wiring inside `PiAdapter.startSession`, and a mocked
// `@earendil-works/pi-coding-agent` module that records every observed
// runtime configuration input. No real Pi process, no packaged desktop
// composition, no network, no git.

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Effect, Exit, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
} from "@synara/contracts";

import { ServerConfig, type ServerConfigShape } from "../../config";
import type { PiSubagentExecutionRepositoryShape } from "../../persistence/Services/PiSubagentExecutionRepository";
import type { ProviderAdapterError } from "../Errors";
import { PI_SUBAGENT_BRIDGE_KEY } from "../piSubagentBridge";
import type { PiSubagentHandshakeRequest } from "@synara/contracts";
import { PiAdapter } from "../Services/PiAdapter";
import { makePiAdapterLive } from "./PiAdapter";
import {
  SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV,
  PI_SUBAGENT_DESKTOP_MANAGED_AGENT_DIR_SEGMENT,
} from "../piSubagentDesktopArtifactGate";
import { PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL } from "../piSubagentManagedRuntimeBinding";

/**
 * What this suite proves that the two existing focused suites cannot:
 *
 * - `piSubagentDesktopArtifactGate.test.ts` proves the pure gate decision
 *   matrix; `piSubagentManagedRuntimeBinding.test.ts` proves the pure
 *   binding helpers. Neither proves the PiAdapter actually WIRES them.
 * - This suite runs the production `startSession` path in desktop mode with
 *   a genuinely verified on-disk artifact and observes, through the SDK
 *   seam, the exact controlled runtime the adapter constructs: agentDir
 *   `<verified-root>/agent`, user-dir auth/models paths, the isolated
 *   extension loader, the bind→handshake→publish ordering, and the fatal
 *   fail-closed matrix with bounded redacted diagnostics.
 */

// ---------------------------------------------------------------------------
// Deterministic Pi SDK mock
// ---------------------------------------------------------------------------

const SEVEN_REQUIRED = [
  "managed-spawn",
  "abort-propagation",
  "bounded-foreground-attachment",
  "coalesced-progress",
  "durable-cancellation",
  "journal-terminal-lifecycle",
  "child-bash-process-ownership",
] as const;

/** Legacy 3-capability surface: satisfies the old default probe only. */
const LEGACY_THREE_CAPABILITIES = [
  "managed-spawn",
  "abort-propagation",
  "bounded-foreground-attachment",
] as const;

/** Ordered global trace of every observable bootstrap step. */
const trace: string[] = [];

/** Same production parse as the desktop suite above. */
const registryIdFor = (selection: string): string => {
  const separator = selection.includes("/") ? "/" : ":";
  const separatorIndex = selection.indexOf(separator);
  return separatorIndex >= 0 ? selection.slice(separatorIndex + 1) : selection;
};

const sdkHarness = vi.hoisted(() => ({
  getAgentDirCalls: 0,
  modelRuntimeCreates: [] as Array<{ readonly authPath: string; readonly modelsPath: string }>,
  serviceCreations: [] as Array<{
    readonly cwd: string;
    readonly agentDir: string;
    readonly resourceLoaderOptions: Record<string, unknown>;
  }>,
  runtimeCreates: [] as Array<{
    readonly cwd: string;
    readonly agentDir: string;
  }>,
  disposeCalls: 0,
  /** Caller-supplied extension factories observed in the loader options. */
  observedExtensionFactories: [] as unknown[],
  /**
   * SettingsManager override observed on createAgentSessionServices — the
   * in-memory manager production must pass for desktop-managed sessions so
   * setModel persistence cannot touch the verified artifact tree.
   */
  settingsManagerOverrides: [] as Array<{
    readonly kind: "inMemory" | "none";
    readonly defaultModelAndProviderWrites: Array<{
      readonly provider: string;
      readonly modelId: string;
    }>;
  }>,
  /** SettingsManager constructors observed on the mock SDK surface. */
  settingsManagerCreates: [] as Array<"inMemory" | "create">,
  /**
   * Ticket 02 WP-B: the empirically real runtime-configuration failure
   * vector. An explicitly selected model id unavailable from the registry
   * throws from inside the runtime factory (`createSdkRuntime`'s
   * `findModelInRegistry` guard) — a raw hostile message that must never
   * escape a desktop managed start.
   */
  unavailableModelSelections: [] as string[],
}));

/**
 * The artifact-side extension the mock loader reports as loaded. Controlled
 * per scenario through `extensionScenarios`.
 */
const bridgeState = vi.hoisted(() => ({
  /** Response factory for the artifact extension's bridge handshake. */
  handshake: null as
    | null
    | ((
        request: PiSubagentHandshakeRequest,
      ) => Promise<Record<string, unknown> | never> | Record<string, unknown>),
  /** Whether the loader reports ANY artifact extension at all. */
  artifactExtensionLoaded: true,
  /**
   * Ticket 02 WP-B mock seam: model ids the mock registry must report as
   * UNAVAILABLE. Production's `findModelInRegistry` then throws the raw
   * unavailable-model error from inside the runtime factory — the exact
   * Pi SDK 0.83.0 failure vector the empirical probe identified.
   */
  unavailableModelIds: null as null | ReadonlyArray<string>,
  /**
   * The settings manager most recently observed by the mocked
   * createAgentSessionServices — used to emulate Pi SDK 0.83's session
   * setModel → settingsManager.setDefaultModelAndProvider persistence path.
   */
  settingsManager: null as null | {
    setDefaultModelAndProvider: (provider: string, modelId: string) => void;
  },
  /**
   * Every emulated FILE-BACKED SettingsManager the SDK default would have
   * constructed (bound to the passed agentDir). Any entry or any write in it
   * is the runtime repro surface (setModel → <agentDir>/settings.json).
   */
  fileSettingsWrites: [] as Array<{
    readonly settingsPath: string;
    readonly writes: Array<{
      readonly provider: string;
      readonly modelId: string;
      readonly settingsPath: string;
    }>;
  }>,
}));

/** Hostile strings a bridge/extension could try to leak into diagnostics. */
const CANARY = {
  artifactRoot: "synara-canary-artifact-root",
  userAgentDir: "synara-canary-user-agent-dir",
  prompt: "synara-canary-prompt-exfiltrate",
  apiKey: "sk-synara-canary-api-key-000",
  baseUrl: "https://synara-canary-evil.example/v1",
  modelId: "synara-canary-model-id",
  stackFragment: "synara-canary-stack-fragment",
} as const;

const hostileHandshakeMessage = (): string =>
  [
    `hostile handshake failure at ${CANARY.artifactRoot}`,
    `prompt '${CANARY.prompt}'`,
    `key ${CANARY.apiKey}`,
    `provider base-url ${CANARY.baseUrl}`,
    `model ${CANARY.modelId}`,
    `stack ${CANARY.stackFragment}`,
  ].join(" ");

const resetScenario = (input?: {
  readonly handshake?: typeof bridgeState.handshake;
  readonly artifactExtensionLoaded?: boolean;
  readonly unavailableModelIds?: ReadonlyArray<string>;
}) => {
  trace.splice(0);
  sdkHarness.getAgentDirCalls = 0;
  sdkHarness.modelRuntimeCreates.splice(0);
  sdkHarness.serviceCreations.splice(0);
  sdkHarness.runtimeCreates.splice(0);
  sdkHarness.disposeCalls = 0;
  sdkHarness.observedExtensionFactories.splice(0);
  sdkHarness.unavailableModelSelections.splice(0);
  bridgeState.handshake = input?.handshake ?? null;
  bridgeState.artifactExtensionLoaded = input?.artifactExtensionLoaded ?? true;
  bridgeState.unavailableModelIds = input?.unavailableModelIds ?? null;
  sdkHarness.settingsManagerCreates.splice(0);
  sdkHarness.settingsManagerOverrides.splice(0);
  bridgeState.settingsManager = null;
  bridgeState.fileSettingsWrites.splice(0);
};

/** A bridge object answering the desktop profile handshake successfully. */
const managedHandshake =
  (capabilities: readonly string[] = SEVEN_REQUIRED) =>
  async (request: PiSubagentHandshakeRequest) => {
    trace.push("handshake");
    if (!request.requiredCapabilities.every((capability) => capabilities.includes(capability))) {
      const missing = request.requiredCapabilities.filter(
        (capability) => !capabilities.includes(capability),
      );
      return {
        ok: false as const,
        error: "missing_capabilities" as const,
        missingCapabilities: missing,
        extensionVersion: "0.15.0-alfie.4",
      };
    }
    return {
      ok: true as const,
      protocolVersion: request.protocolVersion,
      extensionVersion: "0.15.0-alfie.4",
      capabilities: [...capabilities],
    };
  };

/**
 * The extension object the mock resource loader reports. The production
 * `extractPiSubagentBridge` finds the bridge either through the loader's
 * extension list (`ext[PI_SUBAGENT_BRIDGE_KEY]`) — the path the real
 * artifact extension takes after binding.
 */
const artifactExtension = (): Record<string | symbol, unknown> => {
  const extension: Record<string | symbol, unknown> = {
    name: "pi-subagents",
    path: "agent/extensions/pi-subagents/index.ts",
    tools: new Map(),
    handlers: new Map(),
  };
  const handshake = bridgeState.handshake;
  if (handshake !== null) {
    extension[PI_SUBAGENT_BRIDGE_KEY] = { handshake };
  }
  return extension;
};

vi.mock("@earendil-works/pi-coding-agent", () => {
  const makeResourceLoader = () => ({
    getExtensions: () => ({
      extensions: bridgeState.artifactExtensionLoaded ? [artifactExtension()] : [],
      diagnostics: [],
    }),
    reload: async () => undefined,
  });

  const makeSession = (input: { readonly cwd: string; readonly agentDir: string }) => {
    const resourceLoader = makeResourceLoader();
    return {
      sessionId: "mock-pi-session",
      cwd: input.cwd,
      model: undefined,
      messages: [],
      resourceLoader,
      sessionManager: {
        getCwd: () => input.cwd,
        getSessionFile: () => undefined,
      },
      getSessionStats: () => ({
        tokens: { input: 0, cacheRead: 0, output: 0, total: 0 },
      }),
      getAllTools: () => [],
      subscribe: () => () => undefined,
      bindExtensions: async () => {
        trace.push("bindExtensions");
      },
      abort: () => undefined,
      reload: async () => undefined,
      prompt: async () => undefined,
      // Pi SDK 0.83 AgentSession.setModel persists defaultProvider/
      // defaultModel through the services' SettingsManager (agent-session.js
      // setModel). The mock routes that through whatever settings manager
      // createAgentSessionServices observed, so a file-backed manager is
      // observable as a settings.json write attempt while an in-memory
      // manager performs zero file I/O.
      setModel: async (model: { provider: string; id: string }) => {
        bridgeState.settingsManager?.setDefaultModelAndProvider(model.provider, model.id);
      },
    };
  };

  const runtimeHandles: Array<{ dispose: () => Promise<void> }> = [];

  return {
    getAgentDir: () => {
      sdkHarness.getAgentDirCalls += 1;
      return `/Users/synara-canary/sdk-default-agent-dir`;
    },
    getShellConfig: (shellPath?: string) => ({ shellPath }),
    ModelRuntime: {
      create: async (input: { authPath: string; modelsPath: string }) => {
        sdkHarness.modelRuntimeCreates.push({
          authPath: input.authPath,
          modelsPath: input.modelsPath,
        });
        return { describe: () => "mock-model-runtime" };
      },
    },
    ModelRegistry: class MockModelRegistry {
      constructor(private readonly modelRuntime: unknown) {}
      find(provider: string, modelId: string) {
        // Ticket 02 WP-B mock seam: a configured-unavailable explicit model
        // selection resolves to undefined so production's registry guard
        // throws the raw unavailable-model error inside the runtime factory.
        if (
          bridgeState.unavailableModelIds !== null &&
          bridgeState.unavailableModelIds.includes(modelId)
        ) {
          sdkHarness.unavailableModelSelections.push(modelId);
          return undefined;
        }
        return { id: modelId, provider, api: "openai-completions" };
      }
      getAll() {
        // The provider-less lookup path mirrors the real registry with builtin
        // models REMOVED (the isolated user models.json contributes nothing
        // here): a bare explicit id resolves to undefined — the same raw
        // unavailable-model throw production emits for a bare slug.
        return [];
      }
      getAvailable() {
        return [];
      }
    },
    SessionManager: {
      create: (cwd: string) => ({ cwd, getCwd: () => cwd, getSessionFile: () => undefined }),
      open: (file: string) => {
        throw new Error(`unexpected SessionManager.open(${file}) in bootstrap tests`);
      },
    },
    SettingsManager: {
      // Mocks the SDK-supported static constructors. Only `inMemory` is
      // legal on the desktop-managed path; `create` presence lets tests
      // prove production never falls back to constructing a file-backed
      // manager itself for desktop sessions.
      inMemory: () => {
        sdkHarness.settingsManagerCreates.push("inMemory");
        const writes: Array<{ provider: string; modelId: string }> = [];
        return {
          kind: "inMemory" as const,
          writes,
          getShellPath: () => undefined,
          getShellCommandPrefix: () => undefined,
          setDefaultModelAndProvider: (provider: string, modelId: string) => {
            writes.push({ provider, modelId });
          },
        };
      },
      create: () => {
        sdkHarness.settingsManagerCreates.push("create");
        throw new Error(
          "mocked SettingsManager.create must not be used (file-backed settings are forbidden in these tests)",
        );
      },
    },
    createAgentSessionServices: async (input: {
      cwd: string;
      agentDir: string;
      resourceLoaderOptions: Record<string, unknown>;
      settingsManager?: unknown;
    }) => {
      const settingsManagerOverride =
        input.settingsManager === undefined
          ? { kind: "none" as const, defaultModelAndProviderWrites: [] }
          : {
              kind: "inMemory" as const,
              defaultModelAndProviderWrites: (
                input.settingsManager as { writes: Array<{ provider: string; modelId: string }> }
              ).writes,
            };
      sdkHarness.settingsManagerOverrides.push(settingsManagerOverride);
      // The emulated SDK default: without a settingsManager override the
      // services construct a file-backed SettingsManager bound to
      // <agentDir> (the verified artifact tree in desktop mode) — exactly
      // the runtime repro (setModel → <agentDir>/settings.json → verifier
      // unlisted_entry). A file-backed manager records every attempted
      // artifact path write so tests can prove it must stay at zero.
      const settingsManager =
        input.settingsManager === undefined
          ? (() => {
              const settingsPath = path.join(input.agentDir, "settings.json");
              const writes: Array<{
                provider: string;
                modelId: string;
                settingsPath: string;
              }> = [];
              bridgeState.fileSettingsWrites.push({ settingsPath, writes });
              return {
                kind: "file" as const,
                getShellPath: () => undefined,
                getShellCommandPrefix: () => undefined,
                setDefaultModelAndProvider: (provider: string, modelId: string) => {
                  writes.push({ provider, modelId, settingsPath });
                },
              };
            })()
          : (input.settingsManager as NonNullable<typeof input.settingsManager>);
      bridgeState.settingsManager = settingsManager as typeof bridgeState.settingsManager;
      sdkHarness.serviceCreations.push({
        cwd: input.cwd,
        agentDir: input.agentDir,
        resourceLoaderOptions: input.resourceLoaderOptions,
        ...(input.settingsManager === undefined ? {} : { settingsManager: settingsManager }),
      });
      if (Array.isArray(input.resourceLoaderOptions?.extensionFactories)) {
        sdkHarness.observedExtensionFactories.push(
          ...(input.resourceLoaderOptions.extensionFactories as unknown[]),
        );
      }
      return {
        cwd: input.cwd,
        agentDir: input.agentDir,
        settingsManager,
        diagnostics: { log: () => undefined },
        modelRuntime: {},
        resourceLoader: makeResourceLoader(),
      };
    },
    createAgentSessionFromServices: async (input: {
      services: { cwd: string; agentDir: string };
    }) => ({
      ...input,
      session: makeSession({ cwd: input.services.cwd, agentDir: input.services.agentDir }),
    }),
    createAgentSessionRuntime: async (
      factory: (input: {
        cwd: string;
        agentDir: string;
        sessionManager: unknown;
        sessionStartEvent?: unknown;
      }) => Promise<Record<string, unknown>>,
      options: { cwd: string; agentDir: string },
    ) => {
      sdkHarness.runtimeCreates.push({ cwd: options.cwd, agentDir: options.agentDir });
      const created = (await factory({
        cwd: options.cwd,
        agentDir: options.agentDir,
        sessionManager: { getCwd: () => options.cwd, getSessionFile: () => undefined },
      })) as Record<string, unknown>;
      const session = {
        ...(created as { session: Record<string, unknown> }).session,
        cwd: options.cwd,
      } as ReturnType<typeof makeSession>;
      const handle = {
        session,
        services: (created as { services: unknown }).services,
        diagnostics: { log: () => undefined },
        dispose: async () => {
          sdkHarness.disposeCalls += 1;
          trace.push("runtime.dispose");
        },
      };
      runtimeHandles.push(handle);
      return handle;
    },
    defineTool: (tool: unknown) => tool,
    createBashToolDefinition: (cwd: string) => ({ cwd }),
  };
});

// ---------------------------------------------------------------------------
// Adapter composition helpers
// ---------------------------------------------------------------------------

/** Recording repository seam: any write proves durable truth was created. */
const makeRecordingRepository = () => {
  const writes: string[] = [];
  const refused = () => Effect.fail(new Error("not provided") as never);
  const repository = {
    recordAdmission: (input: unknown) => {
      writes.push(`recordAdmission:${JSON.stringify(input)}`);
      return refused();
    },
    recordLifecycleEvent: (input: unknown) => {
      writes.push(`recordLifecycleEvent:${JSON.stringify(input)}`);
      return refused();
    },
    recordProgressObservation: (input: unknown) => {
      writes.push(`recordProgressObservation:${JSON.stringify(input)}`);
      return refused();
    },
    recordHeartbeatObservation: (input: unknown) => {
      writes.push(`recordHeartbeatObservation:${JSON.stringify(input)}`);
      return refused();
    },
    recordTerminalIngest: undefined,
    writes,
  };
  return repository as unknown as PiSubagentExecutionRepositoryShape & { writes: string[] };
};

interface HarnessObservers {
  readonly subagentCapability: Array<{ readonly status: string; readonly isManaged: boolean }>;
  readonly synaraMcpSessions: string[];
  readonly subagentAdmissions: string[];
  readonly repository: PiSubagentExecutionRepositoryShape & { writes: string[] };
}

const makeObservers = (): HarnessObservers => ({
  subagentCapability: [],
  synaraMcpSessions: [],
  subagentAdmissions: [],
  repository: makeRecordingRepository(),
});

const makeAdapterLayer = (input: {
  readonly mode: ServerConfigShape["mode"];
  readonly gateEnv: NodeJS.ProcessEnv;
  readonly userAgentDir?: string;
  readonly observers: HarnessObservers;
  readonly extensionFactories?: readonly unknown[];
  readonly modelSelection?: { provider: "pi"; model: string };
}) =>
  makePiAdapterLive({
    piSubagentDesktopArtifactGateEnv: input.gateEnv,
    ...(input.userAgentDir !== undefined
      ? { piSubagentDesktopUserAgentDir: input.userAgentDir }
      : {}),
    ...(input.extensionFactories !== undefined
      ? { extensionFactories: input.extensionFactories }
      : {}),
    piSubagentRepository: input.observers.repository,
    onSubagentCapability: (event) => {
      trace.push("onSubagentCapability");
      input.observers.subagentCapability.push({
        status: event.capability.status,
        isManaged: event.capability.isManaged,
      });
    },
    onSynaraMcpSession: (event) => {
      trace.push("onSynaraMcpSession");
      input.observers.synaraMcpSessions.push(String(event.threadId));
    },
    onSubagentAdmission: (event) => {
      input.observers.subagentAdmissions.push(String(event.threadId));
    },
  }).pipe(
    Layer.provide(
      Layer.effect(
        ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          return { ...config, mode: input.mode } satisfies ServerConfigShape;
        }),
      ).pipe(
        Layer.provide(
          ServerConfig.layerTest(process.cwd(), {
            prefix: "synara-pi-adapter-desktop-bootstrap-test-",
          }),
        ),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

const startSessionInput = {
  provider: "pi" as const,
  threadId: "thread-pi-desktop-managed-bootstrap" as never,
  runtimeMode: "full-access" as const,
};

interface RunResult {
  readonly success: unknown;
  readonly failure: ProviderAdapterError | undefined;
  readonly hasSession: boolean;
  readonly listSessionCount: number;
}

const runStartSession = (input: {
  readonly mode: ServerConfigShape["mode"];
  readonly gateEnv: NodeJS.ProcessEnv;
  readonly userAgentDir?: string;
  readonly observers: HarnessObservers;
  readonly extensionFactories?: readonly unknown[];
  /** Explicit model selection forwarded through the production seam. */
  readonly modelSelection?: { provider: "pi"; model: string };
}): Promise<RunResult> =>
  Effect.gen(function* () {
    const adapter = yield* PiAdapter;
    const outcome = yield* Effect.exit(
      adapter.startSession(
        (input.modelSelection === undefined
          ? startSessionInput
          : { ...startSessionInput, modelSelection: input.modelSelection }) as never,
      ),
    );
    const hasSession = yield* adapter.hasSession(startSessionInput.threadId);
    const sessions = yield* adapter.listSessions();
    return {
      success: Exit.isSuccess(outcome) ? outcome.value : undefined,
      failure: Exit.isFailure(outcome)
        ? (Cause.squash(outcome.cause) as ProviderAdapterError)
        : undefined,
      hasSession,
      listSessionCount: sessions.length,
    } satisfies RunResult;
  }).pipe(Effect.provide(makeAdapterLayer(input)), Effect.scoped, Effect.runPromise);

/**
 * Runs the production startSession → sendTurn(with model selection) pair on
 * one adapter instance so a model switch can be observed against the
 * settings manager the bootstrap actually wired.
 */
const runStartSessionThenModelSwitch = async (input: {
  readonly mode: ServerConfigShape["mode"];
  readonly gateEnv: NodeJS.ProcessEnv;
  readonly userAgentDir?: string;
  readonly observers: HarnessObservers;
  readonly switchModel: string;
}): Promise<{
  readonly start: RunResult;
  readonly switchFailure: ProviderAdapterError | undefined;
}> =>
  Effect.gen(function* () {
    const adapter = yield* PiAdapter;
    const startOutcome = yield* Effect.exit(adapter.startSession(startSessionInput as never));
    const hasSession = yield* adapter.hasSession(startSessionInput.threadId);
    const sessions = yield* adapter.listSessions();
    const switchOutcome = Exit.isSuccess(startOutcome)
      ? yield* Effect.exit(
          adapter.sendTurn({
            threadId: startSessionInput.threadId,
            input: "switch model please",
            modelSelection: { provider: "pi", model: input.switchModel },
          } as never),
        )
      : undefined;
    return {
      start: {
        success: Exit.isSuccess(startOutcome) ? startOutcome.value : undefined,
        failure: Exit.isFailure(startOutcome)
          ? (Cause.squash(startOutcome.cause) as ProviderAdapterError)
          : undefined,
        hasSession,
        listSessionCount: sessions.length,
      } satisfies RunResult,
      switchFailure:
        switchOutcome && Exit.isFailure(switchOutcome)
          ? (Cause.squash(switchOutcome.cause) as ProviderAdapterError)
          : undefined,
    };
  }).pipe(Effect.provide(makeAdapterLayer(input)), Effect.scoped, Effect.runPromise);

// ---------------------------------------------------------------------------
// Real verified mini artifact fixture
// ---------------------------------------------------------------------------

let fixtureRoot: string;
let artifactRoot: string;
let userAgentDir: string;

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

const ARTIFACT_FILES = [
  {
    path: "agent/extensions/pi-subagents/package.json",
    content: JSON.stringify({ name: "@alfie/pi-subagents", version: "0.15.0-alfie.4" }),
  },
  {
    path: "agent/extensions/pi-subagents/src/index.ts",
    content: "export const managed = true;\n",
  },
] as const;

const manifestFor = () => ({
  schemaVersion: PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  sourceIdentity: {
    repositoryUrl: "https://github.com/anhphamwork99/alfie.git",
    pinnedCommit: "aa6fa4a8540644d2509b10d6df854486ddc67d1d",
    packageName: "@alfie/pi-subagents",
    packageVersion: "0.15.0-alfie.4",
  },
  capabilityProfile: {
    protocolVersion: 1,
    capabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES, "terminal-outbox"],
    requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
  },
  files: ARTIFACT_FILES.map((file) => ({
    path: file.path,
    sizeBytes: Buffer.byteLength(file.content),
    sha256: sha256(file.content),
  })),
});

const stageValidArtifact = async (root: string): Promise<void> => {
  for (const file of ARTIFACT_FILES) {
    await mkdir(path.join(root, path.dirname(file.path)), { recursive: true });
    await writeFile(path.join(root, file.path), file.content);
  }
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifestFor(), null, 2));
};

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "synara-t02-bootstrap-"));
  artifactRoot = path.join(fixtureRoot, CANARY.artifactRoot);
  await stageValidArtifact(artifactRoot);
  userAgentDir = path.join(fixtureRoot, CANARY.userAgentDir);
  await mkdir(path.join(userAgentDir, "agent"), { recursive: true });
  await writeFile(
    path.join(userAgentDir, "auth.json"),
    JSON.stringify({ anthropic: { apiKey: CANARY.apiKey } }),
  );
  await writeFile(
    path.join(userAgentDir, "models.json"),
    JSON.stringify({ models: { "synara-canary-model-id": { baseUrl: CANARY.baseUrl } } }),
  );
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

const desktopGateEnv = (locator: string | undefined): NodeJS.ProcessEnv => ({
  [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: locator,
  PI_CODING_AGENT_DIR: `/Users/${CANARY.userAgentDir}/sdk-global-pollution`,
});

const expectedControlledAgentDir = (): string =>
  path.join(artifactRoot, PI_SUBAGENT_DESKTOP_MANAGED_AGENT_DIR_SEGMENT);
const expectedExtensionPath = (): string =>
  path.join(expectedControlledAgentDir(), "extensions", "pi-subagents");

/** Serialized failure surface a leak would escape through. */
const failureSurface = (failure: unknown): string =>
  JSON.stringify(
    failure,
    (_key, value: unknown) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
        : value,
    2,
  );

const expectNoCanaryLeak = (surface: string): void => {
  for (const secret of [
    CANARY.artifactRoot,
    CANARY.userAgentDir,
    CANARY.prompt,
    CANARY.apiKey,
    CANARY.baseUrl,
    CANARY.modelId,
    CANARY.stackFragment,
    "auth.json",
    "models.json",
  ]) {
    expect.soft(surface, `leaked secret [${secret}]`).not.toContain(secret);
  }
};

// ---------------------------------------------------------------------------
// AC1 — controlled runtime wiring
// ---------------------------------------------------------------------------

describe("PiAdapter desktop managed bootstrap — controlled runtime (T02-AC1)", () => {
  it("starts from <verified-root>/agent with user-dir auth/models and artifact-only extensions", async () => {
    resetScenario({ handshake: managedHandshake() });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "desktop",
      gateEnv: desktopGateEnv(artifactRoot),
      userAgentDir,
      observers,
      extensionFactories: [{ name: "caller-supplied-factory-must-not-load" }],
    });

    // Bootstrap succeeded and published exactly one session.
    expect(result.failure).toBeUndefined();
    expect(result.success).toMatchObject({
      provider: "pi",
      status: "ready",
      threadId: startSessionInput.threadId,
    });
    expect(result.hasSession).toBe(true);
    expect(result.listSessionCount).toBe(1);
    expect(observers.synaraMcpSessions).toEqual([startSessionInput.threadId]);
    expect(observers.subagentAdmissions).toEqual([]);

    // The runtime agentDir is EXACTLY the verified artifact's `agent` subtree.
    expect(sdkHarness.runtimeCreates).toHaveLength(1);
    expect(sdkHarness.runtimeCreates[0]!.agentDir).toBe(expectedControlledAgentDir());
    expect(sdkHarness.serviceCreations).toHaveLength(1);
    expect(sdkHarness.serviceCreations[0]!.agentDir).toBe(expectedControlledAgentDir());

    // The model/auth runtime reads the USER dir explicitly (auth.json +
    // models.json), never the artifact's agentDir and never a broad copy.
    expect(sdkHarness.modelRuntimeCreates).toEqual([
      {
        authPath: path.join(userAgentDir, "auth.json"),
        modelsPath: path.join(userAgentDir, "models.json"),
      },
    ]);

    // The resource loader isolates extensions: noExtensions + ONLY the
    // release-controlled extension dir + exactly the server-internal
    // dormant Synara MCP factory (no caller factories, no user globals).
    const loaderOptions = sdkHarness.serviceCreations[0]!.resourceLoaderOptions;
    expect(loaderOptions.noExtensions).toBe(true);
    expect(loaderOptions.additionalExtensionPaths).toEqual([expectedExtensionPath()]);
    expect(Array.isArray(loaderOptions.extensionFactories)).toBe(true);
    expect((loaderOptions.extensionFactories as unknown[]).length).toBe(1);
    expect(sdkHarness.observedExtensionFactories.length).toBe(1);
    expect(JSON.stringify(sdkHarness.observedExtensionFactories)).not.toContain(
      "caller-supplied-factory-must-not-load",
    );

    // The SDK's global agent-dir discovery is never consulted on the desktop
    // path (the user dir came from the explicit desktop seam).
    expect(sdkHarness.getAgentDirCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC2 — handshake ordering and the fatal fail-closed matrix
// ---------------------------------------------------------------------------

describe("PiAdapter desktop managed bootstrap — handshake ordering (T02-AC2)", () => {
  it("binds extensions before the seven-capability handshake and publishes only after success", async () => {
    resetScenario({ handshake: managedHandshake() });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "desktop",
      gateEnv: desktopGateEnv(artifactRoot),
      userAgentDir,
      observers,
    });

    expect(result.failure).toBeUndefined();
    expect(result.hasSession).toBe(true);

    // The seven-capability handshake runs EXACTLY ONCE — the successful
    // pre-publication negotiation is cached as the session's capability
    // truth; no second negotiation happens after `sessions.set` (a second
    // attempt could fail after publication and undermine fail-closed
    // semantics).
    expect(trace.filter((entry) => entry === "handshake")).toHaveLength(1);

    // bindExtensions strictly before the handshake…
    const bindIndex = trace.indexOf("bindExtensions");
    const handshakeIndex = trace.indexOf("handshake");
    expect(bindIndex).toBeGreaterThanOrEqual(0);
    expect(handshakeIndex).toBeGreaterThan(bindIndex);
    // …and the capability callback only after the handshake.
    const capabilityIndex = trace.indexOf("onSubagentCapability");
    expect(capabilityIndex).toBeGreaterThan(handshakeIndex);
    // The scoped test harness tears down the published runtime only after the
    // completed bootstrap; no disposal occurs before capability publication.
    const disposeIndex = trace.indexOf("runtime.dispose");
    expect(disposeIndex).toBeGreaterThan(capabilityIndex);
    // The published capability is the managed seven-capability truth.
    expect(observers.subagentCapability).toEqual([{ status: "managed_enabled", isManaged: true }]);
  });
});

describe("PiAdapter desktop managed bootstrap — fatal denial matrix (T02-AC2/AC5)", () => {
  const denialScenarios = [
    {
      label: "bridge absent (no artifact extension loaded)",
      scenario: { artifactExtensionLoaded: false, handshake: null },
      expectedDetailFragment: "(bridge_absent:pi_subagent_bridge_absent)",
    },
    {
      label: "bridge present but handshake malformed",
      scenario: {
        artifactExtensionLoaded: true,
        handshake: async () => {
          trace.push("handshake");
          return { totally: "not a handshake response" } as Record<string, unknown>;
        },
      },
      expectedDetailFragment: "(bridge_malformed_response:pi_subagent_bridge_malformed_response)",
    },
    {
      label: "bridge reports an unsupported protocol version",
      scenario: {
        artifactExtensionLoaded: true,
        handshake: async (_request: PiSubagentHandshakeRequest) => {
          trace.push("handshake");
          return {
            ok: true,
            protocolVersion: 99,
            extensionVersion: "0.99.0-hostile",
            capabilities: [...SEVEN_REQUIRED],
          } as unknown as Record<string, unknown>;
        },
      },
      expectedDetailFragment: "(unsupported_version:pi_subagent_unsupported_version)",
    },
    {
      label: "bridge supplies only the legacy three capabilities",
      scenario: {
        artifactExtensionLoaded: true,
        handshake: managedHandshake(LEGACY_THREE_CAPABILITIES),
      },
      expectedDetailFragment: "(capability_mismatch:pi_subagent_capability_mismatch)",
    },
    {
      label: "bridge handshake throws hostile material",
      scenario: {
        artifactExtensionLoaded: true,
        handshake: async () => {
          trace.push("handshake");
          throw new Error(hostileHandshakeMessage());
        },
      },
      expectedDetailFragment: "(bridge_error:pi_subagent_bridge_error)",
    },
  ] as const;

  it.for(denialScenarios)(
    "fails startSession closed on %s with a bounded safe diagnostic",
    async ({ label, scenario, expectedDetailFragment }) => {
      resetScenario(scenario);
      const observers = makeObservers();

      const result = await runStartSession({
        mode: "desktop",
        gateEnv: desktopGateEnv(artifactRoot),
        userAgentDir,
        observers,
      });

      // The denial is a bounded request error with the closed-vocabulary
      // detail — never raw bridge/hostile content.
      expect(result.failure).toBeDefined();
      const failure = result.failure!;
      expect(failure).toMatchObject({
        _tag: "ProviderAdapterRequestError",
        provider: "pi",
      });
      expect((failure as { detail: string }).detail).toContain(expectedDetailFragment);
      expect((failure as { detail: string }).detail.length).toBeLessThanOrEqual(512);

      // No session, callback, or durable truth was published.
      expect(result.hasSession).toBe(false);
      expect(result.listSessionCount).toBe(0);
      expect(observers.subagentCapability).toEqual([]);
      expect(observers.synaraMcpSessions).toEqual([]);
      expect(observers.subagentAdmissions).toEqual([]);
      expect(observers.repository.writes).toEqual([]);

      // The staged runtime was proven disposed before the failure surfaced.
      expect(trace).toContain("bindExtensions");
      expect(trace.indexOf("runtime.dispose")).toBeGreaterThan(trace.indexOf("bindExtensions"));

      // No canary (credential, path, prompt, provider config) leaks through
      // the serialized failure surface.
      expectNoCanaryLeak(failureSurface(failure));

      // The malformed/mismatch/absent matrix still got as far as the
      // handshake-or-absence step — proving the denial comes from the
      // handshake boundary, not from an earlier wiring break.
      if (label !== "bridge absent (no artifact extension loaded)") {
        expect(trace).toContain("handshake");
      }
    },
  );
});

// ---------------------------------------------------------------------------
// AC5 — non-desktop regression (default 3-cap degraded probe stays nonfatal)
// ---------------------------------------------------------------------------

describe("PiAdapter non-desktop regression — legacy baseline probe (T02-AC5)", () => {
  it("keeps web mode nonfatal with the historical 3-capability baseline and loads caller extension factories", async () => {
    resetScenario({ handshake: managedHandshake(LEGACY_THREE_CAPABILITIES) });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "web",
      gateEnv: desktopGateEnv("/this/locator/is/ignored/in/web/mode"),
      userAgentDir,
      observers,
      extensionFactories: [{ name: "caller-factory-allowed-in-web-mode" }],
    });

    // Nonfatal: outside desktop mode the historical 3-capability request is
    // unchanged, so this bridge remains managed-enabled and publishable.
    expect(result.failure).toBeUndefined();
    expect(result.hasSession).toBe(true);
    expect(result.listSessionCount).toBe(1);
    expect(observers.subagentCapability).toEqual([{ status: "managed_enabled", isManaged: true }]);

    // The historical non-desktop loader shape is preserved (no noExtensions
    // isolation; caller factories are an alternate Agent path).
    expect(sdkHarness.serviceCreations).toHaveLength(1);
    const loaderOptions = sdkHarness.serviceCreations[0]!.resourceLoaderOptions;
    expect(loaderOptions.noExtensions).toBeUndefined();
    expect(loaderOptions.additionalExtensionPaths).toBeUndefined();
    expect(sdkHarness.observedExtensionFactories.length).toBe(2);
    expect(JSON.stringify(sdkHarness.observedExtensionFactories)).toContain(
      "caller-factory-allowed-in-web-mode",
    );

    // Non-desktop agentDir resolution keeps the SDK-global discovery path.
    expect(sdkHarness.getAgentDirCalls).toBeGreaterThanOrEqual(1);
    // The scoped harness disposes only after the successful session lifecycle.
    expect(trace.indexOf("runtime.dispose")).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// AC5 fallback — desktop-managed user runtime/model configuration failure
// ---------------------------------------------------------------------------

/**
 * The empirically real Pi SDK 0.83.0 failure vector (probe, 2026-08-22):
 * malformed/schema-invalid `models.json` and auth inputs do NOT throw during
 * ModelRuntime/services creation — they populate composition errors while
 * builtin models remain. What actually escapes the runtime boundary is an
 * explicitly selected model id unavailable from the registry: the runtime
 * factory throws a raw message embedding that id (plus whatever hostile
 * material the user's model slug carries). These tests harden exactly that
 * vector with hostile canaries.
 */
describe("PiAdapter desktop managed bootstrap — unavailable explicit model (T02-AC5 fallback)", () => {
  const hostileModelSelections = [
    CANARY.modelId,
    `${CANARY.userAgentDir}/../${CANARY.modelId}`,
    `${CANARY.apiKey}:${CANARY.modelId}`,
    `openai/${CANARY.modelId}`,
    `${CANARY.prompt}/${CANARY.stackFragment}/${CANARY.baseUrl}`,
  ] as const;

  it.for(hostileModelSelections)(
    "fails closed with the fixed detail and zero canary leak for model selection '%s'",
    async (modelSelection) => {
      resetScenario({
        handshake: managedHandshake(),
        unavailableModelIds: [registryIdFor(modelSelection)],
      });
      const observers = makeObservers();

      const result = await runStartSession({
        mode: "desktop",
        gateEnv: desktopGateEnv(artifactRoot),
        userAgentDir,
        observers,
        modelSelection: { provider: "pi", model: modelSelection },
      });

      // The failure fired at the CORRECT boundary: the runtime factory was
      // reached (services created against the controlled agent dir).
      expect(sdkHarness.serviceCreations).toHaveLength(1);
      expect(sdkHarness.serviceCreations[0]!.agentDir).toBe(expectedControlledAgentDir());
      // The provider-qualified lookups actually hit the unavailable seam.
      if (modelSelection.includes("/") || modelSelection.includes(":")) {
        expect(sdkHarness.unavailableModelSelections.length).toBeGreaterThanOrEqual(1);
      }

      // EXACTLY the fixed bounded detail — never a raw cause chain.
      expect(result.failure).toBeDefined();
      const failure = result.failure!;
      expect(failure).toMatchObject({
        _tag: "ProviderAdapterRequestError",
        provider: "pi",
      });
      expect((failure as { detail: string }).detail).toBe(
        PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
      );

      // NO retained raw cause/stack/error object on the desktop failure.
      const record = failure as unknown as { cause?: unknown };
      expect(record.cause).toBeUndefined();
      const serialized = failureSurface(failure);
      expectNoCanaryLeak(serialized);

      // No session/callback/admission/repository side effects survived.
      expect(result.hasSession).toBe(false);
      expect(result.listSessionCount).toBe(0);
      expect(observers.subagentCapability).toEqual([]);
      expect(observers.synaraMcpSessions).toEqual([]);
      expect(observers.subagentAdmissions).toEqual([]);
      expect(observers.repository.writes).toEqual([]);

      // Partial runtime state was cleaned: the failure happened INSIDE the
      // runtime factory, so no runtime handle was ever published to dispose —
      // and no handshake/binding ever ran on the staged partial state.
      expect(trace).not.toContain("bindExtensions");
      expect(trace).not.toContain("handshake");
      expect(trace).not.toContain("runtime.dispose");
      expect(sdkHarness.disposeCalls).toBe(0);
    },
  );

  it("keeps schema-valid user auth/models wiring intact while only the selection is unavailable", async () => {
    // Same user dir, same verified artifact, but the selection resolves —
    // proving the failure above came from the SELECTION vector, not from
    // broken auth/models wiring.
    resetScenario({ handshake: managedHandshake() });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "desktop",
      gateEnv: desktopGateEnv(artifactRoot),
      userAgentDir,
      observers,
      modelSelection: { provider: "pi", model: "openai/synara-available-model" },
    });

    expect(result.failure).toBeUndefined();
    expect(result.hasSession).toBe(true);
    expect(sdkHarness.modelRuntimeCreates).toEqual([
      {
        authPath: path.join(userAgentDir, "auth.json"),
        modelsPath: path.join(userAgentDir, "models.json"),
      },
    ]);
  });
});

describe("PiAdapter non-desktop regression — unavailable explicit model keeps raw behavior (T02-AC5)", () => {
  it("preserves the historical raw error with retained cause in web mode for the same hostile failure", async () => {
    resetScenario({
      handshake: managedHandshake(),
      unavailableModelIds: [registryIdFor(CANARY.modelId)],
    });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "web",
      gateEnv: desktopGateEnv("/this/locator/is/ignored/in/web/mode"),
      userAgentDir,
      observers,
      modelSelection: { provider: "pi", model: CANARY.modelId },
    });

    // Web mode keeps the HISTORICAL raw surface: the unavailable-model
    // message (including the model id) and a retained cause. This is the
    // pre-change behavior — desktop-only redaction must not leak into it.
    expect(result.failure).toBeDefined();
    const failure = result.failure!;
    expect(failure).toMatchObject({
      _tag: "ProviderAdapterRequestError",
      provider: "pi",
    });
    expect((failure as { detail: string }).detail).toContain(CANARY.modelId);
    expect((failure as { detail: string }).detail).toContain("is not available");
    const record = failure as unknown as { cause?: unknown };
    expect(record.cause).toBeDefined();

    // No session or side effects — the failure is still fatal for the start.
    expect(result.hasSession).toBe(false);
    expect(result.listSessionCount).toBe(0);
    expect(observers.repository.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// In-memory SettingsManager regression — model switch must not mutate the
// verified artifact (runtime-repro: setModel → <agentDir>/settings.json →
// verifier `unlisted_entry` → thread quarantine)
// ---------------------------------------------------------------------------

describe("PiAdapter desktop managed bootstrap — in-memory settings isolation (model switch)", () => {
  it("passes one session-scoped in-memory SettingsManager into createAgentSessionServices", async () => {
    resetScenario({ handshake: managedHandshake() });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "desktop",
      gateEnv: desktopGateEnv(artifactRoot),
      userAgentDir,
      observers,
    });

    expect(result.failure).toBeUndefined();
    expect(result.hasSession).toBe(true);

    // Exactly one in-memory manager was constructed and passed through the
    // SDK seam — no second manager, no file-backed construction.
    expect(sdkHarness.settingsManagerCreates).toEqual(["inMemory"]);
    expect(sdkHarness.settingsManagerOverrides).toHaveLength(1);
    expect(sdkHarness.settingsManagerOverrides[0]!.kind).toBe("inMemory");

    // Without the override the mocked SDK default would have bound a
    // FILE-BACKED manager to the verified artifact agentDir — the runtime
    // repro vector. It must never exist on the desktop path.
    expect(bridgeState.fileSettingsWrites).toEqual([]);
  });

  it("applies a model switch through session.setModel without any artifact settings write", async () => {
    resetScenario({ handshake: managedHandshake() });
    const observers = makeObservers();

    const { start, switchFailure } = await runStartSessionThenModelSwitch({
      mode: "desktop",
      gateEnv: desktopGateEnv(artifactRoot),
      userAgentDir,
      observers,
      switchModel: "openai/synara-switch-target-model",
    });

    // The start succeeded and the model switch went through the production
    // setModel path (sendTurn modelSelection), not a validation rejection.
    expect(start.failure).toBeUndefined();
    expect(start.hasSession).toBe(true);
    expect(switchFailure).toBeUndefined();

    // The override wired for this session received the persistence call…
    expect(sdkHarness.settingsManagerOverrides).toHaveLength(1);
    expect(sdkHarness.settingsManagerOverrides[0]!.kind).toBe("inMemory");
    expect(sdkHarness.settingsManagerOverrides[0]!.defaultModelAndProviderWrites).toEqual([
      { provider: "openai", modelId: "synara-switch-target-model" },
    ]);

    // …while the verified artifact tree stayed byte-identical: no file-backed
    // settings manager was ever constructed against <artifact>/agent, so no
    // settings.json write (the `unlisted_entry` repro) could occur.
    expect(bridgeState.fileSettingsWrites).toEqual([]);

    // The verified artifact remains re-verifiable: manifest + controlled
    // files unchanged on disk (no settings.json appeared under
    // <artifact>/agent).
    const controlledFiles: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else {
          controlledFiles.push(entryPath);
        }
      }
    };
    await walk(expectedControlledAgentDir());
    expect(controlledFiles.toSorted()).toEqual(
      [
        path.join(expectedControlledAgentDir(), "extensions", "pi-subagents", "package.json"),
        path.join(expectedControlledAgentDir(), "extensions", "pi-subagents", "src", "index.ts"),
      ].toSorted(),
    );
  });

  it("still uses the settings manager for shell config resolution on the desktop path", async () => {
    resetScenario({ handshake: managedHandshake() });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "desktop",
      gateEnv: desktopGateEnv(artifactRoot),
      userAgentDir,
      observers,
    });

    // createRuntime consumed getShellPath/getShellCommandPrefix from the
    // overridden manager (mock returns undefined) and the start still
    // succeeded — the in-memory manager is a drop-in for the seams the
    // adapter reads.
    expect(result.failure).toBeUndefined();
    expect(sdkHarness.settingsManagerOverrides).toHaveLength(1);
    expect(sdkHarness.settingsManagerOverrides[0]!.kind).toBe("inMemory");
  });
});

describe("PiAdapter non-desktop regression — settings manager default preserved", () => {
  it("keeps web mode on the SDK default file-backed settings manager", async () => {
    resetScenario({ handshake: managedHandshake(LEGACY_THREE_CAPABILITIES) });
    const observers = makeObservers();

    const result = await runStartSession({
      mode: "web",
      gateEnv: desktopGateEnv("/this/locator/is/ignored/in/web/mode"),
      userAgentDir,
      observers,
    });

    expect(result.failure).toBeUndefined();
    expect(result.hasSession).toBe(true);

    // Non-desktop behavior is UNCHANGED: production passes no override, so
    // the SDK default (file-backed SettingsManager.create) applies. The mock
    // emulates that default against its own agentDir — the important
    // assertion is that no override/in-memory construction happened here.
    expect(sdkHarness.settingsManagerCreates).toEqual([]);
    expect(sdkHarness.settingsManagerOverrides).toHaveLength(1);
    expect(sdkHarness.settingsManagerOverrides[0]!.kind).toBe("none");
  });
});
