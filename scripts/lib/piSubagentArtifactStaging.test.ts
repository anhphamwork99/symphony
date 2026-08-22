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

import { PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES, PiSubagentArtifactManifest } from "@synara/contracts";

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
  for (const entry of readdirSync(rootDir).sort()) {
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
const SYNTHETIC_SHARED_MODULES = ["durable-preferences", "execution-identity", "model-catalog-reconciler"];

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
  run(["remote", "add", "origin", options.originUrl ?? "https://github.com/anhphamwork99/alfie.git"]);

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
    writeFileSync(join(repoDir, "agent/extensions/shared", `${basename}.js`), `export const x = "${basename}";\n`);
    writeFileSync(join(repoDir, "agent/extensions/shared", `${basename}.d.ts`), `export declare const x: string;\n`);
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

  run(["add", "."]);
  run(["commit", "-m", "synthetic pinned extension"]);

  if (options.untrackedFile) {
    const fullPath = join(repoDir, options.untrackedFile);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "uncommitted bytes\n");
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
          stagedFiles.filter((relative) => relative.startsWith("agent/extensions/shared/")).length,
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
        expect(dependencyRoots.sort()).toEqual(["@sinclair", "croner", "nanoid", "yaml"]);
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
        expect(stagedFiles.some((relative) => relative.includes("/node_modules/node_modules/"))).toBe(false);
        expect(stagedFiles.some((relative) => relative.split("/").includes(".bin"))).toBe(false);
        expect(stagedFiles.some((relative) => relative.startsWith("node_modules/@earendil-works/"))).toBe(
          false,
        );
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
      });

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
        "agent/extensions/pi-subagents/src/index.ts",
        ...SYNTHETIC_SHARED_MODULES.flatMap((basename) => [
          `agent/extensions/shared/${basename}.js`,
          `agent/extensions/shared/${basename}.d.ts`,
        ]),
      ].sort();
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

      expect(() =>
        buildPiSubagentArtifact({ repoDir, artifactDir, provenance }),
      ).toThrow(/prohibited/i);

      // The preexisting destination is untouched and no staging sibling
      // residue remains next to it.
      expect(readFileSync(join(artifactDir, "preexisting-sentinel.txt"), "utf8")).toBe(
        "previous accepted artifact\n",
      );
      expect(existsSync(join(artifactDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME))).toBe(false);
      const siblings = readdirSync(parentDir).filter((entry) => entry.startsWith("pi-subagents-artifact"));
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
      const siblings = readdirSync(parentDir).filter((entry) => entry.startsWith("pi-subagents-artifact"));
      expect(siblings).toEqual([PI_SUBAGENT_ARTIFACT_DIR_NAME]);
    });
  });
});
