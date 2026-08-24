import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectDesktopProjectWorkspaceProjectIds,
  DesktopProjectWorkspaceMigration,
  DESKTOP_PROJECT_WORKSPACE_FILE_VERSION,
  type DesktopProjectWorkspaceDocument,
  readDesktopProjectWorkspaceDocument,
  resolveDesktopProjectWorkspacePath,
  runDesktopProjectWorkspaceStartupMigration,
} from "./desktopProjectWorkspaceMigration";

const projectId = ProjectId.makeUnsafe("project-desktop");
const otherProjectId = ProjectId.makeUnsafe("project-other");
const roots: string[] = [];

function legacyThread(
  threadId: string,
  owner = projectId,
  overrides: Record<string, unknown> = {},
) {
  const id = ThreadId.makeUnsafe(threadId);
  return {
    threadId: id,
    projectId: owner,
    updatedAt: "2026-08-20T00:00:00.000Z",
    deletedAt: null,
    archivedAt: null,
    slices: {
      rightDock: {
        threadId: id,
        open: true,
        panes: [
          {
            id: "browser-pane",
            kind: "browser",
            threadId: null,
            diffTurnId: null,
            diffFilePath: null,
            filePath: null,
            pullRequestProjectId: null,
            pullRequestRepository: null,
            pullRequestNumber: null,
            pullRequestInitialTab: null,
          },
        ],
        activePaneId: "browser-pane",
      },
      browser: {
        threadId: id,
        version: 3,
        open: true,
        activeTabId: "tab-1",
        tabs: [{ id: "tab-1", url: "https://unavailable.test", title: "Unavailable" }],
        lastError: "The browser page could not be restored.",
      },
      ...overrides,
    },
  };
}

function storePath(): string {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "synara-project-desktop-"));
  roots.push(root);
  return resolveDesktopProjectWorkspacePath(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("DesktopProjectWorkspaceMigration", () => {
  it("stages every slice, publishes marker last, and retains the winner diagnostic", () => {
    const path = storePath();
    const migration = new DesktopProjectWorkspaceMigration(path, { now: () => "2026-08-24T00:00:00Z" });
    const result = migration.migrate({ projectId, threads: [legacyThread("thread-winner")] });

    expect(result.status).toBe("published");
    expect(migration.read(projectId)).toMatchObject({ status: "published-current" });
    expect(migration.read(projectId).slices).toHaveLength(5);
    expect(migration.read(projectId).slices[0]).toMatchObject({
      slice: "right-dock",
      panes: [expect.objectContaining({ restorationDiagnostic: "The browser page could not be restored." })],
    });
    const document = readDesktopProjectWorkspaceDocument(path);
    expect(Object.keys(document.published)).toEqual(["synara:project-workspace:v2:published:project-desktop"]);
  });

  it("leaves a failed Project unpublished and retries idempotently", () => {
    const path = storePath();
    let fail = true;
    const migration = new DesktopProjectWorkspaceMigration(path, {
      beforePublish: () => {
        if (fail) throw new Error("injected publish failure");
      },
    });
    expect(migration.migrate({ projectId, threads: [legacyThread("thread-retry")] }).status).toBe(
      "unpublished",
    );
    expect(migration.read(projectId).status).toBe("unpublished");
    fail = false;
    expect(migration.migrate({ projectId, threads: [legacyThread("thread-retry")] }).status).toBe(
      "published",
    );
    expect(migration.migrate({ projectId, threads: [legacyThread("thread-retry")] }).status).toBe(
      "kept-published",
    );
  });

  it("isolates per-Project publication and keeps v1 input untouched", () => {
    const path = storePath();
    const source = legacyThread("thread-source");
    const before = JSON.stringify(source);
    const migration = new DesktopProjectWorkspaceMigration(path);
    expect(migration.migrate({ projectId, threads: [source] }).status).toBe("published");
    expect(migration.migrate({ projectId: otherProjectId, threads: [] }).status).toBe("published");
    expect(JSON.stringify(source)).toBe(before);
    expect(migration.read(projectId).status).toBe("published-current");
    expect(migration.read(otherProjectId).status).toBe("published-current");
  });

  it("atomically tombstones one Project, preserves other Projects and v1 input, and survives restart", () => {
    const path = storePath();
    const migration = new DesktopProjectWorkspaceMigration(path);
    const source = legacyThread("thread-delete");
    expect(migration.migrate({ projectId, threads: [source] }).status).toBe("published");
    expect(migration.migrate({ projectId: otherProjectId, threads: [] }).status).toBe("published");
    const before = JSON.stringify(source);

    expect(migration.deleteProject(projectId, "2026-08-24T00:00:00.000Z")).toBe(true);
    expect(migration.deleteProject(projectId, "2026-08-25T00:00:00.000Z")).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
    expect(migration.read(projectId).status).toBe("deleted");
    expect(migration.migrate({ projectId, threads: [] }).status).toBe("deleted");
    expect(collectDesktopProjectWorkspaceProjectIds(migration.getDocument())).toEqual([
      String(otherProjectId),
    ]);

    const reopened = new DesktopProjectWorkspaceMigration(path);
    expect(reopened.read(projectId).status).toBe("deleted");
    expect(reopened.migrate({ projectId, threads: [] }).status).toBe("deleted");
    expect(reopened.read(otherProjectId).status).toBe("published-current");
    expect(reopened.getDocument().tombstones[String(projectId)]).toEqual({
      projectId,
      deletedAt: "2026-08-24T00:00:00.000Z",
    });
  });

  it("retains a diagnostic for malformed desktop backing data", () => {
    const path = storePath();
    FS.mkdirSync(Path.dirname(path), { recursive: true });
    FS.writeFileSync(path, JSON.stringify({ version: 2, staged: [], published: {}, diagnostics: {} }));
    const migration = new DesktopProjectWorkspaceMigration(path);
    expect(migration.read(projectId)).toMatchObject({
      status: "unpublished",
      diagnostic: "Desktop Project workspace data is malformed or unavailable.",
    });
  });
});

describe("runDesktopProjectWorkspaceStartupMigration — production startup pass", () => {
  it("runs against the real userData file store and converges staged records", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "synara-project-startup-"));
    roots.push(root);
    const userDataPath = Path.join(root, "electron-userdata");
    FS.mkdirSync(userDataPath, { recursive: true });

    // First run: a fresh store has no known Projects — nothing invented,
    // nothing published, no diagnostic.
    const first = runDesktopProjectWorkspaceStartupMigration({ userDataPath });
    expect(first.results).toEqual([]);
    expect(first.diagnostic).toBeNull();

    // A renderer-independent migration stages one Project's slices but fails
    // before the marker (the retryable state a crashed start can leave).
    const staged = new DesktopProjectWorkspaceMigration(
      resolveDesktopProjectWorkspacePath(userDataPath),
      {
        beforePublish: () => {
          throw new Error("crash before marker");
        },
      },
    );
    expect(staged.migrate({ projectId, threads: [legacyThread("thread-crashed")] }).status).toBe(
      "unpublished",
    );

    // The startup pass re-derives the same deterministic target from the
    // document's own keys and publishes it — retry convergence (F.7).
    const second = runDesktopProjectWorkspaceStartupMigration({ userDataPath });
    expect(second.diagnostic).toBeNull();
    expect(second.results).toHaveLength(1);
    expect(second.results[0]).toMatchObject({ status: "published", projectId });

    // A third pass is idempotent: the published marker is kept, not rewritten.
    const third = runDesktopProjectWorkspaceStartupMigration({ userDataPath });
    expect(third.results[0]).toMatchObject({ status: "kept-published", projectId });

    // The publication is real and complete in the durable document.
    const document = readDesktopProjectWorkspaceDocument(
      resolveDesktopProjectWorkspacePath(userDataPath),
    );
    expect(Object.keys(document.published)).toEqual([
      "synara:project-workspace:v2:published:project-desktop",
    ]);
  });

  it("derives retry Project IDs only from the document's own durable keys", () => {
    const document: DesktopProjectWorkspaceDocument = {
      version: DESKTOP_PROJECT_WORKSPACE_FILE_VERSION,
      staged: {
        "synara:project-workspace:v2:stage:project-a:right-dock": { slice: "right-dock" },
      },
      published: {
        "synara:project-workspace:v2:published:project-b": { schemaVersion: 2 },
      },
      diagnostics: {
        "project-failed": "per-Project diagnostic key is the raw ProjectId",
      },
      tombstones: {},
    };
    expect(collectDesktopProjectWorkspaceProjectIds(document)).toEqual([
      "project-a",
      "project-b",
      "project-failed",
    ]);
  });

  it("reports persistence failure as a per-Project diagnostic without throwing", () => {
    const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "synara-project-readonly-"));
    roots.push(root);
    const userDataPath = Path.join(root, "userdata");
    FS.mkdirSync(userDataPath, { recursive: true });

    // Leave one Project staged-but-unpublished: the retryable state whose
    // convergence attempt must persist, which a read-only store cannot do.
    const staged = new DesktopProjectWorkspaceMigration(
      resolveDesktopProjectWorkspacePath(userDataPath),
      {
        beforePublish: () => {
          throw new Error("first start crashed before the marker");
        },
      },
    );
    expect(staged.migrate({ projectId, threads: [legacyThread("thread-ro")] }).status).toBe(
      "unpublished",
    );

    FS.chmodSync(userDataPath, 0o500);
    try {
      const outcome = runDesktopProjectWorkspaceStartupMigration({ userDataPath });
      // The pass itself never throws; the failure is a diagnostic that stays
      // retryable, and no success is claimed.
      expect(outcome.results).toHaveLength(1);
      const result = outcome.results[0];
      if (result?.status !== "unpublished") throw new Error("expected unpublished");
      expect(typeof result.diagnostic).toBe("string");
    } finally {
      FS.chmodSync(userDataPath, 0o700);
    }
  });
});
