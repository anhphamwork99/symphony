# Decision 0018 — Web/dev controlled Pi artifact follow-up acceptance

- **Date:** 2026-08-25
- **Status:** Binding Decision — **ACCEPTED**
- **Semantic outcome:** Supervisor Reassessment / follow-up acceptance
- **Prior record:** [Decision 0017](0017-t04-final-acceptance.md)
- **Source candidate:** `5c27bcb4fc4a1056d6cc3d0c63187f5336fc0359`
- **Implementation range:** `2e4ea4de9..5c27bcb4f`
- **Independent review:** Sole independent review recommends **PASS**.
- **Write set of consultation:** None.
- **Scope:** The controlled Pi artifact path used by local `dev` and
  `dev:server` workflows.
- **Non-scope:** Reopening or replacing the original packaged desktop
  production acceptance, changing the release artifact or runtime security
  boundary, changing the public protocol, adding a migration, or authorizing
  source changes beyond the candidate range.

## Question

Does the exact successor candidate `5c27bcb4f`, implementing the web/dev
controlled Pi artifact follow-up in `2e4ea4de9..5c27bcb4f`, satisfy the
Supervisor's reassessment criteria and provide an acceptable controlled
artifact boundary for local `dev` and `dev:server` execution while preserving
Decision 0017's original desktop production acceptance?

## Governing references

- Project Home, [PROJECT.md](../PROJECT.md), as the authoritative lifecycle
  and routing authority.
- [Decision 0017](0017-t04-final-acceptance.md), as the binding original
  desktop production-composition acceptance.
- The handshake-first feature specification, [spec.md](../spec.md).
- The accepted Ticket 04 production-composition evidence and its independent
  review.
- Candidate source range `2e4ea4de9..5c27bcb4f`, with the exact reviewed tip
  `5c27bcb4fc4a1056d6cc3d0c63187f5336fc0359`.

## Evidence considered

The Supervisor considered the exact candidate and the supplied independent
review evidence:

- Cache and dev-runner verification: **55/55**.
- Artifact gate, bootstrap, and verifier verification: **139/139**.
- Real-Pi web and desktop verification: **8/8**.
- CLI and web builds passed.
- The sole independent review returned **PASS**.
- `bun fmt`, `bun lint`, and `bun typecheck` were not run because the explicit
  repository policy did not authorize those heavyweight checks for this
  consultation. No claim is made that they freshly passed on this candidate.

The candidate adds the controlled dev artifact preparation and forwarding
seam, keyed to the pinned source and resolved Synara home, and reuses the
release stager and production verifier. The cache and runner evidence covers
pin-derived locations, verified cache hits, tamper or wrong-pin quarantine,
concurrent preparation locking, bounded cache failures, and the `dev` /
`dev:server` forwarding policy. The gate/bootstrap/verifier evidence covers
fail-closed artifact and runtime admission behavior. The real-Pi evidence
composes the controlled artifact with the web/server and desktop paths; the
build evidence covers the CLI and web build surfaces.

## Binding reassessment

The reassessment **passes**. Candidate
`5c27bcb4fc4a1056d6cc3d0c63187f5336fc0359` is accepted for the scoped
web/dev follow-up.

This decision is a binding, narrow extension of Decision 0017's
release-controlled artifact boundary to local `dev` and `dev:server` startup.
Those modes must prepare or locate the pin-keyed controlled artifact through
the verified dev cache and forward the resulting controlled locator into the
server path. A cache miss, invalid or tampered entry, lock or filesystem
failure, invalid provenance, or failed production verification fails closed
with a bounded diagnostic and does not admit managed Pi work.

This decision does not supersede Decision 0017. Decision 0017 remains the
sole authoritative acceptance for the original packaged desktop production
composition, including its exact release-resource resolver, complete backend
environment, production WebSocket/server/real-Pi/durable/card chain, and
associated acceptance boundary. Decision 0018 does not establish a second
Ticket 04 desktop final-acceptance consultation.

## Preserved invariants

The accepted follow-up preserves the following binding invariants:

- artifact selection remains release-controlled, pinned, manifest-exact, and
  production-verified;
- the dev cache is keyed by the exact pinned source and is not a second,
  independently mutable artifact authority;
- invalid, tampered, wrong-pin, partial, or symlinked cache entries are not
  forwarded as controlled artifacts;
- cache locking and quarantine remain bounded and fail closed;
- inherited or foreign artifact redirects cannot replace the launcher-derived
  controlled locator on the scoped dev/server path;
- managed Pi admission remains behind artifact verification and the mandatory
  handshake;
- failure diagnostics remain bounded and redacted, with no credentials,
  prompts, provider configuration, hostile paths, or protocol details leaked;
- no ambient, user-global, parent-directory, or legacy managed-artifact
  fallback is introduced;
- journal-first lifecycle, identity/attempt/generation fencing, terminal
  authority, non-terminal uncertainty, explicit-only Resume, and durable
  execution-card truth remain unchanged; and
- the packaged desktop production path remains governed by Decision 0017 and
  is not replaced by the dev runner or cache.

## Accepted residuals

The following residuals are accepted and do not block this reassessment:

1. The heavyweight workspace checks were not freshly run because the explicit
   policy did not authorize them. The recorded 55/55, 139/139, 8/8, and build
   evidence is the applicable verification set for this consultation.
2. The local dev cache is a launcher-owned filesystem cache rather than a
   packaged desktop resource. Its first-run staging, lock wait, quarantine,
   and filesystem failure behavior remain bounded by the tested runner/cache
   contract.
3. This follow-up proves the controlled `dev`/`dev:server` boundary; it does
   not claim generic Electron startup, OS-child discovery, or packaging-host
   behavior beyond the production desktop boundary already accepted by
   Decision 0017.
4. The candidate's exact source and supplied command results are assumed to
   correspond to the reviewed full hash above.

These residuals do not weaken the accepted release-controlled artifact,
handshake, lifecycle, security, or desktop-production invariants.

## Rejected alternatives

1. **Require a second packaged desktop final-acceptance consultation.**
   Rejected. Decision 0017 already finally accepts the original desktop
   production composition; this record is the authorized narrow reassessment
   and follow-up acceptance for local `dev`/`dev:server`.
2. **Allow `dev` or `dev:server` to use an ambient or user-global artifact.**
   Rejected. The follow-up must use the pin-keyed controlled cache and the
   same production stager/verifier boundary.
3. **Forward a cache entry before verification, or continue after a cache
   preparation failure.** Rejected. Invalid provenance, cache corruption,
   lock/filesystem failures, and verifier failure remain fail-closed.
4. **Treat the absent heavyweight checks as a candidate failure.** Rejected
   for this consultation because the explicit policy prohibited running those
   checks without authorization; their absence is recorded as residual
   uncertainty rather than converted into a false pass claim.
5. **Expand this decision to unrelated web presentation, protocol, desktop,
   or durable-subagent changes.** Rejected. The accepted frontier is limited to
   the controlled artifact preparation and forwarding boundary for `dev` and
   `dev:server`.

## Downstream routing

- Route the web/dev controlled Pi artifact follow-up to this Decision 0018 as
  its authoritative binding acceptance.
- Preserve candidate
  `5c27bcb4fc4a1056d6cc3d0c63187f5336fc0359` and implementation range
  `2e4ea4de9..5c27bcb4f` as the accepted source frontier for this follow-up.
- Keep Decision 0017 authoritative for the original packaged desktop
  production acceptance and its accepted source candidate
  `59c06c413e131f5d441aafa696ae9e79c4b28c14`.
- Keep Decisions 0001–0017 otherwise unchanged; this record does not reopen
  accepted tickets or authorize external side effects.

## Reassessment triggers

Reassess this decision upon material evidence that:

1. the candidate hash, implementation range, review provenance, or reported
   verification results do not correspond to the accepted source;
2. `dev` or `dev:server` can bypass pin derivation, cache verification,
   quarantine, locking, or the production artifact verifier;
3. an inherited, global, parent-directory, wrong-pin, tampered, symlinked, or
   partial artifact can be forwarded or loaded;
4. a cache or runner failure admits managed work, leaks raw paths or sensitive
   configuration, or produces an unbounded diagnostic;
5. the controlled locator or complete runtime environment does not reach the
   intended server/Pi gate on the scoped path;
6. handshake-before-admission, artifact isolation, durable lifecycle,
   terminal fencing, non-terminal uncertainty, explicit Resume, or whole-card
   projection regresses as a result of the follow-up; or
7. the original packaged desktop production chain accepted by Decision 0017
   changes materially or its own reopening conditions are met.

A trigger requires a new binding reassessment. It does not authorize a second
final-acceptance consultation for the original desktop Ticket 04 boundary.

**Supersedes:** None. This decision narrowly extends Decision 0017 for the
scoped web/dev follow-up; Decision 0017 remains authoritative for its original
scope.
