import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
  PiSubagentArtifactManifest,
} from "@synara/contracts";

import {
  PI_SUBAGENT_ARTIFACT_DIR_NAME,
  PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME,
  buildPiSubagentArtifact,
  loadPiSubagentExtensionProvenance,
  verifyAlfieExtensionProvenance,
} from "./piSubagentArtifactStaging.ts";

const temporaryRoots: string[] = [];
const REAL_ALFIE_REPO_DIR = process.env.ALFIE_REPO_DIR ?? "";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

interface WalkedEntry {
  readonly relative: string;
  readonly symlink: boolean;
}

function walkEntries(rootDir: string, currentRelative = ""): ReadonlyArray<WalkedEntry> {
  const collected: WalkedEntry[] = [];
  for (const entry of readdirSync(rootDir).toSorted()) {
    const absolute = join(rootDir, entry);
    const relative = currentRelative ? `${currentRelative}/${entry}` : entry;
    const stats = lstatSync(absolute);
    if (stats.isDirectory()) {
      collected.push(...walkEntries(absolute, relative));
    } else {
      collected.push({ relative, symlink: stats.isSymbolicLink() });
    }
  }
  return collected;
}

function loadRealProvenance() {
  return loadPiSubagentExtensionProvenance(
    join(REPO_ROOT, "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json"),
  );
}

interface SyntheticProvenance {
  readonly expectedRepositoryUrl: string;
  readonly pinnedCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly extensionEntryRelativePath: string;
  readonly packageManifestRelativePath: string;
  readonly hashes: Record<string, string>;
}

interface SyntheticAlfieRepo {
  readonly repoDir: string;
  readonly provenance: SyntheticProvenance;
}

/** Shared runtime modules the real pinned extension imports (stager contract). */
const SYNTHETIC_SHARED_MODULES = [
  "durable-preferences",
  "execution-identity",
  "model-catalog-reconciler",
];

/** The current pin's exact derived child-prompt closure (stager contract). */
const SYNTHETIC_PROMPT_FILES = [
  "agent/system/skill-rules.md",
  "agent/system/subagent-system.md",
  "agent/system/tool-guidelines.md",
  "agent/system/working-style.md",
];

/**
 * The minimal pinned-shape prompt modules the mechanical derivation walks
 * (entry `src/agent-runner.ts` importing `buildAgentPrompt` from
 * `src/prompts.ts`, whose required reads resolve `../../../system`).
 * Parameterizable for Ticket 01c staging fixtures (fifth read, dynamic read…).
 */
function syntheticPromptModules(options: {
  readonly extraLiteralRead?: string;
  readonly dynamicRead?: boolean;
  readonly emptyPromptFile?: string;
  readonly importedHelperRead?: string;
  readonly sameNameSideLoad?: boolean;
}): { readonly agentRunner: string; readonly prompts: string; readonly importedPrompts?: string } {
  const extraConst = options.extraLiteralRead
    ? `const EXTRA_PATH = join(SYSTEM_DIR, "${options.extraLiteralRead}");\n`
    : "";
  const extraRead = options.extraLiteralRead ? "    readRequiredPrompt(EXTRA_PATH),\n" : "";
  const dynamicRead = options.dynamicRead
    ? "    readRequiredPrompt(join(SYSTEM_DIR, `dyn-${Date.now()}.md`)),\n"
    : "";
  const importedHelperRead = options.importedHelperRead ? "    readImportedExtraPrompt(),\n" : "";
  const importedHelperImport =
    options.importedHelperRead !== undefined
      ? 'import { readImportedExtraPrompt } from "./imported-prompts.js";\n'
      : "";
  const sameNameSideLoad = options.sameNameSideLoad
    ? `function sideLoad(path: string): string {
  return readFileSync(path, "utf-8");
}

`
    : "";
  const sameNameSideLoadCall = options.sameNameSideLoad
    ? "    sideLoad(SUBAGENT_SYSTEM_TEMPLATE_PATH),\n"
    : "";
  const importedPrompts =
    options.importedHelperRead !== undefined
      ? `import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMPORTED_SYSTEM_DIR = join(__dirname, "../../../system");
const IMPORTED_EXTRA_PATH = join(IMPORTED_SYSTEM_DIR, "${options.importedHelperRead}");
function readImportedRequiredPrompt(path: string): string {
  if (!existsSync(path)) {
    throw new Error(\`Required subagent prompt file missing: \${path}\`);
  }
  const body = String(readFileSync(path, "utf-8") ?? "").trim();
  if (!body) {
    throw new Error(\`Required subagent prompt file is empty: \${path}\`);
  }
  return body;
}

export function readImportedExtraPrompt(): string {
  return readImportedRequiredPrompt(IMPORTED_EXTRA_PATH);
}
`
      : undefined;
  return {
    agentRunner: `import { buildAgentPrompt } from "./prompts.js";\nexport function runAgent(): string {\n  return buildAgentPrompt();\n}\n`,
    prompts: `import { existsSync, readFileSync } from "node:fs";\nimport { dirname, join } from "node:path";\nimport { fileURLToPath } from "node:url";\n${importedHelperImport}\nconst __dirname = dirname(fileURLToPath(import.meta.url));\nconst SYSTEM_DIR = join(__dirname, "../../../system");\nconst SUBAGENT_SYSTEM_TEMPLATE_PATH = join(SYSTEM_DIR, "subagent-system.md");\nconst TOOL_GUIDELINES_PATH = join(SYSTEM_DIR, "tool-guidelines.md");\nconst SKILL_RULES_PATH = join(SYSTEM_DIR, "skill-rules.md");\nconst WORKING_STYLE_PATH = join(SYSTEM_DIR, "working-style.md");\n${extraConst}${sameNameSideLoad}function clean(value: unknown): string {\n  return String(value ?? "").trim();\n}\n\nfunction readRequiredPrompt(path: string): string {\n  if (!existsSync(path)) {\n    throw new Error(\`Required subagent prompt file missing: \${path}\`);\n  }\n  const body = clean(readFileSync(path, "utf-8"));\n  if (!body) {\n    throw new Error(\`Required subagent prompt file is empty: \${path}\`);\n  }\n  return body;\n}\n\nexport function buildAgentPrompt(): string {\n  return [\n    readRequiredPrompt(SUBAGENT_SYSTEM_TEMPLATE_PATH),\n    readRequiredPrompt(TOOL_GUIDELINES_PATH),\n    readRequiredPrompt(SKILL_RULES_PATH),\n    readRequiredPrompt(WORKING_STYLE_PATH),\n${extraRead}${dynamicRead}${importedHelperRead}${sameNameSideLoadCall}  ].join("\\n");\n}\n`,
    ...(importedPrompts !== undefined ? { importedPrompts } : {}),
  };
}

/**
 * Minimal npm lockfile v3 for the synthetic fixture. The default synthetic
 * extension declares zero runtime dependencies (root dependency maps both
 * empty — still lock-proven), so the synthetic legs exercise the stager
 * without any npm invocation.
 */
function syntheticPackageLock(dependencies: Record<string, string>): Record<string, unknown> {
  return {
    name: "@alfie/pi-subagents",
    version: "0.15.0-alfie.4",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "@alfie/pi-subagents",
        version: "0.15.0-alfie.4",
        dependencies,
      },
    },
  };
}

/**
 * Builds a synthetic pinned Alfie-like Git repository for staging tests. The
 * real Alfie checkout is never mutated by this suite — only read by the
 * explicitly opted-in real-checkout tests above.
 */
function createSyntheticAlfieRepo(options: {
  readonly originUrl?: string;
  readonly extraFiles?: ReadonlyArray<string>;
  readonly trackedSymlink?: { readonly relative: string; readonly target: string };
  readonly untrackedFile?: string;
  readonly packageJson?: string;
  readonly dependencies?: Record<string, string>;
  readonly promptShape?: {
    readonly extraLiteralRead?: string;
    readonly dynamicRead?: boolean;
    readonly importedHelperRead?: string;
    readonly sameNameSideLoad?: boolean;
  };
  readonly emptyPromptFile?: string;
  readonly missingPromptFile?: string;
  readonly trackedPromptSymlink?: { readonly relative: string; readonly target: string };
  readonly dirtyPromptFile?: string;
}): SyntheticAlfieRepo {
  const repoDir = join(makeTempRoot("synthetic-alfie-"), "alfie");
  mkdirSync(repoDir, { recursive: true });
  const run = (args: ReadonlyArray<string>): string =>
    execFileSync("git", args as string[], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  run(["init", "--initial-branch=main"]);
  run(["config", "user.email", "staging-test@example.invalid"]);
  run(["config", "user.name", "Staging Test"]);
  run([
    "remote",
    "add",
    "origin",
    options.originUrl ?? "https://github.com/anhphamwork99/alfie.git",
  ]);

  const extensionRoot = "agent/extensions/pi-subagents";
  mkdirSync(join(repoDir, extensionRoot, "src"), { recursive: true });
  const dependencies = options.dependencies ?? {};
  writeFileSync(
    join(repoDir, extensionRoot, "package.json"),
    options.packageJson ??
      JSON.stringify(
        { name: "@alfie/pi-subagents", version: "0.15.0-alfie.4", dependencies },
        null,
        2,
      ),
  );
  // A matching lockfile v3 is always present so closure selection is proven
  // even for the zero-dependency synthetic fixture.
  writeFileSync(
    join(repoDir, extensionRoot, "package-lock.json"),
    JSON.stringify(syntheticPackageLock(dependencies), null, 2),
  );
  writeFileSync(
    join(repoDir, extensionRoot, "src/index.ts"),
    [
      "const PI_SUBAGENTS_PROTOCOL_VERSION = 1;",
      "const PI_SUBAGENT_CAPABILITIES = [",
      ...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES.map((capability) => `  "${capability}",`),
      "] as const;",
      "",
    ].join("\n"),
  );
  // The exact shared runtime modules the stager contract stages.
  mkdirSync(join(repoDir, "agent/extensions/shared"), { recursive: true });
  for (const basename of SYNTHETIC_SHARED_MODULES) {
    writeFileSync(
      join(repoDir, "agent/extensions/shared", `${basename}.js`),
      `export const x = "${basename}";\n`,
    );
    writeFileSync(
      join(repoDir, "agent/extensions/shared", `${basename}.d.ts`),
      `export declare const x: string;\n`,
    );
  }
  // Ticket 01c: the derivation-walked prompt modules + the agent/system
  // content, exactly the pinned shape the mechanical closure resolves.
  const promptModules = syntheticPromptModules({
    ...(options.promptShape?.extraLiteralRead !== undefined
      ? { extraLiteralRead: options.promptShape.extraLiteralRead }
      : {}),
    ...(options.promptShape?.dynamicRead !== undefined
      ? { dynamicRead: options.promptShape.dynamicRead }
      : {}),
    ...(options.promptShape?.importedHelperRead !== undefined
      ? { importedHelperRead: options.promptShape.importedHelperRead }
      : {}),
    ...(options.promptShape?.sameNameSideLoad !== undefined
      ? { sameNameSideLoad: options.promptShape.sameNameSideLoad }
      : {}),
  });
  writeFileSync(join(repoDir, extensionRoot, "src/agent-runner.ts"), promptModules.agentRunner);
  writeFileSync(join(repoDir, extensionRoot, "src/prompts.ts"), promptModules.prompts);
  if (promptModules.importedPrompts !== undefined) {
    writeFileSync(
      join(repoDir, extensionRoot, "src/imported-prompts.ts"),
      promptModules.importedPrompts,
    );
  }
  mkdirSync(join(repoDir, "agent/system"), { recursive: true });
  const extraPromptReads = [
    options.promptShape?.extraLiteralRead,
    options.promptShape?.importedHelperRead,
  ].filter((name): name is string => name !== undefined);
  const promptFiles = [
    ...SYNTHETIC_PROMPT_FILES,
    ...extraPromptReads.map((name) => `agent/system/${name}`),
  ];
  for (const relative of promptFiles) {
    if (options.missingPromptFile === relative) continue;
    if (options.trackedPromptSymlink?.relative === relative) continue;
    const target = join(repoDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, options.emptyPromptFile === relative ? "" : `content-of:${relative}\n`);
  }
  for (const extra of options.extraFiles ?? []) {
    const fullPath = join(repoDir, extra);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, `content-of:${extra}\n`);
  }
  if (options.trackedSymlink) {
    const linkPath = join(repoDir, options.trackedSymlink.relative);
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(options.trackedSymlink.target, linkPath);
  }
  if (options.trackedPromptSymlink) {
    const linkPath = join(repoDir, options.trackedPromptSymlink.relative);
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(options.trackedPromptSymlink.target, linkPath);
  }

  run(["add", "."]);
  run(["commit", "-m", "synthetic pinned extension"]);

  if (options.untrackedFile) {
    const fullPath = join(repoDir, options.untrackedFile);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "uncommitted bytes\n");
  }
  if (options.dirtyPromptFile) {
    writeFileSync(join(repoDir, options.dirtyPromptFile), "tampered prompt bytes\n");
  }

  return { repoDir, provenance: syntheticProvenanceFor(repoDir, extensionRoot) };
}

function syntheticProvenanceFor(repoDir: string, extensionRoot: string): SyntheticProvenance {
  return {
    expectedRepositoryUrl: "https://github.com/anhphamwork99/alfie.git",
    pinnedCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
    }).trim(),
    packageName: "@alfie/pi-subagents",
    packageVersion: "0.15.0-alfie.4",
    extensionEntryRelativePath: `${extensionRoot}/src/index.ts`,
    packageManifestRelativePath: `${extensionRoot}/package.json`,
    hashes: {
      [`${extensionRoot}/package.json`]: sha256(
        readFileSync(join(repoDir, extensionRoot, "package.json")),
      ),
      [`${extensionRoot}/src/index.ts`]: sha256(
        readFileSync(join(repoDir, extensionRoot, "src/index.ts")),
      ),
    },
  };
}

describe("pi-subagents artifact staging (Ticket 01b)", () => {
  describe.skipIf(!REAL_ALFIE_REPO_DIR || !existsSync(REAL_ALFIE_REPO_DIR))(
    "real pinned Alfie checkout (AC1, AC2, AC5)",
    () => {
      it(
        "stages the self-contained closure with an exact contract-valid manifest (AC1)",
        { timeout: 120_000 },
        () => {
          const provenance = loadRealProvenance();
          const artifactDir = join(makeTempRoot("pi-artifact-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);

          const first = buildPiSubagentArtifact({
            repoDir: REAL_ALFIE_REPO_DIR,
            artifactDir,
            provenance,
          });
          expect(first.fileCount).toBeGreaterThan(0);

          // T01b-AC1: the staged manifest decodes against the WP1a contract.
          const manifest = Schema.decodeSync(PiSubagentArtifactManifest)(
            JSON.parse(readFileSync(first.manifestPath, "utf8")),
          );
          expect(manifest.schemaVersion).toBe(1);
          expect(manifest.sourceIdentity).toEqual({
            repositoryUrl: provenance.expectedRepositoryUrl,
            pinnedCommit: provenance.pinnedCommit,
            packageName: provenance.packageName,
            packageVersion: provenance.packageVersion,
          });

          // T01b-AC1: capability profile — declared superset of the required set.
          const declared = new Set(manifest.capabilityProfile.capabilities);
          for (const required of PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES) {
            expect(declared.has(required)).toBe(true);
          }
          expect(manifest.capabilityProfile.protocolVersion).toBe(1);

          // T01b-AC1: every staged regular file matches exactly one manifest
          // record (path, size, SHA-256) and vice versa; no symlink remains.
          const entries = walkEntries(artifactDir);
          expect(entries.some((entry) => entry.symlink)).toBe(false);
          const stagedFiles = entries
            .map((entry) => entry.relative)
            .filter((relative) => relative !== PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME);
          const recordsByPath = new Map(manifest.files.map((record) => [record.path, record]));
          expect(stagedFiles.length).toBe(recordsByPath.size);
          for (const relative of stagedFiles) {
            const record = recordsByPath.get(relative);
            expect(record, `missing manifest record for ${relative}`).toBeDefined();
            const bytes = readFileSync(join(artifactDir, relative));
            expect(bytes.length).toBe(record!.sizeBytes);
            expect(sha256(bytes)).toBe(record!.sha256);
          }

          // T01b-AC1: the necessary shared runtime modules the extension
          // imports are staged (exactly these — no unrelated shared content).
          for (const basename of SYNTHETIC_SHARED_MODULES) {
            for (const suffix of [".js", ".d.ts"]) {
              expect(stagedFiles).toContain(`agent/extensions/shared/${basename}${suffix}`);
            }
          }
          expect(
            stagedFiles.filter((relative) => relative.startsWith("agent/extensions/shared/"))
              .length,
          ).toBe(SYNTHETIC_SHARED_MODULES.length * 2);

          // T01b-AC1: the lock-proven direct runtime dependency closure is
          // staged under the artifact root `node_modules` — exactly the four
          // locked packages, at their exact locked versions.
          const dependencyRoots = readdirSync(join(artifactDir, "node_modules"), {
            withFileTypes: true,
          })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
          expect(dependencyRoots).toContain("@sinclair");
          expect(dependencyRoots.toSorted()).toEqual(["@sinclair", "croner", "nanoid", "yaml"]);
          const expectedLockedVersions: Record<string, string> = {
            "@sinclair/typebox": "0.34.49",
            croner: "10.0.1",
            nanoid: "5.1.11",
            yaml: "2.9.0",
          };
          for (const [name, version] of Object.entries(expectedLockedVersions)) {
            const installed = JSON.parse(
              readFileSync(join(artifactDir, "node_modules", name, "package.json"), "utf8"),
            );
            expect(installed.version, `${name} must be the exact locked version`).toBe(version);
          }
          // No dev/optional lock content, no `.bin` shims, no peer/host-SDK
          // packages, and no nested `node_modules` inside the staged closure.
          expect(
            stagedFiles.some((relative) => relative.includes("/node_modules/node_modules/")),
          ).toBe(false);
          expect(stagedFiles.some((relative) => relative.split("/").includes(".bin"))).toBe(false);
          expect(
            stagedFiles.some((relative) => relative.startsWith("node_modules/@earendil-works/")),
          ).toBe(false);
          expect(
            stagedFiles.some((relative) => relative.startsWith("node_modules/typescript")),
          ).toBe(false);

          // T01b-AC5: no authentication, model configuration, key material, or
          // credentials inside the staged artifact.
          for (const relative of stagedFiles) {
            const basename = relative.split("/").pop() ?? "";
            expect(["auth.json", "models.json", "credentials.json"]).not.toContain(basename);
            expect([".pem", ".key", ".p8", ".pfx"]).not.toContain(
              basename.slice(basename.lastIndexOf(".")),
            );
          }

          expect(stagedFiles).toContain("agent/extensions/pi-subagents/src/index.ts");
          expect(stagedFiles).toContain("agent/extensions/pi-subagents/package.json");
          // Only release runtime material is staged: the extension's own test
          // subtree never enters the artifact.
          expect(stagedFiles.some((relative) => relative.includes("/test/"))).toBe(false);

          // T01b-AC2: determinism — identical pinned input reproduces identical
          // manifest bytes (closure content included: same lock, same bytes).
          const secondDir = join(makeTempRoot("pi-artifact-2-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);
          const second = buildPiSubagentArtifact({
            repoDir: REAL_ALFIE_REPO_DIR,
            artifactDir: secondDir,
            provenance,
          });
          expect(readFileSync(second.manifestPath, "utf8")).toBe(
            readFileSync(first.manifestPath, "utf8"),
          );
        },
      );

      it("verifies the real checkout provenance without mutating it", () => {
        const provenance = loadRealProvenance();
        const verified = verifyAlfieExtensionProvenance({
          repoDir: REAL_ALFIE_REPO_DIR,
          provenance,
        });
        expect(verified.commit).toBe(provenance.pinnedCommit);
        expect(verified.packageName).toBe(provenance.packageName);
      });
    },
  );

  describe("bounded build failures (fail-close before output is accepted)", () => {
    it("rejects a source whose origin does not match the pin", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        originUrl: "https://github.com/someone-else/other.git",
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("out-"), "artifact"),
          provenance,
        }),
      ).toThrow(/origin does not match/i);
    });

    it("rejects a HEAD outside the pinned commit", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({});
      const lastChar = provenance.pinnedCommit.slice(-1);
      const wrongLastChar = lastChar === "0" ? "1" : "0";
      const wrongCommit = `${provenance.pinnedCommit.slice(0, 39)}${wrongLastChar}`;
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("out-"), "artifact"),
          provenance: { ...provenance, pinnedCommit: wrongCommit },
        }),
      ).toThrow(/does not match the pinned commit/i);
    });

    it("rejects an unclean extension tree", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        untrackedFile: "agent/extensions/pi-subagents/src/dirty.ts",
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("out-"), "artifact"),
          provenance,
        }),
      ).toThrow(/uncommitted changes/i);
    });

    it("rejects a tracked escaping symlink", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        trackedSymlink: {
          relative: "agent/extensions/pi-subagents/src/escape.ts",
          target: "../../../../../etc/hostname",
        },
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("out-"), "artifact"),
          provenance,
        }),
      ).toThrow(/symbolic link/i);
    });

    it("rejects prohibited authentication/model/key payload", () => {
      for (const prohibited of ["auth.json", "models.json", "server.pem", "signing.key"]) {
        const { repoDir, provenance } = createSyntheticAlfieRepo({
          extraFiles: [`agent/extensions/pi-subagents/${prohibited}`],
        });
        expect(() =>
          buildPiSubagentArtifact({
            repoDir,
            artifactDir: join(makeTempRoot("out-"), "artifact"),
            provenance,
          }),
        ).toThrow(/prohibited/i);
      }
    });

    it("rejects a package identity that does not match the pin", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        packageJson: JSON.stringify({ name: "@other/extension", version: "0.15.0-alfie.4" }),
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("out-"), "artifact"),
          provenance,
        }),
      ).toThrow(/name\/version does not match/i);
    });

    it("rejects pinned bytes whose SHA-256 does not match the fixture", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({});
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("out-"), "artifact"),
          provenance: {
            ...provenance,
            hashes: {
              ...provenance.hashes,
              "agent/extensions/pi-subagents/src/index.ts": "0".repeat(64),
            },
          },
        }),
      ).toThrow(/SHA-256/i);
    });

    it("stages a synthetic clean pinned repo (zero runtime deps → no node_modules)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        extraFiles: ["agent/extensions/pi-subagents/dist/index.js"],
      });
      const artifactDir = join(makeTempRoot("out-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);
      const staged = buildPiSubagentArtifact({ repoDir, artifactDir, provenance });
      const expectedFiles = [
        "agent/extensions/pi-subagents/dist/index.js",
        "agent/extensions/pi-subagents/package-lock.json",
        "agent/extensions/pi-subagents/package.json",
        "agent/extensions/pi-subagents/src/agent-runner.ts",
        "agent/extensions/pi-subagents/src/index.ts",
        "agent/extensions/pi-subagents/src/prompts.ts",
        ...SYNTHETIC_PROMPT_FILES,
        ...SYNTHETIC_SHARED_MODULES.flatMap((basename) => [
          `agent/extensions/shared/${basename}.js`,
          `agent/extensions/shared/${basename}.d.ts`,
        ]),
      ].toSorted();
      expect(staged.fileCount).toBe(expectedFiles.length);
      const stagedFiles = walkEntries(artifactDir)
        .map((entry) => entry.relative)
        .filter((relative) => relative !== PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME);
      expect(stagedFiles).toEqual(expectedFiles);
      // A zero-runtime-dependency extension stages no node_modules at all.
      expect(existsSync(join(artifactDir, "node_modules"))).toBe(false);
      expect(existsSync(join(artifactDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME))).toBe(true);
    });

    it("preserves a preexisting destination when staging fails (no partial artifact)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        // Prohibited payload guarantees a failure AFTER assembly begins.
        extraFiles: ["agent/extensions/pi-subagents/models.json"],
      });
      const parentDir = makeTempRoot("preserve-");
      const artifactDir = join(parentDir, PI_SUBAGENT_ARTIFACT_DIR_NAME);
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, "preexisting-sentinel.txt"), "previous accepted artifact\n");

      expect(() => buildPiSubagentArtifact({ repoDir, artifactDir, provenance })).toThrow(
        /prohibited/i,
      );

      // The preexisting destination is untouched and no staging sibling
      // residue remains next to it.
      expect(readFileSync(join(artifactDir, "preexisting-sentinel.txt"), "utf8")).toBe(
        "previous accepted artifact\n",
      );
      expect(existsSync(join(artifactDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME))).toBe(false);
      const siblings = readdirSync(parentDir).filter((entry) =>
        entry.startsWith("pi-subagents-artifact"),
      );
      expect(siblings).toEqual([PI_SUBAGENT_ARTIFACT_DIR_NAME]);
    });

    it("replaces a preexisting destination only after a fully successful staging", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({});
      const parentDir = makeTempRoot("replace-");
      const artifactDir = join(parentDir, PI_SUBAGENT_ARTIFACT_DIR_NAME);
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, "stale-content.txt"), "stale\n");

      buildPiSubagentArtifact({ repoDir, artifactDir, provenance });

      expect(existsSync(join(artifactDir, "stale-content.txt"))).toBe(false);
      expect(existsSync(join(artifactDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME))).toBe(true);
      const siblings = readdirSync(parentDir).filter((entry) =>
        entry.startsWith("pi-subagents-artifact"),
      );
      expect(siblings).toEqual([PI_SUBAGENT_ARTIFACT_DIR_NAME]);
    });
  });

  describe("prompt-closure staging (Ticket 01c, Decision 0010)", () => {
    describe.skipIf(!REAL_ALFIE_REPO_DIR || !existsSync(REAL_ALFIE_REPO_DIR))(
      "real pinned Alfie checkout",
      () => {
        it(
          "stages exactly the four mechanically derived agent/system entries with manifest-exact size and digest (AC1/AC3)",
          { timeout: 120_000 },
          () => {
            const provenance = loadRealProvenance();
            const artifactDir = join(makeTempRoot("pi-t01c-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);
            const staged = buildPiSubagentArtifact({
              repoDir: REAL_ALFIE_REPO_DIR,
              artifactDir,
              provenance,
            });
            const manifest = JSON.parse(readFileSync(staged.manifestPath, "utf8")) as {
              readonly files: ReadonlyArray<{
                readonly path: string;
                readonly sizeBytes: number;
                readonly sha256: string;
              }>;
            };
            const systemEntries = manifest.files
              .map((record) => record.path)
              .filter((path) => path.startsWith("agent/system/"))
              .toSorted();
            expect(systemEntries).toEqual(SYNTHETIC_PROMPT_FILES);
            for (const record of manifest.files.filter((r) => r.path.startsWith("agent/system/"))) {
              const stagedBytes = readFileSync(join(artifactDir, record.path));
              expect(stagedBytes.length).toBe(record.sizeBytes);
              expect(sha256(stagedBytes)).toBe(record.sha256);
              // The bytes are the exact clean pinned checkout's bytes.
              expect(sha256(readFileSync(join(REAL_ALFIE_REPO_DIR, record.path)))).toBe(
                record.sha256,
              );
              expect(stagedBytes.length).toBeGreaterThan(0);
              expect(lstatSync(join(artifactDir, record.path)).isSymbolicLink()).toBe(false);
            }

            // Repeat staging is deterministic including the derived prompt entries.
            const secondDir = join(makeTempRoot("pi-t01c-2-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);
            const second = buildPiSubagentArtifact({
              repoDir: REAL_ALFIE_REPO_DIR,
              artifactDir: secondDir,
              provenance,
            });
            expect(readFileSync(second.manifestPath, "utf8")).toBe(
              readFileSync(staged.manifestPath, "utf8"),
            );
          },
        );
      },
    );

    it("synthetic: a FIFTH static literal required read is staged automatically (AC1 negative fixture)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        promptShape: { extraLiteralRead: "orchestration-rules.md" },
      });
      const artifactDir = join(makeTempRoot("t01c-fifth-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);
      const staged = buildPiSubagentArtifact({ repoDir, artifactDir, provenance });
      const manifest = JSON.parse(readFileSync(staged.manifestPath, "utf8")) as {
        readonly files: ReadonlyArray<{ readonly path: string }>;
      };
      const systemEntries = manifest.files
        .map((record) => record.path)
        .filter((path) => path.startsWith("agent/system/"))
        .toSorted();
      expect(systemEntries).toEqual(
        [...SYNTHETIC_PROMPT_FILES, "agent/system/orchestration-rules.md"].toSorted(),
      );
    });

    it("synthetic P1 regression: a FIFTH literal required read inside an IMPORTED helper module is staged automatically", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        promptShape: { importedHelperRead: "orchestration-rules.md" },
      });
      const artifactDir = join(makeTempRoot("t01c-imp-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);
      const staged = buildPiSubagentArtifact({ repoDir, artifactDir, provenance });
      const manifest = JSON.parse(readFileSync(staged.manifestPath, "utf8")) as {
        readonly files: ReadonlyArray<{ readonly path: string }>;
      };
      const systemEntries = manifest.files
        .map((record) => record.path)
        .filter((path) => path.startsWith("agent/system/"))
        .toSorted();
      expect(systemEntries).toEqual(
        [...SYNTHETIC_PROMPT_FILES, "agent/system/orchestration-rules.md"].toSorted(),
      );
      // The imported helper module itself is part of the tracked extension
      // tree and therefore staged with the artifact.
      expect(manifest.files.map((record) => record.path)).toContain(
        "agent/extensions/pi-subagents/src/imported-prompts.ts",
      );
    });

    it("synthetic P1 regression: a same-NAME parameter raw readFileSync in the prompt module fails staging (never silently staged four)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        promptShape: { sameNameSideLoad: true },
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("t01c-sideload-"), "artifact"),
          provenance,
        }),
      ).toThrow(
        /prompt-closure derivation failed \(prompt_closure_unsupported\).*outside the recognized required-prompt reader shape/,
      );
    });

    it("synthetic: a dynamic required prompt read fails staging (AC2)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        promptShape: { dynamicRead: true },
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("t01c-dyn-"), "artifact"),
          provenance,
        }),
      ).toThrow(/prompt-closure derivation failed \(prompt_closure_unsupported\)/);
    });

    it("synthetic: an untracked derived prompt input fails staging (AC2)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        untrackedFile: "agent/system/subagent-system.md",
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("t01c-untracked-"), "artifact"),
          provenance,
        }),
      ).toThrow(/uncommitted changes|not tracked/i);
    });

    it("synthetic: dirty derived prompt input fails staging (AC2)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        dirtyPromptFile: "agent/system/working-style.md",
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("t01c-dirty-"), "artifact"),
          provenance,
        }),
      ).toThrow(/uncommitted changes/i);
    });

    it("synthetic: a derived prompt input absent from the pinned tree fails staging (AC2)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        missingPromptFile: "agent/system/skill-rules.md",
      });
      // A required prompt file the pinned commit never carries is refused
      // before staging (the untracked/missing bounded categories overlap —
      // either way the build fails closed, never silently omitting content).
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("t01c-missing-"), "artifact"),
          provenance,
        }),
      ).toThrow(
        /not tracked by the pinned commit|missing from the managed pi-subagents (source )?tree|is missing/i,
      );
    });

    it("synthetic: an empty derived prompt input fails staging (AC2)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        emptyPromptFile: "agent/system/tool-guidelines.md",
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("t01c-empty-"), "artifact"),
          provenance,
        }),
      ).toThrow(/empty; required prompt content must be non-empty/i);
    });

    it("synthetic: a symlinked derived prompt input fails staging (AC2)", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        trackedPromptSymlink: {
          relative: "agent/system/subagent-system.md",
          target: "../../elsewhere/subagent-system.md",
        },
      });
      expect(() =>
        buildPiSubagentArtifact({
          repoDir,
          artifactDir: join(makeTempRoot("t01c-symlink-"), "artifact"),
          provenance,
        }),
      ).toThrow(/symbolic link/i);
    });
  });
});
