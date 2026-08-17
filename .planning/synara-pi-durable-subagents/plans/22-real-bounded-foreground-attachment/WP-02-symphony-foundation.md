# WP-02 — Symphony contract, configuration, and binding foundation

**State:** pending

**Owner role:** worker

**Repository:** `/Users/anhpham99/symphony`

**Dependencies:** none; parallel-safe with WP-01

## Task

Add the capability vocabulary, exact foreground-wait configuration resolver,
and immutable per-invocation host-binding contract without enabling the new
production semantics or changing the current Alfie provenance pin.

## Context and authority

[Decision 0006](../../decisions/0006-t22-bounded-foreground-attachment-technical-direction.md)
fixes the capability name and config contract. The currently pinned Alfie
extension does not yet advertise the capability, so this foundation package
must remain additive and behavior-neutral until WP-03.

Supporting source:

- `packages/contracts/src/piSubagents.ts` and test
- `apps/server/src/config.ts` and test
- `apps/server/src/provider/piSubagentBridge.ts` and test

## Allowed write set

- `packages/contracts/src/piSubagents.ts`
- `packages/contracts/src/piSubagents.test.ts`
- `apps/server/src/config.ts`
- `apps/server/src/config.test.ts`
- `apps/server/src/provider/piSubagentBridge.ts`
- `apps/server/src/provider/piSubagentBridge.test.ts`

Do not edit PiAdapter, production composition, required handshake capabilities,
provenance, persistence, migrations, or Alfie.

## Implementation contract

### Capability

Add `bounded-foreground-attachment` as a first-class
`PiSubagentCapability`. Do not bump protocol version and do not yet add it to
`createDefaultHandshakeRequest().requiredCapabilities`; WP-03 performs the
atomic production flip after the Alfie commit exists.

### Configuration

Add a pure resolver and server config field for:

- env key `SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS`;
- default `10000`;
- accepted inclusive integer range `100..60000`;
- unset, empty, non-numeric, non-finite, fractional, under-range, and
  over-range input falls back to `10000`;
- invalid input is never clamped and raw invalid content is never logged.

Resolve once in server configuration. Tests must cover both endpoints, normal
interior values, and every invalid class without waiting in real time.

### Per-invocation binding

Define/export the private symbol key:

`Symbol.for("synara.pi.subagents.managed_foreground.v1")`.

Define the immutable structural binding described in WP-01: server-minted
identities, `parent_turn`, validated budget, and
`reportObservation({kind, occurredAt})`.

The binding is carried on a copied `effectiveCtx` for one accepted Agent
invocation. Do not use a process-global mutable registry or one mutable binding
per session; concurrent calls must never overwrite one another.

This package defines and unit-tests the type/guard/helper only. It does not
attach a binding to a production call.

## Test-first sequence

1. Capability literal encodes/decodes and remains additive to protocol v1.
2. Table-driven config matrix for valid endpoints/interior and every invalid
   class.
3. Binding guard accepts one complete immutable value and rejects missing,
   partial, malformed, wrong-scope, and invalid-budget values.
4. Two copied contexts hold distinct bindings with no cross-observation.
5. Existing default handshake remains unchanged at this package boundary.

## Verification

```bash
cd /Users/anhpham99/symphony/packages/contracts
bun run test src/piSubagents.test.ts

cd /Users/anhpham99/symphony/apps/server
bun run test src/config.test.ts src/provider/piSubagentBridge.test.ts
bun run test
```

Record the parser matrix, context-isolation proof, commands, exit codes, and
test counts.

## Completion and commit rule

- Focused and full server tests pass; the existing real-extension test remains
  compatible with the old pin.
- No file outside the allowed set changed.
- Create one local Symphony commit:
  `feat(pi): add bounded foreground attachment foundation (issue 22)`.
- Do not push.

## Challenge conditions

Stop if the context cannot safely carry a per-invocation private binding, if
adding the capability changes current negotiation before WP-03, or if a new
diagnostic/protocol version appears necessary.
