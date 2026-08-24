import {
  ProjectId,
  type ProjectId as ProjectIdType,
  ThreadId,
  type ThreadId as ThreadIdType,
} from "@synara/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  canActivateProjectWorkspace,
  inspectProjectWorkspacePublishedTarget,
  isLegacyProjectWorkspaceCandidate,
  isProjectWorkspaceStagingComplete,
  normalizeLegacyInstant,
  planProjectWorkspaceMigration,
  projectWorkspacePublicationMarkerKey,
  projectWorkspaceStagingSliceKey,
  PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS,
  selectLegacyProjectWorkspaceWinner,
  type LegacyProjectWorkspaceThreadInput,
} from "./projectWorkspaceMigration";

const PROJECT_ID: ProjectIdType = ProjectId.makeUnsafe("project-1");
const OTHER_PROJECT_ID: ProjectIdType = ProjectId.makeUnsafe("project-2");

// ── Fixture builders ─────────────────────────────────────────────────

function pane(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pane-1",
    kind: "terminal",
    threadId: null,
    diffTurnId: null,
    diffFilePath: null,
    filePath: null,
    pullRequestProjectId: null,
    pullRequestRepository: null,
    pullRequestNumber: null,
    pullRequestInitialTab: null,
    ...overrides,
  };
}

function validRightDock(threadId: ThreadIdType): Record<string, unknown> {
  return {
    threadId,
    open: true,
    panes: [pane({ id: "pane-a" }), pane({ id: "pane-b", kind: "sidechat", threadId: "side-1" })],
    activePaneId: "pane-a",
  };
}

function validTerminalPresentation(threadId: ThreadIdType): Record<string, unknown> {
  return {
    threadId,
    presentationMode: "workspace",
    workspaceTab: "terminal",
    workspaceLayout: "both",
    terminalHeightPx: 320,
    terminalIds: ["default", "shell-2"],
    activeTerminalId: "shell-2",
    terminalLabelsById: { default: "Terminal 1" },
  };
}

function validBrowser(threadId: ThreadIdType): Record<string, unknown> {
  return {
    threadId,
    version: 3,
    open: true,
    activeTabId: "tab-1",
    tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
    lastError: null,
  };
}

function validDevice(threadId: ThreadIdType): Record<string, unknown> {
  return {
    threadId,
    version: 1,
    attachedDeviceUdid: "11111111-2222-3333-4444-555555555555",
  };
}

interface ThreadFixture {
  readonly id: string;
  readonly projectId?: ProjectIdType;
  readonly updatedAt?: string;
  readonly deletedAt?: string | null;
  readonly archivedAt?: string | null;
  readonly slices?: Record<string, unknown>;
}

function thread(fixture: ThreadFixture): LegacyProjectWorkspaceThreadInput {
  return {
    threadId: ThreadId.makeUnsafe(fixture.id),
    projectId: fixture.projectId ?? PROJECT_ID,
    updatedAt: fixture.updatedAt ?? "2026-01-01T00:00:00.000Z",
    deletedAt: fixture.deletedAt ?? null,
    archivedAt: fixture.archivedAt ?? null,
    slices: fixture.slices ?? { rightDock: validRightDock(ThreadId.makeUnsafe(fixture.id)) },
  };
}

// ── normalizeLegacyInstant ───────────────────────────────────────────

describe("normalizeLegacyInstant", () => {
  it("normalizes equivalent instants to one comparable value", () => {
    expect(normalizeLegacyInstant("2026-01-02T03:04:05.000Z")).toBe(
      normalizeLegacyInstant("2026-01-02T04:04:05.000+01:00"),
    );
  });

  it("accepts a fractional-seconds instant", () => {
    expect(typeof normalizeLegacyInstant("2026-01-02T03:04:05.123Z")).toBe("number");
  });

  it("rejects date-only, locale-formatted, offset-less, and garbage strings", () => {
    for (const bad of [
      "2026-01-02",
      "01/02/2026, 03:04:05",
      "2026-01-02 03:04:05",
      "Jan 2, 2026",
      "",
      "not-a-date",
    ]) {
      expect(normalizeLegacyInstant(bad)).toBeNull();
    }
  });
});

// ── Candidate eligibility (Decision 0002 B) ──────────────────────────

describe("isLegacyProjectWorkspaceCandidate", () => {
  it("accepts a live Thread with one valid non-default slice", () => {
    expect(isLegacyProjectWorkspaceCandidate(thread({ id: "t-live" }), PROJECT_ID)).toBe(true);
  });

  it("accepts an archived Thread (archivedAt does not disqualify)", () => {
    expect(
      isLegacyProjectWorkspaceCandidate(
        thread({ id: "t-archived", archivedAt: "2025-06-01T00:00:00.000Z" }),
        PROJECT_ID,
      ),
    ).toBe(true);
  });

  it("rejects a Thread belonging to a different Project", () => {
    expect(
      isLegacyProjectWorkspaceCandidate(
        thread({ id: "t-other", projectId: OTHER_PROJECT_ID }),
        PROJECT_ID,
      ),
    ).toBe(false);
  });

  it("rejects a deleted Thread even with stale valid v1 slices", () => {
    expect(
      isLegacyProjectWorkspaceCandidate(
        thread({ id: "t-deleted", deletedAt: "2025-12-31T23:59:59.000Z" }),
        PROJECT_ID,
      ),
    ).toBe(false);
  });

  it("rejects a Thread with no slices at all", () => {
    expect(
      isLegacyProjectWorkspaceCandidate(thread({ id: "t-empty", slices: {} }), PROJECT_ID),
    ).toBe(false);
  });

  it("rejects a Thread whose only slices are malformed", () => {
    const bad: LegacyProjectWorkspaceThreadInput = {
      threadId: ThreadId.makeUnsafe("t-malformed"),
      projectId: PROJECT_ID,
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      archivedAt: null,
      slices: {
        rightDock: { threadId: "t-malformed", open: "yes", panes: "nope" },
        terminalPresentation: { threadId: "t-malformed", presentationMode: 7 },
        browser: { threadId: "t-malformed", version: -1, tabs: "x" },
        device: { threadId: "t-malformed", version: "one" },
      },
    };
    expect(isLegacyProjectWorkspaceCandidate(bad, PROJECT_ID)).toBe(false);
  });

  it("rejects a Thread whose slice claims another ThreadId", () => {
    expect(
      isLegacyProjectWorkspaceCandidate(
        thread({
          id: "t-hijacker",
          slices: { rightDock: validRightDock(ThreadId.makeUnsafe("someone-else")) },
        }),
        PROJECT_ID,
      ),
    ).toBe(false);
  });

  it("rejects a Thread whose only slices are canonically default", () => {
    const canonicalDefaultThread = thread({
      id: "t-default",
      slices: {
        rightDock: { threadId: "t-default", open: false, panes: [], activePaneId: null },
        terminalPresentation: {
          threadId: "t-default",
          presentationMode: "drawer",
          workspaceTab: "terminal",
          workspaceLayout: "both",
          terminalHeightPx: 280,
          terminalIds: ["default"],
          activeTerminalId: "default",
          terminalLabelsById: { default: "Terminal 1" },
        },
        browser: {
          threadId: "t-default",
          version: 0,
          open: false,
          activeTabId: null,
          tabs: [],
          lastError: null,
        },
        device: { threadId: "t-default", version: 0, attachedDeviceUdid: null },
      },
    });
    expect(isLegacyProjectWorkspaceCandidate(canonicalDefaultThread, PROJECT_ID)).toBe(false);
  });

  it("treats one valid non-default slice among default ones as sufficient", () => {
    expect(
      isLegacyProjectWorkspaceCandidate(
        thread({
          id: "t-one-good",
          slices: {
            rightDock: { threadId: "t-one-good", open: false, panes: [], activePaneId: null },
            terminalPresentation: {
              threadId: "t-one-good",
              presentationMode: "drawer",
              workspaceTab: "terminal",
              workspaceLayout: "both",
              terminalHeightPx: 280,
              terminalIds: ["default"],
              activeTerminalId: "default",
            },
            browser: {
              threadId: "t-one-good",
              version: 0,
              open: false,
              activeTabId: null,
              tabs: [],
              lastError: null,
            },
            device: validDevice(ThreadId.makeUnsafe("t-one-good")),
          },
        }),
        PROJECT_ID,
      ),
    ).toBe(true);
  });

  it("fails closed on an unparsable durable updatedAt", () => {
    expect(
      isLegacyProjectWorkspaceCandidate(
        thread({ id: "t-badtime", updatedAt: "yesterday" }),
        PROJECT_ID,
      ),
    ).toBe(false);
  });

  // Remediation (2): terminal-label canonical-default coverage.
  it("treats undefined, empty, and exact-legacy-default labels as canonical default", () => {
    const labelsVariants: Array<Record<string, string> | undefined> = [
      undefined,
      {},
      { default: "Terminal 1" },
    ];
    for (const terminalLabelsById of labelsVariants) {
      const candidate = thread({
        id: "t-label-default",
        slices: {
          rightDock: { threadId: "t-label-default", open: false, panes: [], activePaneId: null },
          terminalPresentation: {
            threadId: "t-label-default",
            presentationMode: "drawer",
            workspaceTab: "terminal",
            workspaceLayout: "both",
            terminalHeightPx: 280,
            terminalIds: ["default"],
            activeTerminalId: "default",
            terminalLabelsById,
          },
        },
      });
      expect(isLegacyProjectWorkspaceCandidate(candidate, PROJECT_ID)).toBe(false);
    }
  });

  it("treats any other terminal label content as material", () => {
    // Isolated on the canonical default terminal: `terminalIds` stays exactly
    // `["default"]`, so only the label content — never an extra terminal ID —
    // makes the slice non-default here. A label naming a terminal outside
    // `terminalIds` never reaches this question: final WP1 rejects it at the
    // schema, and the Thread below covers that fail-closed path.
    for (const terminalLabelsById of [{ default: "Build server" }, { default: "t" }]) {
      const candidate = thread({
        id: "t-label-material",
        slices: {
          rightDock: { threadId: "t-label-material", open: false, panes: [], activePaneId: null },
          terminalPresentation: {
            threadId: "t-label-material",
            presentationMode: "drawer",
            workspaceTab: "terminal",
            workspaceLayout: "both",
            terminalHeightPx: 280,
            terminalIds: ["default"],
            activeTerminalId: "default",
            terminalLabelsById,
          },
        },
      });
      expect(isLegacyProjectWorkspaceCandidate(candidate, PROJECT_ID)).toBe(true);
    }
  });

  it("fails closed on a label naming a terminal outside terminalIds", () => {
    // `{ "shell-2": "Terminal 1" }` with `terminalIds: ["default"]` is a
    // dangling label: final WP1's `labelsNameKnownTerminals` refinement
    // rejects the slice at the schema, the policy treats it as absent, and the
    // Thread — whose dock is canonically default — is not a candidate. Label
    // materiality is never inferred from a terminal the list does not back.
    const candidate = thread({
      id: "t-label-dangling",
      slices: {
        rightDock: { threadId: "t-label-dangling", open: false, panes: [], activePaneId: null },
        terminalPresentation: {
          threadId: "t-label-dangling",
          presentationMode: "drawer",
          workspaceTab: "terminal",
          workspaceLayout: "both",
          terminalHeightPx: 280,
          terminalIds: ["default"],
          activeTerminalId: "default",
          terminalLabelsById: { "shell-2": "Terminal 1" },
        },
      },
    });
    expect(isLegacyProjectWorkspaceCandidate(candidate, PROJECT_ID)).toBe(false);
  });

  // Remediation (3): pending device attach intent is material.
  it("treats a null udid with a pending attachPhase as material, not default", () => {
    for (const attachPhase of ["booting", "waiting-for-display", "connecting"]) {
      const candidate = thread({
        id: "t-device-pending",
        slices: {
          rightDock: { threadId: "t-device-pending", open: false, panes: [], activePaneId: null },
          device: {
            threadId: "t-device-pending",
            version: 1,
            attachedDeviceUdid: null,
            attachPhase,
          },
        },
      });
      expect(isLegacyProjectWorkspaceCandidate(candidate, PROJECT_ID)).toBe(true);
    }
  });

  it("treats a device slice with null udid and absent/null phase as canonical default", () => {
    for (const attachPhase of [undefined, null]) {
      const candidate = thread({
        id: "t-device-idle",
        slices: {
          rightDock: { threadId: "t-device-idle", open: false, panes: [], activePaneId: null },
          device: { threadId: "t-device-idle", version: 1, attachedDeviceUdid: null, attachPhase },
        },
      });
      expect(isLegacyProjectWorkspaceCandidate(candidate, PROJECT_ID)).toBe(false);
    }
  });

  // Remediation (4): a browser error is material when a browser pane exists.
  it("treats a persisted browser error with a browser pane as material", () => {
    const threadId = ThreadId.makeUnsafe("t-browser-error");
    const candidate = thread({
      id: "t-browser-error",
      slices: {
        rightDock: {
          threadId: "t-browser-error",
          open: true,
          panes: [pane({ id: "pane-browser", kind: "browser" })],
          activePaneId: "pane-browser",
        },
        browser: {
          threadId: "t-browser-error",
          version: 2,
          open: true,
          activeTabId: null,
          tabs: [],
          lastError: "Browser session could not be restored",
        },
      },
    });
    expect(candidate.slices.rightDock).toBeDefined();
    expect(threadId).toBeDefined();
    expect(isLegacyProjectWorkspaceCandidate(candidate, PROJECT_ID)).toBe(true);
  });

  it("does not treat a browser error as material when no browser pane exists", () => {
    const candidate = thread({
      id: "t-browser-error-no-pane",
      slices: {
        rightDock: {
          threadId: "t-browser-error-no-pane",
          open: true,
          panes: [pane({ id: "pane-terminal", kind: "terminal" })],
          activePaneId: "pane-terminal",
        },
        browser: {
          threadId: "t-browser-error-no-pane",
          version: 2,
          open: true,
          activeTabId: null,
          tabs: [],
          lastError: "Browser session could not be restored",
        },
      },
    });
    // The dock itself is non-default here (open + pane), so the Thread is
    // still a candidate — the assertion is about the browser error alone not
    // being the material slice. Use a canonical-default dock to isolate it.
    const isolated = thread({
      id: "t-browser-error-isolated",
      slices: {
        rightDock: {
          threadId: "t-browser-error-isolated",
          open: false,
          panes: [],
          activePaneId: null,
        },
        browser: {
          threadId: "t-browser-error-isolated",
          version: 2,
          open: false,
          activeTabId: null,
          tabs: [],
          lastError: "Browser session could not be restored",
        },
      },
    });
    expect(isLegacyProjectWorkspaceCandidate(candidate, PROJECT_ID)).toBe(true);
    expect(isLegacyProjectWorkspaceCandidate(isolated, PROJECT_ID)).toBe(false);
  });
});

// ── Deterministic winner ordering (Decision 0002 C) ──────────────────

describe("selectLegacyProjectWorkspaceWinner", () => {
  it("selects the newest durable updatedAt across eligible Threads", () => {
    const threads = [
      thread({ id: "t-old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread({ id: "t-new", updatedAt: "2026-03-15T12:00:00.000Z" }),
      thread({ id: "t-middle", updatedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(selectLegacyProjectWorkspaceWinner(threads, PROJECT_ID).winnerThreadId).toBe("t-new");
  });

  it("compares normalized instants, not raw strings", () => {
    // `2026-01-03T01:00:00.000+01:00` normalizes to 2026-01-03T00:00Z —
    // strictly newer than `2026-01-02T23:00:00.000Z` even though the offset
    // string's leading date is larger and would confuse a local-format string
    // comparison (which would pick the older instant).
    const threads = [
      thread({ id: "t-newer-by-instant", updatedAt: "2026-01-03T01:00:00.000+01:00" }),
      thread({ id: "t-zulu", updatedAt: "2026-01-02T23:00:00.000Z" }),
    ];
    expect(selectLegacyProjectWorkspaceWinner(threads, PROJECT_ID).winnerThreadId).toBe(
      "t-newer-by-instant",
    );
  });

  it("breaks an exact tie by lexicographically ascending ThreadId", () => {
    const threads = [
      thread({ id: "t-zulu", updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread({ id: "t-alpha", updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread({ id: "t-mike", updatedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(selectLegacyProjectWorkspaceWinner(threads, PROJECT_ID).winnerThreadId).toBe("t-alpha");
  });

  it("breaks a normalized-instant tie the same way", () => {
    // `2026-01-02T05:00:00.000+01:00` and `2026-01-02T04:00:00.000Z` are the
    // same instant after normalization; the ascending ThreadId tie-break
    // decides, not the differing string representations.
    const threads = [
      thread({ id: "t-b", updatedAt: "2026-01-02T05:00:00.000+01:00" }),
      thread({ id: "t-a", updatedAt: "2026-01-02T04:00:00.000Z" }),
    ];
    expect(selectLegacyProjectWorkspaceWinner(threads, PROJECT_ID).winnerThreadId).toBe("t-a");
  });

  it("is independent of input Thread order", () => {
    const threads = [
      thread({ id: "t-b", updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread({ id: "t-a", updatedAt: "2026-01-01T00:00:00.000Z" }),
      thread({ id: "t-c", updatedAt: "2026-01-05T00:00:00.000Z" }),
    ];
    const forward = selectLegacyProjectWorkspaceWinner(threads, PROJECT_ID).winnerThreadId;
    const reversed = selectLegacyProjectWorkspaceWinner(
      threads.toReversed(),
      PROJECT_ID,
    ).winnerThreadId;
    expect(forward).toBe("t-c");
    expect(reversed).toBe("t-c");
  });

  it("skips ineligible Threads while ordering the eligible ones", () => {
    const defaultOnlyDock = {
      threadId: "t-default-only",
      open: false,
      panes: [],
      activePaneId: null,
    };
    const threads = [
      thread({
        id: "t-deleted",
        deletedAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
      thread({
        id: "t-other-project",
        projectId: OTHER_PROJECT_ID,
        updatedAt: "2026-05-01T00:00:00.000Z",
      }),
      thread({
        id: "t-default-only",
        updatedAt: "2026-04-01T00:00:00.000Z",
        slices: { rightDock: defaultOnlyDock },
      }),
      thread({ id: "t-badtime", updatedAt: "garbage" }),
      thread({ id: "t-winner", updatedAt: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(selectLegacyProjectWorkspaceWinner(threads, PROJECT_ID).winnerThreadId).toBe("t-winner");
  });

  it("returns null when no Thread is eligible", () => {
    expect(selectLegacyProjectWorkspaceWinner([], PROJECT_ID).winnerThreadId).toBeNull();
    const defaultOnly = thread({
      id: "t-default-only",
      slices: {
        rightDock: {
          threadId: "t-default-only",
          open: false,
          panes: [],
          activePaneId: null,
        },
      },
    });
    expect(selectLegacyProjectWorkspaceWinner([defaultOnly], PROJECT_ID).winnerThreadId).toBeNull();
  });
});

// ── Deterministic keys ───────────────────────────────────────────────

describe("deterministic keys", () => {
  it("derives stable per-slice staging keys", () => {
    expect(projectWorkspaceStagingSliceKey(PROJECT_ID, "right-dock")).toBe(
      "synara:project-workspace:v2:stage:project-1:right-dock",
    );
    expect(projectWorkspaceStagingSliceKey(OTHER_PROJECT_ID, "device")).toBe(
      "synara:project-workspace:v2:stage:project-2:device",
    );
  });

  it("gives every Project its own marker key", () => {
    expect(projectWorkspacePublicationMarkerKey(PROJECT_ID)).toBe(
      "synara:project-workspace:v2:published:project-1",
    );
    expect(projectWorkspacePublicationMarkerKey(OTHER_PROJECT_ID)).not.toBe(
      projectWorkspacePublicationMarkerKey(PROJECT_ID),
    );
  });
});

// ── All-slices rule and default publishing (Decision 0002 C.5/D) ─────

describe("planProjectWorkspaceMigration all-slices conversion", () => {
  it("builds every destination slice from the single winning Thread", () => {
    const winnerId = ThreadId.makeUnsafe("t-winner");
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({ id: "t-loser", updatedAt: "2026-01-01T00:00:00.000Z" }),
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: {
            rightDock: validRightDock(winnerId),
            terminalPresentation: validTerminalPresentation(winnerId),
            browser: validBrowser(winnerId),
            device: validDevice(winnerId),
          },
        }),
      ],
    });
    expect(plan).toMatchObject({ outcome: "migrate-legacy-winner", winnerThreadId: "t-winner" });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const slices = plan.target.stagedEntries.map((entry) => entry.slice);
    const kinds = [...PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS];
    expect(slices).toHaveLength(5);
    expect(slices.map((slice) => slice.slice)).toEqual(kinds);
    expect(slices[0]).toMatchObject({
      open: true,
      preferredWidthPx: null,
      panes: [
        { id: "pane-a", kind: "terminal", restorationDiagnostic: null },
        { id: "pane-b", kind: "sidechat", threadId: "side-1" },
      ],
      activePaneId: "pane-a",
    });
    expect(slices[1]).toMatchObject({
      presentationMode: "workspace",
      terminalIds: ["default", "shell-2"],
      activeTerminalId: "shell-2",
      terminalLabelsById: { default: "Terminal 1" },
    });
    expect(slices[2]).toMatchObject({
      open: true,
      activeTabId: "tab-1",
      tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
    });
    expect(slices[3]).toMatchObject({ markers: [] });
    expect(slices[4]).toMatchObject({ attachedDeviceUdid: "11111111-2222-3333-4444-555555555555" });
    expect(plan.target.provenance).toEqual({
      sourceSchemaVersion: 1,
      sourceThreadId: "t-winner",
    });
  });

  it("publishes a default for an absent winner slice, never borrowing from a loser", () => {
    // The winner has only a dock slice; the loser has a rich browser slice.
    // The browser slice must NOT leak into the winner's workspace.
    const winnerId = ThreadId.makeUnsafe("t-winner");
    const loserId = ThreadId.makeUnsafe("t-loser");
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({
          id: "t-loser",
          updatedAt: "2026-01-01T00:00:00.000Z",
          slices: {
            browser: {
              ...validBrowser(loserId),
              tabs: [
                { id: "tab-1", url: "https://loser.com", title: "Loser 1" },
                { id: "tab-2", url: "https://loser2.com", title: "Loser 2" },
              ],
            },
            device: validDevice(loserId),
          },
        }),
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: { rightDock: validRightDock(winnerId) },
        }),
      ],
    });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const slices = plan.target.stagedEntries.map((entry) => entry.slice);
    expect(slices[0]).toMatchObject({ open: true, activePaneId: "pane-a" });
    // Winner's absent browser and device slices are canonical defaults…
    expect(slices[2]).toEqual({
      slice: "browser",
      projectId: PROJECT_ID,
      open: false,
      activeTabId: null,
      tabs: [],
    });
    expect(slices[4]).toEqual({
      slice: "device",
      projectId: PROJECT_ID,
      attachedDeviceUdid: null,
      attachPhase: null,
    });
    // …and the richer loser's data is nowhere in the target.
    expect(JSON.stringify(slices)).not.toContain("loser.com");
    expect(JSON.stringify(slices)).not.toContain("11111111-2222-3333-4444-555555555555");
  });

  it("publishes a canonical default for a winner slice that is malformed", () => {
    const winnerId = ThreadId.makeUnsafe("t-winner");
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: {
            rightDock: { threadId: "t-winner", open: true, panes: "garbage", activePaneId: null },
            terminalPresentation: validTerminalPresentation(winnerId),
          },
        }),
      ],
    });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const slices = plan.target.stagedEntries.map((entry) => entry.slice);
    expect(slices[0]).toEqual({
      slice: "right-dock",
      projectId: PROJECT_ID,
      open: false,
      preferredWidthPx: null,
      panes: [],
      activePaneId: null,
    });
    expect(slices[1]).toMatchObject({ presentationMode: "workspace" });
  });

  it("publishes a canonical default for a winner slice that is canonically default", () => {
    const winnerId = ThreadId.makeUnsafe("t-winner");
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: {
            rightDock: validRightDock(winnerId),
            terminalPresentation: {
              threadId: "t-winner",
              presentationMode: "drawer",
              workspaceTab: "terminal",
              workspaceLayout: "both",
              terminalHeightPx: 280,
              terminalIds: ["default"],
              activeTerminalId: "default",
            },
          },
        }),
      ],
    });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const slices = plan.target.stagedEntries.map((entry) => entry.slice);
    expect(slices[1]).toEqual({
      slice: "terminal-presentation",
      projectId: PROJECT_ID,
      presentationMode: "drawer",
      workspaceTab: "terminal",
      workspaceLayout: "both",
      terminalHeightPx: 280,
      terminalIds: ["default"],
      activeTerminalId: "default",
      terminalLabelsById: {},
    });
  });

  it("synthesizes the v2 empty label record for absent v1 labels", () => {
    const winnerId = ThreadId.makeUnsafe("t-winner");
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: {
            terminalPresentation: {
              ...validTerminalPresentation(winnerId),
              terminalLabelsById: undefined,
              presentationMode: "workspace",
            },
          },
        }),
      ],
    });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const terminal = plan.target.stagedEntries.map((entry) => entry.slice)[1];
    expect(terminal).toMatchObject({ presentationMode: "workspace", terminalLabelsById: {} });
  });

  // Remediation (4): retained diagnostic proof.
  it("preserves the winner's legacy browser lastError on the migrated browser pane", () => {
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: {
            rightDock: {
              threadId: "t-winner",
              open: true,
              panes: [
                pane({ id: "pane-terminal", kind: "terminal" }),
                pane({ id: "pane-browser", kind: "browser" }),
              ],
              activePaneId: "pane-browser",
            },
            browser: {
              threadId: "t-winner",
              version: 2,
              open: true,
              activeTabId: null,
              tabs: [],
              lastError: "Browser session could not be restored",
            },
          },
        }),
      ],
    });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const dock = plan.target.stagedEntries.map((entry) => entry.slice)[0];
    if (dock === undefined || dock.slice !== "right-dock") {
      throw new Error("expected the dock slice");
    }
    const browserPane = dock.panes.find((candidate) => candidate.kind === "browser");
    const terminalPane = dock.panes.find((candidate) => candidate.kind === "terminal");
    if (browserPane === undefined || terminalPane === undefined) {
      throw new Error("expected both panes");
    }
    expect(browserPane.restorationDiagnostic).toBe("Browser session could not be restored");
    // Only the browser pane carries the diagnostic.
    expect(terminalPane.restorationDiagnostic).toBeNull();
  });

  it("drops no pane and invents none when the browser error has no browser pane", () => {
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: {
            rightDock: {
              threadId: "t-winner",
              open: true,
              panes: [pane({ id: "pane-terminal", kind: "terminal" })],
              activePaneId: "pane-terminal",
            },
            browser: {
              threadId: "t-winner",
              version: 2,
              open: true,
              activeTabId: null,
              tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
              lastError: "Orphaned error with no pane",
            },
          },
        }),
      ],
    });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const dock = plan.target.stagedEntries.map((entry) => entry.slice)[0];
    if (dock === undefined || dock.slice !== "right-dock") {
      throw new Error("expected the dock slice");
    }
    // No browser pane invented; existing pane untouched.
    expect(dock.panes.map((candidate) => candidate.kind)).toEqual(["terminal"]);
    expect(dock.panes[0]?.restorationDiagnostic).toBeNull();
    // The browser workspace content itself still migrates.
    const browser = plan.target.stagedEntries.map((entry) => entry.slice)[2];
    expect(browser).toMatchObject({
      slice: "browser",
      open: true,
      tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
    });
  });

  it("does not borrow a loser's browser error into the winner's pane", () => {
    const winnerId = ThreadId.makeUnsafe("t-winner");
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({
          id: "t-loser",
          updatedAt: "2026-01-01T00:00:00.000Z",
          slices: {
            rightDock: {
              threadId: "t-loser",
              open: true,
              panes: [pane({ id: "pane-loser-browser", kind: "browser" })],
              activePaneId: "pane-loser-browser",
            },
            browser: {
              threadId: "t-loser",
              version: 2,
              open: true,
              activeTabId: null,
              tabs: [],
              lastError: "Loser browser failure",
            },
          },
        }),
        thread({
          id: "t-winner",
          updatedAt: "2026-02-01T00:00:00.000Z",
          slices: {
            rightDock: {
              threadId: "t-winner",
              open: true,
              panes: [pane({ id: "pane-winner-browser", kind: "browser" })],
              activePaneId: "pane-winner-browser",
            },
            browser: validBrowser(winnerId),
          },
        }),
      ],
    });
    if (plan.outcome !== "migrate-legacy-winner") throw new Error("expected a legacy winner");
    const dock = plan.target.stagedEntries.map((entry) => entry.slice)[0];
    if (dock === undefined || dock.slice !== "right-dock") {
      throw new Error("expected the dock slice");
    }
    const browserPane = dock.panes.find((candidate) => candidate.kind === "browser");
    if (browserPane === undefined) throw new Error("expected the winner's browser pane");
    expect(browserPane.id).toBe("pane-winner-browser");
    expect(browserPane.restorationDiagnostic).toBeNull();
    expect(JSON.stringify(plan.target)).not.toContain("Loser browser failure");
  });

  it("publishes the canonical empty workspace with null provenance when none is eligible", () => {
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [
        thread({ id: "t-deleted", deletedAt: "2025-01-01T00:00:00.000Z" }),
        thread({
          id: "t-default-only",
          slices: {
            rightDock: {
              threadId: "t-default-only",
              open: false,
              panes: [],
              activePaneId: null,
            },
          },
        }),
      ],
    });
    expect(plan.outcome).toBe("publish-empty-defaults");
    if (plan.outcome !== "publish-empty-defaults") throw new Error("expected empty defaults");
    expect(plan.target.provenance).toBeNull();
    const kinds = [...PROJECT_WORKSPACE_MIGRATION_SLICE_KINDS];
    expect(plan.target.stagedEntries.map((entry) => entry.slice.slice)).toEqual(kinds);
    for (const entry of plan.target.stagedEntries) {
      expect(entry.slice.projectId).toBe(PROJECT_ID);
    }
  });

  it("produces the identical target when rerun over the same snapshot (idempotent)", () => {
    const input = {
      projectId: PROJECT_ID,
      threads: [
        thread({ id: "t-a", updatedAt: "2026-01-01T00:00:00.000Z" }),
        thread({ id: "t-b", updatedAt: "2026-02-01T00:00:00.000Z" }),
      ],
    };
    const first = planProjectWorkspaceMigration(input);
    const second = planProjectWorkspaceMigration({
      ...input,
      threads: input.threads.toReversed(),
    });
    expect(second).toEqual(first);
  });
});

// ── Staging completeness and Project isolation ───────────────────────

function freshStagedSlices(): unknown[] {
  const plan = planProjectWorkspaceMigration({
    projectId: PROJECT_ID,
    threads: [thread({ id: "t-winner" })],
  });
  if (plan.outcome === "keep-published") {
    throw new Error("fixture requires an unpublished snapshot");
  }
  return plan.target.stagedEntries.map((entry) => entry.slice);
}

function otherProjectStagedSlices(): unknown[] {
  const plan = planProjectWorkspaceMigration({
    projectId: OTHER_PROJECT_ID,
    threads: [thread({ id: "t-other", projectId: OTHER_PROJECT_ID })],
  });
  if (plan.outcome === "keep-published") {
    throw new Error("fixture requires an unpublished snapshot");
  }
  return plan.target.stagedEntries.map((entry) => entry.slice);
}

describe("isProjectWorkspaceStagingComplete", () => {
  it("accepts exactly one valid slice of every kind for the expected Project", () => {
    expect(isProjectWorkspaceStagingComplete(freshStagedSlices(), PROJECT_ID)).toBe(true);
  });

  it("rejects a valid complete payload that belongs to another Project", () => {
    expect(isProjectWorkspaceStagingComplete(otherProjectStagedSlices(), PROJECT_ID)).toBe(false);
    expect(isProjectWorkspaceStagingComplete(freshStagedSlices(), OTHER_PROJECT_ID)).toBe(false);
  });

  it("rejects a mixed-Project payload for every expected Project", () => {
    const mixed = [...freshStagedSlices()];
    const replaced = mixed.pop();
    if (replaced === undefined) throw new Error("fixture");
    const otherSlices = otherProjectStagedSlices();
    mixed.push(otherSlices[otherSlices.length - 1]);
    expect(isProjectWorkspaceStagingComplete(mixed, PROJECT_ID)).toBe(false);
    expect(isProjectWorkspaceStagingComplete(mixed, OTHER_PROJECT_ID)).toBe(false);
  });

  it("rejects a missing slice kind", () => {
    const slices = freshStagedSlices();
    expect(isProjectWorkspaceStagingComplete(slices.slice(0, 4), PROJECT_ID)).toBe(false);
  });

  it("rejects a duplicated slice kind", () => {
    const slices = freshStagedSlices();
    expect(isProjectWorkspaceStagingComplete([...slices, slices[0]], PROJECT_ID)).toBe(false);
  });

  it("rejects malformed members", () => {
    expect(isProjectWorkspaceStagingComplete([{ slice: "right-dock" }], PROJECT_ID)).toBe(false);
    expect(isProjectWorkspaceStagingComplete([null, "x", 3, {}, []], PROJECT_ID)).toBe(false);
  });

  it("rejects a legacy v1 slice smuggled into staging", () => {
    const legacySlice = {
      threadId: "t-a",
      open: false,
      panes: [],
      activePaneId: null,
    };
    expect(isProjectWorkspaceStagingComplete([legacySlice], PROJECT_ID)).toBe(false);
  });

  it("rejects an empty payload", () => {
    expect(isProjectWorkspaceStagingComplete([], PROJECT_ID)).toBe(false);
  });
});

// ── Published-target precedence and Project isolation (Decision 0002 E) ──

function currentMarkerPayload(): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    schemaVersion: 2,
    publishedAt: "2026-01-01T00:00:00.000Z",
    provenance: { sourceSchemaVersion: 1, sourceThreadId: "t-winner" },
  };
}

function otherProjectMarkerPayload(): Record<string, unknown> {
  return {
    ...currentMarkerPayload(),
    projectId: OTHER_PROJECT_ID,
  };
}

describe("inspectProjectWorkspacePublishedTarget", () => {
  it("reports published-current for a valid marker plus complete staging", () => {
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: currentMarkerPayload(),
          stagedSlices: freshStagedSlices(),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "published-current" });
  });

  it("reports marker-absent when no marker exists", () => {
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: null,
          stagedSlices: freshStagedSlices(),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "marker-absent" });
  });

  it("reports marker-invalid for a malformed marker", () => {
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: { projectId: "p" },
          stagedSlices: freshStagedSlices(),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "marker-invalid" });
  });

  it("reports marker-stale-version for a marker from another schema version", () => {
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: { ...currentMarkerPayload(), schemaVersion: 3 },
          stagedSlices: freshStagedSlices(),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "marker-stale-version" });
  });

  it("reports marker-other-project for a well-formed marker of another Project", () => {
    // A valid current-version marker for project-2 must never publish
    // project-1 — checked BEFORE any published-current verdict.
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: otherProjectMarkerPayload(),
          stagedSlices: freshStagedSlices(),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "marker-other-project" });
  });

  it("reports staging-incomplete when a mid-write crash left fewer slices durable", () => {
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: currentMarkerPayload(),
          stagedSlices: freshStagedSlices().slice(0, 2),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "staging-incomplete" });
  });

  it("reports staging-mixed-project when one staged slice belongs to another Project", () => {
    const mixed = [...freshStagedSlices()];
    const replaced = mixed.pop();
    if (replaced === undefined) throw new Error("fixture");
    const otherSlices = otherProjectStagedSlices();
    mixed.push(otherSlices[otherSlices.length - 1]);
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: currentMarkerPayload(),
          stagedSlices: mixed,
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "staging-mixed-project" });
  });

  it("treats a current-version marker that fails the marker schema as invalid, not stale", () => {
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: { ...currentMarkerPayload(), publishedAt: "" },
          stagedSlices: freshStagedSlices(),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "marker-invalid" });
  });

  it("reports marker-other-project even when staging is also foreign", () => {
    expect(
      inspectProjectWorkspacePublishedTarget(
        {
          publicationMarker: otherProjectMarkerPayload(),
          stagedSlices: otherProjectStagedSlices(),
        },
        PROJECT_ID,
      ),
    ).toEqual({ status: "unpublished", reason: "marker-other-project" });
  });
});

describe("planProjectWorkspaceMigration published-target precedence", () => {
  it("keeps a valid published current-version target and never rederives a winner", () => {
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [thread({ id: "t-winner", updatedAt: "2026-05-01T00:00:00.000Z" })],
      publishedTarget: {
        publicationMarker: currentMarkerPayload(),
        stagedSlices: freshStagedSlices(),
      },
    });
    expect(plan).toEqual({ outcome: "keep-published" });
  });

  it("re-derives the same winner when the existing target is unpublished", () => {
    // Mid-write failure: two of five slices durable, no marker yet.
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [thread({ id: "t-winner", updatedAt: "2026-05-01T00:00:00.000Z" })],
      publishedTarget: {
        publicationMarker: null,
        stagedSlices: freshStagedSlices().slice(0, 2),
      },
    });
    expect(plan).toMatchObject({ outcome: "migrate-legacy-winner", winnerThreadId: "t-winner" });
  });

  it("treats a stale-version marker as unpublished", () => {
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [thread({ id: "t-winner" })],
      publishedTarget: {
        publicationMarker: { ...currentMarkerPayload(), schemaVersion: 1 },
        stagedSlices: freshStagedSlices(),
      },
    });
    expect(plan.outcome).toBe("migrate-legacy-winner");
  });

  it("never publishes an incomplete staged target as canonical", () => {
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [thread({ id: "t-winner" })],
      publishedTarget: {
        publicationMarker: currentMarkerPayload(),
        stagedSlices: freshStagedSlices().slice(0, 3),
      },
    });
    expect(plan.outcome).not.toBe("keep-published");
  });

  it("migrates rather than keeping when the marker belongs to another Project", () => {
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [thread({ id: "t-winner" })],
      publishedTarget: {
        publicationMarker: otherProjectMarkerPayload(),
        stagedSlices: freshStagedSlices(),
      },
    });
    expect(plan).toMatchObject({ outcome: "migrate-legacy-winner", winnerThreadId: "t-winner" });
  });

  it("migrates rather than keeping when staging is mixed-Project", () => {
    const mixed = [...freshStagedSlices()];
    const replaced = mixed.pop();
    if (replaced === undefined) throw new Error("fixture");
    const otherSlices = otherProjectStagedSlices();
    mixed.push(otherSlices[otherSlices.length - 1]);
    const plan = planProjectWorkspaceMigration({
      projectId: PROJECT_ID,
      threads: [thread({ id: "t-winner" })],
      publishedTarget: {
        publicationMarker: currentMarkerPayload(),
        stagedSlices: mixed,
      },
    });
    expect(plan).toMatchObject({ outcome: "migrate-legacy-winner", winnerThreadId: "t-winner" });
  });
});

// ── Activation gate ──────────────────────────────────────────────────

describe("canActivateProjectWorkspace", () => {
  it("activates only with capability, a valid marker, and the expected Project", () => {
    expect(
      canActivateProjectWorkspace({
        capabilityPresent: true,
        publicationMarker: currentMarkerPayload(),
        expectedProjectId: PROJECT_ID,
      }),
    ).toBe(true);
  });

  it("refuses without the capability even when a valid marker exists", () => {
    expect(
      canActivateProjectWorkspace({
        capabilityPresent: false,
        publicationMarker: currentMarkerPayload(),
        expectedProjectId: PROJECT_ID,
      }),
    ).toBe(false);
  });

  it("refuses with the capability but no valid marker", () => {
    const staleMarker = { ...currentMarkerPayload(), schemaVersion: 9 };
    const markers = [null, undefined, { projectId: "p" }, staleMarker];
    for (const marker of markers) {
      expect(
        canActivateProjectWorkspace({
          capabilityPresent: true,
          publicationMarker: marker,
          expectedProjectId: PROJECT_ID,
        }),
      ).toBe(false);
    }
  });

  it("refuses a well-formed marker that belongs to another Project", () => {
    expect(
      canActivateProjectWorkspace({
        capabilityPresent: true,
        publicationMarker: otherProjectMarkerPayload(),
        expectedProjectId: PROJECT_ID,
      }),
    ).toBe(false);
    expect(
      canActivateProjectWorkspace({
        capabilityPresent: true,
        publicationMarker: currentMarkerPayload(),
        expectedProjectId: OTHER_PROJECT_ID,
      }),
    ).toBe(false);
  });
});

// ── Static negative checks (Decision 0002 obligation 10) ─────────────

const POLICY_SOURCE = readFileSync("src/projectWorkspaceMigration.ts", "utf8");

// Named declarations this module exposes, extracted lexically from the real
// file so a Project→Thread mapping helper cannot hide behind a different
// spelling ("alias", "pseudo", "host thread", "…for project").
function declaredExportNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /^export (?:const|function|type|interface)\s+([A-Za-z0-9_]+)/gm,
  )) {
    const name = match[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

describe("synthetic-alias absence", () => {
  it("exposes no API that maps a ProjectId to a ThreadId", () => {
    const declared = declaredExportNames(POLICY_SOURCE);
    // Sanity: the extractor must actually see this module's surface, or the
    // check is broken rather than passing.
    expect(declared).toContain("planProjectWorkspaceMigration");
    for (const name of declared) {
      expect(name.toLowerCase()).not.toMatch(/alias|pseudo|hostthread|threadforproject/);
    }
    // The policy documents and contains no synthetic alias helper.
    expect(POLICY_SOURCE).toContain("no synthetic alias");
  });

  it("imports no app, desktop, storage, clock, or Effect-runtime service surface", () => {
    for (const forbidden of [
      "localStorage",
      "SQLite",
      "node:fs",
      "node:path",
      "@effect/platform",
      "Layer",
      "Date.now()",
      "new Date(",
      "Math.random",
      "apps/web",
      "apps/desktop",
      "apps/server",
    ]) {
      expect(POLICY_SOURCE).not.toContain(forbidden);
    }
  });
});
