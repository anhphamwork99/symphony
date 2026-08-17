# WP-05 — Independent review and Project Supervisor final acceptance

**State:** completed

**Owner roles:** reviewer, then supervisor; main orchestrator persists artifacts

**Repositories:** Symphony and pinned Alfie, read-only during consultations

**Dependencies:** complete integrated candidate, verification, and Issue 22 report

## Task

Obtain exactly one independent feature-level review package, reconcile it
against T22-AC1 through T22-AC8 and Decision 0006, then invoke the Project
Supervisor exactly once for Ticket-22 final acceptance. Persist accepted
tracker/decision changes only after the consultation.

## Context and authority

Reviewer evidence is evidence, not approval. The required lifecycle is:

```text
complete integrated candidate
  → verification
  → one independent feature-level reviewer
  → one Project Supervisor final-acceptance consultation
  → main orchestrator persists the resulting Decision Record and tracker state
```

Do not invoke final acceptance while the integrated candidate or evidence
package is incomplete. If review finds a blocker, repair and re-verify before
the one final consultation; preserve the same reviewer session when follow-up
evidence is needed instead of creating competing feature-level reviews.

## Authoritative references

- [Project Home](../../PROJECT.md)
- [Issue 22](../../issues/22-real-bounded-foreground-attachment.md)
- [Decision 0001](../../decisions/0001-testing-strategy-governance.md)
- [Decision 0006](../../decisions/0006-t22-bounded-foreground-attachment-technical-direction.md)
- Decisions 0002–0005 for accepted migration, real-Pi, admission, and
  control-health baselines

## Consultation write sets

- Reviewer: none
- Supervisor: none
- Main orchestrator after a binding result:
  - Issue 22 status/final-verdict annotation
  - `PROJECT.md` frontier update
  - next numbered Ticket-22 final-acceptance Decision Record

No source/test edits, no modification of Decisions 0001–0006, and no push,
publication, deployment, or release.

## Reviewer contract

Independently:

1. Reproduce the shortest fast, detached, reopen, concurrent, cleanup, and
   provenance paths from the report.
2. Return criterion-level verdicts for AC1–AC8 with exact evidence.
3. Audit:
   - no Symphony race around `originalExecute`;
   - one Alfie attachment timer;
   - seq1/2/3 order and durable-before-publication rules;
   - unchanged identities, operation ownership, and parent scope;
   - capability-gated legacy fallback;
   - lifecycle-write failure containment and unrelated-child isolation;
   - managed-only spinner suppression;
   - exact clean Alfie pin and hashes;
   - no migration or downstream-ticket scope;
   - package write-set and commit-order compliance.
4. Report critical/high/medium findings, evidence gaps, and nonblocking risks.

The reviewer must use the exact integrated candidate hashes and may not accept
asserted-only report content.

## Supervisor final-acceptance contract

Supply:

- exact Project Home;
- Decisions 0001–0006 as aspect-scoped authoritative references;
- Issue 22 ACs, approved Testing Seams, and completed report;
- integrated Symphony and Alfie hashes;
- focused/full verification evidence;
- the sole independent reviewer package;
- explicit trigger: **final acceptance**, not technical-decision verification;
- write set `none`.

The Supervisor returns acceptance, non-acceptance, or reassessment evidence.
The main orchestrator must persist any consequential Decision Record before
updating downstream authority.

On acceptance:

- mark Ticket 22 accepted/completed with evidence links;
- add the final-acceptance Decision Record to Project Home;
- advance blocker-free remediation frontier to Ticket 23;
- keep Ticket 06 blocked until Ticket 24 is accepted;
- record local-only commit and publication status.

## Verification reproductions

```bash
cd /Users/anhpham99/symphony/apps/server
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentRealExtension.test.ts \
  src/provider/piSubagentForegroundAcceptance.test.ts \
  src/provider/piSubagentForegroundReopen.test.ts
bun run test

cd /Users/anhpham99/alfie/agent/extensions/pi-subagents
bun run test
```

Do not run Symphony fmt/lint/typecheck without explicit owner authorization.

## Completion and commit rule

After reconciling the binding final result, the main orchestrator creates one
local planning commit for the Decision Record, Issue 22 status, and Project
Home frontier. Do not push.

## Challenge conditions

Any Decision-0006 reopening condition, stale/mismatched candidate, missing
criterion evidence, contradictory reviewer evidence, or source drift stops
acceptance and returns control to remediation/reassessment.
