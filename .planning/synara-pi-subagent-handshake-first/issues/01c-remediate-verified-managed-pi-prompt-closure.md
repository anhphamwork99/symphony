# 01c — Remediate the verified managed Pi prompt closure

**What to build:** As a Synara desktop user, the release-controlled artifact
carries the real pinned Alfie `pi-subagents` extension's prompt-file runtime
closure: from the release alone, a real delegated child spawn reaches at
least its first real child model request. The prompt files are mechanically
derived from the pinned extension's actual runtime prompt-read graph, staged
manifest-exactly from the clean pinned Alfie commit, and never supplied by a
ticket, a symlink, a user/global tree, or post-verification mutation.

**Blocked by:** None — opened by [Decision 0010](../decisions/0010-t01c-prompt-closure-reassessment.md)
as the direct predecessor of Ticket 02 real-runtime acceptance.

**Status:** accepted — accepted by
[Decision 0011](../decisions/0011-t01c-final-acceptance.md) (the one and
only final-acceptance consultation, 2026-08-23), after the persisted
independent review
[01c prompt-closure review](../reviews/01c-prompt-closure-review.md)
(commit `c470acffd`) reported PASS with no findings.

**Ownership:** Existing artifact packaging/verifier ownership established for
Tickets 01/01b (staging under `scripts/lib/piSubagentArtifactStaging.ts` and
the production verifier under `apps/server/src/provider/piSubagentArtifactVerifier.ts`).
Not Ticket 02's test-only WP-C write set; not Ticket 04 composition.

**Testing strategy:** [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

- [x] **AC1 — Mechanical derivation:** Staging derives the prompt-file
  dependency closure mechanically from the clean pinned extension's actual
  runtime prompt-read graph, rooted at the child execution entry path. It
  resolves the path expressions used by `buildAgentPrompt`, collects every
  file passed to the required prompt reader, and normalizes each result
  inside the pinned Alfie repository. A derivation test against the clean
  current pin produces exactly the four current prompt dependencies
  (`agent/system/subagent-system.md`, `agent/system/tool-guidelines.md`,
  `agent/system/skill-rules.md`, `agent/system/working-style.md`).
  Negative fixtures prove that a new required prompt read is automatically
  included or causes staging to fail — not silently omitted. A
  hand-maintained four-name allowlist is insufficient.
- [x] **AC2 — Fail-closed derivation and staging:** Unsupported dynamic
  paths, path escape, untracked input, dirty derived input, missing/empty
  files, and symlinks fail staging. The four files are non-empty regular
  files; a required prompt read resolving to an empty file fails closed.
- [x] **AC3 — Deterministic manifest-exact staging:** Repeat staging of the
  same pinned input yields an identical manifest, and every derived prompt
  file is a manifest-listed regular file with exact size and SHA-256 digest,
  staged at its original `agent/system/...` relative path from the exact
  clean pinned Alfie commit (never an ambient checkout state).
- [x] **AC4 — Expanded verification:** Verification covers `agent/system`:
  missing, tampered, unlisted, path-escaping, non-regular, and symlinked
  entries under `agent/system` fail with the existing bounded diagnostic
  categories, with bidirectional exact-tree matching and no partial trust. A
  negative control removing or altering a required prompt file is rejected
  by artifact verification before managed runtime use.
- [x] **AC5 — Real child-spawn closure proof:** A real production-loader
  controlled-artifact proof verifies the artifact before and after loading,
  excludes user/global/ancestor/`NODE_PATH` canaries, invokes the real
  Agent, and reaches at least the first real deterministic child model
  request. Merely observing the Agent tool at extension-load time is not
  sufficient closure evidence. If the real-checkout input is unavailable, the
  leg records an explicit skip, never a silent pass.
- [x] **AC6 — Exclusion and fail-close ordering:** Exclusion proof (no
  credentials, authentication data, model configuration, key material, or
  user-global extension content enters the artifact) and the desktop
  fail-close-ordering proof (invalid artifact rejects
  `managed-subagent-unavailable` before Pi SDK import, extension/global
  discovery, and durable side effects) are rerun against the expanded
  closure, with no fallback.
- [x] **AC7 — Review and acceptance:** Focused stager/verifier/runtime tests
  pass, followed by an independent Ticket 01c review and exactly one Ticket
  01c final-acceptance consultation.

## No-goals

- No ticket-side creation or copying of prompt files after artifact
  verification.
- No symlinks into the Alfie checkout, a user installation, or any other
  external tree.
- No user-global, ancestor, `NODE_PATH`, working-directory, or other ambient
  fallback.
- No treatment of these files as session-local user configuration under
  Decision 0003, and no packaging through user auth/model configuration.
- No modification of the pinned external Alfie source; the checkout remains
  read-only input.
- No hard-coding of the currently observed four filenames without mechanical
  dependency derivation.
- No weakening of manifest exactness, and no acceptance of load-only
  evidence as proof of executable closure.
- No controlled-runtime construction, extension binding, user
  authentication/model handling, handshake, or Agent-wrapper exposure — those
  remain Ticket 02's exclusive ownership.
- No packaged desktop/server composition run — that remains Ticket 04.

## Testing Seams

**Approval status:** Approved by the accepted project Testing Strategy
Governance decision, 2026-08-21 (“đồng ý, tạo testing seam trước đi”). Ticket
01c inherits the approved Ticket 01/01b seams, extended to the prompt
closure.

- **AC1:** The prompt-derivation boundary — the staging/build derivation
  against the pinned real extension source produces exactly the runtime
  prompt-read closure; fixture mutations that add or alter a required prompt
  read are included or fail staging.
- **AC2:** The derivation failure boundary — dynamic/unresolved/escaping/
  untracked/dirty/empty/symlinked prompt inputs fail with bounded safe
  diagnostics.
- **AC3:** The staging determinism boundary — two independent stagings of
  the same pin yield identical manifests including the derived prompt
  entries.
- **AC4:** The public artifact-verification command —
  missing/tampered/unlisted/escaping/non-regular/symlinked entries under
  `agent/system` fail with distinct bounded safe diagnostics and never
  return partial success.
- **AC5:** The real child-spawn boundary — the staged artifact alone, with
  ambient resolution paths excluded, drives a real Agent invocation to at
  least the first real deterministic child model request; absent
  `ALFIE_REPO_DIR` produces an explicit recorded skip.
- **AC6:** The staged artifact filesystem boundary and the desktop
  managed-session bootstrap boundary — exclusion and fail-close ordering
  rerun over the expanded closure.

## Completion evidence

Accepted by [Decision 0011](../decisions/0011-t01c-final-acceptance.md)
(2026-08-23), governed by
[Decision 0010](../decisions/0010-t01c-prompt-closure-reassessment.md)
whose Required acceptance evidence (Ticket 01c) list and artifact/verifier
invariants are authoritative for this ticket.

- **Candidate:** range `f7fa51d45..6ccc674b9` — `185ef4210` (mechanical
  prompt-closure derivation), `b82bdbecb` (continuation incl. staging
  prompt leg), `4e6ee09c2` (completion incl. real child-spawn closure
  proof), `6ccc674b9` (remediation of the prior independent review's
  findings). Pinned input unchanged: Alfie
  `aa6fa4a8540644d2509b10d6df854486ddc67d1d` /
  `@alfie/pi-subagents@0.15.0-alfie.4`.
- **Independent review:** PASS, no findings — persisted at commit
  `c470acffd` as
  [01c-prompt-closure-review.md](../reviews/01c-prompt-closure-review.md);
  it independently re-executed the focused suites and audited the full
  changed-path set (seven approved paths; remediation commit touches
  exactly its four expected paths).
- **Focused tests:** 143 tests / 6 files, all green, independently re-run
  at `6ccc674b9` (one file per invocation, `ALFIE_REPO_DIR` pointing at the
  clean pinned checkout): derivation 21, staging 22, npm runtime closure
  20, verifier 47, desktop gate 30, real-load 3.
- **AC1–AC7 disposition:** all pass per Decision 0011's binding decision,
  including the AC5 real child-spawn closure proof reaching at least the
  first real deterministic child model request with staged-closure prompt
  bytes and tamper-sensitive runtime-derived markers, and the AC7
  consultation budget now exhausted.
- **Downstream:** Decision 0011 discharges Decision 0010's suspension of
  Decision 0009's complete-executable-closure / real-child-execution /
  Decision-0006-discharge / Ticket-02-block conclusions. Ticket 02 is
  unblocked but not accepted; Ticket 04 remains blocked by 02 + 03.
