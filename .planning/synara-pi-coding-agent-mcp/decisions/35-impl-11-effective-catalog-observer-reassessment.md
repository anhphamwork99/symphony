# Decision 35: impl-11 effective catalog observer reassessment

Status: Binding Reassessment
Date: 2026-08-15
Identifier: synara-pi-mcp-decision-35
Amends: synara-pi-mcp-decision-34

## Question

May impl-11 add a measurement-only observer inside the Pi adapter/runtime
boundary to capture the complete effective catalog, or does this require owner
escalation?

## Governing references

- Authoritative: `PROJECT.md`.
- Authoritative: `spec.md`.
- Authoritative: `issues/impl-11-token-overhead-measurement.md`.
- Authoritative: `decisions/20-testing-strategy-governance.md`.
- Authoritative: `decisions/34-impl-11-measurement-contract.md`.
- Supporting: worker commit `1b860fc4`, its challenge evidence, and the cited
  current source/runtime loci.

## Evidence

The stable public Synara boundaries do not expose the complete effective tool
manifest of a live Pi session:

- Public WS/RPC and provider events have no live-session tool enumeration.
- AgentGateway credentials are opaque, in-memory, session-bound, and cannot be
  reconstructed out of process.
- Gateway composition is conditional and cannot prove the catalog attached to
  the measured Pi session.
- Pi SDK 0.81.1 session JSONL does not expose `activeToolNames`.
- `PiAdapter` retains the live `PiAgentRuntime` only in private session state.

The fail-closed harness in `1b860fc4` therefore records activated catalog
evidence as insufficient rather than substituting inferred or partial schemas.
Decision 20 permits the smallest lower seam when the stable public boundary
cannot observe an invariant and the real lifecycle remains under test.

## Reassessment

impl-11 may add the smallest measurement-only internal observer needed to
capture the effective manifest from the live measured Pi session. This is
within impl-11's instrumentation scope and does not require owner escalation.

Decision 34's complete-manifest requirement remains unchanged. This record
amends only its disproven assumption that the complete Synara effective
manifest is externally observable. Activated-mode AC1 cannot pass unless this
observer captures and validates the complete live manifest.

## Authoritative capture point

The only authoritative source is the `AgentSession` belonging to the current
live `PiAgentRuntime` held by `PiAdapter` for the measured thread.

1. Read the real effective catalog through
   `context.runtime.session.getAllTools()`, or an SDK-renamed API only when it
   has demonstrably identical effective-session semantics.
2. In Synara default mode, capture after the session reaches its normal ready
   state and before the first measured turn.
3. In activated mode, capture only after real activation succeeds, the required
   Pi runtime reload completes, the activated generation is still current, and
   the normal lifecycle reaches its successful terminal state.
4. Capture before the first measured turn in the resulting catalog state.
5. Continue to prove activated terminal state through the existing real public
   lifecycle boundary.

Resource-loader extensions, staged MCP registries, gateway discovery responses,
configuration files, session JSONL, expected tool lists, and reconstructed
gateway composition are diagnostic sources only. They cannot satisfy catalog
completeness.

## Observer enablement and confinement

- Require both an explicit measurement-only enable flag and an explicit
  artifact destination.
- Absent, false, or invalid enablement, or a missing destination, makes the
  observer absent and a no-op.
- The harness sets both only in the isolated child server for the applicable
  repetition.
- The destination must resolve within that repetition's harness-created
  isolated temporary home. Reject escapes through traversal, outside absolute
  paths, or symlink traversal.
- Do not add an RPC, WS method, event, HTTP endpoint, command, extension tool,
  or generally available provider API.
- Normal Synara runs must not call `getAllTools()` for measurement, create
  measurement files, retain schemas, or incur measurement serialization work.
- Measurement configuration must not be inherited into unrelated children or
  the user's running Synara instance.

## Artifact security and integrity

- The transient artifact may contain complete schemas, but never credentials,
  bearer/bootstrap tokens, environment dumps, raw gateway responses, or
  unrelated provider/session state.
- Bind the local capture to its mode, measured thread/session, lifecycle
  generation, and capture phase. Sensitive binding metadata remains local.
- Take entries directly and completely from `getAllTools()`. Do not filter,
  truncate, redact, prefix-select, or merge expected tools before canonical
  size/hash accounting.
- Use the same deterministic canonicalization as standalone: complete name,
  description, parameter schema, and applicable prompt guidelines, with
  documented deterministic ordering and encoding.
- Publication remains governed by Decision 34: commit complete names, count,
  canonical schema byte count, hash and algorithm, and extraction method, but
  not raw schemas.
- Write through a temporary file in the same restricted directory, close it,
  set restrictive permissions, and atomically rename it. Make the directory
  owner-only and the artifact owner-readable/writable where supported.
- Reject symlink destinations and non-regular existing targets.
- Validate expected mode, thread/session identity, lifecycle generation,
  capture phase, and freshness before consuming an artifact. Never accept a
  stale artifact.
- Remove the isolated home and full-manifest artifact during success and
  failure cleanup.

## Non-interference constraints

- The observer is read-only. It must not register, remove, replace, reorder,
  enable, or disable tools.
- It must not initiate discovery, mint or inspect credentials, reload the
  session, alter activation state, retry activation, or call gateway
  operations.
- It must not mutate prompts, policy, context, SessionStats, accounting fields,
  cache behavior, event payloads, journal entries, or lifecycle
  acknowledgements.
- It must not send tool names or schemas through WS/RPC/events or the canonical
  event journal.
- Observer success or failure must not change any activation or lifecycle
  result.
- The harness independently treats missing, stale, malformed, incomplete, or
  unwritable artifacts as measurement failures.
- If generation changes before capture, decline the capture. Capture only the
  subsequently current generation at its valid lifecycle point.
- Diagnostics must use bounded error codes/messages and must not include
  schemas, descriptions, credentials, tokens, full paths, raw provider
  responses, or environment contents.

## Failure and rollback implications

- Capture or validation failure invalidates the repetition and paired
  comparison under Decision 34 and remains visible as `insufficient evidence`.
- No partial manifest may be promoted to a valid result.
- Observer failure requires no product rollback because it cannot participate
  in activation or accounting. The harness stops the isolated server and
  removes its isolated home.
- Any observed effect on tool availability, activation ordering, accounting,
  lifecycle results, or normal-run behavior makes the seam non-conforming and
  blocks acceptance.

## Required tests and acceptance implications

- Default success: capture exactly the live session's complete manifest after
  readiness and before its first measured turn.
- Activated success: capture only after successful activation and completed
  reload, and exactly match post-reload `getAllTools()`, including Synara
  tools.
- Completeness: names, schemas, bytes, and hash equal direct canonicalization of
  the live API result.
- Dormancy: absent/disabled configuration performs no capture call, write,
  serialization, or catalog publication.
- Confinement: outside-home paths, traversal, symlinks, non-regular targets,
  stale generation, wrong thread/mode, and malformed artifacts fail closed.
- Failure diagnostics: enumeration, canonicalization, directory, temporary
  write, permission, rename, and cleanup failures remain sanitized and cannot
  alter lifecycle outcomes.
- Non-interference: enablement does not change effective tools, Pi ordering,
  activation result, runtime events, journal contents, SessionStats,
  reconciliation, or prompt bytes.
- Lifecycle: the real Synara activation path proves terminal state; the
  observer proves only the otherwise-unobservable effective catalog.
- Cleanup: local schemas leave with the isolated home on success and failure.

AC1 remains unsatisfied until all three modes complete Decision 34's valid
matrix with complete effective manifests. AC2 remains unchanged.

## Rejected alternatives

- Escalating narrowly scoped internal measurement instrumentation to the owner.
- Adding a public or authenticated catalog RPC.
- Reconstructing from gateway discovery, configuration, staged extension
  state, expected names, or persisted session data.
- Persisting or publishing credentials for external reconstruction.
- Reporting only coding tools or only activated `synara_*` tools.
- Weakening Decision 34 to accept catalog-incomplete activated runs.
- Treating activation or tool-call success as complete enumeration.
- Journaling or sending schemas over WS.

## Assumptions and residual uncertainty

- Pi SDK 0.81.1 `AgentSession.getAllTools()` returns the effective tools visible
  to the model for the current loaded state.
- Existing reload tests represent production behavior.
- Each repetition has a fresh isolated server/home and one intended measured
  session.
- The harness can validate the artifact before the first measured prompt.

The exact post-terminal callback location is implementation detail. Platform
permission and atomicity differences must fail or be explicitly reported, not
silently weakened. Reassess if SDK evidence later shows `getAllTools()` is not
the exact model-visible surface.

## Downstream effect

The impl-11 write set may expand only for this observer, shared
canonicalization, isolated-server configuration, harness consumption/cleanup,
and focused tests. No public contract or product API is authorized.

Decision 34 remains authoritative for complete manifests, reporting,
repetitions, accounting reconciliation, and the acceptance matrix.

## Reopening conditions

Reassess if:

- `getAllTools()` is not the complete model-visible catalog;
- capture cannot follow successful reload/generation reconciliation without
  altering lifecycle behavior;
- local capture cannot be confined to the isolated home;
- enumeration materially changes accounting/runtime behavior;
- complete names cannot safely be committed;
- implementation requires a public API, credential exposure, persistent
  production storage, or product-runtime behavior change; or
- the owner changes measurement, accounting, or publication boundaries.

No prior record is superseded. Decision 34 remains binding except for the
external-observability assumption amended here.
