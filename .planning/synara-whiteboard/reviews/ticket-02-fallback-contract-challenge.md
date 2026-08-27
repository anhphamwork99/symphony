# Ticket 02 fallback contract challenge review

**Status: Challenge recorded — proposed fallback is awaiting owner approval**
**Date:** 2026-08-27
**Verdict:** The prior Ticket 02 contract is **not a safe drop-in replacement** after Decision 0054. The proposed dual-history contract is implementation-ready as a proposal, but it is not verified or authorized until the owner approves the deliberate product tradeoffs.
**Design under challenge:** [Ticket 02 proposed fallback contract](../designs/ticket-02-fallback-dual-history-contract.md)
**Authoritative boundaries:** [Decision 0053](../decisions/0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md), [Decision 0054](../decisions/0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md), [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md), current [product contract](../PRODUCT-CONTRACT.md), current [spec](../spec.md).
**Supporting inputs:** `/tmp/synara-ticket02-fallback-ux-result.md`, `/tmp/synara-ticket02-fallback-review-result.md`, and the recorded Ticket 02 Chromium gate failure.

> This review does not amend `PRODUCT-CONTRACT.md`, `spec.md`, decisions, source, tests, package resolution, or evidence. It records why the old contract cannot be dropped into Direction 4 and why the proposed rules are the minimum safe owner-approval boundary.

## 1. Review question and disposition

Can the existing single-route Ticket 02 contract be retained while Direction 4 intentionally leaves Excalidraw native human history active and adds Synara AI-batch recovery?

**No.** The existing contract requires one coherent user-visible route, a shared human/AI cursor, a combined 20-event cap, and a global Redo rule. Decision 0054 activates separate routes precisely because the supported public package surface cannot contain native history while preserving human capture. Keeping the old language would make mutually incompatible promises and would permit stale full-snapshot restores.

**Proposed disposition:** accept the challenge, review the fallback design with the owner, and keep all broad source work stopped. The proposal closes the blocking sequences by sacrificing unsafe cross-route continuity, not by inventing private package control.

## 2. Evidence that a drop-in replacement fails

| Challenge | Evidence | Consequence |
| --- | --- | --- |
| Native history cannot be selectively controlled | Excalidraw exposes public `history.clear()` but no public transaction, pause, disable, stack inspection, trim, or route-control API. The real Chromium probe observed native Undo enabled after a human Delete despite the public clear. | Synara cannot preserve native human capture while making native history a containment-only hidden route. |
| Existing prototype has one shared route | `SynaraSessionHistory` models one combined event array/cursor and generic Undo/Redo; the harness captures platform Undo/Redo before Excalidraw. | It conflicts with intentional package-owned human controls and must not be reused as a drop-in fallback contract. |
| Synthetic writes can publish callbacks | `captureUpdate: NEVER` keeps progressive updates out of ordinary native history, but public scene callbacks can still follow programmatic writes. | Fingerprint-only filtering can misclassify a real human ABA state or a delayed callback; a fence plus epoch/revision guard is required. |
| Full snapshots are destructive across routes | An AI `before`/`after` snapshot restores a whole document, not a safe merge/rebase. | AI Undo/Redo after later human work can erase that human work; native Redo after AI restore can replay a stale branch. |
| Native binary ownership is incomplete | Native history does not provide the `BinaryFiles` ownership needed to promise exact image Redo. | Native exact image behavior is a browser gate, not an unqualified fallback promise. |
| Native capacity is opaque | No supported public native stack count/cap/oldest-event eviction exists. | A combined “newest 20” claim cannot be made honestly. |
| Mounted instances have independent history | Native history belongs to the current Excalidraw instance, while a retained Synara coordinator could outlive a remount or eviction. | Both routes must share reset boundaries; otherwise advertised AI actions refer to a different editor/session. |

## 3. Blocking sequences and how the proposal closes them

### B1 — Stale native Redo after AI Undo

**Sequence:** `H1 → AI batch A1 → AI Undo → native Redo`

If AI restore uses `captureUpdate: NEVER` but leaves native history intact, native Redo can apply the old human branch to the AI-restored document. The result is not a visible-order Undo and can overwrite unrelated content.

**Proposed closure:** every successfully committed mutated AI batch, successful AI Undo, and successful AI Redo is an AI route boundary that clears **all** native Undo and Redo through supported `api.history.clear()` before the resulting state is exposed/unlocked. Native Redo cannot remain stale, and the unavoidable loss of native Undo is made explicit for owner approval. No selective native-stack claim is made.

### B2 — AI Redo overwrites later human work

**Sequence:** `A1 → AI Undo → human H2 → AI Redo`

A full `after` snapshot for A1 would erase H2. A merge or rebase is outside Direction 4 and would create a new product and implementation boundary.

**Proposed closure:** the first settled semantic human mutation after AI history exists clears all AI Undo and Redo. AI Redo is unavailable before it can overwrite H2, with the exact reason `Unavailable because manual edits started after the undone AI change.` No confirmation dialog pretends that a destructive restore is safe.

### B3 — AI Undo overwrites later human work

**Sequence:** `H1 → A1 → H2 → AI Undo`

The AI `before` snapshot predates H2 and would erase it. A current fingerprint is insufficient because an unrelated edit can produce the same bytes (ABA).

**Proposed closure:** the same first-settled-human-mutation rule clears the entire AI route, including AI Undo, and advances the human route epoch/revision. AI restore additionally requires canvas identity, mount identity, session epoch, route epoch, and expected revision; a matching fingerprint alone never authorizes restore.

### B4 — New AI batch after native Undo

**Sequence:** `H1 → A1 → native Undo → A2`

Native Undo is a semantic document mutation even though it is not a new drawing gesture. If it does not invalidate AI state, A2 can be captured against a state the AI coordinator considers to be on the old branch.

**Proposed closure:** native human Undo and native Redo count as settled semantic human mutations for cross-route invalidation. They clear all AI history and establish a new human route epoch/revision. A2 begins from that current post-command document and creates a fresh AI epoch.

### B5 — Native command during AI streaming

**Sequence:** `human history exists → start A1 → progressive AI update → Cmd/Ctrl+Z`

`captureUpdate: NEVER` prevents a progressive update from becoming an ordinary native history event, but it does not itself make an existing native command inert.

**Proposed closure:** while AI streams, restores, or rolls back, direct document mutation and both history routes are locked through the supported public edit/view boundary while pan/zoom remains available. The browser matrix attempts native toolbar, pointer, keyboard, and accessibility activation. If any native command mutates the document during the lock, the fallback gate fails and implementation remains blocked; no private key, DOM/CSS suppression, or monkey-patch is permitted.

### B6 — AI restore callback recorded as human history

**Sequence:** `AI Undo → addFiles/updateScene(NEVER) → onChange → host records human mutation`

Programmatic writes can produce public callbacks. A fingerprint set cannot safely distinguish synthetic and human writes, particularly with delayed callbacks and ABA states.

**Proposed closure:** every synthetic write runs under a restoring fence and operation generation; callbacks are accepted only when their canvas/mount/session/route epoch and expected revision match. `captureUpdate: NEVER` is mandatory for every synthetic scene write. Unknown or late provenance fails closed, keeps mutation/history locked, and produces diagnostics; it is never guessed as human or AI.

### B7 — Cancelled human gesture falsely destroys AI Redo

**Sequence:** `A1 → AI Undo → pointer gesture starts → intermediate callback → gesture cancels back to original state`

Invalidating on the first raw callback is safe against stale replay but breaks the no-op promise. Preserving history based on callback count is also unsafe.

**Proposed closure:** a raw callback is not an event. The coordinator requires a public settlement signal and semantic comparison for pointer, keyboard, and text-edit mutations. A proven semantic no-op preserves AI state; one settled semantic human mutation clears all AI state. If settlement or no-op status is uncertain, the conservative outcome is invalidation plus a diagnostic rather than risking stale recovery. Browser acceptance must cover multi-callback gestures, cancellation, Delete, and text editing.

### B8 — Native image Redo restores a reference without a binary

**Sequence:** `human image add/delete → native Undo → native Redo`

Native history can restore an element while its separately managed binary is unavailable or not meaningful for official export.

**Proposed closure:** AI route snapshots preflight and retain active binaries, call public `addFiles` before restore, and verify references plus SVG/PNG export. Native human image Undo/Redo remains a required real-Chromium gate. If it fails, the exact native image promise is narrowed or remains unaccepted; the proposal does not silently claim it.

### B9 — Native history exceeds 20 events

**Sequence:** `21+ human edits with no AI operation`

Synara cannot count, inspect, or evict only the oldest native event. Clearing after a guessed count would clear all history and still would not implement the requested guarantee.

**Proposed closure:** the proposal claims a 20-event cap only for finalized Synara AI-batch events. It makes no native cap or combined-cap claim. The browser matrix proves 21 AI events and explicitly does not treat 21 human events as a cap assertion.

### B10 — Canvas eviction/remount mismatch

**Sequence:** `A1 → canvas unmount/eviction → same document rehydrated → Redo AI batch`

The new Excalidraw instance has a new/empty native stack, while a retained AI coordinator could advertise a history belonging to a prior mount.

**Proposed closure:** reset both routes and increment `sessionEpoch` on remount, API/mount identity change, eviction, reload, restart, new identity, duplicate/import target, close/quit, and fault rehydration. Current durable content may restore through the existing persistence contract; history does not. A same-instance Main-conversation switch is not a canvas reset and only clears unsent chips/selection.

## 4. Review of the conservative keyboard resolution

The UX result proposed dedicated AI chords, while the independent review warned that wrapper-level capture competes with Excalidraw and external inputs. The owner-approval proposal resolves this conservatively:

- first release has **no dedicated AI keyboard chord**;
- AI actions are visible and explicitly labeled buttons;
- `Enter`/`Space` invoke a focused action and standard toolbar arrows/Home/End navigate;
- native `Cmd/Ctrl+Z`, native Redo, and text-edit/browser shortcuts remain entirely package/control-owned;
- Synara does not capture or stop native Undo/Redo events and declares no AI `aria-keyshortcuts`.

This closes the shortcut ambiguity without adding an undocumented route or making an external text field invoke AI recovery.

## 5. Required owner decisions

The owner must explicitly approve or reject the following before any implementation-boundary decision:

1. committed AI batch, AI Undo, and AI Redo boundaries clear all native Undo/Redo, including prior native Undo;
2. first settled semantic human mutation clears all AI Undo/Redo, including after AI Undo;
3. only AI history, not combined history, has a 20-finalized-event cap;
4. no dedicated AI keyboard shortcut ships in the first release;
5. native exact image Undo/Redo is a Chromium acceptance gate and may be narrowed if it fails;
6. both routes reset together on remount, reload, restart, close, eviction, and new identity;
7. no generic shared dispatcher, native stack inspection, private API, DOM/CSS suppression, remount restore, fork, package mutation, or lockfile/source change is introduced.

Until approval, existing product/spec/Ticket 02 acceptance language remains unchanged as historical current requirements, but no worker may claim that the old requirements are satisfied by this fallback proposal.

## 6. Review verdict

**DROP-IN REPLACEMENT: FAIL.** The former single-route contract is incompatible with the measured public Excalidraw boundary and unsafe for full-snapshot cross-route interaction.

**FALLBACK CONTRACT: PROPOSED, NOT YET ACCEPTED.** The proposed route ownership, epoch/revision checks, exact cross-route invalidation, synthetic fencing, AI-only cap, conservative keyboard policy, asset gates, and lifecycle resets close the known blocking sequences without changing source or silently weakening the product contract. Real Chromium must still prove the implementation after owner approval and a new bounded route is issued.

**Routing:** `awaiting-owner-fallback-contract-approval`.
