# Decision 0011 — Ticket 06 final acceptance (durable parent-turn cancellation)

## Status

**accepted** (binding; Decisions 0001–0010 remain authoritative and unchanged)

**Date:** 2026-08-18

## Accepted candidate

- Symphony implementation commit `df38bfcb40c6c0504f82f6874a8089181cd9af08` (`df38bfcb`) plus review-remediation commit `f92ad1943a89b1b7377b94e1bd1b4b9069154057` (`f92ad194`; review disclosures, report-count correction, and dead-export removal).
- Alfie `53f84bb56fc01f81d516670828902ce66159289f` (`53f84bb56`; `@alfie/pi-subagents@0.12.0-alfie.1`, capability `durable-cancellation`).
- `piSubagentExtensionProvenance.json` pins Alfie `53f84bb56fc01f81d516670828902ce66159289f`, version `0.12.0-alfie.1`, and SHA-256 hashes for `package.json`, `src/index.ts`, and `src/agent-manager.ts`. The independent reviewer verified the pin byte-for-byte.

## Question

Does the Ticket 06 candidate at Symphony `df38bfcb` + `f92ad194` and Alfie `53f84bb56` satisfy T06-AC1 through T06-AC7 under the owner-approved Testing Seams and Decisions 0001–0010, such that this decision accepts Ticket 06, records F1/F3/F4 as nonblocking downstream risks, and advances the blocker-free frontier to Ticket 07?

## Governing references

Project Home; Issue 06 (normative T06-AC1..T06-AC7, owner-approved Testing Seams, complete Implementation Report, review disclosures, and independent-review outcome); Decisions 0001–0010, including the durable-handle architecture, `parent_turn` cancellation scope, evidence-before-`cancelled` rule, fail-closed admission model, and lease re-derivation obligation; Specification Implementation Decisions 6, 7, 10, 11, 14, 25, and 26; Issue 07 for the next dependency-ordered frontier; Issues 10, 13, and 15 for downstream ownership of the accepted risks.

The approved Testing Seams are binding for evidence placement and are not reopened by this decision.

## Lifecycle honored

Ticket 24 accepted and Ticket 06 unblocked by Decision 0010 → implementation at Symphony `df38bfcb` and Alfie `53f84bb56` → complete Implementation Report in Issue 06 → exactly one independent feature-level review on 2026-08-18 (PASS WITH GAPS, high confidence, all seven criteria passing with direct or reproducible evidence) → review remediation at Symphony `f92ad194` for F2/F5 and disclosure recording for F1/F3/F4 → one Project Supervisor final-acceptance consultation (activation class 2) → ACCEPT.

## Settled verdict — **Accept Ticket 06. T06-AC1 through T06-AC7 all pass.**

- **T06-AC1 (durable intent before dispatch; replay idempotency): PASS** — `recordCancellationIntent` appends deterministic sequence-90 `cancelling` intent before bridge dispatch and advances desired state without prematurely claiming terminal cancellation. The command identity is deterministic for execution, attempt, generation, and parent thread. Terminal replay produces no new cancellable row. A non-terminal replay may re-dispatch the same command, but durable intent remains deduplicated and Alfie's identity fencing and already-aborted/already-terminal handling prevent a repeated child-abort effect. Coordinator evidence covers journal-before-dispatch ordering and intent deduplication; real-Pi replay evidence proves no additional cancelling/cancelled journal rows after settlement.

- **T06-AC2 (all parent-turn-scoped children in both transport modes): PASS** — `listCancellableByParentTurn` selects non-terminal managed executions in the matching thread and `parent_turn` scope independently of foreground/background transport. Coordinator evidence targets foreground and background children while excluding independent-scope and other-thread records. Real-Pi acceptance proves one Stop reaches both a foreground-detached child and a background child and both settle through cancellation evidence.

- **T06-AC3 (attempt/generation fencing): PASS** — every cancel command carries `expectedAttemptId` and `expectedGeneration`; Alfie refuses mismatched identity without aborting the live child; repository settlement applies only when the same attempt and generation remain current. Coordinator tests cover stale extension results and late stale acknowledgements after a newer attempt/generation has become current. Alfie bridge tests independently cover refusal to abort on stale attempt/generation.

- **T06-AC4 (termination evidence required): PASS** — `cancelled` is journaled only from a same-attempt/same-generation child acknowledgement that resolves after child settlement, or from the complete owner-death proof conjunction: owner generation dead, server-side re-derived lease expired, and execution absent from `listActive`. Coordinator evidence covers mismatched acknowledgements, complete owner-death proof, fresh-lease refusal, and still-active refusal. Real-Pi acceptance proves both foreground-detached and background children transition through sequence `90:cancelling → 92:cancelled` with `evidenceChannel: "child_ack"`.

- **T06-AC5 (`session.abort()` or describe absence is not proof): PASS** — `PiAdapter.interruptTurn` runs durable cancellation before `session.abort()`, and the abort promise has no path that settles the execution aggregate. Missing bridge capability, mismatched acknowledgement, and incomplete owner-death evidence preserve `cancelling`. The approved seams place owner-death conjunction testing at the coordinator state-machine boundary and live acknowledgement testing at the real-Pi boundary; both are satisfied.

- **T06-AC6 (bounded retry, stable diagnostics, honest escalation): PASS** — bridge dispatch itself is raced against the configured acknowledgement timeout, preventing a hung `cancel()` call from exceeding the per-attempt bound. Retry count is bounded by `SYNARA_PI_SUBAGENT_CANCEL_RETRY_LIMIT`; failures retain `cancelling`, emit `pi_subagent_cancel_dispatch_failed` or `pi_subagent_cancel_ack_timeout`, and proceed to provider-turn interruption without claiming cancellation. Coordinator evidence covers three attempts at retry limit two, acknowledgement timeout, absent/mixed-version bridge, stable diagnostics, and escalation. Config evidence covers default, valid-range, and invalid-to-default resolution for both cancellation knobs.

- **T06-AC7 (background parent-abort propagation): PASS** — managed background spawn retains parent abort propagation, while durable Stop additionally reaches the background execution through the negotiated bridge cancel path and waits for settlement evidence. Real-Pi acceptance proves the background child leaves `getActiveExecutions()` and settles `cancelled` with child-ack evidence; Alfie bridge tests cover cancellation of background-managed executions.

## Evidence summary

The independent reviewer returned **PASS WITH GAPS**, confidence **High**, with all seven acceptance criteria passing and no blocking finding.

The reviewer independently reproduced:

- `piSubagentCancellationCoordinator.test.ts`: 12/12 passing.
- `piSubagentCancellationAcceptance.test.ts`: 2/2 passing against the real pinned Pi extension.
- Full Alfie extension suite: 30 files, 488 tests passing.
- All six wallclock regression suites passing independently: foreground acceptance, foreground reopen, foreground lifecycle, real-extension, progress acceptance, and integrated acceptance.
- Config suite: 168 passing.
- Pi bridge suite: 38 passing.
- Execution repository suite: 12 passing.
- Admission coordinator, control health, progress observation, and saturation suites: 46 passing.
- Main server-config suite: 38 passing.
- TypeScript checks for `apps/server` and contracts: exit 0; only the two documented pre-existing TS44 hints appeared.
- Alfie provenance pin and all three source hashes: verified byte-for-byte.

The Implementation Report additionally records the real-Pi journal evidence, mixed-version failure behavior, malformed-command behavior, config matrix, regression runs, workspace verification, and the known unrelated `CursorTextGeneration.test.ts` environment failures. F2, the report-count attribution error, and F5, the dead export, were remediated in Symphony `f92ad194`.

Supervisor source inspection confirmed:

- The production coordinator writes durable cancellation intent before dispatch.
- Same-attempt/same-generation identity is required for child-ack settlement.
- Owner-death lease authority is re-derived from `last_heartbeat_at + leaseDurationMs` against the server clock; stored producer-derived `lease_expires_at` is not used as control authority.
- `PiAdapter.interruptTurn` invokes the coordinator before `session.abort()`.
- The live interrupt seam supplies `isOwnerGenerationDead: () => false`, consistent with its already-live session context, leaving restart reconciliation as the first production owner-death consumer.
- The exact Symphony candidate hashes are `df38bfcb40c6c0504f82f6874a8089181cd9af08` and `f92ad1943a89b1b7377b94e1bd1b4b9069154057`.
- The provenance manifest pins Alfie `53f84bb56fc01f81d516670828902ce66159289f`, package version `0.12.0-alfie.1`, and capability `durable-cancellation`.

## Recorded nonblocking risks and follow-up owners

1. **F1 — MEDIUM: owner-death settlement has no production caller yet.** `PiAdapter.interruptTurn` supplies `isOwnerGenerationDead: () => false`. That value is correct at this seam because `requireSession` has already established a present, live session context; claiming owner death there would be false. The full owner-death conjunction is directly tested at the approved coordinator state-machine seam, including server-clock lease re-derivation. Its first valid production consumer is restart reconciliation.

   **Disposition:** accepted, nonblocking. No new remediation ticket is required.

   **Follow-up owner:** Ticket 10 — Restart reconciliation to terminal or orphaned. Ticket 10 must integrate or equivalently consume the owner-death/owner-loss evidence path using server-tracked owner generation, re-derived lease authority, and active-execution evidence. It must not trust stored producer-derived `lease_expires_at`.

2. **F3 — LOW: a replay while cancellation remains non-terminal may re-dispatch the same cancel command.** The sequence-90 durable intent remains deduplicated, and the command retains the same identity. Alfie fences the live operation by execution/attempt/generation and treats an already-aborted or already-terminal record idempotently, so replay does not repeat the child-abort effect. This is consistent with Specification Implementation Decision 25: cancellation is journal-first, idempotent, and retryable.

   **Disposition:** accepted, nonblocking. Re-dispatch of an idempotent command is not a criterion failure and no separate corrective ticket is required. The Ticket 06 disclosure is the authoritative statement of actual replay behavior; any absolute source comment implying that every non-terminal replay avoids dispatch should be aligned when this path is next modified.

   **Follow-up owner:** Ticket 15 — Watchdog escalation through provider-session stop. Its bounded retry and staged-escalation work must preserve stable cancel command identity, attempt/generation fencing, and the invariant that repeated dispatch cannot repeat the child-abort effect.

3. **F4 — LOW: diagnostic code is stable but semantically broad.** The pending state "owner dead, absent from `listActive`, but re-derived lease not yet expired" currently reports `pi_subagent_cancel_ack_timeout`. The code is stable and the execution honestly remains `cancelling`, so no false terminal claim or control error results. The limitation is diagnostic taxonomy, not execution correctness.

   **Disposition:** accepted, nonblocking. No new remediation ticket is required.

   **Follow-up owner:** Ticket 13 — Admission quotas and safe telemetry, with Ticket 15 as the downstream escalation consumer. When cancellation timing and diagnostic dimensions are formalized, distinguish incomplete owner-death proof from an ordinary child-acknowledgement timeout if the existing operator surface can do so without an unnecessary public-schema change.

No F1/F3/F4 item conditions Ticket 06 acceptance or blocks Ticket 07.

## Rejected alternatives

- **Reject because owner-death settlement is not reachable from `interruptTurn`:** rejected. The live interrupt seam knows the owner is alive by construction, and the owner-approved Testing Seams explicitly place owner-death state-machine evidence at the coordinator boundary. Wiring false owner-death evidence into a live-session path would weaken correctness. Production owner-loss integration belongs to Ticket 10.

- **Reject because non-terminal replay may invoke bridge cancel again:** rejected. The governing requirement is durable-intent deduplication and no repeated child-abort effect, not exactly-once transport dispatch. At-least-once retry with stable command identity and idempotent effects is the specified behavior.

- **Require immediate remediation for the broad diagnostic code:** rejected. The code is stable, state remains honestly `cancelling`, and no consumer is shown to make an incorrect control decision from this diagnostic distinction. Existing Tickets 13 and 15 own the appropriate telemetry and escalation surfaces.

- **Treat `session.abort()` as cancellation evidence:** rejected. This violates T06-AC4/T06-AC5 and Specification Decisions 7 and 26. The accepted implementation correctly keeps provider-turn interruption separate from execution termination proof.

- **Require a second independent review:** rejected. The project cadence requires exactly one independent feature-level review followed by exactly one Supervisor final-acceptance consultation. That lifecycle is complete.

- **Reopen the approved Testing Seams:** rejected. The evidence is present at the owner-approved boundaries, including real-Pi cancellation for both transport modes and coordinator-level owner-death conjunction testing.

## Assumptions

- The independent reviewer's reproduced command outputs correspond to the stated Symphony and Alfie candidate hashes.
- The deterministic loopback model used by the real-Pi acceptance suite exercises the actual pinned Pi runtime and bridge boundary under the owner-approved Testing Seams.
- The extension-side identity fence and post-settlement acknowledgement behavior at Alfie `53f84bb56` are exactly those verified by the provenance pin and Alfie test suite.
- F2 and F5 are fully contained in Symphony `f92ad194`; no source behavior beyond the disclosed review remediation is omitted from the accepted candidate.
- The seven unrelated full-server `CursorTextGeneration.test.ts` failures reported by the implementer are pre-existing environment failures, as reproduced with Ticket 06 changes stashed, and are not evidence against any T06 criterion.
- All accepted commits remain local-only; publication, deployment, and release are outside this acceptance decision.

## Downstream effect

- Ticket 06 is marked accepted/completed with Decision 0011 as its authoritative final acceptance.
- Project Home is updated to add Decision 0011 to authoritative routing and record Tickets 01–06 complete, with remediation Tickets 18–24 remaining accepted.
- **The blocker-free frontier advances to Ticket 07 — Journal-first terminal lifecycle.** Ticket 07's sole blocker, Ticket 06, is satisfied.
- Ticket 10 inherits F1's production owner-death integration and the standing server-side lease re-derivation obligation.
- Ticket 13 owns F4's diagnostic/telemetry taxonomy consideration.
- Ticket 15 inherits F3's idempotent retry invariant and consumes the cancellation diagnostics and evidence rules for staged escalation.
- The Alfie provenance pin advances to `53f84bb56` / `0.12.0-alfie.1`, capability `durable-cancellation`. Any later change to Alfie `package.json`, `src/index.ts`, or `src/agent-manager.ts` requires provenance re-pinning and hash recomputation before real-extension acceptance runs.

## Failure and rollback implications

The Symphony change introduces production cancellation coordination and configuration and is paired with an Alfie capability-gated bridge implementation. Rolling back either side independently produces a mixed-version boundary: without negotiated `durable-cancellation`, Symphony must retain `cancelling` and emit `pi_subagent_cancel_dispatch_failed`; it must never silently skip cancellation or claim `cancelled`.

Rolling back the Symphony implementation removes journal-first parent-turn cancellation and therefore reopens Ticket 06 and blocks Ticket 07 and downstream tickets that depend on durable cancellation. Rolling back Alfie `53f84bb56` removes the accepted bridge capability and real child-termination acknowledgement; Symphony's mixed-version failure behavior remains the required safe state.

If Decision 0011 is later reopened, Ticket 06 returns to needs-remediation and Ticket 07 becomes blocked again. Downstream work must not reinterpret `session.abort()` resolution, timeout expiry, or temporary active-child absence as termination evidence.

## Reopening conditions

Reopen through a new numbered decision, never by editing this record, only for material evidence that:

- the committed candidate differs materially from Symphony `df38bfcb40c6c0504f82f6874a8089181cd9af08` + `f92ad1943a89b1b7377b94e1bd1b4b9069154057` or Alfie `53f84bb56fc01f81d516670828902ce66159289f`;
- durable cancellation intent can be dispatched before its journal write is committed;
- a duplicate or replayed cancel can repeat the underlying child-abort effect;
- a parent-turn Stop omits a managed foreground-detached or background child declaring that scope;
- a stale cancel or late settlement can abort or overwrite a newer attempt/generation;
- `cancelled` can be asserted from `session.abort()` resolution, timeout alone, temporary describe/list absence, mismatched identity, or any evidence weaker than the accepted child-ack or complete owner-death conjunction;
- owner-death control trusts stored producer-derived `lease_expires_at` instead of validating or re-deriving lease authority against the server clock;
- dispatch failure or acknowledgement timeout loses durable `cancelling`, retries without a bound, lacks a stable diagnostic, or claims terminal success;
- background managed spawn ceases to honor parent cancellation;
- mixed-version negotiation silently skips cancellation or reports a false terminal state;
- Ticket 10 ships owner-loss reconciliation without generation fencing, server-side lease re-derivation, or active-execution evidence;
- provenance no longer proves the exact Alfie source used by the real-Pi acceptance path; or
- new evidence materially contradicts Decisions 0001–0010, the owner-approved Testing Seams, or this record's criterion verdicts.
