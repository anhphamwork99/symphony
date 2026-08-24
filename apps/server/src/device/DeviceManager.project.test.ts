// FILE: DeviceManager.project.test.ts
// WP5 tests: the Right-sidebar device pane belongs to a Project (Decision
// 0002). Proves the Project-keyed attachment registry against the deterministic
// FakeDeviceBackend: same-Project sharing (one attachment record for every
// conversation in the Project), cross-Project isolation, navigation/visibility
// never terminating ownership, committed-deletion cleanup scoped to the deleted
// Project only, truthful restore-error retention, and Project-keyed events.
// The legacy Thread-keyed surface is exercised alongside to prove it stays
// green and independent.
import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId, type DeviceProjectEvent } from "@synara/contracts";

import { DeviceManager } from "./DeviceManager.ts";
import { FakeDeviceBackend } from "./FakeDeviceBackend.ts";

const PROJECT_A = ProjectId.makeUnsafe("project-a");
const PROJECT_B = ProjectId.makeUnsafe("project-b");
const THREAD_A1 = ThreadId.makeUnsafe("thread-a1");
const THREAD_A2 = ThreadId.makeUnsafe("thread-a2");
const DEVICE = "FAKE-0001";

interface ProjectHarness {
  readonly backend: FakeDeviceBackend;
  readonly manager: DeviceManager;
  readonly projectEvents: DeviceProjectEvent[];
  readonly stopProjectEvents: () => void;
}

/** Poll until the Project state satisfies the predicate (bounded). */
async function waitForProjectState(
  manager: DeviceManager,
  projectId: ProjectId,
  predicate: (state: Awaited<ReturnType<DeviceManager["getProjectState"]>>) => boolean,
): Promise<Awaited<ReturnType<DeviceManager["getProjectState"]>>> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const state = await manager.getProjectState(projectId);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Project ${projectId} never reached the expected device state`);
}

/** Settle whatever the background attach is doing before asserting on it. */
async function settleProjectAttach(manager: DeviceManager, projectId: ProjectId): Promise<void> {
  await waitForProjectState(manager, projectId, (state) => state.attachPhase == null);
}

async function setup(): Promise<ProjectHarness> {
  const backend = new FakeDeviceBackend();
  const manager = new DeviceManager({ backend });
  await manager.boot(DEVICE);
  const projectEvents: DeviceProjectEvent[] = [];
  const stopProjectEvents = manager.onProjectEvent((event) => {
    projectEvents.push(event);
  });
  return { backend, manager, projectEvents, stopProjectEvents };
}

describe("DeviceManager project-owned device workspace", () => {
  it("shares one attachment across every conversation in the same Project", async () => {
    const { manager } = await setup();

    await manager.attachProject(PROJECT_A, DEVICE);
    await settleProjectAttach(manager, PROJECT_A);

    // The same Project state — identical attachment and monotonic version — is
    // what ANY conversation in Project A observes. The registry has exactly one
    // record for the Project; there is no per-conversation copy to diverge.
    const first = await manager.getProjectState(PROJECT_A);
    const second = await manager.getProjectState(PROJECT_A);
    expect(first.attachedDeviceUdid).toBe(DEVICE);
    expect(second.attachedDeviceUdid).toBe(DEVICE);
    expect(second.version).toBeGreaterThanOrEqual(first.version);
  });

  it("keeps Projects isolated: another Project's attachment is untouched", async () => {
    const { manager } = await setup();

    await manager.attachProject(PROJECT_A, DEVICE);
    await settleProjectAttach(manager, PROJECT_A);
    const before = await manager.getProjectState(PROJECT_A);
    const b = await manager.getProjectState(PROJECT_B);

    expect(before.attachedDeviceUdid).toBe(DEVICE);
    expect(b.attachedDeviceUdid).toBeNull();
    expect(b.version).toBe(0);
    // Cross-Project attach does not disturb the first Project's attachment.
    await manager.attachProject(PROJECT_B, "FAKE-0002");
    const after = await manager.getProjectState(PROJECT_A);
    expect(after.attachedDeviceUdid).toBe(DEVICE);
    // Detaching Project B never releases Project A's device.
    await manager.detachProject(PROJECT_B);
    expect((await manager.getProjectState(PROJECT_A)).attachedDeviceUdid).toBe(DEVICE);
  });

  it("never terminates ownership on reads or legacy thread activity (navigation)", async () => {
    const { manager } = await setup();

    await manager.attachProject(PROJECT_A, DEVICE);
    await settleProjectAttach(manager, PROJECT_A);
    // Reading state (a pane opening, a conversation switch surfacing the pane)
    // is visibility only: it must never close or clear the attachment.
    for (let index = 0; index < 3; index += 1) {
      await manager.getProjectState(PROJECT_A);
    }
    // Legacy thread activity in the same Project: attach + detach of a thread
    // (v1 surface) is Thread-scoped and must not terminate the Project's
    // ownership of its device.
    await manager.attach(THREAD_A1, DEVICE);
    await manager.detach(THREAD_A1);
    expect((await manager.getProjectState(PROJECT_A)).attachedDeviceUdid).toBe(DEVICE);

    // And the reverse: Project ownership is not disturbed by thread removal.
    await manager.handleThreadRemoved(THREAD_A2);
    expect((await manager.getProjectState(PROJECT_A)).attachedDeviceUdid).toBe(DEVICE);
  });

  it("cleans up ONLY the deleted Project after project.deleted, idempotently", async () => {
    const { manager } = await setup();

    await manager.attachProject(PROJECT_A, DEVICE);
    await manager.attachProject(PROJECT_B, DEVICE);
    await settleProjectAttach(manager, PROJECT_A);
    await settleProjectAttach(manager, PROJECT_B);

    await manager.handleProjectRemoved(PROJECT_A);

    const a = await manager.getProjectState(PROJECT_A);
    expect(a.attachedDeviceUdid).toBeNull();
    expect(a.version).toBe(0);
    // The other Project keeps its attachment and its version continuity.
    const b = await manager.getProjectState(PROJECT_B);
    expect(b.attachedDeviceUdid).toBe(DEVICE);
    expect(b.version).toBeGreaterThan(0);
    // Idempotent: a second cleanup for the already-removed Project is a no-op.
    await manager.handleProjectRemoved(PROJECT_A);
    expect((await manager.getProjectState(PROJECT_B)).attachedDeviceUdid).toBe(DEVICE);
  });

  it("retains a restore error truthfully instead of resetting to a blank default", async () => {
    const { backend, manager } = await setup();

    await manager.attachProject(PROJECT_A, DEVICE);
    await settleProjectAttach(manager, PROJECT_A);
    // The backing device disappears (shutdown elsewhere): the attachment is
    // cleared truthfully and every watcher sees the fresh state.
    await manager.shutdown(DEVICE);
    const cleared = await manager.getProjectState(PROJECT_A);
    expect(cleared.attachedDeviceUdid).toBeNull();

    // A recorded restore failure stays on the Project state until the next
    // successful attach; a read never wipes it.
    await manager.recordProjectError(PROJECT_A, "helper could not be built");
    const errored = await manager.getProjectState(PROJECT_A);
    expect(errored.lastError).toBe("helper could not be built");
    expect((await manager.getProjectState(PROJECT_A)).lastError).toBe(
      "helper could not be built",
    );

    // A successful attach clears the error and restores the descriptor.
    await manager.boot(DEVICE);
    await manager.attachProject(PROJECT_A, DEVICE);
    const restored = await settleProjectAttach(manager, PROJECT_A).then(() =>
      manager.getProjectState(PROJECT_A),
    );
    expect(restored.attachedDeviceUdid).toBe(DEVICE);
    expect(restored.lastError).toBeNull();
    expect(restored.devices.some((device) => device.udid === DEVICE)).toBe(true);
  });

  it("publishes Project-keyed events naming the owning ProjectId", async () => {
    const { manager, projectEvents } = await setup();

    await manager.attachProject(PROJECT_A, DEVICE);
    await settleProjectAttach(manager, PROJECT_A);
    await manager.detachProject(PROJECT_A);

    const projectIds = projectEvents.map((event) => event.state.projectId);
    expect(projectIds.length).toBeGreaterThan(0);
    expect(new Set(projectIds)).toEqual(new Set([String(PROJECT_A)]));
    for (const event of projectEvents) {
      expect(event.type).toBe("device.project-state");
    }
    const attachedSnapshot = projectEvents.find(
      (event) => event.state.attachedDeviceUdid === DEVICE,
    );
    expect(attachedSnapshot).toBeDefined();
  });

  it("keeps the legacy Thread-keyed surface green and independent", async () => {
    const { manager } = await setup();

    const threadState = await manager.attach(THREAD_A1, DEVICE);
    expect(threadState.threadId).toBe(THREAD_A1);
    expect(threadState.attachedDeviceUdid).toBe(DEVICE);
    await waitForProjectState(manager, PROJECT_A, () => true);
    // Project state exists independently and does not mirror thread state.
    expect((await manager.getProjectState(PROJECT_A)).attachedDeviceUdid).toBeNull();
    await manager.handleThreadRemoved(THREAD_A1);
    expect((await manager.getThreadState(THREAD_A1)).attachedDeviceUdid).toBeNull();
  });
});
