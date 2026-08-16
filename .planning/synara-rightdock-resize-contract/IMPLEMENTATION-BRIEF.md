# IMPLEMENTATION BRIEF (AUTHORITATIVE) — Right-dock resize-at-limit fix

You are implementing the owner-approved final solution contract for the Synara
desktop app's right dock resize feel. The contract is FINAL and BINDING — do not
redesign it; do not reintroduce composer-derived constraints. Read the planning
docs first:

- `.planning/synara-rightdock-resize-contract/DESIGNER-CONTRACT.md` (the contract)
- `.planning/synara-rightdock-resize-contract/SCOUT-EVIDENCE.md` (evidence + exact
  release call order, writer enumeration, suppression scope)
- `.planning/synara-rightdock-resize-contract/PROJECT.md` (scope boundaries +
  supersession record)

## Problem (1 paragraph)

The dock's drag commits each candidate through a live composer probe
(`canComposerHandlePanelWidth`, apps/web/src/lib/panelResize.ts) that applies the
candidate to the real wrapper, measures the live composer, and resets. The
composer footer adapts a frame later (ResizeObserver in
apps/web/src/components/ChatView.tsx ~5386-5444 → tier/compact state with
hysteresis), so the probe's accept boundary drifts mid-drag: the dock pins at
the last accepted sample (not the true limit) and lurches. Release does nothing
further. Fix: REMOVE composer feasibility from the right-dock drag path entirely
(no live probe, no snapshot substitute) and resolve ONE immutable set of
GEOMETRIC session bounds per drag gesture, committing pointer-derived widths
synchronously against those frozen bounds.

## Binding behavior contract (owner-approved)

1. At pointerdown, resolve and FREEZE for the gesture:
   `sessionMin = min(416, max(0, shellWidth - 360))`;
   `sessionMax = max(0, shellWidth - 360)`.
   These are purely geometric — no composer input of any kind (no live probe,
   no snapshot measurement, no ceiling). `shellWidth` = the dock's flex shell
   (wrapper.parentElement) live width at pointerdown. For an undersized shell
   (shellWidth < 360) the bound degenerates to 0px — arithmetic safety, NOT a
   second Main limit; for standard shells (shellWidth ≥ 360) Main's floor is
   exactly 360px.
2. Every pointermove derives width from startWidth + pointer delta, clamps to the
   frozen session bounds, and writes `--sidebar-width` on the wrapper
   SYNCHRONOUSLY when changed (no rAF gate for the visible write; no
   per-move apply/measure/reset probe; every committed width is the clamped
   in-range value — there is no probe to reject a candidate).
3. Release is IDEMPOTENT: cancel any pending secondary frame; normal path is a
   no-op (pointermove already committed the final width); persist/announce
   (storageKey/onResize — dock has none today, keep that); restore transition
   suppression ONLY after the final suppressed paint (commit scope below). No
   re-evaluation at release: if the rail's existing release flush commits a
   width, it commits against the same frozen session bounds (a no-op when the
   last pointermove already wrote the final width) — never a different width.
4. Reversing the pointer re-enters tracking immediately when the derived width
   is back in range — no hysteresis, no dead travel.
5. Mid-gesture shell shrink: update the active session max INWARD to
   `max(0, newShellWidth - 360)`; recompute the session min only when needed to
   keep `min ≤ max` (never outward); clamp INWARD immediately (zero transition)
   to the updated bounds; freeze the replacement bound for the remainder of the
   gesture; never allow the dock to render a width that violates the 360px Main
   floor (when the shell affords it), and never re-grow (shrink-only). The shell
   ResizeObserver path in RightDock (writeShrinkClamp) must route the
   active-drag ceiling update INTO the rail's frozen session (single writer,
   inward-only) rather than racing it — implement e.g. a mutable session handle
   the rail exposes and RightDock updates, or an equivalent clean mechanism;
   keep writeShrinkClamp's existing no-autogrow semantics.
   There is NO composer-mutation safety path: composer layout changes do not
   affect dock geometry during a drag.
6. Removed behavior (do NOT implement): no composer snapshot measurement, no
   derived max dock, no caching/invalidation, no failure mode, no widening
   block. `canComposerHandlePanelWidth` is not part of the dock path.

## Composer feasibility is removed from the dock path

- The right-dock drag path no longer calls `canComposerHandlePanelWidth` and NO
  replacement measurement is requested — do not add any new snapshot
  measurement, caching, or invalidation to apps/web/src/lib/panelResize.ts or
  anywhere else.
- Keep `canComposerHandlePanelWidth` INTACT for split-view callers
  (apps/web/src/components/chat/PanelResize\*.tsx users) — split-view behavior
  must not change.
- The dock's width contract is purely geometric: floor
  `min(416, max(0, shellWidth - 360))`, max `max(0, shellWidth - 360)`.

## Component changes

### apps/web/src/components/ui/sidebar.tsx (rail primitive)

- Extend `SidebarResizableOptions` with an optional per-gesture GEOMETRIC
  session bound resolver (e.g. `resolveSessionBounds?: (context: { wrapper,
rail, side, currentWidth, minWidth, maxWidth }) => { min: number; max:
number } | null` plus an optional exposed mutable session handle for
  emergency inward updates from the shell shrink). Keep the EXISTING boolean
  `shouldAcceptWidth` path as the fallback for consumers that don't provide
  the resolver — the left thread sidebar (apps/web/src/routes/\_chat.tsx,
  minWidth 13\*16, its own `clientWidth - nextWidth >= 640` probe, storageKey
  "chat_thread_sidebar_width") must behave EXACTLY as today: same accept/reject
  semantics, same storage persistence, same release path. Do not silently
  change generic left-sidebar behavior.
- At pointerdown: resolve + freeze session bounds; clamp the actual rendered
  start width into bounds; install transition suppression BEFORE any width
  correction; keep the 2px move threshold, pointer capture, click suppression.
- Pointermove: derive → clamp to frozen bounds → synchronous write when
  changed. Remove the width write from the rAF path (rAF may remain only for
  secondary work or be removed if unused).
- Release: idempotent per binding #3. Cleanup must be idempotent for pointerup,
  pointercancel, unmount, shell-clamp interruption, lost capture.
- Suppression scope: the existing gap + container targets PLUS the rail button
  (it has transition-all ease-linear) and an optional caller-provided Main seam
  participant element. Preserve each target's prior inline transition-duration
  value and restore the exact value. Restore AFTER the final suppressed paint:
  release task keeps suppression → first paint frame (double-rAF is acceptable)
  → restore prior values. Do not violate the signal in
  apps/web/src/lib/disclosureMotion.ts (open/close disclosure motion stays
  shared and unchanged).

### apps/web/src/components/chat/RightDock.tsx

- Provide the rail with the session-bound resolver (geometric bounds from
  `rightDockEffectiveBounds(shellWidth)` only) and the expanded transition
  targets (gap, container, rail — rail is inside Sidebar itself — and the Main
  seam participant via a new host-driven prop/resolver).
- Coordinate active-drag ceiling changes from the existing shell
  ResizeObserver/writeShrinkClamp with the rail session (binding #5); the
  shrink clamp keeps its probe-bypass nature and no-autogrow semantics
  (clampRightDockShrinkWidth unchanged).
- Preserve: half-shell (or pane-preferred) open width, reopen recentering,
  motion suppression on mount/motionKey, RIGHT_DOCK_MIN_WIDTH/RIGHT_DOCK_DEFAULT_WIDTH
  constants, no storageKey/no onResize.

### apps/web/src/components/chat/SingleChatSurface.tsx

- REMOVE the dock's `shouldAcceptDockWidth` apply/reset composer adapter — the
  dock path has no composer feasibility check, live or snapshot, and no
  replacement resolver is added.
- Keep `canComposerHandlePanelWidth` in panelResize.ts for split-view callers
  (verify consumers still import it; do not change its semantics).
- Pass the Main seam transition-target element down to RightDock (the Main
  column root rendered next to the dock).
- Keep mainMinWidth={RIGHT_DOCK_MAIN_MIN_WIDTH} wiring and all other props.

### apps/web/src/lib/panelResize.ts

- NO new measurement for the dock. Leave `canComposerHandlePanelWidth` as-is for
  split-view. Do not add snapshot measurement, caching, or invalidation
  machinery.

### apps/web/src/lib/rightDockSizing.ts

- Keep the pure geometric bounds `maxDock = max(0, shellWidth - 360)` /
  `minDock = min(416, maxDock)`; normalize invalid/below-floor results. The
  degenerate 0px bound for an undersized shell (shellWidth < 360) is arithmetic
  safety, not a second Main limit; for standard shells Main's floor is exactly
  360px. Remove any composer-ceiling intersection/parameter — the geometric max
  is the only max.

### apps/web/src/lib/disclosureMotion.ts

- No visual change; shared ownership stays here.

### Tests

- DELETE `apps/web/src/components/chat/scratch-overshoot.browser.tsx` (temporary diagnostics).
- Extend `apps/web/src/components/chat/rightDockSizing.browser.tsx`: implement
  acceptance scenarios AC-01..AC-12 from the designer contract (geometric
  ceiling 840 with main ≥360 and final == 840 exactly; single-stop fast jump
  655→900 with no second boundary; 416 floor; coincident floor/ceiling at
  shell 700; same-task fast release at each limit; snapshot S0/S1/S2 equality
  with a MutationObserver on the wrapper style; reverse-after-overshoot;
  determinism across cadences; suppression coverage incl. rail and Main seam;
  shell shrink during drag inward clamp; AC-12 negative probe assertion). No
  pluggable composer constraint model — the harness's pluggable shouldAcceptWidth
  is removed from the dock path. AC-12 must assert via spy that
  `canComposerHandlePanelWidth` is NEVER called during any Right-Dock drag and
  that the removed `shouldAcceptDockWidth` adapter is not referenced on the
  dock path; split-view tests (panelResize.browser.ts) stay untouched and still
  exercise the probe. Keep ALL existing tests passing (half-shell open,
  fractional ceilings, shrink-only, floor, etc.).
- Unit tests: `apps/web/src/lib/rightDockSizing.test.ts` for the pure geometric
  bounds (fractions, invalid inputs, below-floor).
- Do NOT modify the left sidebar's tests, any mobile-layout tests, or the
  split-view tests (panelResize.browser.ts).

## Explicitly DO NOT change

- Left-sidebar drag/storage semantics (`routes/_chat.tsx`), mobile sheet
  (<768px), the 360px Main floor, the 416px normal dock floor, half-shell
  default open width + reopen recentering, shrink-only/no-autogrow behavior,
  split-view probe behavior (`canComposerHandlePanelWidth` callers),
  open/close timing/easing, desktop electron code.

## Environment notes (binding)

- Web app is in apps/web; run everything from the repo root with
  `/Users/anhpham99/.bun/bin/bun`. Never run `bun fmt` / `bun lint` /
  `bun typecheck` at workspace level — the orchestrator runs the final pass.
  You MAY run targeted tests: `bun run --cwd apps/web test <file>` (unit) and
  browser tests `bun run --cwd apps/web test:browser:stable -- <one file per
invocation>` (running multiple browser files in one invocation or two
  concurrent browser test processes is FLAKY — always one file at a time).
- `bun run --cwd apps/web typecheck` against apps/web is allowed locally while
  iterating.
- Do NOT git commit; the orchestrator commits. Do NOT touch anything outside
  apps/web. TypeScript strict; no `any` assertions; follow existing code style
  (they are strict about explicit types and comments explaining "why").

## Task sequencing (follow this order)

1. Read the three planning docs + the current sources (sidebar.tsx rail
   section, RightDock.tsx, SingleChatSurface.tsx dock section, rightDockSizing.ts,
   the browser test file, routes/\_chat.tsx left sidebar usage and its tests if
   any).
2. Implement lib-layer changes (rightDockSizing.ts — remove the composer-ceiling
   intersection) + unit tests; run them.
3. Implement rail-primitive session-bound path in sidebar.tsx with the
   fallback preserved; extend RightDock.tsx + SingleChatSurface.tsx wiring
   (remove the dock's shouldAccept composer adapter).
4. Delete scratch-overshoot.browser.tsx; rewrite/extend the browser harness
   tests per AC list; run them one file at a time.
5. Run: sidebar.test.tsx, any left-sidebar/route tests you touched or that
   cover the rail (search for tests referencing SidebarRail/chat_thread_sidebar_width),
   rightDockSizing.test.ts, rightDockSizing.browser.tsx.
6. Fix everything until green; then run `bun run --cwd apps/web typecheck`.

## Report back (to stdout, final message)

- Files changed (paths) with 1-line summaries of the mechanism implemented.
- Test commands run and results (pass/fail counts per suite).
- Any deviation from this brief with justification (deviations on binding
  items are NOT allowed without explicit challenge text — flag them instead).
- Remaining risks or unverified paths (e.g. anything only provable with a real
  composer layout).
- Do not commit; leave the working tree with your changes for review.
