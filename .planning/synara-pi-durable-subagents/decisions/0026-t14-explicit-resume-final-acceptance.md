# Decision 0026 — Ticket 14 explicit resume final acceptance

## Status

Accepted.

## Date

2026-08-19

## Candidate

- Symphony integrated Ticket 14: `6d46f221c6572e66c96c24d9dde11532826f84c3`.
- Accepted Ticket 15 source baseline, including disclosed shared Ticket 14
  contract/Vitest hunks: `91e34c1e7164c3b0aa83e788116b1447d588364f`.
- Decision-0025 routing commit: `3dc12971ab93e78f9dfc4cd1ea9e3ad4adfc2d22`.
- Alfie unchanged: `489acd626` / `0.14.0-alfie.1`.
- `apps/server/.pi/notifications.jsonl` runtime noise is outside the candidate.

## Question

Does integrated Ticket 14 satisfy T14-AC1 through T14-AC6, the explicit-only
and no-replay invariant, authorization/admission parity, stale-generation
fencing, real-Pi and UI requirements, failure diagnostics, migration
correctness, and the binding requirement that resume use a journal sequence
disjoint from Ticket 15 watchdog band `70–74`?

## Governing references

- Project Home and authoritative routing.
- Ticket 14 explicit-resume issue and T14-AC1 through T14-AC6.
- Durable managed-execution specification, especially identity-before-spawn,
  monotonic generation fencing, explicit-only orphan resume, authorization of
  every control, and prohibition on automatic replay.
- Decision 0001 testing-strategy governance.
- Decision 0025 and Ticket 15 ownership of watchdog band `70–74`.
- The single Ticket 14 independent feature-review package, whose final
  remediation re-review is PASS.

## Evidence

The accepted lineage is Ticket 15 source baseline `91e34c1e`, Decision-0025
routing commit `3dc12971`, then integrated Ticket 14 commit `6d46f221`.
The disclosed shared Ticket 14 hunks in the baseline are
`packages/contracts/src/piSubagents.ts` and `apps/server/vitest.config.ts`.

Source inspection confirms:

- journal-first resume with one new attempt and generation before child launch;
- shared authorization/admission gating and fail-closed denials;
- stale-generation fences for prior lifecycle, terminal, cancellation, and
  completion work;
- explicit UI dispatch with no hydration/recovery/startup replay;
- durable four-field delegation and resolved-model replay with honest legacy
  fallback;
- managed observation binding on the real child launcher;
- stable diagnostics for unavailable, denied, invalid, stale, persistence, and
  child-start failure surfaces.

The final implementation uses resume sequence `80` for both durable settlement
and post-commit lifecycle notification. Watchdog continues to own `70–74`.
Focused coverage persists watchdog stage `70` on the same resumed
attempt/generation after resume sequence `80` and asserts the exact
sequence-80 lifecycle notification.

The single independent review package records the full remediation history:

1. Initial NEEDS REMEDIATION: resume collided with watchdog sequence `70`; the
   migration-104 legacy surface lacked direct verification.
2. First reopening: durable resume moved to `80` and migration verification
   closed, but lifecycle notification still reported `70`.
3. Final reopening: row, exported constant, repository documentation, and
   lifecycle notification consistently use `80`; exact notification and
   same-attempt watchdog coexistence regressions pass; final review verdict
   PASS.

Accepted verification evidence:

- focused remediation suites: 15/15;
- real-Pi resume plus watchdog wall-clock acceptance: 3/3;
- persistence tests: 237/237;
- focused web tests: 14/14;
- browser explicit-resume path: 1/1;
- stable real-Pi resume runs: 2/2;
- cancellation/restart neighboring coverage: 3/3;
- server, contracts, and web typechecks: passed;
- Oxfmt: passed;
- lint: zero errors;
- full server unit suite: 4721 passed and 17 skipped;
- the unrelated Antigravity flake passed standalone 71/71 and has no evidence
  connecting it to Ticket 14.

## Criterion assessment

- **T14-AC1 — PASS:** same execution identity, one new attempt, generation
  committed before launch, replay creates no second child.
- **T14-AC2 — PASS:** prior lifecycle/terminal/cancel/completion work cannot
  mutate current truth; stale terminal evidence is counted.
- **T14-AC3 — PASS:** startup, reconciliation, sweep, completion recovery,
  hydration, transcript, heartbeat, and model behavior do not trigger resume.
- **T14-AC4 — PASS:** resume reuses project/thread/active-turn authority,
  approval, quota, and admission gates; denials create no attempt or child.
- **T14-AC5 — PASS:** the durable card moves to the new queued/running attempt
  with updated diagnostics while prior evidence remains journaled.
- **T14-AC6 — PASS:** side-effect-capable work resumes only from the explicit
  user command; child-launch failure remains honest durable queued truth.
- **Disjoint sequence gate — PASS:** Ticket 14 owns resume sequence `80`; Ticket
  15 retains watchdog `70–74`; row and notification are consistent.

## Settled verdict

ACCEPT.

Ticket 14 is complete at integrated Symphony tree `6d46f221`. Resume is an
authorized, user-triggered, journal-first transition to one new attempt under
the same execution identity. It does not provide or imply automatic restart
continuation. Prior-attempt work is fenced from current truth, and the resumed
attempt can coexist with every Ticket 15 watchdog stage because Ticket 14 owns
disjoint sequence `80`.

## Rejected alternatives

- Keeping Ticket 14 in remediation because its original candidate used `70`:
  rejected; the accepted candidate uses `80` on durable and notification
  surfaces and proves watchdog-70 coexistence.
- Accepting the first reopening state: rejected; its notification still
  reported `70`, so the final remediation was necessary.
- Automatic restart continuation or automatic resume: rejected as contrary to
  the Project Contract and unsafe for duplicate side effects.
- Treating request projection as successful resume: rejected; only committed
  execution truth changes the card.
- Blocking on Ticket 16 teardown proof: rejected; Ticket 14 does not claim
  teardown or termination proof.
- Blocking on the isolated Antigravity flake: rejected as unrelated and green
  standalone.
- Requiring another independent review: rejected; exactly one package was
  authorized and its final reopening closes both findings.

## Assumptions and residual uncertainty

- Verification results correspond to exact candidate `6d46f221`.
- The disclosed baseline shared hunks are exactly the contracts and Vitest
  configuration changes.
- Alfie remains at accepted provenance `489acd626` / `0.14.0-alfie.1`.
- No governing record reallocates sequence `80`.
- If a stored model is no longer installed, the launcher falls back to the
  current session model. This is bounded availability behavior, not implicit
  resume; exact-model-or-fail would require a new decision.
- A post-commit child-launch failure leaves an honest queued attempt for
  reconciliation/wall-time handling and may require operator inspection.
- Antigravity suite flakiness remains unrelated, nonblocking debt.

## Downstream effect

- Ticket 14 transitions from `in-review` to `complete`.
- Resume sequence `80` is the accepted Ticket 14 journal and lifecycle
  notification band; future work must not reuse it incompatibly.
- Ticket 15 remains complete with watchdog band `70–74`.
- The active implementation frontier remains Ticket 16.
- Ticket 17 remains blocked by Ticket 16 and may rely on Ticket 14 explicit
  resume as an accepted neighboring capability where relevant.

## Failure and rollback implications

Rolling back `6d46f221` removes the accepted Ticket 14 implementation.
Reintroducing `70–74` on either the durable resume row or lifecycle notification
invalidates this acceptance. Launch-before-settlement, bypassed gates,
automatic orphan replay, or stale prior-attempt mutation of current truth also
invalidate acceptance.

Rollback must not reinterpret an already-created resumed attempt as if it
never existed; durable journal and possible side effects remain historical
evidence.

## Reopening conditions

Reopen only on material evidence that:

1. verification did not run against `6d46f221`;
2. durable resume or its notification can use `70–74`;
3. watchdog stage `70` cannot coexist with resume `80` on one attempt;
4. command replay can launch more than one resumed child;
5. any non-user path can resume automatically;
6. authorization, active-turn, approval, authority, quota, or admission can be
   bypassed;
7. stale prior-attempt activity can mutate current truth or escape accounting;
8. migration 104 corrupts legacy rows or replay becomes unbounded/dishonest;
9. real-Pi resume fails under accepted Alfie provenance; or
10. a governing decision changes explicit-only or sequence-band invariants.

## Superseded record

None. The initial NEEDS REMEDIATION and first reopening are sections of the
single independent review package, not prior Binding Decision Records. They
remain useful remediation history and are closed by the final PASS.
