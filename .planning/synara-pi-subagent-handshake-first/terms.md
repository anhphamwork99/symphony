# Project terms — Synara Pi Subagent Handshake-First Handoff

These terms are authoritative for this project only. They promote to the
shared glossary only if they later become stable across independent work.

## Managed Pi harness

The Synara-controlled session setup that enables durable managed subagents. It
selects the compatible extension, completes the handshake, and only then makes
managed Agent work available.

## Release-controlled extension

The specific `pi-subagents` artifact selected and shipped by a Synara release
for its managed Pi harness. Synara validates its behavior through the
handshake. It is distinct from, and never mutates, the user's global Pi
extension installation.

## Global Pi extension

An extension discovered from the user's mutable Pi agent directory, such as
`~/.pi/agent/extensions/pi-subagents`. It may continue serving other Pi
consumers but is not a source for Synara-managed subagent execution.

## User runtime configuration

The user's Pi authentication and model configuration needed to run a provider
session. It is distinct from Pi extensions. The managed harness may use it
without packaging, mutating, or allowing user-global extensions to load.

## Managed runtime configuration

The session-local Pi configuration assembled for Synara-managed subagents. It
contains the release-controlled extension and only the user runtime
configuration required to operate Pi; it excludes user-global extensions.

## Handshake binding

The negotiated identity and capability contract between the selected extension
and one managed Pi session. Every admitted managed execution carries this
binding with its lifecycle reporter.

## Unmanaged legacy fallback

An Agent execution path that lacks the managed-harness handshake and therefore
does not create durable managed identity, lifecycle reporting, or execution
cards. It is prohibited in this project's Synara desktop scope.

## Terminal evidence

One identity- and generation-fenced `succeeded` or `failed` observation that
has been committed through the durable journal-first terminal path. It is the
only evidence that may present a managed execution as terminal.

## Orphaned execution

A durable managed execution with no live owner and no terminal evidence after
reconciliation. Its outcome remains unknown; it is not live and offers only
an explicit Resume action.
