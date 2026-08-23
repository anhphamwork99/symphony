import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  LegacyBrowserSliceV1,
  LegacyDeviceSliceV1,
  LegacyRightDockSliceV1,
  LegacyTerminalPresentationSliceV1,
  LegacyThreadWorkspaceSlicesV1,
  LegacyWorkspaceSliceV1,
  PROJECT_WORKSPACE_CAPABILITY,
  PROJECT_WORKSPACE_LEGACY_SCHEMA_VERSION,
  PROJECT_WORKSPACE_MAX_TERMINALS,
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  ProjectWorkspaceAnnotationsSlice,
  ProjectWorkspaceBrowserSlice,
  ProjectWorkspaceDeviceSlice,
  ProjectWorkspaceDockSlice,
  ProjectWorkspacePaneDescriptor,
  ProjectWorkspacePublicationMarker,
  ProjectWorkspaceSlice,
  ProjectWorkspaceTerminalPresentationSlice,
} from "./projectWorkspace";

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

const PROJECT_ID = "project-1";

const SIDECHAT_PANE = {
  id: "pane-sidechat",
  kind: "sidechat",
  // A Side chat pane references the real conversation it embeds: this is the
  // one place a ThreadId legitimately survives Project ownership.
  threadId: "sidechat-thread-1",
  // A diff pane's turn reference uses the real TurnId vocabulary.
  diffTurnId: null,
  diffFilePath: null,
  filePath: null,
  pullRequestProjectId: null,
  pullRequestRepository: null,
  pullRequestNumber: null,
  pullRequestInitialTab: null,
} as const;

const DIFF_PANE = {
  id: "pane-diff",
  kind: "diff",
  threadId: null,
  diffTurnId: "turn-9f2a", // real conversation turn, not a free-form string
  diffFilePath: "src/index.ts",
  filePath: null,
  pullRequestProjectId: null,
  pullRequestRepository: null,
  pullRequestNumber: null,
  pullRequestInitialTab: null,
} as const;

const TERMINAL_PANE = {
  id: "pane-terminal",
  kind: "terminal",
  threadId: null,
  diffTurnId: null,
  diffFilePath: null,
  filePath: null,
  pullRequestProjectId: null,
  pullRequestRepository: null,
  pullRequestNumber: null,
  pullRequestInitialTab: null,
} as const;

describe("ProjectWorkspaceDockSlice", () => {
  it("round-trips a valid Project-owned dock workspace", () => {
    const input = {
      slice: "right-dock",
      projectId: PROJECT_ID,
      open: true,
      preferredWidthPx: 640,
      panes: [TERMINAL_PANE, SIDECHAT_PANE],
      activePaneId: SIDECHAT_PANE.id,
    };
    const decoded = decodeSync(ProjectWorkspaceDockSlice, input);
    expect(decoded.projectId).toBe(PROJECT_ID);
    expect(decoded.open).toBe(true);
    expect(decoded.preferredWidthPx).toBe(640);
    expect(decoded.panes.map((pane) => pane.kind)).toEqual(["terminal", "sidechat"]);
    expect(decoded.activePaneId).toBe("pane-sidechat");
  });

  it("preserves a legitimate Side-chat ThreadId inside the Project workspace", () => {
    const decoded = decodeSync(ProjectWorkspacePaneDescriptor, SIDECHAT_PANE);
    expect(decoded.threadId).toBe("sidechat-thread-1");
  });

  it("rejects a missing ProjectId", () => {
    expect(
      decodes(ProjectWorkspaceDockSlice, {
        slice: "right-dock",
        open: false,
        preferredWidthPx: null,
        panes: [],
        activePaneId: null,
      }),
    ).toBe(false);
  });

  it("rejects a malformed ProjectId", () => {
    for (const bad of ["", "   ", " "]) {
      expect(
        decodes(ProjectWorkspaceDockSlice, {
          slice: "right-dock",
          projectId: bad,
          open: false,
          preferredWidthPx: null,
          panes: [],
          activePaneId: null,
        }),
      ).toBe(false);
    }
  });

  it("rejects preferred widths outside the schema bounds", () => {
    for (const bad of [255, 8_193]) {
      expect(
        decodes(ProjectWorkspaceDockSlice, {
          slice: "right-dock",
          projectId: PROJECT_ID,
          open: true,
          preferredWidthPx: bad,
          panes: [],
          activePaneId: null,
        }),
      ).toBe(false);
    }
  });

  it("rejects unknown pane kinds rather than repairing them", () => {
    expect(
      decodes(ProjectWorkspacePaneDescriptor, {
        ...SIDECHAT_PANE,
        kind: "nope",
      }),
    ).toBe(false);
  });

  it("keeps an unrestorable pane with its diagnostic instead of dropping it", () => {
    const decoded = decodeSync(ProjectWorkspacePaneDescriptor, {
      ...SIDECHAT_PANE,
      restorationDiagnostic: "Conversation unavailable",
    });
    expect(decoded.restorationDiagnostic).toBe("Conversation unavailable");
  });

  it("rejects duplicate pane ids", () => {
    expect(
      decodes(ProjectWorkspaceDockSlice, {
        slice: "right-dock",
        projectId: PROJECT_ID,
        open: true,
        preferredWidthPx: 640,
        panes: [TERMINAL_PANE, { ...TERMINAL_PANE, threadId: "t-2" }],
        activePaneId: null,
      }),
    ).toBe(false);
  });

  it("rejects an activePaneId that names no pane in the slice", () => {
    expect(
      decodes(ProjectWorkspaceDockSlice, {
        slice: "right-dock",
        projectId: PROJECT_ID,
        open: true,
        preferredWidthPx: 640,
        panes: [TERMINAL_PANE],
        activePaneId: "pane-ghost",
      }),
    ).toBe(false);
  });

  it("accepts a null activePaneId with panes present (no active pane)", () => {
    expect(
      decodes(ProjectWorkspaceDockSlice, {
        slice: "right-dock",
        projectId: PROJECT_ID,
        open: true,
        preferredWidthPx: null,
        panes: [TERMINAL_PANE],
        activePaneId: null,
      }),
    ).toBe(true);
  });

  it("uses the real TurnId vocabulary for a diff pane's turn reference", () => {
    const decoded = decodeSync(ProjectWorkspaceDockSlice, {
      slice: "right-dock",
      projectId: PROJECT_ID,
      open: true,
      preferredWidthPx: null,
      panes: [DIFF_PANE],
      activePaneId: DIFF_PANE.id,
    });
    expect(decoded.panes[0]?.diffTurnId).toBe("turn-9f2a");
  });
});

describe("ProjectWorkspaceTerminalPresentationSlice", () => {
  const valid = {
    slice: "terminal-presentation",
    projectId: PROJECT_ID,
    presentationMode: "workspace",
    workspaceTab: "terminal",
    workspaceLayout: "both",
    terminalHeightPx: 280,
    terminalIds: ["default", "shell-2"],
    activeTerminalId: "default",
    terminalLabelsById: { default: "Terminal 1" },
  } as const;

  it("round-trips a valid Project-owned terminal presentation", () => {
    const decoded = decodeSync(ProjectWorkspaceTerminalPresentationSlice, valid);
    expect(decoded.projectId).toBe(PROJECT_ID);
    expect(decoded.activeTerminalId).toBe("default");
  });

  it("rejects a missing or malformed ProjectId", () => {
    expect(
      decodes(ProjectWorkspaceTerminalPresentationSlice, { ...valid, projectId: undefined }),
    ).toBe(false);
    expect(decodes(ProjectWorkspaceTerminalPresentationSlice, { ...valid, projectId: "  " })).toBe(
      false,
    );
  });

  it("rejects terminal heights outside the bounds", () => {
    for (const bad of [79, 8_193]) {
      expect(
        decodes(ProjectWorkspaceTerminalPresentationSlice, {
          ...valid,
          terminalHeightPx: bad,
        }),
      ).toBe(false);
    }
  });

  it("requires terminalLabelsById in v2", () => {
    const { terminalLabelsById: _omitted, ...withoutLabels } = valid;
    expect(decodes(ProjectWorkspaceTerminalPresentationSlice, withoutLabels)).toBe(false);
  });

  it("rejects labels for more terminals than the terminal ceiling", () => {
    const terminalIds = Array.from(
      { length: PROJECT_WORKSPACE_MAX_TERMINALS + 1 },
      (_, index) => `term-${index}`,
    );
    const terminalLabelsById = Object.fromEntries(
      terminalIds.map((id) => [id, `Label ${id}`]),
    );
    expect(
      decodes(ProjectWorkspaceTerminalPresentationSlice, {
        ...valid,
        terminalIds,
        activeTerminalId: terminalIds[0],
        terminalLabelsById,
      }),
    ).toBe(false);
  });

  it("rejects duplicate terminal ids", () => {
    expect(
      decodes(ProjectWorkspaceTerminalPresentationSlice, {
        ...valid,
        terminalIds: ["default", "default"],
      }),
    ).toBe(false);
  });

  it("rejects an activeTerminalId outside terminalIds", () => {
    expect(
      decodes(ProjectWorkspaceTerminalPresentationSlice, {
        ...valid,
        terminalIds: ["shell-2"],
        activeTerminalId: "default",
      }),
    ).toBe(false);
  });

  it("rejects labels keyed by an unknown terminal id", () => {
    expect(
      decodes(ProjectWorkspaceTerminalPresentationSlice, {
        ...valid,
        terminalLabelsById: { default: "Terminal 1", ghost: "Ghost" },
      }),
    ).toBe(false);
  });
});

describe("ProjectWorkspaceBrowserSlice", () => {
  const valid = {
    slice: "browser",
    projectId: PROJECT_ID,
    open: true,
    activeTabId: "tab-1",
    tabs: [
      { id: "tab-1", url: "https://example.com", title: "Example" },
      { id: "tab-2", url: "about:blank", title: "New tab" },
    ],
  } as const;

  it("round-trips a valid Project-owned browser workspace", () => {
    const decoded = decodeSync(ProjectWorkspaceBrowserSlice, valid);
    expect(decoded.tabs).toHaveLength(2);
    expect(decoded.activeTabId).toBe("tab-1");
  });

  it("rejects a missing ProjectId", () => {
    expect(decodes(ProjectWorkspaceBrowserSlice, { ...valid, projectId: undefined })).toBe(false);
  });

  it("rejects duplicate browser tab ids", () => {
    expect(
      decodes(ProjectWorkspaceBrowserSlice, {
        ...valid,
        tabs: [
          { id: "tab-1", url: "https://example.com", title: "Example" },
          { id: "tab-1", url: "https://other.com", title: "Other" },
        ],
      }),
    ).toBe(false);
  });

  it("rejects an activeTabId that names no tab in the slice", () => {
    expect(
      decodes(ProjectWorkspaceBrowserSlice, {
        ...valid,
        activeTabId: "tab-ghost",
      }),
    ).toBe(false);
  });

  it("accepts a null activeTabId with tabs present (no active tab)", () => {
    expect(decodes(ProjectWorkspaceBrowserSlice, { ...valid, activeTabId: null })).toBe(true);
  });
});

describe("ProjectWorkspaceAnnotationsSlice", () => {
  const valid = {
    slice: "browser-annotations",
    projectId: PROJECT_ID,
    markers: [{ id: "ann-1", tabId: "tab-1", ordinal: 1, documentKey: "key-1" }],
  } as const;

  it("round-trips valid Project-owned annotation markers", () => {
    const decoded = decodeSync(ProjectWorkspaceAnnotationsSlice, valid);
    expect(decoded.markers[0]?.id).toBe("ann-1");
  });

  it("rejects a malformed ProjectId", () => {
    expect(decodes(ProjectWorkspaceAnnotationsSlice, { ...valid, projectId: "" })).toBe(false);
  });

  it("rejects markers without a positive ordinal", () => {
    expect(
      decodes(ProjectWorkspaceAnnotationsSlice, {
        ...valid,
        markers: [{ id: "ann-0", tabId: "tab-1", ordinal: 0, documentKey: "key-1" }],
      }),
    ).toBe(false);
  });
});

describe("ProjectWorkspaceDeviceSlice", () => {
  const valid = {
    slice: "device",
    projectId: PROJECT_ID,
    attachedDeviceUdid: "11111111-2222-3333-4444-555555555555",
    attachPhase: null,
  } as const;

  it("round-trips a valid Project-owned device attachment", () => {
    const decoded = decodeSync(ProjectWorkspaceDeviceSlice, valid);
    expect(decoded.attachedDeviceUdid).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("rejects a missing ProjectId", () => {
    expect(decodes(ProjectWorkspaceDeviceSlice, { ...valid, projectId: undefined })).toBe(false);
  });
});

describe("ProjectWorkspaceSlice union", () => {
  it("includes exactly the five Project-owned slice kinds (no geometry slice)", () => {
    // The dock's preferredWidthPx is the canonical persisted width; a runtime
    // effective width is never persisted, so no geometry slice exists.
    const members = [
      ProjectWorkspaceDockSlice,
      ProjectWorkspaceTerminalPresentationSlice,
      ProjectWorkspaceBrowserSlice,
      ProjectWorkspaceAnnotationsSlice,
      ProjectWorkspaceDeviceSlice,
    ];
    for (const member of members) {
      const sample =
        member === ProjectWorkspaceDockSlice
          ? {
              slice: "right-dock",
              projectId: PROJECT_ID,
              open: false,
              preferredWidthPx: null,
              panes: [],
              activePaneId: null,
            }
          : member === ProjectWorkspaceTerminalPresentationSlice
            ? {
                slice: "terminal-presentation",
                projectId: PROJECT_ID,
                presentationMode: "drawer",
                workspaceTab: "terminal",
                workspaceLayout: "both",
                terminalHeightPx: 280,
                terminalIds: ["default"],
                activeTerminalId: "default",
                terminalLabelsById: {},
              }
            : member === ProjectWorkspaceBrowserSlice
              ? {
                  slice: "browser",
                  projectId: PROJECT_ID,
                  open: false,
                  activeTabId: null,
                  tabs: [],
                }
              : member === ProjectWorkspaceAnnotationsSlice
                ? {
                    slice: "browser-annotations",
                    projectId: PROJECT_ID,
                    markers: [],
                  }
                : {
                    slice: "device",
                    projectId: PROJECT_ID,
                    attachedDeviceUdid: null,
                  };
      expect(decodes(member, sample)).toBe(true);
      expect(decodes(ProjectWorkspaceSlice, sample)).toBe(true);
    }
    expect(decodes(ProjectWorkspaceSlice, { slice: "geometry", projectId: PROJECT_ID })).toBe(
      false,
    );
  });
});

describe("ProjectWorkspacePublicationMarker", () => {
  it("round-trips a published marker with migration provenance", () => {
    const decoded = decodeSync(ProjectWorkspacePublicationMarker, {
      projectId: PROJECT_ID,
      schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
      publishedAt: "2026-01-01T00:00:00.000Z",
      provenance: {
        sourceSchemaVersion: PROJECT_WORKSPACE_LEGACY_SCHEMA_VERSION,
        sourceThreadId: "legacy-winner-thread",
      },
    });
    expect(decoded.schemaVersion).toBe(2);
    expect(decoded.provenance?.sourceThreadId).toBe("legacy-winner-thread");
  });

  it("accepts a marker without provenance (fresh Project, no legacy data)", () => {
    expect(
      decodes(ProjectWorkspacePublicationMarker, {
        projectId: PROJECT_ID,
        schemaVersion: 2,
        publishedAt: "2026-01-01T00:00:00.000Z",
        provenance: null,
      }),
    ).toBe(true);
  });

  it("rejects an unknown schema version", () => {
    expect(
      decodes(ProjectWorkspacePublicationMarker, {
        projectId: PROJECT_ID,
        schemaVersion: 3,
        publishedAt: "2026-01-01T00:00:00.000Z",
        provenance: null,
      }),
    ).toBe(false);
  });

  it("rejects a missing or malformed ProjectId", () => {
    for (const bad of [undefined, "", "   "]) {
      expect(
        decodes(ProjectWorkspacePublicationMarker, {
          projectId: bad,
          schemaVersion: 2,
          publishedAt: "2026-01-01T00:00:00.000Z",
          provenance: null,
        }),
      ).toBe(false);
    }
  });
});

// ── Legacy v1 sanitizers reject malformed slices ────────────────────

describe("LegacyRightDockSliceV1", () => {
  it("accepts a well-formed legacy Thread-keyed dock slice", () => {
    expect(
      decodes(LegacyRightDockSliceV1, {
        threadId: "thread-1",
        open: true,
        panes: [{ ...SIDECHAT_PANE, id: "pane-1" }],
        activePaneId: "pane-1",
      }),
    ).toBe(true);
  });

  it("rejects a malformed v1 dock slice", () => {
    expect(decodes(LegacyRightDockSliceV1, { panes: "nope" })).toBe(false);
    expect(
      decodes(LegacyRightDockSliceV1, {
        threadId: "thread-1",
        open: true,
        panes: [{ ...SIDECHAT_PANE, kind: "unknown-kind" }],
        activePaneId: null,
      }),
    ).toBe(false);
    expect(
      decodes(LegacyRightDockSliceV1, {
        threadId: " ",
        open: true,
        panes: [],
        activePaneId: null,
      }),
    ).toBe(false);
  });

  it("rejects duplicate v1 pane ids", () => {
    expect(
      decodes(LegacyRightDockSliceV1, {
        threadId: "thread-1",
        open: true,
        panes: [
          { ...TERMINAL_PANE, id: "pane-dup" },
          { ...SIDECHAT_PANE, id: "pane-dup" },
        ],
        activePaneId: null,
      }),
    ).toBe(false);
  });

  it("rejects a v1 activePaneId that names no pane", () => {
    expect(
      decodes(LegacyRightDockSliceV1, {
        threadId: "thread-1",
        open: true,
        panes: [{ ...TERMINAL_PANE, id: "pane-1" }],
        activePaneId: "pane-ghost",
      }),
    ).toBe(false);
  });

  it("rejects a v1 diff pane whose diffTurnId is not a real TurnId", () => {
    expect(
      decodes(LegacyRightDockSliceV1, {
        threadId: "thread-1",
        open: true,
        panes: [{ ...DIFF_PANE, diffTurnId: "   " }],
        activePaneId: null,
      }),
    ).toBe(false);
  });
});

describe("LegacyTerminalPresentationSliceV1", () => {
  const base = {
    threadId: "thread-1",
    presentationMode: "drawer",
    workspaceTab: "terminal",
    workspaceLayout: "both",
    terminalHeightPx: 280,
    terminalIds: ["default"],
    activeTerminalId: "default",
  };

  it("accepts a well-formed legacy terminal slice", () => {
    expect(decodes(LegacyTerminalPresentationSliceV1, { ...base })).toBe(true);
  });

  it("accepts absent v1 labels (older builds persisted none)", () => {
    expect(decodes(LegacyTerminalPresentationSliceV1, base)).toBe(true);
  });

  it("accepts present v1 labels that name known terminals", () => {
    expect(
      decodes(LegacyTerminalPresentationSliceV1, {
        ...base,
        terminalLabelsById: { default: "Terminal 1" },
      }),
    ).toBe(true);
  });

  it("rejects labels keyed by a terminal not in terminalIds", () => {
    expect(
      decodes(LegacyTerminalPresentationSliceV1, {
        ...base,
        terminalLabelsById: { ghost: "Ghost" },
      }),
    ).toBe(false);
  });

  it("rejects duplicate v1 terminal ids", () => {
    expect(
      decodes(LegacyTerminalPresentationSliceV1, {
        ...base,
        terminalIds: ["default", "default"],
      }),
    ).toBe(false);
  });

  it("rejects a v1 activeTerminalId outside terminalIds", () => {
    expect(
      decodes(LegacyTerminalPresentationSliceV1, {
        ...base,
        terminalIds: ["shell-2"],
        activeTerminalId: "default",
      }),
    ).toBe(false);
  });

  it("rejects an unknown presentation mode", () => {
    expect(
      decodes(LegacyTerminalPresentationSliceV1, {
        ...base,
        presentationMode: "floating",
      }),
    ).toBe(false);
    expect(decodes(LegacyTerminalPresentationSliceV1, null)).toBe(false);
  });
});

describe("LegacyBrowserSliceV1", () => {
  const base = {
    threadId: "thread-1",
    version: 3,
    open: true,
    activeTabId: "tab-1",
    tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
    lastError: null,
  };

  it("accepts a well-formed legacy browser slice", () => {
    expect(decodes(LegacyBrowserSliceV1, base)).toBe(true);
  });

  it("rejects a negative version", () => {
    expect(
      decodes(LegacyBrowserSliceV1, {
        ...base,
        version: -1,
        activeTabId: null,
        tabs: [],
      }),
    ).toBe(false);
  });

  it("rejects duplicate v1 browser tab ids", () => {
    expect(
      decodes(LegacyBrowserSliceV1, {
        ...base,
        tabs: [
          { id: "tab-1", url: "https://example.com", title: "Example" },
          { id: "tab-1", url: "https://other.com", title: "Other" },
        ],
      }),
    ).toBe(false);
  });

  it("rejects a v1 activeTabId that names no tab", () => {
    expect(decodes(LegacyBrowserSliceV1, { ...base, activeTabId: "tab-ghost" })).toBe(false);
  });

  it("accepts a null v1 activeTabId (no active tab)", () => {
    expect(decodes(LegacyBrowserSliceV1, { ...base, activeTabId: null })).toBe(true);
  });
});

describe("LegacyDeviceSliceV1", () => {
  it("accepts a well-formed legacy device slice and rejects malformed ones", () => {
    expect(
      decodes(LegacyDeviceSliceV1, {
        threadId: "thread-1",
        version: 2,
        attachedDeviceUdid: null,
      }),
    ).toBe(true);
    expect(
      decodes(LegacyDeviceSliceV1, {
        threadId: "thread-1",
        version: "two",
        attachedDeviceUdid: null,
      }),
    ).toBe(false);
  });
});

describe("LegacyThreadWorkspaceSlicesV1 combined struct", () => {
  it("validates every v1 slice one Thread contributed, together", () => {
    const decoded = decodeSync(LegacyThreadWorkspaceSlicesV1, {
      threadId: "thread-1",
      rightDock: {
        threadId: "thread-1",
        open: true,
        panes: [{ ...SIDECHAT_PANE, id: "pane-1" }],
        activePaneId: "pane-1",
      },
      terminalPresentation: {
        threadId: "thread-1",
        presentationMode: "workspace",
        workspaceTab: "terminal",
        workspaceLayout: "both",
        terminalHeightPx: 280,
        terminalIds: ["default", "shell-2"],
        activeTerminalId: "shell-2",
        terminalLabelsById: { default: "Terminal 1" },
      },
      browser: {
        threadId: "thread-1",
        version: 3,
        open: true,
        activeTabId: "tab-1",
        tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
        lastError: null,
      },
      device: {
        threadId: "thread-1",
        version: 2,
        attachedDeviceUdid: null,
      },
    });
    expect(decoded.rightDock?.activePaneId).toBe("pane-1");
    expect(decoded.terminalPresentation?.terminalLabelsById).toEqual({ default: "Terminal 1" });
  });

  it("accepts a Thread with only some slices present", () => {
    expect(
      decodes(LegacyThreadWorkspaceSlicesV1, {
        threadId: "thread-1",
        terminalPresentation: {
          threadId: "thread-1",
          presentationMode: "drawer",
          workspaceTab: "terminal",
          workspaceLayout: "both",
          terminalHeightPx: 280,
          terminalIds: ["default"],
          activeTerminalId: "default",
        },
      }),
    ).toBe(true);
  });

  it("rejects the combined struct when one member slice is referentially malformed", () => {
    expect(
      decodes(LegacyThreadWorkspaceSlicesV1, {
        threadId: "thread-1",
        browser: {
          threadId: "thread-1",
          version: 1,
          open: true,
          activeTabId: "tab-ghost",
          tabs: [{ id: "tab-1", url: "https://example.com", title: "Example" }],
          lastError: null,
        },
      }),
    ).toBe(false);
  });
});

describe("LegacyWorkspaceSliceV1 union", () => {
  it("accepts each member shape through the union", () => {
    expect(
      decodes(LegacyWorkspaceSliceV1, {
        threadId: "thread-1",
        open: false,
        panes: [],
        activePaneId: null,
      }),
    ).toBe(true);
    expect(
      decodes(LegacyWorkspaceSliceV1, {
        threadId: "thread-1",
        presentationMode: "drawer",
        workspaceTab: "terminal",
        workspaceLayout: "both",
        terminalHeightPx: 280,
        terminalIds: ["default"],
        activeTerminalId: "default",
      }),
    ).toBe(true);
    expect(
      decodes(LegacyWorkspaceSliceV1, {
        threadId: "thread-1",
        version: 0,
        open: false,
        activeTabId: null,
        tabs: [],
        lastError: null,
      }),
    ).toBe(true);
    expect(
      decodes(LegacyWorkspaceSliceV1, {
        threadId: "thread-1",
        version: 0,
        attachedDeviceUdid: null,
      }),
    ).toBe(true);
  });

  it("rejects a payload matching no v1 member shape", () => {
    expect(decodes(LegacyWorkspaceSliceV1, { threadId: "thread-1" })).toBe(false);
    expect(decodes(LegacyWorkspaceSliceV1, { slice: "right-dock", projectId: PROJECT_ID })).toBe(
      false,
    );
  });

  it("rejects a union member with a broken referential invariant", () => {
    expect(
      decodes(LegacyWorkspaceSliceV1, {
        threadId: "thread-1",
        open: true,
        panes: [
          { ...TERMINAL_PANE, id: "pane-dup" },
          { ...SIDECHAT_PANE, id: "pane-dup" },
        ],
        activePaneId: null,
      }),
    ).toBe(false);
  });
});

describe("capability vocabulary", () => {
  it("exposes the Project workspace capability for WS negotiation", () => {
    expect(PROJECT_WORKSPACE_CAPABILITY).toBe("project.right-sidebar-workspace");
    expect(PROJECT_WORKSPACE_SCHEMA_VERSION).toBe(2);
  });
});
