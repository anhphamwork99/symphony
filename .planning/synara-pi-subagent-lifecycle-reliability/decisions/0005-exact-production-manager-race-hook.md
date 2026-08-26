# Decision 0005 — exact production-manager race hook

**State:** accepted

**Date:** 2026-08-26

**Scope:** Ticket 02 WP-05 evidence infrastructure only

**Supersedes:** only the native staged-module import and prototype-coincidence
requirements in WP-05

**Preserves:** Decisions 0002, 0003, and 0004; Ticket 02 production semantics;
all Ticket 03–06 dependency gates and exclusions

## Context

The first synchronized real-Pi candidate in Symphony commit `fe4a00158` passed
its wallclock command but failed independent acceptance review. The review found
that:

- the terminal-first case invoked managed steer only after durable terminal
  settlement, so it proved post-terminal rejection rather than an
  invocation-before-terminal race;
- the trace labels were appended by the test rather than emitted from the
  causal production boundaries;
- cancellation did not exercise a late post-await continuation against an
  invalidated generation;
- artifact, path-isolation, and unconditional cleanup evidence was incomplete;
  and
- the WP-05 same-module requirement was not implemented.

WP-05 required the test to native-import
`<artifact>/agent/extensions/pi-subagents/src/agent-manager.ts` before loading
the registered production extension and then prove that its
`AgentManager.prototype` was the production instance.

That requirement is technically invalid for Pi SDK `0.83.0`. Its extension
loader creates Jiti with:

```ts
createJiti(import.meta.url, {
  moduleCache: false,
  ...
})
```

The registered extension and its transitive modules therefore belong to the
Jiti graph created by the production ResourceLoader. A native import, or a
separate Jiti import, creates another module graph. Constructor or prototype
coincidence from that graph cannot prove ownership of the manager used by the
registered production `steer_subagent` tool.

The controlled Alfie extension already publishes a session-owned facade at
`globalThis[Symbol.for("pi-subagents:manager")]`, but that facade intentionally
does not expose the manager instance or a steer interception seam. The exact
causal evidence required by Decision 0003 cannot be obtained from the existing
facade without either fabricating timing after the fact or changing production
semantics in the test.

## Decision

Ticket 02 may add one narrowly gated, non-public Alfie evidence hook and re-pin
the controlled artifact. This hook replaces the impossible native-import
requirement. No other WP-05 production change is authorized.

### Gate and registry

The hook is present only when both isolated-process values are valid:

```text
SYNARA_PI_SUBAGENT_INTERNAL_TEST_HOOKS=canonical-steer-race-v1
SYNARA_PI_SUBAGENT_INTERNAL_TEST_RUN_ID=<per-run nonce>
```

It is registered at:

```ts
Symbol.for("pi-subagents:internal-test:canonical-steer-race-v1")
```

Missing, malformed, or mismatched gate values expose no hook. The hook is not a
Pi tool, extension capability, provider capability, package export, public API,
or durable contract.

### Exact-instance ownership

The hook is created in the same `src/index.ts` closure that constructs the
production `AgentManager`. It instruments only that closure-owned manager
instance and one exact current
`(executionId, attemptId, generation)` tuple. It must not scan globally,
reconstruct a record, accept a provider record identifier, or expose a raw
record, raw session, provider `agentId`, or provider record ID.

Installation fails closed when:

- the run nonce does not match;
- no exact current tuple exists;
- another hook is installed;
- the tuple becomes stale during installation;
- the exact record or session changes unexpectedly; or
- the environment gate is absent.

### Causal observations

The hook may publish only public-tuple-keyed sequence events and bounded
counters for:

- manager invocation;
- the boundary before the manager's real live lookup/status guard;
- live-guard pass or rejected-not-found/not-running;
- exact session steer invocation;
- the synchronous Pi SDK insertion boundary;
- holding and releasing only the promise returned after that insertion;
- post-await generation pass or fence;
- bookkeeping commit or skip; and
- manager sent/rejected return.

The hook must preserve `this`, arguments, return values, thrown errors, exact
session behavior, and the synchronous Pi SDK insertion. No callback may run on
the ungated path. Disposal is idempotent and restores every exact instance or
session method even after timeout or assertion failure.

### Terminal-first evidence

The registered production managed tool is invoked while the tuple is live. The
exact production manager invocation is paused before its own live guard. The
child then completes naturally; the suite observes exact tuple-index removal
and durable terminal commit. After release, the original manager guard rejects
with zero exact-session steer call and zero SDK insertion.

Invoking only after terminal settlement is not terminal-first evidence.

### Enqueue-first evidence

The original exact manager call reaches the exact child session. The hook calls
the original `session.steer` first; Pi SDK `0.83.0` performs its queue insertion
synchronously. The test may hold only the returned promise. Natural completion,
index retirement, and durable terminal commit then occur before the promise is
released and before manager bookkeeping/return.

An applied result is valid only with exactly one observed prior insertion.

### Cancellation evidence

The controlled-Alfie evidence must use the real manager and real generation /
operation ownership guards:

- cancellation before insertion yields zero exact-session steer/insertion; and
- cancellation after insertion invalidates ownership while the returned
  session promise is held, then late continuation is released and proves
  post-await bookkeeping is fenced.

Scripted Symphony `RaceState` cases may remain diagnostic unit simulations but
cannot own Decision 0003 cancellation acceptance.

## Authorized write-set amendment

Before implementation, WP-05 is amended to authorize:

### Alfie

- `agent/extensions/pi-subagents/src/agent-manager.ts`
- `agent/extensions/pi-subagents/src/index.ts`
- `agent/extensions/pi-subagents/test/canonical-steer-race-hook.test.ts`
- `agent/extensions/pi-subagents/test/synara-bridge.test.ts`
- `agent/extensions/pi-subagents/package.json`
- the package lock only when its package version is represented there

The clean baseline is
`73bc7744f8fbbd12206302de2df8230b29a49178`. The resulting package version is
`0.15.0-alfie.6`; the prior commit is not amended.

The negotiated bridge `EXTENSION_VERSION` in `src/index.ts` and its active
`synara-bridge.test.ts` assertion must move with the package version. A package
that reports `.6` on disk but negotiates `.5` at the production bridge is not a
valid controlled artifact and must fail re-pin verification.

### Symphony

- this decision and the revised WP-05;
- the controlled provenance manifest and active positive pin/hash fixtures
  required by the exact `.6` re-pin;
- `piSubagentCanonicalIdentityAcceptance.test.ts`;
- `piSubagentRealPiAcceptanceHelpers.ts`;
- the existing wallclock manifest entry; and
- the Ticket 02 Implementation Report after evidence passes.

Intentional stale, mixed-version, wrong-hash, stripped-capability, and legacy
negative fixtures remain unchanged and must be classified in the report.

## Isolation and cleanup requirements

The corrected real-Pi cases must:

- use distinct isolated roots for terminal-first and enqueue-first;
- validate configured runtime, artifact, writable-agent, home, state,
  workspace, parent-agent, and child-agent paths with `realpath`/`lstat`, not
  lexical prefixes alone;
- snapshot the complete controlled artifact tree before load and after the
  race, including paths, types, symlink targets, sizes, and regular-file hashes;
- reject artifact-local `auth.json`, `models.json`, `models-store.json`, and
  `settings.json`;
- retain Decision 0004's exact ambient exclusions and strict compensating
  snapshots;
- snapshot the actual isolated writable user-agent path separately from the
  real-home canary; and
- restore hook/session/listener/environment state, dispose the harness, and
  remove the isolated root through cleanup steps that all run even when an
  earlier assertion or cleanup step fails.

Cleanup assertions and aggregated cleanup errors run only after every cleanup
attempt has executed.

## Rejected alternatives

1. **Native-import the staged manager and compare constructors/prototypes:**
   rejected because Jiti `moduleCache:false` creates a different graph.
2. **Use the existing global facade plus manually labeled observations:**
   rejected because it cannot intercept the real manager live guard or
   post-await bookkeeping.
3. **Wrap only `record.session.steer` and delay the original call:** rejected
   for terminal-first because production manager calls it synchronously after
   the live guard; adding a pre-insertion await fabricates an interleaving that
   production does not have.
4. **Invoke steer after terminal and call it terminal-first:** rejected because
   invocation did not participate in the race.
5. **Expose the raw manager, record, session, or provider ID globally:**
   rejected as an unnecessarily broad and leaky test seam.
6. **Treat a green wallclock command as acceptance despite missing causality:**
   rejected. Evidence labels do not replace causal observation.

## Verification and acceptance

Deterministic simulation, controlled-Alfie hook/cancellation tests, and
synchronized real-Pi evidence remain separate rows. Ticket 02 remains pending
until:

- Alfie `.6` focused and regression tests pass;
- Symphony provenance and positive fixtures agree on the exact new commit,
  version, and hashes;
- both real-Pi race strands pass with causal traces and counters;
- isolation, artifact stability, and cleanup evidence pass;
- the corrected Implementation Report records exact commands and limitations;
  and
- independent review accepts the result.

No Ticket 03–06 frontier changes, push, release, or deployment are authorized
by this decision.

## Rollback

Rollback removes the `.6` re-pin and evidence hook without mutating durable
execution data. It must not map public identity back to provider `agentId`,
replay, Resume, reconstruct, reindex, or create a child. Ticket 02 remains
pending and managed admission fails closed whenever the controlled artifact no
longer satisfies the exact accepted provenance/evidence contract.
