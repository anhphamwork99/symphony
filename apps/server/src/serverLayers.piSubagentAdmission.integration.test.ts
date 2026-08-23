/**
 * Production composition regression: Pi managed-subagent admission through the
 * UNMODIFIED standard `makeServerApplicationLayers()` composition.
 *
 * Regression under test (Decision 21 / production composition remediation):
 *   - the standard application composition must wire the live projection
 *     snapshot query AND the live MCP session authority registry into the
 *     PiAdapter (exact shared leaf layers, one built instance per leaf);
 *   - a valid server-minted authority + a projected running parent thread
 *     must pass the admission preflight (no `server projection snapshot is
 *     unavailable`, no `MCP session authority registry is unavailable`) and
 *     start a real managed child;
 *   - revoking the authority through the STANDARD runtime registry before a
 *     later Agent call must be observed by the PiAdapter and fail closed
 *     with zero child starts.
 *
 * The test does NOT use `makePiAdapterLive`, `options.snapshotQuery`, an
 * authority proxy/forwarder, a replacement provider layer, or any helper
 * import from other test files (repo convention: helpers are local to each
 * suite). The only fixtures are the deterministic loopback model endpoint and
 * agent-dir scaffolding; the adapter, extension bridge, AgentManager, child
 * spawn, admission coordinator, projection pipeline, and authority registry
 * are all the real production objects.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Ref, Stream } from "effect";
import { make as makeManagedRuntime } from "effect/ManagedRuntime";
import { describe, expect, it } from "vitest";

import { CommandId, type ProjectId, type ThreadId } from "@synara/contracts";

import { McpSessionAuthority } from "./agentGateway/Services/McpSessionAuthority.ts";
import { ServerConfig, type ServerConfigShape } from "./config.ts";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { makeSqlitePersistenceLive } from "./persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepository } from "./persistence/Services/PiSubagentExecutionRepository.ts";
import { ProviderAdapterRegistry } from "./provider/Services/ProviderAdapterRegistry.ts";
import { ProviderService } from "./provider/Services/ProviderService.ts";
import { makeServerApplicationLayers } from "./serverLayers.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Deterministic loopback model fixture (local copy) ───────────────────────
//
// Only the model endpoint is a fixture (the same owner-approved seam the
// existing real-Pi suites use). The driver model mirrors a real slow model:
// it delegates to the Agent tool once per fresh user turn (only when the
// request carries the extension Agent tool and no tool result has arrived
// after the newest user message) and answers plain text otherwise, so the
// parent turn completes instead of looping and the child never delegates.

const DRIVER_MODEL_PROVIDER = "synara-local-echo";
const ECHO_MODEL_ID = "echo";
const DRIVER_MODEL_ID = "agent-driver";
const AGENT_TOOL_NAME = "Agent";
const toolName = (tool: { name?: string; function?: { name?: string } }) =>
  tool.name ?? tool.function?.name;
const DRIVER_DELAY_MS = 2_000;

interface LocalModelRequestLogEntry {
  readonly model: string;
  readonly hasAgentTool: boolean;
  readonly delegated: boolean;
}

function startDeterministicModelServer(): Promise<{
  baseUrl: string;
  requestLog: () => readonly LocalModelRequestLogEntry[];
  childRequestCount: () => number;
  close: () => Promise<void>;
}> {
  const log: LocalModelRequestLogEntry[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body: { model?: unknown; tools?: unknown; messages?: unknown } | null = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      const requestedModel = typeof body?.model === "string" ? body.model : "";
      const tools: ReadonlyArray<{ name?: string; function?: { name?: string } }> = Array.isArray(
        body?.tools,
      )
        ? (body.tools as ReadonlyArray<{ name?: string; function?: { name?: string } }>)
        : [];
      const hasAgentTool = tools.some((tool) => toolName(tool) === AGENT_TOOL_NAME);
      const messages: ReadonlyArray<{ readonly role?: string }> = Array.isArray(body?.messages)
        ? (body.messages as ReadonlyArray<{ readonly role?: string }>)
        : [];
      const isDriver =
        requestedModel === DRIVER_MODEL_ID || requestedModel.endsWith(`/${DRIVER_MODEL_ID}`);
      const lastMessageIsUser = (messages.at(-1)?.role ?? "") === "user";
      const lastUserIndex = (() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === "user") return index;
        }
        return -1;
      })();
      const lastToolIndex = (() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === "tool") return index;
        }
        return -1;
      })();
      // One delegation per fresh user turn. A follow-up request after a tool
      // result must answer plain text, or the parent would loop forever; a
      // child request never carries the Agent tool, so it can never delegate.
      const shouldDelegate =
        isDriver && hasAgentTool && lastMessageIsUser && lastUserIndex > lastToolIndex;
      log.push({ model: requestedModel, hasAgentTool, delegated: shouldDelegate });
      const respond = () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunkEvent = (delta: Record<string, unknown>, finishReason: string | null) =>
          `data: ${JSON.stringify({
            id: "chatcmpl-synara-local-echo",
            object: "chat.completion.chunk",
            created: 0,
            model: requestedModel,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`;
        if (shouldDelegate) {
          const toolArgs = JSON.stringify({
            task: "Run the standard-composition admission delegation",
            context: "Deterministic loopback harness; the child must simply complete.",
            link_references: "None",
            expected_outcome: "A completed child run with a text result.",
            subagent_type: "researcher",
          });
          res.write(
            chunkEvent(
              {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call_std_composition_${log.length}`,
                    type: "function",
                    function: { name: AGENT_TOOL_NAME, arguments: toolArgs },
                  },
                ],
              },
              null,
            ),
          );
          res.write(chunkEvent({}, "tool_calls"));
        } else {
          res.write(chunkEvent({ role: "assistant", content: "ACK" }, null));
          res.write(chunkEvent({}, "stop"));
        }
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-synara-local-echo",
            object: "chat.completion.chunk",
            created: 0,
            model: requestedModel,
            choices: [],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      };
      if (shouldDelegate) {
        // Real-model latency for a delegating parent turn: the projection
        // must record the running turn (turn.started → thread.session.set)
        // before the Agent tool call executes.
        setTimeout(respond, DRIVER_DELAY_MS);
      } else {
        respond();
      }
    });
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolvePromise({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requestLog: () => [...log],
        childRequestCount: () =>
          log.filter(
            (entry) =>
              (entry.model === ECHO_MODEL_ID || entry.model.endsWith(`/${ECHO_MODEL_ID}`)) &&
              !entry.hasAgentTool,
          ).length,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

// ─── Agent-dir fixtures (local copies of the pinned-suite pattern) ───────────

function resolveAlfieRepoDir(): string {
  const candidates = [
    process.env.ALFIE_REPO_DIR,
    process.env.ALFIE_EXTENSION_DIR
      ? resolve(process.env.ALFIE_EXTENSION_DIR, "../../..")
      : undefined,
    resolve(homedir(), "alfie"),
    resolve(process.cwd(), "../../../alfie"),
    resolve(process.cwd(), "../../alfie"),
    resolve(process.cwd(), "../alfie"),
    resolve(__dirname, "../../../../../../alfie"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (dir && existsSync(dir) && existsSync(join(dir, ".git"))) return resolve(dir);
  }
  throw new Error(
    "Standard-composition regression test: could not locate the version-controlled alfie repository. Set ALFIE_REPO_DIR or ensure alfie exists alongside symphony.",
  );
}

function createRealExtensionDirectory(tempAgentDir: string): void {
  const repoDir = resolveAlfieRepoDir();
  const versionedDir = join(repoDir, "agent/extensions/pi-subagents");
  if (!existsSync(versionedDir) || !existsSync(join(versionedDir, "package.json"))) {
    throw new Error(`Pinned extension directory not found at '${versionedDir}'.`);
  }
  const extensionsDir = join(tempAgentDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  const link = join(extensionsDir, "pi-subagents");
  if (!existsSync(link)) symlinkSync(versionedDir, link, "dir");
  const sharedDir = join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    const sharedLink = join(extensionsDir, "shared");
    if (!existsSync(sharedLink)) symlinkSync(sharedDir, sharedLink, "dir");
  }
  const systemDir = join(versionedDir, "..", "..", "system");
  if (existsSync(systemDir)) {
    const systemLink = join(tempAgentDir, "system");
    if (!existsSync(systemLink)) symlinkSync(systemDir, systemLink, "dir");
  }
}

function writeAgentDirWithModels(
  tempAgentDir: string,
  baseUrl: string,
  modelIds: readonly string[],
): void {
  mkdirSync(tempAgentDir, { recursive: true });
  createRealExtensionDirectory(tempAgentDir);
  writeFileSync(
    join(tempAgentDir, "auth.json"),
    JSON.stringify({
      [DRIVER_MODEL_PROVIDER]: { type: "api_key", key: "synara-local-test-key" },
    }),
  );
  writeFileSync(
    join(tempAgentDir, "models.json"),
    JSON.stringify({
      providers: {
        [DRIVER_MODEL_PROVIDER]: {
          name: "Synara Local Echo (deterministic test fixture provider)",
          baseUrl,
          api: "openai-completions",
          apiKey: "synara-local-test-key",
          authHeader: true,
          compat: { supportsDeveloperRole: false },
          models: modelIds.map((id) => ({
            id,
            name: `Local ${id}`,
            reasoning: false,
            input: ["text"],
            contextWindow: 100_000,
            maxTokens: 1_000,
          })),
        },
      },
    }),
  );
}

// ─── Server config + projection seeding (local copies) ───────────────────────

function makeServerConfig(
  tempDir: string,
  dbPath: string,
  overrides?: Partial<ServerConfigShape>,
): ServerConfigShape {
  return {
    mode: "web",
    port: 3799,
    host: "127.0.0.1",
    cwd: tempDir,
    homeDir: tempDir,
    chatWorkspaceRoot: tempDir,
    studioWorkspaceRoot: tempDir,
    baseDir: tempDir,
    stateDir: tempDir,
    secretsDir: tempDir,
    dbPath,
    settingsPath: join(tempDir, "settings.json"),
    keybindingsConfigPath: join(tempDir, "keybindings.json"),
    worktreesDir: tempDir,
    attachmentsDir: tempDir,
    logsDir: tempDir,
    serverLogPath: join(tempDir, "server.log"),
    serverRuntimeStatePath: join(tempDir, "runtime.json"),
    providerLogsDir: tempDir,
    providerEventLogPath: join(tempDir, "provider.ndjson"),
    terminalLogsDir: tempDir,
    environmentIdPath: join(tempDir, "env-id"),
    staticDir: undefined,
    devUrl: undefined,
    publicUrl: undefined,
    allowInsecureRemote: false,
    noBrowser: true,
    authToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logProviderEvents: false,
    logWebSocketEvents: false,
    ...overrides,
  };
}

function seedParentThread(threadId: ThreadId, projectId: ProjectId, workspaceRoot: string) {
  return Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    // Seed through the REAL engine (event-sourced decider + projection
    // pipelines), exactly like production thread creation — direct table
    // inserts would be invisible to the decider's state model.
    yield* orchestrationEngine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd_std_composition_project_${threadId}`),
      projectId,
      title: "Default",
      workspaceRoot,
      defaultModelSelection: null,
      createdAt: "2026-08-18T00:00:00.000Z",
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd_std_composition_thread_${threadId}`),
      threadId,
      projectId,
      title: `Standard composition ${threadId}`,
      modelSelection: { provider: "pi", model: "pi" },
      interactionMode: "default",
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: "2026-08-18T00:00:00.000Z",
    });
  });
}

// ─── Test ────────────────────────────────────────────────────────────────────

describe("Pi managed-subagent admission production composition (regression)", () => {
  it("standard makeServerApplicationLayers: valid authority passes the preflight and starts a child; runtime-registry revocation fails closed with zero child starts", async () => {
    const threadId = "th_std_composition" as ThreadId;
    const rootDir = mkdtempSync(join(tmpdir(), "synara-std-composition-"));
    const dbPath = join(rootDir, "state.sqlite");
    const parentAgentDir = join(rootDir, "parent-agent");
    const childAgentDir = join(rootDir, "child-agent");
    const piHomeDir = join(rootDir, "pi-home");
    const createdDirs = [rootDir];

    const modelServer = await startDeterministicModelServer();
    writeAgentDirWithModels(parentAgentDir, modelServer.baseUrl, [DRIVER_MODEL_ID, ECHO_MODEL_ID]);
    writeAgentDirWithModels(childAgentDir, modelServer.baseUrl, [ECHO_MODEL_ID]);
    mkdirSync(piHomeDir, { recursive: true });
    writeFileSync(
      join(piHomeDir, "PREFERENCES.md"),
      `---\nmodels:\n  subagent: ${DRIVER_MODEL_PROVIDER}/${ECHO_MODEL_ID}\n---\n`,
    );

    // Child agent dir + isolated PREFERENCES.md root; restored in afterAll.
    const previousCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
    const previousPiHome = process.env.PI_HOME;
    process.env.PI_CODING_AGENT_DIR = childAgentDir;
    process.env.PI_HOME = piHomeDir;

    const serverConfig = makeServerConfig(rootDir, dbPath, {
      piSubagentForegroundWaitMs: 30_000,
    });

    try {
      // ── The UNMODIFIED standard application composition ─────────────
      // Assembly mirrors piSubagentRealPiAcceptanceHelpers: the provider
      // layer is provided INTO the runtime services graph, then the
      // requirement leaves (config/sqlite/node platform) are provided last
      // so the merged layer is self-contained for ManagedRuntime.
      const layers = makeServerApplicationLayers();
      const sqliteLayer = makeSqlitePersistenceLive(dbPath).pipe(Layer.provide(NodeServices.layer));
      const runtimeLayer = Layer.mergeAll(
        layers.runtimeServicesLayer.pipe(Layer.provideMerge(layers.providerLayer)),
      ).pipe(
        Layer.provideMerge(Layer.succeed(ServerConfig, serverConfig)),
        Layer.provideMerge(sqliteLayer),
        Layer.provideMerge(NodeServices.layer),
      );
      const runtime = makeManagedRuntime(runtimeLayer);

      const testProgram = Effect.gen(function* () {
        const orchestrationReactor = yield* OrchestrationReactor;
        yield* orchestrationReactor.start;

        const authority = yield* McpSessionAuthority;
        const adapterRegistry = yield* ProviderAdapterRegistry;
        // The standard composition exposes the Pi adapter only through the
        // registry (production never resolves PiAdapter directly).
        const adapter = yield* adapterRegistry.getByProvider("pi");
        const providerService = yield* ProviderService;
        const repository = yield* PiSubagentExecutionRepository;
        const completionCount = yield* Ref.make(0);

        yield* Effect.addFinalizer(() =>
          adapter.stopSession(threadId).pipe(Effect.catch(() => Effect.void)),
        );

        // Turn-completion observer: counts ADAPTER turn completions for the
        // test thread (events flow adapter → provider-service journal → PubSub).
        const turnCompletedSubscription = providerService.streamEvents.pipe(
          Stream.filter((event) => event.type === "turn.completed" && event.threadId === threadId),
          Stream.runForEach(() => Ref.update(completionCount, (count) => count + 1)),
        );
        yield* Effect.forkScoped(turnCompletedSubscription);

        const waitForTurns = (target: number): Effect.Effect<void, Error> => {
          const attempt = (remaining: number): Effect.Effect<void, Error> =>
            Ref.get(completionCount).pipe(
              Effect.flatMap((count) =>
                count >= target
                  ? Effect.void
                  : remaining <= 0
                    ? Effect.fail(
                        new Error(
                          `Timed out waiting for ${target} completed parent turn(s); observed ${count}.`,
                        ),
                      )
                    : Effect.sleep(100).pipe(Effect.flatMap(() => attempt(remaining - 1))),
              ),
            );
          return attempt(2_400);
        };

        // Real engine seeding: one full-access project + thread for the
        // parent (event-sourced, projected like production).
        yield* seedParentThread(threadId, "proj_default" as ProjectId, rootDir);

        // Mint + bind through the STANDARD runtime registry (the exact
        // instance the ProviderCommandReactor/AgentGateway use).
        const record = authority.mint({
          subject: "user_std_composition",
          kind: "authenticated",
          authSessionId: "auth_session_std_composition",
          authExpiresAt: null,
        });
        const binding = authority.bindingFor(record.authorityId, {
          threadId,
          provider: "pi",
          projectId: "proj_default",
          lifecycleGeneration: null,
          credentialTtlMs: 60 * 60 * 1_000,
        });
        expect(binding).not.toBeNull();
        if (binding === null) throw new Error("bindingFor returned null for a fresh record");

        yield* adapter.startSession({
          threadId,
          cwd: parentAgentDir,
          runtimeMode: "full-access",
          providerOptions: { pi: { agentDir: parentAgentDir } },
          modelSelection: { provider: "pi", model: DRIVER_MODEL_ID },
          mcpAuthority: binding,
        });

        // ── Phase 1: valid authority — admission passes, child starts ──
        const childRequestsBeforeFirst = modelServer.childRequestCount();
        yield* adapter.sendTurn({
          threadId,
          input: "Run the standard-composition admission delegation.",
        });
        yield* waitForTurns(1);

        const rowsAfterFirst = yield* repository.listByThreadId(threadId);
        expect(rowsAfterFirst).toHaveLength(1);
        const executionId = rowsAfterFirst[0]!.executionId;
        expect(executionId).toMatch(/^exec_/);
        const journal = yield* repository.listJournalEvents(executionId);
        const sequences = journal.map((entry) => entry.sequence);
        // Admission (1) and started (2) are mandatory; the child terminal
        // ingest (40) arrives when the inline child completes.
        expect(sequences).toContain(1);
        expect(sequences).toContain(2);
        expect(journal.find((entry) => entry.sequence === 1)!.state).toBe("accepted");
        const started = journal.find((entry) => entry.sequence === 2)!;
        expect(started.state).toBe("running");
        expect(started.metadata).toMatchObject({
          phase: "started",
          attachmentMode: "foreground",
          foregroundWaitMs: 30_000,
        });
        // A real managed child consumed the loopback model. If the old
        // unavailable-snapshot or missing-authority-registry branch had
        // fired, admission would have been rejected: no journal rows and
        // no child request would exist.
        expect(modelServer.childRequestCount()).toBeGreaterThan(childRequestsBeforeFirst);

        // ── Phase 2: revoke through the STANDARD registry, then delegate
        //    again — admission must observe the revocation and fail closed.
        authority.revoke(record.authorityId, "standard composition regression revocation");
        const childRequestsBeforeSecond = modelServer.childRequestCount();
        yield* adapter.sendTurn({
          threadId,
          input: "Delegation after authority revocation.",
        });
        yield* waitForTurns(2);

        const rowsAfterSecond = yield* repository.listByThreadId(threadId);
        // The denied admission is durably recorded as the thread's second
        // execution with a terminal rejected state (fail-closed truth); the
        // original execution stays the only started one.
        expect(rowsAfterSecond).toHaveLength(2);
        const originalRow = rowsAfterSecond.find((row) => row.executionId === executionId);
        expect(originalRow).toBeDefined();
        expect(originalRow!.observedState).not.toBe("rejected");
        const rejectedRow = rowsAfterSecond.find((row) => row.observedState === "rejected");
        expect(rejectedRow).toBeDefined();
        expect(rejectedRow!.diagnosticCode).toBe("pi_subagent_admission_unauthorized");
        expect(rejectedRow!.parentThreadId).toBe(threadId);
        // Zero child starts: the rejected admission happened before any
        // spawn (the previous child request count is unchanged).
        expect(modelServer.childRequestCount()).toBe(childRequestsBeforeSecond);

        // The parent turn must surface the deterministic revoked-binding
        // diagnostic as the Agent tool result (fail closed).
        const threadSnapshot = yield* adapter.readThread(threadId);
        const historyItems = threadSnapshot.turns.flatMap((turn) => turn.items as unknown[]);
        // The runtime records the rejected Agent call as a completed tool
        // call whose output/result payload carries the deterministic
        // fail-closed rejection text; assert on that content.
        const rejectedAgentItem = historyItems.find(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            (item as { type?: unknown }).type === "tool_call" &&
            (item as { toolName?: unknown }).toolName === AGENT_TOOL_NAME &&
            JSON.stringify(item).includes("pi_subagent_admission_unauthorized"),
        );
        expect(rejectedAgentItem).toBeDefined();
        const rejectedItemText = JSON.stringify(rejectedAgentItem);
        expect(rejectedItemText).toContain("revoked");
        expect(rejectedItemText).not.toContain("server projection snapshot is unavailable");
        expect(rejectedItemText).not.toContain("MCP session authority registry is unavailable");
      });

      // The runtime provides every service the program requires; TS cannot
      // prove union membership of the program's ~6-service requirement
      // channel against the ~80-service merged runtime type (the runtime
      // Services type is a superset), so the dependency channel is narrowed
      // explicitly.
      await runtime.runPromise(
        testProgram.pipe(Effect.scoped) as Effect.Effect<void, unknown, never>,
      );
      await runtime.dispose();
    } finally {
      process.env.PI_CODING_AGENT_DIR = previousCodingAgentDir;
      process.env.PI_HOME = previousPiHome;
      for (const dir of createdDirs.splice(0)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
      await modelServer.close();
    }
  }, 240_000);
});
