# 01b — Remediate the verified managed Pi runtime closure

**What to build:** As a Synara desktop user, the release-controlled artifact
is a complete runtime closure: from the release alone, the real pinned Alfie
`pi-subagents` extension loads, its `agent/extensions/shared` imports
resolve, and its runtime dependencies resolve from release-owned
manifest-verified files. No user-global tree, ambient `node_modules`, symlink,
or post-verify mutation is ever used to complete it.

**Blocked by:** None. Decision 0007's default host-peer alignment route was
completed in `799af158a`: the production Pi host family is declared and locked
at `0.83.0`, satisfying the pinned artifact's `>=0.83.0` peer floor. The
staged-artifact AC4 load proof remains required. Decision 0008 additionally
requires artifact-local `@sinclair/typebox@0.34.49` resolution or qualifying
exact host-alias supply; the current host alias is not itself sufficient.

**Status:** active

**Testing strategy:** [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

- [ ] **AC1:** Staging from the clean pinned Alfie checkout assembles the
  self-contained artifact — `agent/extensions/pi-subagents`, the necessary
  `agent/extensions/shared` content it imports, and the lock-proven
  release-owned `node_modules` regular-file dependency closure — with every
  regular file recorded in the deterministic manifest with size and
  SHA-256 digest.
- [ ] **AC2:** Repeat staging of the same pinned input yields an identical
  manifest, and dependency selection is proven from the lockfile rather than
  a floating range or an ambient/user install.
- [ ] **AC3:** Verification covers the expanded closure: missing, tampered,
  unlisted, path-escaping, or symlinked entries anywhere in `shared` or
  `node_modules` fail with the existing bounded categories, before Pi SDK
  import and global discovery, with no partial trust and no
  sensitive-diagnostic disclosure.
- [ ] **AC4:** The Decision 0007 supported host-peer prerequisite is satisfied
  by the aligned `0.83.0` production host in `799af158a`. Per Decision 0008,
  the real pinned extension entry must load from the staged artifact alone with
  `@sinclair/typebox@0.34.49` resolving artifact-locally (or from qualifying
  exact host supply), global/ambient resolution excluded, and no post-verify
  mutation; its `shared` and remaining dependency imports must resolve. If the
  real-checkout input is unavailable, the leg records an explicit skip, never
  a silent pass.
- [ ] **AC5:** Exclusion proof: the artifact contains no user
  authentication, model configuration, credentials, key material, or
  user-global extension content.
- [ ] **AC6:** The desktop fail-close ordering proof is rerun against the
  expanded closure: an invalid artifact rejects
  `managed-subagent-unavailable` before Pi SDK import, agent-directory/global
  discovery, and durable side effects, with no fallback.

## No-goals

- No controlled-runtime construction, extension binding, user
  authentication/model handling, handshake, or Agent-wrapper exposure —
  those remain Ticket 02's exclusive ownership.
- No synthetic in-process extension factory substitute for the real
  artifact.
- No packaging or copying of user credentials or model configuration.
- No symlinked `shared`/`node_modules` content, post-verify artifact
  mutation, or global/ambient dependency fallback at any point.
- No relaxation of manifest exactness to a subset of staged content.
- No packaged desktop/server composition run — that remains Ticket 04.
- No database migration, schema change, or external Alfie source
  modification; the Alfie checkout remains read-only input.

## Testing Seams

**Approval status:** Approved by the accepted project Testing Strategy
Governance decision, 2026-08-21 (“đồng ý, tạo testing seam trước đi”). Ticket
01b inherits the approved Ticket 01 seams, extended to the closure.

- **AC1:** The public desktop artifact-build command — a clean pinned Alfie
  input produces a staged self-contained closure (extension + `shared` +
  lock-proven `node_modules` regular files) with a deterministic manifest,
  digests, source identity, and the required capability profile.
- **AC2:** The staging determinism boundary — two independent stagings of
  the same pin yield identical manifests; dependency entries are derived
  from the lockfile.
- **AC3:** The public artifact-verification command —
  missing/tampered/unlisted/escaping/symlinked inputs inside `shared` and
  `node_modules` (as well as the extension tree) fail with distinct bounded
  safe diagnostics and never return partial success.
- **AC4:** The real-extension load boundary — the pinned extension entry and
  its imports resolve against the staged artifact alone, with ambient
  resolution paths excluded; absent `ALFIE_REPO_DIR` produces an explicit
  recorded skip.
- **AC5:** The staged artifact filesystem boundary — release verification
  proves authentication/model files, credential material, and user-global
  extension content are absent from the staged artifact.
- **AC6:** The desktop managed-session bootstrap boundary — an unavailable
  or invalid expanded-closure artifact returns the bootstrap diagnostic
  before SDK import and durable effects.

## Completion evidence

- **Governing decisions:** [Decision 0006 — Ticket 01 runtime-closure
  reassessment](../decisions/0006-t01-runtime-closure-reassessment.md),
  [Decision 0007 — host-peer compatibility reassessment](../decisions/0007-t01b-host-peer-compatibility-reassessment.md), and
  [Decision 0008 — normal-dependency host-alias reassessment](../decisions/0008-t01b-normal-dependency-host-alias-reassessment.md).
- Pending implementation. Decision 0007's host-peer prerequisite was
  delivered in `799af158a`; Decision 0008's TypeBox alias remediation, AC4,
  and other runtime-closure acceptance work remain pending. Ticket 02 remains
  blocked until this ticket is accepted.
