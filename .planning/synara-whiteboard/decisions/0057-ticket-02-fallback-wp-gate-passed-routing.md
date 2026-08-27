# Decision 0057: Record Ticket 02 fallback WP-GATE PASS and route to post-Gate governance reassessment

**Status:** Binding — bounded Gate result and routing record; no later work package authorized
**Date:** 2026-08-27
**Trigger:** Exact-candidate WP-GATE evidence plus independent remediation re-review PASS
**Prior decision disposition:** Decision 0056's WP-GATE execution authority is fulfilled; its product boundaries, prohibitions, no-acceptance rule, and post-Gate routing remain binding
**Reopens Decisions 0047, 0048, or 0050:** No

## Question

Did the Decision 0056 fallback WP-GATE pass its bounded feasibility checkpoint, and what may happen next?

## Decision

The Ticket 02 fallback WP-GATE is recorded as:

```text
FALLBACK WP-GATE: BOUNDED FEASIBILITY PASS
Measured source candidate: a483ed6a3e3d6fe832250c1ab170f7a350268feb
```

This establishes only the isolated-harness feasibility described by Decision 0056 and plan §6. It does not authorize production integration or any later work package, and it does not pass or accept any Ticket 02 acceptance criterion.

Project and Ticket 02 routing advance from:

```text
active-fallback-wp-gate
```

to:

```text
awaiting-post-gate-governance-reassessment
```

## Evidence and provenance

### Measured candidate and evidence

- Source candidate: `a483ed6a3e3d6fe832250c1ab170f7a350268feb`
  - subject: `feat(whiteboard): prove fallback dual-history gate`
- Evidence-only commit: `f58646db73a905db68bce07860d5cc7302d6870f`
  - subject: `test(whiteboard): record fallback dual-history gate evidence`
- Main integration merge: `7572a27dc`
  - preserves both measured commit identities in main history
- Evidence document:
  - [fallback-gate.md](../evidence/ticket-02/fallback-gate.md)
- Immutable logs:
  - `fallback-gate.unit.log`
  - `fallback-gate.run-a.browser.log`
  - `fallback-gate.run-b.browser.log`

### Exact-candidate runs

All runs used source candidate `a483ed6a3e3d6fe832250c1ab170f7a350268feb`, a clean source tree, Bash `pipefail`, explicit `PIPESTATUS[0]`, separate logs, and distinct browser ports:

- Unit: exit `0`, 18/18 tests passed.
- Stable Chromium run A, port `52477`: exit `0`, 4/4 tests passed.
- Stable Chromium run B, port `52488`: exit `0`, 4/4 tests passed.

The evidence records and hashes all three logs. The source range contains exactly the twelve Decision 0056 source/test paths; the evidence commit contains exactly the four authorized evidence paths. Protected package, lockfile, Agentation, server, contracts, shared, production integration, and later-WP paths were absent.

## Independent review disposition

The first independent Gate review returned `NEEDS REMEDIATION` because plan §6.6 required AI Undo by pointer and AI Redo through Enter/Space, while the first browser candidate clicked Redo and the first evidence wording silently narrowed the scenario. It also requested an explicit accessible-activation attempt during AI lock.

The remediation:

- kept AI Undo as pointer activation;
- focused the available `Redo AI batch` button and activated it with Enter, with no Redo pointer event;
- focused the guarded `Undo AI batch` action during AI lock, pressed Enter and Space, and proved no document mutation;
- changed only the authorized browser Gate test after the prior candidate;
- created a new source candidate and reran unit, Chromium A, and Chromium B from the beginning;
- replaced, rather than patched, the superseded evidence history.

The independent re-review returned `PASS` with high confidence. It directly inspected the code and commit graph, recomputed hashes, reran the focused unit suite and an additional stable-Chromium run on the measured candidate, and confirmed that the prior finding was closed without new scope or prohibited techniques.

## Bounded findings established by the Gate

Within the isolated real-Excalidraw harness and deterministic fake producer, the Gate supports these bounded findings:

- native human history remains package-owned;
- Synara exposes separate explicit AI history actions;
- package-supported AI lock prevents human document mutation while retaining pan and zoom;
- three synthetic progress writes remain zero user-visible events until completion and finalize as one AI event;
- AI Undo and Redo restore exact canonical before/after scenes;
- opaque synthetic callback scope correlation rejects stale, duplicate, delayed, extra, and unknown provenance fail-closed;
- initial AI commit clears native history in the real Chromium harness;
- AI Undo/Redo execute the required ordered native-clear invocation trace;
- required public human-settlement families settle changed or no-op without uncertainty;
- adapter identity remains stable across the bounded scenario;
- keyboard/accessibility activation required by plan §6.6 is exercised.

These findings remain bounded to the Gate fixture. Fake operation completion is not production operation completion.

## Explicitly deferred and unclaimed

The following remain `DEFERRED — NOT CLAIMED`:

- production WebSocket and real operation-contract evidence;
- real Take Over acknowledgement and partial-failure semantics;
- production invalid/dependent-operation handling;
- production lifecycle-trigger ownership and reset evidence;
- asset preflight, image restore/export, and native image acceptance;
- the 20-event AI cap and eviction;
- production accessibility, constrained-width, Focus-mode, and announcement behavior;
- final integrated evidence and workspace gates.

No Ticket 02 acceptance criterion (AC1–AC10) is passed or accepted by this decision. Decision 0047 remains open by design. This is not the independent feature-level review and not the exactly-once Supervisor final-acceptance consultation.

## Non-invalidating evidence notes

- The three raw Vitest logs end with the blank line emitted by the test process. Their evidence-commit diff therefore reports `new blank line at EOF`; the logs were not normalized after capture, and their recorded hashes match the committed bytes. The source-candidate `git diff --check` was clean.
- The isolated worktree used a disclosed `node_modules` symlink to an existing install. The package manifest pin, lock integrity, and resolved on-disk `@excalidraw/excalidraw` version all matched `0.18.1`. No package or lockfile was changed.

Neither note changes the bounded verdict.

## What remains prohibited

Until a later governance/implementation decision explicitly authorizes a write set, all Decision 0056 prohibitions continue:

- no WP-OUTCOMES-ASSETS-FAILURE;
- no WP-CAP-LIFECYCLE;
- no WP-ACCESSIBILITY;
- no WP-NATIVE-IMAGE-GATE;
- no production WebSocket, lifecycle, persistence, navigation, RightDock, header, launcher, or Focus-mode integration;
- no package or lockfile changes;
- no final AC claim, Ticket 02 acceptance, feature-level review, or Supervisor acceptance;
- no `bun fmt`, `bun lint`, or `bun typecheck` completion claim under the Gate boundary.

## Required next decision

The next step is a post-Gate governance reassessment, not implementation. That decision must cite Decisions 0055–0057 and decide:

1. the production WebSocket/browser seam for real operations;
2. the exact server, contracts, shared, and web write set, if any;
3. the production lifecycle owner for reset triggers;
4. whether WP-OUTCOMES-ASSETS-FAILURE may begin, remain deferred, or be split;
5. how Decision 0047's integrated-browser evidence requirement will be satisfied;
6. which protected concurrent work must remain excluded.

No implementation may infer authorization from this PASS record alone.

## Traceability

- Product authority: [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md).
- WP-GATE authority and stop rules: [Decision 0056](0056-ticket-02-fallback-wp-gate-authorization.md).
- Binding implementation plan: [Ticket 02 fallback dual-history implementation](../plans/02-fallback-dual-history-implementation.md), §§4–6.
- Gate evidence: [fallback-gate.md](../evidence/ticket-02/fallback-gate.md).
- Ticket: [02 — Prove fallback dual-history Undo and Redo](../issues/02-prove-ai-batch-undo-redo.md).
