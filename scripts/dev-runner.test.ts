import * as NodeServices from "@effect/platform-node/NodeServices";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { PiSubagentDevArtifactCacheError } from "./lib/piSubagentDevArtifactCache.ts";
import {
  createDevRunnerEnv,
  findFirstAvailableOffset,
  formatDevArtifactPreparationError,
  modeLaunchesServer,
  readDevRunnerBooleanEnvironment,
  resolveDevRunnerBooleanOverrides,
  resolveModePortOffsets,
  resolveOffset,
} from "./dev-runner.ts";

const SYNARA_PI_SUBAGENT_ARTIFACT_DIR = "SYNARA_PI_SUBAGENT_ARTIFACT_DIR";

it.layer(NodeServices.layer)("dev-runner", (it) => {
  it("allows every generated runtime setting through Turbo", () => {
    const turboConfig = JSON.parse(
      readFileSync(new URL("../turbo.json", import.meta.url), "utf8"),
    ) as { globalEnv?: ReadonlyArray<string> };
    const globalEnv = new Set(turboConfig.globalEnv ?? []);

    for (const name of [
      "SYNARA_MODE",
      "SYNARA_PORT",
      "SYNARA_HOME",
      "SYNARA_NO_BROWSER",
      "SYNARA_AUTH_TOKEN",
      "SYNARA_PUBLIC_URL",
      "SYNARA_ALLOW_INSECURE_REMOTE",
      "SYNARA_HOST",
      "SYNARA_LOG_WS_EVENTS",
      "SYNARA_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
      "VITE_WS_URL",
      "VITE_DEV_SERVER_URL",
      SYNARA_PI_SUBAGENT_ARTIFACT_DIR,
    ]) {
      assert.ok(globalEnv.has(name), `${name} must be declared in turbo.json globalEnv`);
    }
  });

  describe("resolveOffset", () => {
    it.effect("uses explicit SYNARA_PORT_OFFSET when provided", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: 12, devInstance: undefined });
        assert.deepStrictEqual(result, {
          offset: 12,
          source: "SYNARA_PORT_OFFSET=12",
        });
      }),
    );

    it.effect("hashes non-numeric instance values", () =>
      Effect.sync(() => {
        const result = resolveOffset({ portOffset: undefined, devInstance: "feature-branch" });
        assert.ok(result.offset >= 1);
        assert.ok(result.offset <= 3000);
      }),
    );

    it.effect("throws for negative port offset", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.try({
            try: () => resolveOffset({ portOffset: -1, devInstance: undefined }),
            catch: (cause) => String(cause),
          }),
        );

        assert.ok(error.includes("Invalid SYNARA_PORT_OFFSET"));
      }),
    );
  });

  describe("boolean precedence", () => {
    const absent = { positive: undefined, negative: undefined };

    it("uses environment values only when the CLI flag is absent", () => {
      assert.deepStrictEqual(
        resolveDevRunnerBooleanOverrides(
          {
            noBrowser: absent,
            autoBootstrapProjectFromCwd: absent,
            logWebSocketEvents: absent,
          },
          {
            noBrowser: true,
            autoBootstrapProjectFromCwd: false,
            logWebSocketEvents: true,
          },
        ),
        {
          noBrowser: true,
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: true,
        },
      );
    });

    it("keeps explicit false values instead of treating them as absent", () => {
      assert.deepStrictEqual(
        resolveDevRunnerBooleanOverrides(
          {
            noBrowser: { positive: undefined, negative: true },
            autoBootstrapProjectFromCwd: { positive: false, negative: undefined },
            logWebSocketEvents: { positive: undefined, negative: true },
          },
          {
            noBrowser: true,
            autoBootstrapProjectFromCwd: true,
            logWebSocketEvents: true,
          },
        ),
        {
          noBrowser: false,
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: false,
        },
      );
    });

    it.effect("rejects invalid boolean environment values", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          readDevRunnerBooleanEnvironment({ SYNARA_LOG_WS_EVENTS: "sometimes" }),
        );

        assert.match(String(error), /Failed to read boolean development-runner configuration/);
      }),
    );
  });

  describe("createDevRunnerEnv", () => {
    it.effect("marks an inherited terminal PATH as already hydrated", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: { PATH: "/opt/homebrew/bin:/usr/bin" },
          serverOffset: 0,
          webOffset: 0,
          synaraHome: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.SYNARA_PATH_HYDRATED, "1");
        assert.match(env.PATH ?? "", /\/opt\/homebrew\/bin/);
      }),
    );

    it.effect("defaults SYNARA_HOME to ~/.synara when not provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          synaraHome: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.SYNARA_HOME, resolve(homedir(), ".synara"));
        assert.equal(env.SYNARA_HOST, "127.0.0.1");
        assert.equal(env.VITE_WS_URL, "ws://127.0.0.1:3773");
      }),
    );

    it("modeLaunchesServer is true exactly for the server-launching modes", () => {
      assert.equal(modeLaunchesServer("dev"), true);
      assert.equal(modeLaunchesServer("dev:server"), true);
      assert.equal(modeLaunchesServer("dev:web"), false);
      assert.equal(modeLaunchesServer("dev:desktop"), false);
    });

    it.effect("normalizes bracketed IPv6 hosts for listen and client URL syntax", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          synaraHome: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: "[::1]",
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.SYNARA_HOST, "::1");
        assert.equal(env.VITE_WS_URL, "ws://[::1]:3773");
      }),
    );

    it.effect("supports explicit typed overrides", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev:server",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          synaraHome: "/tmp/custom-synara",
          authToken: "secret",
          noBrowser: true,
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: true,
          host: "0.0.0.0",
          port: 4222,
          devUrl: new URL("http://localhost:7331"),
        });

        assert.equal(env.SYNARA_HOME, resolve("/tmp/custom-synara"));
        assert.equal(env.SYNARA_PORT, "4222");
        assert.equal(env.SYNARA_NO_BROWSER, "1");
        assert.equal(env.SYNARA_AUTO_BOOTSTRAP_PROJECT_FROM_CWD, "0");
        assert.equal(env.SYNARA_LOG_WS_EVENTS, "1");
        assert.equal(env.SYNARA_HOST, "0.0.0.0");
        assert.equal(env.VITE_WS_URL, "ws://127.0.0.1:4222");
        assert.equal(env.VITE_DEV_SERVER_URL, "http://localhost:7331/");
      }),
    );

    it.effect("does not force websocket logging on in dev mode when unset", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {
            SYNARA_LOG_WS_EVENTS: "keep-me-out",
          },
          serverOffset: 0,
          webOffset: 0,
          synaraHome: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.SYNARA_MODE, "web");
        assert.equal(env.SYNARA_LOG_WS_EVENTS, undefined);
      }),
    );

    it.effect("forwards explicit websocket logging false without coercing it away", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          synaraHome: undefined,
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: false,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.SYNARA_LOG_WS_EVENTS, "0");
      }),
    );

    it.effect("uses custom synaraHome when provided", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          mode: "dev",
          baseEnv: {},
          serverOffset: 0,
          webOffset: 0,
          synaraHome: "/tmp/my-synara",
          authToken: undefined,
          noBrowser: undefined,
          autoBootstrapProjectFromCwd: undefined,
          logWebSocketEvents: undefined,
          host: undefined,
          port: undefined,
          devUrl: undefined,
        });

        assert.equal(env.SYNARA_HOME, resolve("/tmp/my-synara"));
        assert.equal(env.SYNARA_HOME, resolve("/tmp/my-synara"));
        assert.equal(env.SYNARA_HOME, resolve("/tmp/my-synara"));
      }),
    );
  });

  describe("managed pi artifact error mapping", () => {
    it("exposes only the bounded cache message", () => {
      const bounded = new PiSubagentDevArtifactCacheError(
        "cache_root_unavailable",
        "Could not create the managed pi-subagents dev artifact cache root.",
        new Error("raw cause at /private/secret/path"),
      );

      assert.equal(formatDevArtifactPreparationError(bounded), bounded.message);
      assert.ok(!/private|raw cause/.test(formatDevArtifactPreparationError(bounded)));
    });

    it("uses a stable generic message for unexpected preparation failures", () => {
      assert.equal(
        formatDevArtifactPreparationError(new Error("unexpected raw path /private/secret")),
        "Failed to prepare the managed pi-subagents dev artifact.",
      );
      assert.equal(
        formatDevArtifactPreparationError("unexpected raw cause"),
        "Failed to prepare the managed pi-subagents dev artifact.",
      );
    });
  });

  describe("managed pi artifact locator policy", () => {
    /** Base env shape shared by every locator-policy test. */
    const baseLocatorEnvInput = {
      serverOffset: 0,
      webOffset: 0,
      synaraHome: "/tmp/my-synara" as const,
      authToken: undefined,
      noBrowser: undefined,
      autoBootstrapProjectFromCwd: undefined,
      logWebSocketEvents: undefined,
      host: undefined,
      port: undefined,
      devUrl: undefined,
    };

    it.effect("forwards the prepared locator exactly for server-launching modes", () =>
      Effect.gen(function* () {
        for (const mode of ["dev", "dev:server"] as const) {
          const env = yield* createDevRunnerEnv({
            ...baseLocatorEnvInput,
            mode,
            baseEnv: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR]: "/inherited/foreign/locator" },
            piSubagentArtifactDir: "/synara-home/dev-pi-subagent-artifacts/aa6fa4a8",
          });

          assert.equal(
            env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR],
            "/synara-home/dev-pi-subagent-artifacts/aa6fa4a8",
          );
        }
      }),
    );

    it.effect("scrubs any inherited locator for dev:web and dev:desktop", () =>
      Effect.gen(function* () {
        for (const mode of ["dev:web", "dev:desktop"] as const) {
          const env = yield* createDevRunnerEnv({
            ...baseLocatorEnvInput,
            mode,
            baseEnv: {
              [SYNARA_PI_SUBAGENT_ARTIFACT_DIR]: "/inherited/unverified/locator",
              PI_CODING_AGENT_DIR: "/untrusted/inherited-pi-agent-dir",
            },
          });

          assert.equal(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR], undefined);
        }
      }),
    );

    it.effect("scrubs an inherited locator even for server-launching modes when nothing was prepared", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          ...baseLocatorEnvInput,
          mode: "dev",
          baseEnv: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR]: "/inherited/unverified/locator" },
        });

        // Undefined preparation means "scrub any inherited value" — never
        // "keep whatever the terminal had".
        assert.equal(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR], undefined);
      }),
    );

    it.effect("scrubs a whitespace-only inherited locator for non-server-launching modes", () =>
      Effect.gen(function* () {
        const env = yield* createDevRunnerEnv({
          ...baseLocatorEnvInput,
          mode: "dev:web",
          baseEnv: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR]: "   " },
        });

        assert.equal(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR], undefined);
      }),
    );
  });

  describe("findFirstAvailableOffset", () => {
    it.effect("returns the starting offset when required ports are available", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 0);
      }),
    );

    it.effect("advances until all required ports are available", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733, 3774, 5734]);
        const offset = yield* findFirstAvailableOffset({
          startOffset: 0,
          requireServerPort: true,
          requireWebPort: true,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.equal(offset, 2);
      }),
    );

    it.effect("allows offsets where only non-required ports exceed max", () =>
      Effect.gen(function* () {
        const offset = yield* findFirstAvailableOffset({
          startOffset: 59_803,
          requireServerPort: true,
          requireWebPort: false,
          checkPortAvailability: () => Effect.succeed(true),
        });

        assert.equal(offset, 59_803);
      }),
    );
  });

  describe("resolveModePortOffsets", () => {
    it.effect("uses a shared fallback offset for dev mode", () =>
      Effect.gen(function* () {
        const taken = new Set([3773, 5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );

    it.effect("keeps server offset stable for dev:web and only shifts web offset", () =>
      Effect.gen(function* () {
        const taken = new Set([5733]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:web",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 1 });
      }),
    );

    it.effect("shifts only server offset for dev:server", () =>
      Effect.gen(function* () {
        const taken = new Set([3773]);
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: false,
          checkPortAvailability: (port) => Effect.succeed(!taken.has(port)),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 1, webOffset: 1 });
      }),
    );

    it.effect("respects explicit dev-url override for dev:web", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:web",
          startOffset: 0,
          hasExplicitServerPort: false,
          hasExplicitDevUrl: true,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 0 });
      }),
    );

    it.effect("respects explicit server port override for dev:server", () =>
      Effect.gen(function* () {
        const offsets = yield* resolveModePortOffsets({
          mode: "dev:server",
          startOffset: 0,
          hasExplicitServerPort: true,
          hasExplicitDevUrl: false,
          checkPortAvailability: () => Effect.succeed(false),
        });

        assert.deepStrictEqual(offsets, { serverOffset: 0, webOffset: 0 });
      }),
    );
  });
});
