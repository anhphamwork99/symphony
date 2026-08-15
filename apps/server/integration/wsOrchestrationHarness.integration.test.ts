// FILE: wsOrchestrationHarness.integration.test.ts
// WP1 bootstrap (impl-12 AC1 foundation): proves the deterministic in-process
// harness mounts the production `websocketRpcRouteLayer` over a bounded
// loopback HTTP server and drives it through the real WebSocket RPC transport.
// A project and a thread are created through the real `dispatchCommand` RPC
// and observed in the real `getSnapshot` RPC projection; `replayEvents` proves
// the journal committed both bootstrap events; the thread detail read model is
// observed through `getThreadDetailSnapshot`. No provider/model call happens:
// the adapter harness start count stays zero.
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "@synara/contracts";
import { expect, it } from "vitest";

import { makeWsOrchestrationHarness } from "./WsOrchestrationHarness.integration.ts";

it(
  "bootstraps a project and thread through real WebSocket RPC and observes them in the snapshot",
  async () => {
    const harness = await makeWsOrchestrationHarness({ provider: "codex" });
    try {
      const createdAt = new Date().toISOString();
      const projectId = "ws-project-1";
      const threadId = "ws-thread-1";

      const projectDispatch = await harness.client.dispatchCommand({
        type: "project.create",
        commandId: "cmd-ws-project-create",
        projectId,
        title: "WS Bootstrap Project",
        workspaceRoot: harness.workspaceDir,
        createdAt,
      });
      expect(projectDispatch.sequence).toBeGreaterThanOrEqual(0);

      const threadDispatch = await harness.client.dispatchCommand({
        type: "thread.create",
        commandId: "cmd-ws-thread-create",
        threadId,
        projectId,
        title: "WS Bootstrap Thread",
        modelSelection: { provider: "codex", model: DEFAULT_MODEL_BY_PROVIDER.codex },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt,
      });
      expect(threadDispatch.sequence).toBeGreaterThanOrEqual(0);

      // The projection commits asynchronously behind the orchestration
      // reactor, so observations go through the wait helpers.
      const project = await harness.waitForProject(projectId);
      expect(project.title).toBe("WS Bootstrap Project");
      expect(project.deletedAt).toBeNull();

      const thread = await harness.waitForThread(threadId);
      expect(thread.projectId).toBe(projectId);
      expect(thread.title).toBe("WS Bootstrap Thread");

      // Observe the same state through the real RPC snapshot, not a direct seam.
      const snapshot = await harness.client.getSnapshot();
      expect(snapshot.projects.some((entry) => entry.id === projectId)).toBe(true);
      expect(snapshot.threads.some((entry) => entry.id === threadId)).toBe(true);

      // The thread detail read model resolves through the real RPC.
      const detail = await harness.waitForThreadDetail(threadId);
      expect(detail.thread.id).toBe(threadId);
      expect(detail.thread.projectId).toBe(projectId);

      // The journal committed both bootstrap events.
      const events = await harness.client.replayEvents({ fromSequenceExclusive: 0 });
      expect(events.some((event) => event.type === "project.created")).toBe(true);
      expect(events.some((event) => event.type === "thread.created")).toBe(true);

      // Harness surface sanity: bounded loopback port, temp state, and zero
      // provider/model calls (no credentials were required).
      expect(harness.port).toBeGreaterThan(0);
      expect(harness.origin).toBe(`http://127.0.0.1:${harness.port}`);
      expect(harness.adapterHarness.getStartCount()).toBe(0);
    } finally {
      await harness.dispose();
      // dispose must be idempotent and clean.
      await harness.dispose();
    }
  },
  120_000,
);
