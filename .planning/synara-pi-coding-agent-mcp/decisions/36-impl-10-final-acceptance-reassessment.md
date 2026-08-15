# Decision 36: impl-10 final acceptance reassessment

**Status:** Binding Reassessment — Accepted
**Trigger:** Material technical decision verification/escalation
**Date:** 2026-08-15
**Identifier:** synara-pi-mcp-decision-36
**Reassesses:** Decision 33
**Supersedes:** Only Decision 33's final-acceptance rejection gate and its
blocked downstream status

## Question

May impl-10 now receive final acceptance after material new evidence satisfied
every reopening condition in Decision 33, while preserving exact ownership
attribution among the impl-10 production commit, the separate maintenance
fixture repair, the later JSON-safe test-fixture typing correction, screenshot
evidence, and unrelated impl-11 work?

## Governing references

Authoritative:

- `../PROJECT.md`
- `../issues/impl-10-mcp-activity-ui.md`
- `../spec.md`
- `12-mcp-command-activity-contract.md`
- `20-testing-strategy-governance.md`
- `21-authenticated-mcp-session-authority.md`
- `31-formatter-gate-semantics.md`
- `33-impl-10-final-acceptance.md`
- Repository completion requirements in `../../../AGENTS.md`

Authoritative record-identity evidence:

- `35-impl-11-effective-catalog-observer-reassessment.md`, which already owns
  Decision 35 and remains untouched.

Supporting:

- Owner authorization to clear the repository checks: “okay tiếp tục đi”.
- `../issues/maint-34-mcp-authority-test-fixtures.md`.
- Impl-10 production commit `6b132f83`.
- Maintenance fixture-only commit `23df500b`.
- Clean-worktree gate commit
  `96f590a898350c73aebf0b1a21dc4b1634b6d308`.
- Later short identity `96f590a8`, whose relevant impl-10-adjacent change is
  JSON-safe test-fixture typing only.
- Screenshot evidence commit `782ee225`.
- Final gate logs `/tmp/impl10-final-gates-96f-test.log`,
  `/tmp/impl10-final-gates-96f-fmt.log`,
  `/tmp/impl10-final-gates-96f-lint.log`, and
  `/tmp/impl10-final-gates-96f-typecheck.log`.
- The focused impl-10 verification package and its exactly-one independent
  reviewer package.
- The maint-34 focused verification and independent maintenance reviewer
  package.
- `../../../CONTRIBUTING.md`.
- The prior challenged Supervisor consultation, which assessed every
  Decision 33 reopening condition as satisfied but correctly refused to reuse
  the already-occupied Decision 35 identity.

## Prior binding decision

Decision 33 rejected final acceptance of exact impl-10 source candidate
`6b132f83` because the repository completion gate was unresolved:

- the root suite remained red from 27 external, pre-existing server failures;
- the owner had not yet authorized `bun fmt`, `bun lint`, and
  `bun typecheck`, so no passing evidence existed for those checks; and
- before/after UI screenshots were still required before PR handoff.

Decision 33 explicitly found no impl-10 source or behavior defect. It found the
four technical criteria, Decisions 12 and 20 seams, focused verification, and
independent review satisfied. It required any later acceptance to be a
Reassessment of Decision 33.

This record is that Reassessment. It is not a second generic final-acceptance
consultation and does not reopen already-settled impl-10 technical findings
without contrary evidence.

## Material new evidence

### External server-test blocker repaired separately

Maintenance commit `23df500b` repairs the 27 pre-existing server failures by
supplying valid MCP session authority through test fixtures only. It changes no
production runtime or contract, adds no test, changes no assertion, and touches
no impl-10-owned file.

The same five focused files that previously produced 27 failures now pass:

- 5 test files passed;
- 383 tests passed;
- 3 tests skipped; and
- the 3 skips are unchanged from the red baseline.

The independent maint-34 reviewer returned `ACCEPT`. This evidence resolves
Decision 33's external server-suite blocker without absorbing the maintenance
work into impl-10.

### Clean-worktree repository completion gates

The required checks were run against the clean worktree pinned exactly to:

`96f590a898350c73aebf0b1a21dc4b1634b6d308`

The owner explicitly authorized clearing these checks by saying
“okay tiếp tục đi”.

Results:

- Root `bun run test`: Turbo reported 8 successful tasks out of 8.
- The server/CLI package suite reported 342 test files passed and 4015 tests
  passed, with only its recorded skips.
- `bun fmt`: exited with status `0`.
- `bun lint`: completed with 0 errors. Its reported warnings are non-gating and
  do not contradict the passing lint result.
- `bun typecheck`: Turbo reported 7 successful tasks out of 7.

These checks are one coherent final repository verification pass. No evidence
shows a dirty-worktree substitution or a different SHA.

### Decision 31 formatter treatment

Decision 31 defines the formatter completion gate as successful execution of
`bun fmt` with exit status `0`. It does not impose a separate zero-diff
worktree requirement and does not authorize unrelated formatter output to be
absorbed into a ticket.

The formatter completed with exit status `0` at the pinned gate commit.
Accordingly, the formatter reopening condition is satisfied under the
owner-approved semantics. Any unrelated formatter drift remains outside
impl-10 ownership and does not invalidate this gate.

### Proportionate verification after the production commit

The impl-10 production implementation remains commit `6b132f83`.

The later relevant change represented by `96f590a8` is JSON-safe test-fixture
typing only; it does not change impl-10 production behavior. It received
proportionate verification:

- focused impl-10 tests: 150/150 passed; and
- web typecheck: passed.

No SHA or impl-10 production surface changed after the prior challenged
consultation. The existing exactly-one independent impl-10 reviewer package
therefore remains current and reports `PASS`. A second independent
feature-level review is neither required nor authorized merely because the
Decision Record identifier was corrected.

### UI screenshot and DOM evidence

Screenshot commit `782ee225` contains Chromium before/after evidence only.

The after screenshot visibly renders the Synara MCP acknowledgement as a
system/work acknowledgement. Accompanying DOM evidence reports zero assistant
messages containing that acknowledgement. This confirms the user-facing
boundary required by impl-10 and Decision 12: the acknowledgement is rendered
as Synara work activity and is not falsely attributed to the assistant.

The screenshot commit is evidence-only. It does not change the accepted
impl-10 production surface.

### Record identity correction

Decision 35 is already uniquely and bindingly owned by
`35-impl-11-effective-catalog-observer-reassessment.md`.

The earlier challenged consultation reached the material conclusion that all
Decision 33 reopening conditions were satisfied but correctly refused to issue
a duplicate Decision 35. Decision 36 is the next unused unique identifier and
is the corrected identity for this impl-10 Reassessment. Decision 35 remains
untouched and authoritative for impl-11.

## Reopening-condition reconciliation

| Decision 33 reopening condition | Assessment | Evidence |
| --- | --- | --- |
| A fresh green root suite passes | Satisfied | At exact clean-worktree SHA `96f590a898350c73aebf0b1a21dc4b1634b6d308`, Turbo passed 8/8 tasks; the server/CLI package suite passed 342 files and 4015 tests |
| Owner explicitly authorizes `bun fmt`, `bun lint`, and `bun typecheck`, and all pass together | Satisfied | Owner said “okay tiếp tục đi”; formatter exit 0 under Decision 31, lint 0 errors, typecheck 7/7 |
| Candidate changes receive verification proportionate to their changed surface | Satisfied | Production commit remains `6b132f83`; later `96f590a8` is JSON-safe test-fixture typing only and passed focused 150/150 plus web typecheck |
| UI screenshots are produced before PR handoff | Satisfied | Chromium before/after evidence at `782ee225`; after shows a system/work acknowledgement and DOM evidence shows zero matching assistant messages |
| Governing evidence is not contradictory or inaccurate | Satisfied | No contradictory evidence was found; exact SHA and impl-10 surface have not changed since the challenged consultation |
| Independent integrated impl-10 review remains current | Satisfied | Exactly-one independent impl-10 reviewer package remains current and reports `PASS`; later changes do not alter impl-10 production behavior |

Every material reopening condition is satisfied.

## Reassessment and acceptance decision

Accept impl-10.

The accepted impl-10 production implementation is commit `6b132f83`, with
proportionate later verification through clean-worktree gate commit
`96f590a898350c73aebf0b1a21dc4b1634b6d308`.

This Reassessment supersedes only:

- Decision 33's final-acceptance rejection; and
- Decision 33's downstream instruction to represent impl-10 as
  `implementation-verified-final-acceptance-blocked`.

It does not supersede or reopen Decision 33's technical findings that:

- all four impl-10 acceptance criteria are satisfied;
- the Decision 12 activity contract is satisfied;
- the Decision 20 testing seams are satisfied;
- the original 27 server failures were external to impl-10; and
- impl-10 must not absorb unrelated server repair work.

Decisions 12, 20, 21, and 31 remain authoritative. Decision 35 remains the
binding impl-11 observer Reassessment and is not amended by this record.

## Exact ownership and evidence attribution

| Commit or evidence | Attribution | Included in impl-10 production ownership? |
| --- | --- | --- |
| `6b132f83` | Impl-10 production implementation | Yes |
| `23df500b` | Maint-34 test-fixture-only repair for the external Decision 33 blocker | No |
| `96f590a8` / full gate SHA `96f590a898350c73aebf0b1a21dc4b1634b6d308` | JSON-safe test-fixture typing plus the exact clean-worktree verification point | No new impl-10 production behavior; verification evidence only |
| `782ee225` | Chromium before/after and DOM evidence | No; evidence-only |
| Existing independent impl-10 reviewer package | Feature-level independent review of impl-10 | Review evidence |
| Independent maint-34 reviewer package | Review of the fixture-only blocker repair | Maintenance evidence only |
| Impl-11 committed or uncommitted work | Separate impl-11 ownership | No |

Impl-11 committed or uncommitted work is unrelated and excluded from impl-10
ownership, acceptance scope, and downstream status. Repository-wide gates may
exercise the integrated tree without transferring ownership of unrelated work
to impl-10.

## Rejected alternatives

- Reusing Decision 35 and creating a duplicate binding record identity.
- Leaving impl-10 rejected after every Decision 33 reopening condition has
  been satisfied.
- Treating this as a second generic final-acceptance consultation rather than a
  Reassessment of Decision 33.
- Folding maintenance commit `23df500b` into impl-10 ownership.
- Treating JSON-safe test-fixture typing at `96f590a8` as an unreviewed
  production behavior change.
- Requiring a second independent impl-10 reviewer when no impl-10 production
  surface changed.
- Treating lint warnings as errors despite the command completing with
  0 errors.
- Applying a zero-diff formatter requirement contrary to Decision 31.
- Treating screenshot evidence as production source.
- Including impl-11 committed or uncommitted work in impl-10 acceptance.
- Superseding Decision 33's technical findings, Decisions 12, 20, 21, or 31,
  or the binding impl-11 Decision 35.

## Assumptions

- The supplied commit identities and evidence attribution are accurate.
- The final gate logs correspond to exact clean-worktree commit
  `96f590a898350c73aebf0b1a21dc4b1634b6d308`.
- The existing independent impl-10 reviewer examined the complete integrated
  impl-10 behavior and remains independent of implementation.
- The later JSON-safe fixture typing does not alter the production work-log
  behavior accepted here.
- The screenshot and DOM package corresponds to the Chromium before/after
  evidence in `782ee225`.
- No impl-10 production SHA or owned surface changed after the prior challenged
  consultation.

## Residual risks and uncertainty

- The lint run reports warnings but no errors. The warnings are not evidence of
  an impl-10 defect and do not fail the configured lint gate.
- Repository-wide gates include unrelated work present at the pinned SHA.
  Their passing result proves integrated repository health at that point but
  does not transfer that work into impl-10 ownership.
- The maintenance fixture repair is necessary to restore repository tests but
  is not part of the impl-10 production implementation.
- Screenshot evidence proves the required Chromium rendering and assistant
  separation for the captured path; broader browser-wide replay smoke remains
  owned by impl-12 as stated by the impl-10 ticket.
- This acceptance does not assess or accept impl-11.

None of these residuals is material to impl-10 acceptance under the governing
contract.

## Failure and rollback implications

This Reassessment authorizes no source rollback, history rewrite, or
cross-ticket ownership change.

If later evidence invalidates the clean-worktree gate, independent review,
screenshot attribution, or the claim that post-`6b132f83` changes are
non-production fixture changes, impl-10 acceptance must be reopened before
dependent release claims continue.

A defect in maintenance commit `23df500b` must be handled under maint-34 unless
it also proves an impl-10 invariant false. An impl-11 defect remains an
impl-11 matter and does not retroactively become impl-10 ownership merely
because both were present in an integrated repository run.

## Allowed bookkeeping

After this record is persisted and tracked, the main agent may:

- update the impl-10 ticket status from
  `implementation-verified-final-acceptance-blocked` to accepted/completed;
- link Decision 36 from the impl-10 implementation-evidence section;
- record the exact commit and verification attribution stated here;
- mark Decision 33's repository-gate blocker resolved by this Reassessment;
- perform ordinary documentation, tracker, commit, and PR bookkeeping needed
  to represent the accepted state accurately; and
- proceed with downstream integration or PR handoff under normal repository
  governance.

This authorizes no production source change, no amendment of Decision 35, no
absorption of maint-34 or impl-11 into impl-10, and no unrelated formatting
normalization.

## Downstream effect

Impl-10 is accepted.

The durable project record must represent:

- production implementation: `6b132f83`;
- accepted verification point:
  `96f590a898350c73aebf0b1a21dc4b1634b6d308`;
- external fixture repair: `23df500b`, outside impl-10 ownership;
- screenshot evidence: `782ee225`, evidence-only;
- exactly-one independent impl-10 reviewer package: current and `PASS`; and
- Decision 36 as the Reassessment that resolves Decision 33's rejection gate.

Decision 33 remains authoritative for its technical findings and historical
rejection context. Its reject gate and blocked downstream status are
superseded by this record.

Dependent work may cite this record as aspect-scoped authoritative evidence
only after it is persisted at
`.planning/synara-pi-coding-agent-mcp/decisions/36-impl-10-final-acceptance-reassessment.md`
and confirmed tracked.

## Reopening conditions

Reassess this Decision 36 if:

- the impl-10 production surface changes after `6b132f83`;
- the JSON-safe typing change is shown to alter production behavior;
- the pinned clean-worktree gate evidence is invalidated or attributed to a
  different tree;
- the independent reviewer package is shown not to cover the integrated
  impl-10 implementation;
- screenshot or DOM evidence is shown not to represent the accepted behavior;
- an acknowledgement can enter assistant content, sidebar summaries, or
  pending-interaction state;
- live and replayed acknowledgement reduction cease to be equivalent;
- malformed or unsafe failure detail can corrupt work-log state or escape the
  bounded diagnostic contract;
- Decisions 12, 20, 21, or 31 are amended in a way material to impl-10; or
- the owner changes the Project Contract or repository completion policy.

## Superseded records

Decision 33 is not superseded as a whole. This Decision 36 supersedes only
Decision 33's final-acceptance rejection gate and its blocked downstream
status.

No other record is superseded. In particular:

- Decision 12 remains authoritative for the MCP activity contract.
- Decision 20 remains authoritative for testing strategy.
- Decision 21 remains authoritative for authenticated MCP session authority.
- Decision 31 remains authoritative for formatter-gate semantics.
- Decision 35 remains authoritative for impl-11 and retains its unique record
  identity.
