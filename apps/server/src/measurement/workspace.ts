// FILE: workspace.ts
// Purpose: impl-11 correction — per-repetition measurement workspaces.
// Every repetition gets a distinct temp workspace whose fixture bytes and
// git state are deterministic and identical across repetitions and modes, so
// Synara `project.create` never collides on workspace roots while Decision 34
// §4 configuration equivalence (project/worktree input) is preserved. All
// created workspaces live under os.tmpdir() and are removed by the harness.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FIXTURE_README_CONTENT = "Token overhead measurement fixture v1\n";
export const FIXTURE_FILE_CONTENT = "deterministic fixture content\n";

/** Fixed fixture file set; bytes are identical in every repetition workspace. */
const FIXTURE_FILES: ReadonlyArray<readonly [string, string]> = [
  ["README.md", FIXTURE_README_CONTENT],
  ["fixture.txt", FIXTURE_FILE_CONTENT],
];

/**
 * Fixed author/committer date so every fixture repo produces the identical
 * commit hash, making git state deterministic across repetitions/modes.
 */
const FIXTURE_GIT_COMMIT_DATE = "2026-08-01T00:00:00Z";

/** Deterministic sha256 over the fixture bytes (names NUL-delimited). */
export function computeFixtureDigest(): string {
  const hash = createHash("sha256");
  for (const [name, content] of FIXTURE_FILES) {
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function writeFixtureFiles(root: string): void {
  for (const [name, content] of FIXTURE_FILES) {
    fs.writeFileSync(path.join(root, name), content);
  }
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_DATE: FIXTURE_GIT_COMMIT_DATE,
    GIT_COMMITTER_DATE: FIXTURE_GIT_COMMIT_DATE,
  };
}

/** Best-effort git init with fixed metadata; returns HEAD or null (no git). */
function initFixtureGit(root: string): string | null {
  try {
    const env = gitEnv();
    const steps: ReadonlyArray<ReadonlyArray<string>> = [
      ["init", "--initial-branch=main"],
      ["config", "user.email", "measurement@example.com"],
      ["config", "user.name", "Token Overhead Harness"],
      ["add", "."],
      ["commit", "-m", "fixture"],
    ];
    for (const args of steps) {
      execFileSync("git", args, {
        cwd: root,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    }
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return head.length > 0 ? head : null;
  } catch {
    // A non-git fixture is acceptable when git is unavailable; the digest
    // still proves byte equivalence and the report records null commit.
    return null;
  }
}

export interface RepetitionWorkspace {
  /** Absolute path of this repetition's distinct temp workspace. */
  readonly root: string;
  /** sha256 fixture digest — identical for every repetition and mode. */
  readonly fixtureDigest: string;
  /** HEAD commit of the fixture repo, or null when git is unavailable. */
  readonly fixtureGitCommit: string | null;
}

/**
 * Create one repetition's distinct temp workspace: deterministic fixture
 * bytes plus (best-effort) an identically-committed git repo. Callers must
 * remove it with {@link removeRepetitionWorkspace}.
 */
export function createRepetitionWorkspace(repetitionIndex: number): RepetitionWorkspace {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `synara-token-overhead-ws-${repetitionIndex}-`),
  );
  writeFixtureFiles(root);
  return {
    root,
    fixtureDigest: computeFixtureDigest(),
    fixtureGitCommit: initFixtureGit(root),
  };
}

/** Remove a workspace created by {@link createRepetitionWorkspace}. */
export function removeRepetitionWorkspace(workspace: RepetitionWorkspace): void {
  fs.rmSync(workspace.root, { recursive: true, force: true });
}

/**
 * Record the deterministic fixture git commit without keeping a workspace
 * around (used for the shared report-level fixture evidence).
 */
export function probeFixtureGitCommit(): string | null {
  const probe = createRepetitionWorkspace(-1);
  try {
    return probe.fixtureGitCommit;
  } finally {
    removeRepetitionWorkspace(probe);
  }
}

export interface HarnessCwdIsolation {
  readonly originalCwd: string;
  readonly isolatedCwd: string;
  /** Restore the original cwd and remove the isolated directory. */
  readonly restore: () => void;
}

/**
 * Isolate the harness process cwd in a fresh temp directory. Real Pi sessions
 * run in-process and Pi extensions (e.g. pi-alfie) write project-local `.pi`
 * state next to process.cwd(); switching the cwd guarantees the harness never
 * leaves repo-local runtime state regardless of where it was invoked. Callers
 * must resolve any invocation-relative output paths before calling this.
 */
export function isolateHarnessCwd(): HarnessCwdIsolation {
  const originalCwd = process.cwd();
  const isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), "synara-token-overhead-cli-"));
  process.chdir(isolatedCwd);
  return {
    originalCwd,
    isolatedCwd,
    restore: () => {
      try {
        process.chdir(originalCwd);
      } catch {
        // The original cwd may be gone; the process is about to exit anyway.
      }
      fs.rmSync(isolatedCwd, { recursive: true, force: true });
    },
  };
}
