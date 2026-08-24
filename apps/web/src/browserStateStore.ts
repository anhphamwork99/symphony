/**
 * Lightweight browser metadata cache keyed by the owning workspace.
 *
 * The live browser surface stays in Electron; the web app only keeps enough
 * state to render tabs/toolbars and survive workspace switches predictably.
 *
 * Project ownership (Decision 0002): the Project-keyed records below are the
 * v2 Right-sidebar browser workspace — one slice per Project, shared directly
 * by every Main conversation in it. The Thread-keyed records remain the legacy
 * v1 cache for the not-yet-migrated desktop bridge surface; published Project
 * data wins and the two are never merged.
 */

import type {
  ProjectBrowserState,
  ProjectId,
  ThreadBrowserState,
  ThreadId,
} from "@synara/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isPlainObject, sanitizeStringKeyedRecord } from "./persistedRecord";

// v2 is the Project-keyed boundary; the v1 Thread-keyed blob stays on disk
// untouched as the migration input and rollback source (Decision 0002 G).
const BROWSER_STATE_STORAGE_KEY = "synara:browser-state:v2";
const BROWSER_HISTORY_LIMIT = 12;
const EMPTY_BROWSER_HISTORY: BrowserHistoryEntry[] = [];

interface StringStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  tabId: string;
}

interface BrowserStateStore {
  /** Legacy v1 Thread-keyed cache (desktop bridge surface, retained read-only). */
  threadStatesByThreadId: Record<string, ThreadBrowserState | undefined>;
  /** v2 Project-owned workspace state (published Project data wins). */
  projectStatesByProjectId: Record<string, ProjectBrowserState | undefined>;
  recentHistoryByThreadId: Record<string, BrowserHistoryEntry[] | undefined>;
  /** v2 Project-keyed recent history, shared by every Main conversation. */
  recentHistoryByProjectId: Record<string, BrowserHistoryEntry[] | undefined>;
  upsertThreadState: (state: ThreadBrowserState) => void;
  upsertProjectState: (state: ProjectBrowserState) => void;
  removeThreadState: (threadId: ThreadId) => void;
}

function normalizeHistoryUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed === "about:blank" ? "" : trimmed;
}

function upsertRecentHistoryEntry(
  entries: BrowserHistoryEntry[] | undefined,
  nextEntry: BrowserHistoryEntry,
): BrowserHistoryEntry[] {
  const normalizedUrl = normalizeHistoryUrl(nextEntry.url);
  if (normalizedUrl.length === 0) {
    return entries ?? [];
  }

  const nextEntries = (entries ?? []).filter(
    (entry) => normalizeHistoryUrl(entry.url) !== normalizedUrl,
  );
  nextEntries.unshift({
    ...nextEntry,
    url: normalizedUrl,
  });
  return nextEntries.slice(0, BROWSER_HISTORY_LIMIT);
}

function sameBrowserHistoryEntries(
  previousEntries: BrowserHistoryEntry[] | undefined,
  nextEntries: BrowserHistoryEntry[],
): boolean {
  if (previousEntries === nextEntries) {
    return true;
  }

  if (previousEntries == null || previousEntries.length !== nextEntries.length) {
    return false;
  }

  return previousEntries.every((entry, index) => {
    const nextEntry = nextEntries[index];
    if (!nextEntry) {
      return false;
    }
    return (
      entry.url === nextEntry.url &&
      entry.title === nextEntry.title &&
      entry.tabId === nextEntry.tabId
    );
  });
}

function sanitizeBrowserHistoryEntry(rawEntry: unknown): BrowserHistoryEntry | null {
  if (!isPlainObject(rawEntry)) {
    return null;
  }
  const { url, title, tabId } = rawEntry;
  if (typeof url !== "string" || typeof title !== "string" || typeof tabId !== "string") {
    return null;
  }
  return { url, title, tabId };
}

// Drops malformed persisted history so a corrupt entry can never reach the
// upsert path (which dereferences `entry.url`) or render as a broken tab.
export function sanitizeRecentHistoryByThreadId(
  value: unknown,
): Record<string, BrowserHistoryEntry[]> {
  return sanitizeStringKeyedRecord(value, (rawEntries) => {
    if (!Array.isArray(rawEntries)) {
      return null;
    }
    const entries = rawEntries
      .map(sanitizeBrowserHistoryEntry)
      .filter((entry): entry is BrowserHistoryEntry => entry !== null)
      .slice(0, BROWSER_HISTORY_LIMIT);
    // Drop threads whose history fully fails validation so we don't retain
    // empty placeholder keys in storage.
    return entries.length > 0 ? entries : null;
  });
}

export function createDedupedBrowserStateStorage(
  resolveStorage: () => StringStorage,
): StringStorage {
  const lastWrittenValueByName = new Map<string, string>();

  return {
    getItem: (name) => resolveStorage().getItem(name),
    setItem: (name, value) => {
      const previousValue = lastWrittenValueByName.get(name) ?? resolveStorage().getItem(name);
      if (previousValue === value) {
        lastWrittenValueByName.set(name, value);
        return;
      }
      lastWrittenValueByName.set(name, value);
      resolveStorage().setItem(name, value);
    },
    removeItem: (name) => {
      lastWrittenValueByName.delete(name);
      resolveStorage().removeItem(name);
    },
  };
}

const browserStateStorage = createDedupedBrowserStateStorage(() => localStorage);

export const useBrowserStateStore = create<BrowserStateStore>()(
  persist(
    (set) => ({
      threadStatesByThreadId: {},
      projectStatesByProjectId: {},
      recentHistoryByThreadId: {},
      recentHistoryByProjectId: {},
      upsertThreadState: (state) =>
        set((current) => {
          const previousState = current.threadStatesByThreadId[state.threadId];
          // Main pushes state before some invoke Promises resolve. A delayed
          // response can therefore arrive after a newer onState snapshot; it
          // must never roll browser chrome (or the renderer binding inputs)
          // back to an older tab/runtime generation.
          if (previousState && previousState.version >= state.version) {
            return current;
          }
          const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
          const orderedTabs = activeTab
            ? [activeTab, ...state.tabs.filter((tab) => tab.id !== activeTab.id)]
            : state.tabs;
          const previousHistory =
            current.recentHistoryByThreadId[state.threadId] ?? EMPTY_BROWSER_HISTORY;
          const nextHistory = orderedTabs.reduce(
            (entries, tab) =>
              upsertRecentHistoryEntry(entries, {
                url: tab.lastCommittedUrl ?? tab.url,
                title: tab.title,
                tabId: tab.id,
              }),
            previousHistory,
          );
          const historyChanged = !sameBrowserHistoryEntries(previousHistory, nextHistory);

          return {
            threadStatesByThreadId: {
              ...current.threadStatesByThreadId,
              [state.threadId]: state,
            },
            recentHistoryByThreadId: historyChanged
              ? {
                  ...current.recentHistoryByThreadId,
                  [state.threadId]: nextHistory,
                }
              : current.recentHistoryByThreadId,
          };
        }),
      upsertProjectState: (state) =>
        set((current) => {
          const previousState = current.projectStatesByProjectId[state.projectId];
          // Same monotonic-version guard as the Thread cache: a delayed
          // response must never roll Project browser chrome back.
          if (previousState && previousState.version >= state.version) {
            return current;
          }
          const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
          const orderedTabs = activeTab
            ? [activeTab, ...state.tabs.filter((tab) => tab.id !== activeTab.id)]
            : state.tabs;
          const previousHistory =
            current.recentHistoryByProjectId[state.projectId] ?? EMPTY_BROWSER_HISTORY;
          const nextHistory = orderedTabs.reduce(
            (entries, tab) =>
              upsertRecentHistoryEntry(entries, {
                url: tab.lastCommittedUrl ?? tab.url,
                title: tab.title,
                tabId: tab.id,
              }),
            previousHistory,
          );
          const historyChanged = !sameBrowserHistoryEntries(previousHistory, nextHistory);

          return {
            projectStatesByProjectId: {
              ...current.projectStatesByProjectId,
              [state.projectId]: state,
            },
            recentHistoryByProjectId: historyChanged
              ? {
                  ...current.recentHistoryByProjectId,
                  [state.projectId]: nextHistory,
                }
              : current.recentHistoryByProjectId,
          };
        }),
      removeThreadState: (threadId) =>
        set((current) => {
          if (!Object.hasOwn(current.threadStatesByThreadId, threadId)) {
            return current;
          }
          const nextThreadStatesByThreadId = {
            ...current.threadStatesByThreadId,
          };
          const nextRecentHistoryByThreadId = {
            ...current.recentHistoryByThreadId,
          };
          delete nextThreadStatesByThreadId[threadId];
          delete nextRecentHistoryByThreadId[threadId];
          return {
            threadStatesByThreadId: nextThreadStatesByThreadId,
            recentHistoryByThreadId: nextRecentHistoryByThreadId,
          };
        }),
    }),
    {
      name: BROWSER_STATE_STORAGE_KEY,
      storage: createJSONStorage(() => browserStateStorage),
      partialize: (state) => ({
        recentHistoryByThreadId: state.recentHistoryByThreadId,
        recentHistoryByProjectId: state.recentHistoryByProjectId,
      }),
      merge: (persisted, current) => ({
        ...current,
        recentHistoryByThreadId: sanitizeRecentHistoryByThreadId(
          (persisted as { recentHistoryByThreadId?: unknown } | undefined)?.recentHistoryByThreadId,
        ),
        recentHistoryByProjectId: sanitizeRecentHistoryByThreadId(
          (persisted as { recentHistoryByProjectId?: unknown } | undefined)
            ?.recentHistoryByProjectId,
        ),
      }),
    },
  ),
);

export function selectThreadBrowserState(
  threadId: ThreadId,
): (store: BrowserStateStore) => ThreadBrowserState | undefined {
  return (store) => store.threadStatesByThreadId[threadId];
}

export function selectThreadBrowserHistory(
  threadId: ThreadId,
): (store: BrowserStateStore) => BrowserHistoryEntry[] {
  return (store) => store.recentHistoryByThreadId[threadId] ?? EMPTY_BROWSER_HISTORY;
}

/** v2 Project-owned browser workspace state (undefined until published/pushed). */
export function selectProjectBrowserState(
  projectId: ProjectId | null,
): (store: BrowserStateStore) => ProjectBrowserState | undefined {
  return (store) => (projectId ? store.projectStatesByProjectId[projectId] : undefined);
}

/** v2 Project-owned recent history, shared by every Main conversation. */
export function selectProjectBrowserHistory(
  projectId: ProjectId | null,
): (store: BrowserStateStore) => BrowserHistoryEntry[] {
  return (store) =>
    (projectId ? store.recentHistoryByProjectId[projectId] : undefined) ?? EMPTY_BROWSER_HISTORY;
}
