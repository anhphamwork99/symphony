import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** Stable refusal for an adapter call that arrives before explicit activation. */
export const PI_SYNARA_MCP_DISABLED_REFUSAL =
  "Synara MCP is disabled; ask the user to run /Enable Synara MCP";

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
 * The Pi-side Synara adapter starts with no client or registered tools. The
 * lifecycle methods are deliberately limited to the seams needed by the
 * later activation coordinator; activation itself is owned by impl-06.
 */
export interface PiSynaraMcpDormantAdapter {
  readonly state: "dormant";
  readonly invoke: (request: PiSynaraMcpRequest) => Promise<never>;
  readonly onSafeBoundary: (listener: PiSynaraMcpSafeBoundaryListener) => () => void;
  readonly notifySafeBoundary: () => Promise<void>;
}

export interface PiSynaraMcpDormantExtension {
  readonly adapter: PiSynaraMcpDormantAdapter;
  readonly extension: InlineExtension;
}

/**
 * Create a hidden inline extension that can be loaded into every Pi runtime.
 * Loading and binding only installs the safe-boundary notification handler;
 * it does not connect, discover, mint credentials, register tools, retry, or
 * schedule delayed work.
 */
export function makePiSynaraMcpDormantExtension(
  _boundaries?: PiSynaraMcpDormantBoundaries,
): PiSynaraMcpDormantExtension {
  const safeBoundaryListeners = new Set<PiSynaraMcpSafeBoundaryListener>();

  const adapter: PiSynaraMcpDormantAdapter = {
    state: "dormant",
    invoke: async (_request) => {
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
