# Decision 0015 — Desktop Pi model-switch settings isolation reassessment

- Date: 2026-08-23
- Project: `synara-pi-subagent-handshake-first`
- Outcome: Binding Reassessment
- Gate: PASS
- Supersedes: the rejection verdict from the single final-acceptance consultation for candidate `0f1f130c1`
- Accepted candidate: `0f1f130c1` with remediation `b33605a89`

## Question

Does remediation commit `b33605a89`, layered on production candidate
`0f1f130c1`, close the two sole blockers from the prior final-acceptance
rejection?

## Governing references

- `.planning/synara-pi-subagent-handshake-first/PROJECT.md`
- `.planning/synara-pi-subagent-handshake-first/spec.md`
- The prior final-acceptance rejection for candidate `0f1f130c1`
- Production commit `0f1f130c1`
- Remediation commit `b33605a89`

## Evidence

- Direct inspection confirms that the in-memory mock records
  `{ provider, modelId }`, while the file-backed mock records
  `{ provider, modelId, settingsPath }`; both collection types match their
  writes and consumers.
- The malformed indentation in the SettingsManager mock and real-Pi `waitFor`
  block is corrected.
- `git diff --check` passed.
- Focused Vitest passed 117/117 tests across four files.
- The real Pi SDK acceptance test passed and observed second-turn traffic on
  the newly selected model.
- The real Pi SDK acceptance test also proved that no managed-artifact
  `settings.json` was created, the artifact tree stayed byte-identical, and
  artifact verification remained valid.
- The installed application started successfully, its managed artifact has no
  `agent/settings.json`, and no new `unlisted_entry` or quarantine diagnostic
  appeared.

## Binding reassessment

The material new evidence closes both sole blockers. Supersede the prior
rejection verdict with final acceptance. Preserve the prior consultation as
historical evidence, but its blocking effect is discharged.

Desktop-managed Pi sessions may use one session-scoped
`SettingsManager.inMemory()` while retaining explicit user auth/model inputs,
release-controlled extension isolation, and fail-closed artifact verification.
The managed desktop settings manager intentionally does not load user or
project settings. Non-desktop Pi behavior remains unchanged.

## Rejected alternatives

- Retaining rejection because heavyweight checks were not rerun: rejected.
  Project rules prohibit running `bun fmt`, `bun lint`, and `bun typecheck`
  without explicit user authorization, and direct inspection plus focused
  evidence resolves the exact test-only blockers.
- Reopening the production runtime design: rejected. The remediation is
  test-only and no new evidence contradicts the accepted design.
- Treating the reassessment as a second final consultation: rejected. It is the
  required reassessment of the prior rejection.

## Residual uncertainty

No material acceptance uncertainty remains. Heavyweight workspace checks were
not rerun, so no claim is made that they were freshly executed.

## Failure and reopening conditions

Reopen only for contrary reproducible evidence, including:

- a type failure in the corrected mocks;
- formatting drift in the committed remediation;
- focused or real-Pi regression;
- creation of managed-artifact `agent/settings.json`;
- artifact verification failure; or
- evidence that `b33605a89` is not layered on `0f1f130c1` in the shipped
  candidate.

If either accepted commit is removed or materially altered, this acceptance
basis must be reassessed.
