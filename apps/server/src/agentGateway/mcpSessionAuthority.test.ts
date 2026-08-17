import { describe, expect, it } from "vitest";

import { makeMcpSessionAuthorityRegistry } from "./mcpSessionAuthority.ts";

const NOW = 1_780_000_000_000;

function authorityFixture() {
  let time = NOW;
  let next = 0;
  const registry = makeMcpSessionAuthorityRegistry({
    randomId: () => `id-${++next}`,
    now: () => time,
  });
  return {
    registry,
    now: () => time,
    setTime: (value: number) => {
      time = value;
    },
  };
}

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

describe("assertAdmittable", () => {
  const DISPATCH = {
    threadId: "thread-1",
    provider: "codex",
    projectId: "project-1",
    lifecycleGeneration: "gen-7",
    credentialTtlMs: 300_000,
  };

  function bind(
    registry: ReturnType<typeof authorityFixture>["registry"],
    record: {
      authorityId: string;
    },
  ) {
    return registry.bindingFor(record.authorityId, DISPATCH);
  }

  it("admits a live binding derived from an active record", () => {
    const { registry } = authorityFixture();
    const record = registry.mint({
      subject: "user-1",
      kind: "authenticated",
      authExpiresAt: NOW + 3_600_000,
    });

    const binding = bind(registry, record);
    expect(binding).not.toBeNull();
    expect(
      registry.assertAdmittable(binding!, { projectId: "project-1", lifecycleGeneration: "gen-7" }),
    ).toBeNull();
  });

  it("fails closed for an unknown authorityId", () => {
    const { registry } = authorityFixture();
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });
    const binding = bind(registry, record);

    expect(registry.assertAdmittable({ ...binding!, authorityId: "mcp-authority-elsewhere" })).toBe(
      "unknown-authority",
    );
  });

  it("fails closed for a revoked record even with an otherwise valid snapshot", () => {
    const { registry } = authorityFixture();
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });
    const binding = bind(registry, record);
    expect(registry.revoke(record.authorityId, "rotation")).toBe(true);

    expect(registry.assertAdmittable(binding!, { projectId: "project-1" })).toBe("revoked");
  });

  it("fails closed after the authentication expires", () => {
    const { registry, setTime } = authorityFixture();
    // The auth horizon outlives the credential TTL at issuance so a binding
    // can exist; it then expires before the credential would.
    const record = registry.mint({
      subject: "user-1",
      kind: "authenticated",
      authExpiresAt: NOW + 400_000,
    });
    const binding = bind(registry, record);

    setTime(NOW + 450_000);
    expect(registry.assertAdmittable(binding!, { projectId: "project-1" })).toBe("expired-auth");
  });

  it("fails closed after the credential expires independently of the authentication", () => {
    const { registry, setTime } = authorityFixture();
    // Local-owner records never expire their authentication, so only the
    // credential TTL can trip this arm.
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });
    const binding = registry.bindingFor(record.authorityId, {
      ...DISPATCH,
      credentialTtlMs: 10_000,
    });

    setTime(NOW + 20_000);
    expect(registry.assertAdmittable(binding!, { projectId: "project-1" })).toBe(
      "expired-credential",
    );
  });

  it("fails closed for a snapshot stamped after admission time", () => {
    const { registry, setTime } = authorityFixture();
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });
    const binding = bind(registry, record);

    setTime(NOW - 1_000);
    expect(registry.assertAdmittable(binding!, { projectId: "project-1" })).toBe(
      "invalid-issuance",
    );
  });

  it("fails closed for a stale session generation snapshot", () => {
    const { registry } = authorityFixture();
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });
    const binding = bind(registry, record);

    expect(
      registry.assertAdmittable({ ...binding!, sessionGeneration: "gen-from-old-session" }),
    ).toBe("stale-session-generation");
  });

  it("fails closed for a credential bound to an older lifecycle generation", () => {
    const { registry } = authorityFixture();
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });
    const binding = bind(registry, record);

    expect(
      registry.assertAdmittable(binding!, {
        projectId: "project-1",
        lifecycleGeneration: "gen-8",
      }),
    ).toBe("stale-lifecycle-generation");
    // Unknown lifecycle state never fabricates a mismatch.
    expect(
      registry.assertAdmittable(binding!, { projectId: "project-1", lifecycleGeneration: null }),
    ).toBeNull();
  });

  it("fails closed for subject, auth-session, and kind mismatches", () => {
    const { registry } = authorityFixture();
    const record = registry.mint({
      subject: "user-1",
      kind: "authenticated",
      authSessionId: "session-9",
    });
    const binding = bind(registry, record);

    expect(registry.assertAdmittable({ ...binding!, subject: "user-2" })).toBe("subject-mismatch");
    expect(registry.assertAdmittable({ ...binding!, authSessionId: "session-other" })).toBe(
      "subject-mismatch",
    );
    expect(registry.assertAdmittable({ ...binding!, kind: "local-owner" })).toBe("kind-mismatch");
  });

  it("fails closed when the credential's project binding disagrees with the trusted thread", () => {
    const { registry } = authorityFixture();
    const record = registry.mint({ subject: "user-1", kind: "local-owner" });
    const binding = bind(registry, record);

    expect(registry.assertAdmittable(binding!, { projectId: "project-2" })).toBe(
      "project-mismatch",
    );
    expect(registry.assertAdmittable(binding!, { projectId: null })).toBeNull();
    // A binding that was never project-bound cannot be mismatched.
    const unbound = registry.bindingFor(record.authorityId, { ...DISPATCH, projectId: null });
    expect(registry.assertAdmittable(unbound!, { projectId: "project-2" })).toBeNull();
  });
});
