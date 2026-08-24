import type { ProjectId, TerminalEvent } from "@synara/contracts";

import { readNativeApi } from "~/nativeApi";
import { readProjectTerminalApi } from "~/projectWorkspaceApi";

import { projectTerminalEventToLocalEvent } from "./terminalProjectRouting";

type TerminalEventListener = (event: TerminalEvent) => void;

function terminalEventKey(threadId: string, terminalId: string): string {
  return `${threadId}::${terminalId}`;
}

// One shared Project-event subscription fans re-keyed events into the same
// listener registry as thread events, so runtimes keep a single event path. The
// mapping turns each TerminalProjectEvent into a local-scope TerminalEvent keyed
// by the runtime scope id (never by the ProjectId).
interface ProjectEventSubscription {
  unsubscribe: () => void;
  listenerCount: number;
}

class TerminalEventDispatcher {
  private listenersByKey = new Map<string, Set<TerminalEventListener>>();
  private unsubscribeSharedListener: (() => void) | null = null;
  private projectSubscriptionsByScope = new Map<string, ProjectEventSubscription>();

  subscribe(
    threadId: string,
    terminalId: string,
    listener: TerminalEventListener,
    options?: {
      /**
       * Owning Project for a Project-owned dock terminal runtime. When set, the
       * dispatcher ALSO subscribes to `terminal.project.*` events for that
       * Project and re-keys them onto `threadId` (the local runtime scope).
       */
      readonly projectId?: ProjectId | null;
    },
  ): () => void {
    const key = terminalEventKey(threadId, terminalId);
    const listeners = this.listenersByKey.get(key) ?? new Set<TerminalEventListener>();
    listeners.add(listener);
    this.listenersByKey.set(key, listeners);

    let projectSubscription: ProjectEventSubscription | null = null;
    const projectId = options?.projectId ?? null;
    if (projectId !== null) {
      projectSubscription = this.ensureProjectSubscription(projectId, threadId);
      projectSubscription.listenerCount += 1;
    } else {
      this.ensureSharedListener();
    }

    return () => {
      const nextListeners = this.listenersByKey.get(key);
      if (!nextListeners) return;
      nextListeners.delete(listener);
      if (nextListeners.size === 0) {
        this.listenersByKey.delete(key);
      }
      if (this.listenersByKey.size === 0) {
        this.unsubscribeSharedListener?.();
        this.unsubscribeSharedListener = null;
      }
      if (projectSubscription) {
        projectSubscription.listenerCount -= 1;
        if (projectSubscription.listenerCount <= 0) {
          projectSubscription.unsubscribe();
          this.projectSubscriptionsByScope.delete(threadId);
        }
      }
    };
  }

  private ensureProjectSubscription(projectId: ProjectId, scopeId: string): ProjectEventSubscription {
    const existing = this.projectSubscriptionsByScope.get(scopeId);
    if (existing) {
      return existing;
    }
    const projectApi = readProjectTerminalApi();
    const subscription: ProjectEventSubscription = {
      unsubscribe: () => undefined,
      listenerCount: 0,
    };
    if (projectApi) {
      subscription.unsubscribe = projectApi.onEvent((event) => {
        if (event.projectId !== projectId) {
          return;
        }
        const localEvent = projectTerminalEventToLocalEvent(event, scopeId);
        const listeners = this.listenersByKey.get(terminalEventKey(scopeId, event.terminalId));
        if (!listeners) return;
        for (const listener of listeners) {
          listener(localEvent);
        }
      });
    }
    this.projectSubscriptionsByScope.set(scopeId, subscription);
    return subscription;
  }

  private ensureSharedListener(): void {
    if (this.unsubscribeSharedListener) return;
    const api = readNativeApi();
    if (!api) return;

    this.unsubscribeSharedListener = api.terminal.onEvent((event) => {
      const listeners = this.listenersByKey.get(terminalEventKey(event.threadId, event.terminalId));
      if (!listeners) return;
      for (const listener of listeners) {
        listener(event);
      }
    });
  }
}

export const terminalEventDispatcher = new TerminalEventDispatcher();
