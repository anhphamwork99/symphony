import * as NodeModule from "node:module";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildPiSubagentArtifact,
  loadPiSubagentExtensionProvenance,
} from "../../../../scripts/lib/piSubagentArtifactStaging.ts";
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
