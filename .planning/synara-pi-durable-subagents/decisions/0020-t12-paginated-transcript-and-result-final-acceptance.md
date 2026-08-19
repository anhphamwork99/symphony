# Decision 0020 — Ticket 12 paginated transcript and result final acceptance

## Status

**ACCEPT — Ticket 12 accepted.**

This is the exactly-one Project Supervisor final-acceptance consultation for
the complete integrated Ticket 12 feature. No prior Supervisor acceptance
consultation for Ticket 12 is superseded or reassessed.

## Date

2026-08-19

## Accepted candidate

The accepted Symphony source candidate consists of:

- Ancestor baseline
  `ae8e9c19b39e708f74be8f034a4f11422efbc323`, after the accepted Ticket 11
  fixed point established by Decision 0019.
- Ticket 12 implementation commit
  `8473fd968fd0e2c102ba7b825fa2b799cea94150`
  (`8473fd96`).
- Ticket 12 review-remediation commit and accepted fixed point
  `0094eaf9b5a0b008dccebc7ac8d5cddc8e88cc0a`
  (`0094eaf9`).

The repository's `main` ref was inspected and points exactly to
`0094eaf9b5a0b008dccebc7ac8d5cddc8e88cc0a`.

The Alfie extension is unchanged at:

- Commit `489acd626`.
- Package `@alfie/pi-subagents@0.14.0-alfie.1`.

No Alfie contract, capability, observation payload, or source change is
accepted by this decision. In particular, this decision does not claim that
Alfie reports a transcript reference before terminal observation.

Uncommitted or unrelated working-tree changes are excluded.

## Question

Does the complete integrated Ticket 12 candidate satisfy T12-AC1 through
T12-AC7, follow Decision 0001 and the owner-approved Ticket 12 Testing Seams,
preserve Decision 0019's reconnectable execution-card and transcript-not-
liveness boundaries, close the independent review findings, and provide a
production-ready authorized, bounded, paginated result/transcript read surface?

## Governing references

Authoritative:

- `.planning/synara-pi-durable-subagents/PROJECT.md`
- `.planning/synara-pi-durable-subagents/issues/12-paginated-transcript-and-result.md`
- `.planning/synara-pi-durable-subagents/reviews/12-paginated-transcript-and-result-review.md`
- `.planning/synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md`
- `.planning/synara-pi-durable-subagents/decisions/0019-t11-reconnectable-execution-card-final-acceptance.md`
- Symphony commits
  `8473fd968fd0e2c102ba7b825fa2b799cea94150` and
  `0094eaf9b5a0b008dccebc7ac8d5cddc8e88cc0a`

Supporting:

- `.planning/synara-pi-durable-subagents/spec.md`, as routed by Project Home.
- Git lineage from
  `ae8e9c19b39e708f74be8f034a4f11422efbc323` through the two accepted Ticket
  12 commits.

The supplied supporting path `/Users/anhpham99/symphony/spec.md` does not
exist. This is a non-material citation error because Project Home routes the
actual normative project specification at
`.planning/synara-pi-durable-subagents/spec.md`. That routed specification
confirms the applicable requirements: authorize reads, use bounded pagination,
keep unbounded content out of lifecycle/push surfaces, and never treat a
transcript as live-ownership evidence.

Aspect-scoped, unchanged boundaries:

- Decision 0001 remains authoritative for testing strategy and permitted,
  documented boundary substitutions.
- Decision 0019 remains authoritative for Ticket 11's card, reconnect,
  cancellation, content-exclusion, and authorization assumptions.
- Existing journal-first terminal truth, completion-delivery separation,
  generation fencing, and cancellation semantics are not reassessed or
  weakened.
- Ticket 12 adds read-only RPC behavior. It does not add a lifecycle command,
  projection truth source, push channel, execution-state mutation, or new
  principal model.

## Lifecycle honored

1. Decision 0019 accepted Ticket 11 and unblocked Ticket 12.
2. Ticket 12's criterion contract and owner-approved Testing Seams were
   persisted before implementation.
3. Ticket 12 was implemented at `8473fd96`.
4. One independent two-axis feature review was persisted, covering both
   documented standards and Ticket 12 specification conformance.
5. The review found authorization, deep-cursor budgeting, truncation
   inference, empty-page continuation, maintainability, stale-load, parsing,
   WS wiring, and Testing Seam issues.
6. Remediation `0094eaf9` addressed those findings, and the same independent
   evidence package returned PASS after remediation.
7. The Implementation Report records the approved-seam substitution required
   by the current orphaned-execution data model and the current trusted
   browser/owner transport authorization boundary.
8. Clean-tree focused and full verification evidence was recorded against the
   remediation candidate.
9. This exactly-one Supervisor consultation independently adjudicates the
   criteria and returns ACCEPT. Reviewer PASS is evidence, not acceptance
   authority.

## Settled verdict

**Accept Ticket 12. T12-AC1 through T12-AC7 pass.**

### T12-AC1 — PASS

Every result or transcript read first resolves the durable managed execution
and its parent thread/project relationship. Unknown executions, missing parent
threads, and project mismatches do not return content.

The production WS handler additionally binds MCP-originated reads through the
existing MCP authority machinery:
`McpSessionAuthority.resolveForThread`. An MCP connection may read only a
thread bound to the same authority; owning-authority success and
foreign-authority denial are covered at the read boundary.

Owner/browser connections use the existing trusted owner/browser transport
boundary, matching `getThreadDetailSnapshot`, which already exposes the
execution-card aggregate. The current server has no distinct per-thread
principal model for ordinary browser WS connections. Ticket 12 neither claims
nor introduces one.

This is accepted as reuse of the existing authorization boundary, not as proof
that a per-thread principal model exists.

### T12-AC2 — PASS

Knowing an `executionId` grants no read authority.

The read service distinguishes internal `not_found` and `denied` outcomes but
returns no result, transcript, metadata, or filesystem reference on either
path. Tests cover unknown identity, missing parent-thread projection, project
mismatch, owning MCP authority, and foreign MCP authority.

Denial mapping is pinned through the extracted
`piSubagentReadDenialToWsRpcError` boundary.

### T12-AC3 — PASS

Transcript retrieval is cursor/page based and bounded:

- Default page size: 50 entries.
- Maximum page size: 200 entries.
- Per-entry excerpt maximum: 4,000 characters.
- Per-page read ceiling: 1 MiB.
- Result summary response maximum: 4,000 characters.

Limit clamping, cursor progression, entry truncation, corrupt-entry skipping,
lookahead behavior, and deep-cursor byte-budget exhaustion are covered.

A deep cursor cannot repeatedly recharge an unbounded scan: byte-budget
exhaustion returns the stable
`pi_subagent_transcript_page_truncated` diagnostic on a non-continuable empty
page.

Both production methods use the existing `expensive-read` admission lane,
bounded to two concurrent reads.

### T12-AC4 — PASS

A genuinely truncated stored result summary is identified only when it is at
the ingest cap and ends with the ingest ellipsis marker. This avoids the
reviewed exact-cap false positive.

The result reply reports:

- `summaryTruncated: true`;
- stable diagnostic `pi_subagent_result_truncated`; and
- the opaque transcript continuation reference where available.

Boundary and browser tests cover a genuinely truncated result and retrieval
through the transcript continuation.

A nonterminal execution has no final result to continue. The absence of an
addressable nonterminal transcript is the Alfie observation limitation
recorded below; it is not reinterpreted as a successful or complete result.

### T12-AC5 — PASS

Full transcript or result content is confined to the two new explicit,
authorized, bounded WS RPC read replies:

- `orchestration.readPiSubagentResult`
- `orchestration.readPiSubagentTranscript`

Lifecycle events, execution-card snapshots, thread-detail events, metrics,
default logs, and WebSocket push do not carry full content.

The card-surface contract suite specifically pins exclusion of prompt,
transcript entries, and result content. No new content-bearing push channel or
projection mirror was added.

### T12-AC6 — PASS with accepted documented seam substitution

Read availability never changes or reinterprets durable execution state. The
read service echoes `observedState` from the durable aggregate and performs no
state write.

The owner-approved seam requested an available transcript for an orphaned
execution. That exact fixture is structurally impossible at the accepted Alfie
version: Alfie reports `transcriptRef` only in the terminal observation, while
restart-orphaned running executions never persist a reference.

The Implementation Report documents why the approved public fixture cannot be
constructed and retains the nearest useful public-boundary proof:

- an orphaned execution with no persisted reference returns
  `pi_subagent_transcript_missing` and remains `orphaned`;
- a succeeded execution with an available transcript remains `succeeded`;
- the browser renders the durable state verbatim and never changes
  “Orphaned” into “Running” because transcript evidence exists.

This is the smallest defensible substitution under Decision 0001. It pins all
structurally possible current paths and does not silently claim unavailable
capability.

### T12-AC7 — PASS

Missing, unavailable, corrupt, budget-exhausted, and entry-truncated transcript
conditions produce bounded stable read diagnostics.

Covered cases include:

- missing artifact → `pi_subagent_transcript_missing`;
- non-file or unavailable reference →
  `pi_subagent_transcript_unavailable`;
- corrupt entries skipped and counted →
  `pi_subagent_transcript_corrupt`;
- per-entry truncation →
  `pi_subagent_transcript_entry_truncated`;
- page scan budget exhaustion →
  `pi_subagent_transcript_page_truncated`.

These are read diagnostics only. They do not change the execution's desired
state, observed state, terminal outcome, attempt, generation, or completion
delivery state.

## Testing strategy adjudication

Decision 0001 is satisfied.

The ticket uses its owner-approved Testing Seams:

- authorized server read boundary for authorization, project/thread
  correlation, pagination, missing, unavailable, corrupt, and unchanged-state
  behavior;
- browser dialog boundary for paginated loading, truncation diagnostics,
  continuation, card switching, and empty-page termination;
- contract/card-surface boundary for content exclusion;
- execution state-mapping boundary for transcript-not-liveness.

The initial review identified missing WS wiring and expensive-read
classification evidence. Remediation added the nearest stable seams:

- pure denial-to-WS error mapping assertions;
- production caller-authority binding coverage;
- expensive-read admission classification coverage.

The exact orphaned-with-available-transcript fixture is replaced only because
the accepted Alfie payload cannot produce that state. The ticket documents the
reason, retains the nearest public-boundary test, and adds no broader
implementation-coupled substitute than necessary.

## Evidence inventory

### Committed lineage

- Baseline:
  `ae8e9c19b39e708f74be8f034a4f11422efbc323`.
- Implementation:
  `8473fd968fd0e2c102ba7b825fa2b799cea94150`.
- Review remediation and accepted head:
  `0094eaf9b5a0b008dccebc7ac8d5cddc8e88cc0a`.

### Independent review

- `.planning/synara-pi-durable-subagents/reviews/12-paginated-transcript-and-result-review.md`
- Two axes: Standards and Specification.
- Remediation re-review verdict: PASS.
- Review-focused verification:
  - server read boundary: 10/10;
  - transcript reader: 9/9;
  - combined server remediation set: 71/71;
  - post-cleanup ticket-owned server files: 18/18;
  - web dialog browser suite: 5/5;
  - execution-card strip component: 6/6.

### Implementation Report verification

- Server read-boundary and reader suites: 18 passed.
- Server card surface, admission, terminal lifecycle, restart reconciliation,
  and repository suites: 53 passed.
- Contracts full suite: 229 passed.
- Web dialog browser suite: 5 passed.
- Web strip/store/reducer suites: 64 passed.
- Server full suite: at least 4,716 passed, 0 failed, 17 skipped; rerun remained
  green after remediation.
- Web full suite: 3,892 passed.
- Root typecheck: 7/7 tasks.
- Formatting: clean.
- Lint: 0 errors, with pre-existing warnings only.

The recorded first-pass web environment flake was transient: the same suite
passed on rerun and in the final clean-tree pass. No evidence ties it to the
candidate.

## Independent review findings and dispositions

### Caller identity / T12-AC1

Closed by `0094eaf9`.

Production WS reads use `McpSessionAuthority.resolveForThread` for MCP
connections. Owning and foreign authority behavior is tested. Trusted
owner/browser transport remains consistent with the existing
`getThreadDetailSnapshot` boundary.

### Deep-cursor byte-budget reuse

Closed by `0094eaf9`.

Budget exhaustion becomes a stable, non-continuable bounded page response
instead of allowing repeated budget recharge from byte zero.

### Truncation inference

Closed by `0094eaf9`.

At-cap content is considered truncated only when the ingest ellipsis marker is
also present.

### Empty-page Load-more loop

Closed by `0094eaf9`.

The browser stops continuation after a zero-entry page, even if a malformed or
exhausted upstream page claims more.

### Duplicate bounded-text logic

Closed by `0094eaf9`.

Shared `piSubagentBoundedText.ts` logic is used by the new readers and the
pre-existing terminal, restart-reconciliation, and repository excerpt sites.

### Dead page-truncated literal

Closed by `0094eaf9`.

`pi_subagent_transcript_page_truncated` now has one production emission path
for byte-budget exhaustion.

### Stale dialog load closure

Closed by `0094eaf9`.

Initial loading keys on explicit `loadedExecutionId` state, and switching cards
reloads without suppressed dependency checking.

### Placeholder transcript index

Closed by `0094eaf9`.

`parseEntry(line, index)` assigns the stable cursor index at construction.

### Missing WS/admission boundary coverage

Closed by `0094eaf9`.

Denial mapping and expensive-read classification have focused boundary tests.

### Approved orphaned-available seam

Dispositioned through the documented Decision 0001 substitution described
under T12-AC6. This is an accepted architecture limitation, not an assertion
that the impossible fixture was tested.

No finding remains acceptance-blocking.

## Accepted residual limitations

### AC6 — orphaned executions lack an addressable transcript reference

At Alfie `489acd626` / `0.14.0-alfie.1`, `transcriptRef` is reported only in
terminal observation. Progress and heartbeat observations do not carry the
artifact path.

A running execution that becomes orphaned after restart therefore has no
persisted transcript reference. Its transcript read returns
`pi_subagent_transcript_missing` even if an artifact still exists somewhere on
disk, because the server has no authorized opaque reference by which to address
it.

This limitation is accepted because the implementation:

- does not search or expose arbitrary filesystem paths;
- reports the missing evidence honestly;
- leaves the durable execution state unchanged;
- never treats artifact existence as evidence of liveness; and
- documents that making nonterminal artifacts addressable requires a future
  Alfie contract change.

### AC1 — trusted browser/owner transport boundary

The ordinary browser WS path has no independent per-thread principal model.
Ticket 12 follows the existing `getThreadDetailSnapshot` precedent and trusts
the authenticated owner/browser transport boundary.

MCP-originated reads do have an independently bound authority and are checked
through `McpSessionAuthority.resolveForThread`.

This limitation is accepted only as preservation of the current authorization
model. Ticket 12 does not establish a general claim that browser threads have
separate principals, ACLs, or multi-tenant isolation beyond the trusted
connection boundary.

## Rejected alternatives

- **Reject solely because the approved orphaned-with-available-transcript
  fixture cannot be built:** rejected. The limitation follows from the
  accepted Alfie observation contract; the ticket documents it and provides
  the nearest structurally possible state-preservation proof allowed by
  Decision 0001.
- **Invent or scan for an orphaned transcript path:** rejected. Filesystem
  discovery would weaken authorization, opacity, predictability, and failure
  behavior.
- **Require an Alfie extension change before accepting Ticket 12:** rejected.
  Addressability before terminal observation is useful future scope but is not
  required to deliver honest bounded reads for persisted references.
- **Require a new per-thread browser principal model:** rejected as outside the
  accepted Ticket 12 contract. The ticket preserves the existing trusted
  owner/browser boundary and adds a real MCP-authority binding where such an
  authority exists.
- **Treat execution/project correlation alone as caller authorization:**
  rejected. Remediation added caller-authority enforcement for MCP sessions.
- **Send transcript pages through lifecycle events, snapshots, or push:**
  rejected. It would duplicate state, increase reconnect and memory cost, and
  violate T12-AC5.
- **Use an unbounded read or repeatedly rescan deep cursors without a total
  request budget:** rejected. The accepted implementation has fixed response,
  entry, page, and byte ceilings.
- **Continue offering Load-more after a zero-entry page:** rejected because it
  creates a user-visible retry loop without progress.
- **Reject due to the transient web-suite environment flake:** rejected. It
  passed on rerun and in the final pass, with no candidate-specific contrary
  evidence.
- **Accept solely because the reviewer returned PASS:** rejected. Acceptance
  follows criterion-level adjudication, committed-lineage confirmation,
  testing-governance review, and residual-risk analysis.
- **Reopen Decision 0019 or prior lifecycle/cancellation decisions:** rejected.
  Ticket 12 is read-only and no evidence shows that it weakens their accepted
  invariants.
- **Require another independent review or another Supervisor consultation:**
  rejected. The project's one-review-package and exactly-one final-acceptance
  lifecycle is complete.

## Assumptions and residual uncertainty

- The reproduced verification evidence corresponds to the exact accepted
  commits named above.
- The durable repository's execution, thread, project, attempt, and generation
  fields remain authoritative as exercised by the tests.
- The owner/browser WS transport remains a trusted single-owner boundary, as
  used by the existing thread-detail snapshot path.
- MCP thread bindings remain authoritative for MCP-originated reads.
- The opaque `transcriptRef` remains server-controlled and is not interpreted
  as user-supplied filesystem authority.
- JSONL transcript artifacts may disappear, expire, become directories, or
  contain corrupt entries; the accepted behavior is stable read diagnostics,
  not guaranteed artifact retention.
- Cursor indices are line-stable for the artifact being read. This decision
  does not establish append-snapshot isolation or immutable archival retention
  beyond the tested file-reader behavior.
- A nonterminal or orphaned execution remains without an addressable transcript
  until Alfie reports and Synara persists a reference.
- No deployment, release, publication, external write, schema rollback, or
  principal-model expansion is authorized by this decision.
- Project Home's narrative frontier text is stale where it still describes
  Ticket 11 acceptance as pending. The routed Decision 0019 is the
  authoritative accepted ancestor and is not reopened.

## Downstream effect

- Ticket 12 is accepted and complete at Symphony
  `0094eaf9b5a0b008dccebc7ac8d5cddc8e88cc0a`.
- Ticket 11 remains accepted under Decision 0019 and is not reopened.
- Alfie remains unchanged at `489acd626` / `0.14.0-alfie.1`.
- Production result/transcript reading now has an accepted authorized,
  bounded, cursor-paginated, read-only fixed point.
- Full result/transcript content remains confined to explicit expensive-read
  RPC replies.
- No ticket file declares Ticket 12 in its `Blocked by` list. Ticket 12
  acceptance therefore does not, by itself, make a declared blocked ticket
  blocker-free.
- Ticket 17's T17-AC4 requires child completions to remain individually
  retrievable by execution identity. That acceptance leg may now use Decision
  0020 as its accepted transcript/result-read baseline. Ticket 17 nevertheless
  remains blocked by its declared unfinished prerequisites, including Tickets
  15 and 16.
- Tickets 14 and 15 are independently blocker-free under their declared
  dependencies; this decision does not change their contracts.
- Ticket 16 remains blocked by Ticket 15.
- Project Home should route Decision 0020, mark Ticket 12 complete, remove its
  stale Ticket 11/Ticket 12 frontier wording, and preserve the independent
  Ticket 14/15 frontier and Ticket 16/17 dependency chain.

## Failure and rollback implications

Rolling back `0094eaf9` reintroduces reviewed defects, including incomplete
MCP caller authorization, deep-cursor budget abuse, false-positive result
truncation, empty-page continuation loops, stale dialog loading, duplicated
bounded-text logic, and missing WS/admission boundary evidence. Ticket 12 must
then return to NEEDS REMEDIATION.

Rolling back `8473fd96` removes the authorized result/transcript contracts,
server read service, transcript reader, WS RPC methods, expensive-read
classification, and browser dialog. Ticket 12 is no longer implemented.

A partial rollback must not:

- return content before execution/thread/project and applicable caller
  authorization;
- expose metadata or filesystem references on denial or unknown identity;
- remove entry, page, response, or byte ceilings;
- place full content in lifecycle events, snapshots, metrics, logs, or push;
- treat transcript availability as execution liveness;
- mutate execution outcome in response to a read failure;
- make corrupt or unavailable evidence an unbounded retry loop;
- accept arbitrary client filesystem paths as transcript authority; or
- claim orphaned transcript addressability without a persisted authorized
  reference.

No schema rollback is required because Ticket 12 adds no migration or new
durable projection table.

## Reopening conditions

Reopen Ticket 12 through a new numbered Decision or Reassessment if material
evidence shows any of the following:

- the accepted candidate differs materially from
  `8473fd968fd0e2c102ba7b825fa2b799cea94150` plus
  `0094eaf9b5a0b008dccebc7ac8d5cddc8e88cc0a`;
- a caller can read an execution outside its authorized project/thread or MCP
  authority;
- unknown or denied execution identity leaks metadata, result content,
  transcript content, opaque references, or filesystem paths;
- result or transcript reads become unbounded in entries, characters, bytes,
  concurrency, or response size;
- a deep cursor can repeatedly bypass the per-request scan budget;
- truncation is omitted for genuinely omitted result content or asserted for
  known untruncated exact-cap content;
- continuation can loop indefinitely without returning entries or making
  cursor progress;
- full content appears in lifecycle events, execution snapshots, metrics,
  default logs, or WebSocket push;
- transcript availability, file existence, or a read result changes or is
  interpreted as live execution ownership;
- missing, unavailable, corrupt, expired, or truncated transcript evidence
  changes durable execution outcome;
- card switching can show another execution's stale result or transcript;
- MCP authority binding no longer matches the parent thread;
- the trusted browser/owner transport assumption becomes invalid, such as
  introduction of multiple principals or cross-user thread access without a
  corresponding authorization model;
- Alfie begins reporting a preterminal transcript reference and the accepted
  AC6 limitation or tests no longer cover the newly possible orphaned-with-
  available-transcript state;
- transcript references become user-controlled filesystem authority;
- focused Ticket 12 tests or clean-tree full suites reproducibly fail for
  candidate-specific reasons;
- implementation of a downstream ticket materially changes the accepted read,
  authorization, pagination, content-exclusion, or transcript-not-liveness
  boundaries; or
- material new evidence contradicts the ticket contract, owner-approved
  Testing Seams, independent review package, or this decision.

## Superseded records

None.

The pre-remediation findings remain historical evidence in the Ticket 12
independent review artifact. They are not a prior Supervisor Decision and are
therefore closed by the accepted remediation rather than superseded as a
numbered decision.
