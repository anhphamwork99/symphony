# Decision 0055: Approve Ticket 02 fallback dual-history contract

**Status:** Binding — owner-approved product amendment; implementation planning authorized, source implementation not authorized
**Date:** 2026-08-27
**Trigger:** Owner approval of all six fallback dual-history rules
**Supersedes:** The incompatible history clauses identified below in Decision 0051, Ticket 02, `PRODUCT-CONTRACT.md`, and `spec.md`
**Reopens Decisions 0047, 0048, or 0050:** No

## Question

Following Decision 0054's failed public-history boundary research, does the owner approve the proposed fallback contract for separate Excalidraw-native human history and Synara-owned AI-batch history, and may the project advance to bounded implementation planning?

## Owner authority and governing references

The owner explicitly replied **`Đồng ý`** in the current session to all six rules proposed in [the Ticket 02 fallback dual-history contract](../designs/ticket-02-fallback-dual-history-contract.md). That owner approval is the authority for this product amendment.

Authoritative references:

1. [Decision 0054 — public-history boundary research failed](0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md).
2. [Decision 0053 — owner-authorized package/public-API reassessment](0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md).
3. [Decision 0051 — original exact-batch history direction](0051-ticket-02-exact-batch-history-direction.md), preserved as historical record except where this decision expressly supersedes it.
4. [Approved fallback contract](../designs/ticket-02-fallback-dual-history-contract.md).
5. [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md).
6. The amended [Product Contract](../PRODUCT-CONTRACT.md) and [agent-ready specification](../spec.md).

## Binding approved model

The following six rules are accepted as one inseparable fallback contract:

1. **Committed AI boundary clears all native history.** Every successfully finalized semantically mutated AI batch, and every successful `Undo AI batch` or `Redo AI batch` restore, clears all native Excalidraw Undo and Redo through the supported public `api.history.clear()` boundary before the resulting state is exposed or unlocked. This deliberately loses prior native Undo as well as native Redo.
2. **First settled semantic human mutation clears all AI history.** After an AI batch or AI-history action, the first settled semantic human mutation—including native human Undo and native human Redo—clears the entire Synara AI Undo and Redo history, releases unreferenced AI snapshot assets, and records the explicit unavailable state. Proven no-ops and presentation-only changes do not clear AI history; uncertainty is handled conservatively and diagnostically.
3. **Only AI history has a 20-event cap.** Synara retains at most 20 finalized AI-batch events per open canvas session. Event 21 evicts only the oldest AI event. Native human history capacity, grouping, and eviction remain package-defined and unclaimed.
4. **No dedicated AI keyboard shortcut in the first release.** `Undo AI batch` and `Redo AI batch` are visible, explicitly labeled, keyboard-accessible Synara actions. Native Excalidraw toolbar and platform keyboard behavior remain package-owned. Synara does not capture, reinterpret, or advertise an AI keyboard chord.
5. **Native image history is a real-Chromium acceptance gate.** Native human image Undo/Redo must prove meaningful file-reference recovery and official SVG/PNG export in stable Chromium against the pinned package. If that proof fails, the native exact-image promise is narrowed or left unaccepted before implementation acceptance. AI image recovery remains exact under the approved asset preflight, `addFiles`, restore, and verification contract.
6. **Lifecycle resets clear both histories.** Remount, API or mount identity change, eviction, reload or fresh hydration, application restart, close/session termination, duplication or import as a new identity, conflict replacement, and recovery hydration reset both native and AI history. Current durable content may follow the existing persistence contract; history is session-only and never restored.

The routes remain deliberately separate:

- Excalidraw owns native human Undo/Redo, including its native toolbar and package-supported platform shortcuts.
- Synara owns only the explicitly labeled `Undo AI batch` and `Redo AI batch` actions and their immutable AI snapshots.
- No shared stack, shared cursor, combined event list, generic history dispatcher, or unified mixed-history presentation is claimed.
- A committed AI boundary never invokes native Undo/Redo, and native Undo/Redo never invokes AI snapshots.

## Preserved AI obligations and prohibitions

Decision 0055 changes the mixed human/AI history boundary only. It does not weaken or remove these obligations:

- A completed, acknowledged Take Over interruption, or failed-partial AI batch with valid semantic mutations is exactly one AI-batch event.
- Progressive AI updates are not individually user-visible history events.
- Zero-mutation, zero-valid, semantic no-op, pre-batch capture failure, or successful rollback outcomes consume no AI event and do not silently alter history.
- AI Undo and Redo restore the verified semantic scene and active image/file references, with public `addFiles`, `captureUpdate: "NEVER"`, semantic verification, deterministic cursor movement, and explicit rollback or locked-fault diagnostics.
- Valid partial work remains visible after interruption or failure; invalid operations and dependent operations are not applied.
- No durable Version history is introduced. Both histories are in-memory session state only.
- No private API, private import, undocumented action key, native-stack inspection, DOM/CSS suppression, monkey-patching, package mutation, remount restore, fork, package upgrade, or lockfile change is permitted.
- No empty-scene hydration, silent asset loss, discarded unsaved content, false success, or source implementation before a separate bounded implementation route is accepted.

## Precise supersession

Historical Decisions 0051–0054 remain preserved and citable. Decision 0055 supersedes only the incompatible clauses below:

| Prior clause | Decision 0055 replacement |
| --- | --- |
| Decision 0051 D1/D2 and its sole-effective Synara route for human and AI history | Native Excalidraw owns the human route; Synara owns the explicit AI route. Public-only operation, no private/undocumented integration, and no competing AI/native invocation remain mandatory. |
| Decision 0051 D6 and D8 step 1's requirement to convert representative human mutations into one Synara route before mixed-history proof | Human pointer, keyboard, text-edit, toolbar, Undo, and Redo behavior is proved as package-native behavior; AI batches are proved on their separate Synara route. |
| Decision 0051's shared coordinator array/cursor and combined 20-event requirement | AI history has its own session-only coordinator and 20-event cap. Native history has package-defined capacity with no Synara cap or exact native-stack claim. |
| Decision 0051's global “new edit after Undo” branch rule | The first settled semantic human mutation clears all AI history. A new mutated AI batch after AI Undo clears only the AI Redo branch. Native package branching remains native. |
| Ticket 02 AC4's one coherent toolbar/keyboard route | Native package controls and shortcuts remain human-owned; only explicit labeled Synara AI actions operate AI history; no first-release AI shortcut exists. |
| Ticket 02 AC6 and corresponding Product Contract/spec promises of one shared 20-event history | Separate native-human and AI-batch histories apply, with only the AI cap and the lifecycle reset rules in this decision. |
| Any unqualified native exact-image Undo/Redo promise | Native exact image recovery is conditional on the real-Chromium gate; AI image recovery remains exact under its separate public restore contract. |

Clauses in Decisions 0051–0054 concerning AI batch exactness, assets, failures, no-ops, Take Over containment, session-only history, public APIs, and prohibitions remain binding unless expressly changed above.

## Planning-only authorization and routing

This decision authorizes the next bounded phase: **implementation planning for the approved fallback contract**. Planning may define the work-package boundaries, browser scenarios, diagnostics, and verification order required by this decision.

This decision does **not** authorize:

- runtime source, tests, package manifests, lockfiles, or evidence-log changes;
- package upgrades, private or undocumented integration, production navigation, or broad Ticket 02 implementation;
- claiming that the fallback acceptance criteria or native image gate have passed;
- WP-CORE or later-ticket implementation;
- changing protected Agentation work.

Project and Ticket 02 routing is now:

```text
ready-for-fallback-implementation-planning
```

A later, separate implementation-boundary decision must cite Decision 0055, approve the bounded plan, and explicitly authorize source work. Ticket 02 final acceptance remains a later exactly-once consultation after implementation, real-Chromium verification, and independent feature-level review.

## Traceability

- Owner approval: current-session `Đồng ý` for all six rules.
- Previous activation: [Decision 0054](0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md).
- Approved design: [Ticket 02 fallback dual-history contract](../designs/ticket-02-fallback-dual-history-contract.md).
- Implementation planning target: [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md).
