import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { DateTime, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../../config";
import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore.ts";
import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../Services/McpSessionAuthority.ts";
import { McpSessionAuthorityLive } from "./McpSessionAuthority.ts";

const NOW = 1_780_000_000_000;
const FAR_FUTURE = Date.now() + 3_600_000;

function makeLayerFor(baseDir: string) {
  return McpSessionAuthorityLive.pipe(
    Layer.provide(ServerSecretStoreLive),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provide(NodeServices.layer),
  );
}

async function registryFor(baseDir: string): Promise<McpSessionAuthorityShape> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* McpSessionAuthority;
    }).pipe(Effect.provide(makeLayerFor(baseDir))),
  );
}

describe("McpSessionAuthorityLive", () => {
  it("yields the identical local-owner subject across two layer builds over one secret store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synara-mcp-authority-shared-"));

    const first = await registryFor(dir);
    const second = await registryFor(dir);

    const a = first.mintForLocalOwner();
    const b = second.mintForLocalOwner();
    expect(a.subject).toMatch(/^local-owner:/);
    expect(a.subject).toBe(b.subject);
  });

  it("yields different subjects across different secret stores", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "synara-mcp-authority-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "synara-mcp-authority-b-"));

    const a = (await registryFor(dirA)).mintForLocalOwner();
    const b = (await registryFor(dirB)).mintForLocalOwner();

    expect(a.subject).not.toBe(b.subject);
  });

  it("gives every local-owner record the same principal but fresh authority", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synara-mcp-authority-records-"));
    const registry = await registryFor(dir);

    const first = registry.mintForLocalOwner();
    const second = registry.mintForLocalOwner();

    expect(first.subject).toBe(second.subject);
    expect(first.kind).toBe("local-owner");
    expect(first.authorityId).not.toBe(second.authorityId);
    expect(first.sessionGeneration).not.toBe(second.sessionGeneration);
  });

  it("mints authenticated records from the trusted session and confirms bindings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synara-mcp-authority-auth-"));
    const registry = await registryFor(dir);

    const record = registry.mintForAuthenticated({
      sessionId: "session-auth",
      subject: "user-99",
      expiresAt: DateTime.makeUnsafe(FAR_FUTURE),
    });

    expect(record.kind).toBe("authenticated");
    expect(record.subject).toBe("user-99");
    expect(record.authSessionId).toBe("session-auth");
    expect(record.authExpiresAt).toBe(FAR_FUTURE);

    const binding = registry.bindingFor(record.authorityId, {
      threadId: "thread-1",
      provider: "codex",
      projectId: "project-1",
      lifecycleGeneration: "gen-7",
      credentialTtlMs: 300_000,
    });
    expect(binding?.subject).toBe("user-99");
    expect(binding?.authorityId).toBe(record.authorityId);
    expect(binding?.projectId).toBe("project-1");
  });

  it("mints an unexpiring record when the authenticated session has no expiry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synara-mcp-authority-noexpiry-"));
    const registry = await registryFor(dir);

    const record = registry.mintForAuthenticated({
      sessionId: "session-auth-2",
      subject: "user-7",
      expiresAt: null,
    });

    expect(record.authExpiresAt).toBeNull();
    const binding = registry.bindingFor(record.authorityId, {
      threadId: "thread-1",
      provider: "codex",
      projectId: null,
      lifecycleGeneration: null,
      credentialTtlMs: 60_000,
    });
    expect(binding).not.toBeNull();
  });

  it("never derives the local-owner principal from caller input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synara-mcp-authority-input-"));
    const registry = await registryFor(dir);

    const record = registry.mintForLocalOwner();
    expect(record.subject.startsWith("local-owner:")).toBe(true);
  });
});
