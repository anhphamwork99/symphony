# Decision 0009 — Ticket 01b final acceptance

- **Date:** 2026-08-22
- **Status:** Accepted — binding final acceptance
- **Consultation class:** Supervisor final acceptance; the one and only final-acceptance consultation for Ticket 01b
- **Scope:** The complete integrated Ticket 01b runtime-closure remediation at Symphony main `e5342b4ae`, its AC1–AC6 acceptance, and its dependency effect on Ticket 02. It does not accept Ticket 02 or Ticket 04, reopen owner-approved project boundaries, or expand Ticket 01b ownership.

## Question

Does the complete Ticket 01b candidate at `e5342b4ae` satisfy AC1–AC6 and Decisions 0006–0008 with trustworthy feature-level evidence, such that the runtime-closure remediation may be accepted and Ticket 02 unblocked?

## Governing references

- `../PROJECT.md`
- `../issues/01b-remediate-verified-managed-pi-runtime-closure.md`
- `0006-t01-runtime-closure-reassessment.md`
- `0007-t01b-host-peer-compatibility-reassessment.md`
- `0008-t01b-normal-dependency-host-alias-reassessment.md`
- `../spec.md`, especially Implementation Decisions 1–5 and 12
- The accepted project Testing Strategy Governance decision
- Independent feature-level reviewer evidence for `e5342b4ae`

## Candidate and evidence

The accepted candidate consists of:

- `fd229b1ab`, `f156d8d8f`, and `6976942ae`, delivering the deterministic lock-proven runtime closure, expanded verification, exclusions, and fail-close ordering;
- `799af158a`, aligning the packaged Pi host family to `0.83.0` under Decision 0007;
- `75a12e40c`, pinning a Bun patch for `@earendil-works/pi-coding-agent@0.83.0` that removes only the three scoped `@sinclair/typebox*` aliases from both executable loader alias tables and adds the real staged-closure proof required by Decision 0008; and
- `e5342b4ae`, recording the integrated candidate evidence.

The independent reviewer reported PASS with high confidence after directly rerunning:

1. staging tests: 12/12 passed;
2. dependency-closure tests: 20/20 passed;
3. verifier and desktop-gate tests: 75/75 passed;
4. real pinned-Alfie staged load: 1/1 passed;
5. absent-real-checkout behavior: one explicit skip;
6. frozen-lockfile installation;
7. installed-loader inspection; and
8. negative-control alias restoration.

The real load verified the artifact before and after loading, used the production loader with `noExtensions` and only the staged extension path, observed the real managed `Agent` tool, resolved `@sinclair/typebox@0.34.49`, ordinary dependencies, and required shared modules from the staged closure, rejected global/user/ancestor/NODE_PATH canaries, and detected alias restoration in the negative control.

Unrelated owner worktree changes to `CLAUDE.md`, `apps/server/.pi/notifications.jsonl`, `apps/server/src/diagnostics/Layers/ThreadDiagnosticsQuery.test.ts`, and `docs/agents/` were excluded from candidate and reviewer scope.

## Binding decision

Ticket 01b at Symphony main `e5342b4ae` is accepted.

1. **AC1 passes:** the clean pinned source produces the complete extension, required-shared, and lock-proven regular-file dependency closure with every regular file size- and digest-recorded.
2. **AC2 passes:** repeat staging is deterministic and dependency selection is lock-derived rather than range-floating or ambient.
3. **AC3 passes:** verification rejects missing, tampered, unlisted, escaping, and symlinked content throughout the expanded closure with bounded safe diagnostics and no partial trust.
4. **AC4 passes:** the packaged host family satisfies the `>=0.83.0` Pi peer floor, while effective scoped TypeBox resolution uses staged, manifest-verified `@sinclair/typebox@0.34.49`. Shared and ordinary dependencies resolve from the staged closure; user/global/ambient paths and post-verify mutation are excluded.
5. **AC5 passes:** user authentication, model configuration, credentials, key material, and user-global extension content remain excluded.
6. **AC6 passes:** invalid closure state rejects `managed-subagent-unavailable` before Pi SDK import, global discovery, or durable side effects, with no fallback.

The Ticket 01b no-goals remain respected. This acceptance does not accept any Ticket 02 criterion or move controlled-runtime construction, runtime configuration, handshake, or Agent-wrapper ownership into Ticket 01b.

Upon persistence of this record, Decision 0006’s Ticket 01b acceptance condition is satisfied and Ticket 02 is unblocked. Ticket 02 must still prove its own acceptance criteria independently. Ticket 04 remains blocked by its existing dependencies and retains packaged desktop/server composition ownership.

## Reviewer observations

The loader-source text slicing is accepted as non-authoritative defense-in-depth. Acceptance rests on behavioral production-loader resolution, observed artifact-local TypeBox package identity and path, pre/post-load verification, canary exclusion, and the alias-restoration negative control.

The host patch’s process-wide scope is accepted as a bounded consequence of Decision 0008’s permitted remove-or-narrow route. It is version-pinned and removes only scoped TypeBox aliases while retaining Pi-peer and unscoped TypeBox aliases. Managed loading remains isolated with `noExtensions` and only the staged verified path. This observation is not an unresolved material acceptance issue.

## Rejected alternatives

- Retaining scoped TypeBox host aliases and accepting a staged-but-bypassed package.
- Treating successful load, host ownership, or static export overlap as proof of normal-dependency closure.
- Using ambient, user-global, ancestor, or `NODE_PATH` fallback.
- Mutating or installing into the artifact after verification.
- Using a synthetic extension factory instead of the real pinned artifact.
- Weakening manifest exactness or fail-close ordering.
- Moving closure remediation into Ticket 02 or Ticket 04.

## Follow-up and frontier

- Ticket 01b is accepted.
- Ticket 02 is unblocked and retains exclusive ownership of controlled runtime construction, user authentication/model configuration, mandatory lifecycle handshake, and managed Agent-wrapper exposure.
- Ticket 04 retains final packaged desktop/server composition acceptance.
- On any Pi host upgrade, revalidate patch applicability, installed alias behavior, frozen-lock reproducibility, and real artifact-local closure loading.

## Failure and rollback

If the accepted closure, host alignment, or alias patch is removed or rolled back, Ticket 01b’s AC4 proof no longer applies and Ticket 02 must be considered blocked again. Managed desktop initialization must remain fail-closed with `managed-subagent-unavailable`; rollback must never restore global fallback, post-verification mutation, or acceptance of a staged-but-bypassed dependency.

A future patch-application failure, host-loader change, dependency-resolution change, or real-load regression must fail release verification and be corrected in a new candidate rather than repaired through mutable runtime state.

## Reopening conditions

Reassess this acceptance only upon material evidence that:

- the pinned patch is not applied to the shipped 0.83.0 loader;
- effective TypeBox or another normal dependency resolves outside the verified artifact;
- the real pinned extension no longer loads from the manifest-verified closure;
- manifest exactness, exclusion, or fail-close ordering regresses;
- a Pi host upgrade changes loader or alias semantics;
- a required dependency cannot legally or reproducibly ship; or
- a later owner-approved decision changes the governing closure or risk boundary.

No prior binding decision is superseded. Decisions 0006–0008 remain binding and are fulfilled by this acceptance. Only Ticket 01b’s pending-acceptance status and Decision 0006’s temporary Ticket 02 block are discharged.
