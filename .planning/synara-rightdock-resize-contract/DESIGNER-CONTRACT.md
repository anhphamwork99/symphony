# DESIGNER CONTRACT — Desktop Right-Dock Resize at Limits (2026-08-16)

Proposed solution contract (pending owner approval of decisions D1-D3, recorded
in PROJECT.md). Companion evidence: SCOUT-EVIDENCE.md.

## Success definition (OKRs)

Goal: desktop right-dock resizing feels physically bounded — the dock follows
the pointer to its allowed limit, stays pinned there while the pointer continues
beyond it, and does NOT move/animate/settle at pointer release.

- KR1: Every drag frame, neither --sidebar-width nor any rendered dock surface
  exceeds the geometric, composer-feasibility, or floor bound for that gesture.
- KR2: Crossing a limit produces exactly one observable event: the dock reaches
  the exact stable limit and stays. No overshoot frame, no rejected-candidate
  flicker, no "last accepted sample" shortfall.
- KR3: Release (incl. same-task release) causes no observable width change:
  wrapper var, gap, container, rail, main — identical before/after/next frame.
- KR4: Two identical drags stop at the same width regardless of cadence/speed or
  non-monotonic raw probe observations.
- KR5: Main conversation stays ≥360px during open/drag/release/shrink; normal
  dock floor stays 416px while the shell affords it.
- KR6: Mobile sheet, left-sidebar resize semantics, open/close disclosure
  behavior unchanged.

## Interaction model

A manual drag operates against ONE immutable set of session bounds resolved at
drag start:

```
sessionMin = min(416, shellWidth - 360)
sessionMax = min(shellWidth - 360, composerSafeMaxDock)
visualWidth = clamp(pointerDerivedWidth, sessionMin, sessionMax)
```

- Widths written to the real wrapper are already accepted by the session
  resolver; NO per-pointer-move apply/measure/reset probe runs against the live
  DOM.
- The stopping width is the resolved boundary itself (700 means 700, not the
  last accepted sample 655).
- Pointermove writes the clamped width synchronously (no rAF gate for visible
  width; the browser still coalesces paints).
- Release is idempotent: verify/persist only; never re-evaluate feasibility or
  write a different width.
- Reversing the pointer re-enters tracking immediately once the derived width is
  back in range — no hysteresis or dead travel.
- Mid-gesture hard-safety events (shell shrink, composer constraint tightening)
  clamp INWARD synchronously with zero transition and freeze the replacement
  bound for the gesture; never deferred to release (decision D2).

## Composer constraint (replaces live per-candidate probe for the dock)

Resolve a conservative numeric minimum for Main/composer from a layout snapshot,
then `composerSafeMaxDock = shellWidth - requiredMainWidth`; intersect with the
geometric ceiling.

```
requiredComposerContent = max(intrinsic/overflow requirement,
                              160 + rightActionsWidth + footerGap)
requiredMainWidth = main-to-composer deductions
                  + composer viewport padding
                  + requiredComposerContent
```

- Conservative > clever: reserving extra width is fine; clipping/overflow is
  not.
- Snapshot is refreshed BETWEEN gestures, invalidated on shell geometry,
  composer structure/controls/fonts, or responsive-mode changes.
- Fail closed (decision D3): unmeasurable composer → no further widening that
  gesture; narrowing still allowed. Missing composer form (chat loader mount)
  keeps today's geometric-only bound.
- Keep `canComposerHandlePanelWidth` for split-view callers unchanged.

Rejected alternatives (with reasons): live probe per frame (non-monotonic,
layout cost); freeze first rejected sample (speed-dependent stop); hysteresis
(dead travel, variable stop); detached/offscreen clone (divergent layout);
binary search (needs monotonic predicate); CSS-pixel sweep (hundreds of forced
layouts).

## Commit/release rules

- pointerdown: resolve + freeze bounds; clamp actual rendered start width; install
  suppression BEFORE any correction; capture immutable session state.
- pointermove: derive → clamp to frozen bounds → write --sidebar-width
  synchronously if changed. No probe, no rejected-candidate write, no rAF deferral.
- release/cancel: cancel pending frame (for secondary work only); flush only if a
  platform genuinely delivered an uncommitted coordinate (already clamped by the
  same frozen bounds; normal path = no-op); persist/announce the already-visible
  width; restore transitions only AFTER the final suppressed paint (e.g.
  release task → commit suppressed → paint frame → restore frame). Cleanup
  idempotent for pointerup/pointercancel/unmount/shell-clamp interrupt/lost
  capture.

## Transition/suppression contract

| Element | During drag + final release paint | After restore |
|---|---|---|
| sidebar-gap | width-transition 0ms | open/close motion unchanged |
| sidebar-container | width/position-transition 0ms | open/close motion unchanged |
| resize rail | suppress transition-all (transform settle) | hover/toggle behavior unchanged |
| Main flex seam participant | suppress inline-size/flex/transform lag | surface transitions unchanged |
| unrelated descendants | nothing | unchanged |

Preserve each target's prior inline transition-duration and restore the exact
value. Open/close must reuse the shared disclosure/off-canvas motion convention
(apps/web/src/lib/disclosureMotion.ts); no bespoke dock toggle animation.

## Change plan (files)

1. apps/web/src/components/ui/sidebar.tsx — extend resizable options with a
   per-gesture bound resolver + explicit transition-target provider; SidebarRail:
   freeze bounds at pointerdown, synchronous clamped pointermove commits,
   idempotent release flush, suppression held through final paint. Keep the
   existing boolean shouldAcceptWidth path as the fallback for other consumers
   (left sidebar semantics untouched).
2. apps/web/src/components/chat/RightDock.tsx — provide geometric bounds +
   session resolver; include gap/container/rail/Main seam in transition targets;
   coordinate active-drag ceiling changes with the shell RO (no competing
   writer). Preserve half-shell open width + shrink-only behavior.
3. apps/web/src/components/chat/SingleChatSurface.tsx — replace the dock's
   shouldAcceptDockWidth apply/reset adapter with the composer constraint
   resolver scoped to SINGLE_CHAT_PANE_SCOPE_ID; expose the Main/composer
   transition target; invalidate cached constraint on relevant changes.
4. apps/web/src/lib/panelResize.ts — add a pure session-oriented measurement
   result (minimum safe composer/Main width or equivalent max dock width); keep
   canComposerHandlePanelWidth for split-view; centralize finite-number checks,
   subpixel tolerance, missing-composer and fail-closed diagnostics.
5. apps/web/src/lib/rightDockSizing.ts — pure intersection of geometric bounds
   with an optional composer ceiling; normalize invalid/below-floor results.
   Preserve maxDock = max(0, shell-360), minDock = min(416, maxDock). Composer
   ceiling may lower the max, never raise it, never alter floor arithmetic.
6. apps/web/src/lib/disclosureMotion.ts — no visual change; if tokens are
   reorganized, keep shared ownership here.
7. apps/web/src/components/chat/rightDockSizing.browser.tsx — extend harness:
   configurable composer constraint model, multi-move dispatch without awaiting
   rAF, wrapper mutation recording, pre/post-release snapshots.
8. apps/web/src/lib/panelResize.browser.ts + rightDockSizing.test.ts — unit-test
   the numeric constraint and bound intersection (fractional dims, missing
   composer, invalid measurements, non-monotonic observations).

DO NOT change: left-sidebar drag/storage semantics; mobile sheet (<768px); 360px
Main floor; 416px normal floor; half-shell open default + reopen recentering;
shrink-only-no-autogrow; split-view probe path; open/close timing/easing.

## Acceptance scenarios (assert BOTH committed var and rendered geometry:
wrapper var, gap rect, container rect, main rect, rail/seam position)

- AC-01 widen overshoot at geometric ceiling: commit/render ≤840, main ≥360,
  final == 840 exactly (not last sample), extra beyond-limit moves = no change.
- AC-02 widen overshoot at composer limit 700 with pointer jumping 655→780:
  next width == 700 exactly, nothing exceeds 700, real composer never rendered
  at rejected geometry.
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
- AC-08 non-monotonic raw observations (acceptance island beyond first break):
  two drags with different event spacing resolve the SAME ceiling; no island
  renders; same terminal value. Flaky-observation variant → same conservative
  ceiling or fail closed; never alternating drag widths.
- AC-09 suppression coverage: 0ms effective duration on gap/container/rail/Main
  seam through the final paint; nothing changes after suppression restore;
  close/reopen still uses the shared motion and stays in lockstep.
- AC-10 shell shrink during drag → synchronous clamp to new shell-360, main
  never <360, no animated intermediate frames, release idempotent.
- AC-11 composer mutates during drag → immediate inward clamp before an unsafe
  frame; replacement bound stable for the gesture; release idempotent;
  diagnostic identifies invalidation.
- AC-12 regression suite: half-shell open/reopen, fractional ceilings,
  shrink-only behavior, 416 floor, mobile untouched, left sidebar contract,
  split-view tests.

## Risks & rollback

- Rail changes affect left sidebar → session-bound path is opt-in; keep fallback
  path + left-sidebar tests.
- Arithmetic under/over-estimation → conservative measurements; fail closed;
  boundary-vs-epsilon tests with real composer layouts.
- Stale cached constraint → invalidate between gestures + on shell/composer
  changes; emergency inward clamp during drags.
- Undiscovered Main transition → tests inspect rendered Main width, not just
  the var.
- Suppression cleanup vs immediate close/open → cleanup idempotent; open/close
  supersedes the drag suppression lease before applying shared motion.
- Split-view regression → new resolver alongside old helper; no implicit change
  to split semantics.
- Shell RO vs rail width ownership race → RightDock routes active-drag ceiling
  changes into the rail session (single final writer).
- Rollback: capability-scoped — disable the session resolver + synchronous
  commit path only; never roll back the 360 policy or mobile/left-sidebar.

## Owner decisions

- D1: approve stable conservative composer model (may stop a few px earlier than
  an isolated acceptance island would allow). Recommended: approve.
- D2: mid-drag hard-gate tightening → immediate transitionless inward clamp.
  Recommended: approve (correctness > stationary feel).
- D3: unmeasurable composer → fail closed for widening that gesture; narrowing
  still allowed. Recommended: approve.