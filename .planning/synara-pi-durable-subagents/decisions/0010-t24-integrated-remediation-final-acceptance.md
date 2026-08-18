# Decision 0010 — Ticket 24 final acceptance (integrated remediation acceptance and review closure)

## Status

**accepted** (binding; Decisions 0001–0009 remain authoritative and unchanged)

**Date:** 2026-08-18

## Accepted candidate

- Symphony `625d256a6a63d2eb14daefd8a3326206272cb228` (`625d256a`, integrated acceptance path + ticket-24 report; preceded by the accepted ticket-23 chain `435f0c58` / `6d646fe1` / `fa6878f0`; working tree at adjudication carries only the review-disposition documentation edits — F1 count fix in the ticket-23 report, F2/F3/F5 fixes + review verdict in the ticket-24 report — committed together with this record)
- Alfie `d35644a3b7af34c0dd1868afe652de50e62c8992` (unchanged from Decision 0009; `@alfie/pi-subagents@0.11.0-alfie.1`, capability `coalesced-progress`; local main, clean; `piSubagentExtensionProvenance.json` pins the same commit and all three SHA-256 hashes; provenance self-verifies at the start of every integrated run)

## Question

Does the Ticket 24 candidate at Symphony `625d256a` + Alfie `d35644a3b` satisfy T24-AC1 through T24-AC9 (AC9 satisfied by the recorded single independent review) such that this decision (a) accepts ticket 24, (b) authorizes marking tickets 01–05 complete again, and (c) advances the block-free frontier to ticket 06, with T24-AC10 executed by this decision's downstream effect?

## Governing references

Project Home; Issue 24 (normative T24-AC1..AC10, implementer report with both matrices, verification log, deviations, recorded review verdict); Issues 01–05 (original tickets whose statuses this decision re-flips); Decisions 0001–0009 (0002 t18, 0003 t19, 0004 t20, 0005 t21, 0006/0007/0008 t22, 0009 t23); Ticket 24 PLAN.md (settled interpretations: reconnect evidence argument, three-history scope, flood companion-extension as approved secondary seam, stage sequencing — audited, not re-litigated); owner-approved Testing Seams (2026-08-16); Alfie repo @ `d35644a3b` (pinned, read-only).

## Lifecycle honored

All six remediation blockers accepted (Decisions 0002–0009) → implementation per settled PLAN (WP-A worker: integrated file; WP-B orchestrator: matrices, verification log, review dispatch) → complete Implementation Report in Issue 24 → owner-approved Testing Seams (2026-08-16) → exactly one independent criterion-level review (2026-08-18, RECOMMEND ACCEPT, high confidence, 0 critical/high, 31/31 rows audited, findings F1–F5 dispositioned and applied) → one Project Supervisor final-acceptance consultation (activation class 2) → ACCEPT. Tickets 01–05 held at `needs-remediation` until this record (verified at adjudication); ticket 06 held at its gate.

## Settled verdict — **Accept Ticket 24. T24-AC1 through T24-AC10 all satisfied.**

- **AC1 (three-history migration compatibility in the integrated candidate): PASS** — integrated stage 1 boots the real Migrator over fresh / Symphony-lineage `[90..100]` (97 re-run via alias) / upstream-v0.7.2 `[97,98,99,100]` histories; convergence through 100, tracker complete, second-run no-op, repository round-trip per history; `check-migration-lineage.ts` exit 0; MLR 4/4.
- **AC2 (real capability negotiation matrix): PASS** — pinned extension negotiates `managed_enabled` with all four capabilities incl. `coalesced-progress`; stripped copy → `capability_mismatch`, Agent tool unwrapped, zero admissions/journal; failing bridge → `pi_subagent_bridge_error`; legacy → `bridge_absent`; provenance SHA-256 verified at run start.
- **AC3 (atomic authorized admission with replay idempotency): PASS** — seq1 accepted → seq2 started before child evidence; inline completion "ACK" with model-request log growth; same-commandId replay returns original executionId/attemptId already-applied with zero new journal rows; distinct identities for the second spawn; revoked authority → `pi_subagent_admission_unauthorized`, zero model requests, durable rejected row.
- **AC4 (fail-closed degradation and recovery): PASS** — injected `recordAdmission` failure → no child (request log unchanged), `pi_subagent_lifecycle_persistence_failed`, degraded health; second attempt fails closed while degraded; stage-3 truth unchanged; fail-flag cleared + fresh commandId admits and starts with health restored.
- **AC5 (bounded detach with reopen): PASS** — slow child (4 s/turn) under 300 ms budget detaches at 303–310 ms (307 ms at Supervisor re-run) vs the `budget + 500 ms` = 800 ms envelope, per-file standalone method (Decision 0008); inline leg proven in stage 3; stable executionId/attemptId/generation; `cancellationScope parent_turn`; real-chain reopen restores identical aggregate/journal `[1,2,3]`/observation.
- **AC6 (progress, heartbeat, saturation, cleanup): PASS** — real progress payload (no `spinnerFrame`) with lease lead exactly 3000 ms configured; 2000-observation flood on the real schedule emits ≤ `ceil(elapsed × rateHz) + 1` with `dropped + emitted == 2000` exactly; journal idempotent under flood; bridge `activeAttachmentCount`/`activeTimerCount` 0; idle-TTL coalescer release confirmed by no further events.
- **AC7 (31-row second matrix, none synthetic-only): PASS** — every T01–T05 criterion mapped to remediation ticket + real-Pi source evidence + verification command; per-ticket real coverage (T01 → RE + INT stage 2; T02 → INT stage 3 real child; T03 → RE §21 + INT stage 4; T04 → FA + INT stage 5 real children; T05 → PA + INT stage 6 real child); reviewer audited 31/31 (28 direct, 3 LOW/INFO, none failing).
- **AC8 (clean, documented verification environment): PASS** — verification log records environment, commands, exit codes, counts, warnings, tree state: integrated standalone green ×4; all wallclock files standalone green (Decision 0008 method); deterministic focused suites green with matching counts; migration checker + MLR green; full apps/server suite 372 files, 4518 passed | 17 skipped, exit 0; workspace fmt/lint/typecheck exit 0 (reviewer re-verified); Alfie 483/483 at the pin, unchanged.
- **AC9 (independent review, no critical/high against tickets 01–05): PASS** — recorded 2026-08-18: RECOMMEND ACCEPT, high confidence; zero critical, zero high (3 LOW, 2 INFO); tickets 18–23 implementation reports reconciled (commits present, commands green); F1–F5 dispositioned (F1 fixed in ticket-23 report; F2/F3/F5 fixed in ticket-24 report; F4 formatting-only reformat committed with this record).
- **AC10 (tickets 01–05 re-complete only after AC1–AC9; ticket 06 gate): SATISFIED BY THIS DECISION'S DOWNSTREAM EFFECT** — AC1–AC9 now pass; statuses verified at `needs-remediation` immediately before this record; the authorization below flips them, and the frontier advances to ticket 06 only via this record.

## Tickets 01–05 re-completion authorization

This decision authorizes (and only this decision authorizes) restoring tickets 01–05 to complete, with Decision 0010 as the reference. Evidence base: the ticket-24 report's second matrix (31 criteria, all rows passing) plus the remediation acceptances it rolls up.

| Ticket                             | Remediation owners (accepted)                           | Second-matrix rows |
| ---------------------------------- | ------------------------------------------------------- | ------------------ |
| 01 — managed execution handshake   | Ticket 19 (Decision 0003)                               | T01-AC1..AC6       |
| 02 — durable execution admission   | Tickets 18 (Decision 0002) + 20 (Decision 0004)         | T02-AC1..AC6       |
| 03 — admission fails closed        | Ticket 21 (Decision 0005)                               | T03-AC1..AC6       |
| 04 — bounded foreground attachment | Ticket 22 (Decision 0008; 0007 reopened and superseded) | T04-AC1..AC6       |
| 05 — coalesced progress and leases | Ticket 23 (Decision 0009)                               | T05-AC1..AC7       |

The original 2026-08-16 not-accepted verdict remains historically accurate for what was then on the tree; the reviewed defects are the ones this integrated candidate proves fixed at the production boundary. PROJECT.md's frontier and review-verdict sections must be updated to reflect: tickets 01–05 complete again per Decision 0010; tickets 18–24 accepted; frontier = ticket 06.

## Evidence summary

Full matrices in the Issue 24 report. Supervisor independent verification at adjudication: confirmed Symphony HEAD = `625d256a` on main with only the two disposition docs modified; confirmed Alfie HEAD = `d35644a3b` clean and matching the provenance manifest; re-ran `piSubagentIntegratedAcceptance.test.ts` standalone — 7/7 green, detach envelope 307 ms vs 800 ms (matching the reported 303–310 ms band and the reviewer's 304–310 ms re-run); re-ran `piSubagentForegroundAcceptance.test.ts` standalone — 6/6 green; confirmed tickets 01–05 statuses are still `needs-remediation` and ticket 06 still gated. Reviewer independently reproduced the integrated file ×2, the wallclock and deterministic suites with matching counts, workspace fmt/lint/typecheck, and reconciled tickets 18–23 reports against history.

## Recorded nonblocking risks

1. **Stage-6 flood companion-extension seam (approved):** the deterministic saturation leg drives the server coalescer through a companion compatible-extension registered via the production `extensionFactories` seam because the real binding is not externally observable. This is the owner-approved secondary seam (Testing Seams, 2026-08-16; PLAN §2); actual-Pi progress evidence for T05 rows is carried by the real-extension legs of the same stage and `piSubagentProgressAcceptance`. Commented in-file. Does not replace actual-Pi evidence.
2. **Decision 0009 lease obligation — forwarded to ticket 06:** `lease_expires_at` still trusts producer-supplied `occurredAt`; no code in this candidate reads `lease_expires_at` for control. **Contract obligation on ticket 06 (the first potential lease consumer): any lease-based control must validate/re-derive lease authority server-side before it ships.** Unchanged from Decision 0009; explicitly forwarded, not resolved here.
3. **Stage sequencing / shared fixture state:** the 7 `it()` blocks execute in file order over one hermetic fixture; documented in the file header and consistent with the wallclock project's single-file-serial execution. Binding verification is the per-file standalone invocation.
4. **Reconnect interpretation (settled, audited):** no new WS server is booted; reconnect evidence = real-chain repository reopen restoring latest observation + the rate-capped runtime-event stream during flood + the pre-existing web auto-follow guard. Same argument accepted for T23-AC8; within the PLAN's settled interpretation.
5. **Wallclock acceptance method (inherited, Decision 0008):** multi-file runs are documented harness noise; only per-file standalone invocations are binding for the envelope. Full-suite run is supporting evidence. Machine-load sensitivity inherited.
6. **Pre-existing, non-ticket:** 526 lint warnings; node SQLite ExperimentalWarning; tracked runtime-file mutation pattern (Decision 0009 risk 3).

## Rejected alternatives

- **REASSESS:** no criterion, settled-design interpretation, or Decision 0001/0008/0009 requirement fails or is unevidenced; the three deviations are owner-approved seams or documented conventions, not escapes; the review's 3 LOW / 2 INFO findings are documentation-scope and already applied. No remediation cycle is warranted.
- **NOT-ACCEPT:** no criterion-level failure evidence exists; the terminal artifact independently reproduces green at the Supervisor's re-run with the envelope at 38% of the bound.
- **Conditional acceptance with riders on F1–F5:** all findings are already dispositioned — fixes present in the working tree and committed with this record; riders would add no enforceable content.
- **Second independent review:** the single-review lifecycle is satisfied (one reviewer, high confidence, all 31 rows + tickets 18–23 reconciliation); a second review violates the project's review lifecycle.
- **Re-litigating the PLAN's settled interpretations (reconnect, flood seam, sequencing):** out of scope for final acceptance; audited, not overturned — each is honored by the implementation and was owner-approved.

## Assumptions

- Orchestrator-run verification outputs (full suite 372/4518, workspace fmt/lint/typecheck, focused suite counts) correspond to the candidate hashes; Supervisor spot re-runs corroborate the wallclock-critical paths.
- The working-tree edits are documentation-only (verified: two planning files, no source) and are committed together with this record; the accepted candidate therefore includes them.
- The deterministic loopback model server exercises the real Pi runtime and provider-protocol boundary (hosted-provider credentials unavailable) — the owner-approved Testing Seams substitution per Decision 0001.
- All commits remain local-only; no publication, deployment, or release is in scope.
- No lease consumer ships before ticket 06 discharges the occurredAt validation obligation.

## Downstream effect

- Ticket 24 marked accepted/completed with this record as authoritative acceptance; AC9/AC10 checkboxes checked in the issue.
- **Tickets 01–05 marked complete again** per the authorization above (second matrix + Decisions 0002/0003/0004/0005/0008/0009 as evidence links); PROJECT.md frontier and review-verdict sections updated accordingly.
- **Blocker-free frontier advances to ticket 06 — Durable parent-turn cancellation** (its sole blocker, ticket 24, is now satisfied). Ticket 06 inherits the standing lease-`occurredAt` validation obligation.
- Provenance pin unchanged at `d35644a3b` / `0.11.0-alfie.1`: any future Alfie change to `package.json` / `src/index.ts` / `src/agent-manager.ts` requires re-pinning + hash recompute before real-extension tests run.

## Failure and rollback implications

Ticket 24 added no production code — the Symphony change is a test/acceptance artifact plus documentation; it cannot regress runtime behavior. The remediation stack beneath it remains governed by Decisions 0002–0009 (additive, capability-gated, rollback semantics recorded there). If this acceptance were later reopened, tickets 01–05 re-flip to needs-remediation and ticket 06 re-blocks — the tracker states and this record are the single source of that linkage. Rolling back the integrated file alone removes the acceptance evidence path without changing production behavior.

## Reopening conditions

Reopen (via a new numbered decision, never by editing this one) only for material evidence that: the final committed source differs materially from Symphony `625d256a` (plus its disposition-docs commit) or Alfie `d35644a3b`; the integrated path fails reproducibly in per-file standalone invocation (excluding Decision 0008's documented multi-file harness noise); any second-matrix row is shown synthetic-only, miscited, or non-reproducible; provenance no longer proves the exact Alfie source at the pin; any reviewed-defect class re-emerges at the production boundary (spinner-style publication in managed mode, half-admitted projection, admission that fails open on persistence failure, envelope breach beyond `budget + 500 ms` standalone, progress/lease observation that rewrites desired/observed or discards lifecycle evidence under saturation, migration divergence across the three histories); a lease-based control ships without server-side occurredAt validation (reopens the Decision 0009 obligation against ticket 06); or new evidence contradicts Decisions 0001–0009 or this record's settled verdicts.
