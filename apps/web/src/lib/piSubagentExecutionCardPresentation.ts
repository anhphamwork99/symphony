// FILE: piSubagentExecutionCardPresentation.ts
// Purpose: Ticket 11 (T11-AC4/AC8) presentation mapping for the managed Pi
// subagent execution card: the eight managed lifecycle states (requested,
// queued, running, cancelling, cancelled, succeeded, failed, orphaned) plus
// the legacy unmanaged label. Pure functions only — the component layer
// consumes these so state → label/tone/dot stays single-sourced here.
// Layer: Web presentation logic
// Exports: PI_SUBAGENT_EXECUTION_STATE_PRESENTATIONS,
//          piSubagentExecutionStatePresentation,
//          PI_SUBAGENT_LEGACY_UNMANAGED_LABEL

import type { PiSubagentLifecycleState } from "@synara/contracts";

import { cn } from "~/lib/utils";

export interface PiSubagentExecutionStatePresentation {
  readonly label: string;
  /** True while the execution may still transition (spinner eligible). */
  readonly live: boolean;
  readonly dotClassName: string;
  readonly textToneClassName: string;
}

const MUTED_TEXT = "text-muted-foreground/55";

const PRESENTATIONS: Record<PiSubagentLifecycleState, PiSubagentExecutionStatePresentation> = {
  requested: {
    label: "Requested",
    live: true,
    dotClassName: "bg-violet-300/80",
    textToneClassName: MUTED_TEXT,
  },
  accepted: {
    label: "Accepted",
    live: true,
    dotClassName: "bg-violet-300/80",
    textToneClassName: MUTED_TEXT,
  },
  queued: {
    label: "Queued",
    live: true,
    dotClassName: "bg-violet-300/80",
    textToneClassName: MUTED_TEXT,
  },
  running: {
    label: "Running",
    live: true,
    dotClassName: "bg-sky-300/95",
    textToneClassName: "text-sky-300/85",
  },
  cancelling: {
    label: "Cancelling",
    live: true,
    dotClassName: "bg-amber-300/85",
    textToneClassName: "text-amber-300/85",
  },
  cancelled: {
    label: "Cancelled",
    live: false,
    dotClassName: "bg-amber-300/85",
    textToneClassName: MUTED_TEXT,
  },
  succeeded: {
    label: "Succeeded",
    live: false,
    dotClassName: "bg-emerald-300/80",
    textToneClassName: MUTED_TEXT,
  },
  failed: {
    label: "Failed",
    live: false,
    dotClassName: "bg-rose-300/90",
    textToneClassName: "text-rose-300/85",
  },
  rejected: {
    label: "Rejected",
    live: false,
    dotClassName: "bg-rose-300/90",
    textToneClassName: "text-rose-300/85",
  },
  orphaned: {
    label: "Orphaned",
    live: true,
    dotClassName: "bg-muted-foreground/45",
    textToneClassName: "text-amber-300/85",
  },
};

export const PI_SUBAGENT_EXECUTION_STATE_PRESENTATIONS = PRESENTATIONS;

export function piSubagentExecutionStatePresentation(
  state: PiSubagentLifecycleState,
): PiSubagentExecutionStatePresentation {
  return PRESENTATIONS[state] ?? PRESENTATIONS.orphaned!;
}

/** Ticket 11 (T11-AC8): the execution-card experience labels legacy agents. */
export const PI_SUBAGENT_LEGACY_UNMANAGED_LABEL = "Unmanaged (legacy)";

export function piSubagentExecutionStateTextToneClassName(state: PiSubagentLifecycleState): string {
  return piSubagentExecutionStatePresentation(state).textToneClassName;
}

export function piSubagentExecutionStatusDotClassName(state: PiSubagentLifecycleState): string {
  return piSubagentExecutionStatePresentation(state).dotClassName;
}

/** Terminal states hide the cancel affordance (nothing left to cancel). */
export function piSubagentExecutionIsTerminal(state: PiSubagentLifecycleState): boolean {
  return !piSubagentExecutionStatePresentation(state).live || state === "cancelled";
}

export function piSubagentExecutionCardRowToneClassName(state: PiSubagentLifecycleState): string {
  return cn(piSubagentExecutionStatePresentation(state).dotClassName);
}
