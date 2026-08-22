# 01 — Package and fail-close the managed Pi artifact

**What to build:** As a Synara desktop user, I receive managed-subagent
availability only when the desktop release supplies a verified official
`pi-subagents` artifact. A missing, tampered, malformed, or incompatible
artifact fails before any managed child, admission, execution card, or durable
lifecycle record exists. Synara does not select a user-global extension.

**Blocked by:** None — can start immediately.

**Status:** accepted — final acceptance Decision 0005, 2026-08-22.

**Testing strategy:** [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

- [x] **AC1:** The desktop release pipeline assembles a deterministic managed
  artifact from the clean, pinned Alfie source and records a machine-verifiable
  manifest, source identity, capability profile, and digest.
- [x] **AC2:** Artifact validation rejects missing content, tampered bytes,
  malformed manifests, path escape, and symlink escape with bounded actionable
  categories.
- [x] **AC3:** Desktop managed-harness initialization with an invalid artifact
  fails before child spawn, admission, execution identity, card, lifecycle, or
  outbox creation.
- [x] **AC4:** The artifact contains no user authentication, model
  configuration, API key, or user-global extension content.
- [x] **AC5:** Non-desktop Pi behavior remains outside this rollout and
  preserves its existing runtime behavior.

## Completion evidence

- **Accepted decision:** [Decision 0005 — Ticket 01 final acceptance](../decisions/0005-t01-final-acceptance.md).
- **Candidate:** `dc693b44c..d717ee8e2`; Ticket acceptance and status recorded at `9fa60461a`.
- **Focused verification:** 89 server tests passed across the artifact verifier,
  desktop gate, PiAdapter gate integration, and existing PiAdapter suites.
  Artifact staging passed 8 tests; 2 real-checkout tests were skipped because
  `ALFIE_REPO_DIR` is not available.
- **Recorded limitations:** packaged desktop/server composition and whole-project
  validation remain Ticket 04 responsibilities. A valid Ticket 01 artifact
  stays unavailable until Ticket 02 provides the controlled runtime binding.

## Testing Seams

**Approval status:** Approved — human owner, 2026-08-21: “đồng ý, tạo testing seam trước đi”.

- **AC1:** The public desktop artifact-build command — a clean pinned Alfie
  input produces a staged official artifact with deterministic manifest,
  digest, source identity, and required capability profile.
- **AC2:** The public artifact-verification command and desktop release build
  boundary — missing/tampered/malformed/escaping inputs fail with a distinct
  safe diagnostic and never return a partial success.
- **AC3:** The desktop managed-session bootstrap boundary — an unavailable or
  invalid artifact returns the bootstrap diagnostic while repository observers
  prove zero child, admission, execution, lifecycle, card, and outbox effects.
- **AC4:** The staged artifact filesystem boundary — release verification
  proves authentication/model files and the user-global extension tree are
  absent from the staged artifact.
- **AC5:** The standalone Pi session-start boundary — no desktop managed
  artifact contract is present, so the existing non-desktop behavior remains
  unchanged.
