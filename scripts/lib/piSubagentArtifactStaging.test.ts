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
    join(
      process.cwd(),
      "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json",
    ),
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

/**
 * Builds a synthetic pinned Alfie-like Git repository for failure-surface
 * tests. The real Alfie checkout is never mutated by this suite — only read
 * by the explicitly opted-in real-checkout tests above.
 */
function createSyntheticAlfieRepo(options: {
  readonly originUrl?: string;
  readonly extraFiles?: ReadonlyArray<string>;
  readonly trackedSymlink?: { readonly relative: string; readonly target: string };
  readonly untrackedFile?: string;
  readonly packageJson?: string;
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
  writeFileSync(
    join(repoDir, extensionRoot, "package.json"),
    options.packageJson ??
      JSON.stringify({ name: "@alfie/pi-subagents", version: "0.15.0-alfie.4" }),
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

describe("pi-subagents artifact staging (Ticket 01 WP1b)", () => {
  describe.skipIf(!REAL_ALFIE_REPO_DIR || !existsSync(REAL_ALFIE_REPO_DIR))(
    "real pinned Alfie checkout (AC1, AC4)",
    () => {
      it("stages a deterministic verified artifact with an exact contract-valid manifest", () => {
        const provenance = loadRealProvenance();
        const artifactDir = join(makeTempRoot("pi-artifact-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);

        const first = buildPiSubagentArtifact({
          repoDir: REAL_ALFIE_REPO_DIR,
          artifactDir,
          provenance,
        });
        expect(first.fileCount).toBeGreaterThan(0);

        // T01-AC1: the staged manifest decodes against the WP1a contract.
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

        // T01-AC1: capability profile — declared superset of the required set.
        const declared = new Set(manifest.capabilityProfile.capabilities);
        for (const required of PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES) {
          expect(declared.has(required)).toBe(true);
        }
        expect([...manifest.capabilityProfile.requiredCapabilities]).toEqual([
          ...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
        ]);
        expect(manifest.capabilityProfile.protocolVersion).toBe(1);

        // T01-AC1: every staged regular file matches exactly one manifest
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

        // T01-AC4: no authentication, model configuration, key material, or
        // dependency-tree content is staged.
        for (const relative of stagedFiles) {
          const basename = relative.split("/").pop() ?? "";
          expect(["auth.json", "models.json", "credentials.json"]).not.toContain(basename);
          expect([".pem", ".key", ".p8", ".pfx"]).not.toContain(
            basename.slice(basename.lastIndexOf(".")),
          );
          expect(relative.split("/")).not.toContain("node_modules");
        }
        expect(stagedFiles).toContain("agent/extensions/pi-subagents/src/index.ts");
        expect(stagedFiles).toContain("agent/extensions/pi-subagents/package.json");
        // Only release runtime material is staged: the extension's own test
        // subtree and dependency tree never enter the artifact.
        expect(stagedFiles.some((relative) => relative.includes("/test/"))).toBe(false);

        // T01-AC1: determinism — identical pinned input reproduces identical
        // manifest bytes.
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

    it("stages a synthetic clean pinned repo successfully", () => {
      const { repoDir, provenance } = createSyntheticAlfieRepo({
        extraFiles: ["agent/extensions/pi-subagents/dist/index.js"],
      });
      const artifactDir = join(makeTempRoot("out-"), PI_SUBAGENT_ARTIFACT_DIR_NAME);
      const staged = buildPiSubagentArtifact({ repoDir, artifactDir, provenance });
      expect(staged.fileCount).toBe(3);
      const stagedFiles = walkEntries(artifactDir)
        .map((entry) => entry.relative)
        .filter((relative) => relative !== PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME);
      expect(stagedFiles).toEqual(
        [
          "agent/extensions/pi-subagents/dist/index.js",
          "agent/extensions/pi-subagents/package.json",
          "agent/extensions/pi-subagents/src/index.ts",
        ].sort(),
      );
      expect(existsSync(join(artifactDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME))).toBe(true);
    });
  });
});
