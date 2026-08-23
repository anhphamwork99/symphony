# Decision 0016 — Ticket 04 production-composition acceptance boundary

**Status:** Binding Decision — Accepted  
**Trigger:** Material technical decision verification before Ticket 04
implementation  
**Scope:** Ticket 04 desktop packaged-resource environment handoff into the
production WebSocket/server/real-Pi/durable composition

## Question

Must Ticket 04 acceptance launch an actual Electron/backend OS child process,
or is it sufficient to invoke the exact production packaged-resource
environment resolver and pass its complete derived environment into the
production WebSocket/server/Pi composition that consumes it?

## Governing references

- [PROJECT.md](../PROJECT.md)
- [Ticket 04](../issues/04-prove-desktop-production-composition-and-accept.md)
- [spec.md](../spec.md)
- [terms.md](../terms.md)
- [Decision 0004](0004-t01-desktop-artifact-locator-and-fail-close-gate.md)
- [Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)

## Evidence considered

1. `apps/desktop/src/piSubagentDesktopArtifactEnvironment.ts` is the production
   desktop resolver. `applyPiSubagentArtifactBackendEnv` derives the artifact
   locator only from packaged resource roots, removes inherited
   `SYNARA_PI_SUBAGENT_ARTIFACT_DIR` and `PI_CODING_AGENT_DIR`, selects the
   first existing packaged-resource candidate, and returns a new environment
   object without mutating the inherited environment.
2. `apps/desktop/src/main.ts` establishes the production handoff:
   `backendEnv()` calls that resolver with `app.isPackaged`,
   `app.getAppPath()`, `process.resourcesPath`, and the real filesystem
   existence check; `startBackend()` passes its result to
   `ChildProcess.spawn(..., { env })`. No additional Pi-specific selection,
   verification, fallback, or transformation occurs in the OS-spawn step.
3. `apps/server/src/provider/Layers/PiAdapter.ts` consumes the backend
   environment at the managed-artifact gate through
   `options?.piSubagentDesktopArtifactGateEnv ?? process.env`. The option is an
   explicit test seam; production consumes the backend process environment.
   Both feed the same gate evaluator.
4. `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts` composes the
   production server runtime, public WebSocket route, real Pi adapter, real
   controlled artifact, persistence, durable lifecycle, and execution-card
   bridges. Its current desktop-managed configuration injects only
   `artifactDir`; that form alone does not prove the desktop resolver or
   poisoned-environment scrubbing.
5. Ticket 04's approved AC1 seam is the packaged desktop resource resolver and
   backend process composition boundary. Testing Strategy Governance prefers
   the highest stable boundary that proves behavior while permitting the
   smallest lower seam necessary.

## Binding decision

Ticket 04 acceptance is **not required to spawn an actual Electron application
or backend OS child process**.

Acceptance is sufficient when one continuous test composition:

1. calls the exact production `applyPiSubagentArtifactBackendEnv` resolver
   using packaged-mode inputs and a real release-shaped packaged-resource
   layout;
2. starts with a poisoned inherited environment containing artifact and Pi
   agent-directory redirect attempts;
3. preserves and passes the resolver's complete returned environment as one
   object into the exact production desktop managed-artifact consumer seam;
4. runs that environment through the production
   WebSocket/server/real-Pi/durable composition; and
5. proves Ticket 04 success and failure outcomes at public WebSocket, durable
   journal, and hydrated execution-card boundaries.

Passing the complete derived environment through
`piSubagentDesktopArtifactGateEnv` is semantically equivalent for the
Pi-specific invariant to placing that same object in a spawned backend's
`process.env`. The OS spawn adds transport and Electron lifecycle coverage but
no additional managed-Pi selection or security decision.

An actual OS/Electron/backend-child launch may be supplemental smoke evidence,
but it is neither mandatory acceptance evidence nor a substitute for the
deterministic resolver-to-consumer proof.

## Required acceptance boundary

```text
release-shaped packaged resources
  → production applyPiSubagentArtifactBackendEnv
  → complete derived backend environment
  → production desktop artifact gate
  → production Pi runtime and mandatory handshake
  → production WS/orchestration/durable projection
  → execution-card truth
```

The test must not reconstruct only `SYNARA_PI_SUBAGENT_ARTIFACT_DIR` after
calling the resolver. It must carry the complete resolver result so removal of
inherited `PI_CODING_AGENT_DIR`, removal or replacement of a poisoned inherited
artifact locator, and preservation of legitimate user runtime configuration
are exercised together.

A focused desktop wiring obligation must also establish that production
`startBackend()` uses the environment derived by `backendEnv()` for its child
spawn. A small composition or contract test around the production
environment-construction seam is sufficient; launching Electron or waiting for
a child process is not required.

## Prohibited substitutions

- Directly injecting `artifactDir` into the real-Pi harness without first
  invoking the production desktop resolver.
- Rebuilding a minimal environment containing only
  `SYNARA_PI_SUBAGENT_ARTIFACT_DIR`.
- Using a synthetic extension, fake Pi adapter, fake handshake, fake durable
  lifecycle, or UI-only card transition for AC1–AC3.
- Using repository provenance or an Alfie checkout in place of the
  release-controlled manifest-exact packaged artifact.
- Loading, modifying, inspecting as a runtime source, or falling back to the
  planted global extension.
- Treating successful OS child creation or environment inheritance alone as
  proof of handshake, detached liveness, terminal journal truth, or card
  correctness.
- Changing lifecycle semantics, adding an unmanaged fallback, changing Alfie
  source, or introducing a database migration.

## Verification obligations

Ticket 04 evidence must demonstrate:

1. The resolver selects the official artifact from a release-shaped packaged
   resource candidate.
2. Poisoned inherited artifact and `PI_CODING_AGENT_DIR` values do not reach
   the consuming managed-artifact gate.
3. The planted old global extension remains byte-for-byte unchanged and is
   never loaded.
4. The exact derived environment reaches the production desktop-mode gate;
   direct `artifactDir` injection alone is insufficient.
5. The real controlled artifact completes its mandatory handshake before Agent
   exposure.
6. A real child detaches, continues liveness reporting, commits exactly one
   fenced terminal result, and drives the matching `Running in background` to
   terminal card transition through public production boundaries.
7. Missing, corrupt, unsupported, malformed, or invalid-runtime cases fail
   safely before managed child, admission, execution, lifecycle, card, or
   outbox side effects.
8. Existing journal-first terminal, orphaning, Resume generation fencing, and
   teardown-uncertainty suites are rerun against the candidate as required by
   AC4.
9. Focused evidence protects the `backendEnv()` to
   `startBackend().spawn({ env })` wiring without making an OS child launch
   mandatory.
10. AC5's full validation, independent review, and single final Supervisor
    consultation remain required.

## Consequences for Work Package decomposition

Ticket 04 separates two evidence responsibilities:

1. **Desktop environment handoff WP:** exercise the exact packaged-resource
   resolver, hostile inherited environment, release-shaped paths, complete
   derived environment, and production spawn-wiring contract.
2. **Integrated production-composition WP:** feed that complete derived
   environment into the production desktop-mode
   WS/server/real-Pi/durable harness and prove AC1–AC3 through public and
   durable outputs.

AC4 regression verification and AC5 project-wide validation, review, and
acceptance remain distinct final work packages. A dedicated Electron or
backend-child-spawn acceptance WP is not required.

## Rejected alternatives

- **Mandatory Electron/backend OS spawn:** rejected because spawn contributes
  only generic environment transport to the managed-Pi invariant, increases
  operational flakiness and teardown burden, and is not required by the
  approved testing seam.
- **Direct artifact-directory injection:** rejected because it bypasses the
  desktop packaged-resource resolver and cannot prove inherited override
  scrubbing or locator derivation.
- **Resolver-only unit evidence:** rejected because it does not prove
  consumption by the production server/Pi/durable composition.
- **OS-spawn-only smoke evidence:** rejected because process startup does not
  prove handshake-first or durable lifecycle invariants.

## Assumptions and residual uncertainty

- `startBackend()` currently performs no Pi-specific transformation after
  `backendEnv()` and before `ChildProcess.spawn`.
- Generic Electron packaging, executable discovery, process supervision, and
  OS environment transport remain outside Ticket 04 unless new evidence
  connects one directly to managed artifact selection or runtime correctness.
- If future source introduces Pi-specific child-spawn logic, this equivalence
  must be reassessed.

## Failure and rollback implications

If exact resolver-to-consumer integration cannot be established, Ticket 04
remains unaccepted. The implementation must not substitute direct
`artifactDir` injection. The safe fallback remains fail-closed behavior, never
the global extension or an unmanaged Agent path.

This decision requires no production rollback because it governs acceptance
evidence and does not alter runtime behavior.

## Downstream effect

Implementation may proceed without an actual OS/Electron backend-child launch,
provided the complete resolver-derived environment is used by the exact
production consuming composition and production spawn wiring is separately
protected.

Tickets 01–03, their accepted policies, the manifest-exact artifact boundary,
handshake ordering, lifecycle semantics, and project scope remain unchanged.

## Owner escalation

No owner escalation is required. This decision settles a testing/composition
seam inside the accepted Ticket 04 contract and changes no owner-approved
policy.

## Reopening conditions

Reassess only if production adds Pi-specific selection, sanitization,
verification, or fallback logic between `backendEnv()` and the spawned
backend; backend environment normalization changes managed-artifact behavior;
the production consumer can no longer accept the complete derived environment
through the approved seam; release packaging differs from the tested candidate
layout; or an authoritative project record is amended to require executable
Electron launch evidence.

**Supersedes:** None.
