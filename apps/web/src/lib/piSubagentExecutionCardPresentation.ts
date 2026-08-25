// FILE: piSubagentExecutionCardPresentation.ts
// Purpose: Ticket 11 (T11-AC4/AC8) per-state presentation mapping and the
// Ticket 03 (T03-AC2–AC5) WHOLE-CARD presentation: one pure function over
// the complete durable `PiSubagentExecutionCard` derives label/tone/dot,
// live/spinner truth, and control affordances with the accepted precedence —
// committed terminal; orphaned; teardown uncertainty (survivors /
// owner_unproven); durable cancellation intent; detached current running;
// ordinary observed state. The card strip, ordering, initial expansion, and
// the result/transcript details dialog all consume this single derivation so
// no Ticket 03 surface derives a label from `observedState` alone.
// Layer: Web presentation logic
// Exports: PI_SUBAGENT_EXECUTION_STATE_PRESENTATIONS,
//          piSubagentExecutionStatePresentation,
//          PI_SUBAGENT_RUNNING_IN_BACKGROUND_LABEL,
//          PI_SUBAGENT_CANCELLING_LABEL,
//          PI_SUBAGENT_CANCELLATION_UNVERIFIED_LABEL,
//          PI_SUBAGENT_ORPHANED_LABEL,
//          piSubagentExecutionCardPresentation

import type { PiSubagentExecutionCard, PiSubagentLifecycleState } from "@synara/contracts";

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

/** Ticket 03 (T03-AC2) exact whole-card labels. */
export const PI_SUBAGENT_RUNNING_IN_BACKGROUND_LABEL = "Running in background";
export const PI_SUBAGENT_CANCELLING_LABEL = "Cancelling";
export const PI_SUBAGENT_CANCELLATION_UNVERIFIED_LABEL = "Cancellation unverified";
export const PI_SUBAGENT_ORPHANED_LABEL = "Outcome unknown (orphaned)";

/**
 * Ticket 03 (T03-AC3) bounded static explanation for authenticated teardown
 * uncertainty. `survivors` and `owner_unproven` are distinct durable bands
 * (77/78); the copy explains the uncertainty WITHOUT ever claiming the child
 * stopped, was cancelled, or is still running.
 */
const TEARDOWN_UNCERTAINTY_DETAIL: Record<"survivors" | "owner_unproven", string> = {
  survivors:
    "Teardown evidence reports child processes that could not be proven stopped. Synara cannot claim the execution was cancelled; inspect the workspace before acting.",
  owner_unproven:
    "The child owner could not prove teardown. Synara cannot claim the execution was cancelled; the true outcome remains unverified.",
};

/** Whole-card presentation kinds (Ticket 03 precedence bands). */
export type PiSubagentExecutionCardPresentationKind =
  | "terminal"
  | "orphaned"
  | "unverified"
  | "cancelling"
  | "running-background"
  | "observed";

export interface PiSubagentExecutionCardPresentation {
  readonly kind: PiSubagentExecutionCardPresentationKind;
  readonly label: string;
  /** True while the execution may still transition (ordering/expansion). */
  readonly live: boolean;
  /** Spinner eligibility — narrower than live: uncertain/orphaned never spin. */
  readonly spinner: boolean;
  readonly dotClassName: string;
  readonly textToneClassName: string;
  /** Cancel affordance visibility (durable truth only, never pending state). */
  readonly showCancel: boolean;
  /** Cancel stays visible-but-disabled while durable cancellation is in flight. */
  readonly cancelDisabled: boolean;
  /** Explicit resume affordance — orphaned only (no automatic resume path). */
  readonly showResume: boolean;
  /** Bounded static explanation for uncertainty/orphan presentations. */
  readonly detailMessage: string | null;
}

/**
 * Ticket 03 (T03-AC2–AC5) pure whole-card presentation. Precedence:
 * 1. committed terminal (`succeeded`/`failed`) — ignores stale
 *    attachment/teardown fields (T03-AC5);
 * 2. `orphaned` — `Outcome unknown (orphaned)`, no spinner, no Cancel,
 *    explicit Resume only (T03-AC4);
 * 3. current-generation teardown uncertainty (`survivors`/`owner_unproven`)
 *    — `Cancellation unverified`, never a stopped/cancelled claim (T03-AC3);
 * 4. durable cancellation intent (`desiredState` or `observedState`
 *    `cancelling`) — `Cancelling` overrides an observed `running` label;
 * 5. observed `running` + current-generation `detached` attachment —
 *    `Running in background` (T03-AC2);
 * 6. ordinary observed state (conservative fallback for old-null cards).
 */
export function piSubagentExecutionCardPresentation(
  card: PiSubagentExecutionCard,
): PiSubagentExecutionCardPresentation {
  const observed = card.observedState;

  // 1. Committed terminal truth ignores stale attachment/teardown fields.
  if (observed === "succeeded" || observed === "failed") {
    const terminal = piSubagentExecutionStatePresentation(observed);
    return {
      kind: "terminal",
      label: terminal.label,
      live: false,
      spinner: false,
      dotClassName: terminal.dotClassName,
      textToneClassName: terminal.textToneClassName,
      showCancel: false,
      cancelDisabled: false,
      showResume: false,
      detailMessage: null,
    };
  }

  // 2. Orphaned: outcome unknown, never live, Resume only.
  if (observed === "orphaned") {
    return {
      kind: "orphaned",
      label: PI_SUBAGENT_ORPHANED_LABEL,
      live: false,
      spinner: false,
      dotClassName: PRESENTATIONS.orphaned!.dotClassName,
      textToneClassName: PRESENTATIONS.orphaned!.textToneClassName,
      showCancel: false,
      cancelDisabled: false,
      showResume: true,
      detailMessage:
        "Owner lost after restart; partial side effects may already exist. Inspect the workspace before resuming.",
    };
  }

  // 3. Authenticated teardown uncertainty: never a stopped/cancelled claim,
  //    no spinner, no lifecycle controls. `requested` (band 75) alone does
  //    NOT relabel — only the uncertain bands (77/78) carry this truth.
  const teardown = card.currentTeardownEvidence ?? null;
  if (teardown === "survivors" || teardown === "owner_unproven") {
    const cancellingTone = PRESENTATIONS.cancelling!;
    return {
      kind: "unverified",
      label: PI_SUBAGENT_CANCELLATION_UNVERIFIED_LABEL,
      live: false,
      spinner: false,
      dotClassName: cancellingTone.dotClassName,
      textToneClassName: cancellingTone.textToneClassName,
      showCancel: false,
      cancelDisabled: false,
      showResume: false,
      detailMessage: TEARDOWN_UNCERTAINTY_DETAIL[teardown],
    };
  }

  // 4. Durable cancellation intent overrides an observed `running` label.
  const cancelling = card.desiredState === "cancelling" || observed === "cancelling";
  if (cancelling) {
    const cancellingPresentation = PRESENTATIONS.cancelling!;
    return {
      kind: "cancelling",
      label: PI_SUBAGENT_CANCELLING_LABEL,
      live: true,
      spinner: true,
      dotClassName: cancellingPresentation.dotClassName,
      textToneClassName: cancellingPresentation.textToneClassName,
      showCancel: true,
      cancelDisabled: true,
      showResume: false,
      detailMessage: null,
    };
  }

  // 5. Current detached running with verified current-generation truth —
  //    a null (old-shape) attachment NEVER upgrades to the background label.
  if (observed === "running" && (card.currentAttachment ?? null) === "detached") {
    const running = PRESENTATIONS.running!;
    return {
      kind: "running-background",
      label: PI_SUBAGENT_RUNNING_IN_BACKGROUND_LABEL,
      live: true,
      spinner: true,
      dotClassName: running.dotClassName,
      textToneClassName: running.textToneClassName,
      showCancel: true,
      cancelDisabled: false,
      showResume: false,
      detailMessage: null,
    };
  }

  // 6. Ordinary observed state (attached running, old-null replay, pending,
  //    queued, accepted, cancelled, rejected).
  const ordinary = piSubagentExecutionStatePresentation(observed);
  return {
    kind: "observed",
    label: ordinary.label,
    live: ordinary.live,
    spinner: ordinary.live,
    dotClassName: ordinary.dotClassName,
    textToneClassName: ordinary.textToneClassName,
    showCancel: ordinary.live,
    cancelDisabled: false,
    showResume: false,
    detailMessage: null,
  };
}

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
