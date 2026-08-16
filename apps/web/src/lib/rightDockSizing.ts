// FILE: rightDockSizing.ts
// Purpose: Pure sizing policy for the desktop Right sidebar dock — the geometric
// invariant that the Main conversation never renders below its minimum width, and
// the shrink-only rule that a growing shell never auto-grows the dock.
// Layer: Web panel layout policy
// Depends on: nothing (pure arithmetic; exercised by rightDockSizing.test.ts)

/**
 * Minimum width (px) the desktop Main conversation keeps inside the flex shell
 * that hosts chat + dock. The dock may occupy at most `shellWidth - MAIN_MIN`
 * (the geometric ceiling `maxDock`), so open, drag, and shell-shrink can never
 * squeeze the Main conversation below this.
 */
export const RIGHT_DOCK_MAIN_MIN_WIDTH = 360;

/**
 * The dock's normal readable floor (26 * 16px, matching RIGHT_DOCK_MIN_WIDTH in
 * RightDock.tsx). The floor holds whenever the shell can afford it; below a
 * 776px shell the geometric ceiling drops under the floor and becomes the floor
 * too (`minDock = min(416, maxDock)`), letting the dock shrink exactly as far
 * below 416 as the Main-conversation invariant requires.
 */
export const RIGHT_DOCK_NORMAL_MIN_WIDTH = 26 * 16;

export interface RightDockBounds {
  /** Drag floor for the dock width, in px. */
  readonly minDock: number;
  /** Drag ceiling for the dock width, in px (never below 0). */
  readonly maxDock: number;
}

/**
 * Effective drag bounds for the dock inside a `shellWidth`-px shell: the dock
 * can never take more than `shellWidth - MAIN_MIN` (Main conversation >= 360),
 * and its normal 416px floor applies only while the ceiling is above it.
 */
export function rightDockEffectiveBounds(shellWidth: number): RightDockBounds {
  const maxDock = Math.max(0, shellWidth - RIGHT_DOCK_MAIN_MIN_WIDTH);
  const minDock = Math.min(RIGHT_DOCK_NORMAL_MIN_WIDTH, maxDock);
  return { minDock, maxDock };
}

/**
 * Opening width: the host's existing default (`max(minWidth, preferred)` — the
 * half-shell split or a pane's preferred width) is clamped only downward by the
 * geometric ceiling. Wide shells keep today's default exactly; narrow shells
 * never squeeze the Main conversation below RIGHT_DOCK_MAIN_MIN_WIDTH.
 */
export function clampRightDockOpenWidth(
  preferredWidth: number,
  shellWidth: number,
  minWidth: number,
): number {
  const { maxDock } = rightDockEffectiveBounds(shellWidth);
  return Math.min(maxDock, Math.max(minWidth, preferredWidth));
}

/**
 * Shrink-only re-clamp after a shell resize: a narrower shell may pull the dock
 * down with it (never up), so shell growth never auto-grows the dock. The result
 * is monotonically non-increasing in `currentWidth`, so re-applying it after any
 * shell change converges without oscillation. The ceiling is returned exactly,
 * unrounded, so a fractional shell width can never yield a dock wider than
 * `shell - RIGHT_DOCK_MAIN_MIN_WIDTH`; callers write this value verbatim.
 */
export function clampRightDockShrinkWidth(currentWidth: number, shellWidth: number): number {
  return Math.min(currentWidth, rightDockEffectiveBounds(shellWidth).maxDock);
}
