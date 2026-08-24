// FILE: piSubagentDesktopArtifactEnvironment.ts
// Purpose: Derives the release-controlled managed Pi artifact locator from
// packaged resources and scrubs inherited Pi agent-dir overrides before the
// backend child is spawned (Ticket 01 WP3, Decision 0004), and composes the
// EXACT environment object the backend child spawn receives (Ticket 04 WP1,
// Decision 0016 — the `backendEnv()` → `startBackend().spawn({ env })` wiring
// seam).
// Layer: Shared desktop-managed Pi boundary — the single production
// implementation owned by `@synara/shared` so the desktop main process and
// the server-side production composition acceptance test exercise the SAME
// code under test (Ticket 04 repair). `apps/desktop/src/piSubagentDesktopArtifactEnvironment.ts`
// is a compatibility re-export shim over this module.
// Depends: Electron packaging layout only — never renderer input or
// request/provider options. The spawn composition step additionally consumes
// the desktop main process's own backend base env and shell hydration state.
// Exports: the backend env derivation and the backend child spawn env
// composition for the managed artifact boundary.

import * as Path from "node:path";

import { applyShellEnvironmentHydrationMarker } from "./shell";

/**
 * Backend env var carrying the release-derived managed Pi artifact locator.
 * Decision 0004 §1: its value is computed by trusted main-process code from
 * the selected packaged resource; it is never accepted from inherited env.
 */
export const SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV = "SYNARA_PI_SUBAGENT_ARTIFACT_DIR";

/**
 * The Pi SDK's global agent-directory override. Decision 0004 §2: desktop must
 * explicitly remove it from the backend child environment so inherited input
 * can never redirect Pi extension discovery at a user-global directory. The
 * artifact locator is a locator only and is never mapped into this var.
 */
const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** Staged artifact directory name (matches build-time staging, WP1b). */
export const PI_SUBAGENT_ARTIFACT_DIR_NAME = "pi-subagents-artifact";

/** Where the staged artifact lives inside the packaged app tree. */
const PACKAGED_ARTIFACT_RELATIVE_PATH = `apps/desktop/resources/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;

/**
 * Resolve the packaged artifact locator candidates. Pure path computation from
 * packaging-provided roots: asar-packaged resources (`app.getAppPath()`), the
 * AppImage `prod-resources` mirror, and `process.resourcesPath` for any layout
 * that ships extra resources outside the archive. The first candidate whose
 * directory exists wins; none of these roots is renderer- or env-controlled.
 */
function resolvePackagedArtifactCandidates(input: {
  readonly appPath: string;
  readonly resourcesPath: string;
}): ReadonlyArray<string> {
  return [
    Path.join(input.appPath, PACKAGED_ARTIFACT_RELATIVE_PATH),
    Path.join(input.appPath, "apps/desktop/prod-resources", PI_SUBAGENT_ARTIFACT_DIR_NAME),
    Path.join(input.resourcesPath, PI_SUBAGENT_ARTIFACT_DIR_NAME),
  ];
}

function resolvePackagedArtifactDir(input: {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly exists: (candidate: string) => boolean;
}): string | null {
  for (const candidate of resolvePackagedArtifactCandidates(input)) {
    if (input.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Build the managed Pi artifact portion of the backend child environment.
 *
 * Returns a NEW object; never mutates `process.env` or the input. Two
 * invariants are enforced together (Decision 0004 §1/§2):
 *
 * 1. `SYNARA_PI_SUBAGENT_ARTIFACT_DIR` is always scrubbed from the inherited
 *    environment first, then — in a packaged launch — set to exactly the path
 *    derived from the packaged resource candidates. An attacker-supplied
 *    inherited value can therefore never survive into the child.
 * 2. `PI_CODING_AGENT_DIR` is always removed from the child environment, in
 *    packaged AND non-packaged launches, so desktop managed discovery cannot
 *    be redirected at a user-global agent directory. The locator is never
 *    written into `PI_CODING_AGENT_DIR`.
 *
 * Non-packaged development launches intentionally do NOT invent a
 * user-controlled artifact path: the inherited locator is scrubbed and no new
 * locator is set, leaving Ticket 02's explicit controlled binding to supply
 * one when it exists.
 */
export function applyPiSubagentArtifactBackendEnv(input: {
  readonly inheritedEnv: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly exists: (candidate: string) => boolean;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.inheritedEnv };
  delete env[PI_CODING_AGENT_DIR_ENV];
  delete env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV];
  if (input.isPackaged) {
    const artifactDir = resolvePackagedArtifactDir(input);
    if (artifactDir !== null) {
      env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV] = artifactDir;
    }
  }
  return env;
}

/**
 * Fixed extra environment keys the backend child spawn itself adds after the
 * derived backend environment (Ticket 04 WP1, Decision 0016). They are
 * Electron-run-mode/entry plumbing, never managed-Pi selection, and are kept
 * as an exported pair so the spawn composition cannot silently grow another
 * key that bypasses the resolver.
 */
export const BACKEND_CHILD_ELECTRON_RUN_AS_NODE_ENV = "ELECTRON_RUN_AS_NODE" as const;
export const BACKEND_CHILD_ELECTRON_RUN_AS_NODE_VALUE = "1" as const;
export const BACKEND_CHILD_SERVER_ENTRY_ENV = "SYNARA_SERVER_ENTRY" as const;

/**
 * The single production composition seam between `backendEnv()` and
 * `startBackend()`'s `ChildProcess.spawn(..., { env })` call (Ticket 04 WP1,
 * Decision 0016 obligation 9).
 *
 * Given the desktop main process's backend BASE environment (everything
 * `backendEnv()` derives except the managed-Pi and hydration steps) and the
 * packaged-layout facts, this returns exactly the object handed to the child
 * spawn: the complete `applyPiSubagentArtifactBackendEnv` result, the login
 * shell hydration marker, and the two fixed child-run keys above — nothing
 * reconstructed, dropped, or re-derived. No Pi-specific selection,
 * sanitization, or fallback exists between this seam and the spawn call, so a
 * focused composition test here protects the whole wiring without launching
 * Electron or an OS child.
 */
export function buildBackendChildSpawnEnv(input: {
  /** Backend base env from `backendEnv()` (before the managed-Pi/hydration steps). */
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly exists: (candidate: string) => boolean;
  /** Whether the main process's login-shell PATH hydration succeeded. */
  readonly shellPathHydrated: boolean;
  /** Backend entry file the child is spawned with. */
  readonly serverEntry: string;
}): NodeJS.ProcessEnv {
  const piSubagentEnv = applyPiSubagentArtifactBackendEnv({
    inheritedEnv: input.baseEnv,
    isPackaged: input.isPackaged,
    appPath: input.appPath,
    resourcesPath: input.resourcesPath,
    exists: input.exists,
  });
  return {
    ...applyShellEnvironmentHydrationMarker(piSubagentEnv, input.shellPathHydrated),
    [BACKEND_CHILD_ELECTRON_RUN_AS_NODE_ENV]: BACKEND_CHILD_ELECTRON_RUN_AS_NODE_VALUE,
    [BACKEND_CHILD_SERVER_ENTRY_ENV]: input.serverEntry,
  };
}
