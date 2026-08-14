# Decision: Bounded workspace typecheck correction required for impl-08 completion

**Status:** Binding
**Trigger:** Material technical decision verification — reviewer finding F2
**Date:** 2026-08-14

## Question

May impl-08 expand its corrective write set to repair all seven TypeScript
errors currently preventing `bun typecheck` from passing, or must work stop
pending a human-owner waiver or change to the completion rule?

## Governing references

Authoritative:

- `../PROJECT.md` — Project Home and authoritative routing.
- Repository `AGENTS.md` — authorized-check and task-completion requirements.
- `../issues/impl-08-project-propagation-wait-set.md` — impl-08 scope, current
  status, and implementation evidence.
- `20-testing-strategy-governance.md` — project testing strategy and final-check
  requirements.

Relevant prior records:

- `24-impl-07-final-acceptance.md`
- `25-impl-07-corrective-reassessment.md`

Supporting evidence:

- Current `PATH="$HOME/.bun/bin:$PATH" bun typecheck`: six of seven packages
  pass; `@synara/cli` reports seven errors at six files/seven locations.
- Feature-level reviewer verdict `changes-requested`, finding F2 classified as
  high-governance.
- Current integrated candidate ends at commit `9cd736cf`.
- Worker and reviewer evidence classify the seven errors as matching the
  pre-existing baseline.

## Context

`AGENTS.md` requires `bun fmt`, `bun lint`, and `bun typecheck` all to pass
before a task may be considered complete. The user authorized these checks by
requesting implementation completion and commit through `matt-implement`.

The impl-08 ticket nevertheless marks itself done while reporting seven
baseline TypeScript errors. A command that exits non-zero has not passed;
“passes with seven errors” is not a valid interpretation of the completion
rule.

Prior impl-07 acceptance records classified these errors as pre-existing
workspace risk for impl-07. Those ticket-scoped decisions neither amend the
repository-wide completion rule nor establish a permanent waiver for impl-08.

Repairing the bounded errors is compatible with the project's working-
implementation goal and early-WIP maintainability guidance. It does not change
the product outcome or absorb another feature ticket.

## Decision

Authorize and require one bounded corrective Work Package that fixes all seven
reported TypeScript errors on the current impl-08 candidate branch.

No human-owner waiver is needed for this corrective work. A human-owner waiver
would be required only if the proposed outcome were to retain one or more
errors while still declaring impl-08 complete.

The correction must preserve runtime behavior and existing project invariants.
It must correct the underlying typing or implementation mismatch rather than
silence diagnostics.

impl-08 is corrective-pending until the correction, verification, commit, and
updated independent review evidence are complete. This decision does not
perform or prejudge final acceptance.

## Allowed implementation write set

Only these six files may be modified by the corrective Work Package:

1. `apps/server/src/agentGateway/httpRoute.test.ts`
2. `apps/server/src/agentGateway/Layers/McpSessionAuthority.ts`
3. `apps/server/src/orchestration/decider.ts`
4. `apps/server/src/orchestration/projectActivation.test.ts`
5. `apps/server/src/orchestration/synaraMcpCommand.ts`
6. `apps/server/src/wsRpc.ts`

The two reported `wsRpc.ts` diagnostics are part of the same allowed file.

The main agent may separately persist this Decision Record and update the
impl-08 ticket's status/evidence as governance bookkeeping. Those planning
artifacts are not part of the corrective source-code commit.

## Prohibited write set and approaches

The corrective Work Package may not:

- modify any source or test file outside the six-file allowlist;
- change contracts, schemas, public APIs, protocol behavior, `tsconfig`,
  compiler strictness, package scripts, or workspace configuration;
- introduce `any`, unsafe type assertions, `@ts-ignore`, `@ts-expect-error`, or
  equivalent diagnostic suppression merely to make typecheck green;
- absorb impl-09 restart recovery or any unrelated feature work;
- alter accepted impl-06/impl-07 lifecycle, authorization, cancellation,
  journal-first, generation, or fail-closed invariants;
- include formatter-generated unrelated changes;
- combine unrelated cleanup with the corrective commit.

If source inspection shows that a sound fix necessarily requires a file outside
the allowlist or changes a governing invariant, API, or schema, stop and reopen
this decision with the exact dependency evidence. Do not silently broaden the
write set.

## Verification

The corrective Work Package must provide:

1. Focused tests for behavior affected by corrections in the six allowed files,
   including relevant failure and diagnostic paths. Tests must be invoked
   through `bun run test`, never `bun test`.
2. A clean `git diff --check`.
3. One bundled final heavyweight verification pass:
   - `bun fmt`
   - `bun lint`
   - `PATH="$HOME/.bun/bin:$PATH" bun typecheck`
4. Zero TypeScript errors across the workspace. “Same baseline count” is not a
   pass.
5. Confirmation that formatting produced no committed changes outside the
   allowed corrective write set.
6. One corrective implementation commit containing only the bounded source and
   test correction.
7. Updated independent feature-review evidence before final acceptance.

A failed heavyweight command must be diagnosed and corrected or escalated; it
may not be relabeled as passing because the failure was pre-existing.

## Rejected alternatives

- Declaring impl-08 complete while retaining the seven errors.
- Treating the impl-08 ticket's baseline wording as a waiver from `AGENTS.md`.
- Extending impl-07's ticket-scoped residual-risk acceptance into a permanent
  workspace-wide exception.
- Requiring owner intervention before applying an already-authorized,
  completion-required, bounded correction.
- Broad repository cleanup beyond the seven reported errors.
- Weakening compiler or type safety to obtain a green command.

## Assumptions

- The supplied seven-error report accurately reflects current commit
  `9cd736cf`.
- The errors remain confined to the six named files.
- They can be repaired without changing public behavior or governing
  invariants.
- The user's implementation and completion request remains the authorization
  for the final heavyweight checks.

## Residual uncertainty

The exact TypeScript diagnostic messages were not included in the Supervisor
consultation, so this decision does not prescribe individual code edits.

The candidate range for final evidence is `2bfeb1d0...HEAD`; the feature
implementation itself starts at `ebc3060c`.

Formatter behavior may touch files outside the allowlist. Such changes must not
enter the corrective commit; if a genuinely required formatter change cannot
be confined safely, the Work Package must stop and reopen the write-set
decision.

## Downstream effect

- Reopen impl-08 from `done` to `corrective-pending`.
- Persist and track this Decision Record before issuing the corrective Work
  Package.
- Permit the worker to modify only the six allowed files and produce one
  corrective implementation commit.
- Require refreshed focused and heavyweight verification evidence.
- Require updated independent feature-level review evidence.
- Do not invoke final acceptance until those steps are complete.
- If all checks pass, no owner waiver is needed.

## Failure and rollback implications

If the correction causes behavior regressions, violates an accepted invariant,
requires an out-of-set dependency, or cannot make all required checks pass,
the candidate remains incomplete and must be reassessed.

Rollback of the corrective commit restores the known red typecheck state and
therefore restores the completion blocker. It does not authorize declaring the
ticket done.

## Reopening conditions

Reopen this decision if:

- a sound correction requires modifying a file outside the allowlist;
- an error can only be resolved through an API, schema, protocol, compiler, or
  governing-invariant change;
- the current diagnostics differ materially from the supplied seven-error
  evidence;
- focused tests expose a behavior regression or previously unknown feature
  defect;
- the heavyweight pass remains red after the bounded corrections;
- owner direction explicitly waives or changes the completion rule; or
- the candidate commit range cannot be reconciled before final evidence is
  recorded.

## Superseded records

None. This decision narrows the treatment of baseline errors for impl-08 but
does not reopen or supersede the ticket-scoped impl-07 acceptance decisions.
