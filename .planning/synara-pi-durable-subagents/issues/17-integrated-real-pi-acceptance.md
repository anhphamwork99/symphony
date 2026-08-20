# 17 — Integrated real-Pi acceptance smoke

**What to build:** Provide one hermetically isolated, repeatable acceptance path
against a real Pi runtime that proves the complete managed-execution first
slice: capability negotiation, durable identity, bounded detach, coalesced
progress, reconnectable execution card, real cancellation, batched completion,
restart reconciliation, watchdog escalation, owned cleanup, and legacy
fallback. The smoke reports each stage and stable diagnostic and cannot pass
using provider fakes alone.

**Blocked by:** 01 — Versioned managed-execution handshake; 02 — Durable
execution admission and identity; 03 — Managed admission fails closed; 04 —
Bounded foreground attachment; 05 — Coalesced progress and heartbeat leases;
06 — Durable parent-turn cancellation; 07 — Journal-first terminal lifecycle;
08 — Durable completion outbox; 09 — Per-thread completion coordinator; 10 —
Restart reconciliation to terminal or orphaned; 11 — Reconnectable execution
card; 13 — Admission quotas and safe telemetry; 15 — Watchdog escalation
through provider-session stop; 16 — Owned process-tree teardown and fencing.

**Status:** ready-for-agent

- [ ] **T17-AC1:** A compatible real Pi session negotiates managed capability
      and starts one identity-stamped long-running execution.
- [ ] **T17-AC2:** The foreground parent releases within the configured budget,
      progress remains bounded, and browser reconnect restores the execution card.
- [ ] **T17-AC3:** Parent Stop reaches the real child and the card remains
      cancelling until termination evidence.
- [ ] **T17-AC4:** Multiple real child completions create one bounded follow-up
      per thread and remain individually retrievable by execution identity.
- [ ] **T17-AC5:** Restart during a non-terminal execution reconciles to a
      proven live owner, recovered terminal, or honest orphan, with no automatic
      replay.
- [ ] **T17-AC6:** A deliberately wedged execution progresses through watchdog
      stages and leaves no owned child process after proven teardown.
- [ ] **T17-AC7:** A no-bridge or legacy-extension leg retains legacy semantics
      and is never labeled managed or recoverable.
- [ ] **T17-AC8:** The harness uses an isolated home, non-default ports, isolated
      process ownership, and does not read or mutate the user's active Synara/Pi
      instance or agent configuration.
- [ ] **T17-AC9:** Any stage failure reports the stage and stable diagnostic and
      fails loudly; a mock-only success is impossible.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16. Ticket 16's approved seam resolution remains a prerequisite for
the destructive stage.

- **T17-AC1–T17-AC9:** The hermetically isolated real-Pi acceptance harness is
  the public feature seam. Provider fakes may prepare deterministic lower-level
  coverage but cannot satisfy this ticket.
- **T17-AC8:** Local-instance isolation checks include dry-run configuration,
  non-default server and web ports, isolated home/state, and owned-process
  verification before execution.

### Approved amendment (2026-08-20, `/matt-implement`) — AC6 destructive-boundary seam split

**Amendment approval status:** **Approved.** This amendment was proposed by
the implementer on 2026-08-20 and approved by the human owner on 2026-08-20
in the current implementation conversation (see the owner approval record
below). It does not modify, weaken, or reinterpret the Approved seams above;
with this approval, T17-AC6's evidence is satisfied through the approved
three-leg split below, and every other acceptance criterion remains governed
by the Approved seams exactly as written.

**Authority (settled by Decision 0031):** the seam-design question is
adjudicated — the T17-AC6 evidence split is an ordinary ticket-level
refinement under Decision 0001, and **no new project-scoped owner-approved
Decision Record is required by Decision 0001** for it. What this amendment
reserved — per the Decision-0014 precedent, explicit human-owner approval of
the concrete amended Testing Seam before any AC6 test is written — has now
been given and is recorded below. Decision 0031 is an authority adjudication,
not owner approval; the owner approval is the record below.

#### Rationale

T17-AC6 requires a deliberately wedged execution to progress through watchdog
stages and leave **no owned child process after proven teardown**. The
non-destructive majority of that chain (watchdog stage progression,
provider-session stop, teardown handoff) is stable, observable, and must stay
real-Pi evidence. The final step — driving the owned supervisor to a real
terminal teardown of the process tree — is the same boundary Decision 0028
found not provably hermetic or deterministic in shared CI for Ticket 16:
the `proven`/`survivors` outcome flips under host load inside the SIGKILL
poll window, the test emits real operating-system signals, and the result
does not distinguish correct code from scheduler variation.

Decision 0028's authority is scoped to Ticket-16 acceptance evidence, so
Ticket 17 did not inherit it silently. That scoping question is now settled
by Decision 0031: the T17-AC6 evidence split is an ordinary ticket-level
seam refinement under Decision 0001 §Exceptions — it removes no required
real-Pi coverage and introduces no provider-fake substitution, so no new
project-scoped owner-approved Decision Record is required for the
seam-design question. However, this amendment itself (proposed under
`/matt-implement`) reserved a fresh human-owner decision on the concrete
amended Testing Seam before any AC6 test was written, following the
Decision-0014 precedent that delegated seam-design authority is not
authority to self-approve a checkpoint the ticket reserves to the owner.
It was recorded here as Pending so that approval would be settled **before
any AC6 test was written**; that owner approval is now recorded below
(2026-08-20), so AC6 tests may now be written against this amendment.

#### Approved seams and evidence split

| Evidence class | Boundary | Coverage |
| --- | --- | --- |
| Mandatory real-Pi (unchanged) | Real Pi runtime through the integrated smoke harness | Watchdog stage progression on a deliberately wedged execution, provider-session stop, teardown **handoff** (band 74 journaled for the current attempt/generation), stage-scoped diagnostics, and the card remaining honest through `cancelling`. The harness cannot pass on provider fakes. |
| Accepted deterministic (from Ticket 16) | Process-supervisor, repository, coordinator, sweep, and adapter-wiring fixtures already approved and implemented under Ticket 16 / Decision 0028 | Owned-only dispatch, proof-before-fence settlement (`proven` settles `cancelled` + generation advance), uncertain outcomes (`survivors` / `owner_unproven`) staying non-terminal and retryable, escalation to `proven`, bounded survivor evidence (cap 16), journal bands 75–78 identities. |
| Isolated manual real-Pi (from Ticket 16) | The Ticket-16 manual verification recipe, run in isolation | The destructive outcome itself: observe band-75/76 rows and the supervisor's TERM→KILL escalation in the process table, and confirm the card settles `cancelled` with generation advanced. Explicitly labeled **manual** and retained as operational evidence only. |

### Reassessment extension (2026-08-20) — managed-child owner seam

**Authority:** Decision 0033 narrowly supersedes Decision 0030's
parent-supervisor ownership premise for an Alfie-managed child Bash process.
It does not change the three-leg evidence boundary or authorize destructive
automation.

The manual discovery run established that the former parent
`PiBashProcessSupervisor` could report `proven` while a child-session Bash
remained live. The concrete seam therefore changes only the source of
ownership proof:

| Evidence class | Approved seam | Required result |
| --- | --- | --- |
| Alfie deterministic ownership | The child session's supervised Bash and its opaque owner endpoint | Each managed child owns exactly one supervisor; every child Bash is observed there, not by the parent; stale/mismatched/disposed identities have no process-side effect. |
| Contract/Symphony deterministic ownership | Capability-negotiated, schema-validated endpoint through Ticket-16 teardown resolution | Missing, old, malformed, stale, mismatched, timed-out, or failed endpoint → non-terminal band 78. It cannot call the parent supervisor, write band 76, settle `cancelled`, or advance generation. A valid owner result alone distinguishes band 77 from band 76. |
| Isolated manual real-Pi | The exact child owner endpoint running the existing isolated Ticket-16 recipe | Observe that the TERM-ignoring Bash is owned by the exact child supervisor, not the parent observer; only child-owner TERM→KILL proof may precede band 76, cancelled card, generation advance, and zero-owned-child claim. |

**Owner approval:** the project owner approved this exact extension in the
current implementation conversation on 2026-08-20: `Đồng ý, triển khai đi`.
The request stated the material boundary verbatim: one supervisor per managed
child, an identity-fenced opaque child-owner endpoint, no parent fallback, and
no Synara direct PID-kill authority. Decision 0033 records that approval and
its limited scope.

#### AC mapping

- **T17-AC6:** the split above is the approved satisfaction path for the
  wedged-execution stage progression and proven-teardown outcome. The
  deterministic fixtures carry the teardown/fence contract; the manual recipe
  carries the real process-tree destruction through the exact child owner;
  real-Pi evidence remains mandatory up to and including the teardown handoff.
- **T17-AC8:** the manual recipe inherits every isolation obligation —
  isolated home/state, non-default ports, owned-process verification, and no
  reading or mutation of the user's active Synara/Pi instance or agent
  configuration. It must be run on an operator-owned machine or isolated
  environment, never against shared CI or the user's live instance.
- **T17-AC9:** stage failures must still report the stage and a stable
  diagnostic and fail loudly under the real-Pi and deterministic legs; the
  manual leg may only be reported through an operator-recorded run record.

#### Binding evidence boundary (Decision 0031 — mandatory, not optional)

Decision 0031 binds T17-AC6 to the three-leg combination above; no subset is
sufficient: (a) mandatory hermetic real-Pi harness evidence through the
teardown handoff, (b) the accepted deterministic Ticket-16 fixtures, and
(c) mandatory isolated manual real-Pi evidence for the actual
no-owned-child-after-proven-teardown outcome — the terminal zero-owned-child
claim must come from the manual leg alone. Deterministic/fixture-only
satisfaction is prohibited, and any claim that an automated real-Pi
destructive pass occurred is prohibited.

#### Explicitly prohibited claims

- A **mock-only success** is forbidden. The integrated real-Pi path remains
  mandatory; provider fakes cannot satisfy this ticket (T17-AC9).
- Claiming that an **automated real-Pi destructive pass** occurred is
  forbidden. No automated destructive teardown test may be introduced into
  shared CI or reported as run under this amendment.
- The manual recipe may **not** be reported as executed unless an operator
  records an actual isolated run and its environment.
- The deterministic fixtures may **not** be reported as real-Pi evidence, nor
  the real-Pi leg as deterministic fixture evidence.
- Nothing in this amendment may be cited as owner approval for any other
  ticket's destructive-boundary substitution.

#### Owner approval record

- Owner identity: project owner (chat user)
- Approval date: 2026-08-20
- Approval artifact: the current implementation conversation — the owner's
  chat response in the `/matt-implement` implementation session on
 2026-08-20 (a project-scoped Decision Record per Decision 0001
  §Exceptions is no longer required for the seam-design question per
  Decision 0031)
- Verbatim confirmation: `okay đồng ý`
- **Request:** settled on 2026-08-20 — the owner approved this AC6 seam
  split. The approved meaning is the binding evidence boundary above:
  mandatory real-Pi evidence through the wedged execution, watchdog stage
  progression, provider-session stop, and teardown handoff; the accepted
  deterministic Ticket-16 fixtures carrying the teardown/fence contract;
  and a mandatory isolated manual real-Pi run as the sole source for the
  no-owned-child-after-proven-teardown claim. No mock-only, fixture-only,
  or automated-destructive-pass claim is permitted. The alternative —
  keeping T17-AC6's destructive stage as fully automated real-Pi evidence
  within the integrated harness — was not directed.
- **Persisted as:** Decision 0032 —
  [decisions/0032-t17-ac6-testing-seam-owner-approval.md](../decisions/0032-t17-ac6-testing-seam-owner-approval.md)
  (discharges Decision 0031 reopening condition 1; Decision 0031's settled
  technical direction unchanged; T17-AC6 may not be claimed or closed until
  all three legs are satisfied, including the recorded operator-run manual
  real-Pi run record).

## Implementation Report — candidate awaiting review

**Candidate provenance**

- Symphony baseline: `5468d1c1992e63cd993198a1e88767604f686fa1`, with the
  Ticket-17/Decision-0033 implementation still uncommitted at this report.
- Alfie release: `aa6fa4a8540644d2509b10d6df854486ddc67d1d`,
  `@alfie/pi-subagents@0.15.0-alfie.4`.
- The real-Pi provenance manifest pins that exact Alfie commit and hashes the
  package manifest, extension entry, manager, child runner, and child Bash
  supervisor. A dirty Alfie extension is rejected before harness startup.

**Automated real-Pi evidence**

- `env -u SYNARA_T17_MANUAL_TEARDOWN /Users/anhpham99/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealPiAcceptance.test.ts`
  passed **9 tests** with the destructive manual leg skipped (2026-08-20).
  It covers compatible capability/admission, bounded detach/reconnect,
  cancellation, batched completion/result reads, restart reconciliation,
  watchdog handoff through band 74, capability/bridge fallback, isolated
  state/home/ports, and diagnostic failure surfaces.
- The Stage-5 restart baseline uses three stable public
  `orchestration.replayEvents` snapshots before taking its cursor; two late
  parent terminal messages from the pre-restart turn cannot be misreported as
  restart side effects. It passed twice standalone and in the automated file.
- Focused child-owner contracts/bridge/coordinator/adapter wiring passed
  **82 tests**; the adapter wiring suite covers a retry after a durable
  proven-outcome write failure, endpoint timeout, malformed survivor evidence,
  restart-empty fail-closed behavior, and no-parent-fallback assertions.

**T17-AC6 three-leg evidence**

1. Mandatory non-destructive real-Pi watchdog leg: Stage 6 passed through
   durable bands 70–74 with truthful `cleanup_uncertain` / `cancelling`;
   it makes no destructive or terminal claim.
2. Accepted deterministic Ticket-16 leg: watchdog/teardown regression files
   passed **26 tests**, and the current coordinator/adapter tests retain
   proof-before-fence, bands 75–78, bounded survivor evidence, stale identity,
   and `owner_unproven` behavior.
3. Mandatory isolated manual real-Pi record (operator run, not CI):

   ```text
   Date: 2026-08-20 (local operator environment)
   Command: SYNARA_T17_MANUAL_TEARDOWN=1 /Users/anhpham99/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealPiAcceptance.test.ts -t 'MANUAL T17-AC6'
    Result: 1 passed, 9 skipped, 32.33s
    executionId: exec_dbc3de35-cd1f-4ad0-886b-9d0b1d2e6483
    attemptId: att_e3d3f60e-3296-43ff-a307-41ec93de56c4
    child Bash root PID: 80696
    child Bash descendant PID: 80728
    TERM evidence: root and descendant both observed TERM before bounded KILL escalation
    live-process monitor: no band 76 was observed while either exact PID was live
    durable bands: 75 → 76
    generation: 1 → 2
    ```

    Both child PIDs were verified alive before teardown and absent from the
    parent `PiBashProcessSupervisor` observer. The test did not call a
    coordinator or bridge test seam: production `PiAdapter` retained-owner
    registry plus its periodic teardown sweep performed the proof path. It
    then verified both PIDs absent, card `cancelled`, and generation fenced.
    The harness used an owned temporary root (`synara-realpi-t17-*`) and
    removed it during test cleanup. This is the sole current source for the
    zero-owned-child claim.

**Open completion gates**

- Run the required independent feature review and Supervisor reassessment of
  Decisions 0030/0033.
- Commit the verified Symphony candidate, then run the final workspace
  verification set and record its exact evidence before changing ticket
  checkboxes or status.
