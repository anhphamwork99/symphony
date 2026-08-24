# Decision 0006 — Ticket 01 runtime-closure reassessment

- **Date:** 2026-08-22
- **Status:** Accepted — binding technical-direction reassessment. This is
  not a final-acceptance consultation and does not itself accept the
  remediation.
- **Consultation class:** Supervisor Reassessment, in bounds and binding,
  triggered by the Ticket 02 worker challenge that the accepted Ticket-01
  artifact cannot close a real pinned Alfie `pi-subagents` runtime.
- **Scope:** The Ticket 01 artifact content/closure, the remediation
  predecessor it creates (Ticket 01b), and the resulting Ticket 02/04
  routing. It does not reopen the fail-close gate design, verifier purity,
  locator/environment policy, or Decisions 0001–0003.

## Question

Is the Ticket-01 artifact accepted by Decision 0005 (`dc693b44c..d717ee8e2`)
a sufficient runtime closure to execute the real pinned Alfie
`pi-subagents` extension, or must a remediation precede Ticket 02's
real-runtime acceptance?

## Governing references

- Project Home: [PROJECT.md](../PROJECT.md)
- [Ticket 01](../issues/01-package-and-fail-close-managed-pi-artifact.md)
- [Ticket 01b](../issues/01b-remediate-verified-managed-pi-runtime-closure.md)
- [Ticket 02](../issues/02-bootstrap-verified-harness-and-detached-terminal-lifecycle.md)
- [Ticket 04](../issues/04-prove-desktop-production-composition-and-accept.md)
- [Decision 0001](0001-release-controlled-extension.md) — release-controlled
  extension.
- [Decision 0002](0002-no-legacy-managed-subagent-fallback.md) — no
  legacy/unmanaged fallback.
- [Decision 0003](0003-controlled-extension-with-user-runtime-configuration.md)
  — controlled extension separated from user runtime configuration.
- [Decision 0004](0004-t01-desktop-artifact-locator-and-fail-close-gate.md) —
  desktop artifact locator and fail-close gate.
- [Decision 0005](0005-t01-final-acceptance.md) — Ticket 01 final acceptance.
- [spec.md](../spec.md), Implementation Decisions 1–5 and 12.
- Accepted testing strategy:
  [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).
- The Supervisor Reassessment response in the orchestration context
  (2026-08-22) — the authoritative consultation result recorded here.

## Evidence

- Decision 0005 accepted a manifest-exact regular-file artifact staging the
  `pi-subagents` extension subtree with source identity, capability profile,
  sizes, and SHA-256 digests, verified by a pure production verifier and
  enforced by the shared fail-close gate.
- Decision 0005's own recorded limitation: the real-checkout staging legs
  were skipped because `ALFIE_REPO_DIR` was absent, leaving no direct
  execution evidence against the actual external Alfie checkout — precisely
  the evidence that would have exposed the closure gap.
- The real pinned Alfie `pi-subagents` extension does not execute from the
  staged extension subtree alone:
  - it imports shared runtime modules from the sibling
    `agent/extensions/shared` tree, which the accepted artifact omits; and
  - it resolves runtime dependencies from a release-owned `node_modules`
    dependency closure, which the accepted artifact also omits — Decision
    0005 settled verdict 4 explicitly recorded dependency trees as excluded
    content.
- The Ticket 02 worker challenged AC1–AC4 real-runtime acceptance on exactly
  this basis and refused substitutes (symlinked or shared-global resolution,
  post-verify installation) that would violate Decisions 0001, 0003, and 0004.
- Resolving the omitted content at runtime from a user-global or ambient
  installation would reintroduce the mutable-global resolution this project
  exists to eliminate (Decision 0001) and would place execution outside
  verified artifact content (Decision 0004 §3).

## Finding

Decision 0005's acceptance of the verifier, the fail-close gate, the manifest
exactness mechanism, and the artifact-exclusion posture stands. Its closure
premise is superseded: manifest-exact staging of the `pi-subagents` subtree
alone is not a runtime closure for the real pinned extension. The artifact
must additionally carry the necessary `agent/extensions/shared` content and a
lock-proven, release-owned `node_modules` regular-file dependency closure,
under the same manifest exactness, or a real managed Pi session cannot load
the release-controlled extension from the release alone.

## Binding decision

1. A remediation ticket — [01b — Remediate the verified managed Pi runtime
   closure](../issues/01b-remediate-verified-managed-pi-runtime-closure.md) —
   is created as the direct predecessor of Ticket 02, owned by the artifact
   packaging/verifier ownership established for Ticket 01. Ticket 01's issue
   record keeps its accepted fail-close history; the reopened closure is
   tracked as Ticket 01b rather than by rewriting Ticket 01's acceptance.
2. The remediated artifact layout must be self-contained for real extension
   execution: `agent/extensions/pi-subagents`, the necessary
   `agent/extensions/shared` content it imports, and the manifest-listed
   regular-file `node_modules` dependency closure, proven from the lockfile
   and release-owned.
3. Manifest exactness is retained and extended over the whole closure: every
   staged regular file — extension, shared, and dependency — is
   manifest-listed with size and digest; unlisted content is rejected; and
   staging remains deterministic and reproducible from the clean pinned
   Alfie commit.
4. No post-verify mutation of the artifact, no symlinked content, no runtime
   global fallback (user-global or ambient `node_modules`, `NODE_PATH`, or
   equivalent), and no user credential/authentication/model packaging are
   permitted in or around the remediated artifact. User authentication and
   model configuration remain Ticket 02's explicit user-local runtime input.
5. The production verifier stays pure (generated manifest/digest material
   only; no runtime Git, no user-Pi access) and must reject unlisted,
   missing, tampered, path-escaping, and symlinked entries anywhere in the
   expanded closure with the existing bounded categories, before Pi SDK
   import and global discovery. The Decision 0004 §5 fail-close ordering is
   unchanged.
6. Ticket 02 AC1–AC4 real-runtime acceptance is stopped, and Ticket 02 cannot
   claim completion until remediation 01b is accepted. Existing Ticket 02
   implementation code and tests may remain as in-progress work; its issue
   status must read blocked by 01b, and no AC may be marked done in the
   meantime.
7. Ticket 04 remains packaged desktop/server final composition only and does
   not absorb this remediation.

## Required acceptance evidence (Ticket 01b)

1. Staging from the clean pinned Alfie checkout produces the self-contained
   closure of Binding decision 2, every regular file manifest-listed and
   digest-verified, with repeat staging yielding an identical manifest.
2. Verifier coverage extends across `shared` and `node_modules`: unlisted,
   missing, tampered, path-escaping, and symlinked entries anywhere in the
   closure fail with the existing bounded categories and no partial trust.
3. Real-extension proof: from the staged artifact alone — no global/ambient
   dependency resolution, no user extension tree, no post-verify mutation —
   the pinned real `pi-subagents` extension entry loads and its `shared` and
   dependency imports resolve. Absence of the real-checkout input remains an
   explicit recorded skip, never a silent pass.
4. Exclusion proof: the closure contains no user authentication/model
   configuration, credentials, key material, or user-global extension
   content; dependency selection is lock-proven, not range-floating.
5. The focused stager/verifier suites pass, and the desktop fail-close
   ordering proof — rejection before Pi SDK import, global discovery, and
   durable side effects — is rerun against the expanded closure.

## Rejected alternatives

- Symlinking `shared` or `node_modules` from the checkout or any user/global
  install into the artifact.
- Post-verify installation into, or mutation of, the artifact directory.
- Runtime global fallback resolution for omitted content.
- Relaxing manifest exactness to verify only a subset of staged content.
- Substituting a synthetic in-process extension factory for the real
  artifact.
- Packaging user credentials or model configuration to make sessions run.
- Absorbing the closure work into Ticket 02, Ticket 03, or Ticket 04.

## Failure and rollback implications

If the closure cannot be staged deterministically or verified, desktop
managed subagents remain fail-closed (`managed-subagent-unavailable`) with no
fallback; correction ships as a new release rather than a runtime repair.
Rolling back the remediation restores the insufficient closure and therefore
restores the Ticket 02 block; a rollback must not enable any fallback path.

## Reopening conditions

Reassess only on material evidence that:

- a required runtime dependency cannot be shipped license-compatibly from
  the release;
- the real extension requires a runtime artifact form other than a
  manifest-exact regular-file closure;
- Pi SDK extension-resolution semantics change in a way the closure cannot
  satisfy; or
- a later binding decision changes the Decisions 0001–0005 boundaries this
  record preserves.

## Amendment to Decisions 0004 and 0005

Exact and narrow:

- **Decision 0005, settled verdict 1** is amended: the deterministic
  manifest-bearing artifact must now assemble the self-contained runtime
  closure of Binding decision 2 (extension + necessary `shared` +
  lock-proven `node_modules` regular-file dependency closure), not the
  extension subtree alone.
- **Decision 0005, settled verdict 4** ("The artifact excludes user
  authentication, models, credentials, key material, dependency trees, and
  user-global extension content.") is amended: user authentication, models,
  credentials, key material, and user-global extension content remain
  excluded; the release-owned, lock-proven runtime dependency closure is now
  required in-artifact.
- **Decision 0005, Downstream impact** ("Ticket 02 is unblocked to construct
  the explicit controlled runtime …") is superseded: Ticket 02 is blocked by
  remediation Ticket 01b until that remediation is accepted. Ticket 02's
  controlled-runtime responsibilities are otherwise unchanged.
- **Decision 0004** is amended only in its artifact-coverage premise: the
  verified regular-file tree is the full runtime closure above. Its locator,
  environment-sanitization, verifier-purity, fail-close-ordering,
  non-desktop pass-through, and Ticket-02 runtime-binding ownership
  directions are unchanged and binding.

This reassessment is recorded as a material-evidence reopening of Decision
0005's closure premise. All other Decision 0005 findings and all Decision
0004 direction remain binding.

## Superseded record

Decision 0005's artifact-closure premise and its "Ticket 02 is unblocked"
downstream statement, only as amended above. No other Decision 0001–0005
content is superseded.
