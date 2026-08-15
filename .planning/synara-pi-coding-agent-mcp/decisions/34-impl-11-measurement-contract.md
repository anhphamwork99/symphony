# Decision 34: impl-11 measurement contract

Status: Binding
Date: 2026-08-15
Identifier: synara-pi-mcp-decision-34
Title: Measurement conclusions, prompt stimulus, catalog visibility, and real-run bounds

## Question

What technical contract governs impl-11 conclusions, prompt stimulus, catalog
visibility, repetitions, real-run isolation, and the resulting recommendation
about possible future compaction or artifact-backed output?

## Governing references

- Authoritative: `PROJECT.md` — project constitution and routing.
- Authoritative: `spec.md` — paired real-accounting measurement requirement,
  no-hidden-overhead rule, and out-of-scope boundaries.
- Authoritative: `issues/impl-11-token-overhead-measurement.md` — AC1/AC2 and
  owner-approved measurement seams.
- Authoritative: `decisions/20-testing-strategy-governance.md` — paired-runtime
  measurement strategy and test constraints.
- Supporting: planner evidence concerning Pi SessionStats, tool/schema APIs,
  Synara turn.completed statistics, session JSONL activeToolNames, and the
  isolated real-server lifecycle.

## Context

impl-11 must measure Pi standalone, Synara default, and activated Synara MCP
using equivalent real runs. It must expose policy, tool-schema,
startup/context, cache, and processed-token contributions without changing
accounting or concealing catalog cost.

The owner approved no numeric overhead budget or statistical acceptance
threshold. Compaction, artifact-backed output, and accounting changes remain
outside impl-11. Measurement artifacts must not commit secrets or raw sensitive
filesystem paths.

## Decision

### 1. Conclusions and thresholds

impl-11 must not invent a numeric overhead budget, acceptable-percentage
threshold, variance cutoff, or product go/no-go threshold.

The report must publish the observed component values, paired differences,
distribution across repetitions, reconciliation status, and relevant
configuration/environment metadata. Any conclusion must distinguish:

1. measured facts;
2. methodological limitations or uncertainty; and
3. a non-binding technical recommendation with rationale.

The recommendation may say that the evidence supports or does not support
separate investigation of compaction or artifact-backed output. It does not
authorize that work or establish a product budget.

A run set is `insufficient evidence` when any required accounting component is
missing, component reconciliation fails, required equivalent repetitions
cannot be completed, configuration equivalence cannot be established, or the
paired results do not repeat sufficiently to support the claimed direction.

Because no numeric variance threshold is authorized, variance alone is not
silently converted into pass/fail. The report must show every repetition and
must not rely only on an average. A directional recommendation requires the
claimed ordering or direction to hold across all valid paired repetitions. If
the direction changes between valid pairs, the report records the result as
inconclusive/insufficient for that recommendation. This consistency rule does
not create an overhead budget.

### 2. Prompt stimulus

All three modes must receive the same prompt bytes in the same turn positions.
The prompt must request a deterministic, bounded text response and explicitly
instruct the model not to call tools. The exact prompt text and its byte hash
must be committed with the report.

Tool availability must not be disabled or filtered merely to force no-tool
behavior, because the real catalog exposure is part of the measurement. If a
run invokes a tool, produces tool-call output, or otherwise departs from the
defined stimulus, that repetition is invalid and must be rerun or reported as
failed. Tool-call output must not be folded into startup/catalog overhead.

The two turns serve distinct observations within the same fresh session: the
first includes cold/startup effects, and the second observes the subsequent
turn under the same session/catalog. Both turns use the same fixed stimulus
unless the harness records and applies a predeclared deterministic two-prompt
sequence identically in every mode. The simpler identical-prompt form is the
default.

### 3. Catalog capture and committed visibility

For every run and mode, the harness must extract the full effective tool
manifest through the real tool/schema API and canonicalize it using one
documented deterministic method. The canonical bytes are the bytes used for
schema-size accounting and hashing.

Full manifests may be retained locally for diagnosis and audit, but they must
be stored only in an ignored, access-restricted measurement location. They must
never be committed when they contain full schemas, credentials, secrets, raw
sensitive paths, or provider/configuration data outside the approved report
surface. Local manifest retention is not required after acceptance if project
data-handling practice calls for cleanup; the committed hash remains the
identity proof.

The committed report must include, for each mode and repetition:

- the complete effective tool-name list;
- tool count;
- canonical schema byte count;
- canonical manifest hash and hash algorithm;
- canonicalization and extraction method, including ordering and encoding;
- the observed activated-tool exposure evidence needed to distinguish default
  from activated mode; and
- whether the local full-manifest capture was produced successfully.

Raw full schemas are not required in the committed report. Omitting them for
sensitive-data safety is not “hiding catalog content” when the report includes
the complete names, real canonical byte count, stable hash, and exact extraction
method. Measurements must use the complete manifest; truncating, filtering,
redacting before byte accounting, or substituting a partial catalog is a
measurement failure.

If even a tool name is sensitive, that conflicts with the explicit complete-name
reporting contract and must be escalated before publication rather than silently
redacted. Secrets and raw sensitive paths must never be published.

### 4. Repetitions, turns, and configuration

The default real-run matrix is:

- 3 modes: Pi standalone, Synara default, activated Synara MCP;
- 3 paired repetitions per mode;
- 2 measured turns per repetition;
- 18 measured turns total.

Each repetition uses a fresh session. Each paired repetition must hold constant,
to the extent supported by the real systems:

- model/provider identifier and resolved model metadata;
- thinking/reasoning configuration;
- prompt bytes and turn order;
- project/worktree input;
- coding-agent configuration and configured native/project tools;
- measurement harness version;
- relevant environment/configuration metadata;
- activation state appropriate to the mode; and
- accounting extraction and reconciliation method.

Three repetitions are the minimum default, not a claim of statistical power.
The harness must permit a higher repetition count without changing accounting
or report semantics. Invalid runs do not count toward the minimum.

The report must present individual repetitions, paired deltas, summary
statistics, and spread/variance. It must preserve cache-read and cache-write
components separately where supplied rather than collapsing them into a more
favorable total.

### 5. Real-run worktree and lifecycle bounds

Measurements will use the current main worktree and branch, as requested. The
report must identify the exact commit and branch and record whether the
worktree was dirty. If dirty, it must include a safe reproducibility identifier
for the measured source state, such as a hash of the relevant diff, without
committing raw sensitive paths or unrelated sensitive content.

Pi standalone must run through the real Pi session boundary. Synara default and
activated modes must run through the full isolated Synara server/session
lifecycle needed to produce authentic runtime accounting and activation
exposure. The measurement must not reuse the user's running Synara instance,
ports, home directory, credentials, or mutable session state.

Every repetition starts with a fresh session. Activated-mode measurement is
valid only after activation reaches its real successful terminal state and the
effective exposure is observed. Default-mode measurement is valid only when
Synara MCP remains dormant and absent from the effective catalog. Activation,
reconciliation, lifecycle, accounting, or isolation failures invalidate the
affected pair and must be reported; they may not be replaced by inferred or
mocked values.

## Reconciliation and acceptance implications

For each measured turn, preserve the raw reported SessionStats components:

- input;
- output;
- cache read;
- cache write; and
- total.

The report must document the exact reconciliation equation supported by the
runtime's accounting semantics. It must not assume that fields are arithmetically
additive if provider semantics say otherwise. A successful reconciliation is
one demonstrated according to that documented runtime contract.

Missing fields, unexplained inconsistent totals, extraction ambiguity, or loss
of the original statistics between Pi and Synara is a measurement failure.
Instrumentation may observe and serialize accounting but may not modify it.

impl-11 is accepted only when:

1. all three modes complete the minimum valid matrix;
2. prompt and configuration equivalence are evidenced;
3. default and activated catalog state are evidenced;
4. complete catalog size is measured without filtering or accounting changes;
5. per-turn accounting reconciles according to the documented runtime
   semantics;
6. individual repetitions and variance are reported;
7. failures and invalidated runs remain visible;
8. committed artifacts contain no secrets or raw sensitive paths; and
9. the report records a measured-fact conclusion and a clearly non-binding
   recommendation concerning future compaction/artifact-backed output.

If reconciliation or repeatability is insufficient, impl-11 may still preserve
the collected diagnostic evidence, but it does not satisfy AC1/AC2 and must not
claim a comparative overhead conclusion.

## Rejected alternatives

- Inventing a numeric overhead or variance threshold without owner authority.
- Reporting only averages or a single run.
- Using different prompts between modes.
- Deliberately eliciting tool calls as part of startup/catalog measurement.
- Disabling the actual tool surface to prevent tool calls.
- Committing raw full tool schemas.
- Measuring a partial, filtered, or redacted schema while calling it complete.
- Hiding catalog size by changing accounting or report definitions.
- Treating a recommendation as approval to implement compaction or
  artifact-backed output.
- Using mocked statistics or a shortened Synara lifecycle in place of real
  paired runs.
- Reusing the user's live Synara runtime or mutable session state.

## Consequences

The harness and report remain descriptive rather than budget-enforcing.
Comparisons are reproducible and auditable without publishing potentially
sensitive full schemas. The minimum matrix is operationally bounded while
allowing more repetitions when warranted.

A failed reconciliation, invalid stimulus, incomplete catalog, lifecycle
failure, or non-repeatable direction results in explicit insufficient evidence,
not a favorable estimate. Future optimization work remains separately scoped
and owner-approved.

## Assumptions

- The runtime exposes the stated SessionStats components without measurement
  instrumentation changing them.
- The real tool/schema API can enumerate the effective complete catalog.
- Synara preserves the original statistics in turn.completed.
- Session JSONL activeToolNames or an equivalent real-runtime observation can
  evidence activated exposure.
- Isolated real server runs are feasible in the current worktree.

## Residual uncertainty

Provider-side token accounting semantics may not make every field directly
additive. Implementation must establish and document the actual reconciliation
equation before claiming AC2.

Model service nondeterminism and cache behavior may create variance even with
identical prompts. The decision therefore requires raw repetitions and
consistent direction for a recommendation but does not invent an effect-size
budget.

The exact safe mechanism for identifying a dirty worktree is implementation
detail, provided it is reproducible and does not publish sensitive data.

## Failure and rollback implications

The measurement harness must fail closed for comparative conclusions: invalid
or unreconciled pairs remain recorded but are excluded from conclusions and do
not count toward the minimum matrix. Reruns use fresh sessions.

The harness must not mutate accounting, production state, or the user's active
Synara instance. Any isolated runtime it starts must be stopped and its
temporary credentials/session state cleaned up after the run.

## Downstream effect

Implementation of impl-11 may proceed after this record is persisted under the
project's `decisions/` directory, confirmed present and tracked, and cited as an
aspect-scoped Authoritative reference by the implementation work.

This decision does not authorize a numeric budget, accounting changes,
compaction, artifact-backed output, or any change to the owner-approved testing
seams.

## Reopening conditions

Reassess this decision if:

- authoritative runtime documentation or real evidence disproves the assumed
  SessionStats reconciliation semantics;
- the real tool/schema API cannot provide a complete deterministic manifest;
- full tool names cannot be committed without exposing sensitive information;
- the isolated real lifecycle cannot preserve configuration equivalence;
- material evidence shows that the three-repetition/two-turn default cannot
  produce meaningful paired observations; or
- the owner approves a numeric budget, changed accounting contract, compaction,
  artifact-backed output, or different measurement seam.

No prior Binding Decision is superseded. This record supersedes only the
unpersisted locator metadata `Decision 21` / `synara-pi-mcp-decision-21`;
existing Decision 21 remains unchanged.
