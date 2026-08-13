import { describe, expect, it } from "vitest";

import { makeMcpSessionAuthorityRegistry } from "./mcpSessionAuthority.ts";

const NOW = 1_780_000_000_000;

describe("makeMcpSessionAuthorityRegistry", () => {
  it("mints records bound to the subject with unguessable authorityId and sessionGeneration", () => {
    let next = 0;
    const registry = makeMcpSessionAuthorityRegistry({
      randomId: () => `id-${++next}`,
      now: () => NOW,
    });

    const record = registry.mint({
      subject: "user-42",
      kind: "authenticated",
      authSessionId: "session-9",
      authExpiresAt: NOW + 60_000,
    });

    expect(record.authorityId).toBe("mcp-authority-id-1");
    expect(record.sessionGeneration).toMatch(/^gen-id-/);
    expect(record.subject).toBe("user-42");
    expect(record.kind).toBe("authenticated");
    expect(record.authSessionId).toBe("session-9");
    expect(record.authExpiresAt).toBe(NOW + 60_000);
    expect(record.issuedAt).toBe(NOW);
    expect(record.status).toBe("active");
    expect(registry.get(record.authorityId)).toEqual(record);
  });

  it("mints two records for the same subject with distinct authorityId and sessionGeneration", () => {
    let next = 0;
    const registry = makeMcpSessionAuthorityRegistry({
      randomId: () => `id-${++next}`,
      now: () => NOW,
    });

    const first = registry.mint({ subject: "user-1", kind: "authenticated" });
    const second = registry.mint({ subject: "user-1", kind: "authenticated" });

    expect(first.authorityId).not.toBe(second.authorityId);
    expect(first.sessionGeneration).not.toBe(second.sessionGeneration);
  });

  it("bindingFor stamps credentialExpiresAt and carries the trusted runtime context", () => {
    let next = 0;
    const registry = makeMcpSessionAuthorityRegistry({
      randomId: () => `id-${++next}`,
      now: () => NOW,
    });
    const record = registry.mint({
      subject: "user-1",
      kind: "authenticated",
      authExpiresAt: NOW + 3_600_000,
    });

    const binding = registry.bindingFor(record.authorityId, {
      threadId: "thread-1",
      provider: "codex",
      projectId: "project-1",
      lifecycleGeneration: "gen-7",
      credentialTtlMs: 300_000,
    });

    expect(binding).not.toBeNull();
    expect(binding?.authorityId).toBe(record.authorityId);
    expect(binding?.subject).toBe("user-1");
    expect(binding?.sessionGeneration).toBe(record.sessionGeneration);
    expect(binding?.issuedAt).toBe(NOW);
    expect(binding?.credentialExpiresAt).toBe(NOW + 300_000);
    expect(binding?.projectId).toBe("project-1");
    expect(binding?.lifecycleGeneration).toBe("gen-7");
  });

  it("bindingFor returns null for an unknown or revoked authority", () => {
    const registry = makeMcpSessionAuthorityRegistry({ now: () => NOW });
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });

    expect(
      registry.bindingFor("mcp-authority-missing", {
        threadId: "thread-1",
        provider: "codex",
        projectId: null,
        lifecycleGeneration: null,
        credentialTtlMs: 60_000,
      }),
    ).toBeNull();

    expect(registry.revoke(record.authorityId, "rotation")).toBe(true);
    expect(registry.get(record.authorityId)?.status).toBe("revoked");
    expect(registry.get(record.authorityId)?.revokedReason).toBe("rotation");
    expect(
      registry.bindingFor(record.authorityId, {
        threadId: "thread-1",
        provider: "codex",
        projectId: null,
        lifecycleGeneration: null,
        credentialTtlMs: 60_000,
      }),
    ).toBeNull();
  });

  it("bindingFor returns null when authentication has expired", () => {
    const registry = makeMcpSessionAuthorityRegistry({
      now: () => NOW,
      randomId: () => "fixed-id",
    });
    const record = registry.mint({
      subject: "user-1",
      kind: "authenticated",
      authExpiresAt: NOW - 1_000,
    });

    expect(record.status).toBe("expired");
    expect(
      registry.bindingFor(record.authorityId, {
        threadId: "thread-1",
        provider: "codex",
        projectId: null,
        lifecycleGeneration: null,
        credentialTtlMs: 60_000,
      }),
    ).toBeNull();
  });

  it("bindingFor refuses an authentication that expires before the credential would", () => {
    const registry = makeMcpSessionAuthorityRegistry({
      now: () => NOW,
      randomId: () => "fixed-id",
    });
    const record = registry.mint({
      subject: "user-1",
      kind: "authenticated",
      authExpiresAt: NOW + 10_000,
    });

    expect(
      registry.bindingFor(record.authorityId, {
        threadId: "thread-1",
        provider: "codex",
        projectId: null,
        lifecycleGeneration: null,
        credentialTtlMs: 60_000,
      }),
    ).toBeNull();
  });

  it("resolves dispatch and thread bindings exactly as written", () => {
    let next = 0;
    const registry = makeMcpSessionAuthorityRegistry({
      randomId: () => `id-${++next}`,
      now: () => NOW,
    });
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });

    expect(registry.bindDispatch("command-1", record.authorityId)).toBe(true);
    expect(registry.bindThread("thread-2", record.authorityId)).toBe(true);
    expect(registry.bindDispatch("command-unknown", "mcp-authority-nope")).toBe(false);

    expect(registry.resolveForCommand("command-1", "thread-other")?.authorityId).toBe(
      record.authorityId,
    );
    // Fallback to the thread index when no command binding exists.
    expect(registry.resolveForCommand("command-other", "thread-2")?.authorityId).toBe(
      record.authorityId,
    );
    expect(registry.resolveForCommand("command-unknown", "thread-unknown")).toBeUndefined();
  });

  it("prunes the oldest dispatch bindings when the cap is reached", () => {
    let next = 0;
    const registry = makeMcpSessionAuthorityRegistry({
      randomId: () => `id-${++next}`,
      now: () => NOW,
      maxDispatchBindings: 2,
    });
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });

    registry.bindDispatch("command-1", record.authorityId);
    registry.bindDispatch("command-2", record.authorityId);
    registry.bindDispatch("command-3", record.authorityId);

    expect(registry.resolveForCommand("command-1", "thread-x")).toBeUndefined();
    expect(registry.resolveForCommand("command-2", "thread-x")?.authorityId).toBe(
      record.authorityId,
    );
    expect(registry.resolveForCommand("command-3", "thread-x")?.authorityId).toBe(
      record.authorityId,
    );
  });
});