import type { SynaraDocumentSnapshot } from "./SynaraDocumentSnapshot";

/**
 * Public human-mutation settlement protocol (plan §5).
 *
 * Consumes only public host observations and canonical snapshots. It never
 * intercepts native behavior, never depends on control selectors, and never
 * calls preventDefault/stopPropagation/dispatches history.
 */

export type SynaraSettlementInputKind =
  | "pointer-down"
  | "pointer-up"
  | "pointer-cancel"
  | "keyboard-candidate"
  | "text-edit-active"
  | "text-edit-inactive"
  | "semantic-callback"
  | "focus";

export interface SynaraSettlementInput {
  readonly kind: SynaraSettlementInputKind;
  readonly key?: string;
  /** Canonical snapshot captured at the moment of the observation. */
  readonly snapshot: SynaraDocumentSnapshot;
}

export type SynaraSettlementOutcome = "changed" | "no-op" | "uncertain";

export interface SynaraSettlementResult {
  readonly family: string;
  readonly settled: SynaraSettlementOutcome;
  readonly startFingerprint: string;
  readonly endFingerprint: string;
  readonly reason: string;
}

export interface SynaraSettlementObserver {
  /**
   * Feed one public observation. Returns a settled result when a family
   * settles, or null while a family is still coalescing.
   */
  readonly observe: (input: SynaraSettlementInput) => SynaraSettlementResult | null;
  /** Force-settle any open family conservatively (uncertain). */
  readonly forceSettle: (reason: string) => SynaraSettlementResult | null;
  readonly hasOpenFamily: () => boolean;
}

interface OpenFamily {
  readonly family: string;
  readonly startFingerprint: string;
  readonly startSnapshot: SynaraDocumentSnapshot;
  openedAt: number;
  pointerTerminated: boolean;
  keyboardTerminated: boolean;
  textEditInactive: boolean;
}

const DISCRETE_MUTATION_KEYS = new Set(["Delete", "Backspace", "z", "Z", "y", "Y"]);

/**
 * The common drain window (plan §5.3): the current task completes, queued
 * microtasks drain, two animation frames complete, and no new adapter
 * callback appears in the second frame. Any callback restarts the two-frame
 * count, bounded by the test-configured maximum (500 ms in the Gate).
 */
export async function settlementDrainWindow(options?: {
  readonly maxWaitMs?: number;
  readonly onNewCallback?: () => boolean;
}): Promise<void> {
  const maxWaitMs = options?.maxWaitMs ?? 500;
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const secondFrameCallbackFree = await twoAnimationFrames(() =>
      options?.onNewCallback?.() ?? false,
    );
    if (secondFrameCallbackFree) return;
    if (Date.now() >= deadline) return;
  }
}

async function twoAnimationFrames(hasNewCallback: () => boolean): Promise<boolean> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return !hasNewCallback();
}

/**
 * Create a settlement observer for one canvas session. A family settles
 * exactly once; changed projection means one settled semantic human
 * mutation, equal projection means a proven no-op.
 */
export function createSettlementObserver(options?: {
  readonly maxWaitMs?: number;
}): SynaraSettlementObserver {
  const maxWaitMs = options?.maxWaitMs ?? 500;
  let open: OpenFamily | null = null;

  const openFamily = (
    family: string,
    snapshot: SynaraDocumentSnapshot,
    partial: Partial<OpenFamily> = {},
  ): void => {
    open = {
      family,
      startFingerprint: snapshot.semanticFingerprint,
      startSnapshot: snapshot,
      openedAt: Date.now(),
      pointerTerminated: false,
      keyboardTerminated: false,
      textEditInactive: false,
      ...partial,
    };
  };

  const settle = (endSnapshot: SynaraDocumentSnapshot, forced?: string): SynaraSettlementResult => {
    const family = open!;
    open = null;
    if (forced !== undefined) {
      return {
        family: family.family,
        settled: "uncertain",
        startFingerprint: family.startFingerprint,
        endFingerprint: endSnapshot.semanticFingerprint,
        reason: forced,
      };
    }
    return {
      family: family.family,
      settled:
        family.startFingerprint === endSnapshot.semanticFingerprint ? "no-op" : "changed",
      startFingerprint: family.startFingerprint,
      endFingerprint: endSnapshot.semanticFingerprint,
      reason:
        family.startFingerprint === endSnapshot.semanticFingerprint
          ? "final canonical projection equals the family start"
          : "final canonical projection differs from the family start",
    };
  };

  return {
    observe(input) {
      if (input.kind === "pointer-down") {
        if (open !== null && open.family === "pointer-gesture") return null;
        openFamily("pointer-gesture", input.snapshot);
        return null;
      }
      if (input.kind === "pointer-up" || input.kind === "pointer-cancel") {
        if (open?.family === "pointer-gesture") {
          open = { ...open, pointerTerminated: true };
        }
        return null;
      }
      if (input.kind === "keyboard-candidate") {
        const key = input.key ?? "";
        if (!DISCRETE_MUTATION_KEYS.has(key)) {
          // Non-mutation keydowns (including plain focus movement) are
          // presentation candidates; they never open a mutation family.
          return null;
        }
        if (open === null) openFamily("discrete-keyboard-mutation", input.snapshot);
        return null;
      }
      if (input.kind === "text-edit-active") {
        if (open === null) openFamily("text-edit-composition", input.snapshot);
        return null;
      }
      if (input.kind === "text-edit-inactive") {
        if (open?.family === "text-edit-composition") {
          open = { ...open, textEditInactive: true };
        }
        return null;
      }
      if (input.kind === "semantic-callback") {
        if (open === null) {
          // Runtime source cannot locate native controls: the first
          // uncorrelated semantic callback outside pointer/text/synthetic
          // scope opens a generic native-command candidate.
          openFamily("generic-native-command", input.snapshot);
          return null;
        }
        open = { ...open, openedAt: Date.now() };
        return null;
      }
      if (input.kind === "focus") {
        // Focus transitions alone are presentation-only; they never settle a
        // mutation family and never invalidate AI history by themselves.
        return null;
      }
      return null;
    },
    forceSettle(reason) {
      if (open === null) return null;
      return settle(open.startSnapshot, reason);
    },
    hasOpenFamily() {
      return open !== null;
    },
  };
}

/**
 * Decide a family after the common drain window: compares the deep canonical
 * start/end projections and settles exactly once.
 */
export function settleFamily(
  observer: SynaraSettlementObserver,
  endSnapshot: SynaraDocumentSnapshot,
): SynaraSettlementResult {
  const open = observer.hasOpenFamily();
  if (!open) {
    return {
      family: "presentation-no-op",
      settled: "no-op",
      startFingerprint: endSnapshot.semanticFingerprint,
      endFingerprint: endSnapshot.semanticFingerprint,
      reason: "no mutation family was open; presentation-only observation",
    };
  }
  // The observer owns the open family state; settle through observe of the
  // final projection via the same code path used for runtime settlement.
  const result = observer.forceSettle("settlement-window-closed");
  if (result !== null) {
    // Reclassify using the actual end projection: forceSettle conservatively
    // reports uncertain, but a complete drain with comparable projections is
    // the documented changed/no-op decision.
    const changed = result.startFingerprint !== endSnapshot.semanticFingerprint;
    return {
      ...result,
      settled: changed ? "changed" : "no-op",
      endFingerprint: endSnapshot.semanticFingerprint,
      reason: changed
        ? "final canonical projection differs from the family start"
        : "final canonical projection equals the family start",
    };
  }
  return {
    family: "presentation-no-op",
    settled: "no-op",
    startFingerprint: endSnapshot.semanticFingerprint,
    endFingerprint: endSnapshot.semanticFingerprint,
    reason: "no mutation family was open",
  };
}

/** Present the bounded drain deadline for diagnostics. */
export function settlementDeadline(startedAt: number, maxWaitMs = 500): number {
  return startedAt + maxWaitMs;
}
