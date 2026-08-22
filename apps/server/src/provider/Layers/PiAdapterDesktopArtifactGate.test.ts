import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ServerConfig, type ServerConfigShape } from "../../config";
import type { ProviderAdapterError } from "../Errors";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter";
import { makePiAdapterLive } from "./PiAdapter";

/**
 * This suite isolates the adapter wiring from the production gate matrix:
 * `piSubagentDesktopArtifactGate.test.ts` verifies the real artifact verifier,
 * while this suite proves every Pi SDK entry point consults that gate before
 * importing the SDK or resolving its global agent directory.
 */
const gateHarness = vi.hoisted(() => ({
  calls: [] as Array<{ readonly mode: unknown; readonly env: unknown }>,
  result: {
    kind: "unavailable",
    reason: "locator_missing",
    detail: "managed pi artifact locator is absent or blank",
  },
}));

const piSdkHarness = vi.hoisted(() => ({
  imports: 0,
  getAgentDirCalls: 0,
  serviceCreationCalls: 0,
  sessionManagerCreateCalls: 0,
  sessionManagerOpenCalls: 0,
}));

vi.mock("../piSubagentDesktopArtifactGate.ts", () => ({
  evaluatePiSubagentDesktopArtifactGate: async (mode: unknown, input: { readonly env: unknown }) => {
    gateHarness.calls.push({ mode, env: input.env });
    return gateHarness.result;
  },
}));

vi.mock("@earendil-works/pi-coding-agent", () => {
  piSdkHarness.imports += 1;
  return {
    getAgentDir: () => {
      piSdkHarness.getAgentDirCalls += 1;
      return "/mock-pi-agent-dir";
    },
    createAgentSessionServices: async () => {
      piSdkHarness.serviceCreationCalls += 1;
      throw new Error("mock Pi SDK reached");
    },
    SessionManager: {
      create: () => {
        piSdkHarness.sessionManagerCreateCalls += 1;
        throw new Error("mock Pi SDK reached");
      },
      open: () => {
        piSdkHarness.sessionManagerOpenCalls += 1;
        throw new Error("mock Pi SDK reached");
      },
    },
  };
});

const resetHarness = () => {
  gateHarness.calls.splice(0);
  gateHarness.result = {
    kind: "unavailable",
    reason: "locator_missing",
    detail: "managed pi artifact locator is absent or blank",
  };
  piSdkHarness.imports = 0;
  piSdkHarness.getAgentDirCalls = 0;
  piSdkHarness.serviceCreationCalls = 0;
  piSdkHarness.sessionManagerCreateCalls = 0;
  piSdkHarness.sessionManagerOpenCalls = 0;
};

const makeAdapterLayer = (
  mode: ServerConfigShape["mode"],
  env: NodeJS.ProcessEnv,
) =>
  makePiAdapterLive({
    piSubagentDesktopArtifactGateEnv: env,
  }).pipe(
    Layer.provide(
      Layer.effect(
        ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          return { ...config, mode } satisfies ServerConfigShape;
        }),
      ).pipe(
        Layer.provide(
          ServerConfig.layerTest(process.cwd(), {
            prefix: "synara-pi-adapter-artifact-gate-test-",
          }),
        ),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

interface EntryPath {
  readonly label: string;
  readonly method: string;
  readonly invoke: (adapter: PiAdapterShape) => Effect.Effect<unknown, ProviderAdapterError>;
}

const entryPaths: readonly EntryPath[] = [
  {
    label: "startSession",
    method: "session/start",
    invoke: (adapter) =>
      adapter.startSession({
        provider: "pi",
        threadId: "thread-pi-artifact-gate" as never,
        runtimeMode: "full-access",
      } as never),
  },
  {
    label: "listModels",
    method: "model/list",
    invoke: (adapter) => adapter.listModels!({ provider: "pi" } as never),
  },
  {
    label: "inactive listSkills",
    method: "skill/list",
    invoke: (adapter) => adapter.listSkills!({ provider: "pi" } as never),
  },
  {
    label: "inactive listCommands",
    method: "command/list",
    invoke: (adapter) => adapter.listCommands!({ provider: "pi" } as never),
  },
];

const runPath = (input: {
  readonly mode: ServerConfigShape["mode"];
  readonly env: NodeJS.ProcessEnv;
  readonly entry: EntryPath;
}) =>
  Effect.gen(function* () {
    const adapter = yield* PiAdapter;
    return yield* input.entry.invoke(adapter).pipe(Effect.flip);
  }).pipe(Effect.provide(makeAdapterLayer(input.mode, input.env)), Effect.scoped, Effect.runPromise);

describe("PiAdapter desktop managed-artifact early gate (Ticket 01)", () => {
  it.for(entryPaths)(
    "rejects desktop %s before Pi SDK import, global agent-dir discovery, or service creation",
    async (entry) => {
      resetHarness();

      const failure = await runPath({
        mode: "desktop",
        env: {
          PI_CODING_AGENT_DIR: "/untrusted/inherited-pi-agent-dir",
        },
        entry,
      });

      expect(failure).toMatchObject({
        _tag: "ProviderAdapterRequestError",
        provider: "pi",
        method: entry.method,
        detail:
          "Managed Pi subagents are unavailable (locator_missing): " +
          "managed pi artifact locator is absent or blank",
      });
      expect(gateHarness.calls).toEqual([
        {
          mode: "desktop",
          env: {
            PI_CODING_AGENT_DIR: "/untrusted/inherited-pi-agent-dir",
          },
        },
      ]);
      expect(piSdkHarness).toEqual({
        imports: 0,
        getAgentDirCalls: 0,
        serviceCreationCalls: 0,
        sessionManagerCreateCalls: 0,
        sessionManagerOpenCalls: 0,
      });
    },
  );

  it("keeps non-desktop discovery on the existing Pi SDK path", async () => {
    resetHarness();
    gateHarness.result = { kind: "pass" } as never;

    const failure = await runPath({
      mode: "web",
      env: {
        PI_CODING_AGENT_DIR: "/untrusted/inherited-pi-agent-dir",
      },
      entry: entryPaths[2]!,
    });

    expect(failure).toMatchObject({
      _tag: "ProviderAdapterRequestError",
      provider: "pi",
      method: "skill/list",
      detail: "mock Pi SDK reached",
    });
    expect(gateHarness.calls).toEqual([
      {
        mode: "web",
        env: {
          PI_CODING_AGENT_DIR: "/untrusted/inherited-pi-agent-dir",
        },
      },
    ]);
    expect(piSdkHarness).toMatchObject({
      imports: 1,
      getAgentDirCalls: 1,
      serviceCreationCalls: 1,
      sessionManagerCreateCalls: 0,
      sessionManagerOpenCalls: 0,
    });
  });
});
