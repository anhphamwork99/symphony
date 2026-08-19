# Decision 0028 — Ticket 16 real-Pi destructive-test substitution

## Status

accepted by human owner

## Date

2026-08-19

## Candidate

- Symphony `73173b9c`
- Ticket 16 implementation `d5cb137a` plus remediation `47388a98`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

May Ticket 16 replace its conditional automated real-Pi destructive teardown
test with deterministic CI fixtures plus an isolated manual real-Pi
verification recipe?

## Governing references

- Decision 0001 — testing-strategy governance.
- Decision 0027 — Ticket 16 teardown outcome bands and restart ownership
  posture.
- Ticket 16 Testing Seams, implementation report, hermeticity investigation,
  substitution proposal, and manual verification recipe.

## Evidence

Ticket 16's first two deterministic Testing Seams were approved by the owner
on 2026-08-16 and are implemented.

The third seam proposed exercising the destructive boundary through a real Pi
provider. Investigation found that the result is not provably hermetic or
deterministic in shared CI:

- the same owned process-tree teardown flips between `proven` and `survivors`
  under load inside the 1.5-second SIGKILL polling window;
- the test emits real operating-system signals;
- shared CI scheduling affects the timing result;
- a passing or failing run therefore does not reliably distinguish correct
  code from host-load variation.

Ticket 16 already has deterministic coverage at the owned
process-supervisor/repository seams and records an isolated manual recipe for
exercising the real-Pi process tree.

## Owner decision

The human owner approves Option A:

1. CI uses deterministic process-supervisor, repository, coordinator, sweep,
   and adapter-wiring fixtures for Ticket 16.
2. The conditional automated real-Pi destructive teardown test is not required
   for Ticket-16 acceptance and must not be introduced into shared CI.
3. Real-Pi destructive verification is retained as an isolated manual
   verification recipe.
4. The manual recipe is supporting operational evidence, not a substitute
   claim that an automated real-Pi test ran.
5. Any future automated real-Pi destructive test must first prove process
   isolation and deterministic acceptance behavior, then reopen this decision.

## Rationale

Deterministic fixtures provide reliable evidence for the lifecycle contract:
owned-only dispatch, proof-before-fence, uncertain outcomes remaining
non-terminal, uncertain-to-proven retry, restart no-owner behavior, durable
journal identity, and stale-generation containment.

Running a destructive test whose result changes with host load would reduce CI
signal quality and could send operating-system signals in a shared
environment. The isolated manual recipe preserves a real-process verification
path without representing nondeterministic CI behavior as a release gate.

## Obligations

1. Keep the approved deterministic Ticket-16 tests in the acceptance evidence.
2. Keep the manual real-Pi recipe documented and explicitly labeled manual.
3. Do not claim that the manual recipe ran unless an operator records an actual
   run and its environment.
4. Complete Decision 0027's startup-order remediation and integrated
   regression before independent Ticket-16 review.
5. After implementation alignment, run exactly one independent feature-level
   review, followed by exactly one Supervisor final-acceptance consultation.

## Rejected alternative

Requiring the current real-Pi destructive test in shared CI is rejected because
its outcome is scheduler-sensitive, it emits real process signals, and its
pass/fail result is not a deterministic statement about Ticket-16 correctness.

## Reopening conditions

Reassess this decision only if material evidence demonstrates an automated
test envelope that:

1. owns an isolated process namespace or equivalent kill boundary;
2. cannot signal unrelated host or CI processes;
3. produces deterministic acceptance results under expected CI load; and
4. adds evidence not already covered by deterministic fixtures and the manual
   recipe.

## Superseded record

None. This decision closes the owner-approval requirement left open by
Decisions 0001 and 0027 for Ticket 16.
