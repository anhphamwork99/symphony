# Decision 0007 — T01b host-peer compatibility reassessment

- **Date:** 2026-08-22
- **Status:** Accepted — binding technical-direction reassessment. This is
  not final acceptance of Ticket 01b.
- **Consultation class:** Supervisor material technical-decision verification.
- **Scope:** Compatibility of Ticket 01b's pinned Alfie extension with the
  release-packaged Pi host when that host supplies the extension's peer
  dependencies. It does not reopen the artifact closure, manifest exactness,
  fail-close ordering, global-fallback prohibition, user-configuration
  boundary, or Tickets 02–04 ownership.

## Question

Can the pinned Alfie `@alfie/pi-subagents@0.15.0-alfie.4` artifact, which
requires Pi peers `>=0.83.0`, meet Ticket 01b AC4 against Synara's packaged
Pi `0.81.1` host merely because the host loader aliases peer imports and a
static export-surface audit finds selected names?

## Governing references

- Project Home: [PROJECT.md](../PROJECT.md)
- [Ticket 01b](../issues/01b-remediate-verified-managed-pi-runtime-closure.md),
  especially AC4.
- [Decision 0006](0006-t01-runtime-closure-reassessment.md), especially its
  binding closure and real-extension-load requirements.
- [spec.md](../spec.md), Implementation Decisions 1–5.
- Decisions 0001–0003, whose release-controlled no-fallback and
  user-configuration boundaries remain unchanged.

## Evidence

1. `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`
   pins Alfie commit `aa6fa4a8540644d2509b10d6df854486ddc67d1d` and
   `@alfie/pi-subagents@0.15.0-alfie.4`.
2. At that pin,
   `agent/extensions/pi-subagents/package.json` declares peer dependencies
   `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and
   `@earendil-works/pi-tui` at `>=0.83.0`. Its lock resolves the matching
   peer family at `0.83.0`.
3. `apps/server/package.json` and `bun.lock` package the Synara host Pi family
   at `0.81.1`, including `pi-ai`, `pi-coding-agent`, and transitive `pi-tui`.
4. The real extension imports peer runtime values, including coding-agent APIs
   from `src/index.ts`, `src/agent-types.ts`, and
   `src/child-bash-supervisor.ts`, and Pi TUI values from `src/index.ts`.
5. `apps/server/src/provider/Layers/PiAdapter.ts` imports the packaged host
   SDK, sets `noExtensions: true`, and supplies the verified controlled
   extension path. The actual host loader aliases peer imports to host exports.
   This proves where imports resolve, but not the behavioral/API compatibility
   of the older host with the artifact's declared peer contract.

## Finding

Ticket 01b cannot credibly complete AC4 with the current `0.81.1` host from
loader aliasing plus static export-name overlap alone. The artifact's declared
support contract excludes `0.81.1`; name overlap does not establish compatible
call signatures, runtime semantics, singleton identity, loader behavior, or
future imports across the real entry graph. A historical empirical handshake
is useful evidence but cannot silently override the current artifact's peer
range under Decision 0006's compatible release-controlled runtime requirement.

## Binding decision

A host-supplied peer is eligible for Ticket 01b AC4 only when **one** of the
following is true:

1. The exact release-packaged Pi host version satisfies the pinned artifact's
   declared peer range; or
2. An Alfie-source-authoritative, version-pair-specific assertion explicitly
   supports the exact artifact pin against the otherwise-out-of-range host
   tuple. The ordinary form is an official Alfie release/pin whose peer
   declaration admits that host range.

Static symbol overlap, loader aliasing, or an unqualified prior test result
are never sufficient compatibility assertions.

### Required remediation direction

The default route is to upgrade and lock Synara's production Pi host family
so the resolved `pi-ai`, `pi-coding-agent`, `pi-tui`, and coherent
`pi-agent-core` graph satisfy the real artifact's `>=0.83.0` floor. This is a
host-alignment prerequisite, not permission to weaken Ticket 01b's closed
artifact boundary.

The only alternative is an official Alfie compatibility assertion for the
current exact `0.81.1` host tuple. Until one route is delivered, AC4 remains
incomplete, Ticket 01b stays active, and Ticket 02 remains blocked.

For either route, AC4 must still demonstrate a real staged, manifest-verified
artifact load with all non-host dependencies resolving from the verified
release closure and with global/user/ambient resolution, symlinks, and
post-verification mutation excluded.

## Rejected alternatives

- Passing AC4 from static export names plus host-loader aliasing.
- Treating a prior empirical handshake/load as a replacement for the current
  declared support contract.
- Packaging duplicate peers while the real loader aliases those imports to
  the host.
- Falling back to ambient, user-global, or mutable dependency trees.
- Mutating the artifact after verification.

## Failure and rollback

Until host compatibility is established, managed desktop initialization remains
fail-closed and must not select a global extension. If host alignment causes
another incompatibility, rollback restores the prior release/fail-closed state;
it must not retain a partially upgraded or unsupported mixed Pi graph.

## Reopening conditions

Reassess only if an official Alfie artifact/pin explicitly supports the exact
`0.81.1` host tuple, evidence disproves the host-alias model, a coherent
`>=0.83.0` host fails the real staged AC4 boundary, or the owner changes the
accepted compatibility-risk boundary.
