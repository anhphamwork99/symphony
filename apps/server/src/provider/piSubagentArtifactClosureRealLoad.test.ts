import * as NodeModule from "node:module";
import { createRequire } from "node:module";
import http from "node:http";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildPiSubagentArtifact,
  loadPiSubagentExtensionProvenance,
} from "../../../../scripts/lib/piSubagentArtifactStaging.ts";
import { evaluatePiSubagentDesktopArtifactGate, SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV } from "./piSubagentDesktopArtifactGate.ts";
import { probePiSubagentBridge } from "./piSubagentBridge.ts";
import { verifyPiSubagentArtifact } from "./piSubagentArtifactVerifier.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const REAL_ALFIE_REPO_DIR = process.env.ALFIE_REPO_DIR ?? "";
const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

function writePackageCanary(nodeModulesDir: string, packageName: string, version: string): string {
  const packageDir = join(nodeModulesDir, ...packageName.split("/"));
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        type: "module",
        exports:
          packageName === "@sinclair/typebox"
            ? {
                ".": "./index.js",
                "./compile": "./compile.js",
                "./value": "./value.js",
                "./package.json": "./package.json",
              }
            : {
                ".": "./index.js",
                "./package.json": "./package.json",
              },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(join(packageDir, "index.js"), `throw new Error("${packageName} canary must not load");\n`);
  if (packageName === "@sinclair/typebox") {
    writeFileSync(
      join(packageDir, "compile.js"),
      'throw new Error("@sinclair/typebox/compile canary must not load");\n',
    );
    writeFileSync(
      join(packageDir, "value.js"),
      'throw new Error("@sinclair/typebox/value canary must not load");\n',
    );
  }
  return packageDir;
}

function installResolutionCanaries(baseDir: string): void {
  const nodeModulesDir = join(baseDir, "node_modules");
  writePackageCanary(nodeModulesDir, "@sinclair/typebox", "9.9.9-canary");
  writePackageCanary(nodeModulesDir, "croner", "9.9.9-canary");
  writePackageCanary(nodeModulesDir, "nanoid", "9.9.9-canary");
  writePackageCanary(nodeModulesDir, "yaml", "9.9.9-canary");
}

function installGlobalResolutionCanaries(homeDir: string): string {
  const nodeModulesDir = join(homeDir, ".node_modules");
  writePackageCanary(nodeModulesDir, "@sinclair/typebox", "9.9.9-canary");
  writePackageCanary(nodeModulesDir, "croner", "9.9.9-canary");
  writePackageCanary(nodeModulesDir, "nanoid", "9.9.9-canary");
  writePackageCanary(nodeModulesDir, "yaml", "9.9.9-canary");
  return nodeModulesDir;
}

function installUserExtensionCanaries(agentDir: string): void {
  const userExtensionDir = join(agentDir, "extensions", "pi-subagents");
  mkdirSync(join(userExtensionDir, "src"), { recursive: true });
  writeFileSync(
    join(userExtensionDir, "package.json"),
    `${JSON.stringify({ name: "@alfie/pi-subagents", version: "0.0.0-canary" }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(userExtensionDir, "src/index.ts"),
    'throw new Error("user extension canary must not load");\n',
    "utf8",
  );

  const sharedDir = join(agentDir, "extensions", "shared");
  mkdirSync(sharedDir, { recursive: true });
  for (const name of [
    "durable-preferences.js",
    "execution-identity.js",
    "model-catalog-reconciler.js",
  ]) {
    writeFileSync(
      join(sharedDir, name),
      `throw new Error("${name} canary must not load");\n`,
      "utf8",
    );
  }
}

function refreshNodeGlobalResolution(): void {
  const maybeModule = NodeModule as typeof NodeModule & {
    Module?: { _initPaths?: () => void };
    _initPaths?: () => void;
  };
  maybeModule.Module?._initPaths?.();
  maybeModule._initPaths?.();
}

function findPackageJsonFromResolvedEntry(resolvedEntry: string): string {
  let currentDir = dirname(resolvedEntry);
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(currentDir, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }
  throw new Error(`Could not locate package.json for resolved entry '${resolvedEntry}'.`);
}

function canonicalPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function assertPathInClosure(resolvedPath: string, closureRoot: string, forbiddenRoots: ReadonlyArray<string>): void {
  expect(canonicalPath(resolvedPath).startsWith(canonicalPath(closureRoot))).toBe(true);
  for (const forbidden of forbiddenRoots) {
    expect(canonicalPath(resolvedPath).startsWith(canonicalPath(forbidden))).toBe(false);
  }
}

describe.skipIf(!REAL_ALFIE_REPO_DIR || !existsSync(REAL_ALFIE_REPO_DIR))(
  "pi-subagents artifact real closure load (Ticket 01b AC4)",
  () => {
    it(
      "loads the real pinned staged artifact through the production loader with artifact-local typebox closure and no ambient fallback",
      { timeout: 120_000 },
      async () => {
        const provenance = loadPiSubagentExtensionProvenance(
          join(REPO_ROOT, "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json"),
        );
        const workspaceRoot = makeTempRoot("pi-ac4-real-");
        const artifactParentDir = join(workspaceRoot, "artifact-parent");
        const artifactDir = join(artifactParentDir, "pi-subagents-artifact");
        const agentDir = join(workspaceRoot, "agent-home");
        const cwd = join(workspaceRoot, "workspace");
        const nodePathCanaryRoot = join(workspaceRoot, "node-path-canary");
        const homeDir = join(workspaceRoot, "fake-home");
        mkdirSync(artifactParentDir, { recursive: true });
        mkdirSync(agentDir, { recursive: true });
        mkdirSync(cwd, { recursive: true });
        mkdirSync(homeDir, { recursive: true });

        installResolutionCanaries(nodePathCanaryRoot);
        installResolutionCanaries(workspaceRoot);
        const homeNodeModules = installGlobalResolutionCanaries(homeDir);
        installUserExtensionCanaries(agentDir);

        const staged = buildPiSubagentArtifact({
          repoDir: REAL_ALFIE_REPO_DIR,
          artifactDir,
          provenance,
        });
        const stagedExtensionDir = join(staged.artifactDir, "agent/extensions/pi-subagents");
        const manifestBeforeLoad = readFileSync(staged.manifestPath, "utf8");

        const verifiedBefore = await verifyPiSubagentArtifact(staged.artifactDir);
        expect(verifiedBefore.valid).toBe(true);

        const originalNodePath = process.env.NODE_PATH;
        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;

        process.env.NODE_PATH = join(nodePathCanaryRoot, "node_modules");
        process.env.HOME = homeDir;
        process.env.USERPROFILE = homeDir;
        refreshNodeGlobalResolution();

        const modelRuntime = await ModelRuntime.create({
          authPath: join(agentDir, "auth.json"),
          modelsPath: null,
        });

        let session:
          | Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]
          | undefined;
        try {
          const services = await createAgentSessionServices({
            cwd,
            agentDir,
            modelRuntime,
            resourceLoaderOptions: {
              additionalExtensionPaths: [stagedExtensionDir],
              noExtensions: true,
              noSkills: true,
              noPromptTemplates: true,
              noThemes: true,
              noContextFiles: true,
            },
          });

          expect(services.resourceLoader.getExtensions().errors).toEqual([]);
          session = (
            await createAgentSessionFromServices({
              services,
              sessionManager: SessionManager.inMemory(cwd),
            })
          ).session;
          await session.bindExtensions({});

          const extensions = session.resourceLoader.getExtensions().extensions;
          expect(extensions).toHaveLength(1);
          const loadedExtension = extensions[0] as {
            readonly path: string;
            readonly sourceInfo?: { readonly source?: string };
          };
          expect(resolve(loadedExtension.path).startsWith(resolve(stagedExtensionDir))).toBe(true);
          expect(loadedExtension.sourceInfo?.source).toBe("cli");

          const bridgeCapability = await probePiSubagentBridge(session);
          expect(bridgeCapability.isManaged).toBe(true);
          expect(bridgeCapability.status).toBe("managed_enabled");
          expect(session.getAllTools().some((tool) => tool.name === "Agent")).toBe(true);

          const extensionRequire = createRequire(loadedExtension.path);
          const forbiddenRoots = [
            join(nodePathCanaryRoot, "node_modules"),
            join(workspaceRoot, "node_modules"),
            homeNodeModules,
            join(agentDir, "extensions"),
          ];

          const hostPiPackageRoot = resolve(REPO_ROOT, "apps/server/node_modules/@earendil-works/pi-coding-agent");
          const hostPiPackage = JSON.parse(
            readFileSync(join(hostPiPackageRoot, "package.json"), "utf8"),
          ) as {
            readonly dependencies?: Record<string, string>;
          };
          expect(hostPiPackage.dependencies?.typebox).toBe("1.3.7");

          // This is the actual production loader Jiti config, not a source-map
          // or artifact filesystem check. Both executable alias tables must
          // lack scoped TypeBox or Jiti can bypass this artifact-local proof.
          const hostLoaderPath = join(hostPiPackageRoot, "dist/core/extensions/loader.js");
          const hostLoaderSource = readFileSync(hostLoaderPath, "utf8");
          const virtualModulesStart = hostLoaderSource.indexOf("const VIRTUAL_MODULES = {");
          const virtualModulesEnd = hostLoaderSource.indexOf("};", virtualModulesStart);
          const aliasesStart = hostLoaderSource.indexOf("_aliases = {");
          const aliasesEnd = hostLoaderSource.indexOf("};", aliasesStart);
          expect(virtualModulesStart).toBeGreaterThanOrEqual(0);
          expect(virtualModulesEnd).toBeGreaterThan(virtualModulesStart);
          expect(aliasesStart).toBeGreaterThanOrEqual(0);
          expect(aliasesEnd).toBeGreaterThan(aliasesStart);
          const virtualModules = hostLoaderSource.slice(virtualModulesStart, virtualModulesEnd);
          const aliases = hostLoaderSource.slice(aliasesStart, aliasesEnd);
          for (const scopedTypeboxSpecifier of [
            "@sinclair/typebox",
            "@sinclair/typebox/compile",
            "@sinclair/typebox/value",
          ]) {
            expect(virtualModules).not.toContain(`"${scopedTypeboxSpecifier}"`);
            expect(aliases).not.toContain(`"${scopedTypeboxSpecifier}"`);
          }
          // Keep the patch narrow: Pi peers and host's unscoped TypeBox remain aliases.
          expect(virtualModules).toContain('"@earendil-works/pi-agent-core"');
          expect(aliases).toContain('"@earendil-works/pi-agent-core"');
          expect(virtualModules).toContain("typebox: _bundledTypebox");
          expect(aliases).toContain("typebox: typeboxEntry");

          const typeboxPackagePath = findPackageJsonFromResolvedEntry(
            extensionRequire.resolve("@sinclair/typebox"),
          );
          const typeboxPackage = JSON.parse(readFileSync(typeboxPackagePath, "utf8")) as {
            readonly version: string;
          };
          expect(typeboxPackage.version).toBe("0.34.49");
          assertPathInClosure(
            typeboxPackagePath,
            join(staged.artifactDir, "node_modules/@sinclair/typebox"),
            forbiddenRoots,
          );

          for (const packageName of ["croner", "nanoid", "yaml"] as const) {
            const packageJsonPath = findPackageJsonFromResolvedEntry(
              extensionRequire.resolve(packageName),
            );
            assertPathInClosure(
              packageJsonPath,
              join(staged.artifactDir, "node_modules", packageName),
              forbiddenRoots,
            );
            const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
              readonly version: string;
            };
            expect(pkg.version.endsWith("canary")).toBe(false);
          }

          for (const sharedModule of [
            "../../shared/durable-preferences.js",
            "../../shared/execution-identity.js",
            "../../shared/model-catalog-reconciler.js",
          ] as const) {
            const sharedPath = extensionRequire.resolve(sharedModule);
            const sharedBasename = sharedModule.split("/").at(-1)!;
            assertPathInClosure(
              sharedPath,
              join(staged.artifactDir, "agent/extensions/shared", sharedBasename),
              forbiddenRoots,
            );
            expect(readFileSync(sharedPath, "utf8")).not.toContain("canary must not load");
          }

          expect(readFileSync(staged.manifestPath, "utf8")).toBe(manifestBeforeLoad);
          const verifiedAfter = await verifyPiSubagentArtifact(staged.artifactDir);
          expect(verifiedAfter.valid).toBe(true);
        } finally {
          session?.dispose();
          process.env.NODE_PATH = originalNodePath;
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          refreshNodeGlobalResolution();
        }
      },
    );
  },
);

// ─── Ticket 01c (Decision 0010 AC5/AC4/AC6) — WP4 real controlled-artifact ───
//
// Legs:
//  1. AC5 real child-spawn closure proof: stage the EXPANDED artifact (with
//     the mechanically derived `agent/system` prompt closure), verify it
//     before loading, exclude user/global/ancestor/NODE_PATH prompt and
//     resolution canaries, invoke the real loaded `Agent` tool with a valid
//     delegation quartet, and prove ≥1 REAL deterministic CHILD model request
//     whose body carries distinctive substrings of the STAGED prompt files —
//     while decoy prompt locations (parent agentDir, child agentDir, working
//     directory, HOME) demonstrably did NOT supply them. Verify again after.
//  2. AC4/AC6 negative prompt controls: three separately copied artifacts —
//     deleted, same-length-tampered, and symlink-replaced required prompt
//     file — each rejected by `verifyPiSubagentArtifact` AND
//     `evaluatePiSubagentDesktopArtifactGate` BEFORE any SDK/extension
//     runtime use, with bounded no-decoy diagnostics and unchanged
//     no-side-effect/canary state.
//
// The model endpoint is the only fixture (owner-approved seam); everything
// else — stager, verifier, desktop gate, production loader, extension, Agent
// tool, child session — is real. Helpers are LOCAL COPIES of the patterns in
// `piSubagentIntegratedAcceptance.test.ts` (cross-test-file imports would
// double-register suites); they are deliberately not imported from it.

const DETERMINISTIC_MODEL_PROVIDER_ID = "synara-local-echo";
const DETERMINISTIC_ECHO_MODEL_ID = "echo";

/** Marker that must appear in NO request body: decoys never supplied prompts. */
const DECOY_PROMPT_MARKER = "DECOY-PROMPT-MARKER-MUST-NEVER-REACH-A-MODEL-REQUEST";

/**
 * Distinctive marker derived from the ACTUAL staged prompt bytes (Ticket 01c
 * review remediation: no manually authored marker strings). The marker for
 * each staged file is a stable distinctive substring of the staged file's
 * own bytes — the longest non-template line — so the request-body proof is
 * tied to exactly what `buildPiSubagentArtifact` staged, and any alteration
 * of the staged bytes changes the derived marker set.
 */
interface StagedPromptMarkerProof {
  /** repo-relative staged path → derived distinctive substring of its bytes. */
  readonly markersByPath: ReadonlyMap<string, string>;
}

function deriveStagedPromptMarker(stagedBytes: string): string {
  const lines = stagedBytes.split(/\r?\n/);
  const candidates = lines
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length < 24) return false;
      // Template placeholders are substituted at runtime — a marker must be
      // literal staged bytes that survive into the built prompt verbatim.
      if (trimmed.includes("{{") || trimmed.includes("}}")) return false;
      return true;
    })
    .sort((a, b) => b.length - a.length);
  const best = candidates[0]?.trim();
  if (best === undefined) {
    throw new Error("Could not derive a distinctive marker from staged prompt bytes (no qualifying line).");
  }
  return best;
}

/**
 * Reads the staged `agent/system/*.md` files AFTER `buildPiSubagentArtifact`
 * (paths enumerated from the staged manifest — never a hardcoded list) and
 * derives one distinctive marker per file from the staged bytes.
 */
function deriveStagedPromptMarkers(artifactDir: string): StagedPromptMarkerProof {
  const manifest = JSON.parse(
    readFileSync(join(artifactDir, "manifest.json"), "utf8"),
  ) as {
    readonly files: ReadonlyArray<{ readonly path: string }>;
  };
  const promptPaths = manifest.files
    .map((record) => record.path)
    .filter((path) => path.startsWith("agent/system/"))
    .sort();
  if (promptPaths.length === 0) {
    throw new Error("Staged artifact carries no agent/system prompt entries.");
  }
  const markersByPath = new Map<string, string>();
  for (const relative of promptPaths) {
    markersByPath.set(relative, deriveStagedPromptMarker(readFileSync(join(artifactDir, relative), "utf8")));
  }
  return { markersByPath };
}

interface LoopbackModelServer {
  readonly baseUrl: string;
  /** Raw JSON request bodies received (used for prompt-byte provenance). */
  readonly bodies: string[];
  readonly close: () => Promise<void>;
}

/**
 * Deterministic loopback model server (local copy of the integrated-suite
 * fixture, extended to record full request bodies): answers every completion
 * with the constant text "ACK" so the child run is deterministic.
 */
function startLoopbackModelServer(): Promise<LoopbackModelServer> {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      bodies.push(raw);
      let requestedModel = "";
      try {
        requestedModel = (JSON.parse(raw) as { model?: string }).model ?? "";
      } catch {
        requestedModel = "";
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunkEvent = (delta: Record<string, unknown>, finishReason: string | null) =>
        `data: ${JSON.stringify({
          id: "chatcmpl-synara-local-echo",
          object: "chat.completion.chunk",
          created: 0,
          model: requestedModel,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`;
      res.write(chunkEvent({ role: "assistant", content: "ACK" }, null));
      res.write(chunkEvent({}, "stop"));
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
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolveServer({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        bodies,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Hermetic auth/models OUTSIDE the artifact (local copy of the integrated
 * suite's `writeAgentDirWithModels` auth/model half — no extension symlink:
 * this WP's extension content must come only from the staged artifact).
 */
function writeHermeticAuthAndModels(agentDir: string, baseUrl: string): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      [DETERMINISTIC_MODEL_PROVIDER_ID]: { type: "api_key", key: "synara-local-test-key" },
    }),
  );
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        [DETERMINISTIC_MODEL_PROVIDER_ID]: {
          name: "Synara Local Echo (deterministic test fixture provider)",
          baseUrl,
          api: "openai-completions",
          apiKey: "synara-local-test-key",
          authHeader: true,
          compat: { supportsDeveloperRole: false },
          models: [
            {
              id: DETERMINISTIC_ECHO_MODEL_ID,
              name: "Local Echo",
              reasoning: false,
              input: ["text"],
              contextWindow: 100_000,
              maxTokens: 1_000,
            },
          ],
        },
      },
    }),
  );
}

/**
 * Prompt-location decoys: a full lookalike `system/` prompt set planted at
 * every plausible non-artifact prompt location — parent agentDir, child
 * agentDir, working directory, and HOME. Every decoy file carries the decoy
 * marker; if ANY prompt byte came from a decoy, the marker reaches the model
 * request body and the assertion fails.
 */
function installPromptLocationDecoys(decoyRoots: ReadonlyArray<string>): string[] {
  const plantedFiles: string[] = []
  for (const root of decoyRoots) {
    const systemDir = join(root, "system");
    mkdirSync(systemDir, { recursive: true });
    for (const basename of [
      "subagent-system.md",
      "tool-guidelines.md",
      "skill-rules.md",
      "working-style.md",
    ]) {
      const decoyPath = join(systemDir, basename);
      writeFileSync(
        decoyPath,
        `# Decoy prompt file (${basename})\n\n${DECOY_PROMPT_MARKER}\nAmbient prompt content that must never reach a child model request.\n`,
        "utf8",
      );
      plantedFiles.push(decoyPath);
    }
  }
  return plantedFiles;
}

/** Snapshot of canary/decoy material bytes for no-side-effect proof. */
function snapshotFileBytes(paths: ReadonlyArray<string>): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const path of paths) {
    snapshot.set(path, existsSync(path) ? readFileSync(path, "utf8") : "");
  }
  return snapshot;
}

function expectSnapshotUnchanged(snapshot: Map<string, string>): void {
  for (const [path, expected] of snapshot) {
    expect(existsSync(path) ? readFileSync(path, "utf8") : "").toBe(expected);
  }
}

/** The verifier/gate diagnostics must never carry host paths or fs noise. */
function expectBoundedNoDecoyDiagnostic(serialized: string, forbiddenRoots: ReadonlyArray<string>): void {
  expect(serialized).not.toContain(DECOY_PROMPT_MARKER);
  expect(serialized).not.toMatch(/ENOENT|EACCES|EISDIR|EPERM/u);
  for (const root of forbiddenRoots) {
    expect(serialized).not.toContain(root);
  }
}

describe.skipIf(!REAL_ALFIE_REPO_DIR || !existsSync(REAL_ALFIE_REPO_DIR))(
  "pi-subagents artifact real child-spawn prompt closure (Ticket 01c, Decision 0010)",
  () => {
    it(
      "AC5: the expanded verified artifact alone drives a real Agent delegation to a real deterministic child model request whose prompt bytes come from the staged agent/system closure, with ambient prompt locations excluded",
      { timeout: 180_000 },
      async () => {
        const provenance = loadPiSubagentExtensionProvenance(
          join(REPO_ROOT, "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json"),
        );
        const modelServer = await startLoopbackModelServer();
        const workspaceRoot = makeTempRoot("pi-t01c-ac5-");
        const artifactParentDir = join(workspaceRoot, "artifact-parent");
        const artifactDir = join(artifactParentDir, "pi-subagents-artifact");
        const parentAgentDir = join(workspaceRoot, "agent-home");
        const childAgentDir = join(workspaceRoot, "child-agent-home");
        const cwd = join(workspaceRoot, "workspace");
        const nodePathCanaryRoot = join(workspaceRoot, "node-path-canary");
        const homeDir = join(workspaceRoot, "fake-home");
        mkdirSync(artifactParentDir, { recursive: true });
        mkdirSync(cwd, { recursive: true });
        mkdirSync(homeDir, { recursive: true });

        // Hermetic auth/models OUTSIDE the artifact for both the parent
        // session services and the child session the runner creates.
        writeHermeticAuthAndModels(parentAgentDir, modelServer.baseUrl);
        writeHermeticAuthAndModels(childAgentDir, modelServer.baseUrl);

        // Resolution + user-extension canaries (same pattern as the 01b leg).
        installResolutionCanaries(nodePathCanaryRoot);
        installResolutionCanaries(workspaceRoot);
        installGlobalResolutionCanaries(homeDir);
        installUserExtensionCanaries(parentAgentDir);

        // Prompt-location decoys at every non-artifact prompt root.
        installPromptLocationDecoys([
          parentAgentDir,
          childAgentDir,
          cwd,
          homeDir,
        ]);

        const staged = buildPiSubagentArtifact({
          repoDir: REAL_ALFIE_REPO_DIR,
          artifactDir,
          provenance,
        });
        const stagedExtensionDir = join(staged.artifactDir, "agent/extensions/pi-subagents");
        const manifestBeforeLoad = readFileSync(staged.manifestPath, "utf8");

        // Runtime-derived prompt-byte provenance (review P2): markers come
        // from the ACTUAL staged `agent/system/*.md` bytes — paths enumerated
        // from the staged manifest, never copied static strings.
        const stagedMarkers = deriveStagedPromptMarkers(staged.artifactDir);
        expect(stagedMarkers.markersByPath.size).toBeGreaterThanOrEqual(1);
        const subagentSystemPath = [...stagedMarkers.markersByPath.keys()].find((path) =>
          path.endsWith("subagent-system.md"),
        );
        if (subagentSystemPath === undefined) {
          throw new Error("staged prompt closure lacks subagent-system.md");
        }
        const subagentSystemMarker = stagedMarkers.markersByPath.get(subagentSystemPath)!;

        // Marker-derivation is sensitive to staged byte alteration: a
        // same-length tamper of the staged subagent-system bytes must yield a
        // marker that no longer matches the untampered staged bytes (the
        // request-body proof demonstrably fails if staged bytes change).
        const stagedSystemBytes = readFileSync(join(staged.artifactDir, subagentSystemPath), "utf8");
        const tamperedBytes = stagedSystemBytes.replace(subagentSystemMarker, subagentSystemMarker.replace("e", "x"));
        expect(Buffer.byteLength(tamperedBytes)).toBe(Buffer.byteLength(stagedSystemBytes));
        expect(tamperedBytes).not.toBe(stagedSystemBytes);
        expect(deriveStagedPromptMarker(tamperedBytes)).not.toBe(subagentSystemMarker);
        // And the marker really is a substring of the staged file's bytes
        // read back from disk (evidence tied to the staged files, not copies).
        expect(stagedSystemBytes).toContain(subagentSystemMarker);

        // Verify BEFORE loading (AC5): the expanded prompt closure verifies.
        const verifiedBefore = await verifyPiSubagentArtifact(staged.artifactDir);
        expect(verifiedBefore.valid).toBe(true);

        const originalNodePath = process.env.NODE_PATH;
        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        const originalAgentDirEnv = process.env.PI_CODING_AGENT_DIR;

        let session:
          | Awaited<ReturnType<typeof createAgentSessionFromServices>>["session"]
          | undefined;
        try {
          process.env.NODE_PATH = join(nodePathCanaryRoot, "node_modules");
          process.env.HOME = homeDir;
          process.env.USERPROFILE = homeDir;
          // The child session the extension's runner creates resolves its own
          // agent directory through the SDK env seam: point it at the hermetic
          // child dir (auth/models only — its decoy `system/` subtree is the
          // agentDir prompt-location decoy this leg proves unused).
          process.env.PI_CODING_AGENT_DIR = childAgentDir;
          refreshNodeGlobalResolution();

          const modelRuntime = await ModelRuntime.create({
            authPath: join(parentAgentDir, "auth.json"),
            modelsPath: join(parentAgentDir, "models.json"),
          });
          const registry = new ModelRegistry(modelRuntime);
          const echoModel = registry.find(DETERMINISTIC_MODEL_PROVIDER_ID, DETERMINISTIC_ECHO_MODEL_ID);
          if (!echoModel) {
            throw new Error("deterministic echo model missing from the test registry");
          }

          const services = await createAgentSessionServices({
            cwd,
            agentDir: parentAgentDir,
            modelRuntime,
            resourceLoaderOptions: {
              additionalExtensionPaths: [stagedExtensionDir],
              noExtensions: true,
              noSkills: true,
              noPromptTemplates: true,
              noThemes: true,
              noContextFiles: true,
            },
          });
          expect(services.resourceLoader.getExtensions().errors).toEqual([]);
          session = (
            await createAgentSessionFromServices({
              services,
              sessionManager: SessionManager.inMemory(cwd),
            })
          ).session;
          await session.bindExtensions({});

          const extensions = session.resourceLoader.getExtensions().extensions;
          expect(extensions).toHaveLength(1);
          expect(resolve(extensions[0]!.path).startsWith(resolve(stagedExtensionDir))).toBe(true);

          const bridgeCapability = await probePiSubagentBridge(session);
          expect(bridgeCapability.isManaged).toBe(true);
          expect(bridgeCapability.status).toBe("managed_enabled");

          // Invoke the REAL loaded Agent tool (direct execution — same pattern
          // as the integrated suite's `agentExecuteFor`) with a valid delegation
          // quartet. No managed binding is attached, so the extension takes its
          // real legacy foreground path: manager.spawnAndWait → runAgent →
          // buildAgentPrompt (the four staged prompt reads) → real child session
          // → real model request against the deterministic loopback server.
          const loadedExtension = extensions[0] as {
            readonly tools: Map<string, { execute?: unknown; definition?: { execute?: unknown } }>;
          };
          const agentEntry = loadedExtension.tools.get("Agent");
          expect(agentEntry).toBeDefined();
          const agentExecute = (agentEntry?.execute ??
            agentEntry?.definition?.execute) as
            | ((
                toolCallId: string,
                params: Record<string, unknown>,
                signal?: unknown,
                onUpdate?: unknown,
                ctx?: unknown,
              ) => Promise<unknown>)
            | undefined;
          expect(typeof agentExecute).toBe("function");

          const executeCtx = {
            ui: {
              notify: () => {},
              status: () => {},
              setStatus: () => {},
              setWidget: () => {},
              select: async () => undefined,
              confirm: async () => true,
              input: async () => undefined,
            },
            cwd,
            model: echoModel,
            modelRegistry: registry,
            sessionManager: (session as { sessionManager: unknown }).sessionManager,
            getSystemPrompt: () => "",
          };

          const result = (await agentExecute?.(
            "call_t01c_ac5_1",
            {
              commandId: "cmd_t01c_ac5_1",
              subagent_type: "general-purpose",
              task: "T01c AC5 real child spawn proof: respond with the literal token ACK.",
              context: "Deterministic loopback model fixture; no filesystem mutation required.",
              link_references: "Decision 0010; issue 01c; staged artifact agent/system closure.",
              expected_outcome: "The literal token ACK.",
              run_in_background: false,
            },
            undefined,
            undefined,
            executeCtx,
          )) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };

          expect(result?.isError).toBeFalsy();
          const resultText = result?.content?.find((part) => part.type === "text")?.text ?? "";
          expect(resultText).toContain("ACK");

          // ── The real deterministic CHILD model request happened ──
          expect(modelServer.bodies.length).toBeGreaterThanOrEqual(1);
          // Agent-tool LOAD alone proves nothing: the prompt bytes of the
          // staged `agent/system` closure must be IN the request body. Every
          // runtime-derived marker of every staged prompt file must appear.
          const childBody = modelServer.bodies.find((body) =>
            body.includes(subagentSystemMarker),
          );
          expect(childBody).toBeDefined();
          for (const [stagedPath, marker] of stagedMarkers.markersByPath) {
            expect(childBody, `marker of staged ${stagedPath} missing from child request body`).toContain(marker);
          }
          // No decoy prompt location supplied any prompt byte.
          for (const body of modelServer.bodies) {
            expect(body.includes(DECOY_PROMPT_MARKER)).toBe(false);
          }

          // Verify AFTER loading (AC5): the artifact is unchanged and still
          // verifies — the runtime consumed it without mutating it.
          expect(readFileSync(staged.manifestPath, "utf8")).toBe(manifestBeforeLoad);
          const verifiedAfter = await verifyPiSubagentArtifact(staged.artifactDir);
          expect(verifiedAfter.valid).toBe(true);
        } finally {
          session?.dispose();
          process.env.NODE_PATH = originalNodePath;
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          if (originalAgentDirEnv === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
          } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDirEnv;
          }
          refreshNodeGlobalResolution();
          await modelServer.close();
        }
      },
    );

    it(
      "AC4/AC6: deleted, same-length-tampered, and symlink-replaced required prompt files each fail verify AND the desktop gate before any runtime use, with bounded diagnostics and unchanged canary/no-side-effect state",
      { timeout: 120_000 },
      async () => {
        const provenance = loadPiSubagentExtensionProvenance(
          join(REPO_ROOT, "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json"),
        );
        const modelServer = await startLoopbackModelServer();
        try {
        const workspaceRoot = makeTempRoot("pi-t01c-neg-");
        const goodArtifactDir = join(workspaceRoot, "good-artifact");
        const parentAgentDir = join(workspaceRoot, "agent-home");
        const cwd = join(workspaceRoot, "workspace");
        const nodePathCanaryRoot = join(workspaceRoot, "node-path-canary");
        const homeDir = join(workspaceRoot, "fake-home");
        mkdirSync(cwd, { recursive: true });
        mkdirSync(homeDir, { recursive: true });

        writeHermeticAuthAndModels(parentAgentDir, modelServer.baseUrl);
        installResolutionCanaries(nodePathCanaryRoot);
        installResolutionCanaries(workspaceRoot);
        installGlobalResolutionCanaries(homeDir);
        installUserExtensionCanaries(parentAgentDir);
        const decoyFiles = installPromptLocationDecoys([
          parentAgentDir,
          cwd,
          homeDir,
        ]);

        // The GOOD staged artifact (never mutated by this leg).
        const staged = buildPiSubagentArtifact({
          repoDir: REAL_ALFIE_REPO_DIR,
          artifactDir: goodArtifactDir,
          provenance,
        });
        const manifestBytes = readFileSync(staged.manifestPath, "utf8");
        const verifiedGood = await verifyPiSubagentArtifact(staged.artifactDir);
        expect(verifiedGood.valid).toBe(true);

        // Runtime-derived victim marker (review P2): the tamper control flips
        // bytes inside a marker derived from the staged file's own bytes, not
        // a copied static string.
        const stagedMarkers = deriveStagedPromptMarkers(staged.artifactDir);
        const subagentSystemPath = [...stagedMarkers.markersByPath.keys()].find((path) =>
          path.endsWith("subagent-system.md"),
        );
        if (subagentSystemPath === undefined) {
          throw new Error("staged prompt closure lacks subagent-system.md");
        }
        const subagentSystemMarker = stagedMarkers.markersByPath.get(subagentSystemPath)!;

        // Canary/decoy no-side-effect baseline.
        const canaryPaths = [
          join(parentAgentDir, "extensions", "pi-subagents", "src", "index.ts"),
          join(parentAgentDir, "extensions", "shared", "durable-preferences.js"),
          ...decoyFiles,
        ];
        const canarySnapshot = snapshotFileBytes(canaryPaths);

        const victimRelative = "agent/system/subagent-system.md";
        const outsideTarget = join(workspaceRoot, "outside-prompt-payload.md");
        writeFileSync(
          outsideTarget,
          `# Outside payload\n\n${DECOY_PROMPT_MARKER}\nSymlinked content living outside the artifact.\n`,
          "utf8",
        );

        // Fresh full copy of the verified artifact per control (all regular
        // files in a valid artifact — `cpSync` reproduces them exactly).
        const copyArtifact = (label: string): string => {
          const copyDir = join(workspaceRoot, label);
          cpSync(staged.artifactDir, copyDir, { recursive: true });
          return copyDir;
        };

        const controls = [
          {
            label: "deleted",
            reason: "entry_missing" as const,
            mutate: (dir: string) => {
              rmSync(join(dir, victimRelative));
            },
          },
          {
            label: "tampered",
            reason: "digest_mismatch" as const,
            mutate: (dir: string) => {
              const victim = join(dir, victimRelative);
              const original = readFileSync(victim, "utf8");
              // Same-length byte flip inside the runtime-derived marker line.
              const marker = subagentSystemMarker;
              const tamperedLine = marker.replace("e", "x");
              expect(Buffer.byteLength(tamperedLine)).toBe(Buffer.byteLength(marker));
              expect(original).toContain(marker);
              writeFileSync(victim, original.replace(marker, tamperedLine), "utf8");
            },
          },
          {
            label: "symlinked",
            reason: "symlink_escape" as const,
            mutate: (dir: string) => {
              const victim = join(dir, victimRelative);
              rmSync(victim);
              symlinkSync(outsideTarget, victim, "file");
            },
          },
        ];

        for (const control of controls) {
          const copyDir = copyArtifact(`control-${control.label}`);
          control.mutate(copyDir);

          // Rejection by the production verifier, before any runtime use.
          const verification = await verifyPiSubagentArtifact(copyDir);
          expect(verification.valid).toBe(false);
          if (!verification.valid) {
            expect(verification.category).toBe(control.reason);
            expect(verification.entry).toBe(victimRelative);
          }
          expectBoundedNoDecoyDiagnostic(JSON.stringify(verification), [
            workspaceRoot,
            tmpdir(),
          ]);

          // Rejection by the desktop fail-close gate with the same closed
          // category and a bounded detail — before Pi SDK import, extension
          // discovery, or any durable side effect (pure function, injected env).
          const gate = await evaluatePiSubagentDesktopArtifactGate("desktop", {
            env: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: copyDir },
          });
          expect(gate.kind).toBe("unavailable");
          if (gate.kind === "unavailable") {
            expect(gate.reason).toBe(control.reason);
            expectBoundedNoDecoyDiagnostic(gate.detail, [workspaceRoot, tmpdir()]);
          }
        }

        // No runtime use occurred: zero model requests, canary/decoy material
        // byte-identical, and the GOOD artifact still verifies untouched.
        expect(modelServer.bodies).toHaveLength(0);
        expectSnapshotUnchanged(canarySnapshot);
        expect(readFileSync(staged.manifestPath, "utf8")).toBe(manifestBytes);
        const verifiedGoodAfter = await verifyPiSubagentArtifact(staged.artifactDir);
        expect(verifiedGoodAfter.valid).toBe(true);
        } finally {
          // Review P2 cleanup: the loopback model server (and with it the
          // hermetic session resources it serves) shuts down on ANY outcome —
          // setup or assertion failure included — never only on success.
          await modelServer.close();
        }
      },
    );
  },
);
