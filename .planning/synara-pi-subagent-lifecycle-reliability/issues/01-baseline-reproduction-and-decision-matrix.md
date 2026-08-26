# Ticket 01 — baseline, reproduction, and decision matrix

**Status:** ready-for-agent
**Blocked by:** none
**Type:** read-only grounding; no source edits
**Next unlock:** Ticket 02 only after the project router accepts the report

## Objective

Reproduce the public/hidden identity mismatch and map the existing Symphony /
Alfie lifecycle seams, inherited decisions, failure modes, and material design
gates. Produce evidence that downstream implementation agents can use without
inventing architecture.

## Acceptance criteria

- **T01-AC1:** Confirm the Symphony base and Alfie pin, repository cleanliness
  for the assigned read-only worktree, and exact source locators.
- **T01-AC2:** Reproduce or deterministically demonstrate that public detached
  output exposes `executionId` while hidden details/provider lookup use
  `agentId`, and show the strict GET_RESULT failure behavior.
- **T01-AC3:** Map durable admission, terminal/outbox, restart, watchdog, and
  teardown seams, including bands 70–78 and proof-before-fence boundaries.
- **T01-AC4:** Build a matrix covering active progress, terminal success/fail,
  provider record eviction, restart orphaning, stale evidence, unauthorized
  reads/controls, inactive provider Resume, and cleanup uncertainty.
- **T01-AC5:** Separate settled invariants from open gates; explicitly record
  the four candidate directions without selecting them.
- **T01-AC6:** Produce delegation-ready inputs for Ticket 02 and identify the
  minimum testing seams and required failure/diagnostic assertions.
- **T01-AC7:** Make no source, test, configuration, Alfie, or existing-project
  edits; research remains supporting evidence.

## Testing / evidence seam

Read-only source inspection plus existing focused tests/fixtures. If a runtime
reproduction is required, use an isolated disposable fixture and record exact
commands/environment; do not use the user's live Synara/Pi instance. Do not
claim a real-Pi acceptance result from a fake or from source inspection alone.

## Required deliverables

- incident reproduction with public/hidden/durable identity values;
- source-evidence locator table;
- current seam map and failure matrix;
- settled/open decision table;
- downstream Ticket-02 delegation packet with dependencies and blocked gates.

## Implementation Report placeholder

Not applicable to this read-only ticket. The agent must return:

- **Change surface:** `none` (planning report only if requested by owner);
- **Evidence:** commands, locators, reproduction/matrix rows;
- **Failure surface:** observed diagnostics and unresolved cases;
- **Scope audit:** source diff empty; existing projects untouched;
- **Recommendation:** exact gates required before Ticket 02 becomes ready.

## Guardrails

Do not implement an identity alias, durable read path, provider bootstrap,
crash guardian, orphan-terminal exception, owner receipt, or Resume change.
Those are downstream decision gates.
