// FILE: projectWorkspaceApi.ts
// Purpose: Web client surface for the Project-owned Right-sidebar workspace APIs
//          (Decision 0002): Project terminals, Project device state, and the
//          Project workspace capability gate.
// Layer: Web transport adapter helpers
// Depends on: WS transport (via wsNativeApi transport accessors), WP1 contracts.
//
// These surfaces talk to the WP4/WP5 server routes (`terminal.project.*`,
// `device.project.*`) and subscribe to their dedicated push channels. They carry
// the real `ProjectId` directly — never a ProjectId cast to a ThreadId, a
// pseudo-Thread, or the currently active conversation.
//
// Browser panel control (`projectBrowser`) is a desktop IPC surface (WP7); when
// the desktop bridge exposes it the web app prefers it, otherwise the browser
// pane keeps its legacy Thread-keyed desktop surface while its workspace STATE
// is already keyed by Project (browserStateStore).

import {
  DEVICE_PROJECT_WS_CHANNELS,
  DEVICE_WS_METHODS,
  PROJECT_WORKSPACE_CAPABILITY,
  WS_CHANNELS,
  WS_METHODS,
  type DeviceProjectEvent,
  type ProjectDeviceState,
  type ProjectId,
  type TerminalProjectEvent,
  type TerminalProjectSessionSnapshot,
  type WsPushChannel,
  type WsPushData,
} from "@synara/contracts";

import { readWsTransport, type WsRequestTransport } from "./wsNativeApi";

export { readWsTransport, type WsRequestTransport };

export { PROJECT_WORKSPACE_CAPABILITY };

/** Does this server (or desktop bridge) advertise the Project workspace surface? */
export function isProjectWorkspaceCapabilityPresent(): boolean {
  if (typeof window !== "undefined" && window.nativeApi?.projectBrowser) {
    return true;
  }
  return readProjectWorkspaceCapabilityFromTransport(readWsTransport());
}

function readProjectWorkspaceCapabilityFromTransport(
  transport: WsRequestTransport | null,
): boolean {
  return (
    transport?.getCompatibility()?.capabilities.includes(PROJECT_WORKSPACE_CAPABILITY) === true
  );
}

/** Project-owned terminal operations (WP4 server runtime, keyed by ProjectId). */
export interface ProjectTerminalApi {
  open: (input: {
    projectId: ProjectId;
    terminalId: string;
    cwd: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    streamOutput?: boolean;
  }) => Promise<TerminalProjectSessionSnapshot>;
  write: (input: { projectId: ProjectId; terminalId: string; data: string }) => Promise<void>;
  ackOutput: (input: { projectId: ProjectId; terminalId: string; bytes: number }) => Promise<void>;
  resize: (input: {
    projectId: ProjectId;
    terminalId: string;
    cols: number;
    rows: number;
  }) => Promise<void>;
  clear: (input: { projectId: ProjectId; terminalId: string }) => Promise<void>;
  restart: (input: {
    projectId: ProjectId;
    terminalId: string;
    cwd: string;
    cols: number;
    rows: number;
    env?: Record<string, string>;
  }) => Promise<TerminalProjectSessionSnapshot>;
  close: (input: {
    projectId: ProjectId;
    terminalId?: string;
    deleteHistory?: boolean;
  }) => Promise<void>;
  /**
   * Truthful preflight list used by the close-confirmation warning: it reports
   * the server's live per-terminal status so an idle-looking tab that still has
   * a running process still warns (and vice versa).
   */
  list: (input: { projectId: ProjectId }) => Promise<ReadonlyArray<TerminalProjectSessionSnapshot>>;
  onEvent: (listener: (event: TerminalProjectEvent) => void) => () => void;
}

/** Project-owned device operations (WP5 server state, keyed by ProjectId). */
export interface ProjectDeviceApi {
  getState: (input: { projectId: ProjectId }) => Promise<ProjectDeviceState>;
  attach: (input: { projectId: ProjectId; udid: string }) => Promise<ProjectDeviceState>;
  detach: (input: { projectId: ProjectId }) => Promise<ProjectDeviceState>;
  onEvent: (listener: (event: DeviceProjectEvent) => void) => () => void;
}

/**
 * Resolve the Project terminal API against the live WS transport. Returns null
 * when no transport is available (SSR/tests) — callers then keep the legacy
 * Thread-keyed surface rather than guessing.
 */
export function readProjectTerminalApi(): ProjectTerminalApi | null {
  const transport = readWsTransport();
  if (!transport) {
    return null;
  }
  const request = transport.request.bind(transport);
  return {
    open: (input) => request(WS_METHODS.terminalProjectOpen, input),
    write: (input) => request(WS_METHODS.terminalProjectWrite, input),
    ackOutput: (input) => request(WS_METHODS.terminalProjectAckOutput, input),
    resize: (input) => request(WS_METHODS.terminalProjectResize, input),
    clear: (input) => request(WS_METHODS.terminalProjectClear, input),
    restart: (input) => request(WS_METHODS.terminalProjectRestart, input),
    close: (input) => request(WS_METHODS.terminalProjectClose, input),
    list: (input) => request(WS_METHODS.terminalProjectList, input),
    onEvent: (listener) => subscribeTerminalProjectEvents(transport, listener),
  };
}

/** Resolve the Project device API against the live WS transport (or null). */
export function readProjectDeviceApi(): ProjectDeviceApi | null {
  const transport = readWsTransport();
  if (!transport) {
    return null;
  }
  const request = transport.request.bind(transport);
  return {
    getState: (input) => request(DEVICE_WS_METHODS.getProjectState, input),
    attach: (input) => request(DEVICE_WS_METHODS.attachProject, input),
    detach: (input) => request(DEVICE_WS_METHODS.detachProject, input),
    onEvent: (listener) => subscribeDeviceProjectEvents(transport, listener),
  };
}

// ── Push channel fan-out ─────────────────────────────────────────────
//
// One shared transport subscription per channel fans events out to a listener
// registry, mirroring the thread terminal/device dispatcher pattern: the first
// subscriber attaches the transport, the last detaches.

type Unsubscribe = () => void;

interface EventHub<TEvent> {
  subscribe: (listener: (event: TEvent) => void) => Unsubscribe;
  attachTransport: (transport: WsRequestTransport) => void;
}

function createEventHub<const Channel extends WsPushChannel>(
  channel: Channel,
): EventHub<WsPushData<Channel>> & { listenersSize: () => number } {
  const listeners = new Set<(event: WsPushData<Channel>) => void>();
  let unsubscribeTransport: Unsubscribe | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachTransport(transport) {
      if (unsubscribeTransport) {
        return;
      }
      unsubscribeTransport = transport.subscribe(channel, (message) => {
        for (const listener of listeners) {
          try {
            listener(message.data as WsPushData<Channel>);
          } catch {
            // One listener must never block delivery to the rest.
          }
        }
      });
    },
    listenersSize: () => listeners.size,
  };
}

const terminalProjectEventHub = createEventHub(WS_CHANNELS.terminalProjectEvent);
const deviceProjectEventHub = createEventHub(DEVICE_PROJECT_WS_CHANNELS.event);

function subscribeTerminalProjectEvents(
  transport: WsRequestTransport,
  listener: (event: TerminalProjectEvent) => void,
): Unsubscribe {
  const unsubscribeHub = terminalProjectEventHub.subscribe(listener);
  terminalProjectEventHub.attachTransport(transport);
  // The channel only carries data while the server-side subscription is active;
  // subscribeEvents is idempotent server-side, so a per-subscriber call keeps
  // pushes flowing without leaking when all panes go away (server GCs on socket
  // close; re-attaching after reconnect is handled by the transport replay).
  void transport.request(WS_METHODS.subscribeTerminalProjectEvents, {}).catch(() => undefined);
  return unsubscribeHub;
}

function subscribeDeviceProjectEvents(
  transport: WsRequestTransport,
  listener: (event: DeviceProjectEvent) => void,
): Unsubscribe {
  const unsubscribeHub = deviceProjectEventHub.subscribe(listener);
  deviceProjectEventHub.attachTransport(transport);
  return unsubscribeHub;
}
