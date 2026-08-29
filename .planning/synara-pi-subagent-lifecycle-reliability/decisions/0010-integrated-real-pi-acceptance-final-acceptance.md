# Decision 0010 — integrated real-Pi acceptance final acceptance

## Status

**Binding Final Acceptance — ACCEPT**

- **Date:** 2026-08-29
- **Project:** [Synara Pi subagent lifecycle reliability](../PROJECT.md)
- **Ticket:** Ticket 06 — integrated real-Pi acceptance
- **Trigger:** Final acceptance
- **Semantic outcome:** Decision
- **Gate:** pass
- **Consultation:** The exactly-one reserved G-Q Supervisor final-acceptance consultation
- **Accepted Symphony candidate:** `9b55649050b76feffdc4279ceaec92ac74a78686`
- **Accepted Alfie provenance:** `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, package `@alfie/pi-subagents@0.15.0-alfie.6`
- **Verdict:** **ACCEPT Ticket 06 and the complete integrated project candidate.**

This decision is the sole final-acceptance consultation reserved by the Project Contract. Decision 0009 remains the binding aspect-scoped correction and rebaseline authority; it is not reinterpreted as final acceptance and is not edited or superseded by this record.

## Question

Does the complete Ticket 06 candidate satisfy T06-AC1 through T06-AC8 and the project's integrated acceptance contract, including one durable public `executionId`; exact attempt/generation and registration fencing; terminal-before-cleanup and journal-first truth; proof-before-fence; truthful restart, reconnect, and explicit Resume behavior; Decision 0009's bounded structured provider-unavailable mapping; exact candidate lineage and implementation surface; distinct D/R/M/Q/A evidence classes; fresh authorization and no-retry boundaries; controlled Symphony/Alfie provenance; protected owner WIP; and exactly one integrated review followed by exactly one final Supervisor acceptance?

## Governing references

### Authoritative

1. [Project Home](../PROJECT.md) — Project Contract, authority precedence, sole routing, and final-acceptance governance.
2. [Decision 0001](0001-project-charter-and-inherited-authority.md) — project charter and one-review/one-final-consultation contract.
3. [Decision 0002](0002-canonical-execution-identity-and-result-read-contract.md) — canonical `executionId`, durable tuple resolution, result continuity, and exact-live control.
4. [Decision 0003](0003-terminal-steer-race-linearization-contract.md) — synchronous provider acceptance and terminal-first/enqueue-first causality.
5. [Decision 0006](0006-live-lifecycle-containment-linearization-contract.md) — exact live containment, bounded diagnostics, journal-first terminal truth, and proof-before-fence.
6. [Decision 0008](0008-reassessment-live-control-post-await-retirement-classification.md) — same-registration retirement versus replacement/invalidation.
7. [Decision 0009](0009-reassessment-structured-provider-unavailable-preservation.md) — exact-marker-only internal reason preservation, public managed mapping, exact four-file correction, candidate rebaseline, and no-retry route.
8. [Ticket 06 Plan](../plans/06-integrated-real-pi-acceptance/PLAN.md) and WP-01 through WP-07 — execution sequence and evidence-class contract.

### Supporting

1. [Ticket 06 issue](../issues/06-integrated-real-pi-acceptance.md).
2. WP-01 deterministic evidence and provenance — `19/19` files, `306/306` tests.
3. WP-02 real-Pi evidence — `22` passed and one expected skip across five serial legs.
4. WP-03 manual destructive raw log and operator record — sole bounded owned-tree teardown.
5. WP-04 original formatter challenge, exact mutation disposition, replacement quality log, and report.
6. [Ticket 06 integrated review](../reviews/06-integrated-real-pi-acceptance-review.md) — valid independent AC1–AC8 PASS package with no blocker.
7. Decision 0009 focused red/green logs — supporting implementation evidence only.
8. Candidate and planning provenance through `fb0cee95b`.

## Evidence considered

| Area | Finding | Verdict |
|---|---|---|
| Candidate identity | Producer candidate is exact SHA `9b55649050b76feffdc4279ceaec92ac74a78686`; integration merges are provenance only. | PASS |
| Lineage | Exact sole-parent child of candidate2 `2afef48b008527685658801d8f0d84c79e24827d`. | PASS |
| Correction surface | Exactly four Decision 0009 paths. | PASS |
| Total surface | Exactly six distinct paths from baseline `12fd6686edc26a3fa0382e8bdeb83a1be8045539`; no unauthorized schema/config/coordinator/lockfile/Alfie change. | PASS |
| Alfie | Clean pin `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, package `0.15.0-alfie.6`. | PASS |
| D | Fresh closed set: `19/19`, `306/306`, zero failure/skip. | PASS |
| R | One complete five-file serial attempt, no retry: `22` passed and one expected skip, all exits `0`, fresh HOME cleanup. | PASS |
| M | One authorized manual run: exact root PID `29538` and descendant PID `29552`, TERM evidence, zero survivors, bands `75,76`, no band 76 while live, generation `1 -> 2`, cleanup, no retry. | PASS |
| Q | Original formatter challenge preserved; owner authorized exact disposal of ten formatter-only mutations and one replacement without formatter rerun; lint/typecheck exit `0`, `7/7` packages, candidate clean. | PASS |
| A | Invalid reviewer transports were not inferred approval; authorized read-only fallback returned AC1–AC8 PASS with no blocker. | PASS |
| Protected WIP | Untouched and unstaged, aggregate hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`. | PASS |
| Authorization/no retry | Fresh destructive/quality authority; real-Pi and manual attempts each executed once; historical failures preserved. | PASS |
| Diagnostic mapping | Exact structured marker alone carries internal `provider_inactive`; unaccepted control maps to `pi_subagent_read_live_record_unavailable`; observations/generic route remain generic; no text parsing. | PASS |
| Acceptance truth | Terminal-first zero steer/SDK insertion; enqueue-first exactly one steer/SDK insertion and `applied`; no effect claimed without provider acceptance. | PASS |
| Replay/recovery limits | No automatic replay, Resume, bootstrap, reconstruction, queue replay, parent fallback, replacement child, or second action. | PASS |

## Acceptance-criteria verdict

| Criterion | Final finding | Verdict |
|---|---|---|
| **T06-AC1** | Exact controlled Symphony/Alfie composition, isolated homes, verified cleanup and provenance. | PASS |
| **T06-AC2** | Public `executionId` continuity across detach, durable read, terminal, reconnect, and live control with exact fencing. | PASS |
| **T06-AC3** | Progress, terminal-before-cleanup, cancellation, watchdog, containment, and bounded diagnostics without false terminal truth. | PASS |
| **T06-AC4** | Restart and Resume PASS with no automatic recovery invention. | PASS |
| **T06-AC5** | Attempt/generation/session/registration/epoch fencing across stale, replacement, duplicate, timeout, and outcome-unknown cases. | PASS |
| **T06-AC6** | Required D/R/M split and exact-owned-tree manual proof. | PASS |
| **T06-AC7** | Stable bounded diagnostics and real-Pi evidence prevent mock-only success. | PASS |
| **T06-AC8** | One valid integrated review precedes this exactly-one final Supervisor consultation. | PASS |

## Final finding

**ACCEPT.**

The complete candidate satisfies T06-AC1 through T06-AC8 and the Project Contract's production-reliability standards. It preserves the following binding invariants:

- `executionId` is the sole managed public identity.
- Attempt, generation, tuple, session, registration, and epoch are exact fences.
- Provider-local identity and arbitrary provider internals remain non-public.
- Durable terminal evidence is journal-first and has precedence.
- Terminal outcome, cleanup proof, provider acceptance, owner proof, and generation fencing remain distinct.
- Only proven band 76 establishes cleanup and advances generation.
- Provider inactivity, callback loss, timeout, survivors, `owner_unproven`, and cleanup uncertainty do not fabricate cancellation or terminal truth.
- Control acceptance remains provider-owned: terminal-first has zero effect; enqueue-first has exactly one accepted insertion.
- No automatic retry, replay, Resume, bootstrap, reconstruction, parent fallback, PID guessing, or new child is introduced.
- Decision 0009's internal reason preservation adds no public/durable reason, text parser, or acceptance lie.

## Rejected interpretations

1. Historical stale routing prose is not contrary behavioral evidence; WP-07 must reconcile it administratively.
2. Integration merges are not producer identity.
3. Historical candidate2 D/R evidence is not current proof.
4. Incomplete/transport-failed reviewer responses are not approval.
5. Decision 0009 is not final acceptance.
6. The formatter challenge is neither hidden nor silently retried; exact disposal and replacement authority are preserved.
7. Manual zero-survivor evidence does not generalize beyond the exact owned tree.
8. Provider text parsing or public `unavailableReason` is rejected.
9. Terminal-first cannot be reported applied.
10. Automatic retry/replay/Resume/bootstrap/reconstruction/parent fallback/PID guessing/general kill authority is rejected.
11. A fifth correction file or schema/config/coordinator/lockfile/Alfie expansion is rejected.
12. No unresolved material issue remains; residuals are bounded and nonblocking.

## Residual risk

1. One pre-existing nonblocking lint warning remains for unused `firstAdmission`.
2. Manual zero-survivor evidence is bounded to the recorded owned root and descendant at verification time.
3. Historical PLAN/issue/WP prose may describe earlier states; WP-07 must reconcile it.
4. Future provider, Alfie, or Pi SDK drift requires new verification; this acceptance applies only to the exact pins.
5. The result proves the recorded candidate/environments and does not authorize composition drift.

## Reopening conditions

Reopen through a new numbered reassessment, never by editing this record, if material evidence shows candidate/lineage/surface or Alfie provenance drift; raw D/R/M/Q/A evidence mismatch or mutation; protected WIP involvement; terminal-first provider action; enqueue-first duplicate/missing insertion; public/durable reason leakage or text parsing; stale/wrong-generation mutation; violation of journal-first, proof-before-fence, band-76, or exact-owner containment; automatic retry/replay/Resume/bootstrap/reconstruction/fallback/general kill authority; overstatement of manual proof; omitted material review blocker; or owner change to the Project Contract/pinned composition.

Rollback must fail closed and preserve durable identity, terminal journal rows, generation and teardown evidence, raw logs, provenance, and protected WIP. It must not replay uncertain effects, restore retired routes, delete evidence, or broaden process authority.

## Downstream effect

1. Ticket 06 is **accepted**.
2. The complete integrated Synara Pi subagent lifecycle reliability candidate is **finally accepted** against the exact Project Contract and pinned composition.
3. G-Q is consumed exactly once by this Decision 0010.
4. This record must be tracked before dependent closure.
5. WP-07 may reconcile stale prose and close routing without rerunning D/R/M/Q/review/final acceptance.
6. No second review or final consultation is authorized absent a material reopening condition.
7. No push, release, deployment, production process action, external signalling, PID discovery, general kill authority, or unrelated mutation is authorized.

## Prohibitions

This decision does not authorize source/test/evidence/producer mutation; another D/R/M/Q/review/final run; rewriting historical failures; changing Decision 0009, candidate, or Alfie pin; automatic recovery/retry; provider-ID/text exposure; public `unavailableReason`; PID guessing/process-name kills/external signalling/parent fallback/general kill authority; touching protected WIP; push, release, deployment, or rollout.
