/**
 * Device metadata cache keyed by the owning workspace.
 *
 * The live simulator surface is a canvas fed by binary frames; this store keeps
 * only the metadata the pane chrome needs (device list, attachment, agent
 * activity, availability) so a workspace switch renders instantly and a late
 * push can never roll the pane back to an older generation.
 *
 * Project ownership (Decision 0002): the Project-keyed records are the v2
 * Right-sidebar device workspace — one slice per Project, shared directly by
 * every Main conversation in it and surviving conversation/Project navigation.
 * The Thread-keyed records remain the legacy v1 cache.
 *
 * Deliberately not persisted: device boot state is only meaningful while the
 * server that reported it is alive, and a stale "Booted" from last week's
 * session would render a picker that lies.
 */

import type { ProjectDeviceState, ProjectId, ThreadDeviceState, ThreadId } from "@synara/contracts";
import { create } from "zustand";

interface DeviceStateStore {
  /** Legacy v1 Thread-keyed cache (retained; legacy server surface). */
  threadStatesByThreadId: Record<string, ThreadDeviceState | undefined>;
  /** v2 Project-owned device workspace state (published Project data wins). */
  projectStatesByProjectId: Record<string, ProjectDeviceState | undefined>;
  upsertThreadState: (state: ThreadDeviceState) => void;
  upsertProjectState: (state: ProjectDeviceState) => void;
  removeThreadState: (threadId: ThreadId) => void;
  clear: () => void;
}

export const useDeviceStateStore = create<DeviceStateStore>()((set) => ({
  threadStatesByThreadId: {},
  projectStatesByProjectId: {},
  upsertThreadState: (state) =>
    set((current) => {
      const previousState = current.threadStatesByThreadId[state.threadId];
      // The server pushes state independently of the RPCs the pane issues, so a
      // slow `device.getThreadState` response can land after a newer push. The
      // version is monotonic per thread; anything at or behind the current one
      // is a straggler and must not overwrite live attachment or device lists.
      if (previousState && previousState.version >= state.version) {
        return current;
      }
      return {
        threadStatesByThreadId: {
          ...current.threadStatesByThreadId,
          [state.threadId]: state,
        },
      };
    }),
  upsertProjectState: (state) =>
    set((current) => {
      const previousState = current.projectStatesByProjectId[state.projectId];
      // Same monotonic-version guard as the Thread cache.
      if (previousState && previousState.version >= state.version) {
        return current;
      }
      return {
        projectStatesByProjectId: {
          ...current.projectStatesByProjectId,
          [state.projectId]: state,
        },
      };
    }),
  removeThreadState: (threadId) =>
    set((current) => {
      if (!Object.hasOwn(current.threadStatesByThreadId, threadId)) {
        return current;
      }
      const nextThreadStatesByThreadId = { ...current.threadStatesByThreadId };
      delete nextThreadStatesByThreadId[threadId];
      return { threadStatesByThreadId: nextThreadStatesByThreadId };
    }),
  clear: () => set({ threadStatesByThreadId: {}, projectStatesByProjectId: {} }),
}));

// Dev-only handle so the pane's availability and setup states — which otherwise
// require a Mac without Xcode, or a broken helper — can be driven directly when
// verifying the UI. Stripped from production builds by the import.meta.env guard.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__deviceStateStoreForTests = useDeviceStateStore;
}

export function selectThreadDeviceState(
  threadId: ThreadId,
): (store: DeviceStateStore) => ThreadDeviceState | undefined {
  return (store) => store.threadStatesByThreadId[threadId];
}

export function selectProjectDeviceState(
  projectId: ProjectId | null,
): (store: DeviceStateStore) => ProjectDeviceState | undefined {
  return (store) => (projectId ? store.projectStatesByProjectId[projectId] : undefined);
}
