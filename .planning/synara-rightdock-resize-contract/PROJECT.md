# Synara Right-Dock Resize "Jerk at Limit" — Plan & Evidence

Status: contract OWNER-APPROVED; implementation + remediation COMPLETE
(2026-08-16). Independent review blocker CLOSED: all review behavior criteria
PASS; the sole rejection reason — TS2484 (duplicate export in
apps/web/src/components/ui/sidebar.tsx) — and the subsequent TS2375 apps/web
typecheck blocker are fixed. Final acceptance is COMPLETE with binding verdict
`accepted-with-recorded-nonblocking-risks`; see
`decisions/0001-final-acceptance.md`. The initial stale-checkout
Advisory/not-ready did not consume acceptance and is superseded by that record.
Root cause: CONFIRMED. See SCOUT-EVIDENCE.md and DESIGNER-CONTRACT.md.
Route: IMPLEMENTATION-BRIEF.md (implementation runbook),
issues/01-implementation-review-remediation.md (review + remediation closure),
FINAL-VERIFICATION.md (final verification evidence).

## Implementation review — CLOSED (2026-08-16)

Independent review reproduced 26/26 focused unit tests green and the Right-Dock
browser suite at 14/15 with AC-12 red, and additionally found active-session
shell-shrink and rerender lifecycle defects (findings F1/F2/F5, test gaps
TG-1–TG-5). All review behavior criteria (R1–R10, AC-01–AC-12) now PASS; the
original verdict `rejected` stood solely on TS2484 (duplicate export in
apps/web/src/components/ui/sidebar.tsx), which is fixed, and the subsequent
TS2375 apps/web typecheck blocker is fixed as well. Remediation is closed —
findings F1–F6 and test gaps TG-1–TG-5 are resolved with stable coverage, and
the final focused verification is green (see FINAL-VERIFICATION.md). Binding
final acceptance is recorded in `decisions/0001-final-acceptance.md`.

Remediation was routed through
[`issues/01-implementation-review-remediation.md`](issues/01-implementation-review-remediation.md),
which owns findings F1–F6, test gaps TG-1–TG-5, focused verification, and the
implementer/reviewer report records. Implementation is routed through
[`IMPLEMENTATION-BRIEF.md`](IMPLEMENTATION-BRIEF.md) (authoritative runbook).
Binding decisions D1–D3, the final behavior contract, owner decisions, and
scope boundaries remain unchanged.

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

## Product intent (owner clarification, 2026-08-16 — binding)

- The "chat panel" is the Main conversation; dragging the right-dock divider
  left makes Main narrower.
- Main has exactly ONE minimum width: **360px**.
- Right-dock resize carries NO composer feasibility probe/constraint/ceiling of
  any kind on the drag path — not the live probe, and not a snapshot substitute.

## Decisions — binding contract (OWNER-APPROVED 2026-08-16)

- D1 (BINDING): remove the per-candidate live composer probe from the right-dock
  drag path entirely. The dock's only max is the geometric ceiling
  `sessionMax = max(0, shellWidth - 360)`; the only min is
  `sessionMin = min(416, sessionMax)` (Main floor 360px; 416px dock floor while
  the shell affords it). If the shell is undersized (shellWidth < 360) the
  bound degenerates to 0px — arithmetic safety, NOT a second Main limit; for
  standard shells (shellWidth ≥ 360) Main's floor is exactly 360px.
- D2 (BINDING): pointermove clamps and commits synchronously against the frozen
  geometric session bounds; release never re-evaluates or changes geometry.
  If the shell shrinks mid-drag, update the active session max inward to
  `max(0, newShellWidth - 360)` (recompute the session min only when needed to
  keep `min ≤ max`; never outward), clamp inward synchronously (zero
  transition), and freeze the replacement bound for the gesture. There is no
  composer-mutation safety path — composer layout changes do not affect dock
  geometry.
- D3 (BINDING): no composer-derived behavior remains in the dock path — no
  snapshot measurement, no caching/invalidation, no failure mode.
  `canComposerHandlePanelWidth` stays in the codebase for split-view callers
  only, unchanged.

### Superseded decisions (historical record only — NOT part of the active contract)

An earlier draft of this contract (2026-08-16) proposed replacing the live probe
with a conservative composer-derived snapshot bound resolved at drag start, an
immediate inward clamp if shell/composer constraints tightened mid-drag, and a
widening-block fallback when the composer constraint could not be measured.
The owner clarification above supersedes all of those decisions: the dock
contract contains no composer-derived bound, measurement, cache, or failure
mode. The root-cause evidence that motivated the draft remains valid and is
retained in SCOUT-EVIDENCE.md — its product implication is removal of composer
feasibility from the right-dock path, not replacement with another composer
ceiling.

## Scope boundaries (do not change)

Left-sidebar resize semantics; mobile sheet (<768px); 360px Main floor; 416px
dock floor; half-shell default open width; shrink-only (never auto-grow);
split-view use of canComposerHandlePanelWidth; open/close disclosure motion
(must reuse apps/web/src/lib/disclosureMotion.ts conventions).

## Diagnostic scratch file

apps/web/src/components/chat/scratch-overshoot.browser.tsx (temporary
diagnostics) was DELETED during implementation (2026-08-16), per
IMPLEMENTATION-BRIEF.md, once the acceptance suite covered the scenarios.
