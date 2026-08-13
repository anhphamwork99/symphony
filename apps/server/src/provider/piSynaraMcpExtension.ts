import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** Stable refusal for an adapter call that arrives before explicit activation. */
export const PI_SYNARA_MCP_DISABLED_REFUSAL =
  "Synara MCP is disabled; ask the user to run /Enable Synara MCP";

/**
 * Stable fail-closed refusal for an adapter call that arrives while the
 * lifecycle state is active but no invocation routing is installed yet. WP1
 * only manages the lifecycle boundary; routing is installed by a later phase.
 */
export const PI_SYNARA_MCP_INVOKE_UNROUTED_REFUSAL =
  "Synara MCP is active but invocation routing is not installed";

/**
 * Runtime lifecycle states owned by the per-session lifecycle coordinator.
 * The extension starts dormant; only the coordinator transitions it.
 */
export type PiSynaraMcpLifecycleState =
  | "dormant"
  | "activating"
  | "active"
  | "deactivating"
  | "unavailable";

/** Legal lifecycle transitions enforced by the adapter state boundary. */
const PI_SYNARA_MCP_LEGAL_TRANSITIONS = new Map<
  PiSynaraMcpLifecycleState,
  readonly PiSynaraMcpLifecycleState[]
>([
  ["dormant", ["activating", "unavailable"]],
  ["activating", ["active", "dormant", "unavailable"]],
  ["active", ["deactivating"]],
  ["deactivating", ["dormant", "unavailable"]],
  ["unavailable", ["activating"]],
]);

export interface PiSynaraMcpRequest {
  readonly method: string;
  readonly params?: unknown;
}

export type PiSynaraMcpSafeBoundaryListener = () => void | Promise<void>;

/** Public side-effect boundaries reserved for the later activation lifecycle. */
export interface PiSynaraMcpDormantBoundaries {
  readonly connect?: () => unknown;
  readonly discover?: () => unknown;
  readonly issueCredential?: () => unknown;
  readonly register?: () => unknown;
  readonly scheduleRetry?: () => unknown;
  readonly scheduleDelayedStart?: () => unknown;
}

/**
 * The Pi-side Synara adapter state boundary. It starts dormant with no client
 * or registered tools; the per-session lifecycle coordinator (impl-06) drives
 * {@link PiSynaraMcpLifecycleAdapter.transition} while the adapter keeps the
 * stable refusal for calls that arrive before activation.
 */
export interface PiSynaraMcpLifecycleAdapter {
  readonly state: PiSynaraMcpLifecycleState;
  readonly invoke: (request: PiSynaraMcpRequest) => Promise<never>;
  readonly onSafeBoundary: (listener: PiSynaraMcpSafeBoundaryListener) => () => void;
  readonly notifySafeBoundary: () => Promise<void>;
  /**
   * Coordinator-owned state transition. Same-state transitions are no-ops;
   * transitions outside the lifecycle graph throw.
   */
  readonly transition: (next: PiSynaraMcpLifecycleState) => void;
}

/**
 * Back-compatible alias for the adapter type. PiAdapter.ts still references
 * `PiSynaraMcpDormantAdapter`; WP1 leaves PiAdapter untouched.
 */
export type PiSynaraMcpDormantAdapter = PiSynaraMcpLifecycleAdapter;

export interface PiSynaraMcpDormantExtension {
  readonly adapter: PiSynaraMcpDormantAdapter;
  readonly extension: InlineExtension;
}

/**
 * Create a hidden inline extension that can be loaded into every Pi runtime.
 * Loading and binding only installs the safe-boundary notification handler;
 * it does not connect, discover, mint credentials, register tools, retry, or
 * schedule delayed work. The adapter starts dormant and exposes the
 * coordinator-owned lifecycle state boundary.
 */
export function makePiSynaraMcpDormantExtension(
  _boundaries?: PiSynaraMcpDormantBoundaries,
): PiSynaraMcpDormantExtension {
  let state: PiSynaraMcpLifecycleState = "dormant";
  const safeBoundaryListeners = new Set<PiSynaraMcpSafeBoundaryListener>();

  const adapter: PiSynaraMcpDormantAdapter = {
    get state() {
      return state;
    },
    invoke: async (_request) => {
      if (state === "active") {
        throw new Error(PI_SYNARA_MCP_INVOKE_UNROUTED_REFUSAL);
      }
      throw new Error(PI_SYNARA_MCP_DISABLED_REFUSAL);
    },
    onSafeBoundary: (listener) => {
      safeBoundaryListeners.add(listener);
      return () => {
        safeBoundaryListeners.delete(listener);
      };
    },
    notifySafeBoundary: async () => {
      for (const listener of Array.from(safeBoundaryListeners)) {
        await listener();
      }
    },
    transition: (next) => {
      if (next === state) {
        return;
      }
      const legal = PI_SYNARA_MCP_LEGAL_TRANSITIONS.get(state);
      if (legal === undefined || !legal.includes(next)) {
        throw new Error(`Illegal Pi Synara MCP lifecycle transition: ${state} -> ${next}`);
      }
      state = next;
    },
  };

  return {
    adapter,
    extension: {
      name: "synara-mcp-dormant",
      hidden: true,
      factory: (pi) => {
        pi.on("agent_end", async () => adapter.notifySafeBoundary());
      },
    },
  };
}
