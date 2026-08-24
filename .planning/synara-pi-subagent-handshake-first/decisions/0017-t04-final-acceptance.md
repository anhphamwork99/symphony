# Decision 0017 — Ticket 04 final acceptance

- **Consultation type:** Final acceptance
- **Status:** Binding Decision — **ACCEPTED**
- **Consultation history:** This is the one and only Ticket 04 final-acceptance
  consultation.
- **Source candidate:** `59c06c413e131f5d441aafa696ae9e79c4b28c14`
- **Independent review evidence:**
  `6ccda4d915195dd0b266e181a389b32abe8656b4`
- **Review record:**
  `../reviews/04-production-composition-review.md`
- **Write set of consultation:** None

## Question

Does integrated Ticket 04 candidate `59c06c413` satisfy AC1–AC5, the
handshake-first Project Contract, and binding Decision 0016's
production-composition boundary with sufficiently fresh implementation,
verification, and independent-review evidence to receive final acceptance?

## Authority basis

- Project Home, `../PROJECT.md`, as authoritative lifecycle and routing
  authority.
- Ticket 04,
  `../issues/04-prove-desktop-production-composition-and-accept.md`, as the
  normative AC1–AC5 contract.
- Decision 0016,
  `0016-t04-production-composition-acceptance-boundary.md`, as the binding
  production-composition and OS-child boundary.
- Project specification, `../spec.md`, as the governing feature invariants and
  non-goals.
- Decision 0014,
  `0014-t03-mandatory-check-reassessment-and-final-acceptance.md`, as accepted
  Ticket 03 dependency state.
- Existing accepted Tickets 01, 01b, 01c, 02, and 03 and their routed
  decisions. None is reopened.

## Evidence considered

1. Source candidate `59c06c413`, including the Ticket 04 implementation
   lineage: `f13132207`, `0573494c2`, `58926df51`, `0fc954ee3`, `02decd9fb`,
   `a9b8b24c9`, `37dd97918`, `19688319a`, and `59c06c413`.
2. Repository history establishes that review commit `6ccda4d91` is directly
   layered on candidate `59c06c413`; it changes only persisted review evidence
   after the source candidate.
3. The exact production desktop path imports `buildBackendChildSpawnEnv`,
   derives it from `backendEnv()` plus packaged application facts, and passes
   its returned environment directly to `ChildProcess.spawn(..., { env })`.
4. The shared explicit subpath
   `@synara/shared/piSubagentDesktopArtifactEnvironment` contains the single
   runtime implementation. The desktop module is a pure re-export shim,
   avoiding duplicated or test-only behavior.
5. The integrated Ticket 04 composition test invokes that production
   implementation with release-shaped resources and a poisoned inherited
   environment, then traverses the production artifact gate, real Pi runtime
   and handshake, public WebSocket boundary, durable journal, and
   execution-card projection.
6. The same suite covers the required failure categories and checks redacted
   diagnostics and zero managed durable side effects.
7. Exact-candidate verification evidence:
   - `ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test -- --env-mode=loose`:
     exit 0 in 11m19s;
   - root Turbo: 8/8 tasks successful;
   - server orchestrator: 16/16 invocations successful, with no retry;
   - server unit suite: 4,913 passing tests;
   - Ticket 04 suite: 3/3;
   - `bun fmt`: exit 0, with unrelated mechanical churn restored;
   - `bun lint`: 0 warnings and 0 errors;
   - `bun typecheck`: 7/7 workspace tasks successful.
8. The sole persisted independent feature review at `6ccda4d91` recommends
   PASS. The reviewer independently reran Ticket 04 twice, obtaining 3/3 on
   both runs, and reran the AC4-focused suites with results `2/2`, `2/2`,
   `2/2`, `2/2`, `2/2`, `7/7`, and `24/24`.

## Criterion-level verdicts

### AC1 — PASS

The candidate proves the Decision 0016 chain from release-shaped packaged
resources through the exact production environment derivation and complete
derived environment into the production desktop-managed artifact consumer.

Poisoned inherited values for both the artifact locator and
`PI_CODING_AGENT_DIR` are scrubbed. Legitimate runtime configuration survives.
The official release-controlled artifact is selected, while the planted old
global extension and parent decoy remain unchanged and are not loaded.

The shared explicit-subpath extraction does not weaken this evidence: desktop
production and server composition tests consume one implementation, while the
desktop compatibility module only re-exports it.

### AC2 — PASS

The integrated composition proves mandatory seven-capability handshake
readiness before the first and only managed admission. Durable lifecycle order
is accepted → running/started → running/detached.

The real delegated child detaches inside the accepted timing envelope,
continues progress and heartbeat reporting after detach, and commits exactly
one identity-, attempt-, and generation-fenced terminal result. A fresh
production WebSocket client observes the durable `Running in background` card
and its transition to the matching terminal card.

No synthetic Agent, fake handshake, fake durable lifecycle, or UI-only
transition substitutes for the production chain.

### AC3 — PASS

The composition exercises missing and malformed manifests, digest mismatch,
unsupported capability, hostile protocol version, malformed handshake, missing
locator, and invalid runtime-model configuration.

Each case fails closed before managed admission or execution, produces bounded
and redacted diagnostics, makes no child-model request, does not load the
global fallback, and leaves execution, journal, outbox, and completion-batch
row counts at zero. No credentials, paths, prompts, provider configuration, or
hostile protocol details are exposed through the checked operator surfaces.

### AC4 — PASS

Fresh focused regression evidence at `59c06c413` preserves:

- journal-first terminal authority;
- restart reconciliation to honest non-terminal orphaning;
- explicit Resume with stale-attempt and stale-generation fencing;
- non-terminal watchdog and teardown uncertainty;
- completion-owner fencing; and
- globally hydrated execution-card projection.

The global snapshot alias regression was repaired in the candidate lineage and
covered by the fresh `24/24` projection suite. No evidence shows a regression
in accepted Ticket 02 or Ticket 03 lifecycle and presentation invariants.

### AC5 — PASS

The required full root test command, formatter, lint, and workspace typecheck
all passed against the exact candidate. The server orchestrator's 16/16 result
used no retry, so retry policy did not mask a failure.

The single required independent feature review is persisted at `6ccda4d91`, is
criterion-level, and recommends PASS. This record is the sole required
Supervisor final-acceptance consultation. AC5 is therefore complete with this
decision.

## Verification-evidence judgment

The evidence is sufficiently fresh, candidate-specific, and proportionate to
the production risks.

The reviewer did not independently rerun the heavyweight formatter, lint,
typecheck, or complete root suite, but this is not contrary evidence:
exact-candidate outputs were supplied, repository provenance binds the review
directly to the candidate, the reviewer independently confirmed the
highest-risk Ticket 04 and AC4 behavior, and no retry occurred in the reported
full server run.

Restoring 47 unrelated formatter rewrites does not invalidate `bun fmt` exit 0
and correctly prevents out-of-scope churn from entering the candidate. The
configured completion gate requires successful execution, not committing
unrelated formatter output.

## Contrary evidence and reassessment analysis

No contrary reviewer finding or material contradictory evidence exists.

The reviewer found no high-severity issue and recommended PASS. Its residual
observations distinguish measurement units, disclose which checks were
supplied rather than independently rerun, and acknowledge the intentional
absence of an Electron/backend OS-child launch. None contradicts an acceptance
criterion.

Decision 0016 expressly establishes that an actual Electron/backend OS child
spawn is not mandatory. The candidate satisfies its required replacement
proof: exact release-shaped resolver, complete derived environment, exact
production consumer, production Pi/WS/durable/card composition, plus focused
protection of the production spawn wiring.

No Reassessment of Decision 0016, Decision 0014, or the accepted Tickets 01–03
is warranted.

## Final binding verdict

Ticket 04 candidate `59c06c413e131f5d441aafa696ae9e79c4b28c14`, with
independent review evidence persisted at
`6ccda4d915195dd0b266e181a389b32abe8656b4`, is **ACCEPTED** on AC1–AC5.

The integrated candidate conforms to the Project Contract, preserves the
release-controlled and no-global-fallback security boundary, proves
handshake-before-admission, preserves durable terminal and uncertainty
invariants, and provides fresh production-composition evidence through the
boundary mandated by Decision 0016.

## Rejected alternatives

1. Requiring an actual Electron or backend OS-child launch is rejected because
   Decision 0016 excludes it from mandatory acceptance and the candidate
   proves the exact Pi-specific production environment and consumer chain.
2. Resolver-only or direct `artifactDir` injection evidence remains
   insufficient; the candidate uses neither substitution.
3. Lack of an independent heavyweight-check rerun is not grounds for rejection
   because fresh exact-candidate command evidence exists, the reviewer reran
   the highest-risk suites, and no contrary result exists.
4. Restored formatter churn is not grounds for rejection because `bun fmt`
   exited successfully and restoration preserved ticket scope.
5. Stale pre-consultation routing text and unchecked boxes are administrative
   state to update, not contrary implementation evidence.
6. A second Ticket 04 final consultation is rejected and prohibited. This
   consultation exhausts the one-consultation allowance.

## Assumptions and residual uncertainty

- The supplied command outputs correspond to the exact source tree at
  `59c06c413`.
- The formatter restoration removed only mechanical out-of-scope churn.
- The deterministic loopback model is an accepted fixture inside an otherwise
  production composition; artifact loading, Pi runtime, Agent tool, handshake,
  persistence, WebSocket routing, and card projection are real.
- Generic Electron startup, executable discovery, process supervision, OS
  environment transport, and packaging-host smoke behavior remain outside
  Ticket 04 under Decision 0016.
- Wall-clock detach timing remains host-load-sensitive, but exact-candidate
  observations of 308 ms, 356 ms, and 372 ms for a 300 ms budget are all within
  the accepted `[budget - 50 ms, budget + 500 ms)` envelope.
- The server orchestrator retains a bounded one-retry policy, though the
  accepted exact-candidate run used no retry.

No residual uncertainty is material enough to prevent acceptance.

## Failure and rollback implications

If future evidence establishes that verification ran against a materially
different tree, the shared runtime implementation diverged from the desktop
production import, the complete derived environment no longer reaches the
production gate, or any accepted handshake/lifecycle/security invariant
regressed, this decision must be reassessed.

Any rollback must preserve:

- release-owned manifest-exact artifact selection;
- scrubbing of inherited artifact and Pi agent-directory redirects;
- no ambient or user-global extension fallback;
- handshake readiness before Agent exposure and admission;
- journal-first, identity/attempt/generation-fenced terminal authority;
- non-terminal orphaning and teardown uncertainty;
- explicit-only Resume;
- redacted fail-close diagnostics; and
- whole-card durable presentation across snapshot, replay, reconnect, and
  fresh WebSocket hydration.

Rollback must not introduce a synthetic acceptance path, direct
artifact-directory substitution, unmanaged fallback, database migration, or
false terminal inference.

## Project and ticket lifecycle consequence

- Ticket 04 is complete and bindingly accepted.
- Tickets 01, 01b, 01c, 02, and 03 remain accepted and unchanged.
- All implementation tickets in the handshake-first project are now accepted.
- The project may transition from implementation-in-progress to
  **accepted/complete** once this returned record is persisted and
  authoritative routing metadata is updated.
- No source change, external side effect, or additional acceptance consultation
  is authorized.

## Downstream routing

After persisting this decision:

1. cite Decision 0017 from Project Home as the aspect-scoped authoritative
   Ticket 04 acceptance;
2. mark Ticket 04 AC1–AC5 accepted;
3. route the project lifecycle to accepted/complete;
4. preserve `59c06c413` as the accepted source candidate and `6ccda4d91` as
   the sole independent review package; and
5. prohibit any second Ticket 04 final-acceptance consultation.

## Reopening conditions

Reassess this acceptance only upon material evidence that:

1. candidate or review provenance is incorrect or stale;
2. a required full verification command did not pass against `59c06c413`;
3. the desktop shim or shared explicit subpath no longer resolves to the same
   runtime implementation;
4. the production spawn receives an environment different from the complete
   resolver-derived environment;
5. the controlled artifact can be redirected, modified, bypassed, or replaced
   by a global extension;
6. Agent exposure or admission can precede mandatory handshake readiness;
7. detached liveness or exactly-one fenced terminal commitment fails;
8. bootstrap failure creates managed durable side effects or leaks sensitive
   configuration;
9. journal-first terminal integrity, orphan honesty, Resume fencing, teardown
   uncertainty, or whole-card projection regresses;
10. production introduces Pi-specific behavior between environment derivation
    and OS spawn, activating Decision 0016's reassessment condition; or
11. an owner-approved authority changes the project's artifact, composition,
    verification, or acceptance boundary.

A reopening event requires a Reassessment of this decision. It does not
authorize a second final-acceptance consultation.

**Supersedes:** None.
