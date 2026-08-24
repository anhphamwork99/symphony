# Ticket 01c — Verified managed Pi prompt closure review

## Review state

completed — **PASS, no findings** (reviewer taxonomy: PASS). This is the
independent Ticket 01c feature-level review required by
[Decision 0010](../decisions/0010-t01c-prompt-closure-reassessment.md)
AC7 evidence item 8. It is evidence, not final acceptance: no acceptance
decision has been made, and the candidate may proceed to exactly one
final-acceptance consultation.

## Candidate

- Range: `f7fa51d45..6ccc674b9` (base `f7fa51d45` = Decision 0010 persistence)
- `185ef4210` — mechanical prompt-closure derivation
  (`scripts/lib/piSubagentPromptClosureDerivation.ts` + tests)
- `b82bdbecb` — staging prompt leg, expanded verifier/gate coverage
- `4e6ee09c2` — real child-spawn closure proof
  (`piSubagentArtifactClosureRealLoad.test.ts`)
- `6ccc674b9` — remediation of the prior independent review's findings
- Pinned input unchanged: Alfie `aa6fa4a8540644d2509b10d6df854486ddc67d1d` /
  `@alfie/pi-subagents@0.15.0-alfie.4` (per
  [`piSubagentExtensionProvenance.json`](../../../apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json))

## Independence and scope

The reviewer is not the implementing agent. The review independently reread
the governing records and every changed path, re-derived the security model
from source, and independently re-executed the focused suites (commands
below) rather than trusting the implementation agent's recorded evidence.

Changed paths audited (full candidate, seven approved paths):

- [piSubagentPromptClosureDerivation.ts](../../../scripts/lib/piSubagentPromptClosureDerivation.ts)
  and
  [piSubagentPromptClosureDerivation.test.ts](../../../scripts/lib/piSubagentPromptClosureDerivation.test.ts)
- [piSubagentArtifactStaging.ts](../../../scripts/lib/piSubagentArtifactStaging.ts)
  and
  [piSubagentArtifactStaging.test.ts](../../../scripts/lib/piSubagentArtifactStaging.test.ts)
- [piSubagentArtifactVerifier.test.ts](../../../apps/server/src/provider/piSubagentArtifactVerifier.test.ts)
- [piSubagentDesktopArtifactGate.test.ts](../../../apps/server/src/provider/piSubagentDesktopArtifactGate.test.ts)
- [piSubagentArtifactClosureRealLoad.test.ts](../../../apps/server/src/provider/piSubagentArtifactClosureRealLoad.test.ts)

The remediation commit `6ccc674b9` touches exactly the four expected paths
(the two derivation files, the staging test, and the real-load test). The
full candidate range touches exactly the seven approved paths above — no
production verifier or gate source, no web, no Alfie or dependency-pin
change, no planning-artifact edits inside the candidate range.

## Prior defects and remediation evidence

A prior independent review of the `4e6ee09c2` candidate found defects;
`6ccc674b9` remediates all of them, verified against the committed source:

1. **P1 — cross-module reachability.** Static derivation previously stopped
   at the prompt-builder module, so a required prompt read living in an
   _imported helper_ could be silently omitted. Remediated: the analyzer now
   traverses the reachable **relative** import graph from `buildAgentPrompt`,
   analyzing imported helpers in their own module's lexical scope; a fifth
   literal read inside an imported helper is derived automatically, and an
   imported read shape that cannot be statically proved fails
   `prompt_closure_unsupported` (nonrelative imports referenced from the
   reachable graph are rejected, not skipped). Proven by
   `P1 regression: a FIFTH literal required read inside an IMPORTED helper
module is derived automatically` and
   `an imported helper with a dynamic required read fails unsupported (no
silent omission)` in the derivation suite, plus the corresponding staging
   synthetic regressions.
2. **P1 — same-name reader exemption.** Reader-ness was previously keyed by
   identifier name, so a _different_ function reusing the reader's parameter
   name could be miscredited as a required read. Remediated: lexical node
   identity — a `readFileSync` call is "routed through the reader" only when
   the call site is inside the recognized reader's own body AND its path
   argument resolves lexically to that reader's own parameter declaration.
   Proven by `a same-NAME parameter raw readFileSync … is rejected, not
silently ignored` (derivation) and `never silently staged four` (staging).
3. **P2 — static marker in the real-load proof.** The AC5 prompt-byte
   provenance previously matched a copied static string. Remediated: markers
   are now derived at runtime from the actual manifest-listed staged
   `agent/system` bytes (`deriveStagedPromptMarkers` over the staged
   manifest), and the test proves the derivation is tamper-sensitive — a
   same-length flip of the staged bytes yields a marker that no longer
   matches, and the marker is asserted to be a substring of the staged file
   read back from disk.
4. **P2 — model-server lifecycle.** The negative-control loopback model
   server previously shut down only on success. Remediated: `finally`-safe
   `modelServer.close()` on every outcome, including setup and assertion
   failures.

## Criterion evidence

| AC                                            | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01c-AC1 mechanical derivation                | PASS    | The clean current pin derives exactly `agent/system/subagent-system.md`, `tool-guidelines.md`, `skill-rules.md`, `working-style.md`; deterministic repeat; a fifth literal read — same-module or in an imported helper — is included automatically (`it` names at `piSubagentPromptClosureDerivation.test.ts:231`, `:248`, `:290`; staging synthetic AC1 fixtures). No hand-maintained allowlist exists in the derivation module.                                                                             |
| T01c-AC2 fail-closed derivation/staging       | PASS    | Dynamic (Date-derived), template-substitution, unresolved-identifier, and computed-`SYSTEM_DIR` paths fail `prompt_closure_unsupported`; repository-root escape and missing modules fail `prompt_closure_invalid`; untracked, dirty, absent, empty, and symlinked derived inputs fail staging (staging `it`s at `piSubagentArtifactStaging.test.ts:768`–`823`).                                                                                                                                               |
| T01c-AC3 deterministic manifest-exact staging | PASS    | Repeat staging produces an identical manifest (staging `:348`); every derived prompt file is a manifest-listed regular file with exact size/SHA-256 staged from the clean pinned commit; the whole `agent/system` tree must be clean (`piSubagentArtifactStaging.ts:530`–`541`).                                                                                                                                                                                                                              |
| T01c-AC4 expanded verification                | PASS    | `it.for(EXPANDED_SUBTREES)` covers `agent/system` (and `shared`, `node_modules`) for missing, tampered, unlisted, path-escape, non-regular, and symlinked entries with bounded categories and no partial trust (`piSubagentArtifactVerifier.test.ts:669`–`795`; gate `:417`–`492`).                                                                                                                                                                                                                           |
| T01c-AC5 real child-spawn closure             | PASS    | The staged artifact alone — with user/global/ancestor/`NODE_PATH` resolution canaries and prompt-location decoys installed at every non-artifact prompt root — drives a real Agent delegation to a real deterministic child model request whose prompt bytes provably come from the staged `agent/system` closure; verify-before-load and verify-after-load both hold; absent `ALFIE_REPO_DIR` is an explicit `describe.skipIf`, never a silent pass (`piSubagentArtifactClosureRealLoad.test.ts:621`–`855`). |
| T01c-AC6 exclusion and fail-close ordering    | PASS    | Deleted, same-length-tampered, and symlink-replaced required prompt files each fail both verification and the desktop gate before any runtime use, with zero model requests, canary/decoy bytes unchanged, and the untouched good artifact still verifying (`piSubagentArtifactClosureRealLoad.test.ts:858`–`1012`); prohibited auth/model/key payload rejection retained (staging `:540`).                                                                                                                   |
| T01c-AC7 review + consultation                | PASS    | Focused suites independently re-executed (below); this review is the required independent review; the consultation is recommended and not yet held.                                                                                                                                                                                                                                                                                                                                                           |

## Focused commands and counts (independently re-run)

Run at `6ccc674b9` with `ALFIE_REPO_DIR` pointing at the clean pinned
checkout, exact Bun vitest invocations, one file per invocation:

```text
bun test scripts/lib/piSubagentPromptClosureDerivation.test.ts        → 21 passed
bun test scripts/lib/piSubagentArtifactStaging.test.ts                → 22 passed
bun test scripts/lib/piSubagentNpmRuntimeClosure.test.ts              → 20 passed
bun test apps/server/src/provider/piSubagentArtifactVerifier.test.ts  → 47 passed
bun test apps/server/src/provider/piSubagentDesktopArtifactGate.test.ts → 30 passed
bun test apps/server/src/provider/piSubagentArtifactClosureRealLoad.test.ts → 3 passed

Total: 143 tests / 6 files, 0 failed
```

Count provenance cross-checked against the candidate source: the verifier
file's 23 static `it(` blocks plus 8 `it.for(EXPANDED_SUBTREES)` blocks × 3
subtrees = 47; the gate file's 14 static `it(` blocks plus table entries
(1 + 3 + 8 + 4) = 30; derivation 21, staging 22, npm closure 20, and
real-load 3 are literal `it(` counts. `143 = 21+22+20+47+30+3`.

## Security invariants assessed

- Fail-close ordering preserved: an invalid artifact rejects
  `managed-subagent-unavailable` before Pi SDK import, extension/global
  discovery, and durable side effects (gate + negative real-load controls).
- Manifest exactness preserved: bidirectional exact-tree matching; missing,
  tampered, unlisted, path-escaping, non-regular, and symlinked entries fail
  with bounded safe diagnostics that never carry absolute host paths or
  filesystem noise.
- Verification stays pure: no runtime Git, network, user Pi directory, or
  partial-trust result.
- Prompt bytes provably come from the exact clean pinned commit: derived
  inputs must be tracked, the `agent/system` subtree must be clean, and
  ambient checkout states are refused.
- No credentials, authentication data, model configuration, key material, or
  user-global extension content enters the artifact; no ambient/user/global/
  ancestor/`NODE_PATH`/working-directory fallback exists for prompt content.
- Derivation itself fails closed on anything it cannot statically prove —
  no silent-omission path remains for dynamic, computed, unresolved, or
  nonrelative-imported read shapes.

## Residual limits

- Per review instructions, the reviewer did **not** run the full repository
  test suite, `bun fmt`, `bun lint`, or `bun typecheck`; heavyweight checks
  were out of scope for this review.
- The real-load legs require `ALFIE_REPO_DIR`; without it they are an
  explicit recorded skip (by design, AC5).
- This review grants no final acceptance and makes no Decision-0010 verdict;
  acceptance authority belongs to the one remaining final-acceptance
  consultation.

## Recommendation

Proceed to exactly one Ticket 01c final-acceptance consultation. No findings
are attached; no remediation is required before that consultation.
