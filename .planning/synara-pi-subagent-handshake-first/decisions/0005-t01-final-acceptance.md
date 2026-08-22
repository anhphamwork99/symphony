# Decision 0005 — Ticket 01 final acceptance: packaged fail-close managed Pi artifact

- **Date:** 2026-08-22
- **Status:** Accepted — final acceptance decision
- **Scope:** Ticket 01 only: release artifact staging, desktop locator/environment isolation, production verification, and pre-SDK fail-close gating. This is not acceptance of Tickets 02–04 or of the full handshake-first project.

## Question

Does committed candidate `dc693b44c..d717ee8e2` satisfy Ticket 01 AC1–AC5 and Decisions 0001–0004 such that Ticket 02 may depend on its fail-closed desktop artifact boundary?

## Governing references

- Project Home: `.planning/synara-pi-subagent-handshake-first/PROJECT.md`
- Ticket 01: `issues/01-package-and-fail-close-managed-pi-artifact.md`
- Project specification: `spec.md`, especially Implementation Decisions 1–5 and 12
- Decision 0001: release-controlled extension
- Decision 0002: no desktop legacy/unmanaged fallback
- Decision 0003: controlled extension separated from user runtime configuration
- Decision 0004: Ticket 01 desktop artifact locator and fail-close gate
- Accepted testing strategy: `.planning/synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md`

## Evidence

- Candidate commits: `dc693b44c..d717ee8e2`; supplied scope excludes unrelated current dirty paths.
- Release staging is wired through `scripts/build-desktop-artifact.ts` and `scripts/lib/piSubagentArtifactStaging.ts`.
- Desktop backend environment derives only a release-resource locator and removes inherited `PI_CODING_AGENT_DIR`.
- The production verifier validates a closed, regular-file artifact tree against generated manifest/digest material without runtime Git or user-Pi access.
- The shared desktop gate denies missing, invalid, and valid-but-not-yet-runtime-bound artifacts before Pi SDK import and global agent-directory discovery.
- PiAdapter applies that gate to session start and inactive model, skill, and command discovery; non-desktop remains pass-through.
- Focused verification passed: 4 server files / 89 tests; staging suite 8 passed, 2 real-checkout tests skipped only because `ALFIE_REPO_DIR` was absent; `git diff --check` was clean before commit.
- Independent reviewer found every AC1–AC5 aspect passing with no blocking issue. Its three narrow typing findings were corrected in `d717ee8e2`; focused regression was rerun afterward.

## Settled verdict

Ticket 01 satisfies AC1–AC5 and is accepted.

1. The release pipeline assembles a deterministic manifest-bearing artifact from a clean, pinned, provenance-verified Alfie extension source and records source identity, required capabilities, file sizes, and SHA-256 digests.
2. The verifier rejects absent, malformed, tampered, escaped, symlinked, capability-invalid, and unlisted artifact content through bounded categories, without partial trust or sensitive diagnostics.
3. Desktop rejects before Pi SDK import, agent-directory/global discovery, child creation, admission, execution identity, card, lifecycle, or outbox effects. A valid Ticket 01 artifact also remains unavailable until Ticket 02 supplies controlled runtime binding.
4. The artifact excludes user authentication, models, credentials, key material, dependency trees, and user-global extension content.
5. Non-desktop Pi remains outside this rollout and retains existing behavior.

## Rejected alternatives

- Treating a valid Ticket 01 artifact locator as a usable Pi `agentDir`.
- Falling back to a user-global or unmanaged extension when the artifact is missing, invalid, or not yet bound by Ticket 02.
- Requiring a live packaged desktop composition run for this ticket rather than Ticket 04.
- Withholding Ticket 01 solely for unapproved full-workspace validation or the unavailable optional real-checkout test input.

## Assumptions and residual uncertainty

- The supplied commit-range and excluded-dirty-path statement accurately identifies the reviewed candidate.
- The skipped real-checkout tests leave no direct execution evidence against the actual external Alfie checkout in this environment. The release build remains required to verify that checkout and fail closed if it cannot.
- No full workspace test, formatter, lint, or typecheck was authorized or run after the narrow type corrections. This is an authorization-bounded evidence limitation, not a known remaining defect.

## Downstream impact

- Ticket 02 is unblocked to construct the explicit controlled runtime, inject the verified extension without global discovery, load user-local runtime configuration, negotiate the required handshake, and expose the managed Agent wrapper.
- Ticket 04 remains responsible for real packaged desktop/server composition, old-global-extension isolation, real Pi detached lifecycle, full project validation, independent review, and project-level acceptance.

## Failure and rollback implications

- Any missing, invalid, or incompatible artifact continues to disable desktop managed subagents before SDK/global discovery; it must not trigger a fallback.
- A release artifact problem is corrected by shipping a release whose generated artifact and manifest verify. Runtime must not repair from a user-controlled path.

## Reopening conditions

Reassess only if:

- new evidence shows an SDK extension-discovery path bypasses the shared gate;
- the desktop resource locator can be redirected by inherited, renderer, or request input;
- the release pipeline cannot prove/stage the pinned artifact as designed;
- a post-correction focused test fails;
- Ticket 02 reintroduces global discovery, treats the locator as `agentDir`, or permits a valid artifact to bypass controlled runtime binding;
- or authoritative Ticket 01/project/decision records materially change.

## Supersedes

None.
