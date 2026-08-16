# DESIGNER CONTRACT — Desktop Right-Dock Resize at Limits (2026-08-16)

Final solution contract (owner-approved 2026-08-16; binding). Status:
IMPLEMENTED and REMEDIATED (2026-08-16) per IMPLEMENTATION-BRIEF.md and
issues/01-implementation-review-remediation.md — all review behavior criteria
PASS and the sole compile blockers (TS2484, TS2375) are resolved. Binding final
acceptance: `accepted-with-recorded-nonblocking-risks` (see
decisions/0001-final-acceptance.md). Companion evidence: SCOUT-EVIDENCE.md;
final verification: FINAL-VERIFICATION.md. Supersession record: PROJECT.md.

## Success definition (OKRs)

Goal: desktop right-dock resizing feels physically bounded — the dock follows
the pointer to its allowed limit, stays pinned there while the pointer continues
beyond it, and does NOT move/animate/settle at pointer release.

- KR1: Every drag frame, neither --sidebar-width nor any rendered dock surface
  exceeds the geometric session max (`max(0, shellWidth - 360)`) or falls below
  the session floor (`min(416, max(0, shellWidth - 360))`); Main stays ≥ 360px
  whenever the shell affords it (shellWidth ≥ 360).
- KR2: Crossing a limit produces exactly one observable event: the dock reaches
  the exact stable limit and stays. No overshoot frame, no rejected-candidate
  flicker, no "last accepted sample" shortfall, no second stop.
- KR3: Release (incl. same-task release) causes no observable width change:
  wrapper var, gap, container, rail, main — identical before/after/next frame.
- KR4: Two identical drags stop at the same width regardless of cadence/speed.
- KR5: Main conversation stays ≥360px during open/drag/release/shrink; normal
  dock floor stays 416px while the shell affords it.
- KR6: Mobile sheet, left-sidebar resize semantics, open/close disclosure
  behavior unchanged.

## Interaction model

A manual drag operates against ONE immutable set of GEOMETRIC session bounds
resolved at drag start:

```
sessionMin = min(416, max(0, shellWidth - 360))
sessionMax = max(0, shellWidth - 360)               // the ONLY max — geometric
visualWidth = clamp(pointerDerivedWidth, sessionMin, sessionMax)
```

- `shellWidth` = the dock's flex shell (wrapper.parentElement) live width at
  pointerdown.
- No composer-derived term appears anywhere in the session bounds: no live
  probe, no snapshot measurement, no ceiling. The geometric max
  `max(0, shellWidth - 360)` (Main floor 360px for any shell that affords it)
  is the single max. For an undersized shell (shellWidth < 360) the bound
  degenerates to 0px — arithmetic safety, NOT a second Main limit; the contract
  still has exactly one Main minimum (360px), which applies whenever the shell
  affords it.
- Widths written to the real wrapper are already within the frozen session
  bounds; NO per-pointer-move apply/measure/reset probe runs against the live
  DOM.
- The stopping width is the resolved boundary itself (840 means 840, not the
  last accepted sample).
- Pointermove writes the clamped width synchronously (no rAF gate for visible
  width; the browser still coalesces paints).
- Release is idempotent: verify/persist only; never re-evaluate feasibility or
  write a different width.
- Reversing the pointer re-enters tracking immediately once the derived width is
  back in range — no hysteresis or dead travel.
- Mid-gesture shell shrink: update the active session max INWARD to
  `max(0, newShellWidth - 360)`, recompute the session min only when needed to
  keep `min ≤ max` (never outward), clamp the current width INWARD synchronously
  with zero transition, and freeze the replacement bound for the gesture; never
  deferred to release. Shrink-only: neither the bounds nor the width ever
  re-grow. The shell ResizeObserver path routes the active-drag
  ceiling update into the rail's session (single writer).
- There is NO composer-mutation safety path: composer layout changes do not
  affect dock geometry during a drag or at any other time in the dock path.

## Composer feasibility is removed from the dock path

- The right-dock drag path no longer calls `canComposerHandlePanelWidth`
  (apps/web/src/lib/panelResize.ts) and no replacement measurement is added —
  no snapshot of composer/main layout, no derived max dock, no caching or
  invalidation, no failure mode.
- `canComposerHandlePanelWidth` remains in the codebase UNCHANGED for split-view
  callers only.
- The dock's width contract is purely geometric: `min(416, max(0, shellWidth -
360))` floor, `max(0, shellWidth - 360)` ceiling. Composer width behavior is
  not part of dock-resize geometry.

Rejected alternatives (with reasons): live per-frame probe (non-monotonic,
layout cost — the observed root cause); composer-derived snapshot bound resolved
at drag start (introduces a second boundary that diverges from product intent,
and needs measurement/caching/invalidation); freeze first rejected sample
(speed-dependent stop); hysteresis (dead travel, variable stop);
detached/offscreen clone (divergent layout); binary search (needs monotonic
predicate); CSS-pixel sweep (hundreds of forced layouts).

## Commit/release rules

- pointerdown: resolve + freeze geometric session bounds; clamp actual rendered
  start width into bounds; install suppression BEFORE any width correction;
  capture immutable session state.
- pointermove: derive → clamp to frozen bounds → write --sidebar-width
  synchronously if changed. No probe, no rejected-candidate write, no rAF
  deferral.
- release/cancel: cancel pending frame (for secondary work only); flush only if
  a platform genuinely delivered an uncommitted coordinate (already clamped by
  the same frozen bounds; normal path = no-op); persist/announce the
  already-visible width; restore transitions only AFTER the final suppressed
  paint (e.g. release task → commit suppressed → paint frame → restore frame).
  Cleanup idempotent for pointerup/pointercancel/unmount/shell-clamp
  interrupt/lost capture.
- shell shrink mid-drag: the shell ResizeObserver (RightDock writeShrinkClamp)
  updates the rail session's max inward to `max(0, newShellWidth - 360)` (the
  session min is recomputed only when needed to keep `min ≤ max`, never
  outward); the rail clamps the current width inward synchronously (zero
  transition) and freezes the new bound for the gesture. Single writer,
  inward-only, no re-grow.

## Transition/suppression contract

| Element                    | During drag + final release paint          | After restore                   |
| -------------------------- | ------------------------------------------ | ------------------------------- |
| sidebar-gap                | width-transition 0ms                       | open/close motion unchanged     |
| sidebar-container          | width/position-transition 0ms              | open/close motion unchanged     |
| resize rail                | suppress transition-all (transform settle) | hover/toggle behavior unchanged |
| Main flex seam participant | suppress inline-size/flex/transform lag    | surface transitions unchanged   |
| unrelated descendants      | nothing                                    | unchanged                       |

Preserve each target's prior inline transition-duration and restore the exact
value. Open/close must reuse the shared disclosure/off-canvas motion convention
(apps/web/src/lib/disclosureMotion.ts); no bespoke dock toggle animation.

## Change plan (files)

1. apps/web/src/components/ui/sidebar.tsx — extend resizable options with a
   per-gesture GEOMETRIC session-bound resolver + explicit transition-target
   provider; SidebarRail: freeze bounds at pointerdown, synchronous clamped
   pointermove commits, idempotent release flush, suppression held through
   final paint. Keep the existing boolean shouldAcceptWidth path as the
   fallback for other consumers (left sidebar semantics untouched).
2. apps/web/src/components/chat/RightDock.tsx — provide geometric session
   bounds; include gap/container/rail/Main seam in transition targets;
   coordinate active-drag shell-shrink ceiling updates with the shell RO (no
   competing writer). Preserve half-shell open width + shrink-only behavior.
3. apps/web/src/components/chat/SingleChatSurface.tsx — REMOVE the dock's
   shouldAcceptDockWidth apply/reset composer adapter (the dock path has no
   composer feasibility check, live or snapshot); keep
   canComposerHandlePanelWidth for split-view callers; expose the Main seam
   transition target.
4. apps/web/src/lib/panelResize.ts — no change for the dock; keep
   canComposerHandlePanelWidth intact for split-view (do not add snapshot
   measurement/caching/invalidation machinery).
5. apps/web/src/lib/rightDockSizing.ts — pure geometric bounds:
   `maxDock = max(0, shellWidth - 360)`, `minDock = min(416, maxDock)`; normalize
   invalid/below-floor results. The degenerate 0px bound for an undersized
   shell (shellWidth < 360) is arithmetic safety, not a second Main limit; for
   standard shells Main's floor is exactly 360px. No composer-ceiling input
   exists.
6. apps/web/src/lib/disclosureMotion.ts — no visual change; shared ownership
   stays here.
7. apps/web/src/components/chat/rightDockSizing.browser.tsx — extend harness:
   multi-move dispatch without awaiting rAF, wrapper mutation recording,
   pre/post-release snapshots. No pluggable composer constraint model.
8. apps/web/src/lib/rightDockSizing.test.ts — unit-test the pure geometric
   bounds (fractional dims, invalid inputs, below-floor). Split-view tests
   (panelResize.browser.ts) untouched.

DO NOT change: left-sidebar drag/storage semantics; mobile sheet (<768px); 360px
Main floor; 416px normal floor; half-shell open default + reopen recentering;
shrink-only-no-autogrow; split-view probe path; open/close timing/easing.

## Acceptance scenarios (assert BOTH committed var and rendered geometry:

wrapper var, gap rect, container rect, main rect, rail/seam position)

- AC-01 widen overshoot at geometric ceiling (shell 1200 → ceiling 840):
  commit/render ≤840, main ≥360, final == 840 exactly (not last sample), extra
  beyond-limit moves = no change.
- AC-02 single stop, no second boundary: fast widen overshoot with pointer
  jumping 655→900 in the same shell: the dock stops exactly once at the
  geometric ceiling (840); no intermediate plateau, no catch-up lurch, no
  second stop at any other width; Main never < 360.
- AC-03 narrow overshoot at 416 floor: nothing below 416, final == 416,
  overshoot keeps geometry static.
- AC-04 shell 700 (minDock === maxDock === 340): both gestures pinned at 340,
  main == 360, release no-op.
- AC-05 fast same-task release at each limit: width committed immediately after
  the final pointermove; identical after pointerup + next frame.
- AC-06 snapshot S0 (post-move, pre-up) === S1 (sync post-up) === S2 (next
  frame); MutationObserver: no post-up var mutation.
- AC-07 reverse after overshoot: static while outside; first in-range pointer
  value commits directly; no hysteresis/jump/catch-up animation.
- AC-08 determinism: two identical drags at different cadence/speed stop at the
  SAME width; bounds are a pure function of shellWidth (no acceptance island,
  no flaky-observation variance).
- AC-09 suppression coverage: 0ms effective duration on gap/container/rail/Main
  seam through the final paint; nothing changes after suppression restore;
  close/reopen still uses the shared motion and stays in lockstep.
- AC-10 shell shrink during drag: session max updates inward to
  max(0, newShellWidth-360) with min kept ≤ max (never outward); synchronous
  inward clamp; main never <360 (when the shell affords it); no animated
  intermediate frames; no re-grow; release idempotent.
- AC-11 regression suite: half-shell open/reopen, fractional ceilings,
  shrink-only behavior, 416 floor, mobile untouched, left sidebar contract,
  split-view tests.
- AC-12 negative probe assertion: a Right-Dock drag NEVER invokes
  `canComposerHandlePanelWidth` and never applies the removed
  `shouldAcceptDockWidth` composer adapter — assert via spy/static reference
  that no composer feasibility call exists on the dock drag path (widen,
  overshoot, narrow, shell shrink), while split-view keeps calling the probe
  unchanged (panelResize.browser.ts untouched).

## Risks & rollback

- Rail changes affect left sidebar → session-bound path is opt-in; keep fallback
  path + left-sidebar tests.
- Undiscovered Main transition → tests inspect rendered Main width, not just
  the var.
- Suppression cleanup vs immediate close/open → cleanup idempotent; open/close
  supersedes the drag suppression lease before applying shared motion.
- Shell RO vs rail width ownership race → RightDock routes active-drag ceiling
  changes into the rail session (single final writer, inward-only).
- Split-view regression → dock path change only; canComposerHandlePanelWidth
  untouched; no implicit change to split semantics.
- Composer overflow at narrow Main widths is out of scope for dock resize: the
  dock contract is geometric (360px Main floor). If the composer ever overflows
  at 360px, that is a composer-layout concern, not a new dock bound.
- Rollback: capability-scoped — disable the session resolver + synchronous
  commit path only; never roll back the 360 policy or mobile/left-sidebar.

## Owner decisions (BINDING, 2026-08-16)

- The chat panel is the Main conversation; dragging the right-dock divider left
  narrows Main.
- Main has exactly one minimum width: 360px.
- Composer feasibility is removed from the right-dock drag path entirely (no
  live probe, no snapshot bound, no composer-derived ceiling, no failure mode);
  the geometric max `max(0, shellWidth - 360)` is the only max.
- Pointermove clamps and commits synchronously; release never re-evaluates or
  changes geometry; shell shrink mid-drag clamps inward synchronously to the
  updated max `max(0, newShellWidth - 360)` (min recomputed only to keep
  `min ≤ max`, never outward); no composer-mutation safety path.
- Earlier draft proposals (composer-snapshot model, 2026-08-16) are SUPERSEDED
  by this clarification; see PROJECT.md for the supersession record.
