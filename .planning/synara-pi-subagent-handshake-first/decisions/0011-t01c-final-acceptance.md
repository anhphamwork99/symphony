# Decision 0011 — Ticket 01c final acceptance

- **Date:** 2026-08-23
- **Status:** Accepted — binding final acceptance
- **Consultation class:** Supervisor final acceptance; the one and only
  final-acceptance consultation for Ticket 01c (AC7's consultation budget is
  now exhausted).
- **Scope:** The complete Ticket 01c prompt-closure remediation at candidate
  `6ccc674b9` (range `f7fa51d45..6ccc674b9`), its AC1–AC7 acceptance, and the
  downstream effect on Tickets 02 and 04. It does not accept Ticket 02 or
  Ticket 04, reopen owner-approved project boundaries, expand Ticket 01c
  ownership, or alter Decision 0010's historical finding.

## Question

Does the complete Ticket 01c candidate at `6ccc674b9`, after the persisted
independent PASS review at `c470acffd`, satisfy AC1–AC7 with trustworthy
feature-level evidence, such that the prompt-closure remediation may be
accepted, Decision 0010's narrow suspension of Decision 0009 may be closed,
and Ticket 02 unblocked without being accepted?

## Governing references

- Project Home: [PROJECT.md](../PROJECT.md)
- [Decision 0010](0010-t01c-prompt-closure-reassessment.md) — the governing
  reassessment whose Required acceptance evidence (Ticket 01c) list and
  artifact/verifier invariants are authoritative for this ticket
- [Decision 0009](0009-t01b-final-acceptance.md) — Ticket 01b final
  acceptance, amended by Decision 0010
- Decisions [0001](0001-release-controlled-extension.md)–
  [0008](0008-t01b-normal-dependency-host-alias-reassessment.md)
- [Ticket 01c](../issues/01c-remediate-verified-managed-pi-prompt-closure.md)
- [Ticket 02](../issues/02-bootstrap-verified-harness-and-detached-terminal-lifecycle.md)
- The independent Ticket 01c review:
  [01c prompt-closure review](../reviews/01c-prompt-closure-review.md)
  (persisted at `c470acffd`)
- The accepted testing strategy:
  [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)
- The Supervisor final-acceptance response in the current orchestration
  context (2026-08-23) — the authoritative consultation result recorded here.

## Candidate and evidence

The accepted candidate is the Ticket 01c range `f7fa51d45..6ccc674b9`:

- `185ef4210` — mechanical prompt-closure derivation
  (`scripts/lib/piSubagentPromptClosureDerivation.ts` + tests);
- `b82bdbecb` — continuation of implementation from the existing partial
  branch state, including the staging prompt leg;
- `4e6ee09c2` — completion of implementation including the real child-spawn
  closure proof (`piSubagentArtifactClosureRealLoad.test.ts`);
- `6ccc674b9` — remediation of the prior independent review's findings.

The independent feature-level review persisted at `c470acffd`
(`reviews/01c-prompt-closure-review.md`) reported **PASS, no findings** with
high confidence. It was independent of the implementing agents: it reread
the governing records, audited the full changed-path set (exactly seven
approved paths; the remediation commit touches exactly its four expected
paths), re-derived the security model from source, and independently
re-executed the focused suites rather than trusting recorded evidence. Its
exact focused evidence at `6ccc674b9`, one file per invocation with
`ALFIE_REPO_DIR` pointing at the clean pinned checkout:

- `bun test scripts/lib/piSubagentPromptClosureDerivation.test.ts` — 21 passed;
- `bun test scripts/lib/piSubagentArtifactStaging.test.ts` — 22 passed;
- `bun test scripts/lib/piSubagentNpmRuntimeClosure.test.ts` — 20 passed;
- `bun test apps/server/src/provider/piSubagentArtifactVerifier.test.ts` — 47
  passed;
- `bun test apps/server/src/provider/piSubagentDesktopArtifactGate.test.ts` —
  30 passed;
- `bun test apps/server/src/provider/piSubagentArtifactClosureRealLoad.test.ts`
  — 3 passed.

Total: **143 tests across six files, all green** (0 failed); count
provenance cross-checked by the reviewer against literal `it(`/table
structure in the candidate source. The prior independent review of the
`4e6ee09c2` candidate found defects (two P1: cross-module reachability and
same-name reader exemption; two P2: static marker in the real-load proof and
model-server lifecycle); `6ccc674b9` remediates all four, each verified
against the committed source with named regression tests. The pinned input
is unchanged: Alfie
`aa6fa4a8540644d2509b10d6df854486ddc67d1d` / `@alfie/pi-subagents@0.15.0-alfie.4`.

## Binding decision

Ticket 01c at candidate `6ccc674b9`, with the persisted independent review
at `c470acffd`, is accepted.

1. **AC1 passes:** staging derives the prompt-file dependency closure
   mechanically from the clean pinned extension's actual runtime
   prompt-read graph rooted at the child execution entry path, traversing
   the reachable relative import graph from `buildAgentPrompt` (including
   imported helpers analyzed in their own lexical scope) and failing closed
   on anything it cannot statically prove. Against the clean current pin,
   derivation produces exactly the four prompt dependencies
   (`agent/system/subagent-system.md`, `agent/system/tool-guidelines.md`,
   `agent/system/skill-rules.md`, `agent/system/working-style.md`).
   Negative fixtures prove a new required prompt read — same-module or in an
   imported helper — is included automatically or fails staging, never
   silently omitted; no hand-maintained allowlist exists.
2. **AC2 passes:** dynamic (including `Date`-derived), template-substitution,
   unresolved-identifier, and computed-`SYSTEM_DIR` paths fail
   `prompt_closure_unsupported`; repository-root escape and missing modules
   fail `prompt_closure_invalid`; untracked, dirty, absent, empty, and
   symlinked derived inputs, and required reads resolving to empty files,
   fail staging. Same-name-parameter raw reads that do not resolve lexically
   to the recognized reader's own parameter declaration are rejected, not
   credited.
3. **AC3 passes:** repeat staging of the same pinned input yields an
   identical manifest; every derived prompt file is a manifest-listed
   regular file with exact size and SHA-256 staged at its original
   `agent/system/...` relative path from the exact clean pinned Alfie commit
   (the whole `agent/system` input subtree must be tracked and clean; ambient
   checkout states are refused).
4. **AC4 passes:** expanded verification covers `agent/system` — missing,
   tampered, unlisted, path-escaping, non-regular, and symlinked entries fail
   with the existing bounded diagnostic categories, bidirectional exact-tree
   matching, and no partial trust. Negative controls removing, tampering
   with, or symlink-replacing a required prompt file are rejected by
   verification and the desktop gate before managed runtime use.
5. **AC5 passes:** the real production-loader controlled-artifact proof
   verifies the artifact before and after loading, installs
   user/global/ancestor/`NODE_PATH` resolution canaries and prompt-location
   decoys at every non-artifact prompt root, invokes the real Agent, and
   reaches at least the first real deterministic child model request whose
   prompt bytes provably come from the staged `agent/system` closure — with
   markers derived at runtime from the actual manifest-listed staged bytes
   and proven tamper-sensitive, not from a copied static string. Absent
   `ALFIE_REPO_DIR` is an explicit recorded `describe.skipIf`, never a
   silent pass. Merely observing the Agent tool at extension-load time is no
   longer the accepted closure evidence.
6. **AC6 passes:** the exclusion proof (no credentials, authentication data,
   model configuration, key material, or user-global extension content
   enters the artifact) and the desktop fail-close-ordering proof (invalid
   artifact rejects `managed-subagent-unavailable` before Pi SDK import,
   extension/global discovery, and durable side effects) are rerun against
   the expanded closure, with zero model requests and no fallback on
   negative controls.
7. **AC7 passes:** the focused stager/derivation/verifier/gate/real-load
   suites pass (143 tests / 6 files, independently re-executed by the
   reviewer), the independent Ticket 01c review is persisted at `c470acffd`
   with verdict PASS and no findings, and exactly one final-acceptance
   consultation has now been held — this record.

The Ticket 01c no-goals remain respected. This acceptance does not move
controlled-runtime construction, extension binding, user
authentication/model handling, handshake, or Agent-wrapper exposure into
Ticket 01c, and performs no packaged desktop/server composition run.

## Trust boundaries preserved (rejects)

This acceptance changes no artifact/verifier security boundary. All
Decisions 0001–0010 trust constraints remain binding, including:

- Release-owned, manifest-exact artifact with bidirectional exact-tree
  verification and bounded safe diagnostics; no partial trust.
- Fail-close ordering: invalid closure state rejects
  `managed-subagent-unavailable` before Pi SDK import, extension/global
  discovery, and durable side effects; verification stays pure (no runtime
  Git, network, user Pi directory).
- No ambient, user-global, ancestor, `NODE_PATH`, working-directory, or
  symlinked fallback for prompt content; no ticket-side creation or copying
  of prompt files after verification; no post-verification mutation.
- No credentials, authentication data, model configuration, key material, or
  user-global extension content in the artifact; the pinned external Alfie
  source remains read-only input.
- Mechanical re-derivation per future Alfie pin; a hand-maintained
  four-name allowlist remains insufficient; derivation fails closed on
  anything it cannot statically prove.
- Load-only evidence remains insufficient as proof of executable closure.

## Exact limited supersession of Decision 0010

Decision 0010 remains valid and unamended in every respect, including its
historical finding (the accepted Ticket 01b artifact was not a complete
executable closure for real child spawn), its narrow amendment of Decision
0009, its mechanical-derivation and provenance requirements, and its
artifact/verifier invariants.

Exactly and only the following Decision 0010 downstream suspension clauses
are discharged by this acceptance:

- its suspension of Decision 0009's **complete-executable-closure**
  characterization, which now again stands, satisfied as of this acceptance
  by the Ticket 01c-extended artifact;
- its suspension of Decision 0009's **AC1/AC4 real-child-execution
  conclusions**, which now again prove the expanded closure and real child
  execution from the release alone;
- its suspension of **Decision 0006's discharge** — the closure condition is
  now fully discharged through Tickets 01b and 01c together;
- its **Ticket-02 predecessor block**, which is now removed as recorded
  below.

No other Decision 0010 or Decision 0009 content is superseded, reopened, or
weakened.

## Downstream effect

- **Ticket 02 is unblocked but is NOT accepted.** No Ticket 02 acceptance
  criterion is complete. Its full real controlled-artifact AC1–AC5 suite
  must be rerun after its pending test-only SQLite live-WAL observation
  repair (read ledger counts through the live repository, or dispose the
  repository before opening an external read-only `DatabaseSync`) — evidence
  produced before 01c acceptance does not carry. Ticket 02 retains exclusive
  ownership of controlled-runtime construction, user authentication/model
  configuration, mandatory lifecycle handshake, and managed Agent-wrapper
  exposure.
- **Ticket 04 remains blocked** by Tickets 02 and 03, and retains packaged
  desktop/server final composition ownership.
- Ticket 03 remains ready-for-agent.

## Residual risks

- The focused 143-test evidence is bounded to the six suites named above;
  the full repository suite, `bun fmt`, `bun lint`, and `bun typecheck` were
  out of review scope (per review instructions) and remain owned by the
  repository's normal gates.
- The real-load legs require a clean `ALFIE_REPO_DIR` pinned checkout;
  without it they record an explicit skip, by design (AC5). Absence of the
  real checkout in a given environment means the real child-spawn proof was
  not exercised there.
- The closure derivation is proven for the current pin
  (`aa6fa4a85` / `0.15.0-alfie.4`). Any future Alfie pin must mechanically
  re-derive the prompt-read graph; changed dependencies must update the
  closure or fail release staging (Decision 0010 unchanged).
- Staged prompt bytes are the pinned commit's release-owned runtime content;
  future upstream prompt changes propagate only through a new pin and
  re-staged manifest, never through mutable runtime repair.

## Failure and rollback

If the accepted derivation, staging prompt leg, expanded verification, or
real-load proof is removed or regresses, Ticket 01c's AC proof no longer
applies and Ticket 02 must be considered blocked again for real-runtime
acceptance, exactly as under Decision 0010. Managed desktop initialization
must remain fail-closed with `managed-subagent-unavailable`; rollback must
never restore prompt-content fallback, post-verification mutation, ambient
supply, or acceptance of load-only evidence as executable-closure proof. A
future pin whose prompt-read graph cannot be mechanically derived must fail
release staging and be corrected in a new candidate, not repaired through
mutable runtime state.

## Reopening conditions

Reassess this acceptance only upon material evidence that:

- the derivation silently omits a required prompt read (including through an
  imported helper) or credits a non-required read;
- a prompt file in a shipped artifact resolves from, or was staged from,
  anything other than the exact clean pinned commit;
- manifest exactness, exclusion, or fail-close ordering regresses against
  the expanded closure;
- the real-load proof no longer reaches the first real child model request
  or no longer proves prompt-byte provenance from the staged closure;
- a Pi host or Alfie upgrade changes loader, alias, or prompt-read
  semantics; or
- a later owner-approved decision changes the governing closure or risk
  boundary.

Reopening this acceptance does not automatically reopen Decisions 0001–0010;
those are governed by their own reopening conditions.
