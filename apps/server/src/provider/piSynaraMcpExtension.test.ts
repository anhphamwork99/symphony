import {
  ModelRuntime,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import {
  makePiSynaraMcpDormantExtension,
  PI_SYNARA_MCP_DISABLED_REFUSAL,
  PI_SYNARA_MCP_INVOKE_UNROUTED_REFUSAL,
} from "./piSynaraMcpExtension.ts";

describe("Pi Synara MCP dormant extension", () => {
  it("loads and binds with zero MCP activity or catalog registration", async () => {
    const sideEffects = {
      connections: vi.fn(),
      discoveries: vi.fn(),
      credentials: vi.fn(),
      registrations: vi.fn(),
      retries: vi.fn(),
      delayedStarts: vi.fn(),
    };
    const { adapter, extension } = makePiSynaraMcpDormantExtension({
      connect: sideEffects.connections,
      discover: sideEffects.discoveries,
      issueCredential: sideEffects.credentials,
      register: sideEffects.registrations,
      scheduleRetry: sideEffects.retries,
      scheduleDelayedStart: sideEffects.delayedStarts,
    });

    const cwd = "/tmp";
    const agentDir = "/tmp/synara-pi-dormant-extension-test";
    const modelRuntime = await ModelRuntime.create({
      authPath: `${agentDir}/auth.json`,
      modelsPath: null,
    });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      resourceLoaderOptions: { extensionFactories: [extension] },
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd),
    });

    await session.bindExtensions({});

    expect(adapter.state).toBe("dormant");
    expect(services.resourceLoader.getExtensions().extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "<inline:synara-mcp-dormant>", hidden: true }),
      ]),
    );
    expect(session.getAllTools().some((tool) => tool.name.startsWith("synara_"))).toBe(false);
    for (const boundary of Object.values(sideEffects)) {
      expect(boundary).not.toHaveBeenCalled();
    }

    session.dispose();
  });

  it("preserves native and configured non-Synara tools while keeping Synara absent", async () => {
    const { extension } = makePiSynaraMcpDormantExtension();
    const configuredExtension = {
      name: "configured-coding-agent-tool",
      factory: (pi: any) => {
        pi.registerTool({
          name: "configured_non_synara_tool",
          label: "Configured non-Synara tool",
          description: "A tool configured by the coding agent.",
          parameters: {} as any,
          execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
        });
      },
    };
    const cwd = "/tmp";
    const agentDir = "/tmp/synara-pi-tool-surface-test";
    const modelRuntime = await ModelRuntime.create({
      authPath: `${agentDir}/auth.json`,
      modelsPath: null,
    });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      resourceLoaderOptions: {
        extensionFactories: [configuredExtension, extension],
      },
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd),
    });

    const toolNames = session.getAllTools().map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining(["read", "bash", "edit", "write", "configured_non_synara_tool"]),
    );
    expect(toolNames.some((toolName) => toolName.startsWith("synara_"))).toBe(false);

    session.dispose();
  });

  it("refuses an unexpected pre-activation invocation without performing an operation", async () => {
    const { adapter } = makePiSynaraMcpDormantExtension();

    await expect(adapter.invoke({ method: "tools/list" })).rejects.toThrow(
      PI_SYNARA_MCP_DISABLED_REFUSAL,
    );
    expect(adapter.state).toBe("dormant");
  });

  it("exposes a safe-boundary hook without activating the adapter", async () => {
    const { adapter } = makePiSynaraMcpDormantExtension();
    let notifications = 0;
    const removeListener = adapter.onSafeBoundary(async () => {
      notifications += 1;
    });

    await adapter.notifySafeBoundary();

    expect(notifications).toBe(1);
    expect(adapter.state).toBe("dormant");
    removeListener();
  });
});

describe("Pi Synara MCP staged-tool reload seam", () => {
  const makeSynaraTool = (name: string): ToolDefinition => ({
    name,
    label: name,
    description: `Synara tool ${name}.`,
    parameters: { type: "object", properties: {} } as ToolDefinition["parameters"],
    execute: async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }),
  });

  async function makeSessionWithSynaraExtension(stagedTools: ToolDefinition[]) {
    const { adapter, extension, stagedTools: registry } = makePiSynaraMcpDormantExtension(
      undefined,
      { stagedTools },
    );
    const cwd = "/tmp";
    const agentDir = "/tmp/synara-pi-staged-tools-test";
    const modelRuntime = await ModelRuntime.create({
      authPath: `${agentDir}/auth.json`,
      modelsPath: null,
    });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      resourceLoaderOptions: { extensionFactories: [extension] },
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd),
    });
    await session.bindExtensions({});
    return { adapter, session, registry };
  }

  it("registers the complete staged catalog only after a reload", async () => {
    const stagedTools: ToolDefinition[] = [];
    const { session, registry } = await makeSessionWithSynaraExtension(stagedTools);

    const before = session.getAllTools().map((tool) => tool.name);
    expect(before.some((name) => name.startsWith("synara_"))).toBe(false);
    expect(before).toEqual(
      expect.arrayContaining(["read", "bash", "edit", "write"]),
    );

    // Stage the complete catalog and reload: the factory re-runs and
    // registers exactly the staged set atomically.
    stagedTools.push(makeSynaraTool("synara_list_threads"), makeSynaraTool("synara_invoke"));
    await session.reload();

    const after = session.getAllTools().map((tool) => tool.name);
    expect(after).toEqual(
      expect.arrayContaining([
        "read",
        "bash",
        "edit",
        "write",
        "synara_list_threads",
        "synara_invoke",
      ]),
    );
    // No partial or duplicate registration from the reload.
    expect(after.filter((name) => name === "synara_list_threads")).toHaveLength(1);
    expect(after.filter((name) => name === "synara_invoke")).toHaveLength(1);

    // Clearing the staged registry and reloading removes the catalog and
    // leaves the normal coding-agent tools intact.
    registry.length = 0;
    await session.reload();
    const cleared = session.getAllTools().map((tool) => tool.name);
    expect(cleared.some((name) => name.startsWith("synara_"))).toBe(false);
    expect(cleared).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));

    session.dispose();
  });

  it("keeps the dormant default when the registry is empty across reloads", async () => {
    const { session } = await makeSessionWithSynaraExtension([]);

    await session.reload();
    await session.reload();

    const names = session.getAllTools().map((tool) => tool.name);
    expect(names.some((name) => name.startsWith("synara_"))).toBe(false);
    expect(names).toEqual(expect.arrayContaining(["read", "bash", "edit", "write"]));

    session.dispose();
  });
});

describe("Pi Synara MCP lifecycle state boundary", () => {
  it("starts dormant and enforces the coordinator-owned transition graph", () => {
    const { adapter } = makePiSynaraMcpDormantExtension();
    expect(adapter.state).toBe("dormant");
    expect(() => adapter.transition("active")).toThrow(
      /Illegal Pi Synara MCP lifecycle transition: dormant -> active/,
    );
    expect(() => adapter.transition("deactivating")).toThrow(
      /Illegal Pi Synara MCP lifecycle transition: dormant -> deactivating/,
    );

    adapter.transition("activating");
    expect(adapter.state).toBe("activating");
    adapter.transition("active");
    expect(adapter.state).toBe("active");
    expect(() => adapter.transition("dormant")).toThrow(
      /Illegal Pi Synara MCP lifecycle transition: active -> dormant/,
    );
    expect(() => adapter.transition("activating")).toThrow(
      /Illegal Pi Synara MCP lifecycle transition: active -> activating/,
    );

    adapter.transition("deactivating");
    expect(adapter.state).toBe("deactivating");
    adapter.transition("dormant");
    expect(adapter.state).toBe("dormant");
    adapter.transition("unavailable");
    expect(adapter.state).toBe("unavailable");
    adapter.transition("activating");
    expect(adapter.state).toBe("activating");
  });

  it("treats a same-state transition as a no-op", () => {
    const { adapter } = makePiSynaraMcpDormantExtension();
    adapter.transition("dormant");
    expect(adapter.state).toBe("dormant");
    adapter.transition("activating");
    adapter.transition("activating");
    expect(adapter.state).toBe("activating");
  });

  it("keeps the stable disabled refusal across non-active states and fails closed while active", async () => {
    const { adapter } = makePiSynaraMcpDormantExtension();
    const request = { method: "tools/list" };

    for (const next of ["activating", "unavailable"] as const) {
      adapter.transition(next);
      await expect(adapter.invoke(request)).rejects.toThrow(PI_SYNARA_MCP_DISABLED_REFUSAL);
    }

    adapter.transition("activating");
    adapter.transition("active");
    // WP1 installs no invocation routing; an active adapter fails closed.
    await expect(adapter.invoke(request)).rejects.toThrow(PI_SYNARA_MCP_INVOKE_UNROUTED_REFUSAL);

    adapter.transition("deactivating");
    await expect(adapter.invoke(request)).rejects.toThrow(PI_SYNARA_MCP_DISABLED_REFUSAL);
  });
});
