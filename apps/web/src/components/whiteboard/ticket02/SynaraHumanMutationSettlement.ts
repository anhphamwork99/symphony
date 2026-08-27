import type { SynaraDocumentSnapshot } from "./SynaraDocumentSnapshot";

/** Public, non-cancelling observations used to settle human edits. */
export type SynaraSettlementInputKind =
  | "pointer-down"
  | "pointer-up"
  | "pointer-cancel"
  | "pointer-lost-capture"
  | "keyboard-candidate"
  | "keyboard-keyup"
  | "text-edit-active"
  | "text-edit-inactive"
  | "composition-start"
  | "composition-update"
  | "composition-end"
  | "semantic-callback"
  | "presentation"
  | "focus";

export type SynaraSettlementFamily =
  | "pointer-gesture"
  | "discrete-keyboard-mutation"
  | "text-edit-composition"
  | "generic-native-command"
  | "presentation-no-op";

export interface SynaraSettlementInput {
  readonly kind: SynaraSettlementInputKind;
  readonly key?: string;
  /** Current canonical projection at this public observation. */
  readonly snapshot: SynaraDocumentSnapshot;
  /** Required for the first generic semantic callback (callback is post-write). */
  readonly beforeSnapshot?: SynaraDocumentSnapshot;
  /** Adapter boundary facts; these are never used as forgeable provenance. */
  readonly adapterCallbackSequence?: number;
  readonly scopeActive?: boolean;
  readonly callbackProvenance?: "human" | "synthetic" | "unknown";
  readonly lateCallback?: boolean;
}

export type SynaraSettlementOutcome = "changed" | "no-op" | "uncertain";

export interface SynaraSettlementResult {
  readonly family: SynaraSettlementFamily;
  readonly settled: SynaraSettlementOutcome;
  readonly startFingerprint: string;
  readonly endFingerprint: string;
  readonly reason: string;
  readonly uncertaintyCode?: "human-settlement-uncertain";
  readonly trace?: readonly string[];
}

export interface SynaraSettlementObserver {
  readonly observe: (input: SynaraSettlementInput) => SynaraSettlementResult | null;
  readonly forceSettle: (reason: string) => SynaraSettlementResult | null;
  /** Normal closure; unlike forceSettle this compares the actual post-drain snapshot. */
  readonly settle: (endSnapshot: SynaraDocumentSnapshot) => SynaraSettlementResult | null;
  readonly hasOpenFamily: () => boolean;
  readonly isTerminated: () => boolean;
  readonly openedAt: () => number | null;
}

interface OpenFamily {
  readonly family: SynaraSettlementFamily;
  readonly startSnapshot: SynaraDocumentSnapshot;
  readonly startFingerprint: string;
  readonly openedAt: number;
  readonly callbackCount: number;
  readonly lastCallbackSequence: number | null;
  readonly trace: readonly string[];
  readonly pointerTerminated: boolean;
  readonly keyboardTerminated: boolean;
  readonly textInactive: boolean;
  readonly compositionStarted: boolean;
  readonly compositionEnded: boolean;
  readonly uncertainReason: string | null;
  readonly latestSnapshot: SynaraDocumentSnapshot;
}

const DISCRETE_MUTATION_KEYS = new Set(["Delete", "Backspace", "z", "Z", "y", "Y"]);

function frame(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resolve false when an asynchronous frame outlives the bounded window. */
async function waitWithinDeadline(wait: Promise<void>, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return false;
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(false);
    }, remaining);
    void wait.then(() => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(Date.now() <= deadline);
    });
  });
}

/** Current task, microtasks, two RAF turns, and a callback-free second frame. */
export async function settlementDrainWindow(options?: {
  readonly maxWaitMs?: number;
  /** Return true when a callback appeared since the previous sample. */
  readonly onNewCallback?: () => boolean;
}): Promise<void> {
  const configured = options?.maxWaitMs ?? 500;
  const maxWaitMs = Number.isFinite(configured) && configured >= 0 ? configured : 500;
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (Date.now() >= deadline) return;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    if (Date.now() >= deadline) return;
    if (!(await waitWithinDeadline(frame(), deadline))) return;
    if (!(await waitWithinDeadline(frame(), deadline))) return;
    if (!(options?.onNewCallback?.() ?? false)) return;
    if (Date.now() >= deadline) return;
  }
}

function result(
  family: SynaraSettlementFamily,
  startFingerprint: string,
  endSnapshot: SynaraDocumentSnapshot,
  settled: SynaraSettlementOutcome,
  reason: string,
): SynaraSettlementResult {
  return {
    family,
    settled,
    startFingerprint,
    endFingerprint: endSnapshot.semanticFingerprint,
    reason,
    ...(settled === "uncertain" ? { uncertaintyCode: "human-settlement-uncertain" as const } : {}),
    trace: Object.freeze([]),
  };
}

/** Build one bounded state machine for one canvas/session. */
export function createSettlementObserver(options?: {
  readonly maxWaitMs?: number;
}): SynaraSettlementObserver {
  const configured = options?.maxWaitMs ?? 500;
  const maxWaitMs = Number.isFinite(configured) && configured >= 0 ? configured : 500;
  let open: OpenFamily | null = null;
  let lastSettledCallbackSequence: number | null = null;

  const close = (
    endSnapshot: SynaraDocumentSnapshot,
    forcedReason?: string,
  ): SynaraSettlementResult | null => {
    const family = open;
    if (family === null) return null;
    open = null;
    if (family.lastCallbackSequence !== null) lastSettledCallbackSequence = family.lastCallbackSequence;
    if (forcedReason !== undefined || family.uncertainReason !== null) {
      return {
        ...result(
        family.family,
        family.startFingerprint,
        endSnapshot,
        "uncertain",
        forcedReason ?? family.uncertainReason!,
        ),
        trace: Object.freeze([...family.trace]),
      };
    }
    const changed = family.startFingerprint !== endSnapshot.semanticFingerprint;
    return {
      ...result(
      family.family,
      family.startFingerprint,
      endSnapshot,
      changed ? "changed" : "no-op",
      changed
        ? "final canonical projection differs from the pre-mutation start"
        : "final canonical projection equals the pre-mutation start",
      ),
      trace: Object.freeze([...family.trace]),
    };
  };

  const openFamily = (family: SynaraSettlementFamily, snapshot: SynaraDocumentSnapshot): void => {
    open = {
      family,
      startSnapshot: snapshot,
      startFingerprint: snapshot.semanticFingerprint,
      openedAt: Date.now(),
      callbackCount: 0,
      lastCallbackSequence: null,
      trace: Object.freeze([]),
      pointerTerminated: false,
      keyboardTerminated: false,
      textInactive: false,
      compositionStarted: false,
      compositionEnded: false,
      uncertainReason: null,
      latestSnapshot: snapshot,
    };
  };

  const markUncertain = (reason: string, snapshot: SynaraDocumentSnapshot): SynaraSettlementResult | null => {
    if (open === null) return result("generic-native-command", snapshot.semanticFingerprint, snapshot, "uncertain", reason);
    open = {
      ...open,
      uncertainReason: open.uncertainReason ?? reason,
      latestSnapshot: snapshot,
      trace: [...open.trace, `uncertain:${reason}`],
    };
    return close(snapshot);
  };

  const isTerminated = (): boolean => {
    if (open === null) return false;
    if (open.family === "pointer-gesture") return open.pointerTerminated;
    if (open.family === "discrete-keyboard-mutation") return open.keyboardTerminated;
    if (open.family === "text-edit-composition") {
      return open.textInactive && (!open.compositionStarted || open.compositionEnded);
    }
    return true;
  };

  return {
    observe(input) {
      if (input.scopeActive || input.callbackProvenance === "synthetic") return null;
      if (input.callbackProvenance === "unknown" || input.lateCallback) {
        return markUncertain("uncorrelatable or late public callback provenance", input.snapshot);
      }
      if (
        input.adapterCallbackSequence !== undefined &&
        lastSettledCallbackSequence !== null &&
        input.adapterCallbackSequence <= lastSettledCallbackSequence
      ) {
        return markUncertain("adapter callback sequence was delayed or duplicated", input.snapshot);
      }

      if (input.kind === "pointer-down") {
        if (open !== null) return markUncertain("overlapping human settlement families", input.snapshot);
        openFamily("pointer-gesture", input.snapshot);
        return null;
      }
      if (input.kind === "pointer-up" || input.kind === "pointer-cancel" || input.kind === "pointer-lost-capture") {
        if (open?.family === "pointer-gesture") open = { ...open, pointerTerminated: true, latestSnapshot: input.snapshot, trace: [...open.trace, input.kind] };
        return null;
      }
      if (input.kind === "keyboard-candidate") {
        if (!DISCRETE_MUTATION_KEYS.has(input.key ?? "")) return null;
        if (open === null) openFamily("discrete-keyboard-mutation", input.snapshot);
        else if (open.family === "generic-native-command") {
          open = {
            ...open,
            family: "discrete-keyboard-mutation",
            trace: [...open.trace, "promoted-to-keyboard-family"],
          };
        }
        else if (open.family !== "discrete-keyboard-mutation") return markUncertain("overlapping human settlement families", input.snapshot);
        return null;
      }
      if (input.kind === "keyboard-keyup") {
        if (open?.family === "discrete-keyboard-mutation") open = { ...open, keyboardTerminated: true, latestSnapshot: input.snapshot, trace: [...open.trace, input.kind] };
        return null;
      }
      if (input.kind === "text-edit-active" || input.kind === "composition-start") {
        if (open === null) openFamily("text-edit-composition", input.snapshot);
        else if (
          open.family === "generic-native-command" ||
          open.family === "pointer-gesture"
        ) {
          open = {
            ...open,
            family: "text-edit-composition",
            trace: [...open.trace, "promoted-to-text-family"],
          };
        }
        else if (open.family !== "text-edit-composition") return markUncertain("overlapping human settlement families", input.snapshot);
        if (open !== null) open = { ...open, compositionStarted: open.compositionStarted || input.kind === "composition-start", latestSnapshot: input.snapshot, trace: [...open.trace, input.kind] };
        return null;
      }
      if (input.kind === "composition-end") {
        if (open?.family === "text-edit-composition") open = { ...open, compositionEnded: true, latestSnapshot: input.snapshot, trace: [...open.trace, input.kind] };
        return null;
      }
      if (input.kind === "text-edit-inactive") {
        if (open?.family === "text-edit-composition") open = { ...open, textInactive: true, latestSnapshot: input.snapshot, trace: [...open.trace, input.kind] };
        return null;
      }
      if (input.kind === "semantic-callback") {
        if (open === null) {
          if (input.beforeSnapshot === undefined) return markUncertain("missing pre-mutation start snapshot", input.snapshot);
          openFamily("generic-native-command", input.beforeSnapshot);
        } else if (![
          "generic-native-command",
          "pointer-gesture",
          "discrete-keyboard-mutation",
          "text-edit-composition",
        ].includes(open.family)) {
          return markUncertain("overlapping human settlement families", input.snapshot);
        }
        open = {
          ...open!,
          callbackCount: open!.callbackCount + 1,
          lastCallbackSequence: input.adapterCallbackSequence ?? open!.lastCallbackSequence,
          latestSnapshot: input.snapshot,
          trace: [...open!.trace, `${input.kind}${input.adapterCallbackSequence === undefined ? "" : `#${input.adapterCallbackSequence}`}`],
        };
        return null;
      }
      // Presentation, focus, and composition updates are observable but not
      // mutation termination. Keep the latest projection for diagnostics.
      if (open !== null) open = { ...open, latestSnapshot: input.snapshot, trace: [...open.trace, input.kind] };
      return null;
    },
    forceSettle(reason) {
      if (open === null) return null;
      return close(open.latestSnapshot, reason);
    },
    settle(endSnapshot) {
      if (open === null) return null;
      if (!isTerminated()) return close(endSnapshot, "required public termination was not observed");
      if (Date.now() - open.openedAt > maxWaitMs) return close(endSnapshot, "human settlement exceeded the bounded drain deadline");
      return close(endSnapshot);
    },
    hasOpenFamily() {
      return open !== null;
    },
    isTerminated,
    openedAt() {
      return open?.openedAt ?? null;
    },
  };
}

/** Settle after the caller has completed the common drain window. */
export function settleFamily(
  observer: SynaraSettlementObserver,
  endSnapshot: SynaraDocumentSnapshot,
): SynaraSettlementResult {
  const settled = observer.settle(endSnapshot);
  if (settled !== null) return settled;
  return {
    family: "presentation-no-op",
    settled: "no-op",
    startFingerprint: endSnapshot.semanticFingerprint,
    endFingerprint: endSnapshot.semanticFingerprint,
    reason: "no mutation family was open; presentation-only observation",
    trace: Object.freeze([]),
  };
}
