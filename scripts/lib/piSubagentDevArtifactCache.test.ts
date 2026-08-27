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
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES } from "@synara/contracts";

import { verifyPiSubagentArtifact } from "../../apps/server/src/provider/piSubagentArtifactVerifier.ts";
import {
  buildPiSubagentArtifact,
  PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME,
} from "./piSubagentArtifactStaging.ts";
import {
  PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME,
  PiSubagentDevArtifactCacheError,
  loadDevArtifactPin,
  piSubagentDevArtifactCacheEntryDir,
  preparePiSubagentDevArtifact,
  withPinLock,
  type PiSubagentDevArtifactCacheFs,
} from "./piSubagentDevArtifactCache.ts";

/**
 * Dev-runtime cache tests for the controlled web/dev Pi artifact path
 * (Ticket: local web/dev controlled pinned artifact).
 *
 * The cache helper reuses the release stager + production verifier, so these
 * tests prove only the CACHE layer semantics on top:
 *  - miss (absent entry) → stages from the pinned synthetic source + verifies;
 *  - hit (verified entry) → returned as-is with `staged: false`;
 *  - invalid/tampered entry → quarantined + restaged;
 *  - wrong-pin content at the entry location → quarantined + restaged;
 *  - symlinked entry → the link itself is removed (never its target) and
 *    restaged;
 *  - staging failure (unclean pinned source) → fails closed with the closed
 *    error code and the bad entry is NOT left behind;
 *  - concurrency: parallel preparations of one pin serialize — exactly one
 *    stages, the rest observe the verified hit;
 *  - cleanup: the lock file is removed after preparation;
 *  - no post-mutation: a verified hit's bytes are never rewritten;
 *  - provenance pin comes only from the repository fixture;
 *  - cache location is exactly `<synaraHome>/dev-pi-subagent-artifacts/<pin>`
 *    and rejects a non-SHA pin.
 *
 * The synthetic Alfie-like repository pattern mirrors
 * `piSubagentArtifactStaging.test.ts` so no real checkout is required.
 */

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

/** Shared runtime modules the pinned extension imports (stager contract). */
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

const SYNTHETIC_ENTRY_SOURCE = [
  "const PI_SUBAGENTS_PROTOCOL_VERSION = 1;",
  "const PI_SUBAGENT_CAPABILITIES = [",
  ...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES.map((capability) => `  "${capability}",`),
  "] as const;",
  "",
].join("\n");

const SYNTHETIC_PROMPTS_TS = `import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_DIR = join(__dirname, "../../../system");
const SUBAGENT_SYSTEM_TEMPLATE_PATH = join(SYSTEM_DIR, "subagent-system.md");
const TOOL_GUIDELINES_PATH = join(SYSTEM_DIR, "tool-guidelines.md");
const SKILL_RULES_PATH = join(SYSTEM_DIR, "skill-rules.md");
const WORKING_STYLE_PATH = join(SYSTEM_DIR, "working-style.md");
function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function readRequiredPrompt(path: string): string {
  if (!existsSync(path)) {
    throw new Error(\`Required subagent prompt file missing: \${path}\`);
  }
  const body = clean(readFileSync(path, "utf-8"));
  if (!body) {
    throw new Error(\`Required subagent prompt file is empty: \${path}\`);
  }
  return body;
}

export function buildAgentPrompt(): string {
  return [
    readRequiredPrompt(SUBAGENT_SYSTEM_TEMPLATE_PATH),
    readRequiredPrompt(TOOL_GUIDELINES_PATH),
    readRequiredPrompt(SKILL_RULES_PATH),
    readRequiredPrompt(WORKING_STYLE_PATH),
  ].join("\\n");
}
`;

const SYNTHETIC_AGENT_RUNNER_TS = `import { buildAgentPrompt } from "./prompts.js";
export function runAgent(): string {
  return buildAgentPrompt();
}
`;

function syntheticPackageLock(): Record<string, unknown> {
  return {
    name: "@alfie/pi-subagents",
    version: "0.15.0-alfie.4",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "@alfie/pi-subagents",
        version: "0.15.0-alfie.4",
        dependencies: {},
      },
    },
  };
}

interface SyntheticAlfieRepo {
  readonly repoDir: string;
  readonly pinnedCommit: string;
}

/**
 * Minimal synthetic pinned Alfie-like repository (same shape as the staging
 * suite's fixture): a Git repo at the pinned commit whose extension subtree
 * the release stager proves clean before staging.
 */
function createSyntheticAlfieRepo(): SyntheticAlfieRepo {
  const repoDir = join(makeTempRoot("dev-cache-alfie-"), "alfie");
  mkdirSync(repoDir, { recursive: true });
  const run = (args: ReadonlyArray<string>): string =>
    execFileSync("git", args as string[], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  run(["init", "--initial-branch=main"]);
  run(["config", "user.email", "dev-cache-test@example.invalid"]);
  run(["config", "user.name", "Dev Cache Test"]);
  run(["remote", "add", "origin", "https://github.com/anhphamwork99/alfie.git"]);

  const extensionRoot = "agent/extensions/pi-subagents";
  mkdirSync(join(repoDir, extensionRoot, "src"), { recursive: true });
  writeFileSync(
    join(repoDir, extensionRoot, "package.json"),
    JSON.stringify(
      { name: "@alfie/pi-subagents", version: "0.15.0-alfie.4", dependencies: {} },
      null,
      2,
    ),
  );
  writeFileSync(
    join(repoDir, extensionRoot, "package-lock.json"),
    JSON.stringify(syntheticPackageLock(), null, 2),
  );
  writeFileSync(join(repoDir, extensionRoot, "src/index.ts"), SYNTHETIC_ENTRY_SOURCE);
  writeFileSync(join(repoDir, extensionRoot, "src/agent-runner.ts"), SYNTHETIC_AGENT_RUNNER_TS);
  writeFileSync(join(repoDir, extensionRoot, "src/prompts.ts"), SYNTHETIC_PROMPTS_TS);

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
  mkdirSync(join(repoDir, "agent/system"), { recursive: true });
  for (const relative of SYNTHETIC_PROMPT_FILES) {
    writeFileSync(join(repoDir, relative), `content-of:${relative}\n`);
  }

  run(["add", "."]);
  run(["commit", "-m", "synthetic pinned extension for the dev cache"]);
  return { repoDir, pinnedCommit: run(["rev-parse", "HEAD"]).trim() };
}

/**
 * Builds the repository pin fixture directory for one synthetic repo. The
 * cache helper reads the pin ONLY from this fixture path under `repoRoot`
 * (`loadDevArtifactPin`), so the synthetic fixture never touches the real
 * repository pin.
 */
function createSyntheticRepoRootFixture(source: SyntheticAlfieRepo): string {
  const repoRoot = makeTempRoot("dev-cache-repo-root-");
  const fixtureDir = join(repoRoot, "apps/server/src/provider/test-fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  const extensionRoot = "agent/extensions/pi-subagents";
  writeFileSync(
    join(fixtureDir, "piSubagentExtensionProvenance.json"),
    JSON.stringify(
      {
        expectedRepositoryUrl: "https://github.com/anhphamwork99/alfie.git",
        pinnedCommit: source.pinnedCommit,
        packageName: "@alfie/pi-subagents",
        packageVersion: "0.15.0-alfie.4",
        extensionEntryRelativePath: `${extensionRoot}/src/index.ts`,
        packageManifestRelativePath: `${extensionRoot}/package.json`,
        hashes: {
          [`${extensionRoot}/package.json`]: sha256(
            readFileSync(join(source.repoDir, extensionRoot, "package.json")),
          ),
          [`${extensionRoot}/src/index.ts`]: sha256(
            readFileSync(join(source.repoDir, extensionRoot, "src/index.ts")),
          ),
        },
      },
      null,
      2,
    ),
  );
  return repoRoot;
}

/** Full dev-cache test environment: synthetic source + repo fixture + synara home. */
interface DevCacheEnvironment {
  readonly repoRoot: string;
  readonly synaraHome: string;
  readonly alfieRepoDir: string;
  readonly pinnedCommit: string;
}

function createDevCacheEnvironment(): DevCacheEnvironment {
  const source = createSyntheticAlfieRepo();
  const repoRoot = createSyntheticRepoRootFixture(source);
  const synaraHome = join(makeTempRoot("dev-cache-home-"), ".synara");
  mkdirSync(synaraHome, { recursive: true });
  return {
    repoRoot,
    synaraHome,
    alfieRepoDir: source.repoDir,
    pinnedCommit: source.pinnedCommit,
  };
}

const prepareIn = (environment: DevCacheEnvironment) =>
  preparePiSubagentDevArtifact({
    repoRoot: environment.repoRoot,
    synaraHome: environment.synaraHome,
    env: { ALFIE_REPO_DIR: environment.alfieRepoDir },
  });

const expectedEntryDir = (environment: DevCacheEnvironment): string =>
  join(
    environment.synaraHome,
    PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME,
    environment.pinnedCommit.toLowerCase(),
  );

const expectCacheError = async (
  promise: Promise<unknown>,
  code: string,
): Promise<PiSubagentDevArtifactCacheError> => {
  const error = await promise.then(
    () => {
      throw new Error("expected preparePiSubagentDevArtifact to reject");
    },
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(PiSubagentDevArtifactCacheError);
  const cacheError = error as PiSubagentDevArtifactCacheError;
  expect(cacheError.code).toBe(code);
  return cacheError;
};

describe("piSubagentDevArtifactCacheEntryDir", () => {
  it("derives <synaraHome>/dev-pi-subagent-artifacts/<lowercased pin>", () => {
    expect(
      piSubagentDevArtifactCacheEntryDir({
        synaraHome: "/tmp/synara-home",
        pinnedCommit: "AA6FA4A8540644D2509B10D6DF854486DDC67D1D",
      }),
    ).toBe(
      join(
        "/tmp/synara-home",
        PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME,
        "aa6fa4a8540644d2509b10d6df854486ddc67d1d",
      ),
    );
  });

  it.for(["not-a-sha", "", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "../escape"] as const)(
    "rejects a non-SHA pin '%s' with cache_location_invalid",
    (pin) => {
      expect(() =>
        piSubagentDevArtifactCacheEntryDir({ synaraHome: "/tmp/synara-home", pinnedCommit: pin }),
      ).toThrowError(PiSubagentDevArtifactCacheError);
      try {
        piSubagentDevArtifactCacheEntryDir({ synaraHome: "/tmp/synara-home", pinnedCommit: pin });
      } catch (cause) {
        expect((cause as PiSubagentDevArtifactCacheError).code).toBe("cache_location_invalid");
      }
    },
  );
});

describe("loadDevArtifactPin", () => {
  it("loads the pin from the repository fixture only", () => {
    const environment = createDevCacheEnvironment();
    const pin = loadDevArtifactPin(environment.repoRoot);
    expect(pin.pinnedCommit).toBe(environment.pinnedCommit);
    expect(pin.packageName).toBe("@alfie/pi-subagents");
  });

  it("fails closed with provenance_unreadable when the fixture is absent", () => {
    const repoRoot = makeTempRoot("dev-cache-empty-repo-root-");
    mkdirSync(join(repoRoot, "apps/server/src/provider/test-fixtures"), { recursive: true });
    expect(() => loadDevArtifactPin(repoRoot)).toThrowError(PiSubagentDevArtifactCacheError);
    try {
      loadDevArtifactPin(repoRoot);
    } catch (cause) {
      const error = cause as PiSubagentDevArtifactCacheError;
      expect(error.code).toBe("provenance_unreadable");
      expect(error.message).toBe(
        "Could not read the managed pi-subagents pin fixture for the dev artifact cache.",
      );
      expect(error.message.length).toBeLessThanOrEqual(128);
      expect(error.message).not.toContain(repoRoot);
    }
  });
});

describe("preparePiSubagentDevArtifact (cache layer semantics)", () => {
  it("stages and verifies a verified entry on first preparation (miss)", async () => {
    const environment = createDevCacheEnvironment();

    const prepared = await prepareIn(environment);

    expect(prepared.staged).toBe(true);
    expect(prepared.pinnedCommit).toBe(environment.pinnedCommit);
    expect(prepared.artifactDir).toBe(expectedEntryDir(environment));
    const verification = await verifyPiSubagentArtifact(prepared.artifactDir);
    expect(verification.valid).toBe(true);
    // The cache root contains exactly the one pin entry after preparation
    // (no staging siblings left behind).
    const cacheRoot = join(environment.synaraHome, PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME);
    expect(readdirSync(cacheRoot).toSorted()).toEqual([environment.pinnedCommit.toLowerCase()]);
  }, 60_000);

  it("returns a verified hit unchanged on the second preparation (hit, no restage)", async () => {
    const environment = createDevCacheEnvironment();

    const first = await prepareIn(environment);
    expect(first.staged).toBe(true);

    // Capture the exact staged bytes; a hit must never rewrite them.
    const manifestBefore = readFileSync(join(first.artifactDir, "manifest.json"), "utf8");
    const entriesBefore = walkFileDigests(first.artifactDir);

    const second = await prepareIn(environment);

    expect(second.staged).toBe(false);
    expect(second.artifactDir).toBe(first.artifactDir);
    expect(second.pinnedCommit).toBe(first.pinnedCommit);
    expect(readFileSync(join(second.artifactDir, "manifest.json"), "utf8")).toBe(manifestBefore);
    expect(walkFileDigests(second.artifactDir)).toEqual(entriesBefore);
    const verification = await verifyPiSubagentArtifact(second.artifactDir);
    expect(verification.valid).toBe(true);
  }, 60_000);

  it("quarantines and restages a tampered cache entry (digest mismatch)", async () => {
    const environment = createDevCacheEnvironment();
    const first = await prepareIn(environment);

    const extensionEntry = join(first.artifactDir, "agent/extensions/pi-subagents/src/index.ts");
    writeFileSync(
      extensionEntry,
      `${readFileSync(extensionEntry, "utf8")}\n// tampered after first preparation\n`,
    );
    const invalid = await verifyPiSubagentArtifact(first.artifactDir);
    expect(invalid.valid).toBe(false);

    const second = await prepareIn(environment);

    expect(second.staged).toBe(true);
    const verification = await verifyPiSubagentArtifact(second.artifactDir);
    expect(verification.valid).toBe(true);
    expect(
      readFileSync(join(second.artifactDir, "agent/extensions/pi-subagents/src/index.ts"), "utf8"),
    ).not.toContain("tampered after first preparation");
  }, 60_000);

  it("quarantines a wrong-pin artifact sitting at this pin's entry location", async () => {
    const environment = createDevCacheEnvironment();
    // A different, fully valid artifact staged at THIS pin's entry path
    // (what a pin change without cache invalidation would leave behind).
    const entryDir = expectedEntryDir(environment);
    mkdirSync(join(entryDir, "agent/extensions/pi-subagents/src"), { recursive: true });
    mkdirSync(join(entryDir, "agent/system"), { recursive: true });
    writeFileSync(
      join(entryDir, "agent/extensions/pi-subagents/package.json"),
      JSON.stringify({ name: "@other/extension", version: "0.0.1" }),
    );
    writeFileSync(
      join(entryDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME),
      JSON.stringify({ schemaVersion: 1, wrong: "manifest" }),
    );

    const prepared = await prepareIn(environment);

    expect(prepared.staged).toBe(true);
    expect(prepared.artifactDir).toBe(entryDir);
    const verification = await verifyPiSubagentArtifact(prepared.artifactDir);
    expect(verification.valid).toBe(true);
    expect(
      readFileSync(join(entryDir, "agent/extensions/pi-subagents/package.json"), "utf8"),
    ).toContain("@alfie/pi-subagents");
  }, 60_000);

  it("quarantines a self-consistent artifact with different source pin metadata", async () => {
    const environment = createDevCacheEnvironment();
    const first = await prepareIn(environment);
    const run = (args: ReadonlyArray<string>): string =>
      execFileSync("git", args as string[], {
        cwd: environment.alfieRepoDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    writeFileSync(
      join(environment.alfieRepoDir, "agent/system/working-style.md"),
      "content-of:agent/system/working-style.md\n// different valid pin\n",
    );
    run(["add", "."]);
    run(["commit", "-m", "different valid pin"]);
    const differentCommit = run(["rev-parse", "HEAD"]).trim();
    const authoritative = loadDevArtifactPin(environment.repoRoot);
    buildPiSubagentArtifact({
      repoDir: environment.alfieRepoDir,
      artifactDir: first.artifactDir,
      provenance: { ...authoritative, pinnedCommit: differentCommit },
    });
    expect((await verifyPiSubagentArtifact(first.artifactDir)).valid).toBe(true);

    run(["checkout", "--", "."]);
    run(["checkout", authoritative.pinnedCommit]);
    const prepared = await prepareIn(environment);

    expect(prepared.staged).toBe(true);
    expect(prepared.pinnedCommit).toBe(authoritative.pinnedCommit);
    expect((await verifyPiSubagentArtifact(prepared.artifactDir)).valid).toBe(true);
    expect(readFileSync(join(prepared.artifactDir, "manifest.json"), "utf8")).toContain(
      authoritative.pinnedCommit,
    );
  }, 120_000);

  it("never removes or replaces a stale lock and times out within the bound", async () => {
    const root = makeTempRoot("dev-cache-lock-");
    const cacheRoot = join(root, "cache");
    const pin = "aa6fa4a8540644d2509b10d6df854486ddc67d1d";
    mkdirSync(cacheRoot, { recursive: true });
    const lockPath = join(cacheRoot, `${pin}.lock`);
    const foreignToken = "owner-from-a-crashed-preparation";
    writeFileSync(lockPath, `${foreignToken}\n`);
    const stale = new Date(Date.now() - 181_000);
    utimesSync(lockPath, stale, stale);

    const startedAt = Date.now();
    const error = await expectCacheError(
      withPinLock(cacheRoot, pin, async () => undefined, { waitTimeoutMs: 35, pollMs: 5 }),
      "lock_timeout",
    );

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(error.message).toBe(
      "Managed pi-subagents lock timed out; confirm no dev runner is active, then remove the lock manually and retry.",
    );
    expect(error.message).not.toContain(cacheRoot);
    expect(error.message.length).toBeLessThanOrEqual(128);
    expect(readFileSync(lockPath, "utf8")).toBe(`${foreignToken}\n`);
  });

  it("only the owner removes its lock", async () => {
    const root = makeTempRoot("dev-cache-lock-owner-");
    const cacheRoot = join(root, "cache");
    const pin = "aa6fa4a8540644d2509b10d6df854486ddc67d1d";
    await withPinLock(cacheRoot, pin, async () => undefined);
    expect(existsSync(join(cacheRoot, `${pin}.lock`))).toBe(false);

    const lockPath = join(cacheRoot, `${pin}.lock`);
    writeFileSync(lockPath, "different-owner\n");
    await expectCacheError(
      withPinLock(cacheRoot, pin, async () => undefined, { waitTimeoutMs: 20, pollMs: 5 }),
      "lock_timeout",
    );
    expect(readFileSync(lockPath, "utf8")).toBe("different-owner\n");
  });

  it("maps cache-root and lock filesystem failures without raw diagnostics", async () => {
    const environment = createDevCacheEnvironment();
    const cacheRoot = join(environment.synaraHome, PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME);
    const absoluteCause = new Error(`permission denied at ${cacheRoot}`);
    const cacheFs: Partial<PiSubagentDevArtifactCacheFs> = {
      mkdirSync: () => {
        throw absoluteCause;
      },
    };

    const rootError = await expectCacheError(
      preparePiSubagentDevArtifact({
        repoRoot: environment.repoRoot,
        synaraHome: environment.synaraHome,
        env: { ALFIE_REPO_DIR: environment.alfieRepoDir },
        cacheFs,
      }),
      "cache_root_unavailable",
    );
    expect(rootError.message).toBe(
      "Could not create the managed pi-subagents dev artifact cache root.",
    );
    expect(rootError.message).not.toContain(cacheRoot);
    expect(rootError.message).not.toContain(absoluteCause.message);

    const lockError = await expectCacheError(
      withPinLock(cacheRoot, environment.pinnedCommit, async () => undefined, {
        cacheFs: {
          open: async () => {
            throw Object.assign(new Error(`open failed at ${cacheRoot}`), { code: "EACCES" });
          },
        },
        waitTimeoutMs: 20,
      }),
      "lock_open_failed",
    );
    expect(lockError.message).toBe("Could not open the managed pi-subagents dev artifact lock.");
    expect(lockError.message).not.toContain(cacheRoot);
    expect(lockError.message).not.toContain("EACCES");

    const writeCause = new Error(`write failed at ${cacheRoot}`);
    const writeError = await expectCacheError(
      withPinLock(
        join(makeTempRoot("dev-cache-lock-write-fs-"), "cache"),
        environment.pinnedCommit,
        async () => undefined,
        {
          cacheFs: {
            open: async () => ({
              writeFile: async () => {
                throw writeCause;
              },
              close: async () => undefined,
            }),
          },
        },
      ),
      "lock_write_failed",
    );
    expect(writeError.message).toBe("Could not write the managed pi-subagents dev artifact lock.");
    expect(writeError.message).not.toContain(writeCause.message);

    const closeCause = new Error(`close failed at ${cacheRoot}`);
    const closeError = await expectCacheError(
      withPinLock(
        join(makeTempRoot("dev-cache-lock-close-fs-"), "cache"),
        environment.pinnedCommit,
        async () => undefined,
        {
          cacheFs: {
            open: async () => ({
              writeFile: async () => undefined,
              close: async () => {
                throw closeCause;
              },
            }),
          },
        },
      ),
      "lock_close_failed",
    );
    expect(closeError.message).toBe("Could not close the managed pi-subagents dev artifact lock.");
    expect(closeError.message).not.toContain(closeCause.message);
  });

  it("maps quarantine and owner cleanup filesystem failures without raw diagnostics", async () => {
    const environment = createDevCacheEnvironment();
    const entryDir = expectedEntryDir(environment);
    const quarantineCause = new Error(`remove failed at ${entryDir}`);
    const quarantineError = await expectCacheError(
      preparePiSubagentDevArtifact({
        repoRoot: environment.repoRoot,
        synaraHome: environment.synaraHome,
        env: { ALFIE_REPO_DIR: environment.alfieRepoDir },
        cacheFs: {
          rmSync: (path, options) => {
            if (path === entryDir) throw quarantineCause;
            rmSync(path, options);
          },
        },
      }),
      "cache_quarantine_failed",
    );
    expect(quarantineError.message).toBe(
      "Could not quarantine the managed pi-subagents dev artifact cache entry.",
    );
    expect(quarantineError.message).not.toContain(entryDir);
    expect(quarantineError.message).not.toContain(quarantineCause.message);

    const lockRoot = join(makeTempRoot("dev-cache-lock-fs-"), "cache");
    const pin = "aa6fa4a8540644d2509b10d6df854486ddc67d1d";
    const readCause = new Error("read failed with /private/raw/path");
    const readError = await expectCacheError(
      withPinLock(lockRoot, pin, async () => undefined, {
        cacheFs: {
          readFileSync: () => {
            throw readCause;
          },
        },
      }),
      "lock_read_failed",
    );
    expect(readError.message).toBe(
      "Could not validate ownership of the managed pi-subagents dev artifact lock.",
    );
    expect(readError.message).not.toContain(readCause.message);

    const removeCause = new Error("remove failed with /private/raw/path");
    const removeRoot = join(makeTempRoot("dev-cache-lock-remove-fs-"), "cache");
    const removeError = await expectCacheError(
      withPinLock(removeRoot, pin, async () => undefined, {
        cacheFs: {
          rmSync: (path, options) => {
            if (path.endsWith(".lock")) throw removeCause;
            rmSync(path, options);
          },
        },
      }),
      "lock_remove_failed",
    );
    expect(removeError.message).toBe(
      "Could not remove the managed pi-subagents dev artifact lock after preparation.",
    );
    expect(removeError.message).not.toContain(removeCause.message);
  });

  it("removes only the symlink (never its target) and restages", async () => {
    const environment = createDevCacheEnvironment();
    const first = await prepareIn(environment);

    // Move the verified entry aside and replace it with a symlink to a decoy
    // target OUTSIDE the cache; the target must survive quarantine.
    const decoyRoot = makeTempRoot("dev-cache-symlink-decoy-");
    const decoyTarget = join(decoyRoot, "decoy-artifact");
    mkdirSync(decoyTarget, { recursive: true });
    writeFileSync(join(decoyTarget, "decoy.txt"), "decoy bytes that must survive\n");
    const entryDir = first.artifactDir;
    const movedAside = join(decoyRoot, "moved-entry");
    execFileSync("mv", [entryDir, movedAside]);
    symlinkSync(decoyTarget, entryDir);
    expect(lstatSync(entryDir).isSymbolicLink()).toBe(true);

    const second = await prepareIn(environment);

    expect(second.staged).toBe(true);
    expect(second.artifactDir).toBe(entryDir);
    // The restaged entry is a REAL directory, not a symlink.
    expect(lstatSync(entryDir).isSymbolicLink()).toBe(false);
    const verification = await verifyPiSubagentArtifact(second.artifactDir);
    expect(verification.valid).toBe(true);
    // The decoy target survived untouched.
    expect(readFileSync(join(decoyTarget, "decoy.txt"), "utf8")).toContain(
      "decoy bytes that must survive",
    );
  }, 60_000);

  it("quarantines stale staging siblings left by a crashed staging pass", async () => {
    const environment = createDevCacheEnvironment();
    const first = await prepareIn(environment);
    const cacheRoot = join(environment.synaraHome, PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME);
    const staleSibling = join(
      cacheRoot,
      `${environment.pinnedCommit.toLowerCase()}.staging-deadbeef`,
    );
    mkdirSync(join(staleSibling, "agent"), { recursive: true });
    writeFileSync(join(staleSibling, "agent/partial.txt"), "partial staging bytes");

    // Tamper the entry too, so the next preparation must quarantine (which
    // also sweeps the stale sibling).
    rmSync(first.artifactDir, { recursive: true, force: true });

    await prepareIn(environment);

    expect(existsSync(staleSibling)).toBe(false);
    expect(readdirSync(cacheRoot).toSorted()).toEqual([environment.pinnedCommit.toLowerCase()]);
  }, 60_000);

  it("fails closed when the pinned source cannot be resolved (unclean tree)", async () => {
    const environment = createDevCacheEnvironment();
    // Make the synthetic source dirty AFTER creating the fixture: the
    // stager's cleanliness proof must reject restaging.
    writeFileSync(
      join(environment.alfieRepoDir, "agent/extensions/pi-subagents/src/index.ts"),
      `${readFileSync(join(environment.alfieRepoDir, "agent/extensions/pi-subagents/src/index.ts"), "utf8")}\n// uncommitted mutation\n`,
    );

    // First preparation fails closed: nothing is staged and nothing is left.
    const error = await expectCacheError(prepareIn(environment), "staging_failed");
    expect(error.message).toBe(
      "Failed to stage the managed pi-subagents dev artifact from the pinned source.",
    );
    expect(error.message.length).toBeLessThanOrEqual(128);
    expect(error.message).not.toContain(environment.alfieRepoDir);
    expect(existsSync(expectedEntryDir(environment))).toBe(false);
  }, 60_000);

  it("fails closed with alfie_repo_unresolved when no pinned checkout exists", async () => {
    const environment = createDevCacheEnvironment();
    // Point the env at a non-existent checkout directory; the stager then
    // falls back to <repoRoot>/../alfie (also absent for the synthetic root).
    const error = await expectCacheError(
      preparePiSubagentDevArtifact({
        repoRoot: environment.repoRoot,
        synaraHome: environment.synaraHome,
        env: { ALFIE_REPO_DIR: join(environment.repoRoot, "does-not-exist") },
      }),
      "alfie_repo_unresolved",
    );
    expect(error.message).toBe(
      "Could not locate the pinned Alfie checkout for the managed pi-subagents dev artifact.",
    );
    expect(error.message.length).toBeLessThanOrEqual(128);
    expect(error.message).not.toContain(environment.repoRoot);
  }, 60_000);

  it("serializes concurrent preparations of the same pin: one stages, the rest hit", async () => {
    const environment = createDevCacheEnvironment();

    const results = await Promise.all(Array.from({ length: 4 }, () => prepareIn(environment)));

    for (const result of results) {
      expect(result.artifactDir).toBe(expectedEntryDir(environment));
      expect(result.pinnedCommit).toBe(environment.pinnedCommit);
    }
    expect(results.filter((result) => result.staged)).toHaveLength(1);
    expect(results.filter((result) => !result.staged)).toHaveLength(3);
    const verification = await verifyPiSubagentArtifact(results[0]!.artifactDir);
    expect(verification.valid).toBe(true);
  }, 120_000);

  it("removes the per-pin lock file after a successful preparation (cleanup)", async () => {
    const environment = createDevCacheEnvironment();
    await prepareIn(environment);

    const cacheRoot = join(environment.synaraHome, PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME);
    const lockPath = join(cacheRoot, `${environment.pinnedCommit.toLowerCase()}.lock`);
    expect(existsSync(lockPath)).toBe(false);
  }, 60_000);

  it("removes the per-pin lock file after a failed preparation (cleanup)", async () => {
    const environment = createDevCacheEnvironment();
    writeFileSync(
      join(environment.alfieRepoDir, "agent/extensions/pi-subagents/src/index.ts"),
      `${readFileSync(join(environment.alfieRepoDir, "agent/extensions/pi-subagents/src/index.ts"), "utf8")}\n// uncommitted mutation\n`,
    );

    await expectCacheError(prepareIn(environment), "staging_failed");

    const cacheRoot = join(environment.synaraHome, PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME);
    const lockPath = join(cacheRoot, `${environment.pinnedCommit.toLowerCase()}.lock`);
    expect(existsSync(lockPath)).toBe(false);
  }, 60_000);

  it("keeps two different pins in separate entries (keyed by commit)", async () => {
    const environment = createDevCacheEnvironment();
    const first = await prepareIn(environment);

    // Mutate the source to a SECOND pinned commit and rebuild the fixture
    // for it: the cache must stage a separate entry, never overwrite the
    // first pin's bytes.
    const run = (args: ReadonlyArray<string>): string =>
      execFileSync("git", args as string[], {
        cwd: environment.alfieRepoDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    writeFileSync(
      join(environment.alfieRepoDir, "agent/system/working-style.md"),
      "content-of:agent/system/working-style.md\n// second pin revision\n",
    );
    run(["add", "."]);
    run(["commit", "-m", "second synthetic pin"]);
    const secondCommit = run(["rev-parse", "HEAD"]).trim();
    expect(secondCommit).not.toBe(environment.pinnedCommit);

    const fixtureDir = join(environment.repoRoot, "apps/server/src/provider/test-fixtures");
    writeFileSync(
      join(fixtureDir, "piSubagentExtensionProvenance.json"),
      JSON.stringify(
        {
          expectedRepositoryUrl: "https://github.com/anhphamwork99/alfie.git",
          pinnedCommit: secondCommit,
          packageName: "@alfie/pi-subagents",
          packageVersion: "0.15.0-alfie.4",
          extensionEntryRelativePath: "agent/extensions/pi-subagents/src/index.ts",
          packageManifestRelativePath: "agent/extensions/pi-subagents/package.json",
          hashes: {
            "agent/extensions/pi-subagents/package.json": sha256(
              readFileSync(
                join(environment.alfieRepoDir, "agent/extensions/pi-subagents/package.json"),
              ),
            ),
            "agent/extensions/pi-subagents/src/index.ts": sha256(
              readFileSync(
                join(environment.alfieRepoDir, "agent/extensions/pi-subagents/src/index.ts"),
              ),
            ),
          },
        },
        null,
        2,
      ),
    );

    const second = await preparePiSubagentDevArtifact({
      repoRoot: environment.repoRoot,
      synaraHome: environment.synaraHome,
      env: { ALFIE_REPO_DIR: environment.alfieRepoDir },
    });

    expect(second.artifactDir).not.toBe(first.artifactDir);
    expect(second.pinnedCommit).toBe(secondCommit);
    // BOTH entries verify — the first pin's bytes were untouched.
    expect((await verifyPiSubagentArtifact(first.artifactDir)).valid).toBe(true);
    expect((await verifyPiSubagentArtifact(second.artifactDir)).valid).toBe(true);
    const cacheRoot = join(environment.synaraHome, PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME);
    expect(readdirSync(cacheRoot).toSorted()).toEqual(
      [environment.pinnedCommit.toLowerCase(), secondCommit.toLowerCase()].toSorted(),
    );
  }, 120_000);

  it("never stages user auth/models material into the cache entry", async () => {
    const environment = createDevCacheEnvironment();
    const prepared = await prepareIn(environment);

    const stagedBasenames = walkFiles(prepared.artifactDir).map(
      (relative) => relative.split("/").pop()!,
    );
    for (const prohibited of ["auth.json", "models.json", "credentials.json"]) {
      expect(stagedBasenames, `prohibited payload ${prohibited}`).not.toContain(prohibited);
    }
    for (const relative of walkFiles(prepared.artifactDir)) {
      expect(relative).not.toMatch(/\.(pem|key|p8|pfx)$/u);
    }
  }, 60_000);
});

describe.skipIf(!REAL_ALFIE_REPO_DIR || !existsSync(REAL_ALFIE_REPO_DIR))(
  "real pinned Alfie checkout (integration)",
  () => {
    it(
      "stages and verifies the real pinned artifact into the dev cache",
      { timeout: 180_000 },
      async () => {
        const repoRoot = REPO_ROOT;
        const synaraHome = join(makeTempRoot("dev-cache-real-home-"), ".synara");
        mkdirSync(synaraHome, { recursive: true });

        const prepared = await preparePiSubagentDevArtifact({
          repoRoot,
          synaraHome,
          env: { ALFIE_REPO_DIR: REAL_ALFIE_REPO_DIR },
        });

        expect(prepared.staged).toBe(true);
        const verification = await verifyPiSubagentArtifact(prepared.artifactDir);
        expect(verification.valid).toBe(true);
        expect(prepared.artifactDir).toBe(
          join(synaraHome, PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME, prepared.pinnedCommit),
        );

        // A second preparation over the SAME real pin is a verified hit.
        const second = await preparePiSubagentDevArtifact({
          repoRoot,
          synaraHome,
          env: { ALFIE_REPO_DIR: REAL_ALFIE_REPO_DIR },
        });
        expect(second.staged).toBe(false);
      },
    );
  },
);

// ─── local helpers ───────────────────────────────────────────────────────────

function walkFiles(rootDir: string, currentRelative = ""): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(rootDir).toSorted()) {
    const absolute = join(rootDir, entry);
    const relative = currentRelative ? `${currentRelative}/${entry}` : entry;
    const stats = lstatSync(absolute);
    if (stats.isDirectory()) {
      collected.push(...walkFiles(absolute, relative));
    } else {
      collected.push(relative);
    }
  }
  return collected;
}

function walkFileDigests(rootDir: string): Array<[string, string]> {
  return walkFiles(rootDir).map((relative) => [
    relative,
    sha256(readFileSync(join(rootDir, relative))),
  ]);
}
