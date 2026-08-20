# Decision 0032 — Ticket 17 T17-AC6 seam owner-approval record

## Status

accepted by human owner — Decision 0031 reopening condition 1 satisfied and
persisted. This record captures the owner's approval of the concrete amended
T17-AC6 Testing Seam. It does **not** change Decision 0031's settled
technical direction, approve any test result, or claim any AC6 evidence has
been produced.

## Date

2026-08-20

## Question

Decision 0031 reserved the concrete amended T17-AC6 Testing Seam for
explicit human-owner approval before any AC6 test was written, and required
its reopening condition 1 to be satisfied by persisting the owner outcome
and updating the amendment's approval record. Did the human owner approve
the pending amendment, and what is now permitted and still prohibited?

## Trigger

Decision 0031 reopening condition 1 — the owner approved the pending
Ticket-17 amendment. This record persists that outcome in the project's
durable decision trail; the amendment's approval record in the normative
ticket is updated to Approved in the same change.

## Owner decision

- **Owner identity:** project owner (chat user).
- **Approval date:** 2026-08-20.
- **Approval artifact:** the current `/matt-implement` implementation
  conversation on 2026-08-20.
- **Verbatim confirmation:** `okay đồng ý`.
- **Scope of approval:** the concrete amended T17-AC6 Testing Seam as
  persisted in the normative ticket — the three-leg evidence split and its
  binding evidence boundary. The owner approved the amended seam; the owner
  did **not** approve, and nothing in this record approves, any AC6 test
  result, implementation, manual run, or acceptance claim.

## Governing references

- Project Home (`.planning/synara-pi-durable-subagents/PROJECT.md`).
- Decision 0001 (testing-strategy governance).
- Decision 0014 (approval-authority precedent: delegated seam-design
  authority is not authority to self-approve an owner-reserved checkpoint).
- Decision 0028 (Ticket-16 owner-approved substitution precedent; Ticket-17
  does not inherit its authority beyond this explicit approval).
- Decision 0031 (authority adjudication; binding T17-AC6 evidence split and
  reopening conditions).
- Issue 17 — Approved amendment (2026-08-20, `/matt-implement`) — AC6
  destructive-boundary seam split, including its owner approval record.

## Effect on Decision 0031

Decision 0031 is an immutable historical binding direction and is unchanged
by this record. Its remaining pre-approval wording is accurate for its date
and stands as written. Every element of its settled direction remains in
force unchanged:

- The T17-AC6 evidence split remains an ordinary ticket-level seam
  refinement under Decision 0001, not a project-wide strategy change.
- The integrated real-Pi smoke path remains mandatory for every other stage.
- The three-leg mandatory evidence split and its exact required wording
  remain binding, and no subset is sufficient.

Decision 0031's Implementation permissions and prohibitions paragraphs that
keyed on the pending amendment are now read against the recorded owner
approval below; the implementation prohibitions endure verbatim (restated
under Prohibitions). Reopening conditions 2–4 remain available; condition 1
is discharged by this record and is not discharged for any other ticket.

## Current T17-AC6 three-leg evidence boundary

Binding and unchanged from Decision 0031; restated as the current operative
boundary with the owner's approval now attached:

1. **Mandatory hermetic real-Pi evidence** — the integrated smoke harness
   (which cannot pass on provider fakes): a deliberately wedged execution
   progresses through the watchdog stages, the provider session stops, and
   the teardown handoff is journaled (band 74 for the current
   attempt/generation), with stage-scoped diagnostics and the card honest
   through `cancelling`.
2. **Accepted deterministic Ticket-16 fixtures** — owned-only teardown
   authority, journal bands 75–78 identities, uncertain-outcome handling
   (`survivors` / `owner_unproven` non-terminal and retryable; escalation
   to `proven`), bounded survivor evidence (cap 16), and
   proof-before-fence / fencing semantics (`proven` settles `cancelled`
   and advances the generation).
3. **Mandatory isolated manual real-Pi evidence** — the Ticket-16 manual
   recipe, run in isolation on an operator-owned machine: actual
   no-owned-child-process remaining after proven teardown, observed through
   band-75/76 rows, the supervisor's TERM→KILL escalation in the process
   table, and the card settling `cancelled` with generation advanced,
   recorded as an operator-run record.

No subset of these legs is sufficient for T17-AC6.

## Permission granted

T17-AC6 tests may now be written and maintained against the approved
amended seam, without a further project-scoped owner-approved Decision
Record, provided the approved seam is not materially changed. A materially
changed seam, evidence boundary, or reported-outcome vocabulary requires a
fresh owner approval and a re-persisted record (Decision 0014 precedent).

This permission is permission to **build**, not evidence of completion.

## Prohibitions (enduring)

- **Deterministic/fixture-only T17-AC6 satisfaction is prohibited.**
- **Automated real-Pi destructive-pass claims are prohibited.** No
  automated destructive teardown test may be introduced into shared CI or
  reported as run for Ticket 17.
- The manual recipe may **not** be reported as executed unless an operator
  records an actual isolated run and its environment.
- Deterministic fixtures may not be reported as real-Pi evidence, nor the
  real-Pi leg as deterministic fixture evidence.
- No mock-only success; provider fakes cannot satisfy this ticket
  (T17-AC9).
- This approval may **not** be cited as owner approval for any other
  ticket's destructive-boundary substitution.

## Terminal-claim and closure gate

T17-AC6 may not be claimed satisfied, checked, or closed until:

1. all three mandatory evidence legs above are satisfied — including a
   recorded operator-run manual real-Pi run record for the isolated
   manual leg; and
2. the T17-AC6 terminal zero-owned-child claim derives from the manual leg
   alone.

The manual run record must precede any T17-AC6 terminal claim and precede
Ticket-17 closure, and is not satisfied by the deterministic fixtures or by
the real-Pi harness leg.

## Rejected alternatives

- Treating this record as a re-decision of the seam's technical direction
  (that authority was settled by Decision 0031 and is untouched here).
- Treating the owner's approval as approval of any test implementation,
  test result, manual run, or acceptance claim (no such approval exists).
- Reading Decision 0031's pre-approval wording as contradicted by this
  record (Decision 0031 is historical and accurate as of its date).
- Extending this approval to any other ticket's destructive-boundary
  substitution.

## Reopening conditions

Reassess this decision only on material evidence that:

1. the owner revokes or rewords this approval;
2. the approved seam, evidence boundary, or reported-outcome vocabulary
   materially changes (fresh approval then required);
3. the Ticket-16 teardown baseline, bands 75–78, or the manual recipe
   change materially; or
4. an envelope satisfying Decision 0028's reopening conditions emerges,
   enabling deterministic automated destructive proof.

## Superseded record

None. This record does not supersede Decision 0031; it discharges Decision
0031's reopening condition 1 and records the owner's approval of the
concrete amended T17-AC6 seam.
