import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopProjectWorkspaceMigration,
  readDesktopProjectWorkspaceDocument,
  resolveDesktopProjectWorkspacePath,
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
