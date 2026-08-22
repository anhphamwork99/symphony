# Handshake-first managed Pi subagent harness

**Project:** synara-pi-subagent-handshake-first  
**Project home:** [PROJECT.md](PROJECT.md)  
**Status:** ready-for-agent  
**Tracker:** Local Markdown

## Problem Statement

Synara desktop can currently discover `pi-subagents` from the user's mutable Pi
installation. A global extension may look compatible enough to start a managed
child but lack the terminal lifecycle contract required to prove that a detached
child settled. The execution card then remains falsely live, or cancellation
looks complete when Synara has no authenticated proof.

The affected user cannot reliably tell whether background work is still
running, already finished, or has become unknown. Updating Pi independently
also changes Synara's managed-subagent behavior without a Synara release
having verified that behavior.

## Solution

Synara desktop will initialize a managed Pi harness before managed Agent work is
available. The harness loads only a release-controlled, verified
`pi-subagents` artifact; reads only the user authentication and model
configuration necessary to run Pi; completes a mandatory lifecycle handshake;
and captures that handshake in every admitted execution binding.

An unavailable, invalid, or incompatible artifact fails managed-harness
initialization early with an actionable diagnostic. Synara does not silently
fall back to a user-global extension or a legacy unmanaged path. Existing
durable terminal, cancellation, teardown, and restart-reconciliation truth
remains authoritative. The execution card presents the whole current state,
including background work, cancellation uncertainty, and orphaning, instead of
deriving its label from `observedState` alone.

## User Stories

1. As a Synara desktop user, I want managed subagents to use a Synara-verified extension, so that a Pi update on my machine cannot silently change their lifecycle behavior.
2. As a Synara desktop user, I want my existing Pi sign-in and model choices to continue working, so that adopting the managed harness does not require another setup flow.
3. As a Synara desktop user, I want Synara to leave my own Pi extensions untouched, so that other Pi tools continue to work as I configured them.
4. As a Synara desktop user, I want initialization to fail before work starts when the managed extension is invalid, so that I never receive a misleading running card.
5. As a Synara desktop user, I want a clear recovery message when the managed artifact is missing or incompatible, so that I know whether to update or reinstall Synara instead of guessing.
6. As a Synara desktop user, I want a normal supported Agent task to start without a new surprise failure at the moment it delegates work, so that the preparation check does not interrupt my workflow.
7. As a Synara desktop user, I want an attached child to show `Running`, so that I know Synara is actively waiting for it.
8. As a Synara desktop user, I want a detached child with a verified live owner to show `Running in background`, so that I understand the parent returned while the same child continues.
9. As a Synara desktop user, I want a requested cancellation to show `Cancelling` even if the last observed lifecycle state was `running`, so that my intent is not hidden.
10. As a Synara desktop user, I want an unverified teardown to show `Cancellation unverified`, so that I do not mistake uncertainty for a completed stop.
11. As a Synara desktop user, I want an ownerless execution without terminal evidence to show `Outcome unknown (orphaned)`, so that Synara does not invent a result.
12. As a Synara desktop user, I want an orphaned card to stop spinning, hide cancel, and offer only explicit Resume, so that the available action matches the durable truth.
13. As a Synara desktop user, I want a committed terminal outcome to show `Succeeded` or `Failed`, so that completed work is never inferred from a tool return or missing process.
14. As a Synara desktop user, I want background work to retain liveness reporting and eventually report one fenced terminal outcome, so that a detached card cannot stay live indefinitely when evidence exists.
15. As a Synara desktop user, I want cancellation and process-teardown uncertainty to remain non-terminal until the true owner reports proof, so that Synara never overclaims control of a child process.
16. As a Synara desktop user, I want an old detached execution recovered after restart to become orphaned when no owner or terminal evidence exists, so that stale state is not presented as live work.
17. As a Synara desktop user, I want a terminal event from an earlier generation to be ignored after Resume, so that stale work cannot settle a new attempt.
18. As a Synara desktop operator, I want safe diagnostics that identify artifact, runtime-configuration, or handshake categories without exposing credentials, paths, prompts, or provider configuration.
19. As a Synara release engineer, I want a deterministic artifact manifest and digest, so that the desktop and server can prove they are using the reviewed extension rather than trusting a version label.
20. As a Synara maintainer, I want real desktop/server composition tests with an old global extension present, so that release packaging proves isolation instead of relying on a test-only custom directory.

## Implementation Decisions

1. The desktop managed harness owns release-artifact selection. It resolves a
   fixed packaged artifact path, verifies a generated manifest and digest,
   rejects path escape or malformed content, and supplies only trusted
   artifact metadata to the server. Inherited environment values and
   request-level options cannot redirect desktop managed extension discovery.
2. The managed runtime separates extension discovery from user runtime
   configuration. Pi loads extensions only from the release-controlled
   directory. The model runtime receives explicit user-owned authentication and
   model paths. User credentials and model files are never copied, rewritten,
   packaged, logged, hashed into telemetry, or exposed in diagnostics.
3. The production artifact is a real Pi agent-directory extension, not a
   synthetic in-process extension factory. It is built from a clean Alfie
   commit, carries an immutable manifest, and is shipped in the desktop
   resource pipeline with matching server trust metadata.
4. The desktop managed capability profile requires `managed-spawn`,
   `abort-propagation`, `bounded-foreground-attachment`,
   `coalesced-progress`, `durable-cancellation`,
   `journal-terminal-lifecycle`, and `child-bash-process-ownership`.
   Package version is diagnostic information only; the verified artifact and
   negotiated capability profile establish trust.
5. Managed harness readiness is a session-bootstrap contract. Runtime
   configuration, extension binding, and handshake complete before the managed
   Agent wrapper is exposed. A bootstrap failure disposes partial state and
   creates no child, admission, execution, lifecycle, card, or outbox record.
   It does not become a warning or a later normal Agent-call rejection.
6. Every admitted execution receives a server-minted, session-local handshake
   binding containing the artifact identity, execution identity, attempt,
   generation, lifecycle reporter, foreground policy, and liveness policy.
   Model-controlled arguments cannot provide or replace this binding.
7. Existing ownership and durability remain unchanged: Alfie owns foreground
   attachment arbitration and reports accepted → started → detached in durable
   order; Synara owns atomic admission and journal-first terminal ingest. No
   Symphony-side timeout races the real Agent tool.
8. Only a committed, identity- and generation-fenced terminal observation may
   present `Succeeded` or `Failed`. Tool return, process absence, timeout,
   abort acknowledgement, session stop, watchdog action, transcript existence,
   cancellation dispatch, and `owner_unproven` are never terminal evidence.
9. Existing restart reconciliation remains the only no-owner settlement path.
   A no-owner/no-terminal execution becomes non-terminal `orphaned`, advances
   generation once, and preserves late terminal evidence as stale history.
   Bootstrap of a later compatible harness cannot rewrite old rows.
10. Execution-card projection gains bounded, current-generation attachment and
    teardown-evidence fields. The web derives one shared whole-card
    presentation with this precedence: committed terminal; orphaned;
    cancellation uncertainty; cancellation intent; detached running; ordinary
    running; remaining existing lifecycle states. Snapshot, replay, reconnect,
    result details, and the card strip use the same presentation.
11. Teardown continues to use only the authenticated, opaque child-owner
    endpoint. `owner_unproven` remains a non-terminal band-78 outcome; Synara
    does not fall back to a parent supervisor or direct PID control.
12. No database migration, automatic replay, global-extension repair,
    unrelated-provider change, or external Alfie source change is part of this
    implementation package.

## Testing Decisions

See the accepted project-scoped
[Testing Strategy Governance Decision Record](../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

This follow-on work applies that strategy at the desktop artifact boundary in
addition to the established managed-execution boundaries: handshake readiness
before Agent exposure, global-extension isolation, real detached terminal
lifecycle, safe bootstrap failure, journal-first terminal integrity,
orphan/stale-generation preservation, and whole-card presentation.

## Out of Scope

- Changing, deleting, updating, or inspecting user-global Pi extensions.
- Bundling user credentials or model-provider secrets into Synara resources.
- A developer-only legacy or unmanaged subagent path.
- A user-facing model or sign-in migration.
- Altering terminal ownership, completion-outbox outcome separation, teardown
  bands, process-owner authority, or restart-reconciliation semantics.
- Database migrations or historical durable-row rewrites.
- Automatically resuming or replaying orphaned work.
- Making standalone server or non-desktop Pi installations managed unless they
  later ship the same verified artifact contract.
- Modifying external Alfie source as part of this Synara package.

## Further Notes

The mandatory release input is an official, deterministic Alfie artifact built
from a clean compatible commit. Synara's release pipeline may assemble that
artifact from the verified Alfie checkout; it must not modify the checkout or
fall back to a user-global extension. The artifact must implement the required
capability profile, retain liveness after detach, report exactly one fenced
terminal before registry removal, preserve Alfie-owned attachment and
child-process ownership, and include a verifiable file manifest. The
repository's existing test provenance proves the source checkout only; it is
not by itself the production artifact-delivery mechanism.

The implementation must prove the handoff's ten verification conditions. In
particular, a real desktop/server composition test must demonstrate that a
global v0.10-style extension is neither loaded nor modified while the packaged
artifact drives a detached child to a committed terminal result. If no
compatible official artifact is supplied, production-composition acceptance is
blocked rather than substituted with a synthetic factory or a global fallback.

The ten conditions are:

1. A normal desktop Pi session completes the managed handshake before managed
   Agent work is exposed.
2. A conflicting old global extension cannot be silently selected by the
   desktop managed harness.
3. A supported session can spawn Agent work without a new per-call
   missing-handshake failure.
4. Only identity- and generation-fenced, persist-committed terminal evidence
   can present `Succeeded` or `Failed`.
5. A real detached child continues reporting liveness and eventually reports a
   terminal outcome through its binding.
6. Missing owner plus missing terminal becomes `orphaned`, never a fabricated
   terminal outcome; stale terminal evidence cannot settle a resumed
   generation.
7. The card correctly presents background execution, cancellation intent,
   cancellation uncertainty, and orphaning with their matching affordances.
8. A real desktop/server composition test reproduces an old global-extension
   conflict and proves the controlled compatible artifact is selected and a
   detached child settles terminally.
9. Missing or incompatible controlled artifact fails managed-harness
   initialization before child spawn, admission, or card creation, with an
   actionable diagnostic.
10. The project validation required by the accepted testing strategy and
    `AGENTS.md` is run using `bun run test`; `bun fmt`, `bun lint`, and
    `bun typecheck` run only when explicitly authorized.
