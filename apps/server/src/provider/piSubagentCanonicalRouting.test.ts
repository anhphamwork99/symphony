import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { PiSubagentResultReadResult } from "@synara/contracts";

import {
  PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY,
  createPiSubagentManagedHandshakeRequest,
  wrapPiSubagentManagedTool,
} from "./piSubagentManagedRuntimeBinding.ts";

type ReadResult = PiSubagentResultReadResult;

const read = (result: ReadResult, trace: string[]) => ({
  readResult: (input: unknown) =>
    Effect.sync(() => {
      trace.push(`durable:${JSON.stringify(input)}`);
      return result;
    }),
});

const toolResult = (text: string) => ({ content: [{ type: "text", text }] });

const invoke = (tool: any, params: Record<string, unknown>) =>
  tool.execute("call-1", params, undefined, undefined, undefined);

const assertNoProviderIdentity = (value: unknown): void => {
  if (typeof value === "string") {
    expect(value).not.toMatch(/agent[_-]?id/i);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoProviderIdentity);
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    expect(key).not.toMatch(/agent[_-]?id/i);
    assertNoProviderIdentity(entry);
  });
};

describe("Pi managed canonical routing", () => {
  it("requires the exact routing capability in the managed handshake", () => {
    expect(createPiSubagentManagedHandshakeRequest().requiredCapabilities).toContain(
      PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY,
    );
  });

  it("resolves durable authorization and tuple before the provider callback", async () => {
    const trace: string[] = [];
    const tool = {
      execute: async (_id: string, params: Record<string, unknown>) => {
        trace.push(`provider:${JSON.stringify(params)}`);
        return toolResult("live progress");
      },
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: read(
        {
          executionId: "exec-1",
          attemptId: "attempt-1",
          generation: 1,
          observedState: "running",
          terminalState: null,
          summary: null,
          summaryTruncated: false,
        },
        trace,
      ),
      isCapabilityBound: () => true,
    });

    const result = await invoke(tool, { execution_id: "exec-1" });
    expect(trace[0]).toContain("durable:");
    expect(trace[1]).toContain("provider:");
    expect(result.content[0].text).toContain("exec-1");
    expect(result.content[0].text).toContain("Live supplement");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });

  it("rejects nested provider identity keys in the serialized managed response", async () => {
    const tool = {
      execute: async () => toolResult("live"),
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: {
        readResult: () =>
          Effect.succeed({
            executionId: "exec-nested",
            attemptId: "attempt-nested",
            generation: 1,
            observedState: "succeeded" as const,
            terminalState: "succeeded" as const,
            summary: "durable",
            summaryTruncated: false,
            diagnostics: [{ nested: { agentId: "alfie-private-id" } }] as any,
          }),
      },
      isCapabilityBound: () => true,
    });

    const result = await invoke(tool, { execution_id: "exec-nested" });
    expect(result.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });

  it("accepts an equal deprecated alias, rejects provider identity, and preserves tuple", async () => {
    const calls: unknown[] = [];
    const tool = {
      execute: async (_id: string, params: unknown) => {
        calls.push(params);
        return toolResult("live");
      },
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: {
        readResult: (input) =>
          Effect.succeed({
            executionId: "exec-2",
            attemptId: "attempt-2",
            generation: 2,
            observedState: "running" as const,
            terminalState: null,
            summary: null,
            summaryTruncated: false,
            diagnostics: ["pi_subagent_read_alias_deprecated"],
            input,
          }),
      },
      isCapabilityBound: () => true,
    });

    const aliasResult = await invoke(tool, { agent_id: "exec-2" });
    expect(aliasResult.content[0].text).toContain("exec-2");
    expect(calls[0]).toMatchObject({
      execution_id: "exec-2",
      attempt_id: "attempt-2",
      generation: 2,
    });

    const providerIdResult = await invoke(tool, { agentId: "alfie-private-id" });
    expect(providerIdResult.isError).toBe(true);
    expect(providerIdResult.diagnosticCode).toBe("pi_subagent_read_alias_conflict");
    expect(calls).toHaveLength(1);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(aliasResult)));
    assertNoProviderIdentity(JSON.parse(JSON.stringify(providerIdResult)));
  });

  it("rejects session-isolated execution before the provider callback", async () => {
    let providerCalls = 0;
    const tool = {
      execute: async () => {
        providerCalls += 1;
        return toolResult("must not run");
      },
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: {
        readResult: () =>
          Effect.fail({
            kind: "denied" as const,
            diagnosticCode: "pi_subagent_read_unauthorized_or_out_of_scope" as const,
          }),
      },
      isCapabilityBound: () => true,
    });

    const result = await invoke(tool, { execution_id: "execution-from-session-two" });
    expect(result.diagnosticCode).toBe("pi_subagent_read_unauthorized_or_out_of_scope");
    expect(providerCalls).toBe(0);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });

  it("rejects wrong-thread authorization before the provider callback", async () => {
    let providerCalls = 0;
    const tool = {
      execute: async () => {
        providerCalls += 1;
        return toolResult("must not run");
      },
    };
    wrapPiSubagentManagedTool(tool, "steer_subagent", {
      readService: {
        readResult: () =>
          Effect.fail({
            kind: "denied" as const,
            diagnosticCode: "pi_subagent_read_unauthorized_or_out_of_scope" as const,
          }),
      },
      isCapabilityBound: () => true,
    });

    const result = await invoke(tool, {
      execution_id: "execution-from-wrong-thread",
      task: "steer",
    });
    expect(result.diagnosticCode).toBe("pi_subagent_read_unauthorized_or_out_of_scope");
    expect(providerCalls).toBe(0);
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });

  it("returns durable terminal evidence without calling the provider", async () => {
    let providerCalls = 0;
    const tool = {
      execute: async () => {
        providerCalls += 1;
        return toolResult("must not run");
      },
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: read(
        {
          executionId: "exec-terminal",
          attemptId: "attempt-terminal",
          generation: 1,
          observedState: "succeeded",
          terminalState: "succeeded",
          summary: "durable success",
          summaryTruncated: false,
        },
        [],
      ),
      isCapabilityBound: () => true,
    });

    const result = await invoke(tool, { execution_id: "exec-terminal" });
    expect(providerCalls).toBe(0);
    expect(result.content[0].text).toContain("durable success");
    expect(result.content[0].text).not.toContain("must not run");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });

  it("fails closed when capability binding is absent and falls back after live eviction", async () => {
    let bound = false;
    let providerCalls = 0;
    const tool = {
      execute: async () => {
        providerCalls += 1;
        return {
          isError: true,
          diagnosticCode: "pi_subagent_managed_execution_unavailable_live",
          content: [{ type: "text", text: "Agent not found" }],
        };
      },
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService: read(
        {
          executionId: "exec-evicted",
          attemptId: "attempt-evicted",
          generation: 1,
          observedState: "accepted",
          terminalState: null,
          summary: null,
          summaryTruncated: false,
        },
        [],
      ),
      isCapabilityBound: () => bound,
    });

    const denied = await invoke(tool, { execution_id: "exec-evicted" });
    expect(denied.diagnosticCode).toBe("pi_subagent_read_capability_unavailable");
    bound = true;
    const evicted = await invoke(tool, { execution_id: "exec-evicted" });
    expect(providerCalls).toBe(1);
    expect(evicted.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
    expect(evicted.content[0].text).toContain("exec-evicted");
    expect(evicted.content[0].text).not.toContain("Agent not found");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(denied)));
    assertNoProviderIdentity(JSON.parse(JSON.stringify(evicted)));
  });

  it("whitelists provider diagnostic codes and suppresses arbitrary provider strings", async () => {
    let providerResult: Record<string, unknown> = {
      content: [{ type: "text", text: "live" }],
      diagnosticCode: "pi_subagent_result_truncated",
    };
    const tool = {
      execute: async () => providerResult,
    };
    const readService = {
      readResult: () =>
        Effect.succeed({
          executionId: "exec-diagnostic",
          attemptId: "attempt-diagnostic",
          generation: 1,
          observedState: "running" as const,
          terminalState: null,
          summary: null,
          summaryTruncated: false,
        }),
    };
    wrapPiSubagentManagedTool(tool, "get_subagent_result", {
      readService,
      isCapabilityBound: () => true,
    });

    const allowed = await invoke(tool, { execution_id: "exec-diagnostic" });
    expect(allowed.diagnosticCode).toBe("pi_subagent_result_truncated");
    providerResult = {
      content: [{ type: "text", text: "live" }],
      diagnosticCode: "provider-secret-diagnostic",
    };
    const suppressed = await invoke(tool, { execution_id: "exec-diagnostic" });
    expect(suppressed).not.toHaveProperty("diagnosticCode", "provider-secret-diagnostic");
    expect(suppressed.diagnosticCode).toBeUndefined();
    providerResult = {
      isError: true,
      content: [{ type: "text", text: "failed" }],
      diagnosticCode: "provider-secret-diagnostic",
    };
    const unavailable = await invoke(tool, { execution_id: "exec-diagnostic" });
    expect(unavailable.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(allowed)));
    assertNoProviderIdentity(JSON.parse(JSON.stringify(suppressed)));
    assertNoProviderIdentity(JSON.parse(JSON.stringify(unavailable)));
  });

  it("keeps steer exact-live-only and never invokes provider for stale durable tuples", async () => {
    let providerCalls = 0;
    const tool = {
      execute: async () => {
        providerCalls += 1;
        return toolResult("steered");
      },
    };
    wrapPiSubagentManagedTool(tool, "steer_subagent", {
      readService: {
        readResult: () =>
          Effect.fail({
            kind: "denied" as const,
            diagnosticCode: "pi_subagent_read_stale_attempt_or_generation" as const,
          }),
      },
      isCapabilityBound: () => true,
    });
    const result = await invoke(tool, {
      execution_id: "exec-stale",
      attempt_id: "old-attempt",
      generation: 1,
      task: "steer",
    });
    expect(providerCalls).toBe(0);
    expect(result.diagnosticCode).toBe("pi_subagent_read_stale_attempt_or_generation");
    assertNoProviderIdentity(JSON.parse(JSON.stringify(result)));
  });
});
