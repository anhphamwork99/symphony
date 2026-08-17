// FILE: piCatalogObserver.test.ts
// Purpose: Decision 35 measurement-only catalog observer tests. Covers the
// default-ready and activated-terminal success captures, dormancy (absent or
// disabled configuration performs no capture call/write/serialization),
// confinement (outside-home, traversal, symlink, non-regular targets),
// stale/wrong identity (generation change declines), malformed/write-failure
// markers, sanitized bounded diagnostics, non-interference (observer never
// throws and never mutates the session), and cleanup with the isolated home.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import {
  CATALOG_OBSERVER_ENV_ARTIFACT,
  CATALOG_OBSERVER_ENV_ENABLE,
  CATALOG_OBSERVER_ENV_HOME,
  CATALOG_OBSERVER_ENV_MODE,
  captureCatalogObserverEnv,
  makePiCatalogObserver,
  type PiCatalogObserver,
} from "./piCatalogObserver.ts";
import {
  CATALOG_ARTIFACT_SCHEMA,
  CATALOG_ARTIFACT_SCHEMA_VERSION,
  parseCatalogArtifact,
  validateCatalogArtifact,
  type CatalogArtifactOk,
} from "../measurement/catalogArtifact.ts";
import { canonicalizeManifest, sha256, toCanonicalEntries } from "../measurement/canonicalize.ts";
import { removeIsolatedHomeDir } from "../measurement/serverProcess.ts";

const TOOLS = [
  {
    name: "bash",
    description: "Run a command",
    parameters: { type: "object", properties: { command: { type: "string" } } },
    promptGuidelines: ["Prefer explicit commands"],
  },
  {
    name: "write",
    description: "Write a file",
    parameters: { type: "object" },
  },
] as const;

function stubSession(tools: readonly unknown[] | (() => readonly unknown[])): AgentSession {
  const getAllTools = typeof tools === "function" ? tools : () => tools;
  return { getAllTools } as unknown as AgentSession;
}

interface ObserverHarness {
  readonly homeDir: string;
  readonly artifactPath: string;
  readonly observer: PiCatalogObserver;
}

function makeHarness(
  mode: "synara-default" | "synara-activated",
  overrides: { readonly artifactPath?: string; readonly homeDir?: string } = {},
): ObserverHarness {
  const homeDir =
    overrides.homeDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-"));
  const artifactPath = overrides.artifactPath ?? path.join(homeDir, "catalog-artifact.json");
  const observer = makePiCatalogObserver({
    [CATALOG_OBSERVER_ENV_ENABLE]: "1",
    [CATALOG_OBSERVER_ENV_HOME]: homeDir,
    [CATALOG_OBSERVER_ENV_ARTIFACT]: artifactPath,
    [CATALOG_OBSERVER_ENV_MODE]: mode,
  });
  if (observer === null) {
    throw new Error("expected a configured observer");
  }
  return { homeDir, artifactPath, observer };
}

function expectNoArtifact(homeDir: string, artifactPath: string): void {
  expect(fs.existsSync(artifactPath)).toBe(false);
  const entries = fs.readdirSync(homeDir);
  expect(entries.filter((entry) => entry.includes("catalog-artifact"))).toEqual([]);
  expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
}

function readOkArtifact(artifactPath: string): CatalogArtifactOk {
  const parsed = parseCatalogArtifact(fs.readFileSync(artifactPath, "utf8"));
  if (parsed.status === "malformed") {
    throw new Error("expected an ok artifact, got malformed");
  }
  if (parsed.status === "failed") {
    throw new Error(`expected an ok artifact, got status 'failed' code '${parsed.code}'`);
  }
  return parsed;
}

describe("pi catalog observer dormancy (Decision 35)", () => {
  it("is absent for absent, false, or invalid enablement", () => {
    const base = {
      [CATALOG_OBSERVER_ENV_ENABLE]: "1",
      [CATALOG_OBSERVER_ENV_HOME]: "/tmp/home",
      [CATALOG_OBSERVER_ENV_ARTIFACT]: "/tmp/home/artifact.json",
      [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
    };
    expect(makePiCatalogObserver({})).toBeNull();
    expect(makePiCatalogObserver({ ...base, [CATALOG_OBSERVER_ENV_ENABLE]: "0" })).toBeNull();
    expect(makePiCatalogObserver({ ...base, [CATALOG_OBSERVER_ENV_ENABLE]: "true" })).toBeNull();
    expect(makePiCatalogObserver({ ...base, [CATALOG_OBSERVER_ENV_HOME]: "" })).toBeNull();
    expect(makePiCatalogObserver({ ...base, [CATALOG_OBSERVER_ENV_ARTIFACT]: "" })).toBeNull();
    expect(makePiCatalogObserver({ ...base, [CATALOG_OBSERVER_ENV_MODE]: "bogus" })).toBeNull();
    expect(makePiCatalogObserver({ ...base, [CATALOG_OBSERVER_ENV_MODE]: "1" })).toBeNull();
  });

  it("performs no capture call, write, or serialization when not configured", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-dormant-"));
    try {
      const artifactPath = path.join(homeDir, "catalog-artifact.json");
      const observer = makePiCatalogObserver({ [CATALOG_OBSERVER_ENV_ENABLE]: "1" });
      expect(observer).toBeNull();
      // A null observer has no observable capture surface at all.
      expectNoArtifact(homeDir, artifactPath);
    } finally {
      removeIsolatedHomeDir(homeDir);
    }
  });

  it("default mode does not capture at turn prompts", () => {
    const harness = makeHarness("synara-default");
    try {
      const getAllTools = vi.fn(() => TOOLS);
      const session = stubSession(getAllTools);
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-1",
      });
      expect(getAllTools).not.toHaveBeenCalled();
      expectNoArtifact(harness.homeDir, harness.artifactPath);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("activated mode does not capture at session ready (dormant catalog must never be promoted)", () => {
    const harness = makeHarness("synara-activated");
    try {
      const getAllTools = vi.fn(() => TOOLS);
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session: stubSession(getAllTools),
        lifecycleGeneration: "gen-1",
      });
      expect(getAllTools).not.toHaveBeenCalled();
      expectNoArtifact(harness.homeDir, harness.artifactPath);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("activated mode does not capture before a committed activation", () => {
    const harness = makeHarness("synara-activated");
    try {
      const getAllTools = vi.fn(() => TOOLS);
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session: stubSession(getAllTools),
        lifecycleGeneration: "gen-1",
      });
      expect(getAllTools).not.toHaveBeenCalled();
      expectNoArtifact(harness.homeDir, harness.artifactPath);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });
});

describe("pi catalog observer success captures (Decision 35)", () => {
  it("default mode captures the complete live manifest after readiness", () => {
    const harness = makeHarness("synara-default");
    try {
      const getAllTools = vi.fn(() => TOOLS);
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session: stubSession(getAllTools),
        lifecycleGeneration: "gen-1",
      });
      expect(getAllTools).toHaveBeenCalledTimes(1);
      const artifact = readOkArtifact(harness.artifactPath);
      expect(artifact.schema).toBe(CATALOG_ARTIFACT_SCHEMA);
      expect(artifact.schemaVersion).toBe(CATALOG_ARTIFACT_SCHEMA_VERSION);
      expect(artifact.mode).toBe("synara-default");
      expect(artifact.threadId).toBe("thread-1");
      expect(artifact.lifecycleGeneration).toBe("gen-1");
      expect(artifact.phase).toBe("ready");
      expect(artifact.toolCount).toBe(2);
      expect(artifact.entries.map((entry: { readonly name: string }) => entry.name).sort()).toEqual(
        ["bash", "write"],
      );
      // Completeness: bytes and hash equal the direct canonicalization of the
      // live API result (the artifact entries ARE the getAllTools result).
      const canonical = canonicalizeManifest(toCanonicalEntries(TOOLS));
      expect(artifact.canonicalBytes).toBe(canonical.byteLength);
      expect(artifact.hash).toBe(sha256(canonical));
      const validation = validateCatalogArtifact(artifact, {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      });
      expect(validation.ok).toBe(true);
      // Restrictive permissions: directory owner-only, artifact owner rw.
      expect(fs.statSync(harness.homeDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(harness.artifactPath).mode & 0o777).toBe(0o600);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("activated mode captures only after commit + reload, at the first prompt, generation current", () => {
    const harness = makeHarness("synara-activated");
    try {
      const getAllTools = vi.fn(() => TOOLS);
      const session = stubSession(getAllTools);
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-1",
      });
      expectNoArtifact(harness.homeDir, harness.artifactPath);
      harness.observer.onActivationCommitted({
        threadId: "thread-1",
        lifecycleGeneration: "gen-1",
      });
      expectNoArtifact(harness.homeDir, harness.artifactPath);
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-1",
      });
      const artifact = readOkArtifact(harness.artifactPath);
      expect(artifact.mode).toBe("synara-activated");
      expect(artifact.phase).toBe("activated-terminal");
      expect(artifact.threadId).toBe("thread-1");
      expect(artifact.lifecycleGeneration).toBe("gen-1");
      const canonical = canonicalizeManifest(toCanonicalEntries(TOOLS));
      expect(artifact.canonicalBytes).toBe(canonical.byteLength);
      expect(artifact.hash).toBe(sha256(canonical));
      // One capture per session: a later prompt does not re-capture.
      fs.rmSync(harness.artifactPath);
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-1",
      });
      expect(fs.existsSync(harness.artifactPath)).toBe(false);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("declines the activated capture when the generation changed before capture", () => {
    const harness = makeHarness("synara-activated");
    try {
      const session = stubSession(TOOLS);
      harness.observer.onActivationCommitted({
        threadId: "thread-1",
        lifecycleGeneration: "gen-1",
      });
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-2",
      });
      expectNoArtifact(harness.homeDir, harness.artifactPath);
      // One side unknown is also a change: decline.
      harness.observer.onActivationCommitted({
        threadId: "thread-1",
        lifecycleGeneration: "gen-1",
      });
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: undefined,
      });
      expectNoArtifact(harness.homeDir, harness.artifactPath);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("a fresh session resets the lifecycle state (stale activation never satisfies capture)", () => {
    const harness = makeHarness("synara-activated");
    try {
      const session = stubSession(TOOLS);
      harness.observer.onActivationCommitted({
        threadId: "thread-1",
        lifecycleGeneration: "gen-1",
      });
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-2",
      });
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-2",
      });
      expectNoArtifact(harness.homeDir, harness.artifactPath);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });
});

describe("pi catalog observer confinement (Decision 35)", () => {
  it("rejects outside-home absolute paths and traversal and writes nothing", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-confine-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-outside-"));
    try {
      const session = stubSession(TOOLS);
      for (const artifactPath of [
        path.join(outsideDir, "artifact.json"),
        path.join(homeDir, "..", "escape.json"),
        path.join(homeDir, "sub", "..", "..", "escape.json"),
      ]) {
        const observer = makePiCatalogObserver({
          [CATALOG_OBSERVER_ENV_ENABLE]: "1",
          [CATALOG_OBSERVER_ENV_HOME]: homeDir,
          [CATALOG_OBSERVER_ENV_ARTIFACT]: artifactPath,
          [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
        });
        expect(observer).not.toBeNull();
        observer!.onSessionReady({
          threadId: "thread-1",
          session,
          lifecycleGeneration: "gen-1",
        });
      }
      expectNoArtifact(homeDir, path.join(homeDir, "escape.json"));
      expect(fs.readdirSync(outsideDir)).toEqual([]);
    } finally {
      removeIsolatedHomeDir(homeDir);
      removeIsolatedHomeDir(outsideDir);
    }
  });

  it("rejects symlink traversal through parent components", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-symlink-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-outside-"));
    try {
      const session = stubSession(TOOLS);
      fs.mkdirSync(path.join(homeDir, "sub"));
      fs.symlinkSync(outsideDir, path.join(homeDir, "sub", "link"));
      const observer = makePiCatalogObserver({
        [CATALOG_OBSERVER_ENV_ENABLE]: "1",
        [CATALOG_OBSERVER_ENV_HOME]: homeDir,
        [CATALOG_OBSERVER_ENV_ARTIFACT]: path.join(homeDir, "sub", "link", "artifact.json"),
        [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
      });
      observer!.onSessionReady({ threadId: "thread-1", session, lifecycleGeneration: "gen-1" });
      expect(fs.readdirSync(outsideDir)).toEqual([]);
      expectNoArtifact(homeDir, path.join(homeDir, "sub", "link", "artifact.json"));
    } finally {
      removeIsolatedHomeDir(homeDir);
      removeIsolatedHomeDir(outsideDir);
    }
  });

  it("rejects symlink destinations and non-regular existing targets", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-target-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-outside-"));
    try {
      const session = stubSession(TOOLS);
      const symlinkTarget = path.join(homeDir, "catalog-artifact.json");
      const outsideFile = path.join(outsideDir, "victim.json");
      fs.symlinkSync(outsideFile, symlinkTarget);
      const symlinkObserver = makePiCatalogObserver({
        [CATALOG_OBSERVER_ENV_ENABLE]: "1",
        [CATALOG_OBSERVER_ENV_HOME]: homeDir,
        [CATALOG_OBSERVER_ENV_ARTIFACT]: symlinkTarget,
        [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
      });
      symlinkObserver!.onSessionReady({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-1",
      });
      expect(fs.existsSync(outsideFile)).toBe(false);
      // A directory at the destination is a non-regular target: rejected.
      fs.rmSync(symlinkTarget);
      fs.mkdirSync(symlinkTarget);
      symlinkObserver!.onSessionReady({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-1",
      });
      expect(fs.statSync(symlinkTarget).isDirectory()).toBe(true);
      expect(fs.readdirSync(symlinkTarget)).toEqual([]);
    } finally {
      removeIsolatedHomeDir(homeDir);
      removeIsolatedHomeDir(outsideDir);
    }
  });

  it("rejects a relative artifact path", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-relative-"));
    try {
      const session = stubSession(TOOLS);
      const observer = makePiCatalogObserver({
        [CATALOG_OBSERVER_ENV_ENABLE]: "1",
        [CATALOG_OBSERVER_ENV_HOME]: homeDir,
        [CATALOG_OBSERVER_ENV_ARTIFACT]: "catalog-artifact.json",
        [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
      });
      observer!.onSessionReady({ threadId: "thread-1", session, lifecycleGeneration: "gen-1" });
      expectNoArtifact(homeDir, path.join(homeDir, "catalog-artifact.json"));
    } finally {
      removeIsolatedHomeDir(homeDir);
    }
  });
});

describe("pi catalog observer failure surfaces (Decision 35)", () => {
  it("writes a bounded failure marker when enumeration fails", () => {
    const harness = makeHarness("synara-default");
    try {
      const session = stubSession(() => {
        throw new Error("boom");
      });
      expect(() =>
        harness.observer.onSessionReady({
          threadId: "thread-1",
          session,
          lifecycleGeneration: "gen-1",
        }),
      ).not.toThrow();
      const parsed = parseCatalogArtifact(fs.readFileSync(harness.artifactPath, "utf8"));
      if (parsed.status === "malformed") throw new Error("expected a failure marker");
      expect(parsed.status).toBe("failed");
      if (parsed.status === "failed") {
        expect(parsed.code).toBe("enumeration-failed");
      }
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("writes a bounded failure marker for an empty effective catalog", () => {
    const harness = makeHarness("synara-default");
    try {
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session: stubSession([]),
        lifecycleGeneration: "gen-1",
      });
      const parsed = parseCatalogArtifact(fs.readFileSync(harness.artifactPath, "utf8"));
      if (parsed.status === "malformed") throw new Error("expected a failure marker");
      expect(parsed.status).toBe("failed");
      if (parsed.status === "failed") {
        expect(parsed.code).toBe("empty-catalog");
      }
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("writes a bounded failure marker when serialization fails", () => {
    const harness = makeHarness("synara-default");
    try {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const session = stubSession([
        {
          name: "bash",
          description: "Run a command",
          parameters: circular,
        },
      ]);
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "gen-1",
      });
      const parsed = parseCatalogArtifact(fs.readFileSync(harness.artifactPath, "utf8"));
      if (parsed.status === "malformed") throw new Error("expected a failure marker");
      expect(parsed.status).toBe("failed");
      if (parsed.status === "failed") {
        // The canonical serializer is the first serialization boundary and
        // rejects the non-serializable schema surface.
        expect(parsed.code).toBe("canonicalization-failed");
      }
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("fails closed without writing anything when the destination cannot be written", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-writefail-"));
    try {
      // The artifact parent is a regular file: no directory exists for the
      // temp write, and the marker cannot be written either.
      const blocker = path.join(homeDir, "blocker");
      fs.writeFileSync(blocker, "not a directory");
      const artifactPath = path.join(blocker, "artifact.json");
      const observer = makePiCatalogObserver({
        [CATALOG_OBSERVER_ENV_ENABLE]: "1",
        [CATALOG_OBSERVER_ENV_HOME]: homeDir,
        [CATALOG_OBSERVER_ENV_ARTIFACT]: artifactPath,
        [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
      });
      expect(() =>
        observer!.onSessionReady({
          threadId: "thread-1",
          session: stubSession(TOOLS),
          lifecycleGeneration: "gen-1",
        }),
      ).not.toThrow();
      expect(fs.existsSync(artifactPath)).toBe(false);
      expect(fs.readFileSync(blocker, "utf8")).toBe("not a directory");
    } finally {
      removeIsolatedHomeDir(homeDir);
    }
  });

  it("keeps failure markers sanitized (no paths, schemas, or credentials)", () => {
    const harness = makeHarness("synara-default");
    try {
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session: stubSession([]),
        lifecycleGeneration: "gen-1",
      });
      const content = fs.readFileSync(harness.artifactPath, "utf8");
      expect(content).not.toContain(harness.homeDir);
      expect(content).not.toContain(harness.artifactPath);
      const parsed = parseCatalogArtifact(content);
      if (parsed.status === "malformed") throw new Error("expected a failure marker");
      if (parsed.status === "failed") {
        expect(parsed.message).toMatch(/^catalog observer capture failed: [a-z-]+$/);
      }
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });
});

describe("pi catalog observer environment capture and scrub (Decision 35 confinement)", () => {
  it("captures the observer configuration once and scrubs it from the process environment", () => {
    const source: NodeJS.ProcessEnv = {
      [CATALOG_OBSERVER_ENV_ENABLE]: "1",
      [CATALOG_OBSERVER_ENV_HOME]: "/tmp/isolated-home",
      [CATALOG_OBSERVER_ENV_ARTIFACT]: "/tmp/isolated-home/catalog-artifact.json",
      [CATALOG_OBSERVER_ENV_MODE]: "synara-activated",
      UNRELATED_VAR: "keep-me",
    };
    const processEnv: NodeJS.ProcessEnv = { ...source };
    const captured = captureCatalogObserverEnv(source, processEnv);
    // Captured once for the adapter; unrelated variables are untouched.
    expect(captured[CATALOG_OBSERVER_ENV_ENABLE]).toBe("1");
    expect(captured[CATALOG_OBSERVER_ENV_MODE]).toBe("synara-activated");
    expect(captured.UNRELATED_VAR).toBeUndefined();
    // Scrubbed before any unrelated child/tool process can inherit them.
    for (const key of [
      CATALOG_OBSERVER_ENV_ENABLE,
      CATALOG_OBSERVER_ENV_HOME,
      CATALOG_OBSERVER_ENV_ARTIFACT,
      CATALOG_OBSERVER_ENV_MODE,
    ]) {
      expect(processEnv[key]).toBeUndefined();
    }
    expect(processEnv.UNRELATED_VAR).toBe("keep-me");
  });

  it("absent mode explicitly removes inherited observer variables from the process environment", () => {
    const processEnv: NodeJS.ProcessEnv = {
      [CATALOG_OBSERVER_ENV_ENABLE]: "0",
      [CATALOG_OBSERVER_ENV_HOME]: "/tmp/leaked-home",
      [CATALOG_OBSERVER_ENV_ARTIFACT]: "/tmp/leaked-home/catalog-artifact.json",
      [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
    };
    const captured = captureCatalogObserverEnv(processEnv, processEnv);
    // Disabled enablement: the observer stays absent…
    expect(makePiCatalogObserver(captured)).toBeNull();
    // …but the inherited observer variables are removed anyway so they never
    // leak into unrelated child/tool processes.
    for (const key of [
      CATALOG_OBSERVER_ENV_ENABLE,
      CATALOG_OBSERVER_ENV_HOME,
      CATALOG_OBSERVER_ENV_ARTIFACT,
      CATALOG_OBSERVER_ENV_MODE,
    ]) {
      expect(processEnv[key]).toBeUndefined();
    }
  });

  it("an observer built from the captured snapshot still captures while the environment stays scrubbed", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-capture-"));
    try {
      const artifactPath = path.join(homeDir, "catalog-artifact.json");
      const processEnv: NodeJS.ProcessEnv = {
        [CATALOG_OBSERVER_ENV_ENABLE]: "1",
        [CATALOG_OBSERVER_ENV_HOME]: homeDir,
        [CATALOG_OBSERVER_ENV_ARTIFACT]: artifactPath,
        [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
      };
      const captured = captureCatalogObserverEnv(processEnv, processEnv);
      const observer = makePiCatalogObserver(captured);
      expect(observer).not.toBeNull();
      observer!.onSessionReady({
        threadId: "thread-1",
        session: stubSession(TOOLS),
        lifecycleGeneration: "gen-1",
      });
      // The capture itself still works from the captured snapshot, and the
      // process environment remains scrubbed (nothing re-inherits it).
      expect(fs.existsSync(artifactPath)).toBe(true);
      for (const key of [
        CATALOG_OBSERVER_ENV_ENABLE,
        CATALOG_OBSERVER_ENV_HOME,
        CATALOG_OBSERVER_ENV_ARTIFACT,
        CATALOG_OBSERVER_ENV_MODE,
      ]) {
        expect(processEnv[key]).toBeUndefined();
      }
    } finally {
      removeIsolatedHomeDir(homeDir);
    }
  });
});

describe("pi catalog observer generation binding (Decision 35)", () => {
  it("records the exact committed activation lifecycle generation in the artifact", () => {
    const harness = makeHarness("synara-activated");
    try {
      const session = stubSession(TOOLS);
      // The session started with the outer session-start generation; the
      // activation commits a FRESH generation (the coordinator mints one per
      // activation at the safe boundary). Only the committed generation may
      // bind the capture.
      harness.observer.onSessionReady({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "outer-session-gen",
      });
      harness.observer.onActivationCommitted({
        threadId: "thread-1",
        lifecycleGeneration: "committed-activation-gen",
      });
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "committed-activation-gen",
      });
      const artifact = readOkArtifact(harness.artifactPath);
      expect(artifact.lifecycleGeneration).toBe("committed-activation-gen");
      // The consumer accepts it when the expected committed generation is
      // known and rejects the outer session-start generation as stale.
      expect(
        validateCatalogArtifact(artifact, {
          mode: "synara-activated",
          threadId: "thread-1",
          phase: "activated-terminal",
          lifecycleGeneration: "committed-activation-gen",
        }).ok,
      ).toBe(true);
      expect(
        validateCatalogArtifact(artifact, {
          mode: "synara-activated",
          threadId: "thread-1",
          phase: "activated-terminal",
          lifecycleGeneration: "outer-session-gen",
        }),
      ).toEqual({ ok: false, reason: "generation-mismatch" });
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("declines the activated capture when the prompt generation is not the committed generation", () => {
    const harness = makeHarness("synara-activated");
    try {
      const session = stubSession(TOOLS);
      harness.observer.onActivationCommitted({
        threadId: "thread-1",
        lifecycleGeneration: "committed-activation-gen",
      });
      // The prompt still runs under the outer session generation: the
      // committed generation is no longer current, so the capture is declined.
      harness.observer.onTurnPrompt({
        threadId: "thread-1",
        session,
        lifecycleGeneration: "outer-session-gen",
      });
      expectNoArtifact(harness.homeDir, harness.artifactPath);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });
});

describe("pi catalog observer non-interference and cleanup (Decision 35)", () => {
  it("never throws into the lifecycle and never mutates the session", () => {
    const harness = makeHarness("synara-default");
    try {
      const getAllTools = vi.fn(() => TOOLS);
      const session = stubSession(getAllTools);
      expect(() =>
        harness.observer.onSessionReady({
          threadId: "thread-1",
          session,
          lifecycleGeneration: "gen-1",
        }),
      ).not.toThrow();
      // Only the read-only enumeration touched the session, and the capture
      // produced exactly the one artifact — no stray files.
      expect(getAllTools).toHaveBeenCalledTimes(1);
      expect(fs.readdirSync(harness.homeDir)).toEqual(["catalog-artifact.json"]);
    } finally {
      removeIsolatedHomeDir(harness.homeDir);
    }
  });

  it("removes the full-manifest artifact with the isolated home (success and failure)", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-observer-cleanup-"));
    const artifactPath = path.join(homeDir, "catalog-artifact.json");
    try {
      const observer = makePiCatalogObserver({
        [CATALOG_OBSERVER_ENV_ENABLE]: "1",
        [CATALOG_OBSERVER_ENV_HOME]: homeDir,
        [CATALOG_OBSERVER_ENV_ARTIFACT]: artifactPath,
        [CATALOG_OBSERVER_ENV_MODE]: "synara-default",
      });
      observer!.onSessionReady({
        threadId: "thread-1",
        session: stubSession(TOOLS),
        lifecycleGeneration: "gen-1",
      });
      expect(fs.existsSync(artifactPath)).toBe(true);
      removeIsolatedHomeDir(homeDir);
      expect(fs.existsSync(homeDir)).toBe(false);
    } finally {
      removeIsolatedHomeDir(homeDir);
    }
  });
});
