import type { PiSubagentLifecycleState } from "@synara/contracts";

/**
 * Shared terminal-state predicate for the Pi subagent lifecycle (spec
 * Implementation Decision 8): `rejected`, `succeeded`, `failed`, and
 * `cancelled` are terminal; every other observed state (`requested`,
 * `accepted`, `queued`, `running`, `cancelling`, `orphaned`) is non-terminal.
 *
 * Extracted from the previously duplicated per-module `Set` literals so the
 * terminal vocabulary has exactly one definition.
 */
const TERMINAL_PI_SUBAGENT_STATES: ReadonlySet<string> = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "rejected",
]);

export const isTerminalPiSubagentState = (state: PiSubagentLifecycleState | string): boolean =>
  TERMINAL_PI_SUBAGENT_STATES.has(state);
