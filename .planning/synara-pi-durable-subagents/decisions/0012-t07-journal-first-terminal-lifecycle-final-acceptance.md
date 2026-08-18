# Decision 0012 — Ticket 07 final acceptance (journal-first terminal lifecycle)

## Status

**accepted** (binding; Decisions 0001–0011 remain authoritative and unchanged)

**Date:** 2026-08-18

## Accepted candidate

- Symphony implementation commit
  `fe4d1fa331051da7af0c344796f5e95cecb84b9d` (`fe4d1fa3`) plus
  review-remediation commit
  `d44f624ffecf636b20c7e059b0d1d396331a204e` (`d44f624f`; F1
  mixed-version host gate, F2 bounded metadata, provenance re-pin, and
  review-disposition documentation).
- Alfie implementation commit
  `bcfe6eddabad952fde0b87ddbeb92676967ea1bd` (`bcfe6edda`) plus
  review-remediation commit
  `608c1c57d31151ae2b2c4ededd8036f56f9355cd` (`608c1c57d`;
  `@alfie/pi-subagents@0.13.0-alfie.1`, capability
  `journal-terminal-lifecycle`, host-gated terminal reporting).
- `piSubagentExtensionProvenance.json` pins Alfie
  `608c1c57d31151ae2b2c4ededd8036f56f9355cd`, package version
  `0.13.0-alfie.1`, and SHA-256 hashes for `package.json`, `src/index.ts`,
  and `src/agent-manager.ts`. The post-remediation evidence records byte-exact
  verification at this pin. The package and agent-manager artifacts are
  unchanged from the reviewed pin; the modified index artifact is re-hashed
  and re-pinned.

## Question

Does the Ticket 07 candidate at Symphony `fe4d1fa3` + `d44f624f` and Alfie
`bcfe6edda` + `608c1c57d` satisfy T07-AC1 through T07-AC7 under the
owner-approved Testing Seams and Decisions 0001–0011, such that this decision
accepts Ticket 07, accepts the recorded findings dispositions, advances the
blocker-free frontier to Ticket 08, and advances the Alfie provenance pin to
`608c1c57d` / `0.13.0-alfie.1`?

## Governing references

Project Home; Issue 07 (normative T07-AC1..T07-AC7, owner-approved Testing
Seams, complete Implementation Report, independent-review outcome, and
post-review remediation record); Decisions 0001–0011, especially Decision
0001's lifecycle/failure/diagnostic testing governance, Decision 0008's
per-file standalone wallclock acceptance method, Decisions 0009/0010's
server-side lease-authority re-derivation obligation, and Decision 0011's
acceptance of Ticket 06 and advancement to Ticket 07; Specification
Implementation Decisions 15, 16, 17, 20, and 21; the Ticket 07 independent
feature-level review; and Tickets 08 and 10 for downstream ownership.

The approved Testing Seams are binding for evidence placement and are not
reopened by this decision. Completion delivery remains Ticket 08 scope;
restart reconciliation remains Ticket 10 scope. This decision does not weaken
journal-first terminal evidence or alter the standing lease-authority
obligation.

## Lifecycle honored

Ticket 06 accepted and Ticket 07 unblocked by Decision 0011 → implementation
at Symphony `fe4d1fa3` and Alfie `bcfe6edda` → complete Implementation Report
in Issue 07 → exactly one independent feature-level review on 2026-08-18
(PASS, high confidence, T07-AC1 through T07-AC7 all reproduced, findings
F1–F5 none blocking) → review remediation at Symphony `d44f624f` and Alfie
`608c1c57d` for F1/F2, with focused post-remediation verification and
provenance re-pin → one Project Supervisor final-acceptance consultation
(activation class 2) → ACCEPT.

## Settled verdict — Accept Ticket 07. T07-AC1 through T07-AC7 all pass.

- **T07-AC1 (terminal durable before completion delivery): PASS** —
  `recordTerminalEvent` journals and applies terminal truth in one transaction.
  `ingestPiSubagentTerminal` invokes `onTerminalPersisted` only after that
  transaction returns successfully. Persistence failure emits
  `pi_subagent_terminal_persistence_failed`, degrades control health, rejects
  the producer where possible, and never notifies. The real-Pi inline
  acceptance path observes durable `succeeded` before the result handle
  returns, without a settling sleep.

- **T07-AC2 (deduplication and first applicable terminal wins): PASS** —
  deterministic event identity plus the attempt/generation/sequence uniqueness
  seam gives an exact replay one state effect. Same-sequence different-state
  racers return already applied. Both the dedicated terminal repository seam
  and the repaired generic lifecycle path prevent any later terminal from
  overwriting an already-terminal aggregate.

- **T07-AC3 (diagnosable sequence gaps without delaying terminal): PASS** —
  attempt-local prior sequence is measured before journal insertion. A gap
  emits stable `pi_subagent_event_sequence_gap` diagnostics only after the
  terminal has persisted; no deletion, rollback, retry barrier, or delivery
  delay is introduced.

- **T07-AC4 (attempt/generation fencing and stale counting): PASS** —
  superseded attempt or generation evidence is journaled as history, increments
  durable `stale_terminal_events`, emits
  `pi_subagent_terminal_stale_ignored`, and cannot mutate current execution
  truth. Current-attempt terminal evidence remains applicable afterward.

- **T07-AC5 (bounded summary and transcript reference): PASS** — the server
  bounds result summaries at the resolved configuration cap before persistence
  and emission. Review remediation additionally bounds `transcriptRef` to
  1,024 characters, `outcomeState` to 256, and `diagnosticMessage` to 2,048.
  Alfie applies its producer summary bound and reports the output-file
  transcript reference. Real-Pi evidence proves the transcript artifact exists
  and no unbounded raw transcript is carried in terminal lifecycle payloads.

- **T07-AC6 (terminal protected from progress saturation/degradation): PASS** —
  terminal observations bypass the progress coalescer and use the durable
  lifecycle repository path. Tests prove terminal persistence with 200 failing
  progress writes and during a 5,000-observation flood while a real coalescer
  slot is pending; accounting remains bounded and exactly one terminal row is
  present.

- **T07-AC7 (cancel-versus-complete single terminal owner): PASS** — Alfie
  produces no normal terminal payload for aborted or stopped records, leaving
  cancellation settlement to the durable cancellation path. If cancellation
  settles first, a late completion is journaled and counted as stale; if normal
  completion settles first, a late cancellation acknowledgement cannot regress
  the aggregate. Neither direction permits state flip-flop.

## Evidence summary

The independent reviewer returned **PASS**, confidence **High**, with all seven
acceptance criteria passing and no blocking finding.

The reviewer independently reproduced:

- Terminal lifecycle state-machine suite: 12/12.
- Real-Pi terminal acceptance: 2/2 against the pinned extension.
- All eight wallclock suites through Decision 0008's binding per-file
  standalone method: ForegroundAcceptance 6/6, ForegroundReopen 1/1,
  ForegroundLifecycle 5/5, RealExtension 11/11, ProgressAcceptance 1/1,
  IntegratedAcceptance 7/7, CancellationAcceptance 2/2, and
  TerminalAcceptance 2/2.
- Alfie extension suite: 31 files / 491 tests at the reviewed pin.
- Migration 101 suites, repository/bridge/cancellation/progress suites,
  configuration 171/171, main 39/39, and TypeScript checks in both
  repositories.
- Full unit project: 4,514 passed, with only the seven documented pre-existing
  CursorTextGeneration environment failures.
- Provenance hashes byte-for-byte at the reviewed Alfie pin.

Post-review remediation evidence records:

- A new Alfie mixed-version gate test proving that a host without
  `journal-terminal-lifecycle` receives no terminal observation and preserves
  the inline success result; a later capable handshake re-enables terminal
  reporting.
- Alfie suite 31 files / 492 tests after remediation.
- TerminalAcceptance and CancellationAcceptance green together, bridge and
  lifecycle coverage green together, RealExtension 11/11, and both repository
  typechecks exiting zero.
- Server-side bounds for all remaining producer-controlled terminal metadata.
- Provenance re-pinned and verified byte-exact at Alfie `608c1c57d`.

Supervisor source and history inspection confirmed:

- Symphony main advances `fe4d1fa3 → d44f624f`, with `d44f624f` the current
  main ref.
- Alfie main advances `bcfe6edda → 608c1c57d`, with `608c1c57d` the current
  main ref.
- `recordTerminalEvent` performs dedup, continuity evidence, journal insertion,
  stale classification, and guarded aggregate mutation within one transaction.
- Post-commit notification cannot occur on repository failure.
- Terminal observations bypass progress coalescing.
- Symphony advertises `journal-terminal-lifecycle` as an optional capability.
- Alfie gates inline, detached, and background terminal reporting on the
  connected host's capability advertisement.
- The mixed-version regression test exercises both unsupported-host suppression
  and later supported-host re-enablement.
- The manifest pins Alfie `608c1c57d`, `0.13.0-alfie.1`, and all three required
  artifact hashes.

## Recorded nonblocking risks and follow-up owners

1. **F1 — MEDIUM: reverse mixed-version skew could reshape an inline success
   into an error.**

   **Disposition:** remediated and closed for Ticket 07. Symphony now advertises
   `journal-terminal-lifecycle`; Alfie records host support during handshake
   and gates all terminal reporting on it. A pre-Ticket-07 host receives no
   terminal observation and preserves legacy result shape. Focused regression
   evidence covers old-host suppression and new-host re-enablement.

2. **F2 — LOW: non-summary producer metadata was unbounded server-side.**

   **Disposition:** remediated and closed for Ticket 07. Transcript reference,
   outcome state, and diagnostic message are bounded server-side before
   repository persistence.

   **Follow-up owner:** Ticket 08 must preserve these bounds when constructing
   completion-outbox payloads and must not expand bounded terminal evidence
   back into unbounded delivery payloads.

3. **F3 — LOW: direct coordinator `summaryMaxChars` guard checks the minimum but
   not the configured maximum.**

   **Disposition:** accepted, nonblocking. The production caller supplies the
   already-resolved configuration value, whose valid range is independently
   enforced; no current production path can supply the oversized value
   contemplated by the finding.

   **Follow-up owner:** Ticket 08, when integrating the outbox at
   `onTerminalPersisted`, should align the coordinator's defensive guard with
   the configuration maximum if that direct seam remains externally
   constructible.

4. **F4 — LOW: a cancelled managed background child can retain an unconsumed
   session-scoped terminal-reporter entry.**

   **Disposition:** accepted, nonblocking. The entry is identity-specific,
   cannot report for a replacement generation, and has no demonstrated
   correctness effect.

   **Follow-up owner:** Ticket 10, when integrating restart reconciliation and
   runtime cleanup, should remove or equivalently retire reporter ownership for
   cancelled/stopped background executions.

5. **F5 — informational.** The terminal-evidence contract is intentionally a
   Ticket 08 consumer surface; the runtime-warning representation and
   attempt-local sequence band 40 are consistent with existing event
   conventions and do not require remediation.

No finding conditions Ticket 07 acceptance or blocks Ticket 08.

## Rejected alternatives

- **Reject pending completion-outbox implementation:** rejected. Ticket 07 owns
  durable terminal truth and the post-commit handoff seam; Ticket 08 owns the
  separate completion-delivery state machine. Requiring the outbox here would
  collapse the approved dependency order and weaken the distinction between
  execution outcome and delivery outcome.

- **Reject because the independent review preceded F1/F2 remediation:** rejected.
  The exactly-one feature review fully reproduced all seven criteria and
  identified the two bounded findings. F1/F2 remediation is narrow, directly
  inspectable, covered by focused regression evidence, and does not alter any
  criterion's accepted architecture. A second competing feature review would
  violate the accepted single-review lifecycle.

- **Accept the original one-directional mixed-version disclosure without
  remediation:** rejected. The old-server/new-extension inline result-shape
  hazard was operably material even though it did not corrupt durable state.
  Host capability advertisement and extension-side reporting gates are the
  simpler reversible correction and are now implemented.

- **Require F3 remediation before acceptance:** rejected. The live configuration
  path already enforces the maximum and no current caller bypasses it. Ticket 08
  is the appropriate next touchpoint for symmetric defensive validation.

- **Require immediate F4 cleanup:** rejected. The retained entry is
  session-scoped and identity-fenced, with no state corruption or cross-run
  delivery path. Ticket 10 owns the lifecycle seam where cleanup becomes
  operationally relevant.

- **Treat completion notification as execution evidence:** rejected. Decisions
  0001 and the specification explicitly separate execution outcome from
  completion delivery. Terminal journal truth remains authoritative.

- **Route terminal evidence through progress ingress:** rejected. This would
  violate Specification Decisions 16 and 17 and T07-AC6 by allowing
  coalescing, dropping, or sink degradation to discard terminal truth.

- **Reopen the lease-authority decisions:** rejected. Ticket 07 introduces no
  lease-based control and does not consume producer-derived
  `lease_expires_at`. Decisions 0009–0011 remain unchanged.

- **Require another independent feature review:** rejected. The project cadence
  requires exactly one independent feature-level review followed by exactly
  one Supervisor final-acceptance consultation. That lifecycle is complete.

## Assumptions and residual uncertainty

- The independent reviewer's reproduced outputs correspond to Symphony
  `fe4d1fa3` and Alfie `bcfe6edda`, as stated in the review.
- The focused post-remediation outputs correspond to Symphony `d44f624f` and
  Alfie `608c1c57d`. Source inspection corroborates the narrow remediation
  described by those outputs.
- The recorded post-remediation provenance recomputation is accurate. Direct
  inspection confirms both repository refs and the manifest pin, but this
  read-only consultation did not independently execute a hash command.
- SQLite's transaction and uniqueness behavior is the one exercised by the
  repository and lifecycle suites; the journal insert and aggregate mutation
  remain within the same transaction.
- The deterministic loopback model exercises the real pinned Pi runtime and
  bridge boundary under the owner-approved Testing Seams.
- The seven full-unit CursorTextGeneration failures remain the documented
  pre-existing environment failures and are unrelated to Ticket 07.
- All accepted commits remain local-only; publication, deployment, and release
  are outside this decision.
- Completion-outbox delivery, retry, batching, and acknowledgement are not
  claimed by Ticket 07 and remain Ticket 08 and Ticket 09 work.
- Restart reconciliation and orphan recovery are not claimed by Ticket 07 and
  remain Ticket 10 work.

## Downstream effect

- Ticket 07 is marked accepted/completed with Decision 0012 as its authoritative
  final acceptance.
- Project Home is updated to add Decision 0012 to authoritative routing and to
  record Tickets 01–07 complete.
- **The blocker-free frontier advances to Ticket 08 — Durable completion
  outbox.** Ticket 08's sole blocker, Ticket 07, is satisfied.
- Ticket 08 inherits journal-first ordering, bounded terminal evidence, F2's
  outbox-preservation obligation, and F3's defensive-guard consideration.
- Ticket 10 inherits F4's reporter-cleanup consideration and the standing
  server-side lease-authority re-derivation obligation.
- Completion delivery remains a distinct state machine: delivery failure must
  not rewrite a successful execution as failed.
- The Alfie provenance pin advances to
  `608c1c57d31151ae2b2c4ededd8036f56f9355cd` /
  `0.13.0-alfie.1`, capability `journal-terminal-lifecycle`.
- Any later change to Alfie `package.json`, `src/index.ts`, or
  `src/agent-manager.ts` requires provenance re-pinning and hash recomputation
  before real-extension acceptance runs.

## Failure and rollback implications

The Ticket 07 changes are additive, migration-backed, and capability-gated.

Rolling back Symphony while retaining Alfie `608c1c57d` produces a safe
mixed-version boundary: a pre-Ticket-07 Symphony host does not advertise
`journal-terminal-lifecycle`, so Alfie suppresses terminal observations and
preserves legacy result shape. It must not claim durable terminal truth.

Rolling back Alfie while retaining Symphony leaves Symphony's widened terminal
ingress inert because the older extension does not report terminal
observations. Symphony must not synthesize terminal truth from temporary child
absence, completion delivery, or progress state.

Rolling back migration 101 or the Symphony terminal repository path removes
the accepted durable terminal evidence and stale-counter schema. That reopens
Ticket 07 and blocks Ticket 08 and all downstream completion work.

Rolling back only the F1 gate reintroduces the old-server/new-extension inline
result-shape hazard and reopens this decision. Rolling back only the F2 bounds
reintroduces unbounded producer-controlled terminal metadata and reopens
T07-AC5.

If Decision 0012 is later reopened, Ticket 07 returns to needs-remediation and
Ticket 08 becomes blocked again. Already-persisted terminal execution truth
must not be downgraded because a later completion delivery fails.

## Reopening conditions

Reopen through a new numbered decision, never by editing this record, only for
material evidence that:

- the committed candidate differs materially from Symphony
  `fe4d1fa331051da7af0c344796f5e95cecb84b9d` +
  `d44f624ffecf636b20c7e059b0d1d396331a204e` or Alfie
  `bcfe6eddabad952fde0b87ddbeb92676967ea1bd` +
  `608c1c57d31151ae2b2c4ededd8036f56f9355cd`;
- terminal delivery or completion notification can begin before the terminal
  journal and execution aggregate commit;
- terminal persistence failure can notify completion consumers, preserve a
  success-shaped inline result, or avoid control-health degradation;
- duplicate or replayed terminal evidence can have more than one state effect;
- a second applicable terminal can overwrite the first terminal owner;
- sequence-gap handling can delete, delay, roll back, or suppress an
  already-persisted terminal;
- a superseded attempt or generation can overwrite current execution truth or
  escape stale-event accounting;
- any terminal payload can persist unbounded raw transcript output or bypass
  the accepted server-side metadata bounds;
- progress saturation, coalescer state, or observation-sink degradation can
  discard or delay terminal truth;
- cancellation and normal completion can cause terminal state flip-flop;
- an old host receives unsupported terminal observations from the remediated
  Alfie extension or mixed-version operation reshapes a successful inline
  result into an error;
- Ticket 08 begins completion delivery from anything weaker than committed
  terminal journal truth, expands bounded terminal evidence into unbounded
  outbox content, or rewrites execution outcome because delivery fails;
- Ticket 10 consumes lease authority without server-side validation or
  re-derivation, or permits stale reporter/reconciliation evidence to cross an
  attempt or generation fence;
- provenance no longer proves the exact Alfie source used by the real-Pi
  acceptance path;
- the binding per-file standalone wallclock suites reproducibly fail outside
  the documented harness-environment noise; or
- new evidence materially contradicts Decisions 0001–0011, the owner-approved
  Testing Seams, or this record's criterion verdicts.
