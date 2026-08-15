// FILE: standaloneDriver.ts
// Purpose: WP3 — Pi standalone driver. Each repetition runs through the real
// Pi session boundary (fresh in-process Pi session with the same
// configuration the Synara modes use), captures startup SessionStats, the
// complete effective tool manifest through the real tool/schema API, the
// fixed two-turn stimulus, and tool-call invalidation.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createRepetitionWorkspace, removeRepetitionWorkspace } from "./workspace.ts";
import {
  createMeasurementPiSession,
  enumerateToolManifest,
  measureStandaloneTurn,
  runStimulusTurn,
  summarizeSessionManifest,
  type PiSessionHandle,
} from "./piSession.ts";
import { sanitizePathForReport, sanitizeFailureForReport } from "./sanitize.ts";
import type {
  ExposureEvidence,
  RawSessionStats,
  RepetitionRecord,
  TurnMeasurement,
} from "./types.ts";

export interface StandaloneDriverOptions {
  readonly agentDir: string;
  readonly modelId: string;
  readonly thinkingLevel: string;
  readonly repetitions: number;
  readonly turnsPerRepetition: number;
  readonly localManifestDir: string | null;
  readonly harnessVersion: string;
  readonly promptHash: string;
  readonly promptBytes: number;
  readonly onDiagnostic?: (message: string) => void;
}

export interface StandaloneModeResult {
  readonly repetitions: readonly RepetitionRecord[];
  readonly diagnostics: readonly string[];
}

function toRaw(stats: { readonly tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }): RawSessionStats {
  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    total: stats.tokens.total,
  };
}

/**
 * Prepare a local full-manifest retention directory under Decision 34 §3:
 * the destination must be outside any git repository or, when inside one,
 * must pass `git check-ignore` (the equivalent tracked/ignored proof) so a
 * repo-contained manifest path can never be committed. Symlinks (a planted
 * redirect anywhere between the deepest existing ancestor and the target,
 * or at the target itself) and non-directory targets are rejected, and the
 * directory is created when missing and made owner-only (0700) either way.
 * Returns the prepared directory or a bounded rejection reason (nothing is
 * written on rejection).
 */
export function prepareLocalManifestDir(
  localManifestDir: string,
): { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly reason: string } {
  const resolved = path.resolve(localManifestDir);
  const ancestor = deepestExistingAncestor(resolved);
  if (ancestor === null) {
    return { ok: false, reason: "path-resolve-failed" };
  }
  // A pre-existing target that is a symlink or a non-directory is rejected
  // before anything is created or chmodded.
  if (ancestor.missing.length === 0) {
    let stat;
    try {
      stat = fs.lstatSync(resolved);
    } catch {
      return { ok: false, reason: "path-resolve-failed" };
    }
    if (stat.isSymbolicLink()) {
      return { ok: false, reason: "symlink-rejected" };
    }
    if (!stat.isDirectory()) {
      return { ok: false, reason: "not-a-directory" };
    }
  }
  // Repo containment + ignore proof runs before creation (check-ignore works
  // on not-yet-existing paths, and rejection then creates nothing). The
  // canonical spelling is used so a symlinked path is judged by where the
  // write actually lands.
  const canonicalTarget = path.join(ancestor.dir, ...ancestor.missing);
  const repoRoot = findGitRepoRoot(canonicalTarget);
  if (repoRoot !== null && !gitCheckIgnore(repoRoot, canonicalTarget)) {
    return { ok: false, reason: "inside-repo-not-ignored" };
  }
  try {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  } catch {
    return { ok: false, reason: "directory-create-failed" };
  }
  // The created directory must be a real directory at the canonical spelling
  // of the user's path: a symlink planted between the ancestor and the
  // target (or at the target) would redirect the write and is rejected.
  let realCreated: string;
  try {
    realCreated = fs.realpathSync(resolved);
  } catch {
    return { ok: false, reason: "directory-create-failed" };
  }
  if (realCreated !== canonicalTarget) {
    return { ok: false, reason: "symlink-redirect-rejected" };
  }
  let createdStat;
  try {
    createdStat = fs.lstatSync(resolved);
  } catch {
    return { ok: false, reason: "directory-create-failed" };
  }
  if (createdStat.isSymbolicLink() || !createdStat.isDirectory()) {
    return { ok: false, reason: "not-a-directory" };
  }
  try {
    fs.chmodSync(resolved, 0o700);
  } catch {
    return { ok: false, reason: "permission-failed" };
  }
  // The prepared directory is the canonical spelling of the user's path —
  // where the write actually lands (a consistent symlink keeps it equal to
  // the lexical path on most systems).
  return { ok: true, dir: canonicalTarget };
}

/** Deepest existing ancestor of a target plus the not-yet-existing tail. */
function deepestExistingAncestor(
  target: string,
): { readonly dir: string; readonly missing: readonly string[] } | null {
  const missing: string[] = [];
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return null;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  let realExisting: string;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    return null;
  }
  return { dir: realExisting, missing };
}

/** Nearest enclosing git work tree (`.git` dir or file), or null outside any repo. */
function findGitRepoRoot(target: string): string | null {
  let cursor = target;
  for (let depth = 0; depth < 64; depth += 1) {
    if (fs.existsSync(path.join(cursor, ".git"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return null;
}

/**
 * `git check-ignore` proof for a repo-contained destination. Exit 0 is the
 * tracked/ignored proof; anything else (not ignored, no git, not a repo)
 * fails closed so an unproven repo-contained path is never written.
 */
function gitCheckIgnore(repoRoot: string, target: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", target], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

export function writeLocalManifest(
  localManifestDir: string | null,
  mode: string,
  repetitionIndex: number,
  entries: readonly ReturnType<typeof enumerateToolManifest>[number][],
  onRejected?: (reason: string) => void,
): boolean {
  // Default (null) remains allowed and simply records that no local full
  // manifest was produced (Decision 34 §3: local retention is optional).
  if (localManifestDir === null) return false;
  const prepared = prepareLocalManifestDir(localManifestDir);
  if (!prepared.ok) {
    onRejected?.(prepared.reason);
    return false;
  }
  const target = path.join(prepared.dir, `${mode}-${repetitionIndex}.manifest.json`);
  fs.writeFileSync(target, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  return true;
}

const STANDALONE_EXPOSURE: ExposureEvidence = {
  mode: "standalone",
  projectSynaraMcpDesiredState: null,
  activationSucceeded: false,
  dormantObserved: true,
  lifecycleFailures: [],
};

export async function runStandaloneMode(
  options: StandaloneDriverOptions,
): Promise<StandaloneModeResult> {
  const diagnostics: string[] = [];
  const repetitions: RepetitionRecord[] = [];
  for (let repetitionIndex = 0; repetitionIndex < options.repetitions; repetitionIndex += 1) {
    // Each repetition gets its own distinct temp workspace with identical
    // deterministic fixture bytes/git state (workspace.ts), preserving
    // Decision 34 §4 project/worktree equivalence per repetition.
    const workspace = createRepetitionWorkspace(repetitionIndex);
    let handle: PiSessionHandle | undefined;
    const lifecycleFailures: string[] = [];
    try {
      handle = await createMeasurementPiSession({
        cwd: workspace.root,
        agentDir: options.agentDir,
        modelId: options.modelId,
        thinkingLevel: options.thinkingLevel as never,
        extensionFactories: [],
      });
      const startup = toRaw(handle.session.getSessionStats());
      const entries = enumerateToolManifest(handle.session);
      const localCaptureProduced = writeLocalManifest(
        options.localManifestDir,
        "standalone",
        repetitionIndex,
        entries,
        (reason) =>
          diagnostics.push(
            `standalone/${repetitionIndex}: local manifest retention rejected (${reason}); committed hash remains the identity proof`,
          ),
      );
      const manifest = summarizeSessionManifest(handle.session, {
        localCaptureProduced,
        catalogComplete: true,
      });

      const turns: TurnMeasurement[] = [];
      let previousRaw = startup;
      for (let turnIndex = 1; turnIndex <= options.turnsPerRepetition; turnIndex += 1) {
        const run = await runStimulusTurn(handle, {
          onToolCall: (toolName) =>
            diagnostics.push(
              `standalone/${repetitionIndex} turn ${turnIndex}: tool call observed: ${toolName}`,
            ),
        });
        turns.push(
          measureStandaloneTurn({
            turnIndex,
            before: previousRaw,
            after: run.after,
            toolCalls: run.toolCalls,
            errorMessage: run.errorMessage,
          }),
        );
        previousRaw = run.after;
      }

      const invalidReasons = [
        ...(turns.some((turn) => turn.invalid) ? ["invalid turn(s)"] : []),
        ...(lifecycleFailures.length > 0 ? ["lifecycle failure(s)"] : []),
      ];
      repetitions.push({
        mode: "standalone",
        repetitionIndex,
        manifest,
        startup,
        turns,
        invalid: invalidReasons.length > 0,
        ...(invalidReasons.length > 0 ? { invalidReason: invalidReasons.join(" | ") } : {}),
        exposureEvidence: STANDALONE_EXPOSURE,
        config: {
          model: options.modelId,
          thinkingLevel: options.thinkingLevel,
          promptHash: options.promptHash,
          promptBytes: options.promptBytes,
          workspaceCwd: sanitizePathForReport(workspace.root),
          agentDir: sanitizePathForReport(options.agentDir),
          harnessVersion: options.harnessVersion,
        },
      });
    } catch (cause) {
      const message = sanitizeFailureForReport(cause);
      lifecycleFailures.push(message);
      diagnostics.push(`standalone/${repetitionIndex} failed: ${message}`);
      const manifest = handle
        ? summarizeSessionManifest(handle.session, {
            localCaptureProduced: false,
            catalogComplete: false,
            catalogIncompleteReason: "repetition failed during measurement",
          })
        : {
            toolNames: [],
            toolCount: 0,
            canonicalBytes: 0,
            hash: "",
            hashAlgorithm: "sha256" as const,
            method: "unavailable",
            localCaptureProduced: false,
            catalogComplete: false,
            catalogIncompleteReason: "session creation failed",
          };
      repetitions.push({
        mode: "standalone",
        repetitionIndex,
        manifest,
        startup: toRawSafe(handle),
        turns: [],
        invalid: true,
        invalidReason: message.slice(0, 500),
        exposureEvidence: { ...STANDALONE_EXPOSURE, lifecycleFailures },
        config: {
          model: options.modelId,
          thinkingLevel: options.thinkingLevel,
          promptHash: options.promptHash,
          promptBytes: options.promptBytes,
          workspaceCwd: sanitizePathForReport(workspace.root),
          agentDir: sanitizePathForReport(options.agentDir),
          harnessVersion: options.harnessVersion,
        },
      });
    } finally {
      try {
        handle?.session.dispose();
      } catch {
        // Disposal is best-effort; the in-process session has no external
        // resources beyond its transcript in memory.
      }
      removeRepetitionWorkspace(workspace);
    }
  }
  return { repetitions, diagnostics };
}

function toRawSafe(handle: PiSessionHandle | undefined): RawSessionStats {
  try {
    if (handle) return toRaw(handle.session.getSessionStats());
  } catch {
    // fall through to zeros
  }
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}
