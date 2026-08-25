import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
} from "@synara/contracts";

import { ServerConfig, type ServerConfigShape } from "../../config";
import type { ProviderAdapterError } from "../Errors";
import { PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME } from "../piSubagentArtifactVerifier.ts";
import { SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV } from "../piSubagentDesktopArtifactGate.ts";
import { PiAdapter, type PiAdapterShape } from "../Services/PiAdapter";
import { makePiAdapterLive } from "./PiAdapter";

/**
 * This suite isolates the adapter wiring from the production gate matrix:
 * `piSubagentDesktopArtifactGate.test.ts` verifies the real artifact verifier,
 * while this suite proves every Pi SDK entry point consults that gate before
 * importing the SDK or resolving its global agent directory.
 *
 * The Ticket 01b AC6 block below additionally routes the adapter through the
 * PRODUCTION gate + PRODUCTION verifier (never a fabricated unavailable
 * reason) against on-disk expanded-closure fixtures that carry real
 * `agent/extensions/shared` and `node_modules` regular files, mirroring the
 * release stager's expanded layout (Decision 0006 Binding decision 2).
 */
const gateHarness = vi.hoisted(() => ({
  calls: [] as Array<{ readonly mode: unknown; readonly env: unknown }>,
  /** "fabricated" (Ticket 01 matrix) or "real" (Ticket 01b AC6). */
  mode: "fabricated" as "fabricated" | "real",
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
  serviceOptions: [] as Array<Record<string, unknown>>,
  modelRuntimeOptions: [] as Array<Record<string, unknown>>,
  sessionManagerCreateCalls: 0,
  sessionManagerOpenCalls: 0,
}));

vi.mock("../piSubagentDesktopArtifactGate.ts", async (importOriginal) => {
  // Ticket 01b AC6: keep the deterministic fabricated-result surface for the
  // Ticket 01 ordering matrix, but route to the PRODUCTION gate (and through
  // it the PRODUCTION verifier) when a test opts in — so the fail-close
  // denial is proven from a real invalid on-disk artifact, never fabricated.
  const actual = await importOriginal<typeof import("../piSubagentDesktopArtifactGate.ts")>();
  return {
    ...actual,
    evaluatePiSubagentDesktopArtifactGate: async (
      mode: unknown,
      input: { readonly env: unknown },
    ) => {
      gateHarness.calls.push({ mode, env: input.env });
      if (gateHarness.mode === "real") {
        return actual.evaluatePiSubagentDesktopArtifactGate(
          mode as Parameters<typeof actual.evaluatePiSubagentDesktopArtifactGate>[0],
          input as Parameters<typeof actual.evaluatePiSubagentDesktopArtifactGate>[1],
        );
      }
      return gateHarness.result;
    },
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => {
  piSdkHarness.imports += 1;
  return {
    getAgentDir: () => {
      piSdkHarness.getAgentDirCalls += 1;
      return "/mock-pi-agent-dir";
    },
    ModelRuntime: {
      create: async (options: Record<string, unknown>) => {
        piSdkHarness.modelRuntimeOptions.push(options);
        return {};
      },
    },
    ModelRegistry: class {
      getAvailable() {
        return [];
      }
      getAll() {
        return [];
      }
      getProviderDisplayName(provider: string) {
        return provider;
      }
    },
    SettingsManager: {
      inMemory: () => ({ kind: "in-memory-settings" }),
    },
    createAgentSessionServices: async (options: Record<string, unknown>) => {
      piSdkHarness.serviceCreationCalls += 1;
      piSdkHarness.serviceOptions.push(options);
      if (gateHarness.result.kind !== "pass" || !("managed" in gateHarness.result)) {
        throw new Error("mock Pi SDK reached");
      }
      return {
        modelRuntime: {},
        resourceLoader: {
          getExtensions: () => ({
            extensions: [{ path: "/controlled/artifact/agent/extensions/pi-subagents" }],
          }),
          getSkills: () => ({
            skills: [
              {
                name: "controlled-skill",
                filePath: "/controlled/artifact/agent/skills/controlled.md",
                disableModelInvocation: false,
                description: "controlled",
                sourceInfo: { source: "controlled-artifact" },
              },
            ],
          }),
          getPrompts: () => ({
            prompts: [{ name: "controlled-prompt", description: "controlled" }],
          }),
          reload: async () => undefined,
        },
        settingsManager: {},
      };
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
  gateHarness.mode = "fabricated";
  gateHarness.result = {
    kind: "unavailable",
    reason: "locator_missing",
    detail: "managed pi artifact locator is absent or blank",
  };
  piSdkHarness.imports = 0;
  piSdkHarness.getAgentDirCalls = 0;
  piSdkHarness.serviceCreationCalls = 0;
  piSdkHarness.serviceOptions.splice(0);
  piSdkHarness.modelRuntimeOptions.splice(0);
  piSdkHarness.sessionManagerCreateCalls = 0;
  piSdkHarness.sessionManagerOpenCalls = 0;
};

const makeAdapterLayer = (
  mode: ServerConfigShape["mode"],
  env: NodeJS.ProcessEnv,
  userAgentDir?: string,
) =>
  makePiAdapterLive({
    piSubagentDesktopArtifactGateEnv: env,
    ...(userAgentDir === undefined ? {} : { piSubagentDesktopUserAgentDir: userAgentDir }),
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
  readonly userAgentDir?: string;
}) =>
  Effect.gen(function* () {
    const adapter = yield* PiAdapter;
    return yield* input.entry.invoke(adapter).pipe(Effect.flip);
  }).pipe(
    Effect.provide(makeAdapterLayer(input.mode, input.env, input.userAgentDir)),
    Effect.scoped,
    Effect.runPromise,
  );

const runSuccessfulPath = (input: {
  readonly mode: ServerConfigShape["mode"];
  readonly env: NodeJS.ProcessEnv;
  readonly entry: EntryPath;
  readonly userAgentDir?: string;
}) =>
  Effect.gen(function* () {
    const adapter = yield* PiAdapter;
    return yield* input.entry.invoke(adapter);
  }).pipe(
    Effect.provide(makeAdapterLayer(input.mode, input.env, input.userAgentDir)),
    Effect.scoped,
    Effect.runPromise,
  );

describe("PiAdapter desktop managed-artifact early gate (Ticket 01)", () => {
  it("uses the controlled artifact runtime for valid-locator web discovery", async () => {
    resetHarness();
    gateHarness.result = {
      kind: "pass",
      managed: {
        agentDir: "/controlled/artifact/agent",
        metadata: {} as never,
      },
    };
    const userAgentDir = "/isolated/user-agent";
    const discoveryEntries = entryPaths.slice(1);
    for (const entry of discoveryEntries) {
      resetHarness();
      gateHarness.result = {
        kind: "pass",
        managed: {
          agentDir: "/controlled/artifact/agent",
          metadata: {} as never,
        },
      };
      const result = await runSuccessfulPath({
        mode: "web",
        env: {
          [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: "/controlled/artifact",
          PI_CODING_AGENT_DIR: "/untrusted/inherited-pi-agent-dir",
        },
        userAgentDir,
        entry,
      });
      expect(result).toBeDefined();
      expect(piSdkHarness.getAgentDirCalls).toBe(0);
      expect(piSdkHarness.serviceOptions[0]).toMatchObject({
        agentDir: "/controlled/artifact/agent",
        resourceLoaderOptions: {
          noExtensions: true,
          additionalExtensionPaths: [
            "/controlled/artifact/agent/extensions/pi-subagents",
          ],
        },
        settingsManager: { kind: "in-memory-settings" },
      });
      if (entry.label === "listModels") {
        expect(piSdkHarness.modelRuntimeOptions[0]).toEqual({
          authPath: join(userAgentDir, "auth.json"),
          modelsPath: join(userAgentDir, "models.json"),
        });
      }
    }
  });

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
        serviceOptions: [],
        modelRuntimeOptions: [],
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
      imports: 0,
      getAgentDirCalls: 1,
      serviceCreationCalls: 1,
      sessionManagerCreateCalls: 0,
      sessionManagerOpenCalls: 0,
    });
  });
});

/**
 * Ticket 01b (AC6, Decision 0006) — real on-disk expanded-closure fixtures.
 *
 * Each fixture is a staged expanded-closure artifact (extension + shared +
 * `node_modules` regular files) that the PRODUCTION verifier genuinely
 * rejects with a distinct bounded category, so the fail-close denial proves
 * the real verifier/gate result — never a fabricated unavailable reason.
 */
const closureSha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const CLOSURE_SOURCE_IDENTITY = {
  repositoryUrl: "https://github.com/anhphamwork99/alfie.git",
  pinnedCommit: "aa6fa4a8540644d2509b10d6df854486ddc67d1d",
  packageName: "@alfie/pi-subagents",
  packageVersion: "0.15.0-alfie.4",
};

const CLOSURE_CAPABILITY_PROFILE = {
  protocolVersion: 1,
  capabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
  requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
};

interface ClosureFileSpec {
  readonly path: string;
  readonly content: string;
}

/**
 * The expanded-closure file set. Mirrors the release stager's layout
 * (Decision 0006 Binding decision 2): the extension tree, the sibling
 * `agent/extensions/shared` modules it imports, and the release-owned
 * lock-proven root-level `node_modules` regular-file dependency closure.
 */
const CLOSURE_BASE_FILES: ReadonlyArray<ClosureFileSpec> = [
  {
    path: "agent/extensions/pi-subagents/package.json",
    content: JSON.stringify({ name: "@alfie/pi-subagents", version: "0.15.0-alfie.4" }),
  },
  {
    path: "agent/extensions/pi-subagents/src/index.ts",
    content: "export const managed = true;\n",
  },
  {
    path: "agent/extensions/shared/durable-preferences.js",
    content: "export const durablePreferences = 'shared';\n",
  },
  {
    path: "agent/extensions/shared/durable-preferences.d.ts",
    content: "export declare const durablePreferences: string;\n",
  },
  {
    path: "node_modules/zod/package.json",
    content: JSON.stringify({ name: "zod", version: "3.24.1", main: "index.js" }),
  },
  {
    path: "node_modules/zod/index.js",
    content: "module.exports = require('./lib/index.js');\n",
  },
  {
    path: "node_modules/@scope/dep/dist/runtime.js",
    content: "export const runtimeDependency = true;\n",
  },
];

/** Records the manifest for exactly the staged file set. */
const closureManifestFor = (files: ReadonlyArray<ClosureFileSpec>): Record<string, unknown> => ({
  schemaVersion: PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  sourceIdentity: CLOSURE_SOURCE_IDENTITY,
  capabilityProfile: CLOSURE_CAPABILITY_PROFILE,
  files: files.map((file) => ({
    path: file.path,
    sizeBytes: Buffer.byteLength(file.content),
    sha256: closureSha256(file.content),
  })),
});

const stageClosureArtifact = async (
  root: string,
  files: ReadonlyArray<ClosureFileSpec>,
): Promise<void> => {
  for (const file of files) {
    await mkdir(join(root, file.path, ".."), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  await writeFile(
    join(root, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME),
    JSON.stringify(closureManifestFor(files), null, 2),
  );
};

/**
 * AC6 invalid-variant matrix over the expanded closure: every case stages a
 * manifest-declared regular-file closure on disk and is genuinely rejected by
 * the production verifier with a bounded category — the shared leg and the
 * dependency (`node_modules`) leg are proven separately. The expected gate
 * detail is derived from category + entry, exactly the production shape.
 */
const closureInvalidVariants = [
  {
    label: "shared entry_missing",
    category: "entry_missing",
    entry: "agent/extensions/shared/durable-preferences.js",
    stage: async (root: string) => {
      await stageClosureArtifact(root, CLOSURE_BASE_FILES);
      await rm(join(root, "agent/extensions/shared/durable-preferences.js"));
    },
  },
  {
    label: "dependency digest_mismatch",
    category: "digest_mismatch",
    entry: "node_modules/zod/index.js",
    stage: async (root: string) => {
      await stageClosureArtifact(root, CLOSURE_BASE_FILES);
      // Same byte length as the staged content, different bytes.
      await writeFile(
        join(root, "node_modules/zod/index.js"),
        "module.exports = require('./lib/index.jS');\n",
      );
    },
  },
  {
    label: "shared unlisted_entry",
    category: "unlisted_entry",
    entry: "agent/extensions/shared/model-catalog-reconciler.js",
    stage: async (root: string) => {
      await stageClosureArtifact(root, CLOSURE_BASE_FILES);
      await writeFile(
        join(root, "agent/extensions/shared/model-catalog-reconciler.js"),
        "export const unlisted = true;\n",
      );
    },
  },
  {
    label: "dependency symlink_escape",
    category: "symlink_escape",
    entry: "node_modules/zod",
    stage: async (root: string) => {
      await stageClosureArtifact(root, CLOSURE_BASE_FILES);
      await rm(join(root, "node_modules/zod"), { recursive: true, force: true });
      const outside = join(fixtureRoot, "outside-dependency-zod");
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, "index.js"), "outside content");
      const { symlink } = await import("node:fs/promises");
      await symlink(outside, join(root, "node_modules/zod"));
    },
  },
] as const;

const expectedGateDetail = (variant: (typeof closureInvalidVariants)[number]): string =>
  `managed pi artifact verification failed: ${variant.category} (entry: ${variant.entry})`;

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "synara-t01b-ac6-"));
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

/** Desktop env for the AC6 legs: the real locator plus an inherited untrusted agent dir. */
const invalidClosureEnv = (artifactRoot: string): NodeJS.ProcessEnv => ({
  [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: artifactRoot,
  PI_CODING_AGENT_DIR: "/untrusted/inherited-pi-agent-dir",
});

describe("PiAdapter desktop fail-close against real invalid expanded-closure artifacts (Ticket 01b AC6)", () => {
  it.for(closureInvalidVariants)(
    "rejects desktop entries for $label before SDK import or discovery, using the real verifier/gate result",
    async (variant) => {
      for (const entry of entryPaths) {
        resetHarness();
        gateHarness.mode = "real";
        const artifactRoot = await mkdtemp(
          join(fixtureRoot, `${variant.label.replace(/[^a-z0-9]+/gu, "-")}-`),
        );
        await variant.stage(artifactRoot);

        const failure = await runPath({
          mode: "desktop",
          env: invalidClosureEnv(artifactRoot),
          entry,
        });

        expect(failure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          provider: "pi",
          method: entry.method,
          detail: `Managed Pi subagents are unavailable (${variant.category}): ${expectedGateDetail(variant)}`,
        });
        expect(gateHarness.calls).toEqual([
          {
            mode: "desktop",
            env: invalidClosureEnv(artifactRoot),
          },
        ]);
        expect(piSdkHarness).toEqual({
          imports: 0,
          getAgentDirCalls: 0,
          serviceCreationCalls: 0,
          serviceOptions: [],
          modelRuntimeOptions: [],
          sessionManagerCreateCalls: 0,
          sessionManagerOpenCalls: 0,
        });
      }
    },
  );

  it("verifies a real invalid web-mode locator and fails closed before the SDK path", async () => {
    resetHarness();
    gateHarness.mode = "real";
    const artifactRoot = await mkdtemp(join(fixtureRoot, "web-invalid-"));
    await stageClosureArtifact(artifactRoot, CLOSURE_BASE_FILES);
    await rm(join(artifactRoot, "agent/extensions/shared/durable-preferences.js"));

    const failure = await runPath({
      mode: "web",
      env: invalidClosureEnv(artifactRoot),
      entry: entryPaths[2]!,
    });

    // Local web/dev path: a WEB-mode server started with a NON-EMPTY
    // launcher-derived locator is verified exactly like desktop, so the
    // same real verifier denial fail-closes the entry before any Pi SDK
    // import or discovery.
    expect(failure).toMatchObject({
      _tag: "ProviderAdapterRequestError",
      provider: "pi",
      method: "skill/list",
      detail:
        "Managed Pi subagents are unavailable (entry_missing): " +
        "managed pi artifact verification failed: entry_missing " +
        "(entry: agent/extensions/shared/durable-preferences.js)",
    });
    expect(gateHarness.calls).toEqual([
      {
        mode: "web",
        env: invalidClosureEnv(artifactRoot),
      },
    ]);
    expect(piSdkHarness).toEqual({
      imports: 0,
      getAgentDirCalls: 0,
      serviceCreationCalls: 0,
      serviceOptions: [],
      modelRuntimeOptions: [],
      sessionManagerCreateCalls: 0,
      sessionManagerOpenCalls: 0,
    });
  });
});
