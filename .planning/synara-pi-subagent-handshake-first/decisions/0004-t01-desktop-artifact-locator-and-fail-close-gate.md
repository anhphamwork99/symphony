# T01 — Desktop artifact locator and fail-close gate

## Question

For Ticket 01, may desktop use a release-controlled artifact locator and a
production verifier to fail closed before Pi/global agent-directory discovery,
while deferring controlled Pi runtime construction and user auth/model
configuration to Ticket 02?

## Governing references

- Project Home [PROJECT.md](../PROJECT.md) (authoritative routing; owner
  `anhpham99`).
- [spec.md](../spec.md), Implementation Decisions 1, 2, 5, and 12.
- [Ticket 01](../issues/01-package-and-fail-close-managed-pi-artifact.md),
  AC1–AC5.
- [Ticket 02](../issues/02-bootstrap-verified-harness-and-detached-terminal-lifecycle.md),
  AC1–AC5.
- [Decision 0001](0001-release-controlled-extension.md), release-controlled
  extension and early unavailable behavior.
- [Decision 0002](0002-no-legacy-managed-subagent-fallback.md), desktop has no
  legacy/unmanaged fallback.
- [Decision 0003](0003-controlled-extension-with-user-runtime-configuration.md),
  controlled extension discovery is separate from explicit, user-local runtime
  configuration.

## Evidence considered

`PiAdapter.startSession` currently loads the Pi SDK and then calls
`makeAgentDir`; absent an explicit agent directory, `makeAgentDir` calls the
SDK's global `getAgentDir()` fallback. Inactive `listModels`, `listSkills`, and
`listCommands` independently perform the same SDK-import/agent-directory
resolution path. Desktop backend environment is derived from inherited process
environment and therefore requires explicit exclusion of agent-directory
override variables.

## Settled direction

1. In desktop mode, the desktop main process supplies exactly one
   release-derived bootstrap locator, `SYNARA_PI_SUBAGENT_ARTIFACT_DIR`. Its
   value is derived by desktop code from the selected packaged release
   resources; it is not accepted from renderer input, request/provider options,
   or inherited environment.
2. Desktop must explicitly remove `PI_CODING_AGENT_DIR` from the backend child
   environment. Any other SDK directory-override input that could redirect
   extension discovery must likewise be ineffective for desktop managed
   discovery. `SYNARA_PI_SUBAGENT_ARTIFACT_DIR` is a locator only; it is never
   repurposed as `PI_CODING_AGENT_DIR` and is not itself an agent directory.
3. Ticket 01 supplies a production verifier that uses generated manifest and
   digest material only. It must not invoke Git or use repository provenance at
   runtime. The verifier rejects missing, malformed, tampered, escaped, or
   symlinked artifact/manifest paths, and returns only trusted, bounded
   artifact metadata. It neither copies, packages, rewrites, hashes, logs, nor
   diagnoses user credential/model files.
4. Before any desktop path can import the Pi SDK, call `makeAgentDir()`, create
   or reload Pi services/resource loaders, or otherwise allow global extension
   discovery, it must pass the shared managed-artifact gate. This includes
   `startSession` and inactive model/skill/command discovery paths.
5. Required ordering for an invalid desktop artifact is:

   `reject managed-subagent-unavailable`
   → no `loadPiCodingAgentModule()` / `loadPiSdk()`
   → no `makeAgentDir()` / SDK global discovery
   → no session manager, child, admission, execution, lifecycle/card/outbox,
   or other durable side effect.

6. Ticket 01 does not choose a usable controlled Pi `agentDir`, bind the
   verified extension into a Pi runtime, load user auth/models, or expose the
   Agent wrapper. Until Ticket 02 supplies the explicit controlled runtime
   binding, a desktop path cannot convert a valid artifact locator into a
   fallback Pi configuration. It remains managed-subagent-unavailable rather
   than using a legacy or unmanaged path.
7. Ticket 02 exclusively owns selecting and passing the controlled extension
   directory and the explicit user-local auth/model source paths, then
   completing the required extension binding and handshake before Agent wrapper
   exposure.
8. Non-desktop behavior is unchanged: without the desktop locator/gate,
   existing explicit `agentDir` behavior and the SDK fallback remain available.

## Rationale

This is the smallest reversible separation that satisfies all controlling
decisions. Ticket 01 establishes trusted release provenance and prevents unsafe
discovery; Ticket 02 establishes the usable controlled runtime and keeps user
configuration local. Passing the artifact location through
`PI_CODING_AGENT_DIR`, or allowing a valid artifact alone to reach the existing
fallback, would collapse those responsibilities and violate the desktop
no-unmanaged-fallback invariant.

## Invariants

- Desktop extension discovery is release-selected, manifest/digest verified,
  and cannot be redirected by inherited environment or request input.
- Invalid desktop artifacts fail closed before SDK import and before durable or
  child-process side effects.
- Desktop never falls back to global/unmanaged extension discovery.
- User credential/model files remain user-local and are handled only through
  Ticket 02's explicit runtime configuration.
- No database migration and no external Alfie change are introduced.
- Non-desktop fallback behavior remains unchanged.

## Scope boundary and downstream constraints

Ticket 01 owns artifact packaging/manifest/digest generation, pure verification,
environment sanitization for the desktop backend, and the shared early denial
gate.

Ticket 02 owns the subsequently valid controlled runtime configuration,
extension binding, explicit user auth/model paths, required handshake, and
Agent-wrapper exposure. Ticket 01 must not implement those concerns as a
shortcut.

Verification for Ticket 01 must cover invalid/missing/tampered/malformed/path-
escape/symlink cases; poisoned inherited `PI_CODING_AGENT_DIR`; proof that
rejection precedes SDK import and agent-directory resolution; no durable side
effects; artifact exclusion; and unchanged non-desktop fallback. It must also
cover non-session Pi discovery entry points so they cannot bypass the gate.

## Rejected alternatives

- Passing the artifact locator through `PI_CODING_AGENT_DIR`.
- Trusting an inherited or request-controlled artifact locator.
- Verifying release provenance with Git at production runtime.
- Guarding only `startSession` while model/skill/command discovery retains a
  global fallback.
- Selecting a controlled `agentDir` or handling user auth/models in Ticket 01.
- Allowing a valid artifact to enable unmanaged/global fallback before Ticket 02.

## Failure and rollback implications

Artifact verification failure disables managed desktop subagents only; it must
not weaken desktop isolation by falling back to global Pi discovery. Reverting
a release artifact is accomplished by shipping a release whose generated
manifest and artifact again verify; runtime must not repair or source an
alternative artifact from user-controlled paths.

## Downstream effect

Ticket 01 may implement the release locator, verifier, environment
sanitization, and shared early gate. Ticket 02 must consume trusted verifier
output through an explicit controlled-runtime binding and must not reintroduce
global discovery.

## Reopening conditions

Reassess only if authoritative specification/decision records change, the Pi
SDK exposes an additional extension-discovery path that bypasses the shared
gate, release packaging cannot provide a fixed resource location plus generated
manifest/digest, or new evidence demonstrates that an explicit user-local
runtime configuration cannot coexist with a controlled extension directory.

## Supersedes

None.
