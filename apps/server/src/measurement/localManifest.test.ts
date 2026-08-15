// FILE: localManifest.test.ts
// Purpose: Decision 34 §3 local full-manifest retention policy tests: the
// destination must be owner-only (0700), must be outside any git repository
// or, when repo-contained, must pass `git check-ignore` (never committable),
// and symlink destinations / non-directory targets are rejected. Default
// null retention remains allowed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { prepareLocalManifestDir, writeLocalManifest } from "./standaloneDriver.ts";
import type { CanonicalToolEntry } from "./types.ts";

const ENTRIES: CanonicalToolEntry[] = [
  { name: "bash", description: "Run a command", parameters: { type: "object" } },
  { name: "write", description: "Write a file", parameters: { type: "object" } },
];

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitInit(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

function modeOf(target: string): number {
  return fs.statSync(target).mode & 0o777;
}

describe("local manifest retention policy (Decision 34 §3)", () => {
  it("allows null retention (default) without creating anything", () => {
    expect(writeLocalManifest(null, "standalone", 0, ENTRIES)).toBe(false);
  });

  it("creates an owner-only directory outside any repo and writes the manifest owner-only", () => {
    const base = tempDir("local-manifest-outside-");
    try {
      const dir = path.join(base, "manifests");
      // The prepared directory is the canonical spelling of the user's path
      // (where the write actually lands; on macOS /var canonicalizes to
      // /private/var).
      const canonicalDir = path.join(fs.realpathSync(base), "manifests");
      expect(prepareLocalManifestDir(dir)).toEqual({ ok: true, dir: canonicalDir });
      expect(modeOf(dir)).toBe(0o700);
      expect(writeLocalManifest(dir, "standalone", 0, ENTRIES)).toBe(true);
      expect(modeOf(path.join(dir, "standalone-0.manifest.json"))).toBe(0o600);
      expect(fs.readFileSync(path.join(dir, "standalone-0.manifest.json"), "utf8")).toContain(
        '"name": "bash"',
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("chmods an existing directory to owner-only instead of trusting its current mode", () => {
    const base = tempDir("local-manifest-chmod-");
    try {
      const dir = path.join(base, "manifests");
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      expect(modeOf(dir)).toBe(0o755);
      const prepared = prepareLocalManifestDir(dir);
      expect(prepared.ok).toBe(true);
      expect(modeOf(dir)).toBe(0o700);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects a repo-contained destination that is not gitignored and creates nothing", () => {
    const repo = tempDir("local-manifest-repo-");
    try {
      gitInit(repo);
      fs.writeFileSync(path.join(repo, ".gitignore"), "unrelated.txt\n");
      const dir = path.join(repo, "artifacts");
      expect(prepareLocalManifestDir(dir)).toEqual({
        ok: false,
        reason: "inside-repo-not-ignored",
      });
      expect(fs.existsSync(dir)).toBe(false);
      // writeLocalManifest reports the rejection and writes nothing.
      const rejected: string[] = [];
      expect(writeLocalManifest(dir, "standalone", 0, ENTRIES, (reason) => rejected.push(reason))).toBe(
        false,
      );
      expect(rejected).toEqual(["inside-repo-not-ignored"]);
      expect(fs.existsSync(dir)).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("allows a repo-contained destination that passes git check-ignore", () => {
    const repo = tempDir("local-manifest-repo-ignored-");
    try {
      gitInit(repo);
      fs.writeFileSync(path.join(repo, ".gitignore"), "manifests/\n");
      const dir = path.join(repo, "manifests", "sub");
      expect(prepareLocalManifestDir(dir)).toEqual({
        ok: true,
        dir: path.join(fs.realpathSync(repo), "manifests", "sub"),
      });
      expect(modeOf(dir)).toBe(0o700);
      expect(writeLocalManifest(dir, "synara-default", 1, ENTRIES)).toBe(true);
      expect(fs.existsSync(path.join(dir, "synara-default-1.manifest.json"))).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects a symlink at the destination", () => {
    const base = tempDir("local-manifest-symlink-");
    try {
      const outside = path.join(base, "outside");
      fs.mkdirSync(outside);
      const dir = path.join(base, "manifests");
      fs.symlinkSync(outside, dir);
      expect(prepareLocalManifestDir(dir)).toEqual({ ok: false, reason: "symlink-rejected" });
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects a non-directory target (regular file)", () => {
    const base = tempDir("local-manifest-file-");
    try {
      const dir = path.join(base, "manifests");
      fs.writeFileSync(dir, "not a directory");
      expect(prepareLocalManifestDir(dir)).toEqual({ ok: false, reason: "not-a-directory" });
      expect(fs.readFileSync(dir, "utf8")).toBe("not a directory");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("fails closed on a dangling symlink between the existing ancestor and the target", () => {
    const base = tempDir("local-manifest-redirect-");
    try {
      const outside = path.join(base, "outside");
      const sub = path.join(base, "sub");
      fs.mkdirSync(sub);
      // A planted dangling symlink inside the path cannot be resolved to the
      // canonical spelling of the chosen path; the destination is rejected
      // (fail closed) and no manifest file is ever written.
      fs.symlinkSync(outside, path.join(sub, "link"));
      const dir = path.join(sub, "link", "manifests");
      const rejected: string[] = [];
      expect(writeLocalManifest(dir, "standalone", 0, ENTRIES, (reason) => rejected.push(reason))).toBe(
        false,
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatch(/^(symlink-redirect-rejected|directory-create-failed)$/);
      expect(fs.existsSync(path.join(outside, "manifests", "standalone-0.manifest.json"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("policy applies to the canonical (real) location of a symlinked path", () => {
    // A consistent symlink resolves to the canonical spelling of the chosen
    // path, so the policy (repo containment + ignore) is judged where the
    // write actually lands — outside the repo it is allowed.
    const base = tempDir("local-manifest-canonical-");
    try {
      const realTarget = path.join(base, "data");
      fs.mkdirSync(realTarget);
      const link = path.join(base, "link");
      fs.symlinkSync(realTarget, link);
      const dir = path.join(link, "manifests");
      expect(prepareLocalManifestDir(dir)).toEqual({
        ok: true,
        dir: path.join(fs.realpathSync(base), "data", "manifests"),
      });
      expect(modeOf(path.join(realTarget, "manifests"))).toBe(0o700);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects a repo-contained canonical destination reached through a symlink when not ignored", () => {
    const repo = tempDir("local-manifest-repo-link-");
    try {
      gitInit(repo);
      const realDir = path.join(repo, "real");
      fs.mkdirSync(realDir);
      const link = path.join(repo, "link");
      fs.symlinkSync(realDir, link);
      // The chosen path is inside the repo lexically AND canonically; the
      // canonical destination must pass check-ignore.
      expect(prepareLocalManifestDir(path.join(link, "artifacts"))).toEqual({
        ok: false,
        reason: "inside-repo-not-ignored",
      });
      expect(fs.existsSync(path.join(realDir, "artifacts"))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

