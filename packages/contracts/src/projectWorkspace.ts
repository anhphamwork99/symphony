// FILE: projectWorkspace.ts
// Purpose: Schema-level Project ownership for the Right-sidebar workspace.
// Layer: Contracts (schema-only; no runtime logic).
// Depends on: baseSchemas entity ids, browserAnnotations bounds.
//
// One Project owns one Right-sidebar workspace (owner-confirmed Project
// Contract, Decision 0002). Every schema here identifies the owning Project by
// its real `ProjectId` — never a `ProjectId` cast to a `ThreadId`, a prefixed
// pseudo-Thread, or a hidden host conversation. `ThreadId` survives only where
// it identifies actual conversation content, e.g. a Side-chat pane's embedded
// conversation or a legacy v1 slice's owning thread.
//
// Contents:
// - Legacy v1 slice sanitizers: validate the Thread-keyed shapes persisted by
//   older builds. They REJECT malformed data; they never repair it (collision
//   policy and defaults are the shared pure migration policy's job).
// - v2 slice schemas: the Project-owned destination shapes.
// - Publication marker: written only after every destination slice for the
//   Project is durably committed; readers compose Project data only after it.
// - Capability constant for WS capability negotiation.

import { Schema } from "effect";

import { ProjectId, ThreadId, TrimmedNonEmptyString, TurnId } from "./baseSchemas";
import { BROWSER_ANNOTATION_MAX_MARKERS } from "./browserAnnotations";

// ── Capability and version vocabulary ────────────────────────────────

/**
 * Advertised by servers that key Right-sidebar workspace operations by the
 * owning Project. Optional (like `projects.github-provisioning`) so an older
 * server never blocks a newer client's core chat surface during rollout.
 */
export const PROJECT_WORKSPACE_CAPABILITY = "project.right-sidebar-workspace";

/** Current Project-owned workspace schema version (v1 = legacy Thread-owned). */
export const PROJECT_WORKSPACE_SCHEMA_VERSION = 2 as const;

/** Source schema version every legacy slice this module can validate carries. */
export const PROJECT_WORKSPACE_LEGACY_SCHEMA_VERSION = 1 as const;

// ── Shared bounds ────────────────────────────────────────────────────

// Schema-level floors/ceilings only; UI policy (min readable pane, half-shell
// defaults) stays with the web sizing helpers.
export const PROJECT_WORKSPACE_DOCK_MIN_WIDTH_PX = 256;
export const PROJECT_WORKSPACE_DOCK_MAX_WIDTH_PX = 8_192;
export const PROJECT_WORKSPACE_TERMINAL_HEIGHT_MIN_PX = 80;
export const PROJECT_WORKSPACE_TERMINAL_HEIGHT_MAX_PX = 8_192;
export const PROJECT_WORKSPACE_MAX_PANES = 32;
export const PROJECT_WORKSPACE_MAX_TERMINALS = 64;
export const PROJECT_WORKSPACE_MAX_BROWSER_TABS = 16;
export const PROJECT_WORKSPACE_URL_MAX_LENGTH = 8_192;
export const PROJECT_WORKSPACE_TITLE_MAX_LENGTH = 256;
export const PROJECT_WORKSPACE_PANE_ID_MAX_LENGTH = 128;
export const PROJECT_WORKSPACE_TERMINAL_ID_MAX_LENGTH = 128;
export const PROJECT_WORKSPACE_DIAGNOSTIC_MAX_LENGTH = 2_048;
export const PROJECT_WORKSPACE_TAB_ID_MAX_LENGTH = 128;

const PaneId = TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WORKSPACE_PANE_ID_MAX_LENGTH));
const TerminalId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_WORKSPACE_TERMINAL_ID_MAX_LENGTH),
);
const TabId = TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WORKSPACE_TAB_ID_MAX_LENGTH));
const BoundedUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WORKSPACE_URL_MAX_LENGTH));
const BoundedTitle = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_WORKSPACE_TITLE_MAX_LENGTH),
);
const Diagnostic = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_WORKSPACE_DIAGNOSTIC_MAX_LENGTH),
);

// Terminal display labels: keyed by terminal id, bounded by the terminal
// ceiling so a labels record can never outgrow the slice it belongs to.
const TerminalLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_WORKSPACE_TITLE_MAX_LENGTH),
);
const TerminalLabelsById = Schema.Record(TerminalId, TerminalLabel).check(
  Schema.isMaxProperties(PROJECT_WORKSPACE_MAX_TERMINALS),
);

// Referential invariants shared by v2 slices and v1 sanitizers. These are
// declaration-level refinements on already-decoded shapes — no runtime module
// behavior, no repair. A violation fails decoding, so the shared migration
// policy treats the slice as malformed per Decision 0002 B.
function hasDuplicate(values: ReadonlyArray<string>): boolean {
  return new Set(values).size !== values.length;
}

/** Terminal labels may only name terminals that appear in `terminalIds`. */
function labelsNameKnownTerminals(
  terminalIds: ReadonlyArray<string>,
  terminalLabelsById: Readonly<Record<string, string>>,
): boolean {
  return Object.keys(terminalLabelsById).every((key) => terminalIds.includes(key));
}

const DockPreferredWidthPx = Schema.Int.check(
  Schema.isBetween({
    minimum: PROJECT_WORKSPACE_DOCK_MIN_WIDTH_PX,
    maximum: PROJECT_WORKSPACE_DOCK_MAX_WIDTH_PX,
  }),
);
const TerminalHeightPx = Schema.Int.check(
  Schema.isBetween({
    minimum: PROJECT_WORKSPACE_TERMINAL_HEIGHT_MIN_PX,
    maximum: PROJECT_WORKSPACE_TERMINAL_HEIGHT_MAX_PX,
  }),
);

// ── v2 pane kinds and descriptors ────────────────────────────────────

// Same pane-kind vocabulary the dock renders today; the tab system, tool
// types, and tool-opening interactions are unchanged by Project ownership.
export const PROJECT_WORKSPACE_PANE_KINDS = [
  "browser",
  "device",
  "diff",
  "explorer",
  "file",
  "terminal",
  "sidechat",
  "git",
  "pullRequest",
] as const;
export type ProjectWorkspacePaneKind = (typeof PROJECT_WORKSPACE_PANE_KINDS)[number];

export const ProjectWorkspacePaneKind = Schema.Literals(PROJECT_WORKSPACE_PANE_KINDS);

export const PullRequestInitialTab = Schema.Literals(["summary", "timeline", "code"]);
export type PullRequestInitialTab = typeof PullRequestInitialTab.Type;

/**
 * A Project-owned dock pane descriptor.
 *
 * Nested content identities stay in their native domains: a `sidechat` pane
 * references the real conversation it embeds by `ThreadId`; diff panes keep
 * their `TurnId`; pull-request panes keep the pull request's own project
 * identity. None of these makes the referenced entity the workspace owner.
 *
 * `restorationDiagnostic` carries the explicit failure when the pane's backing
 * content cannot be restored — the pane is retained, never silently removed or
 * replaced by a default.
 */
export const ProjectWorkspacePaneDescriptor = Schema.Struct({
  id: PaneId,
  kind: ProjectWorkspacePaneKind,
  /** Real embedded conversation for `sidechat` panes; null otherwise. */
  threadId: Schema.NullOr(ThreadId),
  /** Real conversation turn backing a `diff` pane; null otherwise. */
  diffTurnId: Schema.NullOr(TurnId),
  diffFilePath: Schema.NullOr(TrimmedNonEmptyString),
  filePath: Schema.NullOr(TrimmedNonEmptyString),
  pullRequestProjectId: Schema.NullOr(ProjectId),
  pullRequestRepository: Schema.NullOr(TrimmedNonEmptyString),
  pullRequestNumber: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  pullRequestInitialTab: Schema.NullOr(PullRequestInitialTab),
  restorationDiagnostic: Schema.optional(Schema.NullOr(Diagnostic)),
});
export type ProjectWorkspacePaneDescriptor = typeof ProjectWorkspacePaneDescriptor.Type;

// ── v2 slices ────────────────────────────────────────────────────────

/**
 * Right-dock visibility, preferred width, tab order, and active tab.
 *
 * `preferredWidthPx` is the ONLY persisted dock width. Rendering-time
 * clamping never writes it back, so there is no separate geometry slice: a
 * runtime effective width is derived at render, not persisted.
 */
export const ProjectWorkspaceDockSlice = Schema.Struct({
  slice: Schema.Literal("right-dock"),
  projectId: ProjectId,
  open: Schema.Boolean,
  /**
   * The remembered preference. A temporary viewport clamp never overwrites it;
   * clamping is rendering-time only, so only user-intended widths persist here.
   */
  preferredWidthPx: Schema.NullOr(DockPreferredWidthPx),
  panes: Schema.Array(ProjectWorkspacePaneDescriptor).check(
    Schema.isMaxLength(PROJECT_WORKSPACE_MAX_PANES),
    Schema.makeFilter((panes) => !hasDuplicate(panes.map((pane) => pane.id))),
  ),
  /** Null means no active pane; otherwise it must name exactly one pane. */
  activePaneId: Schema.NullOr(PaneId),
}).check(
  Schema.makeFilter(
    (dock) =>
      dock.activePaneId === null ||
      dock.panes.some((pane) => pane.id === dock.activePaneId),
  ),
);
export type ProjectWorkspaceDockSlice = typeof ProjectWorkspaceDockSlice.Type;

export const ProjectWorkspaceTerminalPresentationMode = Schema.Literals(["drawer", "workspace"]);
export type ProjectWorkspaceTerminalPresentationMode =
  typeof ProjectWorkspaceTerminalPresentationMode.Type;

export const ProjectWorkspaceTerminalWorkspaceTab = Schema.Literals(["terminal", "chat"]);
export type ProjectWorkspaceTerminalWorkspaceTab =
  typeof ProjectWorkspaceTerminalWorkspaceTab.Type;

export const ProjectWorkspaceTerminalWorkspaceLayout = Schema.Literals(["both", "terminal-only"]);
export type ProjectWorkspaceTerminalWorkspaceLayout =
  typeof ProjectWorkspaceTerminalWorkspaceLayout.Type;

/** Terminal presentation selection and per-terminal display labels. */
export const ProjectWorkspaceTerminalPresentationSlice = Schema.Struct({
  slice: Schema.Literal("terminal-presentation"),
  projectId: ProjectId,
  presentationMode: ProjectWorkspaceTerminalPresentationMode,
  workspaceTab: ProjectWorkspaceTerminalWorkspaceTab,
  workspaceLayout: ProjectWorkspaceTerminalWorkspaceLayout,
  terminalHeightPx: TerminalHeightPx,
  terminalIds: Schema.Array(TerminalId).check(
    Schema.isUnique(),
    Schema.isMaxLength(PROJECT_WORKSPACE_MAX_TERMINALS),
  ),
  activeTerminalId: TerminalId,
  /** Required in v2: every Project terminal can carry a display label. */
  terminalLabelsById: TerminalLabelsById,
}).check(
  Schema.makeFilter(
    (slice) =>
      slice.terminalIds.includes(slice.activeTerminalId) &&
      labelsNameKnownTerminals(slice.terminalIds, slice.terminalLabelsById),
  ),
);
export type ProjectWorkspaceTerminalPresentationSlice =
  typeof ProjectWorkspaceTerminalPresentationSlice.Type;

/** Browser tab metadata the Project workspace restores (native surfaces stay desktop-side). */
export const ProjectWorkspaceBrowserTab = Schema.Struct({
  id: TabId,
  url: BoundedUrl,
  title: BoundedTitle,
});
export type ProjectWorkspaceBrowserTab = typeof ProjectWorkspaceBrowserTab.Type;

export const ProjectWorkspaceBrowserSlice = Schema.Struct({
  slice: Schema.Literal("browser"),
  projectId: ProjectId,
  open: Schema.Boolean,
  /** Null means no active tab; otherwise it must name exactly one tab. */
  activeTabId: Schema.NullOr(TabId),
  tabs: Schema.Array(ProjectWorkspaceBrowserTab).check(
    Schema.isMaxLength(PROJECT_WORKSPACE_MAX_BROWSER_TABS),
    Schema.makeFilter((tabs) => !hasDuplicate(tabs.map((tab) => tab.id))),
  ),
}).check(
  Schema.makeFilter(
    (slice) => slice.activeTabId === null || slice.tabs.some((tab) => tab.id === slice.activeTabId),
  ),
);
export type ProjectWorkspaceBrowserSlice = typeof ProjectWorkspaceBrowserSlice.Type;

/** Persisted browser annotation markers projected onto the owning Project. */
export const ProjectWorkspaceAnnotationMarker = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  tabId: TabId,
  ordinal: Schema.Int.check(Schema.isGreaterThan(0)),
  documentKey: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type ProjectWorkspaceAnnotationMarker = typeof ProjectWorkspaceAnnotationMarker.Type;

export const ProjectWorkspaceAnnotationsSlice = Schema.Struct({
  slice: Schema.Literal("browser-annotations"),
  projectId: ProjectId,
  markers: Schema.Array(ProjectWorkspaceAnnotationMarker).check(
    Schema.isMaxLength(BROWSER_ANNOTATION_MAX_MARKERS),
  ),
});
export type ProjectWorkspaceAnnotationsSlice = typeof ProjectWorkspaceAnnotationsSlice.Type;

/** Device attachment intent and reconnect metadata (descriptor lists stay live). */
export const ProjectWorkspaceDeviceSlice = Schema.Struct({
  slice: Schema.Literal("device"),
  projectId: ProjectId,
  attachedDeviceUdid: Schema.NullOr(TrimmedNonEmptyString),
  attachPhase: Schema.optional(
    Schema.NullOr(Schema.Literals(["booting", "waiting-for-display", "connecting"])),
  ),
});
export type ProjectWorkspaceDeviceSlice = typeof ProjectWorkspaceDeviceSlice.Type;

/** Union of every Project-owned v2 workspace slice. */
export const ProjectWorkspaceSlice = Schema.Union([
  ProjectWorkspaceDockSlice,
  ProjectWorkspaceTerminalPresentationSlice,
  ProjectWorkspaceBrowserSlice,
  ProjectWorkspaceAnnotationsSlice,
  ProjectWorkspaceDeviceSlice,
]);
export type ProjectWorkspaceSlice = typeof ProjectWorkspaceSlice.Type;

// ── Publication marker ───────────────────────────────────────────────

/**
 * Provenance for diagnosing which legacy thread a migration consumed. The
 * winning `ThreadId` is diagnostic history only — it never becomes a runtime
 * owner or host conversation.
 */
export const ProjectWorkspaceMigrationProvenance = Schema.Struct({
  sourceSchemaVersion: Schema.Literals([PROJECT_WORKSPACE_LEGACY_SCHEMA_VERSION] as const),
  sourceThreadId: ThreadId,
});
export type ProjectWorkspaceMigrationProvenance =
  typeof ProjectWorkspaceMigrationProvenance.Type;

/**
 * Durable publication record for one Project's workspace. A boundary writes it
 * only after every destination slice for that Project is durably committed;
 * until it exists, readers must not treat staged Project data as canonical.
 * Presence of a valid marker means published Project data wins and legacy
 * migration must not overwrite it.
 */
export const ProjectWorkspacePublicationMarker = Schema.Struct({
  projectId: ProjectId,
  schemaVersion: Schema.Literals([PROJECT_WORKSPACE_SCHEMA_VERSION] as const),
  publishedAt: TrimmedNonEmptyString,
  provenance: Schema.NullOr(ProjectWorkspaceMigrationProvenance),
});
export type ProjectWorkspacePublicationMarker = typeof ProjectWorkspacePublicationMarker.Type;

// ── Legacy v1 slice sanitizers ───────────────────────────────────────
//
// Validate the Thread-keyed shapes older builds persisted. Malformed data does
// not become valid merely because a key exists: decoding fails, and the
// migration treats the slice as absent/malformed per Decision 0002 B.

const LegacyPaneKind = Schema.Literals(PROJECT_WORKSPACE_PANE_KINDS);

export const LegacyRightDockPaneV1 = Schema.Struct({
  id: PaneId,
  kind: LegacyPaneKind,
  threadId: Schema.NullOr(ThreadId),
  diffTurnId: Schema.NullOr(TurnId),
  diffFilePath: Schema.NullOr(TrimmedNonEmptyString),
  filePath: Schema.NullOr(TrimmedNonEmptyString),
  pullRequestProjectId: Schema.NullOr(ProjectId),
  pullRequestRepository: Schema.NullOr(TrimmedNonEmptyString),
  pullRequestNumber: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  pullRequestInitialTab: Schema.NullOr(PullRequestInitialTab),
});
export type LegacyRightDockPaneV1 = typeof LegacyRightDockPaneV1.Type;

/** One Thread's persisted right-dock state (`synara:right-dock-state:v1`). */
export const LegacyRightDockSliceV1 = Schema.Struct({
  threadId: ThreadId,
  open: Schema.Boolean,
  panes: Schema.Array(LegacyRightDockPaneV1).check(
    Schema.isMaxLength(PROJECT_WORKSPACE_MAX_PANES),
    Schema.makeFilter((panes) => !hasDuplicate(panes.map((pane) => pane.id))),
  ),
  /** Null means no active pane; otherwise it must name exactly one pane. */
  activePaneId: Schema.NullOr(PaneId),
}).check(
  Schema.makeFilter(
    (slice) =>
      slice.activePaneId === null || slice.panes.some((pane) => pane.id === slice.activePaneId),
  ),
);
export type LegacyRightDockSliceV1 = typeof LegacyRightDockSliceV1.Type;

/** One Thread's persisted terminal presentation (`synara:terminal-state:v1`). */
export const LegacyTerminalPresentationSliceV1 = Schema.Struct({
  threadId: ThreadId,
  presentationMode: ProjectWorkspaceTerminalPresentationMode,
  workspaceTab: ProjectWorkspaceTerminalWorkspaceTab,
  workspaceLayout: ProjectWorkspaceTerminalWorkspaceLayout,
  terminalHeightPx: TerminalHeightPx,
  terminalIds: Schema.Array(TerminalId).check(
    Schema.isUnique(),
    Schema.isMaxLength(PROJECT_WORKSPACE_MAX_TERMINALS),
  ),
  activeTerminalId: TerminalId,
  /**
   * Optional in v1: older builds persisted no labels at all. The shared
   * migration policy synthesizes the canonical v2 `{}` default for it.
   */
  terminalLabelsById: Schema.optional(TerminalLabelsById),
}).check(
  Schema.makeFilter(
    (slice) =>
      slice.terminalIds.includes(slice.activeTerminalId) &&
      (slice.terminalLabelsById === undefined ||
        labelsNameKnownTerminals(slice.terminalIds, slice.terminalLabelsById)),
  ),
);
export type LegacyTerminalPresentationSliceV1 = typeof LegacyTerminalPresentationSliceV1.Type;

export const LegacyBrowserTabV1 = Schema.Struct({
  id: TabId,
  url: BoundedUrl,
  title: BoundedTitle,
  runtimeSurface: Schema.optional(Schema.Literals(["native", "renderer"])),
  status: Schema.optional(Schema.Literals(["live", "suspended"])),
});

/** One Thread's browser workspace state as persisted by desktop/automation. */
export const LegacyBrowserSliceV1 = Schema.Struct({
  threadId: ThreadId,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  open: Schema.Boolean,
  /** Null means no active tab; otherwise it must name exactly one tab. */
  activeTabId: Schema.NullOr(TabId),
  tabs: Schema.Array(LegacyBrowserTabV1).check(
    Schema.isMaxLength(PROJECT_WORKSPACE_MAX_BROWSER_TABS),
    Schema.makeFilter((tabs) => !hasDuplicate(tabs.map((tab) => tab.id))),
  ),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
}).check(
  Schema.makeFilter(
    (slice) => slice.activeTabId === null || slice.tabs.some((tab) => tab.id === slice.activeTabId),
  ),
);
export type LegacyBrowserSliceV1 = typeof LegacyBrowserSliceV1.Type;

/** One Thread's device attachment/reconnect metadata. */
export const LegacyDeviceSliceV1 = Schema.Struct({
  threadId: ThreadId,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  attachedDeviceUdid: Schema.NullOr(TrimmedNonEmptyString),
  attachPhase: Schema.optional(
    Schema.NullOr(Schema.Literals(["booting", "waiting-for-display", "connecting"])),
  ),
});
export type LegacyDeviceSliceV1 = typeof LegacyDeviceSliceV1.Type;

/** Every legacy slice one Thread may have contributed, validated together. */
export const LegacyThreadWorkspaceSlicesV1 = Schema.Struct({
  threadId: ThreadId,
  rightDock: Schema.optional(LegacyRightDockSliceV1),
  terminalPresentation: Schema.optional(LegacyTerminalPresentationSliceV1),
  browser: Schema.optional(LegacyBrowserSliceV1),
  device: Schema.optional(LegacyDeviceSliceV1),
});
export type LegacyThreadWorkspaceSlicesV1 = typeof LegacyThreadWorkspaceSlicesV1.Type;

/** Union of every v1 sanitizer this module can validate. */
export const LegacyWorkspaceSliceV1 = Schema.Union([
  LegacyRightDockSliceV1,
  LegacyTerminalPresentationSliceV1,
  LegacyBrowserSliceV1,
  LegacyDeviceSliceV1,
]);
export type LegacyWorkspaceSliceV1 = typeof LegacyWorkspaceSliceV1.Type;
