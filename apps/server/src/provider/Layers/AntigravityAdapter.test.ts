import { spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@synara/contracts";
import { Effect, Fiber, Layer, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config";
import {
  DEFAULT_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_LIFECYCLE,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
  DEFAULT_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
  MAX_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
  MIN_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
  resolveAntigravityStopIdleBackgroundDeadlineMs,
  resolveAntigravityStopIdleCloseWaitMs,
  resolveAntigravityStopIdleFinalDrainMs,
  resolveAntigravityStopIdleLifecycle,
  resolveAntigravityStopIdleMaxContinuations,
  resolveAntigravityStopIdleStableEofQuietMs,
} from "../../config";
import {
  AgentGatewayCredentials,
  type AgentGatewayCredentialsShape,
} from "../../agentGateway/Services/AgentGatewayCredentials";
import { makeTestMcpSessionAuthorityFixture } from "../../agentGateway/mcpSessionAuthority.testUtils";
import { AntigravityAdapter, type AntigravityAdapterShape } from "../Services/AntigravityAdapter";
import { ProviderProcessExitUnprovenError } from "../supervisedProcessTeardown";
import {
  antigravityPromptCommandLineIssue,
  type AntigravityAdapterDependencies,
  buildAntigravityCaptureCommand,
  buildAntigravityHookConfig,
  buildAntigravityTurnProcessEnvironment,
  buildAntigravityTurnPrompt,
  ensureCapturePlugin,
  hookScriptSource,
  makeAntigravityRuntimeEventBase,
  makeAntigravityAdapterLive,
  parseAntigravityCliModelLabel,
  parseAntigravityModelLines,
  readCompleteAntigravityLines,
  resolveAntigravityCliModelLabel,
  runAntigravityHelperProcess,
} from "./AntigravityAdapter";

const failTeardown = async () => {
  throw new Error("process exit could not be proven");
};

const noopRequestStop = () => undefined;

const makeLeakedWatcher = () => () => undefined;

function runCaptureCommand(command: string, input: string, env: NodeJS.ProcessEnv) {
  const shell = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  return spawnSync(shell, args, {
    env: { ...process.env, ...env },
    input,
    encoding: "utf8",
    timeout: 5_000,
  });
}

describe("Antigravity CLI model translation", () => {
  it("collapses CLI model/effort labels into base models with effort ladders", () => {
    expect(
      parseAntigravityModelLines(`
Gemini 3.5 Flash (Medium)
Gemini 3.5 Flash (High)
Gemini 3.5 Flash (Low)
Gemini 3.1 Pro (Low)
Gemini 3.1 Pro (High)
Claude Sonnet 4.6 (Thinking)
Claude Opus 4.6 (Thinking)
GPT-OSS 120B (Medium)
`),
    ).toEqual([
      {
        slug: "Gemini 3.5 Flash",
        name: "Gemini 3.5 Flash",
        supportedReasoningEfforts: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
        defaultReasoningEffort: "medium",
      },
      {
        slug: "Gemini 3.1 Pro",
        name: "Gemini 3.1 Pro",
        supportedReasoningEfforts: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
        defaultReasoningEffort: "low",
      },
      {
        slug: "Claude Sonnet 4.6",
        name: "Claude Sonnet 4.6",
        supportedReasoningEfforts: [{ value: "thinking", label: "Thinking" }],
        defaultReasoningEffort: "thinking",
      },
      {
        slug: "Claude Opus 4.6",
        name: "Claude Opus 4.6",
        supportedReasoningEfforts: [{ value: "thinking", label: "Thinking" }],
        defaultReasoningEffort: "thinking",
      },
      {
        slug: "GPT-OSS 120B",
        name: "GPT-OSS 120B",
        supportedReasoningEfforts: [{ value: "medium", label: "Medium" }],
        defaultReasoningEffort: "medium",
      },
    ]);
  });

  it("collapses tab-separated slug/label rows from newer agy models output", () => {
    expect(
      parseAntigravityModelLines(`
gemini-3.6-flash-high\tGemini 3.6 Flash (High)
gemini-3.6-flash-medium\tGemini 3.6 Flash (Medium)
gemini-3.6-flash-low\tGemini 3.6 Flash (Low)
gemini-3.1-pro-high\tGemini 3.1 Pro (High)
gemini-3.1-pro-low\tGemini 3.1 Pro (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
`),
    ).toEqual([
      {
        slug: "Gemini 3.6 Flash",
        name: "Gemini 3.6 Flash",
        supportedReasoningEfforts: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
        defaultReasoningEffort: "medium",
      },
      {
        slug: "Gemini 3.1 Pro",
        name: "Gemini 3.1 Pro",
        supportedReasoningEfforts: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
        defaultReasoningEffort: "low",
      },
      {
        slug: "Claude Sonnet 4.6",
        name: "Claude Sonnet 4.6",
        supportedReasoningEfforts: [{ value: "thinking", label: "Thinking" }],
        defaultReasoningEffort: "thinking",
      },
    ]);
  });

  it("rebuilds the exact CLI model label only at dispatch", () => {
    expect(parseAntigravityCliModelLabel("Gemini 3.5 Flash (High)")).toEqual({
      model: "Gemini 3.5 Flash",
      effort: "high",
    });
    expect(parseAntigravityCliModelLabel("gemini-3.6-flash-high\tGemini 3.6 Flash (High)")).toEqual(
      {
        model: "Gemini 3.6 Flash",
        effort: "high",
      },
    );
    expect(resolveAntigravityCliModelLabel("Gemini 3.5 Flash")).toBe("Gemini 3.5 Flash (Medium)");
    expect(resolveAntigravityCliModelLabel("Gemini 3.5 Flash", { reasoningEffort: "high" })).toBe(
      "Gemini 3.5 Flash (High)",
    );
    expect(resolveAntigravityCliModelLabel("Gemini 3.5 Flash (Low)")).toBe(
      "Gemini 3.5 Flash (Low)",
    );
    expect(resolveAntigravityCliModelLabel("gemini-3.6-flash-high\tGemini 3.6 Flash (High)")).toBe(
      "Gemini 3.6 Flash (High)",
    );
  });

  it("accepts bullet-prefixed model output", () => {
    expect(parseAntigravityCliModelLabel("* Gemini 3.5 Flash (High)")).toEqual({
      model: "Gemini 3.5 Flash",
      effort: "high",
    });
    expect(parseAntigravityCliModelLabel("• Claude Sonnet 4.6 (Thinking)")).toEqual({
      model: "Claude Sonnet 4.6",
      effort: "thinking",
    });
  });

  it("discovers future CLI models without requiring a static catalog update", () => {
    expect(
      parseAntigravityModelLines(`
Gemini 4 Pro (Low)
Gemini 4 Pro (Ultra)
Claude Sonnet 5 (Thinking)
`),
    ).toEqual([
      {
        slug: "Gemini 4 Pro",
        name: "Gemini 4 Pro",
        supportedReasoningEfforts: [
          { value: "low", label: "Low" },
          { value: "ultra", label: "Ultra" },
        ],
        defaultReasoningEffort: "low",
      },
      {
        slug: "Claude Sonnet 5",
        name: "Claude Sonnet 5",
        supportedReasoningEfforts: [{ value: "thinking", label: "Thinking" }],
        defaultReasoningEffort: "thinking",
      },
    ]);
  });

  it("dispatches a discovered model with its discovered default effort", () => {
    expect(resolveAntigravityCliModelLabel("Gemini 4 Pro", undefined, "low")).toBe(
      "Gemini 4 Pro (Low)",
    );
  });
});

describe("Antigravity CLI integration helpers", () => {
  it("rotates the gateway lease per print turn and rejects a retained prior bootstrap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-turn-lease-"));
    const liveTokens = new Set<string>();
    const bootstrapOwners = new Map<string, string>();
    const revokedTokens: string[] = [];
    const spawnedEnvironments: NodeJS.ProcessEnv[] = [];
    let tokenSequence = 0;
    let bootstrapSequence = 0;
    const issueSessionToken = () => {
      const token = `turn-session-${String(++tokenSequence)}`;
      liveTokens.add(token);
      return token;
    };
    const credentials: AgentGatewayCredentialsShape = {
      mcpEndpointUrl: "http://127.0.0.1:3773/mcp",
      setListeningPort: () => undefined,
      issueSessionToken: () => issueSessionToken(),
      verifySessionToken: (token) => (liveTokens.has(token) ? "thread-antigravity" : null),
      verifySession: () => null,
      issueStdioBootstrapToken: (sessionToken) => {
        if (!liveTokens.has(sessionToken)) return null;
        const bootstrap = `turn-bootstrap-${String(++bootstrapSequence)}`;
        bootstrapOwners.set(bootstrap, sessionToken);
        return bootstrap;
      },
      exchangeStdioBootstrapToken: (bootstrap) => {
        const owner = bootstrapOwners.get(bootstrap);
        bootstrapOwners.delete(bootstrap);
        return owner && liveTokens.has(owner) ? owner : null;
      },
      bindWriteAuthority: () => null,
      verifyWriteAuthority: () => false,
      registerInFlightRequest: () => () => undefined,
      cancelInFlightRequests: () => ({ count: 0, settled: Promise.resolve() }),
      cancelSessionTurnRequests: () => Promise.resolve(),
      retireSessionTurn: () => Promise.resolve(),
      revokeSessionToken: (token) => {
        liveTokens.delete(token);
        revokedTokens.push(token);
        for (const [bootstrap, owner] of bootstrapOwners) {
          if (owner === token) bootstrapOwners.delete(bootstrap);
        }
      },
      connectionForThread: () => ({
        url: "http://127.0.0.1:3773/mcp",
        bearerToken: issueSessionToken(),
      }),
      stdioProxy: { command: process.execPath, args: ["proxy.mjs"] },
    };
    let processSequence = 0;
    const spawnProcess = ((
      _command: string,
      _args: readonly string[],
      options: { readonly env?: NodeJS.ProcessEnv },
    ) => {
      spawnedEnvironments.push(options.env ?? {});
      const child = new EventEmitter() as ChildProcess;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      Object.assign(child, {
        pid: 10_000 + ++processSequence,
        stdout,
        stderr,
        killed: false,
        kill: () => true,
      });
      setTimeout(() => {
        stdout.end("done\n");
        stderr.end();
        child.emit("close", 0, null);
      }, 50).unref();
      return child;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          const threadId = ThreadId.makeUnsafe("thread-antigravity-turn-lease");
          const authorityFixture = makeTestMcpSessionAuthorityFixture();
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
            mcpAuthority: authorityFixture.bindingForThread({
              threadId: "thread-antigravity-turn-lease",
              provider: "antigravity",
            }),
          });
          const waitUntilReady = Effect.gen(function* () {
            for (let attempt = 0; attempt < 100; attempt += 1) {
              const session = (yield* adapter.listSessions()).find(
                (candidate) => candidate.threadId === threadId,
              );
              if (session?.status === "ready") return;
              yield* Effect.sleep(10);
            }
            throw new Error("Antigravity test turn did not settle.");
          });

          yield* adapter.sendTurn({ threadId, input: "turn A", attachments: [] });
          const bootstrapA = spawnedEnvironments[0]?.SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN;
          expect(bootstrapA).toBe("turn-bootstrap-1");
          yield* waitUntilReady;
          expect(revokedTokens).toEqual(["turn-session-1"]);

          yield* adapter.sendTurn({ threadId, input: "turn B", attachments: [] });
          const bootstrapB = spawnedEnvironments[1]?.SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN;
          expect(bootstrapB).toBe("turn-bootstrap-2");
          expect(credentials.exchangeStdioBootstrapToken(bootstrapA!)).toBeNull();
          expect(credentials.exchangeStdioBootstrapToken(bootstrapB!)).toBe("turn-session-2");
          yield* waitUntilReady;
          expect(revokedTokens).toEqual(["turn-session-1", "turn-session-2"]);
          yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
            }).pipe(
              Layer.provide(Layer.succeed(AgentGatewayCredentials, credentials)),
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-turn-lease-test-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("installs the generated Synara MCP plugin alongside the capture hooks", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-home-test-"));
    const stdioProxy = {
      command: "/Applications/Synara.app/Contents/MacOS/Synara",
      args: ["/state/agent-gateway-mcp-proxy.mjs"],
    };
    const invocations: Array<{
      readonly command: string;
      readonly args: string[];
      readonly options: { cwd?: string; timeoutMs?: number };
    }> = [];
    try {
      await ensureCapturePlugin("/usr/local/bin/agy", stdioProxy, {
        homeDir,
        runHelper: async (command, args, options) => {
          if (options === undefined) {
            throw new Error("Expected plugin installation options.");
          }
          invocations.push({ command, args, options });
          return { stdout: "installed", stderr: "", code: 0 };
        },
      });

      const pluginDir = path.join(
        homeDir,
        ".gemini",
        "antigravity-cli",
        "plugins",
        "synara-capture",
      );
      expect(invocations).toEqual([
        {
          command: "/usr/local/bin/agy",
          args: ["plugin", "install", pluginDir],
          options: { timeoutMs: 30_000 },
        },
      ]);
      expect(
        JSON.parse(await fs.readFile(path.join(pluginDir, "mcp_config.json"), "utf8")),
      ).toEqual({
        mcpServers: {
          synara: {
            command: stdioProxy.command,
            args: stdioProxy.args,
            env: {
              SYNARA_AGENT_GATEWAY_URL: "$SYNARA_AGENT_GATEWAY_URL",
              SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN: "$SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN",
              ELECTRON_RUN_AS_NODE: "1",
            },
            disabled: false,
            disabledTools: [],
          },
        },
      });
      await expect(fs.readFile(path.join(pluginDir, "hooks.json"), "utf8")).resolves.toContain(
        "PreToolUse",
      );
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it("gives an Antigravity turn only its thread-scoped gateway credential", () => {
    const env = buildAntigravityTurnProcessEnvironment({
      eventFile: "/tmp/thread-a-hooks.ndjson",
      gatewayConnection: {
        url: "http://127.0.0.1:3773/mcp",
      },
      gatewayBootstrapToken: "thread-a-bootstrap",
      baseEnv: {
        PATH: "/usr/bin",
        HOME: "/home/test",
        GEMINI_API_KEY: "gemini-key",
        SYNARA_AGENT_GATEWAY_URL: "http://127.0.0.1:9999/stale",
        SYNARA_AGENT_GATEWAY_TOKEN: "stale-token",
        SYNARA_AUTH_TOKEN: "host-control-plane-token",
        SYNARA_BROWSER_HOST_PIPE_PATH: "/tmp/desktop.sock",
        SYNARA_BROWSER_USE_PIPE_PATH: "/tmp/legacy.sock",
        SYNARA_BROWSER_HOST_CAPABILITY: "desktop-capability",
        SYNARA_BROWSER_HOST_CAPABILITY_FD: "3",
        NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS: "/tmp/desktop.sock",
      },
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/test",
      GEMINI_API_KEY: "gemini-key",
      SYNARA_AGENT_GATEWAY_URL: "http://127.0.0.1:3773/mcp",
      SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN: "thread-a-bootstrap",
      SYNARA_ANTIGRAVITY_EVENTS: "/tmp/thread-a-hooks.ndjson",
      SYNARA_ANTIGRAVITY_HOOK_DECISION: "allow",
    });
  });

  it("advertises canonical browser tools only while the session owns a gateway lease", () => {
    const withLease = {};
    const autonomousPrompt = buildAntigravityTurnPrompt(withLease, {
      prompt: "Ouvre YouTube dans le navigateur intégré.",
      hasGatewaySessionLease: true,
    });
    expect(autonomousPrompt).toContain("Use the browser_* tools autonomously");
    expect(autonomousPrompt).toContain("browser_open");
    expect(autonomousPrompt).toContain("Ouvre YouTube dans le navigateur intégré.");
    expect(
      buildAntigravityTurnPrompt(withLease, {
        prompt: "Continue.",
        hasGatewaySessionLease: true,
      }),
    ).toBe("Continue.");

    const withoutLease = {};
    const identityOnlyPrompt = buildAntigravityTurnPrompt(withoutLease, {
      prompt: "Ouvre YouTube dans le navigateur intégré.",
      hasGatewaySessionLease: false,
    });
    expect(identityOnlyPrompt).not.toContain("browser_*");
    expect(identityOnlyPrompt).toContain("Synara MCP control is unavailable");

    const envWithoutLease = buildAntigravityTurnProcessEnvironment({
      eventFile: "/tmp/thread-b-hooks.ndjson",
      baseEnv: {
        SYNARA_AGENT_GATEWAY_URL: "http://127.0.0.1:9999/stale",
        SYNARA_AGENT_GATEWAY_TOKEN: "stale-token",
        SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN: "stale-bootstrap",
      },
    });
    expect(envWithoutLease.SYNARA_AGENT_GATEWAY_URL).toBeUndefined();
    expect(envWithoutLease.SYNARA_AGENT_GATEWAY_TOKEN).toBeUndefined();
    expect(envWithoutLease.SYNARA_AGENT_GATEWAY_BOOTSTRAP_TOKEN).toBeUndefined();
  });

  it("propagates the owning lifecycle generation into runtime events", () => {
    expect(
      makeAntigravityRuntimeEventBase({
        threadId: "thread-antigravity-lifecycle" as never,
        lifecycleGeneration: "generation-1",
        eventId: "event-1" as never,
        createdAt: "2026-07-17T00:00:00.000Z",
      }),
    ).toMatchObject({
      provider: "antigravity",
      threadId: "thread-antigravity-lifecycle",
      lifecycleGeneration: "generation-1",
      eventId: "event-1",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("keeps the globally installed hook neutral outside Synara sessions", () => {
    const command = buildAntigravityCaptureCommand(
      "__synara_gui_must_not_launch__",
      "__capture_script_must_not_run__",
      "pre-tool",
    );
    const result = runCaptureCommand(
      command,
      // Stay below platform pipe-buffer limits: spawnSync itself can deadlock
      // while writing multi-megabyte stdin on macOS, which tests Node rather
      // than the hook's simple drain-and-return behavior.
      JSON.stringify({ payload: "x".repeat(32 * 1024) }),
      { SYNARA_ANTIGRAVITY_EVENTS: "" },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    // Neutral for PreToolUse means preserving the permission flow: Antigravity
    // requires a `decision`, and an empty object is treated as a denial with
    // an empty reason that blocks every tool call (#490).
    expect(result.stdout.trim()).toBe('{"decision":"ask"}');

    const postToolResult = runCaptureCommand(
      buildAntigravityCaptureCommand(
        "__synara_gui_must_not_launch__",
        "__capture_script_must_not_run__",
        "post-tool",
      ),
      JSON.stringify({ payload: "x" }),
      { SYNARA_ANTIGRAVITY_EVENTS: "" },
    );
    expect(postToolResult.error).toBeUndefined();
    expect(postToolResult.status).toBe(0);
    expect(postToolResult.stdout.trim()).toBe("{}");
  });

  it("answers pre-tool with a decision from the capture script when capture is inactive", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-hook-test-"));
    const scriptPath = path.join(directory, "capture.cjs");
    try {
      await fs.writeFile(scriptPath, hookScriptSource(), { mode: 0o700 });
      // Invoke the script directly, bypassing the shell wrapper: its inactive
      // fallback is defense in depth for a caller that runs the script without
      // a capture target, and must answer PreToolUse with a decision too.
      const result = spawnSync(process.execPath, [scriptPath, "pre-tool"], {
        env: { ...process.env, SYNARA_ANTIGRAVITY_EVENTS: "" },
        input: JSON.stringify({ tool: "shell" }),
        encoding: "utf8",
        timeout: 5_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('{"decision":"ask"}');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("runs the capture script for Synara-managed sessions", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-hook-test-"));
    const scriptPath = path.join(directory, "capture.cjs");
    const eventPath = path.join(directory, "events.ndjson");
    try {
      await fs.writeFile(scriptPath, hookScriptSource(), { mode: 0o700 });
      const command = buildAntigravityCaptureCommand(process.execPath, scriptPath, "pre-tool");
      const payload = JSON.stringify({
        stepIdx: 12,
        conversationId: "conversation-1",
        transcriptPath: "/tmp/transcript.jsonl",
        toolCall: {
          name: "run_command",
          args: { CommandLine: "echo super-secret-token" },
        },
      });
      const result = runCaptureCommand(command, payload, {
        SYNARA_ANTIGRAVITY_EVENTS: eventPath,
        SYNARA_ANTIGRAVITY_HOOK_DECISION: "allow",
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('{"decision":"allow"}');
      const captured = await fs.readFile(eventPath, "utf8");
      expect(captured).toBe(
        'pre-tool\t{"conversationId":"conversation-1","transcriptPath":"/tmp/transcript.jsonl","stepIdx":12,"toolCall":{"name":"run_command"}}\n',
      );
      expect(captured).not.toContain("super-secret-token");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("runs packaged Electron as Node only for Synara-managed sessions", () => {
    expect(
      buildAntigravityCaptureCommand(
        "/Applications/Synara.app/Contents/MacOS/Synara",
        "/tmp/synara-capture/capture.cjs",
        "pre-tool",
        "darwin",
      ),
    ).toBe(
      `if [ -z "\${SYNARA_ANTIGRAVITY_EVENTS:-}" ]; then cat >/dev/null 2>&1 || :; printf '%s\\n' '{"decision":"ask"}'; else ELECTRON_RUN_AS_NODE=1 '/Applications/Synara.app/Contents/MacOS/Synara' '/tmp/synara-capture/capture.cjs' 'pre-tool'; fi`,
    );
    expect(
      buildAntigravityCaptureCommand(
        String.raw`C:\Program Files\Synara\Synara.exe`,
        String.raw`C:\Users\test\.gemini\capture.cjs`,
        "pre-tool",
        "win32",
      ),
    ).toBe(
      String.raw`if not defined SYNARA_ANTIGRAVITY_EVENTS (more >nul 2>nul & echo {"decision":"ask"}) else (set "ELECTRON_RUN_AS_NODE=1" && "C:\Program Files\Synara\Synara.exe" "C:\Users\test\.gemini\capture.cjs" "pre-tool")`,
    );
  });

  it("guards Windows command-line limits before spawning the CLI", () => {
    expect(antigravityPromptCommandLineIssue("x".repeat(24_000), "win32")).toBeNull();
    expect(antigravityPromptCommandLineIssue("x".repeat(24_001), "win32")).toContain(
      "limited to 24,000 characters",
    );
    expect(antigravityPromptCommandLineIssue("x".repeat(120_000), "darwin")).toBeNull();
  });

  it("marks every generated hook as a command hook", () => {
    expect(buildAntigravityHookConfig((event) => `capture ${event}`)).toEqual({
      "synara-capture": {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "capture pre-tool" }],
          },
        ],
        PostToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "capture post-tool" }],
          },
        ],
        PreInvocation: [{ type: "command", command: "capture pre-invocation" }],
        PostInvocation: [{ type: "command", command: "capture post-invocation" }],
        Stop: [{ type: "command", command: "capture stop" }],
      },
    });
  });

  it("advances file offsets only past complete JSONL records", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-test-"));
    const file = path.join(directory, "events.ndjson");
    try {
      await fs.writeFile(file, '{"first":true}\n{"second"');
      const first = await readCompleteAntigravityLines(file, 0);
      expect(first).toEqual({ lines: ['{"first":true}'], nextOffset: 15 });

      await fs.appendFile(file, ":true}\n");
      const second = await readCompleteAntigravityLines(file, first.nextOffset);
      expect(second).toEqual({ lines: ['{"second":true}'], nextOffset: 31 });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("streams hook tool names and terminal states without arguments", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-tool-events-"));
    let eventFile: string | undefined;
    let child: (ChildProcess & { stdout: PassThrough; stderr: PassThrough }) | undefined;
    const spawnProcess = ((
      _command: string,
      _args: readonly string[],
      options: { readonly env?: NodeJS.ProcessEnv },
    ) => {
      eventFile = options.env?.SYNARA_ANTIGRAVITY_EVENTS;
      const spawned = new EventEmitter() as ChildProcess & {
        stdout: PassThrough;
        stderr: PassThrough;
      };
      Object.assign(spawned, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: () => true,
      });
      child = spawned;
      return spawned;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          const toolEventsFiber = yield* adapter.streamEvents.pipe(
            Stream.filter(
              (event) => event.type === "item.started" || event.type === "item.completed",
            ),
            Stream.take(4),
            Stream.runCollect,
            Effect.forkChild,
          );
          const threadId = ThreadId.makeUnsafe("thread-antigravity-tool-events");
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          });
          const turn = yield* adapter.sendTurn({
            threadId,
            input: "exercise tools",
            attachments: [],
          });
          expect(eventFile).toBeTruthy();
          yield* Effect.promise(() =>
            fs.appendFile(
              eventFile!,
              [
                'pre-tool\t{"stepIdx":7,"toolCall":{"name":"run_command","args":{"token":"super-secret-token"}}}',
                'post-tool\t{"stepIdx":7,"error":"super-secret-error"}',
                'pre-tool\t{"stepIdx":8,"toolCall":{"name":"write_to_file","args":{"content":"super-secret-content"}}}',
                'post-tool\t{"stepIdx":8,"error":""}',
                "",
              ].join("\n"),
            ),
          );

          const events = Array.from(
            yield* Fiber.join(toolEventsFiber).pipe(Effect.timeout("2 seconds")),
          );
          expect(events).toHaveLength(4);
          expect(events.map((event) => event.type)).toEqual([
            "item.started",
            "item.completed",
            "item.started",
            "item.completed",
          ]);
          expect(events.map((event) => event.payload)).toEqual([
            {
              itemType: "command_execution",
              status: "inProgress",
              title: "run_command",
              data: {
                toolCallId: `antigravity-${turn.turnId}-tool-0`,
                toolName: "run_command",
              },
            },
            {
              itemType: "command_execution",
              status: "failed",
              title: "run_command",
              data: {
                toolCallId: `antigravity-${turn.turnId}-tool-0`,
                toolName: "run_command",
              },
            },
            {
              itemType: "file_change",
              status: "inProgress",
              title: "write_to_file",
              data: {
                toolCallId: `antigravity-${turn.turnId}-tool-1`,
                toolName: "write_to_file",
              },
            },
            {
              itemType: "file_change",
              status: "completed",
              title: "write_to_file",
              data: {
                toolCallId: `antigravity-${turn.turnId}-tool-1`,
                toolName: "write_to_file",
              },
            },
          ]);
          expect(JSON.stringify(events)).not.toContain("super-secret");

          child?.emit("close", 0, null);
          yield* Effect.sleep("25 millis");
          yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-tool-events-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("terminates helper processes that exceed their timeout", async () => {
    await expect(
      runAntigravityHelperProcess(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
        timeoutMs: 50,
      }),
    ).rejects.toThrow("Antigravity helper timed out after 50ms");
  });

  // #465: an active Stop hook must not emit a non-standard decision that can
  // hang the print process after the assistant reply is already visible.
  it("answers stop hooks with a neutral allow-exit payload", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-stop-hook-"));
    const scriptPath = path.join(directory, "capture.cjs");
    const eventPath = path.join(directory, "events.ndjson");
    try {
      await fs.writeFile(scriptPath, hookScriptSource(), { mode: 0o700 });
      const result = spawnSync(process.execPath, [scriptPath, "stop"], {
        env: { ...process.env, SYNARA_ANTIGRAVITY_EVENTS: eventPath },
        input: JSON.stringify({ stop: true }),
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("{}");
      expect(result.stdout).not.toContain('"decision":"stop"');
      expect(await fs.readFile(eventPath, "utf8")).toContain("stop\t");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Antigravity turn settle on cancel (#465)", () => {
  const makeSpawnProcess = (children: ChildProcess[]) =>
    ((
      _command: string,
      _args: readonly string[],
      _options: { readonly env?: NodeJS.ProcessEnv },
    ) => {
      const child = new EventEmitter() as ChildProcess;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      Object.assign(child, {
        stdout,
        stderr,
        killed: false,
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: () => true,
      });
      children.push(child);
      return child;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

  it("unlocks Cancel but fences a child whose exit cannot be proven", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-interrupt-hung-"));
    const children: ChildProcess[] = [];
    const spawnProcess = makeSpawnProcess(children);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          const threadId = ThreadId.makeUnsafe("thread-antigravity-interrupt-hung");
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          });
          const turn = yield* adapter.sendTurn({
            threadId,
            input: "stuck working",
            attachments: [],
          });
          const before = (yield* adapter.listSessions()).find((s) => s.threadId === threadId);
          expect(before?.status).toBe("running");
          expect(before?.activeTurnId).toBe(turn.turnId);

          yield* adapter.interruptTurn(threadId, turn.turnId);

          const after = (yield* adapter.listSessions()).find((s) => s.threadId === threadId);
          expect(after?.status).toBe("error");
          expect(after?.activeTurnId).toBeUndefined();

          const followUp = yield* Effect.exit(
            adapter.sendTurn({
              threadId,
              input: "synthetic-follow-up",
              attachments: [],
            }),
          );
          expect(followUp._tag).toBe("Failure");
          children[0]?.emit("close", 0, null);
          yield* Effect.sleep("25 millis");

          const afterLateClose = (yield* adapter.listSessions()).find(
            (session) => session.threadId === threadId,
          );
          expect(afterLateClose?.status).toBe("ready");
          expect(afterLateClose?.activeTurnId).toBeUndefined();
          const admitted = yield* adapter.sendTurn({
            threadId,
            input: "synthetic-follow-up-after-reap",
            attachments: [],
          });
          expect(admitted.turnId).toBeDefined();
          children[1]?.emit("close", 0, null);
          yield* Effect.sleep("25 millis");
          yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
              teardownProcessTree: failTeardown,
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-interrupt-hung-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("Antigravity turn settle on non-zero CLI exit with output", () => {
  it("settles a completed turn with a warning when the CLI fails late but output was produced", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-late-fail-"));
    let child: (ChildProcess & { stdout: PassThrough; stderr: PassThrough }) | undefined;
    const spawnProcess = ((_command: string, _args: readonly string[]) => {
      const spawned = new EventEmitter() as ChildProcess & {
        stdout: PassThrough;
        stderr: PassThrough;
      };
      Object.assign(spawned, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: () => true,
      });
      child = spawned;
      return spawned;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          const settleFiber = yield* adapter.streamEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "runtime.error" ||
                event.type === "runtime.warning" ||
                event.type === "turn.completed",
            ),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          );
          const threadId = ThreadId.makeUnsafe("thread-antigravity-late-fail");
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          });
          yield* adapter.sendTurn({ threadId, input: "hello", attachments: [] });

          child!.stdout.end("a visible reply\n");
          child!.stderr.end("Error: timeout waiting for response\n");
          yield* Effect.sleep("30 millis");
          child!.emit("close", 1, null);

          const events = Array.from(
            yield* Fiber.join(settleFiber).pipe(Effect.timeout("2 seconds")),
          );
          expect(events.map((event) => event.type)).toEqual(["runtime.warning", "turn.completed"]);
          const warning = events[0];
          if (warning?.type === "runtime.warning") {
            expect(warning.payload.message).toContain("timeout waiting for response");
          }
          const completion = events[1];
          if (completion?.type === "turn.completed") {
            expect(completion.payload).toEqual({ state: "completed", stopReason: "model_stop" });
          }
          const session = (yield* adapter.listSessions()).find(
            (candidate) => candidate.threadId === threadId,
          );
          expect(session?.status).toBe("ready");
          yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-late-fail-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("still fails the turn when the CLI exits non-zero without any output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-silent-fail-"));
    let child: (ChildProcess & { stdout: PassThrough; stderr: PassThrough }) | undefined;
    const spawnProcess = ((_command: string, _args: readonly string[]) => {
      const spawned = new EventEmitter() as ChildProcess & {
        stdout: PassThrough;
        stderr: PassThrough;
      };
      Object.assign(spawned, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: () => true,
      });
      child = spawned;
      return spawned;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          const settleFiber = yield* adapter.streamEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "runtime.error" ||
                event.type === "runtime.warning" ||
                event.type === "turn.completed",
            ),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          );
          const threadId = ThreadId.makeUnsafe("thread-antigravity-silent-fail");
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          });
          yield* adapter.sendTurn({ threadId, input: "hello", attachments: [] });

          child!.stderr.end("Error: timeout waiting for response\n");
          yield* Effect.sleep("30 millis");
          child!.emit("close", 7, null);

          const events = Array.from(
            yield* Fiber.join(settleFiber).pipe(Effect.timeout("2 seconds")),
          );
          expect(events.map((event) => event.type)).toEqual(["runtime.error", "turn.completed"]);
          const failure = events[0];
          if (failure?.type === "runtime.error") {
            expect(failure.payload).toEqual({
              message: "Error: timeout waiting for response",
              class: "provider_error",
            });
          }
          const completion = events[1];
          if (completion?.type === "turn.completed") {
            expect(completion.payload).toEqual({
              state: "failed",
              stopReason: "error",
              errorMessage: "Error: timeout waiting for response",
            });
          }
          const session = (yield* adapter.listSessions()).find(
            (candidate) => candidate.threadId === threadId,
          );
          expect(session?.status).toBe("error");
          expect(
            (yield* adapter.listSessions()).find((candidate) => candidate.threadId === threadId)
              ?.lastError,
          ).toBe("Error: timeout waiting for response");
          yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-silent-fail-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("counts hook tool activity as output for the late-failure recovery", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-tool-output-"));
    let eventFile: string | undefined;
    let child: (ChildProcess & { stdout: PassThrough; stderr: PassThrough }) | undefined;
    const spawnProcess = ((
      _command: string,
      _args: readonly string[],
      options: { readonly env?: NodeJS.ProcessEnv },
    ) => {
      eventFile = options.env?.SYNARA_ANTIGRAVITY_EVENTS;
      const spawned = new EventEmitter() as ChildProcess & {
        stdout: PassThrough;
        stderr: PassThrough;
      };
      Object.assign(spawned, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: () => true,
      });
      child = spawned;
      return spawned;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          const settleFiber = yield* adapter.streamEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "runtime.error" ||
                event.type === "runtime.warning" ||
                event.type === "turn.completed",
            ),
            Stream.take(2),
            Stream.runCollect,
            Effect.forkChild,
          );
          const itemStartedFiber = yield* adapter.streamEvents.pipe(
            Stream.filter((event) => event.type === "item.started"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          );
          const threadId = ThreadId.makeUnsafe("thread-antigravity-tool-output");
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          });
          yield* adapter.sendTurn({ threadId, input: "exercise tools", attachments: [] });
          expect(eventFile).toBeTruthy();
          yield* Effect.promise(() =>
            fs.appendFile(
              eventFile!,
              'pre-tool\t{"stepIdx":1,"toolCall":{"name":"run_command","args":{}}}\n',
            ),
          );
          Array.from(yield* Fiber.join(itemStartedFiber).pipe(Effect.timeout("2 seconds")));

          child!.stderr.end("Error: timeout waiting for response\n");
          yield* Effect.sleep("30 millis");
          child!.emit("close", 1, null);

          const events = Array.from(
            yield* Fiber.join(settleFiber).pipe(Effect.timeout("2 seconds")),
          );
          expect(events.map((event) => event.type)).toEqual(["runtime.warning", "turn.completed"]);
          const completion = events[1];
          if (completion?.type === "turn.completed") {
            expect(completion.payload).toEqual({ state: "completed", stopReason: "model_stop" });
          }
          yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-tool-output-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("Antigravity terminal-answer recovery", () => {
  type RecoveryHarness = {
    readonly adapter: AntigravityAdapterShape;
    readonly child: ChildProcess & { stdout: PassThrough; stderr: PassThrough };
    readonly releasedLeaseCount: () => number;
    readonly spawnCount: () => number;
    readonly diagnostics: Array<{ name: string; fields: Readonly<Record<string, unknown>> }>;
    readonly events: Array<unknown>;
    readonly eventFile: string;
    readonly transcriptPath: string;
    readonly threadId: ThreadId;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function flushTimers(milliseconds = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  }

  async function waitFor(predicate: () => boolean, message: string, attempts = 200): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate()) return;
      await flushTimers(5);
    }
    throw new Error(message);
  }

  async function runHarness(
    input: {
      readonly mode?: "off" | "shadow" | "enforce";
      readonly graceMs?: number;
      readonly trackLease?: boolean;
      readonly teardown?: AntigravityAdapterDependencies["teardownProcessTree"];
      readonly stopIdle?: {
        readonly maxContinuations?: number;
        readonly backgroundDeadlineMs?: number;
        readonly closeWaitMs?: number;
        readonly stableEofQuietMs?: number;
        readonly finalDrainMs?: number;
      };
    },
    run: (harness: RecoveryHarness) => Promise<void>,
  ): Promise<void> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-recovery-"));
    const transcriptPath = path.join(root, "transcript.jsonl");
    await fs.writeFile(transcriptPath, "");
    let eventFile = "";
    let child!: RecoveryHarness["child"];
    let releasedLeaseCount = 0;
    let spawnCount = 0;
    let leaseSequence = 0;
    const authorityFixture = makeTestMcpSessionAuthorityFixture();
    const credentials: AgentGatewayCredentialsShape = {
      mcpEndpointUrl: "http://127.0.0.1:3773/mcp",
      setListeningPort: () => undefined,
      issueSessionToken: () => `unused-session-${++leaseSequence}`,
      verifySessionToken: () => null,
      verifySession: () => null,
      issueStdioBootstrapToken: (token) => `bootstrap-${token}`,
      exchangeStdioBootstrapToken: () => null,
      bindWriteAuthority: () => null,
      verifyWriteAuthority: () => false,
      registerInFlightRequest: () => () => undefined,
      cancelInFlightRequests: () => ({ count: 0, settled: Promise.resolve() }),
      cancelSessionTurnRequests: () => Promise.resolve(),
      retireSessionTurn: () => Promise.resolve(),
      revokeSessionToken: () => {
        releasedLeaseCount += 1;
      },
      connectionForThread: () => ({
        url: "http://127.0.0.1:3773/mcp",
        bearerToken: `owned-lease-${++leaseSequence}`,
      }),
      stdioProxy: { command: process.execPath, args: ["proxy.mjs"] },
    };
    const diagnostics: RecoveryHarness["diagnostics"] = [];
    const events: RecoveryHarness["events"] = [];
    const spawnProcess = ((
      _command: string,
      _args: readonly string[],
      options: { readonly env?: NodeJS.ProcessEnv },
    ) => {
      spawnCount += 1;
      eventFile = options.env?.SYNARA_ANTIGRAVITY_EVENTS ?? "";
      const spawned = new EventEmitter() as RecoveryHarness["child"];
      Object.assign(spawned, {
        pid: 41001,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: () => true,
      });
      child = spawned;
      return spawned;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          yield* adapter.streamEvents.pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                events.push(event);
              }),
            ),
            Effect.forkChild,
          );
          const threadId = ThreadId.makeUnsafe(`thread-recovery-${crypto.randomUUID()}`);
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
            lifecycleGeneration: "generation-recovery",
            ...(input.trackLease
              ? {
                  mcpAuthority: authorityFixture.bindingForThread({
                    threadId,
                    provider: "antigravity",
                  }),
                }
              : {}),
          });
          yield* adapter.sendTurn({
            threadId,
            input: "synthetic-input",
            attachments: [],
          });
          yield* Effect.promise(() =>
            run({
              adapter,
              child,
              releasedLeaseCount: () => releasedLeaseCount,
              spawnCount: () => spawnCount,
              diagnostics,
              events,
              eventFile,
              transcriptPath,
              threadId,
            }),
          );
          if (yield* adapter.hasSession(threadId)) yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
              teardownProcessTree:
                input.teardown ?? (async () => ({ escalated: false, signalErrors: [] })),
              terminalRecoveryMode: input.mode ?? "enforce",
              terminalRecoveryGraceMs: input.graceMs ?? 100,
              now: () => Date.now(),
              onRecoveryDiagnostic: (name, fields) => diagnostics.push({ name, fields }),
              ...(input.stopIdle
                ? {
                    stopIdleLifecycle: true,
                    ...(input.stopIdle.maxContinuations !== undefined
                      ? { stopIdleMaxContinuations: input.stopIdle.maxContinuations }
                      : {}),
                    ...(input.stopIdle.backgroundDeadlineMs !== undefined
                      ? { stopIdleBackgroundDeadlineMs: input.stopIdle.backgroundDeadlineMs }
                      : {}),
                    ...(input.stopIdle.closeWaitMs !== undefined
                      ? { stopIdleCloseWaitMs: input.stopIdle.closeWaitMs }
                      : {}),
                    ...(input.stopIdle.stableEofQuietMs !== undefined
                      ? { stopIdleStableEofQuietMs: input.stopIdle.stableEofQuietMs }
                      : {}),
                    ...(input.stopIdle.finalDrainMs !== undefined
                      ? { stopIdleFinalDrainMs: input.stopIdle.finalDrainMs }
                      : {}),
                  }
                : {}),
            }).pipe(
              // A lease is acquired only when startSession receives an MCP
              // authority binding, so the shared harness can provide these
              // inert credentials unconditionally without changing non-lease
              // scenarios.
              Layer.provide(Layer.succeed(AgentGatewayCredentials, credentials)),
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-recovery-config-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  async function attachTranscript(harness: RecoveryHarness): Promise<void> {
    await fs.appendFile(
      harness.eventFile,
      `pre-invocation\t${JSON.stringify({ transcriptPath: harness.transcriptPath })}\n`,
    );
    await flushTimers(75);
    await fs.appendFile(
      harness.transcriptPath,
      `${JSON.stringify({ step_index: 0, type: "USER_INPUT" })}\n`,
    );
    await flushTimers(75);
  }

  async function appendStep(
    harness: RecoveryHarness,
    step: Readonly<Record<string, unknown>> | string,
    expectCandidate = false,
  ): Promise<void> {
    await fs.appendFile(
      harness.transcriptPath,
      typeof step === "string" ? `${step}\n` : `${JSON.stringify(step)}\n`,
    );
    await flushTimers(75);
    if (expectCandidate) {
      const expectedStepIndex = typeof step === "string" ? undefined : step.step_index;
      await waitFor(
        () =>
          harness.diagnostics.some(
            ({ name, fields }) =>
              name === "antigravity.completion_candidate_started" &&
              fields.candidateStepIndex === expectedStepIndex,
          ),
        "completion candidate was not observed",
      );
    }
  }

  it("recovers one completed turn after final drain with content-free diagnostics", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "recovery teardown did not run");
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "recovered terminal event was not emitted",
      );

      expect(teardown).toHaveBeenCalledTimes(1);
      const runtimeEvents = harness.events as Array<{
        type: string;
        payload?: unknown;
        raw?: unknown;
      }>;
      expect(runtimeEvents.filter((event) => event.type === "turn.completed")).toHaveLength(1);
      expect(runtimeEvents.filter((event) => event.type === "runtime.warning")).toHaveLength(1);
      expect(
        runtimeEvents
          .filter((event) => event.type === "runtime.warning" || event.type === "turn.completed")
          .map((event) => event.type),
      ).toEqual(["runtime.warning", "turn.completed"]);
      expect(runtimeEvents.find((event) => event.type === "turn.completed")?.payload).toEqual({
        state: "completed",
        stopReason: "model_stop",
      });
      const diagnostics = JSON.stringify(
        runtimeEvents.filter(
          (event) => event.type === "runtime.warning" || event.type === "turn.completed",
        ),
      );
      expect(diagnostics).not.toContain("synthetic-final");
      expect(diagnostics).not.toContain("synthetic-input");
      expect(harness.diagnostics.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "antigravity.completion_candidate_started",
          "antigravity.missing_terminal_recovery_started",
          "antigravity.missing_terminal_recovery_completed",
        ]),
      );
      expect(
        harness.diagnostics.find(
          ({ name }) => name === "antigravity.missing_terminal_recovery_completed",
        )?.fields.teardownStage,
      ).toBe("graceful");
      const session = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(session?.status).toBe("ready");
      expect(session?.activeTurnId).toBeUndefined();
    });
  });

  it.each(["transcript", "hook", "stdout", "stderr"] as const)(
    "resets the full grace window on %s activity",
    async (activity) => {
      const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
      await runHarness({ teardown }, async (harness) => {
        await attachTranscript(harness);
        await appendStep(
          harness,
          {
            step_index: 1,
            type: "PLANNER_RESPONSE",
            content: "synthetic-final",
            tool_calls: [],
          },
          true,
        );
        await flushTimers(activity === "transcript" || activity === "hook" ? 1 : 99);
        if (activity === "transcript") {
          await fs.appendFile(
            harness.transcriptPath,
            `${JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", content: "synthetic-next", tool_calls: [] })}\n`,
          );
          await flushTimers(75);
        } else if (activity === "hook") {
          await fs.appendFile(harness.eventFile, "post-invocation\t{}\n");
          await flushTimers(75);
        } else {
          harness.child[activity].emit("data", Buffer.alloc(0));
          await flushTimers();
        }
        await flushTimers(99);
        expect(teardown).not.toHaveBeenCalled();
        await flushTimers(1);
        await waitFor(() => teardown.mock.calls.length === 1, "reset recovery did not run");
        expect(teardown).toHaveBeenCalledTimes(1);
      });
    },
  );

  it.each([
    ["malformed", "{"],
    ["empty", { step_index: 1, type: "PLANNER_RESPONSE", content: " ", tool_calls: [] }],
    [
      "tool-bearing",
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        content: "synthetic-reasoning",
        tool_calls: [{ name: "synthetic_tool", args: {} }],
      },
    ],
  ] as const)("does not recover a %s transcript record", async (_label, step) => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(harness, step);
      await flushTimers(500);
      expect(teardown).not.toHaveBeenCalled();
      expect(
        harness.diagnostics.some(
          ({ name }) => name === "antigravity.missing_terminal_recovery_started",
        ),
      ).toBe(false);
    });
  });

  it("does not recover while a tool is pending", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await fs.appendFile(
        harness.eventFile,
        'pre-tool\t{"stepIdx":1,"toolCall":{"name":"synthetic_tool"}}\n',
      );
      await flushTimers(75);
      await appendStep(harness, {
        step_index: 2,
        type: "PLANNER_RESPONSE",
        content: "synthetic-final",
        tool_calls: [],
      });
      await flushTimers(500);
      expect(teardown).not.toHaveBeenCalled();
      const session = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(session?.status).toBe("running");
      expect(session?.activeTurnId).toBeDefined();
    });
  });

  it("keeps tool start/finish authoritative during grace and only recovers a later answer", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "first", tool_calls: [] },
        true,
      );
      await fs.appendFile(
        harness.eventFile,
        'pre-tool\t{"stepIdx":2,"toolCall":{"name":"synthetic_tool"}}\npost-tool\t{"stepIdx":2}\n',
      );
      await flushTimers(75);
      await flushTimers(200);
      expect(teardown).not.toHaveBeenCalled();
      const running = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(running?.status).toBe("running");
      await appendStep(
        harness,
        { step_index: 3, type: "PLANNER_RESPONSE", content: "final", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "post-tool answer did not recover");
      expect(teardown).toHaveBeenCalledTimes(1);
    });
  });

  it("lets a healthy Stop hook during grace win without watchdog recovery", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown, graceMs: 500 }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "answer", tool_calls: [] },
        true,
      );
      await fs.appendFile(harness.eventFile, "stop\t{}\n");
      await flushTimers(75);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "healthy Stop did not settle",
      );
      expect(teardown).toHaveBeenCalledTimes(1);
      expect(
        harness.diagnostics.some(
          ({ name }) => name === "antigravity.missing_terminal_recovery_started",
        ),
      ).toBe(false);
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "runtime.warning",
        ),
      ).toHaveLength(0);
    });
  });

  it("lets activity at grace expiry win the final-drain race", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(99);
      await fs.appendFile(
        harness.transcriptPath,
        `${JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", content: "synthetic-late", tool_calls: [] })}\n`,
      );
      await flushTimers(1);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).filter(
            (event) => event.type === "item.completed",
          ).length === 2,
        "final drain did not consume late transcript activity",
      );
      expect(teardown).not.toHaveBeenCalled();
      const completedItems = (harness.events as Array<{ type: string }>).filter(
        (event) => event.type === "item.completed",
      );
      expect(completedItems).toHaveLength(2);
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "re-armed recovery did not run");
      expect(teardown).toHaveBeenCalledTimes(1);
    });
  });

  it("never promotes a delayed planner record from before the latest user boundary", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(harness, { step_index: 10, type: "USER_INPUT" });
      await appendStep(
        harness,
        {
          step_index: 11,
          type: "PLANNER_RESPONSE",
          content: "synthetic-current-final",
          tool_calls: [],
        },
        true,
      );
      await fs.appendFile(
        harness.transcriptPath,
        `${JSON.stringify({ step_index: 5, type: "PLANNER_RESPONSE", content: "synthetic-stale-final", tool_calls: [] })}\n`,
      );
      await flushTimers(75);
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "current candidate did not recover");
      const completedItems = (
        harness.events as Array<{
          type: string;
          payload?: { data?: { step_index?: number } };
        }>
      ).filter((event) => event.type === "item.completed");
      expect(completedItems.map((event) => event.payload?.data?.step_index)).toEqual([11]);
      expect(
        harness.diagnostics.some(
          ({ name, fields }) =>
            name === "antigravity.completion_candidate_started" && fields.candidateStepIndex === 5,
        ),
      ).toBe(false);
    });
  });

  it("shares watchdog teardown with session stop and quarantines unproven exit", async () => {
    let rejectWatchdog!: (cause: unknown) => void;
    let calls = 0;
    const teardown = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<never>((_resolve, reject) => {
          rejectWatchdog = reject;
        });
      }
      return Promise.resolve({ escalated: true, signalErrors: [] });
    });
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "watchdog teardown did not start");
      const stop = Effect.runPromise(harness.adapter.stopSession(harness.threadId));
      await flushTimers();
      expect(teardown).toHaveBeenCalledTimes(1);
      rejectWatchdog(
        new ProviderProcessExitUnprovenError({
          rootPid: 41001,
          rootExited: false,
          remainingDescendantPids: null,
          captureComplete: false,
        }),
      );
      await stop;
      expect(teardown).toHaveBeenCalledTimes(1);
      const session = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(session?.status).toBe("error");
      expect(
        harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
      ).toBe(true);
    });
  });

  it.each([
    ["off", 0, false],
    ["shadow", 0, true],
    ["enforce", 1, true],
  ] as const)("implements %s recovery mode", async (mode, teardownCount, detected) => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ mode, teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        mode !== "off",
      );
      await flushTimers(100);
      if (detected) {
        await waitFor(
          () =>
            harness.diagnostics.some(
              ({ name }) => name === "antigravity.missing_terminal_recovery_started",
            ),
          "mode did not reach recovery detection",
        );
      }
      if (mode === "enforce") {
        await waitFor(() => teardown.mock.calls.length === 1, "enforce teardown did not run");
        await waitFor(
          () =>
            (harness.events as Array<{ type: string }>).some(
              (event) => event.type === "turn.completed",
            ),
          "enforce terminal event was not emitted",
        );
      }
      expect(teardown).toHaveBeenCalledTimes(teardownCount);
      expect(
        harness.diagnostics.some(
          ({ name }) => name === "antigravity.missing_terminal_recovery_started",
        ),
      ).toBe(detected);
      const terminalCount = (harness.events as Array<{ type: string }>).filter(
        (event) => event.type === "turn.completed",
      ).length;
      expect(terminalCount).toBe(mode === "enforce" ? 1 : 0);
    });
  });

  it("quarantines unproven death, blocks admission, and reaps to ready", async () => {
    let attempts = 0;
    const teardown = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new ProviderProcessExitUnprovenError({
          rootPid: 41001,
          rootExited: false,
          remainingDescendantPids: [],
          captureComplete: true,
        });
      }
      return { escalated: true, signalErrors: [] };
    });
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "session.state.changed",
          ),
        "quarantine state was not emitted",
      );
      const ordered = (
        harness.events as Array<{ type: string; payload?: { state?: string } }>
      ).filter(
        (event) => event.type === "turn.completed" || event.type === "session.state.changed",
      );
      expect(ordered.slice(0, 2).map((event) => [event.type, event.payload?.state])).toEqual([
        ["turn.completed", "completed"],
        ["session.state.changed", "error"],
      ]);
      await expect(
        Effect.runPromise(
          harness.adapter.sendTurn({
            threadId: harness.threadId,
            input: "synthetic-follow-up",
            attachments: [],
          }),
        ),
      ).rejects.toThrow("cleanup is still in progress");
      await flushTimers(1_000);
      await waitFor(() => teardown.mock.calls.length === 2, "quarantine reap did not run");
      await waitFor(
        () =>
          harness.diagnostics.some(({ name }) => name === "antigravity.quarantined_process_reaped"),
        "quarantine reap did not complete",
      );
      await flushTimers();
      expect(teardown).toHaveBeenCalledTimes(2);
      const session = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(session?.status).toBe("ready");
      expect(
        harness.diagnostics.some(({ name }) => name === "antigravity.quarantined_process_reaped"),
      ).toBe(true);
    });
  });

  it("keeps recovered completion authoritative when teardown causes signal close", async () => {
    let resolveTeardown!: (value: { escalated: boolean; signalErrors: Error[] }) => void;
    const teardown = vi.fn(
      () =>
        new Promise<{ escalated: boolean; signalErrors: Error[] }>((resolve) => {
          resolveTeardown = resolve;
        }),
    );
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "watchdog did not claim teardown");
      Object.assign(harness.child, { signalCode: "SIGTERM", exitCode: 1 });
      harness.child.emit("close", 1, "SIGTERM");
      await flushTimers();
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(0);
      resolveTeardown({ escalated: false, signalErrors: [] });
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "recovery did not settle after teardown proof",
      );
      const terminals = (harness.events as Array<{ type: string; payload?: unknown }>).filter(
        (event) => event.type === "turn.completed",
      );
      expect(terminals).toHaveLength(1);
      expect(terminals[0]?.payload).toEqual({ state: "completed", stopReason: "model_stop" });
    });
  });

  it("preserves first-writer-wins before and after watchdog intent", async () => {
    const normalTeardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown: normalTeardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      Object.assign(harness.child, { exitCode: 0 });
      harness.child.emit("close", 0, null);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "normal close did not settle",
      );
      await flushTimers(500);
      expect(normalTeardown).not.toHaveBeenCalled();
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "runtime.warning",
        ),
      ).toHaveLength(0);
    });

    let resolveWatchdog!: (value: { escalated: boolean; signalErrors: Error[] }) => void;
    const watchdogTeardown = vi.fn(
      () =>
        new Promise<{ escalated: boolean; signalErrors: Error[] }>((resolve) => {
          resolveWatchdog = resolve;
        }),
    );
    await runHarness({ teardown: watchdogTeardown }, async (harness) => {
      await attachTranscript(harness);
      const turn = await Effect.runPromise(
        harness.adapter
          .readThread(harness.threadId)
          .pipe(Effect.map((snapshot) => snapshot.turns.at(-1)?.id)),
      );
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () => watchdogTeardown.mock.calls.length === 1,
        "watchdog did not claim settlement",
      );
      await Effect.runPromise(harness.adapter.interruptTurn(harness.threadId, turn));
      resolveWatchdog({ escalated: false, signalErrors: [] });
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "watchdog claimant did not settle",
      );
      const terminals = (harness.events as Array<{ type: string; payload?: unknown }>).filter(
        (event) => event.type === "turn.completed",
      );
      expect(terminals).toHaveLength(1);
      expect(terminals[0]?.payload).toEqual({ state: "completed", stopReason: "model_stop" });
    });
  });

  it("makes a stale watchdog harmless after session stop and generation replacement", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(99);
      await Effect.runPromise(harness.adapter.stopSession(harness.threadId));
      await Effect.runPromise(
        harness.adapter.startSession({
          provider: "antigravity",
          threadId: harness.threadId,
          runtimeMode: "full-access",
          providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          lifecycleGeneration: "generation-replacement",
        }),
      );
      await flushTimers(500);
      const replacement = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(replacement?.status).toBe("ready");
      expect(replacement?.activeTurnId).toBeUndefined();
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(0);
    });
  });

  it("cancels recovery timers on stop and adapter disposal", async () => {
    const baselineTimers = vi.getTimerCount();
    await runHarness({ mode: "shadow" }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
    });
    await flushTimers(1_000);
    expect(vi.getTimerCount()).toBe(baselineTimers);

    const neverProvesDeath = vi.fn(async () => {
      throw new ProviderProcessExitUnprovenError({
        rootPid: 41001,
        rootExited: false,
        remainingDescendantPids: null,
        captureComplete: false,
      });
    });
    await runHarness({ teardown: neverProvesDeath }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          content: "synthetic-final",
          tool_calls: [],
        },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () => harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
        "quarantine was not entered",
      );
    });
    await flushTimers(1_000);
    expect(vi.getTimerCount()).toBe(baselineTimers);
  });

  it("settles process error without close by the existing output policy", async () => {
    await runHarness({}, async (harness) => {
      harness.child.emit("error", new Error("synthetic-error"));
      await flushTimers();
      const terminal = (harness.events as Array<{ type: string; payload?: unknown }>).find(
        (event) => event.type === "turn.completed",
      );
      const runtimeError = (harness.events as Array<{ type: string; payload?: unknown }>).find(
        (event) => event.type === "runtime.error",
      );
      expect(runtimeError?.payload).toEqual({
        message: "Antigravity process failed before emitting a close event.",
        class: "transport_error",
      });
      expect(terminal?.payload).toEqual({
        state: "failed",
        stopReason: "error",
        errorMessage: "Antigravity process failed before emitting a close event.",
      });
    });

    await runHarness({}, async (harness) => {
      await fs.appendFile(
        harness.eventFile,
        'pre-tool\t{"stepIdx":1,"toolCall":{"name":"synthetic_tool"}}\n',
      );
      await flushTimers(75);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "item.started",
          ),
        "tool activity was not consumed",
      );
      harness.child.emit("error", new Error("synthetic-error"));
      await flushTimers();
      const terminal = (harness.events as Array<{ type: string; payload?: unknown }>).find(
        (event) => event.type === "turn.completed",
      );
      const warning = (harness.events as Array<{ type: string; payload?: unknown }>).find(
        (event) => event.type === "runtime.warning",
      );
      expect(warning?.payload).toEqual({
        message:
          "Antigravity process errored after delivering usable output; Synara completed the turn.",
      });
      expect(terminal?.payload).toEqual({ state: "completed", stopReason: "model_stop" });
      harness.child.emit("close", 1, null);
      await flushTimers();
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
    });
  });

  it("fences a settled turn until failed runDir cleanup retries successfully", async () => {
    const originalRm = fs.rm.bind(fs);
    const rm = vi.spyOn(fs, "rm");
    let ownedRunDir = "";
    let ownedAttempts = 0;
    rm.mockImplementation(async (target, options) => {
      if (String(target) === ownedRunDir && ownedAttempts++ === 0) {
        throw Object.assign(new Error("synthetic cleanup busy"), { code: "EBUSY" });
      }
      return originalRm(target, options);
    });
    try {
      await runHarness({}, async (harness) => {
        ownedRunDir = path.dirname(harness.eventFile);
        harness.child.emit("close", 0, null);
        await flushTimers();
        await waitFor(
          () =>
            harness.diagnostics.some(
              ({ name, fields }) =>
                name === "antigravity.quarantine_entered" &&
                fields.cancellationReason === "run-dir-cleanup-failed",
            ),
          "cleanup failure did not fence the session",
        );
        const fenced = (await Effect.runPromise(harness.adapter.listSessions())).find(
          (candidate) => candidate.threadId === harness.threadId,
        );
        expect(fenced?.status).toBe("error");
        await expect(fs.stat(ownedRunDir)).resolves.toBeDefined();
        await expect(
          Effect.runPromise(
            harness.adapter.sendTurn({
              threadId: harness.threadId,
              input: "blocked while cleanup is owned",
              attachments: [],
            }),
          ),
        ).rejects.toThrow("cleanup is still in progress");
        await flushTimers(1_000);
        await waitFor(
          () =>
            harness.diagnostics.some(
              ({ name }) => name === "antigravity.quarantined_process_reaped",
            ),
          "cleanup retry did not complete",
        );
        const ready = (await Effect.runPromise(harness.adapter.listSessions())).find(
          (candidate) => candidate.threadId === harness.threadId,
        );
        expect(ready?.status).toBe("ready");
        await expect(fs.stat(ownedRunDir)).rejects.toMatchObject({ code: "ENOENT" });
        expect(ownedAttempts).toBe(2);
      });
    } finally {
      rm.mockRestore();
    }
  });

  it("ignores malformed structured transcript fields and incomplete records", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await fs.appendFile(
        harness.transcriptPath,
        `${JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", content: {}, tool_calls: [] })}\n`,
      );
      await flushTimers(500);
      expect(teardown).not.toHaveBeenCalled();
      await fs.appendFile(
        harness.transcriptPath,
        `${JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", content: "valid", tool_calls: {} })}\n`,
      );
      await flushTimers(500);
      expect(teardown).not.toHaveBeenCalled();
    });
  });

  it("latches watchdog claimant before a synchronous re-entrant close", async () => {
    let child: ChildProcess | undefined;
    const teardown = vi.fn(async () => {
      child?.emit("close", 1, "SIGTERM");
      return { escalated: false, signalErrors: [] };
    });
    await runHarness({ teardown }, async (harness) => {
      child = harness.child;
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "answer", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "re-entrant watchdog close did not settle",
      );
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
    });
  });

  it("settles Stop-hook teardown failure through quarantine", async () => {
    const teardown = vi.fn(async () => {
      throw new ProviderProcessExitUnprovenError({
        rootPid: 41001,
        rootExited: false,
        remainingDescendantPids: [],
        captureComplete: true,
      });
    });
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await fs.appendFile(harness.eventFile, "stop\t{}\n");
      await flushTimers(75);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "Stop-hook failure did not settle",
      );
      const terminal = (harness.events as Array<{ type: string; payload?: unknown }>).find(
        (event) => event.type === "turn.completed",
      );
      expect(terminal?.payload).toEqual({ state: "completed", stopReason: "model_stop" });
      expect(
        harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
      ).toBe(true);
      expect(
        harness.diagnostics.some(({ name }) => name === "antigravity.stop_cleanup_unconfirmed"),
      ).toBe(true);
      expect(
        harness.diagnostics.some(({ name }) => name.startsWith("antigravity.missing_terminal")),
      ).toBe(false);
      const warning = (
        harness.events as Array<{
          type: string;
          payload?: { message?: string };
          raw?: { messageType?: string };
        }>
      ).find((event) => event.type === "runtime.warning");
      expect(warning?.payload?.message).toContain("Stop");
      expect(warning?.raw?.messageType).toBe("stop-cleanup-unconfirmed");
      const diagnosticText = JSON.stringify(harness.diagnostics);
      expect(diagnosticText).not.toMatch(
        /synthetic-input|synthetic-final|stdout|stderr|credential|account[_ -]?id/i,
      );
    });
  });

  it("invalidates an existing candidate when a new USER_INPUT boundary arrives", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown, graceMs: 500 }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "old", tool_calls: [] },
        true,
      );
      await appendStep(harness, { step_index: 2, type: "USER_INPUT" });
      await flushTimers(500);
      expect(teardown).not.toHaveBeenCalled();
      expect(
        harness.diagnostics.filter(
          ({ name, fields }) =>
            name === "antigravity.completion_candidate_cancelled" &&
            fields.cancellationReason === "user-input-boundary",
        ),
      ).not.toHaveLength(0);
    });
  });

  it("ignores ownership loss during final-drain and teardown", async () => {
    let resolveTeardown!: (value: { escalated: boolean; signalErrors: Error[] }) => void;
    const teardown = vi.fn(
      () =>
        new Promise<{ escalated: boolean; signalErrors: Error[] }>((resolve) => {
          resolveTeardown = resolve;
        }),
    );
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "old", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "teardown did not start");
      const stop = Effect.runPromise(harness.adapter.stopSession(harness.threadId));
      await flushTimers();
      resolveTeardown({ escalated: false, signalErrors: [] });
      await stop;
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(0);
    });
  });

  it("classifies process-error re-entrant close by output policy", async () => {
    let child: ChildProcess | undefined;
    const teardown = vi.fn(async () => {
      child?.emit("close", 1, "SIGTERM");
      return { escalated: false, signalErrors: [] };
    });
    await runHarness({ teardown }, async (harness) => {
      child = harness.child;
      harness.child.emit("error", new Error("synthetic-error"));
      await flushTimers();
      const terminal = (harness.events as Array<{ type: string; payload?: unknown }>).find(
        (event) => event.type === "turn.completed",
      );
      expect(terminal?.payload).toEqual({
        state: "failed",
        stopReason: "error",
        errorMessage: "Antigravity process failed before emitting a close event.",
      });
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
    });

    child = undefined;
    await runHarness({ teardown }, async (harness) => {
      child = harness.child;
      await fs.appendFile(
        harness.eventFile,
        'pre-tool\t{"stepIdx":1,"toolCall":{"name":"synthetic_tool"}}\n',
      );
      await flushTimers(75);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "item.started",
          ),
        "process-error output evidence was not consumed",
      );
      harness.child.emit("error", new Error("synthetic-error"));
      await flushTimers();
      const terminal = (harness.events as Array<{ type: string; payload?: unknown }>).find(
        (event) => event.type === "turn.completed",
      );
      expect(terminal?.payload).toEqual({ state: "completed", stopReason: "model_stop" });
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
    });
  });

  it("keeps quarantine cleanup single-flight and does not retry after Stop", async () => {
    let attempts = 0;
    const teardown = vi.fn(async () => {
      attempts += 1;
      throw new ProviderProcessExitUnprovenError({
        rootPid: 41001,
        rootExited: false,
        remainingDescendantPids: [],
        captureComplete: true,
      });
    });
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "old", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () => harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
        "watchdog quarantine did not start",
      );
      const stop = Effect.runPromise(harness.adapter.stopSession(harness.threadId));
      await stop;
      const attemptsAfterStop = attempts;
      await flushTimers(5_000);
      expect(attempts).toBe(attemptsAfterStop);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("does not invoke teardown again when a quarantined child closes late", async () => {
    let attempts = 0;
    const teardown = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new ProviderProcessExitUnprovenError({
          rootPid: 41001,
          rootExited: false,
          remainingDescendantPids: [],
          captureComplete: true,
        });
      }
      return { escalated: false, signalErrors: [] };
    });
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "old", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () => harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
        "watchdog quarantine did not start",
      );
      harness.child.emit("close", 0, null);
      await flushTimers();
      expect(attempts).toBe(1);
      expect(harness.child.listenerCount("close")).toBe(0);
    });
  });

  it("removes supervised exit watchers after every unproven quarantine retry", async () => {
    let child: ChildProcess | undefined;
    let attempts = 0;
    const teardown = vi.fn(async () => {
      attempts += 1;
      const leakedWatcher = makeLeakedWatcher();
      child?.once("exit", leakedWatcher);
      throw new ProviderProcessExitUnprovenError({
        rootPid: 41001,
        rootExited: false,
        remainingDescendantPids: [],
        captureComplete: true,
      });
    });
    await runHarness({ teardown }, async (harness) => {
      child = harness.child;
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "old", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () => harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
        "watchdog quarantine did not start",
      );
      await flushTimers(3_000);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(harness.child.listenerCount("exit")).toBe(0);
    });
  });

  it("keeps recovery metadata content-free and within the AC-18 allowlist", async () => {
    const allowed = new Set([
      "provider",
      "cliVersion",
      "threadId",
      "turnId",
      "lifecycleGeneration",
      "candidateStepIndex",
      "quietDurationMs",
      "pendingToolCount",
      "teardownStage",
      "exitCode",
      "signal",
      "remainingDescendantCount",
      "captureComplete",
      "settlementSource",
      "cancellationReason",
    ]);
    let teardownAttempts = 0;
    const teardown = vi.fn(async () => {
      teardownAttempts += 1;
      if (teardownAttempts === 1) {
        throw new ProviderProcessExitUnprovenError({
          rootPid: 41001,
          rootExited: false,
          remainingDescendantPids: [],
          captureComplete: true,
        });
      }
      return { escalated: false, signalErrors: [] };
    });
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "secret-answer", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "recovery terminal was not emitted",
      );
      await flushTimers(1_000);
      await waitFor(
        () =>
          harness.diagnostics.some(({ name }) => name === "antigravity.quarantined_process_reaped"),
        "quarantine reap diagnostic was not emitted",
      );
      for (const diagnostic of harness.diagnostics) {
        expect(Object.keys(diagnostic.fields).every((key) => allowed.has(key))).toBe(true);
        expect(JSON.stringify(diagnostic)).not.toContain("secret-answer");
      }
      const recoveryEvents = (
        harness.events as Array<{ type: string; raw?: { payload?: unknown } }>
      ).filter((event) =>
        ["runtime.warning", "turn.completed", "session.state.changed", "session.exited"].includes(
          event.type,
        ),
      );
      expect(recoveryEvents.length).toBeGreaterThanOrEqual(2);
      for (const event of recoveryEvents) {
        const payload = event.raw?.payload;
        if (payload === undefined) continue;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          expect(Object.keys(payload).every((key) => allowed.has(key))).toBe(true);
        }
        expect(JSON.stringify(event)).not.toContain("secret-answer");
      }
    });
  });

  it("preserves first claimant for Stop-hook/close in either order", async () => {
    const normalTeardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown: normalTeardown }, async (harness) => {
      await attachTranscript(harness);
      // Queue a Stop record without advancing the poll timer, then let close
      // claim the turn and remove the owned run directory first.
      await fs.appendFile(harness.eventFile, "stop\t{}\n");
      harness.child.emit("close", 0, null);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "normal close did not settle",
      );
      await flushTimers(100);
      expect(normalTeardown).not.toHaveBeenCalled();
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
    });

    let child: ChildProcess | undefined;
    const stopFirstTeardown = vi.fn(async () => {
      child?.emit("close", 0, null);
      return { escalated: false, signalErrors: [] };
    });
    await runHarness({ teardown: stopFirstTeardown }, async (harness) => {
      child = harness.child;
      await attachTranscript(harness);
      await fs.appendFile(harness.eventFile, "stop\t{}\n");
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "Stop-hook claimant did not settle",
      );
      expect(stopFirstTeardown).toHaveBeenCalledTimes(1);
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
    });
  });

  it("preserves first claimant for interrupt and late close", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      const turn = await Effect.runPromise(
        harness.adapter
          .readThread(harness.threadId)
          .pipe(Effect.map((snapshot) => snapshot.turns.at(-1)?.id)),
      );
      await Effect.runPromise(harness.adapter.interruptTurn(harness.threadId, turn));
      await flushTimers();
      harness.child.emit("close", 130, "SIGINT");
      await flushTimers();
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
      expect(teardown).toHaveBeenCalledTimes(1);
    });
  });

  it("fences sendTurn when ownership is lost during async preparation", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-admission-"));
    const threadId = ThreadId.makeUnsafe("thread-antigravity-admission-race");
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    let createdRunDir = "";
    let spawned = 0;
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          });
          const send = yield* Effect.forkChild(
            adapter.sendTurn({ threadId, input: "stale preparation", attachments: [] }),
          );
          yield* Effect.yieldNow;
          yield* Effect.promise(() => entered.promise);
          yield* adapter.stopSession(threadId);
          gate.resolve();
          yield* Effect.yieldNow;
          yield* Fiber.join(send).pipe(Effect.exit);
          expect(spawned).toBe(0);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              createRunDir: async () => {
                entered.resolve();
                await gate.promise;
                createdRunDir = await fs.mkdtemp(path.join(root, "run-"));
                return createdRunDir;
              },
              spawnProcess: (() => {
                spawned += 1;
                throw new Error("stale admission spawned a child");
              }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>,
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-admission-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
      await expect(fs.stat(createdRunDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      gate.resolve();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reaps a pending Stop quarantine exactly once for lease, runDir, timer, and listeners", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-stop-reap-"));
    const threadId = ThreadId.makeUnsafe("thread-antigravity-stop-reap");
    const authorityFixture = makeTestMcpSessionAuthorityFixture();
    const liveTokens = new Set<string>();
    let tokenSequence = 0;
    let revoked = 0;
    const credentials: AgentGatewayCredentialsShape = {
      mcpEndpointUrl: "http://127.0.0.1:3773/mcp",
      setListeningPort: () => undefined,
      issueSessionToken: () => {
        const token = `stop-reap-${++tokenSequence}`;
        liveTokens.add(token);
        return token;
      },
      verifySessionToken: (token) => (liveTokens.has(token) ? threadId : null),
      verifySession: () => null,
      issueStdioBootstrapToken: (token) => (liveTokens.has(token) ? `bootstrap-${token}` : null),
      exchangeStdioBootstrapToken: () => null,
      bindWriteAuthority: () => null,
      verifyWriteAuthority: () => false,
      registerInFlightRequest: () => () => undefined,
      cancelInFlightRequests: () => ({ count: 0, settled: Promise.resolve() }),
      cancelSessionTurnRequests: () => Promise.resolve(),
      retireSessionTurn: () => Promise.resolve(),
      revokeSessionToken: (token) => {
        if (liveTokens.delete(token)) revoked += 1;
      },
      connectionForThread: () => {
        const token = `connection-${++tokenSequence}`;
        liveTokens.add(token);
        return { url: "http://127.0.0.1:3773/mcp", bearerToken: token };
      },
      stdioProxy: { command: process.execPath, args: ["proxy.mjs"] },
    };
    let runDir = "";
    let eventFile = "";
    const diagnostics: string[] = [];
    let child!: ChildProcess & { stdout: PassThrough; stderr: PassThrough };
    const unprovenExit = new ProviderProcessExitUnprovenError({
      rootPid: 41001,
      rootExited: false,
      remainingDescendantPids: [],
      captureComplete: true,
    });
    let requestStop = noopRequestStop;
    let stop: Promise<void> | undefined;
    const teardown = vi.fn(async () => {
      requestStop();
      throw unprovenExit;
    });
    const rm = vi.spyOn(fs, "rm");
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          yield* Effect.promise(async () => {
            requestStop = () => {
              stop ??= Effect.runPromise(adapter.stopSession(threadId));
            };
            await Effect.runPromise(
              adapter.startSession({
                provider: "antigravity",
                threadId,
                runtimeMode: "full-access",
                cwd: root,
                providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
                mcpAuthority: authorityFixture.bindingForThread({
                  threadId: "thread-antigravity-stop-reap",
                  provider: "antigravity",
                }),
              }),
            );
            await Effect.runPromise(
              adapter.sendTurn({ threadId, input: "recover me", attachments: [] }),
            );
            const transcriptPath = path.join(root, "transcript.jsonl");
            await fs.writeFile(transcriptPath, "");
            await fs.appendFile(
              eventFile,
              `pre-invocation\t${JSON.stringify({ transcriptPath })}\n`,
            );
            await fs.appendFile(
              transcriptPath,
              `${JSON.stringify({ step_index: 0, type: "USER_INPUT" })}\n${JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", content: "answer", tool_calls: [] })}\n`,
            );
            for (
              let attempt = 0;
              attempt < 100 && !diagnostics.includes("antigravity.completion_candidate_started");
              attempt += 1
            ) {
              vi.advanceTimersByTime(75);
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(diagnostics).toContain("antigravity.completion_candidate_started");
            vi.advanceTimersByTime(25);
            for (let attempt = 0; attempt < 100 && teardown.mock.calls.length === 0; attempt += 1) {
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(teardown).toHaveBeenCalledTimes(1);
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const session = (await Effect.runPromise(adapter.listSessions())).find(
                (candidate) => candidate.threadId === threadId,
              );
              if (session?.status === "error") break;
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(revoked).toBe(0);
            await expect(fs.stat(runDir)).resolves.toBeDefined();
            child.emit("close", 0, null);
            await stop;
            for (let attempt = 0; attempt < 100; attempt += 1) {
              if (!(await Effect.runPromise(adapter.hasSession(threadId)))) break;
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(await Effect.runPromise(adapter.hasSession(threadId))).toBe(false);
            expect(revoked).toBe(1);
          });
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              terminalRecoveryGraceMs: 25,
              now: () => Date.now(),
              onRecoveryDiagnostic: (name) => diagnostics.push(name),
              createRunDir: async () => {
                runDir = await fs.mkdtemp(path.join(root, "turn-"));
                return runDir;
              },
              spawnProcess: ((_command, _args, options) => {
                eventFile = options.env?.SYNARA_ANTIGRAVITY_EVENTS ?? "";
                child = new EventEmitter() as typeof child;
                Object.assign(child, {
                  pid: 41001,
                  stdout: new PassThrough(),
                  stderr: new PassThrough(),
                  killed: false,
                  kill: () => true,
                });
                return child;
              }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>,
              teardownProcessTree: teardown,
            }).pipe(
              Layer.provide(Layer.succeed(AgentGatewayCredentials, credentials)),
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-stop-reap-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
      expect(eventFile).toContain(runDir);
      expect(rm.mock.calls.filter(([target]) => target === runDir)).toHaveLength(1);
      expect(child.listenerCount("exit")).toBe(0);
    } finally {
      rm.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "watchdog",
      async (harness: RecoveryHarness) => {
        await attachTranscript(harness);
        await appendStep(
          harness,
          { step_index: 1, type: "PLANNER_RESPONSE", content: "answer", tool_calls: [] },
          true,
        );
        await flushTimers(100);
      },
    ],
    [
      "Stop-hook",
      async (harness: RecoveryHarness) => {
        await attachTranscript(harness);
        await fs.appendFile(harness.eventFile, "stop\t{}\n");
        await flushTimers(75);
      },
    ],
    [
      "process-error",
      async (harness: RecoveryHarness) => {
        await harness.child.emit("error", new Error("synthetic process error"));
        await flushTimers();
      },
    ],
    [
      "interrupt",
      async (harness: RecoveryHarness) => {
        const turnId = await Effect.runPromise(
          harness.adapter
            .readThread(harness.threadId)
            .pipe(Effect.map((snapshot) => snapshot.turns.at(-1)?.id)),
        );
        await Effect.runPromise(harness.adapter.interruptTurn(harness.threadId, turnId));
        await flushTimers();
      },
    ],
  ] as const)(
    "%s keeps admission fenced after terminal settlement while owned cleanup is unconfirmed",
    async (_claimant, trigger) => {
      const teardown = vi.fn(async () => {
        throw new ProviderProcessExitUnprovenError({
          rootPid: 41001,
          rootExited: false,
          remainingDescendantPids: [],
          captureComplete: true,
        });
      });
      await runHarness({ teardown, trackLease: true }, async (harness) => {
        await trigger(harness);
        await waitFor(
          () =>
            (harness.events as Array<{ type: string }>).some(
              (event) => event.type === "turn.completed",
            ),
          "claimant did not settle a terminal turn",
        );

        const ownedRunDir = path.dirname(harness.eventFile);
        await expect(fs.stat(ownedRunDir)).resolves.toBeDefined();
        await expect(
          Effect.runPromise(
            harness.adapter.sendTurn({
              threadId: harness.threadId,
              input: "follow-up must remain fenced",
              attachments: [],
            }),
          ),
        ).rejects.toThrow("cleanup is still in progress");
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(harness.spawnCount()).toBe(1);
        expect(harness.releasedLeaseCount()).toBe(0);
        expect(
          harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
        ).toBe(true);
        await expect(fs.stat(ownedRunDir)).resolves.toBeDefined();
      });
    },
  );

  it("lets Stop join a watchdog claim without a second teardown, then close reaps and exits", async () => {
    let rejectTeardown!: (cause: unknown) => void;
    const teardown = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectTeardown = reject;
        }),
    );
    await runHarness({ teardown, trackLease: true }, async (harness) => {
      await attachTranscript(harness);
      await appendStep(
        harness,
        { step_index: 1, type: "PLANNER_RESPONSE", content: "answer", tool_calls: [] },
        true,
      );
      await flushTimers(100);
      await waitFor(() => teardown.mock.calls.length === 1, "watchdog did not claim teardown");

      const stop = Effect.runPromise(harness.adapter.stopSession(harness.threadId));
      await flushTimers();
      expect(teardown).toHaveBeenCalledTimes(1);
      rejectTeardown(
        new ProviderProcessExitUnprovenError({
          rootPid: 41001,
          rootExited: false,
          remainingDescendantPids: [],
          captureComplete: true,
        }),
      );
      await stop;
      expect(teardown).toHaveBeenCalledTimes(1);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "watchdog claimant did not emit its terminal",
      );
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "turn.completed",
        ),
      ).toHaveLength(1);
      expect(
        (harness.events as Array<{ type: string }>).filter(
          (event) => event.type === "session.exited",
        ),
      ).toHaveLength(0);
      const ownedRunDir = path.dirname(harness.eventFile);
      await expect(fs.stat(ownedRunDir)).resolves.toBeDefined();
      expect(harness.releasedLeaseCount()).toBe(0);

      harness.child.emit("close", 0, null);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "session.exited",
          ),
        "close did not reap the stopped session",
      );
      expect(teardown).toHaveBeenCalledTimes(1);
      await expect(fs.stat(ownedRunDir)).rejects.toMatchObject({ code: "ENOENT" });
      expect(harness.releasedLeaseCount()).toBe(1);
      expect(await Effect.runPromise(harness.adapter.hasSession(harness.threadId))).toBe(false);
    });
  });

  it("drains a final planner response before the single Stop-hook terminal", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown }, async (harness) => {
      await attachTranscript(harness);
      await fs.appendFile(
        harness.transcriptPath,
        `${JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", content: "final", tool_calls: [] })}\n`,
      );
      await fs.appendFile(harness.eventFile, "stop\t{}\n");
      await flushTimers(75);
      await waitFor(
        () =>
          (harness.events as Array<{ type: string }>).some(
            (event) => event.type === "turn.completed",
          ),
        "Stop-hook did not settle",
      );
      const events = harness.events as Array<{ type: string }>;
      const finalItemIndex = events.findIndex((event) => event.type === "item.completed");
      const terminalIndex = events.findIndex((event) => event.type === "turn.completed");
      expect(finalItemIndex).toBeGreaterThanOrEqual(0);
      expect(finalItemIndex).toBeLessThan(terminalIndex);
      expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    });
  });

  it("makes one bounded preparation cleanup attempt during Stop and never rearms its timer", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-preparation-stop-"));
    const threadId = ThreadId.makeUnsafe("thread-antigravity-preparation-stop");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let runDir = "";
    let cleanupAttempts = 0;
    const diagnostics: string[] = [];
    const originalRm = fs.rm.bind(fs);
    const rm = vi.spyOn(fs, "rm");
    rm.mockImplementation(async (target, options) => {
      if (String(target) === runDir) {
        cleanupAttempts += 1;
        throw Object.assign(new Error("synthetic preparation cleanup busy"), { code: "EBUSY" });
      }
      return originalRm(target, options);
    });
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
          });
          const send = yield* Effect.forkChild(
            adapter.sendTurn({ threadId, input: "preparation race", attachments: [] }),
          );
          yield* Effect.promise(() => entered.promise);
          yield* adapter.stopSession(threadId);
          release.resolve();
          const result = yield* Fiber.join(send).pipe(Effect.exit);
          expect(result._tag).toBe("Failure");
          expect(cleanupAttempts).toBe(1);
          expect(diagnostics).toContain("antigravity.quarantine_entered");
          expect(vi.getTimerCount()).toBe(0);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              createRunDir: async () => {
                entered.resolve();
                await release.promise;
                runDir = await fs.mkdtemp(path.join(root, "turn-"));
                return runDir;
              },
              spawnProcess: (() => {
                throw new Error("stale preparation must not spawn");
              }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>,
              onRecoveryDiagnostic: (name) => diagnostics.push(name),
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-prep-stop-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      release.resolve();
      rm.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("quarantines an unproven replacement teardown and does not admit a replacement turn", async () => {
    const teardown = vi.fn(async () => {
      throw new ProviderProcessExitUnprovenError({
        rootPid: 41001,
        rootExited: false,
        remainingDescendantPids: [],
        captureComplete: true,
      });
    });
    await runHarness({ teardown }, async (harness) => {
      const oldRunDir = path.dirname(harness.eventFile);
      try {
        await expect(
          Effect.runPromise(
            harness.adapter.startSession({
              provider: "antigravity",
              threadId: harness.threadId,
              runtimeMode: "full-access",
              providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
              lifecycleGeneration: "replacement-generation",
            }),
          ),
        ).rejects.toThrow();
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(harness.spawnCount()).toBe(1);
        await expect(fs.stat(oldRunDir)).resolves.toBeDefined();
        expect(
          harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
        ).toBe(true);
        await expect(
          Effect.runPromise(
            harness.adapter.sendTurn({
              threadId: harness.threadId,
              input: "replacement must remain blocked",
              attachments: [],
            }),
          ),
        ).rejects.toThrow("cleanup is still in progress");
      } finally {
        harness.child.emit("close", 0, null);
        await flushTimers();
      }
    });
  });
});

describe("Antigravity Stop fullyIdle lifecycle configuration", () => {
  it("exports the expected defaults", () => {
    expect(DEFAULT_ANTIGRAVITY_STOP_IDLE_LIFECYCLE).toBe(false);
    expect(DEFAULT_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS).toBe(64);
    expect(DEFAULT_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS).toBe(600_000);
    expect(DEFAULT_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS).toBe(5000);
    expect(DEFAULT_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS).toBe(500);
    expect(DEFAULT_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS).toBe(5000);
  });

  it.each([
    ["true", true],
    ["1", true],
    ["on", true],
    ["TRUE", true],
    [true, true],
    ["false", false],
    ["0", false],
    ["off", false],
    [false, false],
  ] as const)("resolves lifecycle input %s to %s", (input, expected) => {
    expect(resolveAntigravityStopIdleLifecycle(input)).toBe(expected);
  });

  it.each([["yes"], [""], [" "], [123], [{}], [null], [undefined]] as const)(
    "falls back lifecycle input %p to the default",
    (input) => {
      expect(resolveAntigravityStopIdleLifecycle(input)).toBe(false);
    },
  );

  it.each([
    {
      resolve: resolveAntigravityStopIdleMaxContinuations,
      fallback: DEFAULT_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
      min: MIN_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
      max: MAX_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS,
      label: "max continuations",
    },
    {
      resolve: resolveAntigravityStopIdleBackgroundDeadlineMs,
      fallback: DEFAULT_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS,
      min: 1000,
      max: 2_147_483_647,
      label: "background deadline",
    },
    {
      resolve: resolveAntigravityStopIdleCloseWaitMs,
      fallback: DEFAULT_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS,
      min: 100,
      max: 600_000,
      label: "close wait",
    },
    {
      resolve: resolveAntigravityStopIdleStableEofQuietMs,
      fallback: DEFAULT_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS,
      min: 50,
      max: 60_000,
      label: "stable EOF quiet",
    },
    {
      resolve: resolveAntigravityStopIdleFinalDrainMs,
      fallback: DEFAULT_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS,
      min: 100,
      max: 60_000,
      label: "final drain",
    },
  ])("resolves and falls back safely for $label", ({ resolve, fallback, min, max }) => {
    expect(resolve(undefined)).toBe(fallback);
    expect(resolve(null)).toBe(fallback);
    expect(resolve("abc")).toBe(fallback);
    expect(resolve("100ms")).toBe(fallback);
    expect(resolve(1.5)).toBe(fallback);
    expect(resolve(true)).toBe(fallback);
    expect(resolve({})).toBe(fallback);
    expect(resolve(Infinity)).toBe(fallback);
    expect(resolve(NaN)).toBe(fallback);
    expect(resolve("  ")).toBe(fallback);
    // Never clamped: out-of-range input silently reverts to the default.
    expect(resolve(min - 1)).toBe(fallback);
    expect(resolve(String(min - 1))).toBe(fallback);
    expect(resolve(max + 1)).toBe(fallback);
    expect(resolve(String(max + 1))).toBe(fallback);
    // Valid numeric and trimmed string inputs resolve exactly.
    expect(resolve(min)).toBe(min);
    expect(resolve(String(min))).toBe(min);
    expect(resolve(max)).toBe(max);
    expect(resolve(String(max))).toBe(max);
    expect(resolve(`  ${min}  `)).toBe(min);
    expect(resolve(`+${min}`)).toBe(min);
  });

  it("passes the stop-idle continuation budget to the Antigravity child environment", () => {
    const withStopIdle = buildAntigravityTurnProcessEnvironment({
      eventFile: "/tmp/events.ndjson",
      stopIdle: { maxContinuations: 7 },
    });
    expect(withStopIdle.SYNARA_ANTIGRAVITY_STOP_IDLE).toBe("1");
    expect(withStopIdle.SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS).toBe("7");
    const withoutStopIdle = buildAntigravityTurnProcessEnvironment({
      eventFile: "/tmp/events.ndjson",
    });
    expect(withoutStopIdle.SYNARA_ANTIGRAVITY_STOP_IDLE).toBeUndefined();
    expect(withoutStopIdle.SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS).toBeUndefined();
  });
});

describe("Antigravity Stop fullyIdle capture hook", () => {
  const runStopHook = (
    scriptPath: string,
    eventPath: string,
    input: unknown,
    env: NodeJS.ProcessEnv,
  ) =>
    spawnSync(process.execPath, [scriptPath, "stop"], {
      env: { ...process.env, ...env, SYNARA_ANTIGRAVITY_EVENTS: eventPath },
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 5_000,
    });

  it("continues while fullyIdle is false under the bounded cap, then caps out with continued=false", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-agy-stop-idle-hook-"));
    const scriptPath = path.join(directory, "capture.cjs");
    const eventPath = path.join(directory, "events.ndjson");
    try {
      await fs.writeFile(scriptPath, hookScriptSource(), { mode: 0o700 });
      const env = {
        SYNARA_ANTIGRAVITY_STOP_IDLE: "1",
        SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS: "2",
      };
      const first = runStopHook(
        scriptPath,
        eventPath,
        {
          fullyIdle: false,
          executionNum: 0,
          terminationReason: "model_stop",
          error: "",
          workspacePaths: ["/workspace/project"],
          artifactDirectoryPath: "/artifacts",
        },
        env,
      );
      expect(first.status).toBe(0);
      expect(first.stdout.trim()).toBe('{"decision":"continue"}');
      const second = runStopHook(
        scriptPath,
        eventPath,
        {
          fullyIdle: false,
          executionNum: 1,
        },
        env,
      );
      expect(second.stdout.trim()).toBe('{"decision":"continue"}');
      const capped = runStopHook(
        scriptPath,
        eventPath,
        {
          fullyIdle: false,
          executionNum: 2,
        },
        env,
      );
      expect(capped.stdout.trim()).toBe("{}");
      const idle = runStopHook(
        scriptPath,
        eventPath,
        {
          fullyIdle: true,
          executionNum: 3,
        },
        env,
      );
      expect(idle.stdout.trim()).toBe("{}");
      const missing = runStopHook(scriptPath, eventPath, { executionNum: 4 }, env);
      expect(missing.stdout.trim()).toBe("{}");
      const malformed = runStopHook(scriptPath, eventPath, { fullyIdle: "yes" }, env);
      expect(malformed.stdout.trim()).toBe("{}");

      const contents = await fs.readFile(eventPath, "utf8");
      const records = contents
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line.slice(5)) as Record<string, unknown>);
      expect(records.map((record) => record.fullyIdle)).toEqual([
        false,
        false,
        false,
        true,
        undefined,
        undefined,
      ]);
      expect(records[0]).toMatchObject({
        continued: true,
        continuationLimit: 2,
        executionNum: 0,
        terminationReason: "model_stop",
      });
      expect(records[1]).toMatchObject({ continued: true });
      expect(records[2]).toMatchObject({ continued: false, continuationLimit: 2 });
      expect(records[3]).toMatchObject({ continued: false });
      // Sanitization: unknown fields are dropped, error text is bounded.
      expect(JSON.stringify(records[0])).not.toContain("workspacePaths");
      expect(JSON.stringify(records[0])).not.toContain("artifactDirectoryPath");
      const oversized = runStopHook(
        scriptPath,
        eventPath,
        {
          fullyIdle: false,
          executionNum: 5,
          error: "x".repeat(10_000),
        },
        env,
      );
      expect(oversized.stdout.trim()).toBe("{}");
      const allLines = (await fs.readFile(eventPath, "utf8")).split("\n").filter(Boolean);
      const lastRecord = JSON.parse(allLines[allLines.length - 1]!.slice(5)) as Record<
        string,
        unknown
      >;
      expect(String(lastRecord.error).length).toBeLessThanOrEqual(500);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("stays legacy fail-open when the stop-idle env is absent", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-agy-stop-idle-off-"));
    const scriptPath = path.join(directory, "capture.cjs");
    const eventPath = path.join(directory, "events.ndjson");
    try {
      await fs.writeFile(scriptPath, hookScriptSource(), { mode: 0o700 });
      const result = runStopHook(scriptPath, eventPath, { fullyIdle: false, executionNum: 0 }, {});
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("{}");
      expect(result.stdout).not.toContain('"decision":"continue"');
      const contents = await fs.readFile(eventPath, "utf8");
      const record = JSON.parse(contents.trim().slice(5)) as Record<string, unknown>;
      expect(record.fullyIdle).toBe(false);
      expect(record.continued).toBeUndefined();
      expect(record.continuationLimit).toBeUndefined();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Antigravity Stop fullyIdle background lifecycle", () => {
  type StopIdleHarness = {
    readonly adapter: AntigravityAdapterShape;
    readonly child: ChildProcess & { stdout: PassThrough; stderr: PassThrough };
    readonly diagnostics: Array<{ name: string; fields: Readonly<Record<string, unknown>> }>;
    readonly events: Array<unknown>;
    readonly eventFile: string;
    readonly transcriptPath: string;
    readonly threadId: ThreadId;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function flushTimers(milliseconds = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  }

  async function waitFor(predicate: () => boolean, message: string, attempts = 400): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (predicate()) return;
      await flushTimers(5);
    }
    throw new Error(message);
  }

  async function drainFor(milliseconds: number): Promise<void> {
    let remaining = milliseconds;
    while (remaining > 0) {
      const step = Math.min(remaining, 50);
      await vi.advanceTimersByTimeAsync(step);
      await Promise.resolve();
      await Promise.resolve();
      remaining -= step;
    }
  }

  async function runHarness(
    input: {
      readonly graceMs?: number;
      readonly teardown?: AntigravityAdapterDependencies["teardownProcessTree"];
      readonly stopIdle?: {
        readonly maxContinuations?: number;
        readonly backgroundDeadlineMs?: number;
        readonly closeWaitMs?: number;
        readonly stableEofQuietMs?: number;
        readonly finalDrainMs?: number;
      };
    },
    run: (harness: StopIdleHarness) => Promise<void>,
  ): Promise<void> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "synara-antigravity-stop-idle-"));
    const transcriptPath = path.join(root, "transcript.jsonl");
    await fs.writeFile(transcriptPath, "");
    let eventFile = "";
    let child!: StopIdleHarness["child"];
    const diagnostics: StopIdleHarness["diagnostics"] = [];
    const events: StopIdleHarness["events"] = [];
    const spawnProcess = ((
      _command: string,
      _args: readonly string[],
      options: { readonly env?: NodeJS.ProcessEnv },
    ) => {
      eventFile = options.env?.SYNARA_ANTIGRAVITY_EVENTS ?? "";
      const spawned = new EventEmitter() as StopIdleHarness["child"];
      Object.assign(spawned, {
        pid: 42001,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: () => true,
      });
      child = spawned;
      return spawned;
    }) as NonNullable<AntigravityAdapterDependencies["spawnProcess"]>;

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const adapter = yield* AntigravityAdapter;
          yield* adapter.streamEvents.pipe(
            Stream.runForEach((event) => Effect.sync(() => events.push(event))),
            Effect.forkChild,
          );
          const threadId = ThreadId.makeUnsafe(`thread-stop-idle-${crypto.randomUUID()}`);
          yield* adapter.startSession({
            provider: "antigravity",
            threadId,
            runtimeMode: "full-access",
            cwd: root,
            providerOptions: { antigravity: { binaryPath: "/fake/agy" } },
            lifecycleGeneration: "generation-stop-idle",
          });
          yield* adapter.sendTurn({ threadId, input: "synthetic-input", attachments: [] });
          yield* Effect.promise(() =>
            run({
              adapter,
              child,
              diagnostics,
              events,
              eventFile,
              transcriptPath,
              threadId,
            }),
          );
          if (yield* adapter.hasSession(threadId)) yield* adapter.stopSession(threadId);
        }).pipe(
          Effect.provide(
            makeAntigravityAdapterLive({
              ensurePlugin: async () => undefined,
              spawnProcess,
              teardownProcessTree:
                input.teardown ?? (async () => ({ escalated: false, signalErrors: [] })),
              terminalRecoveryMode: "enforce",
              terminalRecoveryGraceMs: input.graceMs ?? 100,
              now: () => Date.now(),
              onRecoveryDiagnostic: (name, fields) => diagnostics.push({ name, fields }),
              ...(input.stopIdle
                ? {
                    stopIdleLifecycle: true,
                    ...(input.stopIdle.maxContinuations !== undefined
                      ? { stopIdleMaxContinuations: input.stopIdle.maxContinuations }
                      : {}),
                    ...(input.stopIdle.backgroundDeadlineMs !== undefined
                      ? { stopIdleBackgroundDeadlineMs: input.stopIdle.backgroundDeadlineMs }
                      : {}),
                    ...(input.stopIdle.closeWaitMs !== undefined
                      ? { stopIdleCloseWaitMs: input.stopIdle.closeWaitMs }
                      : {}),
                    ...(input.stopIdle.stableEofQuietMs !== undefined
                      ? { stopIdleStableEofQuietMs: input.stopIdle.stableEofQuietMs }
                      : {}),
                    ...(input.stopIdle.finalDrainMs !== undefined
                      ? { stopIdleFinalDrainMs: input.stopIdle.finalDrainMs }
                      : {}),
                  }
                : {}),
            }).pipe(
              Layer.provideMerge(
                ServerConfig.layerTest(root, { prefix: "antigravity-stop-idle-config-" }),
              ),
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  async function attachTranscript(harness: StopIdleHarness): Promise<void> {
    await fs.appendFile(
      harness.eventFile,
      `pre-invocation\t${JSON.stringify({ transcriptPath: harness.transcriptPath })}\n`,
    );
    await flushTimers(75);
    await fs.appendFile(
      harness.transcriptPath,
      `${JSON.stringify({ step_index: 0, type: "USER_INPUT" })}\n`,
    );
    await flushTimers(75);
  }

  async function appendPlannerStep(
    harness: StopIdleHarness,
    stepIndex: number,
    content: string,
  ): Promise<void> {
    await fs.appendFile(
      harness.transcriptPath,
      `${JSON.stringify({ step_index: stepIndex, type: "PLANNER_RESPONSE", content, tool_calls: [] })}\n`,
    );
    await flushTimers(75);
  }

  async function appendStopRecord(
    harness: StopIdleHarness,
    payload: Record<string, unknown>,
    milliseconds = 75,
  ): Promise<void> {
    await fs.appendFile(harness.eventFile, `stop\t${JSON.stringify(payload)}\n`);
    await flushTimers(milliseconds);
  }

  type TypedEvent = {
    readonly type: string;
    readonly payload?: unknown;
    readonly turnId?: unknown;
  };

  const eventsOf = (harness: StopIdleHarness): TypedEvent[] => harness.events as TypedEvent[];

  const activityStates = (harness: StopIdleHarness): string[] =>
    eventsOf(harness)
      .filter((event) => event.type === "turn.background-activity.changed")
      .map((event) => (event.payload as { state: string }).state);

  const turnTerminals = (harness: StopIdleHarness): TypedEvent[] =>
    eventsOf(harness).filter((event) => event.type === "turn.completed");

  const defaultStopIdle = {
    maxContinuations: 8,
    backgroundDeadlineMs: 60_000,
    closeWaitMs: 60_000,
    stableEofQuietMs: 100,
    finalDrainMs: 1000,
  } as const;

  it("keeps the turn alive on false+continued with one active edge and no recovery", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ stopIdle: defaultStopIdle, teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendPlannerStep(harness, 1, "LAUNCHED");
      await appendStopRecord(harness, {
        fullyIdle: false,
        continued: true,
        continuationLimit: 8,
        executionNum: 0,
        terminationReason: "model_stop",
      });
      await waitFor(
        () => activityStates(harness).includes("active"),
        "active edge was not emitted",
      );
      await appendStopRecord(harness, {
        fullyIdle: false,
        continued: true,
        continuationLimit: 8,
        executionNum: 1,
      });
      await drainFor(3000);
      expect(activityStates(harness).filter((state) => state === "active")).toHaveLength(1);
      expect(turnTerminals(harness)).toHaveLength(0);
      expect(teardown).not.toHaveBeenCalled();
      expect(
        harness.diagnostics.some(
          ({ name }) => name === "antigravity.missing_terminal_recovery_started",
        ),
      ).toBe(false);
      expect(
        harness.diagnostics
          .filter(({ name }) => name === "antigravity.background_continue")
          .map(({ fields }) => fields.observationCount),
      ).toEqual([1, 2]);
      const session = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(session?.status).toBe("running");
      expect(session?.activeTurnId).toBeDefined();
    });
  });

  it("settles false-true-natural-close with idle/finalizing edges, drained output, and one terminal last", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ stopIdle: defaultStopIdle, teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendPlannerStep(harness, 1, "LAUNCHED");
      await appendStopRecord(harness, {
        fullyIdle: false,
        continued: true,
        continuationLimit: 8,
        executionNum: 0,
      });
      await waitFor(
        () => activityStates(harness).includes("active"),
        "active edge was not emitted",
      );
      await appendStopRecord(harness, { fullyIdle: true, continued: false, executionNum: 1 });
      await waitFor(() => activityStates(harness).includes("idle"), "idle edge was not emitted");
      expect(teardown).not.toHaveBeenCalled();

      harness.child.emit("close", 0, null);
      await flushTimers(10);
      // A transcript line lands inside the stable-EOF quiet window and must be
      // emitted before the single terminal.
      await fs.appendFile(
        harness.transcriptPath,
        `${JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", content: "background finished", tool_calls: [] })}\n`,
      );
      await drainFor(1500);
      await waitFor(
        () => turnTerminals(harness).length === 1,
        "natural-close terminal was not emitted",
      );

      const events = eventsOf(harness);
      const states = activityStates(harness);
      expect(states).toEqual(["active", "idle", "finalizing"]);
      expect(turnTerminals(harness)).toHaveLength(1);
      const terminalIndex = events.findIndex((event) => event.type === "turn.completed");
      const finalizingIndex = events.findIndex(
        (event) =>
          event.type === "turn.background-activity.changed" &&
          (event.payload as { state: string }).state === "finalizing",
      );
      const drainedIndex = events.findIndex(
        (event) =>
          event.type === "item.completed" &&
          (event.payload as { data?: { toolName?: string } }).data?.toolName === undefined &&
          JSON.stringify(event.payload).includes("background finished"),
      );
      expect(finalizingIndex).toBeGreaterThan(-1);
      expect(drainedIndex).toBeGreaterThan(finalizingIndex);
      expect(terminalIndex).toBeGreaterThan(drainedIndex);
      expect(turnTerminals(harness)[0]?.payload).toEqual({
        state: "completed",
        stopReason: "model_stop",
      });
      expect(teardown).not.toHaveBeenCalled();
      const session = (await Effect.runPromise(harness.adapter.listSessions())).find(
        (candidate) => candidate.threadId === harness.threadId,
      );
      expect(session?.status).toBe("ready");
      let runDirRemoved = false;
      fs.stat(path.dirname(harness.eventFile)).catch(() => {
        runDirRemoved = true;
      });
      await waitFor(() => runDirRemoved, "natural-close run directory was not cleaned up");
    });
  });

  it("fails with background_idle_unconfirmed when the child closes before idle is confirmed", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ stopIdle: defaultStopIdle, teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendPlannerStep(harness, 1, "LAUNCHED");
      await appendStopRecord(harness, {
        fullyIdle: false,
        continued: false,
        continuationLimit: 8,
        executionNum: 7,
      });
      await waitFor(
        () => activityStates(harness).includes("active"),
        "active edge was not emitted",
      );
      harness.child.emit("close", 0, null);
      await drainFor(1500);
      await waitFor(
        () => turnTerminals(harness).length === 1,
        "idle-unconfirmed terminal was not emitted",
      );
      const terminals = turnTerminals(harness);
      expect(terminals[0]?.payload).toMatchObject({ state: "failed", stopReason: "error" });
      expect(JSON.stringify(terminals[0])).toContain("background_idle_unconfirmed");
      expect(
        harness.diagnostics.some(({ name }) => name === "antigravity.background_idle_unconfirmed"),
      ).toBe(true);
      // Drained output is retained before the terminal.
      const events = eventsOf(harness);
      const terminalIndex = events.findIndex((event) => event.type === "turn.completed");
      expect(JSON.stringify(events.slice(0, terminalIndex))).toContain("LAUNCHED");
    });
  });

  it("uses proven teardown on close-wait timeout and completes the turn", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness(
      {
        stopIdle: { ...defaultStopIdle, closeWaitMs: 200 },
        teardown,
      },
      async (harness) => {
        await attachTranscript(harness);
        await appendPlannerStep(harness, 1, "answer");
        await appendStopRecord(harness, { fullyIdle: true, continued: false, executionNum: 0 });
        await waitFor(
          () =>
            harness.diagnostics.some(({ name }) => name === "antigravity.background_idle_observed"),
          "idle observation diagnostic was not emitted",
        );
        await drainFor(400);
        await waitFor(
          () => turnTerminals(harness).length === 1,
          "close-wait terminal was not emitted",
        );
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(turnTerminals(harness)[0]?.payload).toEqual({
          state: "completed",
          stopReason: "model_stop",
        });
        expect(
          harness.diagnostics.some(
            ({ name }) => name === "antigravity.background_close_wait_timeout",
          ),
        ).toBe(true);
        expect(activityStates(harness)).toEqual(["finalizing"]);
        harness.child.emit("close", 0, null);
        await flushTimers();
        expect(turnTerminals(harness)).toHaveLength(1);
        expect(teardown).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("quarantines an unproven close-wait teardown through the existing machinery", async () => {
    const teardown = vi.fn(async () => {
      throw new ProviderProcessExitUnprovenError({
        rootPid: 42001,
        rootExited: false,
        remainingDescendantPids: [42009],
        captureComplete: true,
      });
    });
    await runHarness(
      {
        stopIdle: { ...defaultStopIdle, closeWaitMs: 200 },
        teardown,
      },
      async (harness) => {
        await attachTranscript(harness);
        await appendPlannerStep(harness, 1, "answer");
        await appendStopRecord(harness, { fullyIdle: true, continued: false, executionNum: 0 });
        await drainFor(400);
        await waitFor(
          () => turnTerminals(harness).length === 1,
          "unproven close-wait terminal was not emitted",
        );
        expect(turnTerminals(harness)[0]?.payload).toEqual({
          state: "completed",
          stopReason: "model_stop",
        });
        expect(
          harness.diagnostics.some(
            ({ name }) => name === "antigravity.background_teardown_unconfirmed",
          ),
        ).toBe(true);
        expect(
          harness.diagnostics.some(({ name }) => name === "antigravity.quarantine_entered"),
        ).toBe(true);
        const session = (await Effect.runPromise(harness.adapter.listSessions())).find(
          (candidate) => candidate.threadId === harness.threadId,
        );
        expect(session?.status).toBe("error");
      },
    );
  });

  it("fails through teardown and drain when the hard background deadline expires", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness(
      {
        stopIdle: { ...defaultStopIdle, backgroundDeadlineMs: 1000 },
        teardown,
      },
      async (harness) => {
        await attachTranscript(harness);
        await appendPlannerStep(harness, 1, "LAUNCHED");
        await appendStopRecord(harness, {
          fullyIdle: false,
          continued: true,
          continuationLimit: 8,
          executionNum: 0,
        });
        await waitFor(
          () => activityStates(harness).includes("active"),
          "active edge was not emitted",
        );
        await drainFor(1500);
        await waitFor(
          () => turnTerminals(harness).length === 1,
          "deadline terminal was not emitted",
        );
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(turnTerminals(harness)[0]?.payload).toMatchObject({
          state: "failed",
          stopReason: "error",
        });
        expect(JSON.stringify(turnTerminals(harness)[0])).toContain("background_deadline_exceeded");
        expect(
          harness.diagnostics.some(
            ({ name }) => name === "antigravity.background_deadline_exceeded",
          ),
        ).toBe(true);
        await drainFor(5000);
        expect(turnTerminals(harness)).toHaveLength(1);
        expect(teardown).toHaveBeenCalledTimes(1);
        harness.child.emit("close", 0, null);
        await flushTimers();
        expect(turnTerminals(harness)).toHaveLength(1);
      },
    );
  });

  it("settles exactly one interrupted terminal when interrupting during background-active", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ stopIdle: defaultStopIdle, teardown }, async (harness) => {
      await attachTranscript(harness);
      await appendPlannerStep(harness, 1, "LAUNCHED");
      await appendStopRecord(harness, {
        fullyIdle: false,
        continued: true,
        continuationLimit: 8,
        executionNum: 0,
      });
      await waitFor(
        () => activityStates(harness).includes("active"),
        "active edge was not emitted",
      );
      await Effect.runPromise(harness.adapter.interruptTurn(harness.threadId));
      await waitFor(
        () => turnTerminals(harness).length === 1,
        "interrupt terminal was not emitted",
      );
      expect(turnTerminals(harness)[0]?.payload).toEqual({
        state: "interrupted",
        stopReason: "interrupted",
      });
      await drainFor(5000);
      expect(turnTerminals(harness)).toHaveLength(1);
      expect(
        harness.diagnostics.some(({ name }) => name === "antigravity.background_deadline_exceeded"),
      ).toBe(false);
      harness.child.emit("close", 130, "SIGINT");
      await flushTimers();
      expect(turnTerminals(harness)).toHaveLength(1);
    });
  });

  it("keeps the legacy stop settle path when the feature flag is off", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ teardown, graceMs: 500 }, async (harness) => {
      await attachTranscript(harness);
      await appendPlannerStep(harness, 1, "answer");
      await appendStopRecord(harness, { fullyIdle: true, executionNum: 0 });
      await waitFor(() => turnTerminals(harness).length === 1, "legacy Stop did not settle");
      expect(teardown).toHaveBeenCalledTimes(1);
      expect(turnTerminals(harness)[0]?.payload).toEqual({
        state: "completed",
        stopReason: "model_stop",
      });
      expect(activityStates(harness)).toEqual([]);
    });
  });

  it("treats a stop record without fullyIdle as legacy fail-open even when the flag is on", async () => {
    const teardown = vi.fn(async () => ({ escalated: false, signalErrors: [] }));
    await runHarness({ stopIdle: defaultStopIdle, teardown, graceMs: 500 }, async (harness) => {
      await attachTranscript(harness);
      await appendPlannerStep(harness, 1, "answer");
      await appendStopRecord(harness, { executionNum: 0, terminationReason: "model_stop" });
      await waitFor(
        () => turnTerminals(harness).length === 1,
        "legacy fail-open Stop did not settle",
      );
      expect(teardown).toHaveBeenCalledTimes(1);
      expect(activityStates(harness)).toEqual([]);
    });
  });
});
