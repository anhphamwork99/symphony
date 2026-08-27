# Decision 0056: Authorize Ticket 02 WP-GATE only under the fallback dual-history plan

**Status:** Binding — implementation-boundary record; bounded WP-GATE execution authorized, all later work prohibited
**Date:** 2026-08-27
**Trigger:** Independent PASS re-review of the remediated fallback dual-history implementation plan
**Prior decision disposition:** Decision 0055's planning-only routing is superseded; its product model, preserved obligations, and prohibitions remain binding without change
**Reopens Decisions 0047, 0048, or 0050:** No

## Question

Does the remediated Ticket 02 fallback dual-history implementation plan, independently re-reviewed PASS, justify authorizing the first bounded work package — WP-GATE — and what exact writes, commands, commit ordering, pass/fail rules, and downstream routing does that authorization bind?

## Nature and authority of this decision

This is an **implementation-boundary record, not a new product choice**. The owner already approved the fallback product contract with `Đồng ý` through [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md). Decision 0055 authorized implementation planning only and required a later, separate implementation-boundary decision citing it and explicitly authorizing source work. This is that decision, and it authorizes **WP-GATE only**.

Nothing in this decision amends the owner-approved dual-route model, the six binding rules of Decision 0055, the preserved AI obligations, or any prohibition inherited from Decisions 0047, 0048, or 0050.

## Governing references

### Authoritative

1. [Decision 0055 — owner-approved fallback dual-history contract](0055-ticket-02-fallback-dual-history-contract-approved.md) (planning-only authority superseded by this record).
2. Remediated plan [Ticket 02 fallback dual-history implementation](../plans/02-fallback-dual-history-implementation.md) at main commit `43f4c7914` — binding for its §§2.1, 2.2, 3.2, 3.3, 4–6 content as incorporated here.
3. [Ticket 02 — Prove fallback dual-history Undo and Redo](../issues/02-prove-ai-batch-undo-redo.md), AC1–AC10.
4. [Decision 0047 — testing strategy governance reassessment](0047-testing-strategy-governance-reassessment.md).
5. Independent re-review PASS result at `/tmp/synara-ticket02-plan-rereview-result.md` (verdict: PASS — safe to recommend WP-GATE-only authorization; all prior B1–B4 and I1–I5 findings closed or honestly deferred).

### Supporting

- [Decision 0048 — Excalidraw feasibility boundary](0048-ticket-01-excalidraw-feasibility-boundary.md).
- [Decision 0050 — Ticket 01 accepted](0050-ticket-01-final-acceptance-hold-removed.md).
- [Decision 0051 — preserved historical single-route direction](0051-ticket-02-exact-batch-history-direction.md), as superseded by Decision 0055.
- [Decision 0052 — prior Gate timing failure and public-timing remediation exhaustion](0052-ticket-02-native-history-timing-probe.md), historical evidence.
- [Decision 0053](0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md), [Decision 0054](0054-ticket-02-public-history-boundary-research-failed-fallback-activated.md).
- [Accepted fallback design](../designs/ticket-02-fallback-dual-history-contract.md).
- Historical Gate evidence under `.planning/synara-whiteboard/evidence/ticket-02/` (`gate-containment.md`, `gate-browser.log`, `gate-failure.md`, `gate-timing-probe.md`) — read-only historical evidence of the failed containment assumption; never edited or reused as a verdict.

## Authorized scope: WP-GATE only

Exactly one work package is authorized: **WP-GATE**, the bounded feasibility proof defined by plan §6, using a deterministic fake operation producer with the real pinned Excalidraw `0.18.1` embed in stable Chromium.

### A. Exact allowed writes (plan §3.2, reproduced verbatim)

Deletion/rename of the superseded Ticket 02 prototype files is included. No asset pool, broad failure suite, lifecycle suite, native-image suite, production path, or future scaffold is permitted.

```text
apps/web/src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.tsx
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
apps/web/src/components/whiteboard/ticket02/SynaraDocumentSnapshot.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryTypes.ts                    # delete
apps/web/src/components/whiteboard/ticket02/SynaraHistoryCommands.ts                 # delete
apps/web/src/components/whiteboard/ticket02/SynaraSessionHistory.ts                   # delete
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts                 # replace
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx  # replace
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryActions.tsx
apps/web/src/components/whiteboard/ticket02/SynaraHumanMutationSettlement.ts
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.md
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.unit.log
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-b.browser.log
```

These sixteen paths and only these sixteen paths are the Gate write set. The three superseded prototype files are deleted, both Gate test files are replaced, the Ticket 01 adapter may change only as strictly necessary for the bounded synthetic write-scope and settlement observations, and the four evidence artifacts are created only through the protocol in part C below.

### B. Binding implementation contract

WP-GATE must implement plan §§4–5 exactly:

- delete the wrapper keyboard capture, generic undo/redo dispatcher, mixed human events, and fingerprint suppression before adding fallback assertions;
- deep canonical snapshot ownership per §4.1 (deep clone/freeze, semantic projection, no transient state, fingerprint is content-only);
- adapter-owned opaque synthetic write scopes per §4.2 (single mutation-capable scope, contiguous operation-local sequence, monotonic adapter-global synthetic sequence covering every synthetic write including restore, registration before public write, correlation by invocation order/sequence window/scope state/context rather than fingerprints, drain/close/tombstone semantics, fail-closed `unknown-callback-provenance`);
- the sequence/epoch/revision/applicability model per §4.3 with immutable event provenance separated from current command applicability;
- human settlement families per §5 (pointer gesture, discrete keyboard mutation, text-edit/composition, generic native-command candidate, presentation/no-op) with the common drain window — current task, microtasks, two animation frames with a callback-free second frame, bounded by the test-configured 500 ms maximum — settling exactly once per family.

Diagnostics follow §6.7: adapter/coordinator ownership split, serialized `synara.whiteboard.history-diagnostic/v1` schema, and the full required code list including `unknown-callback-provenance`, `native-history-reappeared-after-clear`, and `human-settlement-uncertain`.

The native-clear proof follows the §6.5 split: browser-observed initial-commit proof plus the test-only ordered clear invocation trace for AI Undo/Redo, with no test recreating native history between AI Undo and Redo while claiming the AI event remains actionable.

Runtime source has no native control locator. Browser tests may observe controls by stable accessibility role/name or use direct user shortcuts. The inherited Ticket 01 asset-readiness DOM observation is inherited behavior, not a new native-history-control dependency, and no new runtime DOM/CSS query may discover, suppress, invoke, or infer native Undo/Redo controls (plan §3.3).

### C. Exact source/evidence commit ordering and evidence commands (plan §6.8, binding)

#### C.1 Freeze the source candidate before measurement

1. Start from an isolated worktree.
2. Implement only the Gate source/tests of part A.
3. Review `git diff --check`, the changed-path inventory, and protected-path absence.
4. Commit source/tests **before** running any evidence command:

```text
feat(whiteboard): prove fallback dual-history gate
```

5. Record `SOURCE_CANDIDATE=$(git rev-parse HEAD)` and require `git status --short` to be empty. Any source/test/formatting change after this point creates a new candidate and requires all Gate runs again.

#### C.2 Run with pipefail, explicit exit capture, and distinct logs

Use Bash, not an unspecified shell pipeline. Do not overwrite or append one run into another.

```bash
set -o pipefail
bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-gate.unit.log
unit_status=${PIPESTATUS[0]}
printf 'UNIT_EXIT=%s\n' "$unit_status"
test "$unit_status" -eq 0

set -o pipefail
VITEST_BROWSER_API_PORT=<run-a-free-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-a.browser.log
run_a_status=${PIPESTATUS[0]}
printf 'RUN_A_EXIT=%s\n' "$run_a_status"
test "$run_a_status" -eq 0

set -o pipefail
VITEST_BROWSER_API_PORT=<different-run-b-free-port> bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraHistoryGate.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/fallback-gate.run-b.browser.log
run_b_status=${PIPESTATUS[0]}
printf 'RUN_B_EXIT=%s\n' "$run_b_status"
test "$run_b_status" -eq 0
```

Binding execution rules: both browser runs use the same `SOURCE_CANDIDATE` and a clean source tree, distinct free ports, and separate immutable log files; `tee` exit success never substitutes for the test process exit; the three exit values must be recorded in `fallback-gate.md`; one run's output is never overwritten or appended by another.

#### C.3 Evidence-only commit after measurement

`fallback-gate.md` records the source SHA, package/pin/lock provenance, Chromium/OS/architecture, commands and exits, run-A/run-B log hashes, public APIs used, the inherited Ticket 01 asset-readiness DOM query, proof that no new runtime control selector exists, the scenario matrix, scope/sequence traces, settlement traces, the native-clear split proof, diagnostics, and the bounded verdict.

After logs and the document are complete, confirm the diff contains only the four authorized Gate evidence files, then commit:

```text
test(whiteboard): record fallback dual-history gate evidence
```

This evidence-only commit names the measured source SHA. Evidence changes never alter the measured candidate. If evidence reveals a source defect, do not patch in the evidence commit: create a new source candidate and rerun unit, run A, and run B.

## Binding pass/fail/stop rules

A passing checkpoint may state only the §6.9 bounded verdict: `FALLBACK WP-GATE: BOUNDED FEASIBILITY PASS` naming the measured source candidate, with the isolated-harness PASS rows (native route ownership, AI lock, completed fake-produced batch exactness, opaque synthetic write-scope correlation, initial AI commit browser-observed native clear, AI Undo/Redo ordered clear invocation trace, public human settlement families, adapter identity stability), the explicit `DEFERRED — NOT CLAIMED` rows for production WebSocket/real operation evidence and production lifecycle-trigger evidence, and `NON-AUTHORIZED — GOVERNANCE REASSESSMENT REQUIRED` for later work packages.

**Gate PASS requires:** every required settlement family (pointer, Delete, text edit, native toolbar Undo/Redo, cancelled pointer, selection, pan, zoom, tool, focus) settles reliably changed/no-op across the full §6.6 scenario matrix in two stable-Chromium runs on one exact candidate without an uncertainty diagnostic; the complete §6.6 scenario matrix passes (native route ownership, AI lock with pan/zoom retention, three progress writes → one event, exact AI Undo/Redo, split native-clear proof, duplicate/delayed/stale/extra/unknown callback rejection, adapter identity stability); `git diff --check` is clean; the changed-path inventory equals part A; no protected path changed; unit/run-A/run-B exits are all 0 with matching candidate provenance.

**Gate FAIL — preserve reproducible evidence, stop, and return to the Supervisor/owner; do not scaffold later WPs:** any failed scenario row; uncertainty in a required settlement family; unknown callback provenance; native-history reappearance after the bounded clear drain; inability to lock native mutation during AI lock; any pipeline/log/candidate mismatch (non-zero unit, run-A, or run-B exit; wrong candidate; unclean tree; overwritten or shared logs); any prohibited technique from part D; any protected-path change; or a need to cross any §2.2 prohibition — a need to cross a prohibition is a `BLOCKER`, not implementation-time discretion.

No AC claim is made on PASS. A passing Gate establishes only bounded feasibility evidence for isolated adapter/coordinator semantics; fake completion is not production operation completion, and simulated operation signals are not production WebSocket, Take Over acknowledgement, invalid/dependent-operation, or lifecycle-trigger proof.

## No-acceptance claim

Decision 0056 and WP-GATE claim **no** acceptance:

- No Ticket 02 acceptance criterion (AC1–AC10) is claimed passed or accepted. Plan §13's ownership matrix remains binding: AC2, AC7, AC8, and AC10 are not finalizable by the Gate; the remaining ACs receive at most bounded partial Gate evidence.
- Ticket 02 final acceptance remains a later exactly-once Supervisor consultation after authorized integrated implementation, real-Chromium verification, and one independent feature-level review.
- No `bun fmt`, `bun lint`, or `bun typecheck` completion claim exists under this authorization; the later final verification pass requires its own decision.

## Deferred Decision 0047 integrated evidence

Decision 0047 remains OPEN BY DESIGN. This decision does not resolve, weaken, or waive it:

- WP-GATE supplies only bounded feasibility evidence from an isolated harness with a deterministic fake producer. It cannot prove the Decision 0047 integrated paths — the real web application composed with the production WebSocket route, real operation contracts, and actual Excalidraw embed — or the production lifecycle triggers required by AC7.
- Before any outcomes/failure AC claims, a post-Gate governance reassessment must decide and authorize the production WebSocket/browser seam, the exact server/contract/web write set if required, and the production lifecycle boundary that owns real reset triggers. Harness-injected lifecycle signals prove only coordinator reset semantics under simulated signals.
- Until that boundary exists and passes, AC2, AC7, AC8, and AC10 remain unclaimed, and the `production-lifecycle-trigger-missing` and other §12 transport diagnostics remain deferred to their production owners.

## Prohibited under this decision

All prohibitions of Decisions 0055, 0047, 0048, and plan §2.2 continue in force. In particular:

1. **No later work packages.** WP-OUTCOMES-ASSETS-FAILURE (plan §7), WP-CAP-LIFECYCLE (§8), WP-ACCESSIBILITY (§9), WP-NATIVE-IMAGE-GATE (§10), and final integration/evidence/review/workspace gates (§11) are all non-authorized and require post-Gate governance reassessment before any of them starts. No later-WP scaffold or unused future file may be created.
2. **No production integration.** No production WebSocket wiring, server orchestration, navigation, RightDock, Whiteboard header/status rail, launcher, tabs, persistence, lifecycle stores, or production Focus-mode composition. No production Take Over triggers, invalid/dependent operation transport, application restart, duplicate/import, eviction, conflict replacement, or recovery hydration.
3. **No final claims.** No AC2/AC7/AC8/AC10 claim, no Ticket 02 acceptance, no Decision 0047 integrated-path completion, no native image gate verdict, no native capacity/grouping/20-event-cap claim, no native exact-image recovery claim before the later native-image gate passes.
4. **No final review or Supervisor acceptance.** The independent feature-level review and the exactly-once Supervisor final-acceptance consultation remain later authorized boundaries; a Gate review, if any, is not them.
5. **No package/lockfile work.** No adding/changing any package, no Excalidraw upgrade, no manifest/lockfile/config change, no modification of the pinned `@excalidraw/excalidraw@0.18.1` resolution.
6. **No protected Agentation work.** No changes to `apps/web/package.json`, `apps/web/src/main.tsx`, `bun.lock`, any `**/package.json`, `apps/web/vitest.browser*.config.ts`, `apps/server/**`, `packages/contracts/**`, `packages/shared/**`, or any other path in plan §3.3's protected/prohibited list, including all planning paths outside the four Gate evidence artifacts (notably `.planning/synara-whiteboard/PROJECT.md`, `issues/**`, `decisions/**`, `designs/**`, `reviews/**`, `PRODUCT-CONTRACT.md`, `spec.md`, and `evidence/ticket-01/**`), production RightDock/navigation/store/header/launcher paths, and all Ticket 03+ source/tests/plans/evidence. Unrelated Agentation working-tree changes must be preserved, never committed or reverted.
7. **No prohibited techniques.** No private APIs/imports, ActionManager/History internals, native-stack inspection, undocumented action keys, DOM/CSS suppression, monkey-patching, package mutation, remount restore, or fork. No hiding, relabeling, duplicating, intercepting, or replacing native Excalidraw controls, and no capturing, reinterpreting, or advertising an AI keyboard chord. No generic history dispatcher, combined event array, mixed cursor/panel, or Synara-owned human event history. No first-use education under the Gate.
8. **No workspace gate commands.** `bun fmt`, `bun lint`, and `bun typecheck` are prohibited under this authorization; they require an explicit later full-implementation boundary decision (plan §11.3).

A need to cross any prohibition is a `BLOCKER`, not implementation-time discretion.

## Downstream routing

### On Gate PASS

Project and Ticket 02 route to a post-Gate reassessment boundary, not to any later WP. The next step is a governance/implementation decision that cites Decision 0056 plus the Gate evidence, and decides/authorizes (or explicitly defers) the production WebSocket/browser seam, the exact server/contract/web write set, the production lifecycle boundary, and whether any later WP may begin. No later WP may start from a PASS alone; §§7–11 remain non-authorized until that decision exists.

### On Gate FAIL

Stop immediately, preserve reproducible evidence, and return to the Supervisor/owner. Do not scaffold later WPs, do not retry prohibited techniques, and do not patch the evidence commit; if a source defect is identified, create a new source candidate and rerun unit, run A, and run B. Routing remains `active-fallback-wp-gate` until the Supervisor/owner resolves the failure boundary (failures may narrow AC6/leave claims unaccepted where plan §10 so provides).

## Routing consequence (this record)

Project and Ticket 02 routing advances to:

```text
active-fallback-wp-gate
```

This routing means: exactly WP-GATE, under the write set, commit ordering, evidence protocol, and pass/fail/stop rules of this record, with all later work packages, production integration, final claims, final review/acceptance, package/lockfile work, protected Agentation WIP, and workspace gate commands remaining prohibited.

## Traceability

- Implementation-boundary record required by: [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md).
- Plan authority: [fallback dual-history implementation plan](../plans/02-fallback-dual-history-implementation.md) at `43f4c7914`, independently re-reviewed PASS at `/tmp/synara-ticket02-plan-rereview-result.md`.
- Owner product authority: the owner's `Đồng ý` recorded in Decision 0055; no product choice is made here.
- Testing governance: [Decision 0047](0047-testing-strategy-governance-reassessment.md), preserved open-by-design for the integrated paths.
- Historical containment evidence: [Decision 0052](0052-ticket-02-native-history-timing-probe.md) and the historical `gate-*` artifacts under `.planning/synara-whiteboard/evidence/ticket-02/`.
