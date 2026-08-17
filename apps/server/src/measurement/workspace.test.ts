// FILE: workspace.test.ts
// Purpose: impl-11 correction regression tests for per-repetition
// workspaces. Every repetition must get a distinct temp workspace with
// deterministic identical fixture bytes/git state (Decision 34 §4
// project/worktree equivalence) and no repo-local state, so Synara
// `project.create` never collides on workspace roots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeFixtureDigest,
  createRepetitionWorkspace,
  FIXTURE_FILE_CONTENT,
  FIXTURE_README_CONTENT,
  isolateHarnessCwd,
  probeFixtureGitCommit,
  removeRepetitionWorkspace,
} from "./workspace.ts";

describe("fixture digest", () => {
  it("is deterministic and covers the fixture bytes", () => {
    expect(computeFixtureDigest()).toBe(computeFixtureDigest());
    expect(computeFixtureDigest()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createRepetitionWorkspace", () => {
  it("creates distinct temp workspaces with identical fixture bytes and digest", () => {
    const first = createRepetitionWorkspace(0);
    const second = createRepetitionWorkspace(1);
    try {
      expect(first.root).not.toBe(second.root);
      expect(first.root.startsWith(path.join(os.tmpdir(), "synara-token-overhead-ws-0-"))).toBe(
        true,
      );
      expect(second.root.startsWith(path.join(os.tmpdir(), "synara-token-overhead-ws-1-"))).toBe(
        true,
      );

      for (const workspace of [first, second]) {
        expect(fs.readFileSync(path.join(workspace.root, "README.md"), "utf8")).toBe(
          FIXTURE_README_CONTENT,
        );
        expect(fs.readFileSync(path.join(workspace.root, "fixture.txt"), "utf8")).toBe(
          FIXTURE_FILE_CONTENT,
        );
        expect(workspace.fixtureDigest).toBe(computeFixtureDigest());
      }
    } finally {
      removeRepetitionWorkspace(first);
      removeRepetitionWorkspace(second);
      expect(fs.existsSync(first.root)).toBe(false);
      expect(fs.existsSync(second.root)).toBe(false);
    }
  });

  it("reproduces identical git state across repetitions (same HEAD) when git is available", () => {
    const first = createRepetitionWorkspace(0);
    const second = createRepetitionWorkspace(1);
    try {
      if (first.fixtureGitCommit === null) {
        // git unavailable: no git-state claim is possible, but the fixture
        // bytes are still identical.
        expect(second.fixtureGitCommit).toBeNull();
        return;
      }
      expect(first.fixtureGitCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(second.fixtureGitCommit).toBe(first.fixtureGitCommit);
    } finally {
      removeRepetitionWorkspace(first);
      removeRepetitionWorkspace(second);
    }
  });

  it("probes the shared deterministic fixture commit without leaking a workspace", () => {
    const commit = probeFixtureGitCommit();
    const created = createRepetitionWorkspace(0);
    try {
      expect(created.fixtureGitCommit).toBe(commit);
    } finally {
      removeRepetitionWorkspace(created);
    }
  });
});

describe("isolateHarnessCwd", () => {
  it("switches the process cwd to a temp dir and restores it on release", () => {
    const realpath = (value: string): string => fs.realpathSync(value);
    const originalCwd = realpath(process.cwd());
    const isolation = isolateHarnessCwd();
    try {
      expect(realpath(process.cwd())).not.toBe(originalCwd);
      expect(realpath(process.cwd())).toBe(realpath(isolation.isolatedCwd));
      // No repo-local .pi state is possible: cwd is outside the repo.
      expect(realpath(process.cwd()).startsWith(originalCwd)).toBe(false);
    } finally {
      isolation.restore();
    }
    expect(realpath(process.cwd())).toBe(originalCwd);
    expect(fs.existsSync(isolation.isolatedCwd)).toBe(false);
  });
});
