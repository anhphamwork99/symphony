# Decision 0004 — volatile Pi model-catalogue cache isolation witness

## Status

**Binding Supervisor reassessment; accepted as a narrow T17-AC8 evidence
amendment.** This record changes no source behavior, does not accept Ticket 02,
does not complete WP-05, and does not advance or alter the project frontier.

- **Date:** 2026-08-26
- **Project:** [Synara Pi subagent lifecycle reliability](../PROJECT.md)
- **Ticket:** 02 — canonical identity and durable result-read continuity
- **Work package:** [WP-05 — isolated real-Pi acceptance and Ticket 02 report](../plans/02-canonical-identity-and-result-continuity/WP-05-real-pi-acceptance-and-report.md)
- **Consultation class:** Project Supervisor volatile-cache isolation
  reassessment

## Question

How must the isolated real-Pi witness handle the provider-created
`~/.pi/agent/models-store.json` change observed during the T17-AC8 review,
without treating an ambient volatile catalogue cache as authoritative user
configuration or hiding unrelated isolation failures?

The reassessment is deliberately narrow. It governs only the T17-AC8
fingerprint and compensating evidence needed by WP-05; it does not reopen or
rewrite Ticket 02's identity/read contract, the inherited destructive boundary,
or any production runtime semantics.

## Governing authority

- [Project Home](../PROJECT.md) — sole status and frontier router.
- [Decision 0001 — project charter and inherited authority](0001-project-charter-and-inherited-authority.md).
- [Decision 0002 — canonical execution identity and result-read continuity](0002-canonical-execution-identity-and-result-read-contract.md).
- [Decision 0003 — terminal steer race linearization contract](0003-terminal-steer-race-linearization-contract.md).
- Inherited durable-subagents [Project Home](../../synara-pi-durable-subagents/PROJECT.md)
  and accepted [Decision 0034 — integrated real-Pi acceptance and managed-child
  ownership reassessment closure](../../synara-pi-durable-subagents/decisions/0034-t17-integrated-real-pi-acceptance-and-managed-child-ownership-reassessment.md).
- WP-05's existing controlled-artifact, exact-provenance, isolated-runtime,
  evidence-class, and no-status/frontier-change requirements.

The inherited Decision 0034 T17-AC8 isolation boundary remains authoritative.
This record **amends Decision 0034 only as to T17-AC8's volatile
model-catalogue-cache witness**: it aspect-scopes how that exact cache is
fingerprinted and what compensating evidence is required. It does not amend
Decision 0034's other T17 criteria, destructive-boundary evidence, ownership,
provenance, or lifecycle requirements.

## Binding interpretation

1. `~/.pi/agent/models-store.json` is a volatile ambient/provider catalogue
   cache. It is **not** authoritative user authentication, user models,
   settings, extensions, skills, or controlled-artifact input.
2. A provider/runtime-created change to that exact cache path may be observed
   without being treated as an isolation failure by itself. The witness must
   report the change as bounded metadata and must not attribute it causally to
   the harness, model server, or any particular operation.
3. T17-AC8's exact broad fingerprint may exclude only:
   - `agent/sessions/**`; and
   - the exact path `agent/models-store.json`.
4. No wildcard, directory-wide, filename-pattern, or other broader exclusion
   is permitted. Every other path remains in the broad fingerprint and any
   unexpected non-excluded or sensitive change fails the witness.
5. The cache exception is an evidence interpretation, not permission for the
   harness to write the ambient cache, use the real home, or pass through a
   mutable/global provider boundary.

## Required compensating assertions

WP-05's isolated real-Pi witness must make the following assertions and retain
their before/after evidence:

- For `agent/auth.json`, `agent/models.json`, and `agent/settings.json`, record
  strict before/after existence, entry type, and content hash. A missing file,
  changed type, or changed content is a failure; the cache exception does not
  apply to these paths.
- For `agent/extensions/**` and `agent/skills/**`, recursively snapshot every
  entry's relative path, entry type, symlink target when applicable, and
  content hash when applicable. Any unexpected creation, deletion, type,
  target, or content change fails.
- Compute a broad fingerprint over every other path in the isolated root that
  is not under `agent/sessions/**` and is not exactly `agent/models-store.json`.
  The fingerprint must retain entry type, symlink target, and content/hash
  information sufficient to detect non-excluded mutation; it must not silently
  omit a sensitive or non-regular entry.
- Observe `agent/models-store.json` separately with bounded diagnostic metadata:
  presence, entry type, content hash when regular, size, and mtime. This
  metadata is diagnostic only and is not causal evidence. An unexpected
  non-regular cache entry is a failure, not an accepted cache variation.
- Verify the controlled artifact and capture its tree before and after the
  real-Pi run. Assert that the artifact contains and retains no
  `auth.json`, `models.json`, `models-store.json`, or `settings.json` created
  inside the artifact. Artifact mutation, unlisted entries, or a failed
  before/after verification fails closed.
- Record the canonical isolated root/home/database/workspace, parent and child
  agent directories, `userAgentDir`, `authPath`, and `modelsPath`. Assert that
  none is the real user home and that no configured path or discovered entry is
  a symlink into the real home.
- Assert that the extension loaded by the registered production Agent comes
  only from the verified controlled artifact. A global or mutable extension,
  path coincidence, or fallback to the user's Pi home is not evidence.
- Restore environment variables and process/runtime overrides in `finally`,
  remove the isolated root, and assert cleanup. Failure to restore or remove
  the isolated runtime is a witness failure.

The structured snapshot helper and its assertions are test-only evidence
machinery. They must not become production isolation logic, alter Pi SDK
semantics, write `models-store.json`, or broaden the accepted exclusion set.

## Concurrency handling

The witness must run with one isolated harness invocation at a time for its
canonical root, database, workspace, parent agent directory, and child agent
directory. It must record the before/after observation window and prevent
parallel test workers or sibling sessions from sharing those paths. The
provider/model boundary may naturally update the exact volatile cache during
that window; the witness records presence/type/hash/size/mtime only and does
not claim that the run caused the update.

If another process or session creates a sibling agent directory, mutates a
non-excluded path, changes a sensitive file, or makes the artifact tree differ,
the witness fails rather than attributing the observation to the volatile
cache. A cache observation cannot mask concurrency contamination or an
isolation failure.

## Rejected alternatives

1. **Include `agent/models-store.json` in the authoritative broad
   fingerprint:** rejected because a provider catalogue cache is volatile
   ambient state and can change as a normal side effect of model discovery;
   doing so would conflate cache churn with user/configuration mutation.
2. **Exclude all of `agent/**`, all model files, or every JSON file:\*\*
   rejected because it hides sensitive configuration, extension/skill
   mutation, sibling leakage, and artifact contamination.
3. **Ignore any cache mutation or accept any cache entry type:** rejected.
   The exception is exact-path and bounded; a non-regular or unexpected cache
   object remains a failure.
4. **Use only mtime or existence for the cache:** rejected because the
   diagnostic must retain bounded type/hash/size/mtime context.
5. **Treat a cache digest difference as causal proof:** rejected because the
   ambient provider catalogue is not attributable from this witness.
6. **Use the real user home, a mutable global extension, or an artifact that
   is also the writable runtime home:** rejected by the inherited controlled
   artifact and isolated real-Pi boundary.
7. **Write or pre-seed the ambient cache from the harness to stabilize the
   result:** rejected. The harness must use isolated routes and observe the
   cache rather than directly manufacture its state.

## Assumptions

- The observed `models-store.json` is an ambient provider/model catalogue
  cache, not an authoritative or sensitive user store under the current Pi
  runtime contract.
- The exact staged artifact, registered production Agent, isolated routes, and
  model endpoint remain the WP-04/WP-05 controlled boundary.
- The snapshot can represent regular files, directories, and symlinks without
  following a symlink into the real home; hashes are bounded to the accepted
  evidence size limits.
- The existing `agent/sessions/**` exclusion remains inherited and exact; this
  record adds only the exact `agent/models-store.json` exclusion.
- No harness code directly writes the ambient cache. If runtime behavior or a
  future fixture requires such a write, the reassessment must be reopened.

## Rollback, reopening, and downstream effect

Rollback of this planning amendment restores WP-05's prior cache-fingerprint
wording, but it must not weaken the inherited isolation, provenance, or
artifact rules and must not rewrite any durable Ticket 02 state. Rollback does
not authorize a source change, migration, status update, frontier move, or
acceptance claim.

Reopen this reassessment if material evidence shows any of the following:

- `models-store.json` becomes authoritative or sensitive user/configuration
  state;
- the harness directly writes the ambient cache despite isolated routes;
- sibling agent directories appear or are shared across supposedly isolated
  runs;
- any non-excluded path changes, including auth/models/settings, extension or
  skill entries, symlink targets, or other sensitive state; or
- the controlled artifact mutates, gains an unlisted entry, or contains a
  created auth/models/models-store/settings file.

A change to the exact Pi cache semantics, the inherited T17-AC8 boundary, or
controlled-artifact ownership also requires a new Supervisor reassessment
before WP-05 can claim the evidence.

Downstream effect is limited to the following planning amendment:

- WP-05 may change `piSubagentRealPiAcceptanceHelpers.ts` only to add the
  exact-path cache witness and structured before/after snapshots described
  here, plus the corresponding test assertions in the existing acceptance
  suite.
- WP-05 must report the cache as a non-causal diagnostic and retain all
  compensating assertions and cleanup evidence.
- Ticket 02 remains **ready-for-agent**; WP-05 remains **pending**; Tickets
  03–06 remain blocked; the Project Home status/frontier is unchanged.
- No source implementation, production contract, migration, release, push,
  deploy, Ticket 02 acceptance, or project acceptance is authorized.

## Binding summary

For T17-AC8 only, the exact broad fingerprint excludes `agent/sessions/**`
and the exact `agent/models-store.json` path, and nothing broader. The cache is
volatile ambient catalogue state, so its bounded presence/type/hash/size/mtime
observation is diagnostic and explicitly non-causal. Strict auth/models/
settings hashes, recursive extension/skill snapshots, a broad fingerprint of
all other paths, controlled-artifact before/after verification, canonical
isolated path and no-real-home assertions, artifact-only extension provenance,
environment restoration, and isolated-root removal are compensating gates.
Any sensitive/non-excluded change, sibling leakage, direct ambient-cache write,
or artifact mutation fails and reopens this narrow reassessment.
