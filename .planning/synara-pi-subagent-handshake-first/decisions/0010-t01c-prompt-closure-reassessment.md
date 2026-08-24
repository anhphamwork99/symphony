# Decision 0010 — T01c prompt-closure reassessment

- **Date:** 2026-08-22
- **Status:** Accepted — binding in-bounds Supervisor Reassessment. This is
  not a final-acceptance consultation for Ticket 01b or Ticket 02.
- **Consultation class:** Supervisor Reassessment, triggered by the Ticket 02
  real controlled-artifact run failing before the first child model request.
- **Gate:** reject — the premise that Decision 0009's accepted Ticket 01b
  artifact is a complete executable closure for real child spawn does not
  hold.
- **Scope:** The missing `agent/system` prompt dependency, the Ticket-01c
  remediation predecessor it creates, the narrow amendment to Decision 0009,
  and the resulting Ticket 02/04 routing. It does not reopen the Decisions
  0001–0008 artifact/verifier security boundaries, the manifest-exactness
  mechanism, the fail-close ordering, or Tickets 02–04 ownership.

## Question

Does the missing `agent/system` prompt dependency require another
Ticket-01-family closure remediation, or may Ticket 02 supply it through an
already authorized mechanism?

## Governing references

- Project Home: [PROJECT.md](../PROJECT.md)
- [spec.md](../spec.md)
- Decisions [0001](0001-release-controlled-extension.md)–
  [0009](0009-t01b-final-acceptance.md), principally
  [Decision 0006](0006-t01-runtime-closure-reassessment.md) and
  [Decision 0009](0009-t01b-final-acceptance.md)
- [Ticket 01b](../issues/01b-remediate-verified-managed-pi-runtime-closure.md)
  and [Ticket 02](../issues/02-bootstrap-verified-harness-and-detached-terminal-lifecycle.md)
- The accepted testing strategy:
  [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)
- The Supervisor Reassessment response in the orchestration context
  (2026-08-22) — the authoritative consultation result recorded here.

## Evidence

- `agent/extensions/pi-subagents/src/agent-runner.ts` imports
  `buildAgentPrompt` from `prompts.ts` and invokes it before creating the
  child model request (both the resolved-config branch and the unknown-type
  fallback branch inside `runAgent`).
- At pinned source commit `aa6fa4a8540644d2509b10d6df854486ddc67d1d`,
  `prompts.ts` computes `SYSTEM_DIR = join(__dirname, "../../../system")`.
  From staged location `<artifact>/agent/extensions/pi-subagents/src`, that
  resolves to `<artifact>/agent/system`.
- `buildAgentPrompt` synchronously and unconditionally requires these
  non-empty regular files (each read through `readRequiredPrompt`, which
  fails closed on a missing **or empty** file):
  - `agent/system/subagent-system.md`
  - `agent/system/tool-guidelines.md`
  - `agent/system/skill-rules.md`
  - `agent/system/working-style.md`

- The runtime call graph is `runAgent` → `buildAgentPrompt` → four
  `readRequiredPrompt` calls. `subagent-system.md` references the other
  content through in-memory template substitutions; there is no further
  file-include mechanism in the inspected renderer. Thus those four files are
  the current pin's exact transitive `agent/system` runtime closure. Other
  files presently under `agent/system`, including `main-system.md`,
  `MANIFEST.md`, `orchestration-rules.md`, and `SOUL.md`, are not in the
  current child-prompt read graph.
- `scripts/lib/piSubagentArtifactStaging.ts` stages the extension subtree,
  three explicitly enumerated shared modules, and the lock-derived npm
  closure. It has no `agent/system` staging leg.
- `apps/server/src/provider/piSubagentArtifactVerifier.ts` correctly requires
  a manifest-exact regular-file tree and rejects every unlisted or symlinked
  addition. Consequently, Ticket 02 cannot lawfully add the prompt files
  after verification.
- The supplied controlled-artifact run reached real handshake, Agent
  admission, and durable lifecycle events but failed before the first child
  model request with `Required subagent prompt file missing:
<artifact>/agent/system/subagent-system.md`. That diagnostic was not
  retained in the draft source after the temporary instrumentation was
  reverted, but it is independently consistent with — and deterministically
  explained by — the inspected runtime and staging source.
- The draft's separate AC2/AC5 issue opens a second `DatabaseSync` reader
  while the live repository holds exclusive WAL access. That is a
  test-observation defect and does not alter the artifact-closure finding.

## Finding or settled direction

The newly discovered prompt dependency reopens Decision 0009 under its
express reopening condition that a normal dependency resolves outside the
verified artifact or the real-load proof regresses.

There is no authoritative alternative delivery mechanism that permits these
files to remain outside the verified closure:

- Decision 0001's earlier flexibility over internal delivery mechanisms is
  narrowed by Decisions 0004, 0006, and 0009 to the manifest-exact release
  artifact.
- The files are release-owned runtime content, not user
  authentication/model configuration.
- Session-local user configuration under Decision 0003 cannot supply
  executable extension prompt content.
- Ambient, global, symlinked, or post-verification supply would violate the
  project's central trust boundary.

A new Ticket-01-family remediation predecessor is therefore required. Use a
narrowly scoped follow-on ticket, [01c — Remediate the verified managed Pi
prompt closure](../issues/01c-remediate-verified-managed-pi-prompt-closure.md),
owned by the existing artifact packaging/verifier owner. Do not absorb it
into Ticket 02's test-only WP-C write set.

## Binding decision

1. **Ticket 01c** is created as the direct predecessor of Ticket 02
   real-runtime acceptance. It extends the same release-owned,
   manifest-exact artifact with the pinned extension's mechanically derived
   prompt-file dependency closure.
2. **Exact closure semantics for the current pin:** the closure consists of
   the four non-empty regular files listed in Evidence above, at their
   original `agent/system/...` relative paths. Their bytes must come from the
   exact clean pinned Alfie commit.
3. **Mechanical derivation requirement:** the staging/build process must
   derive prompt dependencies from the clean pinned extension's actual
   runtime prompt-read graph, rooted at the child execution entry path. It
   must resolve the path expressions used by `buildAgentPrompt`, collect
   every file passed to the required prompt reader, normalize each result
   inside the pinned Alfie repository, and fail closed on dynamic,
   unresolved, escaping, untracked, non-regular, empty, or symlinked
   dependencies. A hand-maintained four-name allowlist is insufficient. Each
   future Alfie pin must rederive the graph; changed dependencies must update
   the closure or fail release staging. For the current pin, derivation must
   produce exactly the four paths above.
4. **Provenance requirement:** relevant extension source and derived
   `agent/system` inputs must be proven against the exact pinned commit and
   clean for the staged paths. Prompt bytes must not come from an ambient
   checkout state.
5. **Artifact and verifier invariants** — existing security constraints
   remain unchanged:
   - every prompt file is a manifest-listed regular file with exact size and
     SHA-256;
   - deterministic repeat staging produces an identical manifest;
   - exact-tree verification remains bidirectional;
   - missing, tampered, unlisted, escaping, non-regular, and symlinked
     entries fail closed with the existing bounded diagnostic categories;
   - verification remains pure and uses no runtime Git, network, user Pi
     directory, or partial-trust result;
   - verification still precedes Pi SDK import, extension/global discovery,
     and durable side effects;
   - no credentials, authentication data, model configuration, key material,
     or user-global extension content enters the artifact.

## Required acceptance evidence (Ticket 01c)

1. A mechanical derivation test against the clean current pin produces
   exactly the four current prompt dependencies. Negative fixtures prove
   that a new required prompt read is automatically included or causes
   staging to fail — not silently omitted.
2. Unsupported dynamic paths, path escape, untracked input, dirty derived
   input, missing/empty files, and symlinks fail staging.
3. Repeat staging is deterministic, and all derived prompt files are
   manifest-listed with exact size and digest.
4. Verifier tests cover missing, tampered, unlisted, path-escaping, and
   symlinked content under `agent/system`, with no partial trust.
5. A real production-loader controlled-artifact proof verifies the artifact
   before and after loading, excludes user/global/ancestor/`NODE_PATH`
   canaries, invokes the real Agent, and reaches at least the first real
   deterministic child-model request. Merely observing the Agent tool at
   extension-load time is no longer sufficient closure evidence.
6. A negative control removing or altering a required prompt file is
   rejected by artifact verification before managed runtime use.
7. Exclusion and desktop fail-close-ordering tests are rerun against the
   expanded closure.
8. Focused stager/verifier/runtime tests pass, followed by an independent
   Ticket 01c review and exactly one Ticket 01c final-acceptance
   consultation.

## Rejected alternatives

- Ticket-side creation or copying of prompt files after artifact
  verification.
- Symlinks into the Alfie checkout, user installation, or any other external
  tree.
- User-global, ancestor, `NODE_PATH`, working-directory, or other ambient
  fallback.
- Treating these files as session-local user configuration.
- Packaging them through user auth/model configuration.
- Modifying the pinned Alfie source.
- Hard-coding only the currently observed four filenames without mechanical
  dependency derivation.
- Weakening manifest exactness or accepting load-only evidence as proof of
  executable closure.
- Moving the remediation into Ticket 02 or Ticket 04.

## Assumptions

The pinned source inspected is the source identified by the existing
provenance fixture. The build must independently enforce exact commit and
cleanliness; this decision does not rely on the ambient checkout remaining
clean.

## Residual uncertainty

No retained standalone diagnostic artifact was available for direct
inspection. This does not change the direction because the source-level path
resolution and absent staging leg independently establish the failure.

## Failure and rollback

Until Ticket 01c is accepted, managed desktop subagents remain fail-closed.
Rolling back Ticket 01c restores the missing-prompt failure and immediately
restores the Ticket 02 block. No rollback may enable fallback or mutable
runtime repair.

## Downstream effect

- Ticket 02 returns to **blocked by Ticket 01c for real-runtime acceptance**,
  especially AC4, and may not claim any AC complete or request final
  acceptance. Its current WP-C must not modify production
  staging/verifier source.
- Work that may continue on Ticket 02: test-only work within its approved
  write set may continue, including repairing AC2/AC5 by reading through the
  live repository or disposing the repository before opening an external
  read-only `DatabaseSync`. Other implementation/tests may remain in progress
  provided they do not fabricate prompt content or claim acceptance. After
  Ticket 01c acceptance, the complete real controlled-artifact Ticket 02
  suite must be rerun.
- Ticket 04 stays downstream, blocked by its existing dependencies.

## Reopening conditions

Reassess only if pinned Alfie removes these runtime reads, provides an
upstream-authoritative self-contained artifact with an equivalent
manifest-exact release boundary, or an owner-approved decision changes the
artifact trust boundary.

## Narrow amendment to Decision 0009

Decision 0009 remains valid for its proven extension/shared/npm closure, host
alignment, artifact-local TypeBox resolution, verifier behavior, exclusions,
and fail-close ordering. It is narrowly amended as follows:

- Its characterization of Ticket 01b as the **complete executable runtime
  closure** is superseded; the accepted candidate omitted required
  child-prompt runtime content.
- Its AC1/AC4 conclusions prove the closure that was staged and extension
  loading, but no longer prove complete real child execution from the
  release alone.
- Its statement that Decision 0006's closure condition is fully discharged is
  suspended pending Ticket 01c acceptance.
- Its downstream unblocking of Ticket 02 is superseded by the Ticket 01c
  predecessor block.
- No other Decision 0009 finding, and none of the artifact/verifier security
  boundaries in Decisions 0001–0008, is reopened.

## Superseded record

Only Decision 0009's complete-executable-closure characterization, its
AC1/AC4 real-child-execution conclusion, its "fully discharged" statement
for Decision 0006's closure condition, and its Ticket-02 unblocking — each
exactly as amended above. All other Decision 0001–0009 content remains
binding.
