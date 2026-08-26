import { describe, expect, it } from "vitest";

import { PI_SUBAGENT_CAPABILITIES, type PiSubagentHandshakeRequest } from "@synara/contracts";

import { createDefaultHandshakeRequest, PI_SUBAGENT_BRIDGE_KEY } from "./piSubagentBridge.ts";
import {
  createPiSubagentDesktopManagedHandshakeRequest,
  negotiatePiSubagentDesktopManagedBridge,
  PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES,
  PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL,
  piSubagentDesktopManagedBootstrapFailureDetail,
  piSubagentDesktopManagedExtensionDir,
} from "./piSubagentManagedRuntimeBinding.ts";

/**
 * Ticket 02 — pure decision tests for the desktop managed-bootstrap binding
 * helpers (AC2 / AC5, spec Implementation Decisions 4/5; Decisions 0002 and
 * 0003).
 *
 * These helpers are pure: no fs, no Pi SDK import, no side effects. The
 * tests prove (1) the mandatory eight-capability profile, (2) that the
 * desktop negotiation is FATAL-shaped (absent / mismatched / malformed
 * bridges return a non-managed result that the bootstrap boundary must
 * treat as fatal — never a legacy fallback), and (3) that the failure
 * detail builder emits only closed-vocabulary, bounded, redacted text.
 */

const REQUIRED_CAPABILITIES = [
  "managed-spawn",
  "abort-propagation",
  "bounded-foreground-attachment",
  "coalesced-progress",
  "durable-cancellation",
  "journal-terminal-lifecycle",
  "child-bash-process-ownership",
  "execution-identity-routing-v1",
] as const;

const bridgeWith = (handshake: (request: PiSubagentHandshakeRequest) => unknown) => ({
  [PI_SUBAGENT_BRIDGE_KEY]: { handshake },
});

describe("PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES", () => {
  it("is exactly the mandatory desktop profile in spec order", () => {
    expect([...PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES]).toEqual([...REQUIRED_CAPABILITIES]);
  });

  it("contains only closed-vocabulary capabilities", () => {
    const closed = new Set<string>(PI_SUBAGENT_CAPABILITIES);
    for (const capability of PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES) {
      expect(closed.has(capability)).toBe(true);
    }
  });
});

describe("piSubagentDesktopManagedExtensionDir", () => {
  it("is the controlled extensions/pi-subagents directory inside agentDir", () => {
    expect(piSubagentDesktopManagedExtensionDir("/release/artifact/agent")).toBe(
      "/release/artifact/agent/extensions/pi-subagents",
    );
  });
});

describe("createPiSubagentDesktopManagedHandshakeRequest", () => {
  it("widens the default 3-required probe to the full mandatory eight", () => {
    const request = createPiSubagentDesktopManagedHandshakeRequest();
    expect(request.requiredCapabilities).toEqual([...REQUIRED_CAPABILITIES]);
  });

  it("keeps the default request's other fields", () => {
    const base = createDefaultHandshakeRequest();
    const request = createPiSubagentDesktopManagedHandshakeRequest();
    expect(request.protocolVersion).toBe(base.protocolVersion);
    expect(request.supportedProtocolVersions).toEqual(base.supportedProtocolVersions);
    expect(request.clientVersion).toBe(base.clientVersion);
  });

  it("keeps every non-required known capability optional (nothing silently dropped)", () => {
    const request = createPiSubagentDesktopManagedHandshakeRequest();
    const required = new Set<string>(request.requiredCapabilities);
    const optional = new Set<string>(request.optionalCapabilities ?? []);
    for (const capability of PI_SUBAGENT_CAPABILITIES) {
      expect(required.has(capability) || optional.has(capability)).toBe(true);
    }
    for (const capability of request.optionalCapabilities ?? []) {
      expect(required.has(capability)).toBe(false);
    }
  });
});

describe("negotiatePiSubagentDesktopManagedBridge", () => {
  it("succeeds when the bridge supplies all eight required capabilities", async () => {
    const requests: PiSubagentHandshakeRequest[] = [];
    const target = bridgeWith(async (request) => {
      requests.push(request);
      return {
        ok: true,
        protocolVersion: request.protocolVersion,
        extensionVersion: "0.15.0-alfie.5",
        capabilities: [...REQUIRED_CAPABILITIES, "terminal-outbox"],
      };
    });
    const capability = await negotiatePiSubagentDesktopManagedBridge(target);
    expect(capability).toMatchObject({ status: "managed_enabled", isManaged: true });
    // The negotiation actually demanded the mandatory seven.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.requiredCapabilities).toEqual([...REQUIRED_CAPABILITIES]);
  });

  it("is fatal-shaped when a required capability is missing", async () => {
    const target = bridgeWith(async () => ({
      ok: true,
      protocolVersion: 1,
      extensionVersion: "0.10.0",
      // The legacy 3-capability surface satisfies the OLD default probe but
      // must NOT satisfy the desktop managed profile.
      capabilities: ["managed-spawn", "abort-propagation", "bounded-foreground-attachment"],
    }));
    const capability = await negotiatePiSubagentDesktopManagedBridge(target);
    expect(capability.isManaged).toBe(false);
    expect(capability.status).toBe("capability_mismatch");
    if (capability.status !== "capability_mismatch") return;
    expect(new Set(capability.missingCapabilities)).toEqual(
      new Set([
        "coalesced-progress",
        "durable-cancellation",
        "journal-terminal-lifecycle",
        "execution-identity-routing-v1",
        "child-bash-process-ownership",
      ]),
    );
  });

  it("is fatal-shaped when no bridge exists at all", async () => {
    const capability = await negotiatePiSubagentDesktopManagedBridge({
      session: { resourceLoader: { getExtensions: () => ({ extensions: [] }) } },
    });
    expect(capability).toEqual({
      status: "bridge_absent",
      diagnosticCode: "pi_subagent_bridge_absent",
      isManaged: false,
      diagnosticMessage: "Pi subagent bridge not found in the desktop managed session",
    });
  });

  it("is fatal-shaped on a malformed handshake response", async () => {
    const target = bridgeWith(async () => ({ totally: "not a handshake response" }));
    const capability = await negotiatePiSubagentDesktopManagedBridge(target);
    expect(capability).toMatchObject({
      status: "bridge_malformed_response",
      isManaged: false,
    });
  });

  it("is fatal-shaped when the bridge handshake throws", async () => {
    const target = bridgeWith(async () => {
      throw new Error("bridge exploded with secret sk-attacker-key");
    });
    const capability = await negotiatePiSubagentDesktopManagedBridge(target);
    expect(capability).toMatchObject({ status: "bridge_error", isManaged: false });
  });

  it("is fatal-shaped on an unsupported protocol version", async () => {
    const target = bridgeWith(async () => ({
      ok: true,
      protocolVersion: 99,
      extensionVersion: "0.99.0",
      capabilities: [...REQUIRED_CAPABILITIES],
    }));
    const capability = await negotiatePiSubagentDesktopManagedBridge(target);
    expect(capability).toMatchObject({ status: "unsupported_version", isManaged: false });
  });
});

describe("PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL", () => {
  it("is the exact fixed bounded desktop runtime-configuration failure detail", () => {
    // Ticket 02 WP-B (AC5 fallback): the detail PiAdapter must use — verbatim —
    // for a desktop-managed-only runtime/model configuration failure. Fixed
    // text: bounded by construction, carries no status/code interpolation,
    // and is safe to embed in any diagnostic surface.
    expect(PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL).toBe(
      "Managed Pi subagent user runtime configuration failed",
    );
    expect(PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL.length).toBeLessThanOrEqual(
      512,
    );
  });

  it("carries no secret/path/prompt/provider shape by construction", () => {
    const detail = PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL;
    // The hostile-material vocabulary from the bootstrap suite: none of these
    // shapes can appear because the constant is a fixed literal with no
    // interpolation at all.
    for (const hostile of [
      "sk-",
      "/Users/",
      "auth.json",
      "models.json",
      "prompt",
      "https://",
      "stack",
      "synara-canary",
    ]) {
      expect(detail).not.toContain(hostile);
    }
  });
});

describe("piSubagentDesktopManagedBootstrapFailureDetail", () => {
  it("is a fixed line for a managed (unexpected) input", () => {
    expect(
      piSubagentDesktopManagedBootstrapFailureDetail({
        status: "managed_enabled",
        diagnosticCode: "pi_subagent_managed_enabled",
        isManaged: true,
      }),
    ).toBe("Managed Pi subagent harness bootstrap failed");
  });

  it("carries only status + diagnosticCode for a bridge-absent denial", () => {
    expect(
      piSubagentDesktopManagedBootstrapFailureDetail({
        status: "bridge_absent",
        diagnosticCode: "pi_subagent_bridge_absent",
        isManaged: false,
        diagnosticMessage: "Pi subagent bridge not found; using legacy unmanaged behavior",
      }),
    ).toBe(
      "Managed Pi subagent harness bootstrap failed (bridge_absent:pi_subagent_bridge_absent)",
    );
  });

  it("lists missing capabilities from the closed vocabulary only", () => {
    const detail = piSubagentDesktopManagedBootstrapFailureDetail({
      status: "capability_mismatch",
      diagnosticCode: "pi_subagent_capability_mismatch",
      isManaged: false,
      missingCapabilities: ["durable-cancellation", "journal-terminal-lifecycle"],
      diagnosticMessage: "secret path /Users/victim/.pi/auth.json prompt contents",
    });
    expect(detail).toBe(
      "Managed Pi subagent harness bootstrap failed (capability_mismatch:" +
        "pi_subagent_capability_mismatch) (missing capabilities: durable-cancellation, " +
        "journal-terminal-lifecycle)",
    );
  });

  it("never surfaces hostile diagnosticMessage, versions, paths, prompts, secrets, or provider config", () => {
    const HOSTILE_MESSAGE =
      "sk-live-secret-abc123 at /Users/victim/.pi/auth.json -- prompt 'steal /etc/passwd' provider openai base-url https://evil.example/v1";
    const detail = piSubagentDesktopManagedBootstrapFailureDetail({
      status: "bridge_error",
      diagnosticCode: "pi_subagent_bridge_error",
      isManaged: false,
      diagnosticMessage: HOSTILE_MESSAGE,
      extensionVersion: "9.9.9-evil",
      offeredVersion: 1,
      supportedVersions: [1, 99],
    });
    expect(detail).not.toContain("sk-live-secret");
    expect(detail).not.toContain("/Users/victim");
    expect(detail).not.toContain("auth.json");
    expect(detail).not.toContain("prompt");
    expect(detail).not.toContain("evil.example");
    expect(detail).not.toContain("9.9.9");
    expect(detail).not.toContain("99");
    expect(detail).toBe(
      "Managed Pi subagent harness bootstrap failed (bridge_error:pi_subagent_bridge_error)",
    );
  });

  it("stays bounded at 512 chars even with a huge missing-capability list", () => {
    const detail = piSubagentDesktopManagedBootstrapFailureDetail({
      status: "capability_mismatch",
      diagnosticCode: "pi_subagent_capability_mismatch",
      isManaged: false,
      // Closed-vocabulary labels are short; force length via repetition the
      // vocabulary itself cannot produce, to prove the clamp exists anyway.
      missingCapabilities: Array.from(
        { length: 128 },
        (_, index) => `durable-cancellation-${String(index)}`,
      ),
    });
    expect(detail.length).toBeLessThanOrEqual(512);
  });

  it("omits the missing list when it is present but empty", () => {
    const detail = piSubagentDesktopManagedBootstrapFailureDetail({
      status: "capability_mismatch",
      diagnosticCode: "pi_subagent_capability_mismatch",
      isManaged: false,
      missingCapabilities: [],
    });
    expect(detail).toBe(
      "Managed Pi subagent harness bootstrap failed (capability_mismatch:" +
        "pi_subagent_capability_mismatch)",
    );
  });
});
