import * as Http from "node:http";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Command from "effect/unstable/cli/Command";
import { FetchHttpClient } from "effect/unstable/http";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterEach, beforeEach, vi } from "vitest";
import { NetService } from "@synara/shared/Net";

import { ServerConfig, type ServerConfigShape } from "./config";
import { Open, type OpenShape } from "./open";
import { Server, type ServerShape } from "./effectServer";
import { makeServerShutdownController } from "./serverShutdown";

vi.mock("./threadRetention", async () => {
  const Effect = await import("effect/Effect");
  return {
    startThreadRetentionJob: () => Effect.void,
  };
});

const antigravityAdapterConfigObservations = vi.hoisted(
  () => [] as Array<{ mode: unknown; graceMs: unknown }>,
);

vi.mock("./provider/Layers/AntigravityAdapter", async () => {
  const actual = await vi.importActual<typeof import("./provider/Layers/AntigravityAdapter")>(
    "./provider/Layers/AntigravityAdapter",
  );
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  const { ServerConfig } = await import("./config");

  return {
    ...actual,
    makeAntigravityAdapterLive: (...args: Parameters<typeof actual.makeAntigravityAdapterLive>) =>
      Layer.merge(
        actual.makeAntigravityAdapterLive(...args),
        Layer.effectDiscard(
          Effect.gen(function* () {
            const config = yield* ServerConfig;
            antigravityAdapterConfigObservations.push({
              mode: config.antigravityTerminalRecoveryMode,
              graceMs: config.antigravityTerminalRecoveryGraceMs,
            });
          }),
        ),
      ),
  };
});

import { CliConfig, makeServerStartupLogData, synaraCli, type CliConfigShape } from "./main";

const start = vi.fn(() => undefined);
const stop = vi.fn(() => undefined);
const openBrowser = vi.fn((_target: string) => Effect.void);
let resolvedConfig: ServerConfigShape | null = null;

function getResolvedConfig(): ServerConfigShape | null {
  return resolvedConfig;
}

let serverStopSignal: Effect.Effect<void> = Effect.void;
let retainedSqlClient: SqlClient.SqlClient | null = null;
let releaseServerRuntime = (_sql: SqlClient.SqlClient): Effect.Effect<void, never> => Effect.void;
const serverStart = Effect.acquireRelease(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    retainedSqlClient = sql;
    resolvedConfig = yield* ServerConfig;
    start();
    return { server: {} as unknown as Http.Server, sql };
  }),
  ({ sql }) =>
    releaseServerRuntime(sql).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          stop();
        }),
      ),
    ),
).pipe(Effect.map(({ server }) => server));
const findAvailablePort = vi.fn((preferred: number) => Effect.succeed(preferred));
let defaultSynaraHome = "";
const tempHomes = new Set<string>();

function makeTempHome(prefix = "synara-main-test-"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempHomes.add(directory);
  return directory;
}

function permissionMode(filePath: string): number {
  return fs.statSync(filePath).mode & 0o777;
}

// Shared service layer used by this CLI test suite.
const testLayer = Layer.mergeAll(
  Layer.succeed(CliConfig, {
    cwd: "/tmp/synara-test-workspace",
    fixPath: Effect.void,
    resolveStaticDir: Effect.undefined,
  } satisfies CliConfigShape),
  Layer.succeed(NetService, {
    canListenOnHost: () => Effect.succeed(true),
    isPortAvailableOnLoopback: () => Effect.succeed(true),
    reserveLoopbackPort: () => Effect.succeed(0),
    findAvailablePort,
  }),
  Layer.succeed(Server, {
    start: serverStart,
    stopSignal: Effect.suspend(() => serverStopSignal),
  } satisfies ServerShape),
  Layer.succeed(Open, {
    openBrowser,
    openInEditor: () => Effect.void,
  } satisfies OpenShape),
  FetchHttpClient.layer,
  NodeServices.layer,
);

const runCli = (args: ReadonlyArray<string>, env: Record<string, string> = {}) => {
  const program = Command.runWith(synaraCli, { version: "0.0.0-test" })(args).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            SYNARA_HOME: defaultSynaraHome,
            SYNARA_NO_BROWSER: "true",
            ...env,
          },
        }),
      ),
    ),
  );
  return program as Effect.Effect<void, unknown, never>;
};

beforeEach(() => {
  vi.clearAllMocks();
  defaultSynaraHome = makeTempHome();
  resolvedConfig = null;
  serverStopSignal = Effect.void;
  retainedSqlClient = null;
  releaseServerRuntime = () => Effect.void;
  antigravityAdapterConfigObservations.length = 0;
  start.mockImplementation(() => undefined);
  stop.mockImplementation(() => undefined);
  findAvailablePort.mockImplementation((preferred: number) => Effect.succeed(preferred));
});

afterEach(() => {
  for (const directory of tempHomes) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  tempHomes.clear();
});

it.layer(testLayer)("server CLI command", (it) => {
  it.effect("parses all CLI flags and wires scoped start/stop", () =>
    Effect.gen(function* () {
      const flagHome = makeTempHome("synara-main-flag-");

      yield* runCli([
        "--mode",
        "desktop",
        "--port",
        "4010",
        "--host",
        "::1",
        "--home-dir",
        flagHome,
        "--dev-url",
        "http://127.0.0.1:5173",
        "--no-browser",
        "--auth-token",
        "auth-secret",
      ]);

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "desktop");
      assert.equal(resolvedConfig?.port, 4010);
      assert.equal(resolvedConfig?.host, "::1");
      assert.equal(resolvedConfig?.baseDir, flagHome);
      assert.equal(resolvedConfig?.stateDir, path.join(flagHome, "dev"));
      assert.equal(resolvedConfig?.devUrl?.toString(), "http://127.0.0.1:5173/");
      assert.equal(resolvedConfig?.noBrowser, true);
      assert.equal(resolvedConfig?.authToken, "auth-secret");
      assert.equal(resolvedConfig?.publicUrl, undefined);
      assert.equal(resolvedConfig?.allowInsecureRemote, false);
      assert.equal(resolvedConfig?.autoBootstrapProjectFromCwd, false);
      assert.equal(resolvedConfig?.logProviderEvents, false);
      assert.equal(resolvedConfig?.logWebSocketEvents, false);
      assert.equal(resolvedConfig?.antigravityTerminalRecoveryMode, "enforce");
      assert.equal(resolvedConfig?.antigravityTerminalRecoveryGraceMs, 15_000);
      assert.equal(stop.mock.calls.length, 1);
    }),
  );

  it.effect("supports --token as an alias for --auth-token", () =>
    Effect.gen(function* () {
      yield* runCli(["--token", "token-secret"]);

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.authToken, "token-secret");
    }),
  );

  it.effect("passes the root --home-dir flag to MCP subcommands", () =>
    Effect.gen(function* () {
      const flagHome = makeTempHome("synara-main-mcp-flag-");

      const exit = yield* Effect.exit(runCli(["mcp", "serve", "--home-dir", flagHome]));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.include(Cause.pretty(exit.cause), path.join(flagHome, "mcp", "credentials"));
      }
      assert.equal(start.mock.calls.length, 0);
    }),
  );

  it.effect("creates fresh local state directories with private permissions", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;
      const homeDir = makeTempHome("synara-main-private-fresh-");

      yield* runCli(["--home-dir", homeDir]);

      const stateDir = path.join(homeDir, "userdata");
      for (const directoryPath of [
        stateDir,
        path.join(stateDir, "secrets"),
        path.join(stateDir, "attachments"),
        path.join(stateDir, "logs"),
        path.join(stateDir, "logs", "provider"),
        path.join(stateDir, "logs", "terminals"),
      ]) {
        assert.equal(permissionMode(directoryPath), 0o700);
      }
      assert.equal(permissionMode(path.join(stateDir, "logs", "server.log")), 0o600);
    }),
  );

  it.effect("repairs permissions for an upgraded local state directory", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return;
      const homeDir = makeTempHome("synara-main-private-upgrade-");
      const stateDir = path.join(homeDir, "userdata");
      const attachmentDir = path.join(stateDir, "attachments");
      const attachmentPath = path.join(attachmentDir, "existing.bin");
      fs.mkdirSync(attachmentDir, { recursive: true, mode: 0o755 });
      fs.writeFileSync(attachmentPath, "existing", { mode: 0o644 });
      fs.chmodSync(stateDir, 0o755);
      fs.chmodSync(attachmentDir, 0o755);

      yield* runCli(["--home-dir", homeDir]);

      assert.equal(permissionMode(stateDir), 0o700);
      assert.equal(permissionMode(attachmentDir), 0o700);
      assert.equal(permissionMode(attachmentPath), 0o600);
    }),
  );

  it.effect("uses env fallbacks when flags are not provided", () =>
    Effect.gen(function* () {
      const envHome = makeTempHome("synara-main-env-");

      yield* runCli([], {
        SYNARA_MODE: "desktop",
        SYNARA_PORT: "4999",
        SYNARA_HOST: "127.0.0.1",
        SYNARA_HOME: envHome,
        VITE_DEV_SERVER_URL: "http://localhost:5173",
        SYNARA_NO_BROWSER: "true",
        SYNARA_AUTH_TOKEN: "env-token",
        SYNARA_DESKTOP_SHUTDOWN_TOKEN: "shutdown-token",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "desktop");
      assert.equal(resolvedConfig?.port, 4999);
      assert.equal(resolvedConfig?.host, "127.0.0.1");
      assert.equal(resolvedConfig?.baseDir, envHome);
      assert.equal(resolvedConfig?.stateDir, path.join(envHome, "dev"));
      assert.equal(resolvedConfig?.devUrl?.toString(), "http://localhost:5173/");
      assert.equal(resolvedConfig?.noBrowser, true);
      assert.equal(resolvedConfig?.authToken, "env-token");
      assert.equal(resolvedConfig?.desktopShutdownToken, "shutdown-token");
      assert.equal(resolvedConfig?.autoBootstrapProjectFromCwd, false);
      assert.equal(resolvedConfig?.logProviderEvents, false);
      assert.equal(resolvedConfig?.logWebSocketEvents, false);
      assert.equal(findAvailablePort.mock.calls.length, 0);
    }),
  );

  it.effect("parses Antigravity terminal recovery mode and grace", () =>
    Effect.gen(function* () {
      yield* runCli([], {
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_MODE: "shadow",
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_GRACE_MS: "3210",
      });

      assert.equal(resolvedConfig?.antigravityTerminalRecoveryMode, "shadow");
      assert.equal(resolvedConfig?.antigravityTerminalRecoveryGraceMs, 3210);
    }),
  );

  it.effect("wires parsed Antigravity recovery config into the live adapter layer", () =>
    Effect.gen(function* () {
      yield* runCli([], {
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_MODE: "shadow",
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_GRACE_MS: "3210",
      });

      assert.deepInclude(antigravityAdapterConfigObservations, {
        mode: "shadow",
        graceMs: 3210,
      });

      yield* runCli([], {
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_MODE: "invalid",
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_GRACE_MS: "3000000000",
      });
      assert.deepInclude(antigravityAdapterConfigObservations, {
        mode: "enforce",
        graceMs: 15_000,
      });
    }),
  );

  it.effect(
    "resolves the Pi subagent foreground wait budget on the production ServerConfigLive path (issue 22 remediation)",
    () =>
      // The production resolution site reads the key directly from process.env
      // (Decision 0006 §5 contract; same site as ServerConfig.layerTest), so the
      // wiring test mutates process.env directly and always restores it.
      Effect.gen(function* () {
        const previousValue = process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS;
        const restore = Effect.sync(() => {
          if (previousValue === undefined) {
            delete process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS;
          } else {
            process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS = previousValue;
          }
        });
        yield* Effect.onExit(
          Effect.gen(function* () {
            // Valid in-range value is preserved verbatim (no clamping).
            process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS = "30000";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentForegroundWaitMs, 30_000);

            // Invalid classes fall back to the 10000 ms default: non-numeric,
            // under-range, and over-range are rejected (not clamped).
            process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS = "abc";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentForegroundWaitMs, 10_000);

            process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS = "99";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentForegroundWaitMs, 10_000);

            process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS = "60001";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentForegroundWaitMs, 10_000);

            // Unset also resolves to the default.
            delete process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS;
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentForegroundWaitMs, 10_000);
          }),
          () => restore,
        );
      }),
  );

  it.effect(
    "resolves Pi subagent progress/heartbeat/lease knobs on the production ServerConfigLive path (issue 23 / T23-AC7)",
    () =>
      // Same production resolution site as the foreground-wait knob: the env
      // is mutated directly and always restored.
      Effect.gen(function* () {
        const keys = [
          "SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ",
          "SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS",
          "SYNARA_PI_SUBAGENT_LEASE_DURATION_MS",
        ] as const;
        const previous = keys.map((key) => process.env[key]);
        const restore = Effect.sync(() => {
          for (const [index, key] of keys.entries()) {
            const value = previous[index]!;
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        });
        yield* Effect.onExit(
          Effect.gen(function* () {
            // Valid in-range values are preserved verbatim (no clamping).
            process.env.SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ = "5";
            process.env.SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS = "30000";
            process.env.SYNARA_PI_SUBAGENT_LEASE_DURATION_MS = "60000";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentProgressRateHz, 5);
            assert.equal(resolvedConfig?.piSubagentHeartbeatIntervalMs, 30_000);
            assert.equal(resolvedConfig?.piSubagentLeaseDurationMs, 60_000);

            // Fractional rates are valid for the hz knob.
            process.env.SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ = "0.5";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentProgressRateHz, 0.5);

            // Invalid classes fall back to defaults: non-numeric, under-range,
            // over-range, and fractional-integer-knob are rejected (not clamped).
            process.env.SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ = "11";
            process.env.SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS = "abc";
            process.env.SYNARA_PI_SUBAGENT_LEASE_DURATION_MS = "30.5";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentProgressRateHz, 2);
            assert.equal(resolvedConfig?.piSubagentHeartbeatIntervalMs, 10_000);
            assert.equal(resolvedConfig?.piSubagentLeaseDurationMs, 30_000);

            process.env.SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ = "0.01";
            process.env.SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS = "99";
            process.env.SYNARA_PI_SUBAGENT_LEASE_DURATION_MS = "999";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentProgressRateHz, 2);
            assert.equal(resolvedConfig?.piSubagentHeartbeatIntervalMs, 10_000);
            assert.equal(resolvedConfig?.piSubagentLeaseDurationMs, 30_000);

            process.env.SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS = "600001";
            process.env.SYNARA_PI_SUBAGENT_LEASE_DURATION_MS = "3600001";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentHeartbeatIntervalMs, 10_000);
            assert.equal(resolvedConfig?.piSubagentLeaseDurationMs, 30_000);

            // Unset also resolves to defaults.
            delete process.env.SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ;
            delete process.env.SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS;
            delete process.env.SYNARA_PI_SUBAGENT_LEASE_DURATION_MS;
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentProgressRateHz, 2);
            assert.equal(resolvedConfig?.piSubagentHeartbeatIntervalMs, 10_000);
            assert.equal(resolvedConfig?.piSubagentLeaseDurationMs, 30_000);
          }),
          () => restore,
        );
      }),
  );

  it.effect(
    "resolves the Pi subagent terminal-summary bound knob on the production ServerConfigLive path (issue 07 / T07-AC5)",
    () =>
      // Same production resolution site as the other Pi subagent knobs: the
      // env is mutated directly and always restored.
      Effect.gen(function* () {
        const key = "SYNARA_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS";
        const previousValue = process.env[key];
        const restore = Effect.sync(() => {
          if (previousValue === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = previousValue;
          }
        });
        yield* Effect.onExit(
          Effect.gen(function* () {
            // Valid in-range value is preserved verbatim (no clamping).
            process.env[key] = "4096";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentTerminalSummaryMaxChars, 4_096);

            // Invalid classes fall back to the 2000 default: non-numeric,
            // fractional, under-range, and over-range are rejected.
            process.env[key] = "abc";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentTerminalSummaryMaxChars, 2_000);

            process.env[key] = "2000.5";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentTerminalSummaryMaxChars, 2_000);

            process.env[key] = "63";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentTerminalSummaryMaxChars, 2_000);

            process.env[key] = "32769";
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentTerminalSummaryMaxChars, 2_000);

            // Unset also resolves to the default.
            delete process.env[key];
            yield* runCli([]);
            assert.equal(resolvedConfig?.piSubagentTerminalSummaryMaxChars, 2_000);
          }),
          () => restore,
        );
      }),
  );

  it.effect("uses safe Antigravity recovery defaults for invalid configuration", () =>
    Effect.gen(function* () {
      const messages: string[] = [];
      const logger = Logger.make(({ message }) => messages.push(String(message)));

      yield* runCli([], {
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_MODE: "invalid",
        SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_GRACE_MS: "3000000000",
      }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));

      assert.equal(resolvedConfig?.antigravityTerminalRecoveryMode, "enforce");
      assert.equal(resolvedConfig?.antigravityTerminalRecoveryGraceMs, 15_000);
      assert.equal(
        messages.filter((message) =>
          message.includes("Invalid Antigravity terminal recovery configuration"),
        ).length,
        1,
      );
    }),
  );

  it.effect("rejects non-positive and fractional Antigravity recovery grace values", () =>
    Effect.gen(function* () {
      for (const value of ["0", "-1", "1.5"]) {
        resolvedConfig = null;
        yield* runCli([], {
          SYNARA_ANTIGRAVITY_TERMINAL_RECOVERY_GRACE_MS: value,
        });
        assert.equal(getResolvedConfig()?.antigravityTerminalRecoveryGraceMs, 15_000);
      }
    }),
  );

  it.effect("consumes desktop shutdown authority before generic child launches", () =>
    Effect.gen(function* () {
      const canonicalKey = "SYNARA_DESKTOP_SHUTDOWN_TOKEN";
      const mixedCaseKey = "sYnArA_dEsKtOp_ShUtDoWn_ToKeN";
      const liveToken = "live-process-shutdown-token";
      const injectedToken = "injected-shutdown-token";
      const posixCaseSensitiveSentinel = "posix-case-sensitive-sentinel";
      const originalEntries = Object.entries(process.env).filter(
        ([key]) => key.toUpperCase() === canonicalKey,
      );
      const allCaseVariants = () =>
        Object.keys(process.env).filter((key) => key.toUpperCase() === canonicalKey);
      const matchingLiveKeys = () =>
        Object.keys(process.env).filter((key) =>
          process.platform === "win32" ? key.toUpperCase() === canonicalKey : key === canonicalKey,
        );
      const clearAllCaseVariants = () => {
        for (const key of allCaseVariants()) {
          delete process.env[key];
        }
      };

      clearAllCaseVariants();
      try {
        process.env[process.platform === "win32" ? mixedCaseKey : canonicalKey] = liveToken;
        if (process.platform !== "win32") {
          process.env[mixedCaseKey] = posixCaseSensitiveSentinel;
        }

        yield* runCli([]);

        assert.equal(resolvedConfig?.desktopShutdownToken, liveToken);
        assert.deepEqual(matchingLiveKeys(), []);
        if (process.platform !== "win32") {
          assert.equal(process.env[mixedCaseKey], posixCaseSensitiveSentinel);
        }

        const descendant = spawnSync(
          process.execPath,
          ["-e", `process.stdout.write(process.env.${canonicalKey} ?? "missing")`],
          { encoding: "utf8" },
        );
        assert.equal(descendant.status, 0, descendant.stderr);
        assert.equal(descendant.stdout, "missing");

        resolvedConfig = null;
        yield* runCli([], { SYNARA_DESKTOP_SHUTDOWN_TOKEN: injectedToken });
        assert.equal(getResolvedConfig()?.desktopShutdownToken, injectedToken);
        assert.deepEqual(matchingLiveKeys(), []);
      } finally {
        clearAllCaseVariants();
        for (const [key, value] of originalEntries) {
          if (value !== undefined) {
            process.env[key] = value;
          }
        }
      }
    }),
  );

  it.effect("waits for the stop signal before releasing the scoped server runtime", () =>
    Effect.gen(function* () {
      const shutdownController = yield* makeServerShutdownController();
      serverStopSignal = shutdownController.stopSignal;
      let resolveStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      start.mockImplementation(() => {
        resolveStarted?.();
        return undefined;
      });

      const program = yield* runCli([]).pipe(Effect.forkChild);
      yield* Effect.promise(() => started);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(stop.mock.calls.length, 0);

      yield* shutdownController.requestStop;
      yield* Fiber.join(program);
      assert.equal(stop.mock.calls.length, 1);
    }),
  );

  it.effect("keeps SQLite alive through CLI server release and closes it afterward", () =>
    Effect.gen(function* () {
      let releaseRows: ReadonlyArray<{ readonly live: number }> = [];
      releaseServerRuntime = (sql) =>
        sql<{ readonly live: number }>`SELECT 1 AS live`.pipe(
          Effect.tap((rows) =>
            Effect.sync(() => {
              releaseRows = rows;
            }),
          ),
          Effect.asVoid,
          Effect.orDie,
        );

      yield* runCli([]);

      assert.deepEqual(releaseRows, [{ live: 1 }]);
      const releasedClient = retainedSqlClient;
      if (!releasedClient) {
        return yield* Effect.die(new Error("Expected the CLI to acquire a SQLite client"));
      }
      const postReleaseExit = yield* Effect.exit(releasedClient`SELECT 2 AS closed_probe`);
      assert.isTrue(Exit.isFailure(postReleaseExit));
      if (Exit.isFailure(postReleaseExit)) {
        assert.match(Cause.pretty(postReleaseExit.cause), /database is not open/i);
      }
    }),
  );

  it.effect("surfaces CLI server release failures", () =>
    Effect.gen(function* () {
      releaseServerRuntime = () => Effect.die(new Error("synthetic server release failure"));

      const exit = yield* Effect.exit(runCli([]));

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.match(Cause.pretty(exit.cause), /synthetic server release failure/);
      }
      assert.equal(stop.mock.calls.length, 1);
    }),
  );

  it.effect("omits both server authority secrets from startup log data", () =>
    Effect.gen(function* () {
      yield* runCli([], {
        SYNARA_AUTH_TOKEN: "browser-secret",
        SYNARA_DESKTOP_SHUTDOWN_TOKEN: "shutdown-secret",
      });
      const config = resolvedConfig;
      if (!config) throw new Error("Expected resolved server config");

      const logData = makeServerStartupLogData(config);
      assert.equal(Object.hasOwn(logData, "authToken"), false);
      assert.equal(Object.hasOwn(logData, "desktopShutdownToken"), false);
      assert.equal(logData.authEnabled, true);
      assert.notInclude(JSON.stringify(logData), "browser-secret");
      assert.notInclude(JSON.stringify(logData), "shutdown-secret");
    }),
  );

  it.effect("prefers --mode over SYNARA_MODE", () =>
    Effect.gen(function* () {
      findAvailablePort.mockImplementation((_preferred: number) => Effect.succeed(4666));
      yield* runCli(["--mode", "web"], {
        SYNARA_MODE: "desktop",
        SYNARA_NO_BROWSER: "true",
      });

      assert.deepStrictEqual(findAvailablePort.mock.calls, [[3773]]);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "web");
      assert.equal(resolvedConfig?.port, 4666);
      assert.equal(resolvedConfig?.host, "127.0.0.1");
    }),
  );

  it.effect("prefers --no-browser over SYNARA_NO_BROWSER", () =>
    Effect.gen(function* () {
      yield* runCli(["--no-browser"], {
        SYNARA_NO_BROWSER: "false",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.noBrowser, true);
    }),
  );

  it.effect("lets explicit negative boolean flags override true environment values", () =>
    Effect.gen(function* () {
      yield* runCli(
        [
          "--browser",
          "--no-auto-bootstrap-project-from-cwd",
          "--no-log-provider-events",
          "--no-log-websocket-events",
        ],
        {
          SYNARA_MODE: "desktop",
          SYNARA_NO_BROWSER: "true",
          SYNARA_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true",
          SYNARA_LOG_PROVIDER_EVENTS: "true",
          SYNARA_LOG_WS_EVENTS: "true",
        },
      );

      assert.equal(resolvedConfig?.noBrowser, false);
      assert.equal(resolvedConfig?.autoBootstrapProjectFromCwd, false);
      assert.equal(resolvedConfig?.logProviderEvents, false);
      assert.equal(resolvedConfig?.logWebSocketEvents, false);
    }),
  );

  it.effect("uses loopback and dynamic port discovery in web mode by default", () =>
    Effect.gen(function* () {
      findAvailablePort.mockImplementation((_preferred: number) => Effect.succeed(5444));
      yield* runCli([]);

      assert.deepStrictEqual(findAvailablePort.mock.calls, [[3773]]);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.port, 5444);
      assert.equal(resolvedConfig?.mode, "web");
      assert.equal(resolvedConfig?.host, "127.0.0.1");
    }),
  );

  it.effect("uses fixed localhost defaults in desktop mode", () =>
    Effect.gen(function* () {
      yield* runCli([], {
        SYNARA_MODE: "desktop",
        SYNARA_NO_BROWSER: "true",
      });

      assert.equal(findAvailablePort.mock.calls.length, 0);
      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.port, 3773);
      assert.equal(resolvedConfig?.host, "127.0.0.1");
      assert.equal(resolvedConfig?.mode, "desktop");
    }),
  );

  it.effect("allows authenticated non-loopback exposure only with explicit insecure opt-in", () =>
    Effect.gen(function* () {
      yield* runCli(
        ["--host", "0.0.0.0", "--auth-token", "remote-secret", "--allow-insecure-remote"],
        {
          SYNARA_MODE: "desktop",
          SYNARA_NO_BROWSER: "true",
        },
      );

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.mode, "desktop");
      assert.equal(resolvedConfig?.host, "0.0.0.0");
      assert.equal(resolvedConfig?.allowInsecureRemote, true);
    }),
  );

  it.effect("honors insecure remote opt-in from the environment when the CLI flag is absent", () =>
    Effect.gen(function* () {
      yield* runCli(["--host", "0.0.0.0", "--auth-token", "remote-secret"], {
        SYNARA_ALLOW_INSECURE_REMOTE: "true",
        SYNARA_NO_BROWSER: "true",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.allowInsecureRemote, true);
    }),
  );

  it.effect("lets an explicit insecure-remote negative override an enabled environment", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runCli(
          ["--host", "0.0.0.0", "--auth-token", "remote-secret", "--no-allow-insecure-remote"],
          {
            SYNARA_ALLOW_INSECURE_REMOTE: "true",
            SYNARA_NO_BROWSER: "true",
          },
        ),
      );

      assert.equal(start.mock.calls.length, 0);
      assert.match(String(error), /Refusing plaintext remote access/);
    }),
  );

  it.effect("refuses authenticated plaintext remote exposure without an explicit opt-in", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runCli(["--host", "0.0.0.0", "--auth-token", "remote-secret"]),
      );

      assert.equal(start.mock.calls.length, 0);
      assert.match(String(error), /Refusing plaintext remote access/);
    }),
  );

  it.effect("uses the HTTPS public origin for remote startup pairing", () =>
    Effect.gen(function* () {
      yield* runCli(
        [
          "--host",
          "0.0.0.0",
          "--auth-token",
          "remote-secret",
          "--public-url",
          "https://synara.example.test",
        ],
        { SYNARA_NO_BROWSER: "false" },
      );

      assert.equal(resolvedConfig?.publicUrl?.origin, "https://synara.example.test");
      assert.equal(openBrowser.mock.calls.length, 1);
      assert.match(
        openBrowser.mock.calls[0]?.[0] ?? "",
        /^https:\/\/synara\.example\.test\/pair#token=/,
      );
    }),
  );

  it.effect("supports the HTTPS public origin through environment configuration", () =>
    Effect.gen(function* () {
      yield* runCli([], {
        SYNARA_HOST: "192.168.1.50",
        SYNARA_AUTH_TOKEN: "remote-secret",
        SYNARA_PUBLIC_URL: "https://synara.example.test",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.publicUrl?.origin, "https://synara.example.test");
      assert.equal(resolvedConfig?.allowInsecureRemote, false);
    }),
  );

  it.effect("issues pairing through an HTTPS public origin that proxies to loopback", () =>
    Effect.gen(function* () {
      yield* runCli(
        [
          "--host",
          "127.0.0.1",
          "--auth-token",
          "proxy-secret",
          "--public-url",
          "https://proxy.example.test",
        ],
        { SYNARA_NO_BROWSER: "false" },
      );

      assert.equal(openBrowser.mock.calls.length, 1);
      assert.match(
        openBrowser.mock.calls[0]?.[0] ?? "",
        /^https:\/\/proxy\.example\.test\/pair#token=/,
      );
    }),
  );

  it.effect("refuses a dev URL exposed through an HTTPS proxy on loopback", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runCli([
          "--host",
          "127.0.0.1",
          "--auth-token",
          "proxy-secret",
          "--public-url",
          "https://proxy.example.test",
          "--dev-url",
          "http://localhost:5173",
        ]),
      );

      assert.equal(start.mock.calls.length, 0);
      assert.match(String(error), /cannot be combined with VITE_DEV_SERVER_URL/);
    }),
  );

  it.effect("rejects non-root or non-HTTPS public URLs", () =>
    Effect.gen(function* () {
      for (const publicUrl of ["http://synara.example.test", "https://synara.example.test/app"]) {
        const error = yield* Effect.flip(
          runCli(["--host", "0.0.0.0", "--auth-token", "remote-secret", "--public-url", publicUrl]),
        );
        assert.match(String(error), /must be an HTTPS root origin/);
      }
      assert.equal(start.mock.calls.length, 0);
    }),
  );

  it.effect("refuses non-loopback exposure without authentication", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runCli(["--host", "0.0.0.0"], {
          SYNARA_MODE: "web",
          SYNARA_NO_BROWSER: "true",
        }),
      );

      assert.equal(start.mock.calls.length, 0);
      assert.equal(resolvedConfig, null);
      assert.match(String(error), /Refusing to bind Synara to non-loopback host 0\.0\.0\.0/);
    }),
  );

  it.effect("refuses authenticated non-loopback exposure with a dev URL", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runCli(
          [
            "--host",
            "0.0.0.0",
            "--auth-token",
            "remote-secret",
            "--dev-url",
            "http://localhost:5173",
          ],
          {
            SYNARA_MODE: "web",
            SYNARA_NO_BROWSER: "true",
          },
        ),
      );

      assert.equal(start.mock.calls.length, 0);
      assert.equal(resolvedConfig, null);
      assert.match(
        String(error),
        /Remote server binds cannot be combined with VITE_DEV_SERVER_URL/,
      );
    }),
  );

  it.effect("supports CLI and env for bootstrap/provider-log/websocket toggles", () =>
    Effect.gen(function* () {
      yield* runCli(["--auto-bootstrap-project-from-cwd"], {
        SYNARA_MODE: "desktop",
        SYNARA_LOG_PROVIDER_EVENTS: "true",
        SYNARA_LOG_WS_EVENTS: "false",
        SYNARA_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
        SYNARA_NO_BROWSER: "true",
      });

      assert.equal(start.mock.calls.length, 1);
      assert.equal(resolvedConfig?.autoBootstrapProjectFromCwd, true);
      assert.equal(resolvedConfig?.logProviderEvents, true);
      assert.equal(resolvedConfig?.logWebSocketEvents, false);
    }),
  );

  it.effect("rejects invalid boolean environment values instead of treating them as absent", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runCli([], {
          SYNARA_LOG_PROVIDER_EVENTS: "sometimes",
        }),
      );

      assert.equal(start.mock.calls.length, 0);
      assert.match(String(error), /Failed to read environment configuration/);
    }),
  );

  it.effect("does not start server for invalid --mode values", () =>
    Effect.gen(function* () {
      yield* runCli(["--mode", "invalid"]);

      assert.equal(start.mock.calls.length, 0);
      assert.equal(stop.mock.calls.length, 0);
    }),
  );

  it.effect("does not start server for invalid --dev-url values", () =>
    Effect.gen(function* () {
      yield* runCli(["--dev-url", "not-a-url"]).pipe(Effect.catch(() => Effect.void));

      assert.equal(start.mock.calls.length, 0);
      assert.equal(stop.mock.calls.length, 0);
    }),
  );

  it.effect("does not start server for out-of-range --port values", () =>
    Effect.gen(function* () {
      yield* runCli(["--port", "70000"]);

      // effect/unstable/cli renders help/errors for parse failures and returns success.
      assert.equal(start.mock.calls.length, 0);
      assert.equal(stop.mock.calls.length, 0);
    }),
  );
});
