# Decision 0008 — T01b normal-dependency host-alias reassessment

- **Date:** 2026-08-22
- **Status:** Accepted — binding technical-direction reassessment. This is
  not final acceptance of Ticket 01b.
- **Consultation class:** Supervisor material technical-decision verification.
- **Scope:** The Ticket 01b AC4 treatment of a real Pi loader alias that
  substitutes release-host code for a pinned extension's normal dependency.
  This does not reopen the closure, manifest exactness, fail-close ordering,
  global-fallback prohibition, user-configuration boundary, or Tickets 02–04
  ownership.

## Question

May Ticket 01b AC4 pass when the real aligned Pi `0.83.0` loader aliases the
pinned Alfie extension's normal `@sinclair/typebox` dependency to host-resolved
code, while the artifact still stages and manifest-verifies lock-selected
`@sinclair/typebox@0.34.49`?

## Governing references

- Project Home: [PROJECT.md](../PROJECT.md)
- [Ticket 01b](../issues/01b-remediate-verified-managed-pi-runtime-closure.md),
  especially AC4.
- [Decision 0006](0006-t01-runtime-closure-reassessment.md), especially its
  lock-proven, manifest-exact closure and real-load requirements.
- [Decision 0007](0007-t01b-host-peer-compatibility-reassessment.md), whose
  host-supplied compatibility rule is limited to declared Pi peers.
- [spec.md](../spec.md), Implementation Decisions 1–5.

## Evidence

1. The pinned Alfie extension declares `@sinclair/typebox: ^0.34.49` as a
   normal dependency in
   `/Users/anhpham99/alfie/agent/extensions/pi-subagents/package.json`.
2. Its `package-lock.json` selects `@sinclair/typebox@0.34.49` with a registry
   URL and SHA-512 integrity. Ticket 01b staging materializes and
   manifest-records it from an isolated lock install.
3. The aligned, release-packaged Pi `0.83.0` loader deterministically aliases
   `@sinclair/typebox` to host-resolved code while loading extensions.
4. The current host lock records `typebox@1.3.7`; no evidence identifies the
   alias target as the pinned extension's lock-selected
   `@sinclair/typebox@0.34.49`, nor establishes byte-equivalence or an
   upstream compatibility assertion.
5. The artifact-local `croner`, `nanoid`, and `yaml` dependencies remain
   ordinary non-aliased closure dependencies. User/global/ambient resolution
   remains forbidden.

## Finding

The current proposed AC4 pass is rejected. A manifest-verified artifact copy
that the loader bypasses does not prove the bytes actually executing for the
normal dependency. Release ownership, Pi-family version alignment, successful
loading, static API overlap, or staging an unused duplicate are necessary but
not sufficient evidence of the Decision 0006 runtime closure.

## Binding decision

A loader-mandated host alias for a **normal dependency** may satisfy Ticket
01b AC4 only when the effective supplied module is proven to be either:

1. the exact lock-selected package identity and version, with provenance at
   least equivalent to the artifact lock/integrity proof; or
2. covered by an Alfie-source-authoritative, exact artifact/host/aliased-module
   compatibility assertion accepted through a further reassessment.

The simplest compliant route is to remove or narrow the normal-dependency alias
so standard resolution uses the staged, manifest-verified
`@sinclair/typebox@0.34.49` artifact copy. Until artifact-local resolution or
qualifying exact host supply is proven, AC4 remains incomplete.

### Narrow amendment

Decision 0006's requirement that dependency imports resolve from the verified
release closure is clarified: loader-mandated host supply can count as closure
content only under the exact-supply or source-authoritative compatibility rule
above. Merely staging and verifying a bypassed duplicate does not satisfy the
runtime-closure proof.

Decision 0007 is unchanged: its Pi-peer ruling does not automatically extend
to normal dependencies.

## Rejected alternatives

- Passing from successful real loading alone.
- Treating host release packaging or Pi version alignment as proof of normal
  dependency compatibility.
- Treating a staged-but-bypassed package as proof of effective runtime supply.
- Static symbol/API overlap.
- Ambient/global fallback, post-verification mutation, or silently
  reclassifying TypeBox as a peer.

## Failure and rollback

If the alias cannot be narrowed and exact qualifying supply cannot be proven,
managed desktop initialization remains fail-closed. Rollback must not re-enable
ambient resolution or accept a staged-but-unused package as AC4 proof.

## Reopening conditions

Reassess only if loader evidence shows TypeBox resolves artifact-locally; the
host alias is proven to supply exact lock-selected
`@sinclair/typebox@0.34.49`; Alfie provides an authoritative exact-tuple
compatibility assertion; or the owner explicitly changes the accepted closure
risk boundary.
