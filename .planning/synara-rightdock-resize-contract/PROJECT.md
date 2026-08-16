# Synara Right-Dock Resize "Jerk at Limit" — Plan & Evidence

Status: investigation + design complete (2026-08-16); implementation pending owner go-ahead.
Root cause: CONFIRMED. Fix contract: drafted. See SCOUT-EVIDENCE.md and DESIGNER-CONTRACT.md.

## Context

Owner-reported symptom (desktop app): dragging the right dock rail quickly past a
limit makes the panel "jerk back to the limit point" (giật về điểm limit).
Prior work in this area: commit 037425a2 (360px Main-conversation floor for the
dock), commit 7c3292b8 (release-flush of the final drag position).

## Verified root cause (see SCOUT-EVIDENCE.md for full evidence)

The composer feasibility probe (`canComposerHandlePanelWidth`,
apps/web/src/lib/panelResize.ts) is non-monotonic and stateful: it applies the
candidate width to the real wrapper, measures the live composer, and resets.
The composer footer adapts its layout (compact + tier demotion with hysteresis
via `syncComposerFooterLayout` / `resolveNextComposerFooterTier`, driven by a
ResizeObserver on the composer form) one frame AFTER each committed dock-width
change. The probe's acceptance boundary therefore drifts during a drag:
- the dock pins at the LAST ACCEPTED sample, not the true limit (e.g. 655px for
  a 700px limit);
- during fast drags the panel can take catch-up lurches as the boundary moves;
- the panel then freezes while the cursor keeps moving, and release changes
  nothing (verified: no width writer fires backward at release).

Verified in-repo (2026-08-16): composer RO → syncComposerFooterLayout →
setIsComposerFooterCompact + resolveNextComposerFooterTier exist in
apps/web/src/components/ChatView.tsx (~5386-5444, 1460, 422). NOTE: the scout's
cited path "components/chat/ChatView.tsx" is wrong; the file is
apps/web/src/components/ChatView.tsx. Line numbers otherwise match.

Six alternative hypotheses were refuted with evidence:
- no paint between probe apply/reset (fully synchronous);
- main flex column cannot refuse to shrink (all min-w-0, clamp ≤ shell-360);
- no unsuppressed width transition animates after release;
- no other --sidebar-width writer fires at/after release;
- the shell ResizeObserver does not fire on dock drags;
- the rail has no own-property change at release.

## Decisions pending owner confirmation

- D1: Replace the per-candidate live composer probe for the right dock with a
  conservative, monotonic constraint resolved from a layout snapshot at drag
  start (may stop a few px earlier than today's live acceptance island).
- D2: During an active drag, if shell/composer hard constraints tighten, clamp
  inward immediately (zero transition) — correctness over stationary feel.
- D3: If the composer constraint cannot be measured, fail closed for widening
  (keep narrowing allowed) for that gesture.

## Scope boundaries (do not change)

Left-sidebar resize semantics; mobile sheet (<768px); 360px Main floor; 416px
dock floor; half-shell default open width; shrink-only (never auto-grow);
split-view use of canComposerHandlePanelWidth; open/close disclosure motion
(must reuse apps/web/src/lib/disclosureMotion.ts conventions).

## Diagnostic scratch file

apps/web/src/components/chat/scratch-overshoot.browser.tsx is temporary
diagnostics only — DELETE once the acceptance suite covers the scenarios.