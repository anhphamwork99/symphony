// FILE: projectWorkspaceMigration.ts
// Purpose: The single pure policy for migrating legacy Thread-owned
//          Right-sidebar workspace slices into one Project-owned workspace.
// Placement: shared pure policy (web, server, and desktop all reuse it so no
//        boundary can encode a different collision policy).
// Depends on: WP1 contracts projectWorkspace schemas and entity ids.
//
// Authority: .planning/synara-project-right-sidebar-workspace/decisions/
//   0002-explicit-project-ownership-and-legacy-migration.md — sections
//   "Exact legacy migration algorithm" (A–G) and "Prohibited shortcuts".
//
// Purity contract: no I/O, no storage access, no clock reads, no Effect
// runtime service, and no browser-storage/desktop/app imports. Every function
// is a deterministic transform of its arguments; `Date.parse` parses a
// caller-supplied string and never reads the current time. The publication
// marker's `publishedAt` is deliberately NOT synthesized here — the writing
// boundary supplies it from its own clock after staging is durable.
//
// Policy summary (Decision 0002):
// - Eligibility: same Project, `deletedAt === null`, at least one valid
//   non-default slice. Archived Threads stay eligible; malformed, absent,
//   and canonically-default slices never make a Thread eligible; a Thread
//   whose durable `updatedAt` cannot be parsed as a normalized instant fails
//   closed (it cannot be durably ordered).
// - Winner: durable `updatedAt` descending, ties broken by lexicographically
//   ascending canonical `ThreadId`. Exactly one winner per Project.
// - All slices: every destination slice comes from that one winner only; a
//   winner slice that is absent, malformed, or canonically default publishes
//   the canonical default Project-owned slice — never borrowed from a loser.
// - Published wins: a valid current-version published target for THIS exact
//   Project — marker `projectId` and every staged slice `projectId` equal to
//   the expected Project — is never overwritten; anything else (including a
//   valid marker for another Project, or mixed-Project staged slices) is
//   unpublished and never activates.
// - Publication: deterministic stage and marker keys; the marker is written
//   only after staging is complete; readers activate only when the server
//   advertises the capability AND a valid current marker for the expected
//   Project exists.
// - Diagnostics: a legacy winner's persisted browser `lastError` survives
//   migration as the `restorationDiagnostic` on the winner's migrated browser
//   dock pane — an unavailable-content error is never silently dropped, and
//   no pane is invented when none exists.
//
// There is intentionally NO function that returns a `ThreadId` for a
// `ProjectId`: no synthetic alias, no host conversation, no cast. There is
// also intentionally no Effect runtime dependency here — the `Schema`
// namespace is a decoder, not a runtime service.

import { Schema } from "effect";

import {
  LegacyBrowserSliceV1,
  LegacyDeviceSliceV1,
  LegacyRightDockSliceV1,
  LegacyTerminalPresentationSliceV1,
  PROJECT_WORKSPACE_LEGACY_SCHEMA_VERSION,
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  ProjectWorkspacePublicationMarker,
  ProjectWorkspaceSlice,
} from "@synara/contracts";
import type {
  ProjectWorkspaceBrowserSlice as ProjectWorkspaceBrowserSliceType,
  ProjectWorkspaceDockSlice as ProjectWorkspaceDockSliceType,
  ProjectWorkspaceSlice as ProjectWorkspaceSliceType,
  ProjectWorkspaceTerminalPresentationSlice as ProjectWorkspaceTerminalPresentationSliceType,
  ThreadId,
} from "@synara/contracts";
import type {
  LegacyBrowserSliceV1 as LegacyBrowserSliceV1Type,
  LegacyDeviceSliceV1 as LegacyDeviceSliceV1Type,
  LegacyRightDockSliceV1 as LegacyRightDockSliceV1Type,
  LegacyTerminalPresentationSliceV1 as LegacyTerminalPresentationSliceV1Type,
} from "@synara/contracts";
import type { ProjectId } from "@synara/contracts";

// ── Vocabulary ───────────────────────────────────────────────────────

/** Every destination slice kind, in the canonical deterministic stage order. */
export const PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS = [
  "right-dock",
  "terminal-presentation",
  "browser",
  "browser-annotations",
  "device",
] as const;
export type ProjectWorkspaceMigrationSliceKind =
  (typeof PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS)[number];

const SLICE_KIND_SET: ReadonlySet<string> = new Set(PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS);

/**
 * Canonical legacy terminal defaults these predicates recognize. They mirror
 * the fresh-Thread values the legacy per-Thread stores persist
 * (`DEFAULT_THREAD_TERMINAL_HEIGHT` / `DEFAULT_THREAD_TERMINAL_ID` /
 * `Terminal 1`). "Canonically default" must be judged by these canonical
 * values — never by serialized-byte inequality or key presence (Decision
 * 0002 B.6).
 */
export const PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_HEIGHT_PX = 280;
export const PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_ID = "default";
export const PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_LABEL = "Terminal 1";

// ── Decode helper (malformed data never becomes valid) ───────────────

function decodeOr<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> | null {
  try {
    return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
  } catch {
    return null;
  }
}

// ── Normalized durable instants (Decision 0002 C.2) ──────────────────

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse a durable timestamp into a normalized epoch-milliseconds instant.
 *
 * Accepts only strict ISO-8601 date-time strings carrying an explicit UTC `Z`
 * or numeric offset — the durable Thread metadata shape. Locale-formatted
 * strings, date-only values, space-separated values, and garbage return
 * `null`, and callers treat `null` as fail-closed: such a Thread cannot be
 * durably ordered, so it is ineligible.
 */
export function normalizeLegacyInstant(value: string): number | null {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) {
    return null;
  }
  const epochMs = Date.parse(value);
  return Number.isNaN(epochMs) ? null : epochMs;
}

// ── Inputs ───────────────────────────────────────────────────────────

/** Raw, unvalidated legacy v1 slice payloads one Thread may have persisted. */
export interface LegacyProjectWorkspaceThreadSlicesInput {
  readonly rightDock?: unknown;
  readonly terminalPresentation?: unknown;
  readonly browser?: unknown;
  readonly device?: unknown;
}

/**
 * One Thread's durable orchestration metadata plus its raw legacy slices.
 *
 * `archivedAt` is carried but deliberately NEVER consulted: an archived
 * Thread remains a valid migration source (Decision 0002 B.3).
 */
export interface LegacyProjectWorkspaceThreadInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly archivedAt: string | null;
  readonly slices: LegacyProjectWorkspaceThreadSlicesInput;
}

/** The already-written Project-owned destination payload, if any. */
export interface ProjectWorkspacePublishedTargetInput {
  readonly publicationMarker: unknown;
  readonly stagedSlices: ReadonlyArray<unknown>;
}

/** One Project's migration question: its Threads and its current target. */
export interface ProjectWorkspaceMigrationProjectInput {
  readonly projectId: ProjectId;
  readonly threads: ReadonlyArray<LegacyProjectWorkspaceThreadInput>;
  readonly publishedTarget?: ProjectWorkspacePublishedTargetInput | null;
}

// ── Legacy slice validation ──────────────────────────────────────────

interface DecodedLegacyThreadSlices {
  readonly rightDock: LegacyRightDockSliceV1Type | null;
  readonly terminalPresentation: LegacyTerminalPresentationSliceV1Type | null;
  readonly browser: LegacyBrowserSliceV1Type | null;
  readonly device: LegacyDeviceSliceV1Type | null;
}

/**
 * Validate one Thread's raw slices with the WP1 v1 sanitizers and bind them
 * to the Thread they claim. A slice that fails validation — or that carries a
 * different `threadId` than the record it was read under — is malformed for
 * policy purposes and treated exactly like an absent slice (Decision 0002
 * A.3/B.5). Validation never repairs data.
 */
function decodeLegacyThreadSlices(
  thread: LegacyProjectWorkspaceThreadInput,
): DecodedLegacyThreadSlices {
  const owned = <T extends { readonly threadId: ThreadId }>(slice: T | null): T | null =>
    slice !== null && slice.threadId === thread.threadId ? slice : null;
  return {
    rightDock: owned(decodeOr(LegacyRightDockSliceV1, thread.slices.rightDock)),
    terminalPresentation: owned(
      decodeOr(LegacyTerminalPresentationSliceV1, thread.slices.terminalPresentation),
    ),
    browser: owned(decodeOr(LegacyBrowserSliceV1, thread.slices.browser)),
    device: owned(decodeOr(LegacyDeviceSliceV1, thread.slices.device)),
  };
}

// ── Canonical non-default predicates (Decision 0002 B.5–B.6) ─────────

function isCanonicalDefaultRightDock(slice: LegacyRightDockSliceV1Type): boolean {
  return !slice.open && slice.panes.length === 0 && slice.activePaneId === null;
}

/**
 * Canonical-default terminal labels: `undefined` (older builds persisted no
 * labels at all), the empty record `{}`, and the exact legacy fresh-Thread
 * default `{ default: "Terminal 1" }`. Any other label content is material —
 * the user renamed or organized terminals.
 */
function isCanonicalDefaultTerminalLabels(labels: Record<string, string> | undefined): boolean {
  if (labels === undefined) {
    return true;
  }
  const keys = Object.keys(labels);
  if (keys.length === 0) {
    return true;
  }
  return (
    keys.length === 1 &&
    keys[0] === PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_ID &&
    labels[PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_ID] ===
      PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_LABEL
  );
}

function isCanonicalDefaultTerminalPresentation(
  slice: LegacyTerminalPresentationSliceV1Type,
): boolean {
  return (
    slice.presentationMode === "drawer" &&
    slice.workspaceTab === "terminal" &&
    slice.workspaceLayout === "both" &&
    slice.terminalHeightPx === PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_HEIGHT_PX &&
    slice.terminalIds.length === 1 &&
    slice.terminalIds[0] === PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_ID &&
    slice.activeTerminalId === PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_ID &&
    isCanonicalDefaultTerminalLabels(slice.terminalLabelsById)
  );
}

function isCanonicalDefaultBrowser(slice: LegacyBrowserSliceV1Type): boolean {
  return !slice.open && slice.tabs.length === 0 && slice.activeTabId === null;
}

/** A persisted legacy browser error that carries real diagnostic content. */
function hasMaterialBrowserError(slice: LegacyBrowserSliceV1Type): boolean {
  return slice.lastError !== null && slice.lastError.length > 0;
}

/** Does the winner's dock expose a browser pane the error can annotate? */
function findBrowserPaneId(dock: LegacyRightDockSliceV1Type | null): string | null {
  if (dock === null) {
    return null;
  }
  const pane = dock.panes.find((candidate) => candidate.kind === "browser");
  return pane === undefined ? null : pane.id;
}

/**
 * Canonical-default device slice: no attached device AND no pending attach
 * intent. A non-null `attachPhase` (booting / waiting-for-display /
 * connecting) is material even with `attachedDeviceUdid === null` — the
 * workspace recorded an in-flight attachment the user expects to resume.
 */
function isCanonicalDefaultDevice(slice: LegacyDeviceSliceV1Type): boolean {
  return slice.attachedDeviceUdid === null && (slice.attachPhase ?? null) === null;
}

function hasEligibleLegacySlice(slices: DecodedLegacyThreadSlices): boolean {
  // A browser error is material workspace state when a browser pane exists
  // in the same Thread's dock to carry its diagnostic (Decision 0002: no
  // silent removal of unavailable content). Without such a pane the error
  // has nowhere to live and does not make the Thread a candidate on its own.
  const browserErrorIsMaterial =
    slices.browser !== null &&
    hasMaterialBrowserError(slices.browser) &&
    findBrowserPaneId(slices.rightDock) !== null;
  return (
    (slices.rightDock !== null && !isCanonicalDefaultRightDock(slices.rightDock)) ||
    (slices.terminalPresentation !== null &&
      !isCanonicalDefaultTerminalPresentation(slices.terminalPresentation)) ||
    (slices.browser !== null && !isCanonicalDefaultBrowser(slices.browser)) ||
    browserErrorIsMaterial ||
    (slices.device !== null && !isCanonicalDefaultDevice(slices.device))
  );
}

// ── Candidate eligibility (Decision 0002 B) ──────────────────────────

/**
 * A Thread is eligible exactly when its durable `projectId` equals this
 * Project, its durable `deletedAt` is `null`, its durable `updatedAt` parses
 * as a normalized instant, and at least one workspace slice contains valid,
 * non-default workspace data after validation. `archivedAt` is ignored by
 * design. A deleted Thread is ineligible even if stale v1 data remains.
 */
export function isLegacyProjectWorkspaceCandidate(
  thread: LegacyProjectWorkspaceThreadInput,
  projectId: ProjectId,
): boolean {
  if (thread.projectId !== projectId) {
    return false;
  }
  if (thread.deletedAt !== null) {
    return false;
  }
  if (normalizeLegacyInstant(thread.updatedAt) === null) {
    return false;
  }
  return hasEligibleLegacySlice(decodeLegacyThreadSlices(thread));
}

// ── Deterministic winner ordering (Decision 0002 C) ──────────────────

interface WinnerRecord {
  readonly thread: LegacyProjectWorkspaceThreadInput;
  readonly slices: DecodedLegacyThreadSlices;
}

/** Newest durable `updatedAt` first; ties by ascending canonical ThreadId. */
function compareByNewestUpdatedAtThenThreadIdAsc(
  left: { readonly threadId: ThreadId; readonly updatedAtInstant: number },
  right: { readonly threadId: ThreadId; readonly updatedAtInstant: number },
): number {
  const instantDelta = right.updatedAtInstant - left.updatedAtInstant;
  if (instantDelta !== 0) {
    return instantDelta;
  }
  // Canonical lexicographic (code-unit) comparison — locale-independent.
  if (left.threadId < right.threadId) {
    return -1;
  }
  return left.threadId > right.threadId ? 1 : 0;
}

function selectWinnerRecord(
  threads: ReadonlyArray<LegacyProjectWorkspaceThreadInput>,
  projectId: ProjectId,
): WinnerRecord | null {
  const candidates: Array<{
    readonly thread: LegacyProjectWorkspaceThreadInput;
    readonly updatedAtInstant: number;
  }> = [];
  for (const thread of threads) {
    if (thread.projectId !== projectId || thread.deletedAt !== null) {
      continue;
    }
    const updatedAtInstant = normalizeLegacyInstant(thread.updatedAt);
    if (updatedAtInstant === null) {
      continue;
    }
    const slices = decodeLegacyThreadSlices(thread);
    if (!hasEligibleLegacySlice(slices)) {
      continue;
    }
    candidates.push({ thread, updatedAtInstant });
  }
  candidates.sort((left, right) =>
    compareByNewestUpdatedAtThenThreadIdAsc(
      { threadId: left.thread.threadId, updatedAtInstant: left.updatedAtInstant },
      { threadId: right.thread.threadId, updatedAtInstant: right.updatedAtInstant },
    ),
  );
  const winner = candidates[0];
  if (winner === undefined) {
    return null;
  }
  return { thread: winner.thread, slices: decodeLegacyThreadSlices(winner.thread) };
}

/** The winning legacy Thread for a Project, or `null` when none is eligible. */
export function selectLegacyProjectWorkspaceWinner(
  threads: ReadonlyArray<LegacyProjectWorkspaceThreadInput>,
  projectId: ProjectId,
): { readonly winnerThreadId: ThreadId } | { readonly winnerThreadId: null } {
  const winner = selectWinnerRecord(threads, projectId);
  return { winnerThreadId: winner === null ? null : winner.thread.threadId };
}

// ── Canonical default v2 slices (Decision 0002 C.5/D.3) ──────────────

function canonicalDefaultDockSlice(projectId: ProjectId): ProjectWorkspaceDockSliceType {
  return {
    slice: "right-dock",
    projectId,
    open: false,
    preferredWidthPx: null,
    panes: [],
    activePaneId: null,
  };
}

function canonicalDefaultTerminalPresentationSlice(
  projectId: ProjectId,
): ProjectWorkspaceTerminalPresentationSliceType {
  return {
    slice: "terminal-presentation",
    projectId,
    presentationMode: "drawer",
    workspaceTab: "terminal",
    workspaceLayout: "both",
    terminalHeightPx: PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_HEIGHT_PX,
    terminalIds: [PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_ID],
    activeTerminalId: PROJECT_WORKSPACE_MIGRATION_DEFAULT_TERMINAL_ID,
    terminalLabelsById: {},
  };
}

function canonicalDefaultBrowserSlice(projectId: ProjectId): ProjectWorkspaceBrowserSliceType {
  return {
    slice: "browser",
    projectId,
    open: false,
    activeTabId: null,
    tabs: [],
  };
}

function canonicalDefaultAnnotationsSlice(projectId: ProjectId): ProjectWorkspaceSliceType {
  return {
    slice: "browser-annotations",
    projectId,
    markers: [],
  };
}

function canonicalDefaultDeviceSlice(projectId: ProjectId): ProjectWorkspaceSliceType {
  return {
    slice: "device",
    projectId,
    attachedDeviceUdid: null,
    attachPhase: null,
  };
}

/**
 * The canonical empty Project workspace: exactly one default slice of every
 * kind, in canonical stage order. This is what a Project with no eligible
 * legacy Thread reads (Decision 0002 C.5) and what any absent, malformed, or
 * canonically-default winner slice publishes as (Decision 0002 D.3).
 */
export function canonicalDefaultProjectWorkspaceSlices(
  projectId: ProjectId,
): ReadonlyArray<ProjectWorkspaceSliceType> {
  return [
    canonicalDefaultDockSlice(projectId),
    canonicalDefaultTerminalPresentationSlice(projectId),
    canonicalDefaultBrowserSlice(projectId),
    canonicalDefaultAnnotationsSlice(projectId),
    canonicalDefaultDeviceSlice(projectId),
  ];
}

// ── Winner-slice conversion (Decision 0002 D) ────────────────────────

function convertRightDock(
  slice: LegacyRightDockSliceV1Type,
  projectId: ProjectId,
  browserErrorFromSameWinner: string | null,
): ProjectWorkspaceDockSliceType {
  // Legacy v1 persisted no dock width; `null` is the v2 "no remembered
  // preference" value. A rendering-time clamp is never persisted, so nothing
  // else could legitimately occupy this field during migration.
  //
  // The winner's persisted legacy browser `lastError` is preserved as the
  // `restorationDiagnostic` on the migrated browser pane from the SAME winner
  // — the pane stays present with an actionable message instead of silently
  // losing its unavailable-content state. No browser pane means no invented
  // pane; the diagnostic simply has no surface to occupy.
  const diagnosticPaneId = browserErrorFromSameWinner === null ? null : findBrowserPaneId(slice);
  const carryDiagnostic =
    browserErrorFromSameWinner !== null &&
    diagnosticPaneId !== null &&
    browserErrorFromSameWinner.length > 0;
  return {
    slice: "right-dock",
    projectId,
    open: slice.open,
    preferredWidthPx: null,
    panes: slice.panes.map((pane) => ({
      id: pane.id,
      kind: pane.kind,
      threadId: pane.threadId,
      diffTurnId: pane.diffTurnId,
      diffFilePath: pane.diffFilePath,
      filePath: pane.filePath,
      pullRequestProjectId: pane.pullRequestProjectId,
      pullRequestRepository: pane.pullRequestRepository,
      pullRequestNumber: pane.pullRequestNumber,
      pullRequestInitialTab: pane.pullRequestInitialTab,
      restorationDiagnostic:
        carryDiagnostic && pane.id === diagnosticPaneId ? browserErrorFromSameWinner : null,
    })),
    activePaneId: slice.activePaneId,
  };
}

function convertTerminalPresentation(
  slice: LegacyTerminalPresentationSliceV1Type,
  projectId: ProjectId,
): ProjectWorkspaceTerminalPresentationSliceType {
  return {
    slice: "terminal-presentation",
    projectId,
    presentationMode: slice.presentationMode,
    workspaceTab: slice.workspaceTab,
    workspaceLayout: slice.workspaceLayout,
    terminalHeightPx: slice.terminalHeightPx,
    terminalIds: [...slice.terminalIds],
    activeTerminalId: slice.activeTerminalId,
    // v1 labels were optional; the canonical v2 default for absent labels is
    // the empty record (never borrowed from another Thread).
    terminalLabelsById: { ...slice.terminalLabelsById },
  };
}

function convertBrowser(
  slice: LegacyBrowserSliceV1Type,
  projectId: ProjectId,
): ProjectWorkspaceBrowserSliceType {
  // `version`, `lastError`, `runtimeSurface`, and `status` are incidental
  // runtime metadata for the browser slice itself; the v2 slice keeps
  // id/url/title. The persisted `lastError` diagnostic is preserved on the
  // winner's migrated browser DOCK pane instead (see convertRightDock) — the
  // browser slice schema deliberately carries no diagnostic field.
  return {
    slice: "browser",
    projectId,
    open: slice.open,
    activeTabId: slice.activeTabId,
    tabs: slice.tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title })),
  };
}

function convertDevice(
  slice: LegacyDeviceSliceV1Type,
  projectId: ProjectId,
): ProjectWorkspaceSliceType {
  return {
    slice: "device",
    projectId,
    attachedDeviceUdid: slice.attachedDeviceUdid,
    attachPhase: slice.attachPhase ?? null,
  };
}

// ── Deterministic keys (Decision 0002 F.3) ───────────────────────────

/** Deterministic staging key for one destination slice of one Project. */
export function projectWorkspaceStagingSliceKey(
  projectId: ProjectId,
  sliceKind: ProjectWorkspaceMigrationSliceKind,
): string {
  return `synara:project-workspace:v2:stage:${projectId}:${sliceKind}`;
}

/** Deterministic publication-marker key for one Project. */
export function projectWorkspacePublicationMarkerKey(projectId: ProjectId): string {
  return `synara:project-workspace:v2:published:${projectId}`;
}

// ── Migration target ─────────────────────────────────────────────────

/** One destination slice paired with its deterministic staging key. */
export interface ProjectWorkspaceStagedSliceEntry {
  readonly key: string;
  readonly slice: ProjectWorkspaceSliceType;
}

/**
 * The complete, deterministic Project-owned destination payload. Derived in
 * full before any of it is made visible; rerunning over the same snapshot
 * reconstructs the identical target, which is what makes retry convergent
 * and partial writes replaceable without reselecting a winner.
 */
export interface ProjectWorkspaceMigrationTarget {
  readonly projectId: ProjectId;
  /**
   * Diagnostic provenance for the winning legacy Thread. It records which v1
   * source was consumed; it never makes that Thread a continuing runtime
   * owner (Decision 0002 D.6). `null` for a Project with no eligible Thread.
   */
  readonly provenance: {
    readonly sourceSchemaVersion: typeof PROJECT_WORKSPACE_LEGACY_SCHEMA_VERSION;
    readonly sourceThreadId: ThreadId;
  } | null;
  readonly stagedEntries: ReadonlyArray<ProjectWorkspaceStagedSliceEntry>;
  readonly publicationMarkerKey: string;
}

function buildMigrationTarget(
  projectId: ProjectId,
  winner: WinnerRecord | null,
): ProjectWorkspaceMigrationTarget {
  const winnerBrowserError =
    winner?.slices.browser !== null &&
    winner?.slices.browser !== undefined &&
    hasMaterialBrowserError(winner.slices.browser)
      ? winner.slices.browser.lastError
      : null;
  const dock =
    winner?.slices.rightDock !== null &&
    winner?.slices.rightDock !== undefined &&
    !isCanonicalDefaultRightDock(winner.slices.rightDock)
      ? convertRightDock(winner.slices.rightDock, projectId, winnerBrowserError)
      : canonicalDefaultDockSlice(projectId);
  const terminal =
    winner?.slices.terminalPresentation !== null &&
    winner?.slices.terminalPresentation !== undefined &&
    !isCanonicalDefaultTerminalPresentation(winner.slices.terminalPresentation)
      ? convertTerminalPresentation(winner.slices.terminalPresentation, projectId)
      : canonicalDefaultTerminalPresentationSlice(projectId);
  const browser =
    winner?.slices.browser !== null &&
    winner?.slices.browser !== undefined &&
    !isCanonicalDefaultBrowser(winner.slices.browser)
      ? convertBrowser(winner.slices.browser, projectId)
      : canonicalDefaultBrowserSlice(projectId);
  const device =
    winner?.slices.device !== null &&
    winner?.slices.device !== undefined &&
    !isCanonicalDefaultDevice(winner.slices.device)
      ? convertDevice(winner.slices.device, projectId)
      : canonicalDefaultDeviceSlice(projectId);
  // Legacy v1 had no persisted Project-owned annotation slice, so annotations
  // always start from the canonical default — never borrowed from any Thread.
  const annotations = canonicalDefaultAnnotationsSlice(projectId);
  const kinds = PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS;
  const slices: ReadonlyArray<ProjectWorkspaceSliceType> = [
    dock,
    terminal,
    browser,
    annotations,
    device,
  ];
  return {
    projectId,
    provenance:
      winner === null
        ? null
        : {
            sourceSchemaVersion: PROJECT_WORKSPACE_LEGACY_SCHEMA_VERSION,
            sourceThreadId: winner.thread.threadId,
          },
    stagedEntries: slices.map((slice, index) => {
      // Safe co-indexing: `slices` is built in the exact canonical order of
      // `kinds` two lines above, so a missing entry is a programming error,
      // never a data condition. Fail closed instead of fabricating a key.
      const kind = kinds[index];
      if (kind === undefined) {
        throw new Error(`projectWorkspaceMigration: staged slice ${index} has no canonical kind`);
      }
      return {
        key: projectWorkspaceStagingSliceKey(projectId, kind),
        slice,
      };
    }),
    publicationMarkerKey: projectWorkspacePublicationMarkerKey(projectId),
  };
}

// ── Staging completeness and published-target precedence ─────────────

/**
 * True exactly when the staged payload carries one valid current-version v2
 * slice of every kind for the EXPECTED Project — no missing kind, no
 * duplicate kind, no invalid or legacy member, and no slice owned by a
 * different Project. A mixed-Project payload is incomplete: it can never
 * satisfy the gate for any single Project (Decision 0002 E.2/F.4 plus
 * Project isolation).
 */
export function isProjectWorkspaceStagingComplete(
  stagedSlices: ReadonlyArray<unknown>,
  expectedProjectId: ProjectId,
): boolean {
  const seen = new Set<string>();
  for (const raw of stagedSlices) {
    const slice = decodeOr(ProjectWorkspaceSlice, raw);
    if (slice === null) {
      return false;
    }
    if (slice.projectId !== expectedProjectId) {
      return false;
    }
    if (!SLICE_KIND_SET.has(slice.slice) || seen.has(slice.slice)) {
      return false;
    }
    seen.add(slice.slice);
  }
  return seen.size === PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS.length;
}

function isStaleSchemaVersionMarker(rawMarker: unknown): boolean {
  if (typeof rawMarker !== "object" || rawMarker === null) {
    return false;
  }
  const version = (rawMarker as { readonly schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" && version !== PROJECT_WORKSPACE_SCHEMA_VERSION;
}

export type ProjectWorkspacePublishedTargetStatus =
  | { readonly status: "published-current" }
  | {
      readonly status: "unpublished";
      readonly reason:
        | "marker-absent"
        | "marker-invalid"
        | "marker-stale-version"
        | "marker-other-project"
        | "staging-incomplete"
        | "staging-mixed-project";
    };

/**
 * Inspect an already-written destination payload for the expected Project.
 *
 * `published-current` requires, in order: a marker that decodes against the
 * current marker schema with `projectId === expectedProjectId`, and a
 * complete staged payload whose every decoded slice also carries
 * `projectId === expectedProjectId`. Project identity is checked BEFORE the
 * `published-current` verdict is ever returned, so a well-formed marker for
 * another Project — or a valid slice set containing another Project's slice —
 * can never publish or activate as this Project's canonical data.
 *
 * Anything else is unpublished and retryable by re-deriving the same
 * deterministic target from retained v1 inputs (Decision 0002 E.2–E.3).
 */
export function inspectProjectWorkspacePublishedTarget(
  input: ProjectWorkspacePublishedTargetInput,
  expectedProjectId: ProjectId,
): ProjectWorkspacePublishedTargetStatus {
  const rawMarker = input.publicationMarker;
  if (rawMarker === null || rawMarker === undefined) {
    return { status: "unpublished", reason: "marker-absent" };
  }
  const marker = decodeOr(ProjectWorkspacePublicationMarker, rawMarker);
  if (marker === null) {
    return isStaleSchemaVersionMarker(rawMarker)
      ? { status: "unpublished", reason: "marker-stale-version" }
      : { status: "unpublished", reason: "marker-invalid" };
  }
  if (marker.projectId !== expectedProjectId) {
    return { status: "unpublished", reason: "marker-other-project" };
  }
  if (!isProjectWorkspaceStagingComplete(input.stagedSlices, expectedProjectId)) {
    const mixed = input.stagedSlices.some((raw) => {
      const slice = decodeOr(ProjectWorkspaceSlice, raw);
      return slice !== null && slice.projectId !== expectedProjectId;
    });
    return mixed
      ? { status: "unpublished", reason: "staging-mixed-project" }
      : { status: "unpublished", reason: "staging-incomplete" };
  }
  return { status: "published-current" };
}

// ── Activation gate ──────────────────────────────────────────────────

/**
 * Readers may treat Project-owned workspace data as canonical only when the
 * server advertises the Project workspace capability AND a valid
 * current-version publication marker for the EXPECTED Project exists. Either
 * missing — or a marker belonging to any other Project — keeps the reader on
 * the prior compatible path (Decision 0002 "Failure and rollback
 * implications" plus Project isolation).
 */
export function canActivateProjectWorkspace(input: {
  readonly capabilityPresent: boolean;
  readonly publicationMarker: unknown;
  readonly expectedProjectId: ProjectId;
}): boolean {
  if (!input.capabilityPresent) {
    return false;
  }
  const marker = decodeOr(ProjectWorkspacePublicationMarker, input.publicationMarker);
  return marker !== null && marker.projectId === input.expectedProjectId;
}

// ── The planner ──────────────────────────────────────────────────────

export type ProjectWorkspaceMigrationPlan =
  | { readonly outcome: "keep-published" }
  | {
      readonly outcome: "publish-empty-defaults";
      readonly target: ProjectWorkspaceMigrationTarget;
    }
  | {
      readonly outcome: "migrate-legacy-winner";
      readonly winnerThreadId: ThreadId;
      readonly target: ProjectWorkspaceMigrationTarget;
    };

/**
 * Plan one Project's legacy → Project-owned migration from a stable snapshot.
 *
 * - A valid published current-version target FOR THIS PROJECT wins outright:
 *   `keep-published`, nothing is rederived or overwritten.
 * - Otherwise the deterministic winner is selected and the complete target —
 *   every slice from that one winner, canonical defaults wherever the winner
 *   has an absent, malformed, or default slice — is returned for transactional
 *   staging. The boundary writes the marker only after every staged entry is
 *   durable.
 * - With no eligible Thread the plan publishes the canonical empty workspace
 *   with `null` provenance (Decision 0002 C.5).
 *
 * Deterministic and idempotent: the same snapshot always yields the same
 * plan, independent of input Thread order.
 */
export function planProjectWorkspaceMigration(
  input: ProjectWorkspaceMigrationProjectInput,
): ProjectWorkspaceMigrationPlan {
  const published = inspectProjectWorkspacePublishedTarget(
    input.publishedTarget ?? { publicationMarker: null, stagedSlices: [] },
    input.projectId,
  );
  if (published.status === "published-current") {
    return { outcome: "keep-published" };
  }
  const winner = selectWinnerRecord(input.threads, input.projectId);
  const target = buildMigrationTarget(input.projectId, winner);
  if (winner === null) {
    return { outcome: "publish-empty-defaults", target };
  }
  return { outcome: "migrate-legacy-winner", winnerThreadId: winner.thread.threadId, target };
}
