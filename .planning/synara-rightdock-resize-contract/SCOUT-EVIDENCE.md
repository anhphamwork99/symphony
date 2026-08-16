# SCOUT EVIDENCE — Right-Dock "Jerk Back to the Limit" (2026-08-16)

Scope: read-only investigation of the real chat route's dock resize pipeline.
Method: source tracing with exact references + harness diagnostics
(apps/web/src/components/chat/scratch-overshoot.browser.tsx, /tmp/overshoot-trace.log).

NOTE: the scout's paths say `components/chat/ChatView.tsx`; the correct file is
`apps/web/src/components/ChatView.tsx` (verified by orchestrator). All line
numbers below were verified against the correct file.

## Key findings

1. **No min-width floor in the Main column chain** (Q1). Shell = SingleChatSurface
   root (`flex h-dvh min-h-0 min-w-0 flex-1 overflow-hidden`,
   composerPickerStyles.ts:100-101). Every level down to the composer is
   `min-w-0`/`flex-1`; the composer frame only has a `max-w-[46rem]` cap. The dock
   column is `flex-none w-auto` (RightDock.tsx:416) with in-flow width from the
   sidebar-gap. Candidates are clamped to `maxDock = shell - 360`
   (rightDockSizing.ts:37-43), so the Main column can never go below 360; the
   shell clips overflow. REFUTED: "main refuses to shrink / row reflow".

2. **The composer probe is non-monotonic and stateful** (Q2) — CONFIRMED as the
   real-app/harness difference. `canComposerHandlePanelWidth`
   (apps/web/src/lib/panelResize.ts:24-68) measures: form scrollWidth vs
   clientWidth+0.5; formRect vs viewportContentWidth+0.5; form clientWidth vs
   `160 + rightActionsWidth + footerGap`. All three depend on the adaptive
   composer footer:
   - ResizeObserver on the composer form → `syncComposerFooterLayout`
     (ChatView.tsx:5431-5444 → 5386-5410);
   - `setIsComposerFooterCompact` (direct flip, :5388-5391) and
     `resolveNextComposerFooterTier` demote/promote tier with hysteresis
     (:5392-5409, useLayoutEffect re-measure at :9551-9553);
   - footer is `@container` + `flex-wrap ... sm:flex-nowrap` (:11479-11484), right
     actions `shrink-0` (:11538-11542), leading cluster `overflow-hidden` vs
     `overflow-x-auto` (:11492-11494), picker widths change with compact state
     (w-32 vs w-36 sm:w-44 etc., :9554-9556).
   Consequence: the accept/reject boundary is a step function of tier/compact
   state that lags committed widths by one RO delivery, with hysteresis on the
   way back. Acceptance is NOT a pure function of nextWidth.

3. **No paint boundary inside the probe** (Q3). apply → measure → reset in
   panelResize.ts:37-63 is fully synchronous; RO callbacks deliver in the
   rendering step after the task. The transient candidate width is never painted.
   REFUTED: probe flicker between apply/reset.

4. **No unsuppressed width transition animates after release** (Q4). Drag
   suppression covers gap+container (sidebar.tsx:559-565, removed :518-520).
   The rail's `transition-all ease-linear` (sidebar.tsx:714) never fires because
   no rail own-property changes during/after a drag. `.chat-content-card`
   transitions box-shadow/opacity only (index.css:151-152,174). The chat header
   RO compact switch (ChatHeader.tsx:584-587) reflows only header content.
   REFUTED as a mover (latent only).

5. **Complete writer enumeration of --sidebar-width** (Q5): (a) rail pointerdown
   initial width (sidebar.tsx:583); (b) commitResizeCandidate during drag + at
   release flush (sidebar.tsx:492, stopResize :515-517); (c) rail storage effect
   (sidebar.tsx:677) — no-op for the dock (no storageKey); (d) SidebarProvider
   React style `max(28rem, calc(50vw - 8rem))` (RightDock.tsx:417) — only on
   remount; (e) writeShrinkClamp (RightDock.tsx:286) — only on shell size change,
   shrink-only guard :268; (f) open effect (RightDock.tsx:377) — deps never
   change at release; (g) probe apply/reset inside each probe call
   (SingleChatSurface.tsx:157,161). No writer fires backward at pointerup:
   pendingWidth is monotonic in pointer X (sidebar.tsx:599-609).
   REFUTED: any post-release writer.

6. **Shell ResizeObserver** (Q6/H6) observes the flex-1 row whose width does not
   change with the dock var; `overflow-hidden` prevents scrollbar-induced
   content-box changes. Does not fire on dock drags. REFUTED.

7. **Exactly two resizable rails exist**: left thread sidebar — content-seam
   rail, resizable `{minWidth: 13*16, shouldAcceptWidth: clientWidth - nextWidth
   >= 640, storageKey: "chat_thread_sidebar_width"}` (routes/_chat.tsx:64-69,
   574-597); right dock — sidebar-shell rail (RightDock.tsx:541), resizable
   `{minWidth: bounds.minDock, maxWidth: bounds.maxDock, shouldAcceptWidth}`
   (RightDock.tsx:429-440), no storageKey/onResize.

8. **What the user sees** (Q7): the position:fixed sidebar-container
   (right-0, w-(--sidebar-width)) is "the panel"; the in-flow gap carries the
   flex width; both share the var. The rail rides the container's left edge and
   visibly detaches from the cursor when the width pins (harness trace: rail at
   738px while pointer at ~160px).

9. **Composer internal observers** (Q8): the form RO (footer tier/compact) is
   the only one affecting probe inputs. The overlay RO adjusts height only;
   header RO flips a breakpoint switch — both can reflow main content during a
   drag but write no dock width.

## Causal chain (most probable root cause)

Fast widen drag → per-rAF `commitResizeCandidate` probes the LIVE composer →
rejects the first candidate past the current (drifting) boundary → no write →
panel freezes mid-gesture while the pointer continues; footer tier/compact
demotions then move the boundary → catch-up lurches before the final pin; the
pin point is the last accepted sample (speed-dependent). Release: flush uses
the same probe, still beyond the boundary → rejected → no write; suppression
removed; nothing animates. Perceived as "jerks back to the limit": the panel is
at a probe-derived limit, not under the cursor, and it lurched before settling.

## Minimal reproduction (to prove the live-boundary behavior)

Harness (rightDockSizing.browser.tsx pattern) with the REAL composer (footer +
data-chat-composer-* attrs) and the real shouldAcceptDockWidth probe:
- Test A: fast overshoot widen drag (8 × 55px steps); assert var pins at an
  accepted width, log shows the boundary drifting between frames (tier/compact
  interleaved with probes), and readVar() unchanged 5 frames after pointerup.
- Test B: log rail.getBoundingClientRect().left vs pointer clientX; assert the
  gap grows beyond first rejection (rail/cursor disconnect) and persists through
  release.
- Test C: slow 1px-step drag across the boundary; count accept/reject flips near
  the ±0.5 fudge margins (flutter) — runtime-only, plausible.

## Load-bearing facts for implementation

- Release call order (sidebar.tsx:640-644 → 628-638 → 499-533): pointerup →
  endResizeInteraction (suppressClick) → stopResize: cancel rAF → FLUSH via
  commitResizeCandidate (probe-then-write, forward-only) → remove suppression →
  persist/onResize (none for dock) → null ref → releasePointerCapture → body
  cleanup. Suppression removal is AFTER the flush, so the flush paints at 0ms.
- CSS var ownership: the wrapper's inline var; provider React style only resets
  on REMOUNT (drag width reset to open default).
- Probe returns true when no composer form exists (panelResize.ts:27-28) —
  during deferred mounts (ChatMountLoader) widening is bounded only by the
  geometric ceiling.
- Blast radius: rail primitive shared with the left sidebar (storage + own
  probe); probe change is dock-only; split panes use panelResize separately.
- Diagnostic scratch file must not become the production acceptance suite.