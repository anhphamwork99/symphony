import {
  PROJECT_WORKSPACE_CAPABILITY,
  WS_CLIENT_REQUIRED_CAPABILITIES,
  WS_PROTOCOL_EPOCH,
  WS_PROTOCOL_MAX_REVISION,
  WS_PROTOCOL_MIN_REVISION,
  WS_SERVER_CAPABILITIES,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeCurrentWsFeatureCompatibilitySearchParams,
  negotiateWsCompatibility,
  validateWsFeatureCompatibility,
} from "./wsCompatibility";

describe("WebSocket compatibility bootstrap", () => {
  it("negotiates the stable epoch/range and returns process/build capabilities", async () => {
    const result = await Effect.runPromise(
      negotiateWsCompatibility({
        protocolEpoch: WS_PROTOCOL_EPOCH,
        minRevision: WS_PROTOCOL_MIN_REVISION,
        maxRevision: WS_PROTOCOL_MAX_REVISION,
        clientBuild: "test-client",
        requiredCapabilities: [...WS_SERVER_CAPABILITIES],
      }),
    );

    expect(result).toMatchObject({
      protocolEpoch: WS_PROTOCOL_EPOCH,
      negotiatedRevision: WS_PROTOCOL_MAX_REVISION,
    });
    expect(result.serverBuild.length).toBeGreaterThan(0);
    expect(result.serverInstanceId.length).toBeGreaterThan(0);
    expect(result.capabilities).toContain("orchestration.cursor-safe-streams");
    expect(result.capabilities).toContain("orchestration.thread-detail-snapshot");
    expect(result.capabilities).toContain("projects.github-provisioning");
    expect(WS_CLIENT_REQUIRED_CAPABILITIES).not.toContain("projects.github-provisioning");
  });

  it("advertises the optional Project workspace capability without requiring it of clients", async () => {
    const result = await Effect.runPromise(
      negotiateWsCompatibility({
        protocolEpoch: WS_PROTOCOL_EPOCH,
        minRevision: WS_PROTOCOL_MIN_REVISION,
        maxRevision: WS_PROTOCOL_MAX_REVISION,
        clientBuild: "test-client",
        requiredCapabilities: [...WS_SERVER_CAPABILITIES],
      }),
    );

    // The capability the web activation gate keys on is advertised to every
    // negotiating client…
    expect(WS_SERVER_CAPABILITIES).toContain(PROJECT_WORKSPACE_CAPABILITY);
    expect(result.capabilities).toContain(PROJECT_WORKSPACE_CAPABILITY);
    // …but stays optional, exactly like `projects.github-provisioning`, so an
    // older client (or a newer client talking to an older server) never fails
    // core negotiation over the Right-sidebar workspace surface.
    expect(WS_CLIENT_REQUIRED_CAPABILITIES).not.toContain(PROJECT_WORKSPACE_CAPABILITY);
  });

  it("returns terminal update guidance and rejects feature calls without negotiated query data", async () => {
    const error = await Effect.runPromise(
      negotiateWsCompatibility({
        protocolEpoch: WS_PROTOCOL_EPOCH - 1,
        minRevision: 0,
        maxRevision: 0,
        clientBuild: "stale-client",
        requiredCapabilities: [],
      }).pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      code: "WS_PROTOCOL_INCOMPATIBLE",
      retryable: false,
      action: "update-client",
    });
    expect(validateWsFeatureCompatibility(new URLSearchParams())).toMatchObject({
      code: "WS_NEGOTIATION_REQUIRED",
      retryable: false,
    });
    expect(
      validateWsFeatureCompatibility(makeCurrentWsFeatureCompatibilitySearchParams("test-client")),
    ).toBeNull();
  });

  it("rejects a missing required capability with terminal server-update guidance", async () => {
    const error = await Effect.runPromise(
      negotiateWsCompatibility({
        protocolEpoch: WS_PROTOCOL_EPOCH,
        minRevision: WS_PROTOCOL_MIN_REVISION,
        maxRevision: WS_PROTOCOL_MAX_REVISION,
        clientBuild: "future-client",
        requiredCapabilities: ["rpc.future-capability"],
      }).pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      code: "WS_CAPABILITIES_INCOMPATIBLE",
      retryable: false,
      action: "update-server",
    });
  });
});
