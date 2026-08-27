# Decision 0019 — Managed Pi discovery immutability bugfix acceptance

- **Date:** 2026-08-25
- **Status:** Binding Decision — **ACCEPTED**
- **Semantic outcome:** Supervisor Reassessment / follow-up acceptance
- **Prior record:** [Decision 0018](0018-web-dev-controlled-pi-artifact-follow-up-acceptance.md)
- **Source candidate:** `ba4a32e32ccd7552ed8dd74950bc49f8778cf9a2`
- **Implementation range:** `f0ed0ac94..ba4a32e32`
- **Independent review:** Sole independent review recommends **PASS** with **High** confidence and no blockers.
- **Write set of consultation:** None.
- **Scope:** The managed Pi model-runtime binding used by inactive `listSkills` and
  `listCommands` discovery on the controlled artifact path, and the corresponding
  real-Pi immutability acceptance evidence.
- **Non-scope:** Reopening or replacing the broader web/dev controlled artifact
  follow-up, changing the release artifact or runtime security boundary, changing
  the public protocol, adding a migration, or authorizing source changes beyond
  the candidate range.

## Question

Does the exact successor candidate `ba4a32e32`, implementing the managed Pi
discovery immutability bugfix in `f0ed0ac94..ba4a32e32`, satisfy the
Supervisor's reassessment criteria by preventing inactive managed skill and
command discovery from writing SDK-default state into the verified controlled
artifact while preserving the accepted artifact-only loading and runtime
boundaries?

## Governing references

- Project Home, [PROJECT.md](../PROJECT.md), as the authoritative lifecycle and
  routing authority.
- [Decision 0018](0018-web-dev-controlled-pi-artifact-follow-up-acceptance.md),
  as the binding broader web/dev controlled-artifact follow-up and the prior
  source frontier for this narrowly reassessed defect.
- [Decision 0017](0017-t04-final-acceptance.md), as the binding original desktop
  production-composition acceptance.
- The handshake-first feature specification, [spec.md](../spec.md).
- Candidate source range `f0ed0ac94..ba4a32e32`, with the exact reviewed tip
  `ba4a32e32ccd7552ed8dd74950bc49f8778cf9a2`.

## Evidence considered

The Supervisor considered the exact candidate and the supplied independent
review evidence:

- Focused unit verification: **33/33**.
- Real-Pi verification: **9/9**.
- The sole independent review returned **PASS**, with **High** confidence and
  no blockers.
- `bun fmt`, `bun lint`, and `bun typecheck` were intentionally not run because
  the explicit repository policy did not authorize those heavyweight checks
  for this consultation. No claim is made that they freshly passed on this
  candidate.

The reassessed defect was that the SDK defaults used while `listSkills` or
`listCommands` constructed managed discovery services could persist
`agent/auth.json` into the controlled artifact. The candidate binds the
model-runtime persistence paths to the resolved `userAgentDir` while retaining
the controlled artifact `agentDir` for managed loading. Its focused and real-Pi
evidence also verifies that discovery remains inactive, the controlled artifact
remains valid and unchanged, and the subsequent managed session remains
usable.

## Binding reassessment

The reassessment **passes**. Candidate
`ba4a32e32ccd7552ed8dd74950bc49f8778cf9a2` is accepted for the managed Pi
discovery immutability bugfix across `f0ed0ac94..ba4a32e32`.

For inactive managed `listSkills` and `listCommands` discovery, the binding is:

- the `agentDir` used for managed extension and resource loading remains the
  controlled, verified artifact directory;
- loading remains artifact-only through the controlled resource-loader boundary;
- the SDK `modelRuntime` is created against the resolved `userAgentDir`, so its
  mutable defaults such as `auth.json` cannot be written into the verified
  artifact; and
- settings remain in memory rather than being persisted through the artifact
  or an ambient settings location.

Discovery therefore does not start an active managed session or create a
second artifact authority. The same binding remains compatible with the
accepted handshake-before-admission, managed runtime, and durable lifecycle
boundaries.

This decision narrowly supersedes Decision 0018's source frontier for the
managed discovery immutability defect. It does not supersede Decision 0018's
broader web/dev controlled-artifact acceptance, and it does not supersede
Decision 0017's original packaged desktop production acceptance.

## Preserved invariants

The accepted bugfix preserves the following binding invariants:

- managed artifact selection remains release-controlled, pinned,
  manifest-exact, and production-verified;
- the controlled artifact `agentDir` remains the only directory from which the
  managed extension and its resources are loaded;
- the model runtime's mutable authentication and model state is backed by the
  resolved `userAgentDir`, not by the verified artifact;
- inactive `listSkills` and `listCommands` discovery does not start a provider
  session, admit managed work, or mutate the controlled artifact;
- settings used for the managed discovery path remain in memory;
- no ambient, user-global, parent-directory, or legacy managed-artifact
  fallback is introduced;
- managed Pi admission remains behind artifact verification and the mandatory
  handshake;
- failure diagnostics remain bounded and redacted, with no credentials,
  prompts, provider configuration, hostile paths, or protocol details leaked;
- journal-first lifecycle, identity/attempt/generation fencing, terminal
  authority, non-terminal uncertainty, explicit-only Resume, and durable
  execution-card truth remain unchanged; and
- the broader web/dev boundary remains governed by Decision 0018, while the
  original packaged desktop production chain remains governed by Decision 0017.

## Accepted residuals

The following residuals are accepted and do not block this reassessment:

1. The heavyweight workspace checks were intentionally not run because the
   explicit policy did not authorize them. The recorded 33/33 focused unit
   evidence, 9/9 real-Pi evidence, and independent review are the applicable
   verification set for this consultation.
2. The `userAgentDir` is intentionally a mutable runtime location for SDK
   model and authentication state. This does not make it an artifact-loading
   authority; managed extension and resource loading remains controlled by the
   verified artifact directory.
3. This decision proves the inactive managed skill/command discovery
   immutability boundary and its real-Pi continuation. It does not claim a new
   generic provider-discovery contract or alter non-Pi adapters.
4. The candidate's exact source and supplied command results are assumed to
   correspond to the reviewed full hash above.

These residuals do not weaken the accepted release-controlled artifact,
handshake, lifecycle, security, or desktop-production invariants.

## Rejected alternatives

1. **Continue binding the model runtime to the controlled artifact directory.**
   Rejected. SDK defaults can persist `agent/auth.json` and other mutable
   runtime state there, violating artifact immutability.
2. **Load managed discovery from the user, global, or parent-directory runtime
   instead.** Rejected. The user runtime is the persistence location for the
   model runtime only; managed extension and resource loading must remain
   artifact-only and controlled.
3. **Run `listSkills` or `listCommands` through an active managed session.**
   Rejected. Inactive discovery must not create a provider session or perform a
   durable managed admission as a side effect of listing.
4. **Persist settings in the artifact or another ambient settings location.**
   Rejected. The managed discovery path uses in-memory settings and must not
   create a second mutable artifact authority.
5. **Treat the absent heavyweight checks as a candidate failure.** Rejected for
   this consultation because the explicit policy prohibited running those
   checks without authorization; their absence is recorded as residual
   uncertainty rather than converted into a false pass claim.
6. **Expand this decision into a new desktop, web/dev, protocol, or
   durable-subagent acceptance.** Rejected. The accepted frontier is limited to
   the managed Pi discovery immutability bugfix and its controlled runtime
   binding.

## Downstream routing

- Route the managed Pi discovery immutability bugfix to this Decision 0019 as
  the authoritative current follow-up frontier.
- Preserve candidate
  `ba4a32e32ccd7552ed8dd74950bc49f8778cf9a2` and implementation range
  `f0ed0ac94..ba4a32e32` as the accepted source frontier for this bugfix.
- Keep Decision 0018 authoritative for the broader web/dev controlled Pi
  artifact preparation and forwarding boundary, except for this narrowly
  superseded source frontier.
- Keep Decision 0017 authoritative for the original packaged desktop
  production acceptance and its accepted source candidate
  `59c06c413e131f5d441aafa696ae9e79c4b28c14`.
- Keep Decisions 0001–0018 otherwise unchanged; this record does not reopen
  accepted tickets or authorize external side effects.

## Reassessment triggers

Reassess this decision upon material evidence that:

1. the candidate hash, implementation range, review provenance, or reported
   verification results do not correspond to the accepted source;
2. inactive managed `listSkills` or `listCommands` discovery writes
   `auth.json`, model state, settings, or any other mutable state into the
   verified controlled artifact;
3. managed extension or resource loading can bypass the controlled artifact,
   use a user/global/parent-directory fallback, or admit a second artifact
   authority;
4. discovery starts an active provider session, performs durable managed
   admission, or bypasses the mandatory handshake;
5. user-agent runtime state leaks credentials, prompts, provider configuration,
   hostile paths, or other sensitive material through diagnostics or artifact
   handling;
6. the controlled runtime binding regresses the accepted managed session,
   durable lifecycle, terminal fencing, non-terminal uncertainty,
   explicit-only Resume, or whole-card projection behavior; or
7. the broader web/dev acceptance governed by Decision 0018 or the original
   packaged desktop production chain governed by Decision 0017 changes
   materially or meets its own reopening conditions.

A trigger requires a new binding reassessment. It does not authorize a second
final-acceptance consultation for the original desktop Ticket 04 boundary.

**Supersedes:** Decision 0018's source frontier only, for the managed Pi
discovery immutability bugfix. Decision 0018 remains authoritative for its
broader web/dev scope, and Decision 0017 remains authoritative for the
original packaged desktop production scope.
