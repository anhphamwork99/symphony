# Ticket 14 Explicit Resume — Independent Feature Review

## Candidate identity / scope

Candidate reviewed: current working-tree Ticket 14 candidate in `/Users/anhpham99/symphony` on August 19, 2026.

Authoritative records reviewed in full:

- [PROJECT.md](/Users/anhpham99/symphony/.planning/synara-pi-durable-subagents/PROJECT.md:1)
- [spec.md](/Users/anhpham99/symphony/.planning/synara-pi-durable-subagents/spec.md:1)
- [14-explicit-resume.md](/Users/anhpham99/symphony/.planning/synara-pi-durable-subagents/issues/14-explicit-resume.md:1)
- [0001-testing-strategy-governance.md](/Users/anhpham99/symphony/.planning/synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md:1)

Changed source/tests reviewed:

- Contracts: [packages/contracts/src/orchestration.ts](/Users/anhpham99/symphony/packages/contracts/src/orchestration.ts:1497), [packages/contracts/src/provider.ts](/Users/anhpham99/symphony/packages/contracts/src/provider.ts:173)
- Server orchestration/provider/persistence: [decider.ts](/Users/anhpham99/symphony/apps/server/src/orchestration/decider.ts:1879), [ProviderCommandReactor.ts](/Users/anhpham99/symphony/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:2893), [ProviderService.ts](/Users/anhpham99/symphony/apps/server/src/provider/Layers/ProviderService.ts:2338), [PiAdapter.ts](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:3828), [piSubagentAdmissionCoordinator.ts](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentAdmissionCoordinator.ts:304), [piSubagentResumeCoordinator.ts](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.ts:1), [PiSubagentExecutionRepository.ts](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:3038), [104_PiSubagentResumeDelegation.ts](/Users/anhpham99/symphony/apps/server/src/persistence/Migrations/104_PiSubagentResumeDelegation.ts:1)
- Web/UI/tests: [ChatView.tsx](/Users/anhpham99/symphony/apps/web/src/components/ChatView.tsx:2929), [ChatView.browser.tsx](/Users/anhpham99/symphony/apps/web/src/components/ChatView.browser.tsx:3861), [PiSubagentExecutionCardStrip.tsx](/Users/anhpham99/symphony/apps/web/src/components/chat/PiSubagentExecutionCardStrip.tsx:129), [storeEventReducer.ts](/Users/anhpham99/symphony/apps/web/src/storeEventReducer.ts:1645), [piSubagentExecutionCardStore.test.ts](/Users/anhpham99/symphony/apps/web/src/piSubagentExecutionCardStore.test.ts:120)
- Ticket-14 tests: [piSubagentResumeCoordinator.test.ts](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:191), [piSubagentResumeAcceptance.test.ts](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeAcceptance.test.ts:348)

## AC matrix

| AC      | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T14-AC1 | PASS    | Resume path commits new attempt/generation before launch in [piSubagentResumeCoordinator.ts:238-337](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.ts:238) and [PiSubagentExecutionRepository.ts:3122-3156](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:3122); idempotent replay proven in [piSubagentResumeCoordinator.test.ts:191-263](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:191) and real-Pi path [piSubagentResumeAcceptance.test.ts:536-582](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeAcceptance.test.ts:536).                                                                                                                                                                                                                          |
| T14-AC2 | PASS    | Generation/attempt fencing in [PiSubagentExecutionRepository.ts:3099-3120](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:3099) plus stale orphan guard [PiSubagentExecutionRepository.ts:2924-2945](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:2924); late lifecycle/terminal/cancel/completion ignored and counted in [piSubagentResumeCoordinator.test.ts:271-349](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:271).                                                                                                                                                                                                                                                                                                                                       |
| T14-AC3 | PASS    | Explicit command added in [orchestration.ts:1497-1513](/Users/anhpham99/symphony/packages/contracts/src/orchestration.ts:1497); decider emits only explicit event in [decider.ts:1879-1904](/Users/anhpham99/symphony/apps/server/src/orchestration/decider.ts:1879); no state projection on request in [storeEventReducer.ts:1645-1650](/Users/anhpham99/symphony/apps/web/src/storeEventReducer.ts:1645); no implicit dispatch proven by [piSubagentResumeCoordinator.test.ts:599-697](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:599) and browser test [ChatView.browser.tsx:3861-3897](/Users/anhpham99/symphony/apps/web/src/components/ChatView.browser.tsx:3861).                                                                                                                                                                                       |
| T14-AC4 | PASS    | Shared gate function reused by resume in [piSubagentAdmissionCoordinator.ts:304-553](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentAdmissionCoordinator.ts:304) and [piSubagentResumeCoordinator.ts:194-236](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.ts:194); service/runtime gating in [ProviderService.ts:2344-2372](/Users/anhpham99/symphony/apps/server/src/provider/Layers/ProviderService.ts:2344) and [ProviderCommandReactor.ts:2893-2932](/Users/anhpham99/symphony/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:2893); denial/no-child cases covered in [piSubagentResumeCoordinator.test.ts:353-454](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:353) and [506-568](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:506).            |
| T14-AC5 | PASS    | Resume updates aggregate/card while preserving journal evidence in [PiSubagentExecutionRepository.ts:3137-3156](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:3137) and [getExecutionCard mapping at 123-140](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:123); UI renders orphan guidance/new queued-running state in [PiSubagentExecutionCardStrip.tsx:132-203](/Users/anhpham99/symphony/apps/web/src/components/chat/PiSubagentExecutionCardStrip.tsx:132); proven in [piSubagentResumeCoordinator.test.ts:457-483](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:457).                                                                                                                                                                                     |
| T14-AC6 | PASS    | Only explicit click dispatches resume in [ChatView.tsx:2997-3024](/Users/anhpham99/symphony/apps/web/src/components/ChatView.tsx:2997) and button affordance is orphaned-only in [PiSubagentExecutionCardStrip.tsx:129-149](/Users/anhpham99/symphony/apps/web/src/components/chat/PiSubagentExecutionCardStrip.tsx:129); request events project nothing in [storeEventReducer.ts:1645-1650](/Users/anhpham99/symphony/apps/web/src/storeEventReducer.ts:1645) and [piSubagentExecutionCardStore.test.ts:120-146](/Users/anhpham99/symphony/apps/web/src/piSubagentExecutionCardStore.test.ts:120); browser and real-Pi explicit-only proofs at [ChatView.browser.tsx:3861-3897](/Users/anhpham99/symphony/apps/web/src/components/ChatView.browser.tsx:3861) and [piSubagentResumeAcceptance.test.ts:499-582](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeAcceptance.test.ts:499). |

## Stale fencing

The fencing model is coherent. `recordResumeEvent` keys idempotency to the source attempt/generation and refuses mutation if the aggregate already advanced or is no longer `orphaned` ([PiSubagentExecutionRepository.ts:3060-3119](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:3060)). Late lifecycle, terminal, cancel, and completion-delivery work from the superseded attempt are explicitly exercised in [piSubagentResumeCoordinator.test.ts:271-349](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:271).

## No implicit trigger

I found one production dispatch site for resume: the user click handler in [ChatView.tsx:2997-3024](/Users/anhpham99/symphony/apps/web/src/components/ChatView.tsx:2997). The decider/reactor/provider path only handles the explicit command/event ([decider.ts:1879-1904](/Users/anhpham99/symphony/apps/server/src/orchestration/decider.ts:1879), [ProviderCommandReactor.ts:2893-2932](/Users/anhpham99/symphony/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:2893)). The reducer intentionally ignores `resume-requested` until durable execution truth arrives ([storeEventReducer.ts:1645-1650](/Users/anhpham99/symphony/apps/web/src/storeEventReducer.ts:1645)). The browser test also proves snapshot hydration alone dispatches nothing ([ChatView.browser.tsx:3861-3869](/Users/anhpham99/symphony/apps/web/src/components/ChatView.browser.tsx:3861)).

## Auth / admission parity

This is correctly centralized. Resume reuses the same server-minted provider/thread/project/active-turn/approval/authority/quota gate chain as spawn via [runAdmissionAuthorizationGates](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentAdmissionCoordinator.ts:334). Denials return without mutating the execution row or launching a child, and the negative tests cover wrong thread, missing authority, quota saturation, non-orphaned, and not-found cases ([piSubagentResumeCoordinator.test.ts:353-568](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.test.ts:353)).

## Migration / replay correctness

The persistence shape is aligned with Ticket 14 intent: existing `prompt` remains the task field, migration 104 adds `delegation_context`, `delegation_link_references`, `delegation_expected_outcome`, and `resolved_model` ([104_PiSubagentResumeDelegation.ts:12-18](/Users/anhpham99/symphony/apps/server/src/persistence/Migrations/104_PiSubagentResumeDelegation.ts:12)); repository reads/writes those columns ([PiSubagentExecutionRepository.ts:123-150](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:123), [455-500](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:455)); spawn persists resolved provider/model ([PiAdapter.ts:3831-3868](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:3831)); resume launcher replays stored fields and uses explicit placeholder text for legacy nulls ([PiAdapter.ts:4093-4179](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:4093)). Same-provider model replay is bound through the session registry ([PiAdapter.ts:4149-4171](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:4149)).

## UI explicit-action path

The card strip only offers resume for `orphaned` cards ([PiSubagentExecutionCardStrip.tsx:129-149](/Users/anhpham99/symphony/apps/web/src/components/chat/PiSubagentExecutionCardStrip.tsx:129)); the browser test verifies no pre-click dispatch and a single explicit `thread.pi-subagent-execution.resume` command on click ([ChatView.browser.tsx:3861-3897](/Users/anhpham99/symphony/apps/web/src/components/ChatView.browser.tsx:3861)). The store keeps rendering the orphaned card until a durable execution update arrives ([piSubagentExecutionCardStore.test.ts:120-146](/Users/anhpham99/symphony/apps/web/src/piSubagentExecutionCardStore.test.ts:120)).

## Failure / diagnostic surfaces

Failure surfaces are generally honest and fail-closed:

- No provider session: [ProviderCommandReactor.ts:2904-2915](/Users/anhpham99/symphony/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:2904)
- Inactive/unsupported runtime: [ProviderService.ts:2353-2372](/Users/anhpham99/symphony/apps/server/src/provider/Layers/ProviderService.ts:2353)
- Managed-disabled / missing launcher / snapshot unavailable: [PiAdapter.ts:4585-4627](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:4585)
- Persistence failure degrades control health: [piSubagentResumeCoordinator.ts:256-275](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.ts:256)
- Resume settlement is observable via runtime warning and structured raw payload: [PiAdapter.ts:4688-4725](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:4688)
- Resumed child uses the same managed observation binding as spawn: [PiAdapter.ts:3352-3372](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:3352), [3990-4018](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:3990), [4116-4142](/Users/anhpham99/symphony/apps/server/src/provider/Layers/PiAdapter.ts:4116)

## Verification assessment

The cited verification set is substantial and mostly credible: focused coordinator tests, browser explicit-resume test, and real-Pi acceptance all match the intended boundaries. I did not rerun commands in this read-only review environment. One important caveat: the existing tests encode the same reserved sequence-band mistake as the implementation, so the green runs do not protect against that defect. Migration 104 also lacks a targeted assertion of its own new columns/legacy fallback behavior.

## Findings

### BLOCKING

1. Resume still uses watchdog-reserved sequence band `70`, violating the accepted project gate and creating a real journal collision with Ticket 15 watchdog stage records. Evidence: project gate at [PROJECT.md:102-105](/Users/anhpham99/symphony/.planning/synara-pi-durable-subagents/PROJECT.md:102) and [PROJECT.md:169-170](/Users/anhpham99/symphony/.planning/synara-pi-durable-subagents/PROJECT.md:169); resume constant at [piSubagentResumeCoordinator.ts:38-39](/Users/anhpham99/symphony/apps/server/src/provider/piSubagentResumeCoordinator.ts:38); repository contract/docs at [PiSubagentExecutionRepository.ts:550-562](/Users/anhpham99/symphony/apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts:550), [605-628](/Users/anhpham99/symphony/apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts:605), and implementation at [PiSubagentExecutionRepository.ts:3122-3133](/Users/anhpham99/symphony/apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts:3122). Impact: after a resumed attempt, watchdog stage `70` (`escalation started`) and the resume row occupy the same `(execution_id, attempt_id, generation, sequence)` identity, so one will mask or reject the other. That is a correctness and diagnosability break on the resumed-attempt control path. Remediation: move Ticket 14 resume to a disjoint sequence band, update repository docs/tests, and add a regression test proving watchdog stage records still persist on a resumed attempt.

### NON-BLOCKING

1. Migration 104 lacks direct migration-level verification of the new columns and legacy-null behavior. Current migration tests only prove lineage reaches `104` ([Migrations.test.ts:303-309](/Users/anhpham99/symphony/apps/server/src/persistence/Migrations.test.ts:303), [MigrationLineageReconciliation.test.ts:145-150](/Users/anhpham99/symphony/apps/server/src/persistence/Migrations/MigrationLineageReconciliation.test.ts:145)) and the fresh-schema test does not assert the new `pi_subagent_executions` columns ([MigrationLineageReconciliation.test.ts:84-92](/Users/anhpham99/symphony/apps/server/src/persistence/Migrations/MigrationLineageReconciliation.test.ts:84)). Impact: a future edit could regress the additive migration or the “legacy row stays null, launcher uses explicit placeholders” contract without a focused failure. Remediation: add a dedicated migration 104 test that seeds a pre-104 `pi_subagent_executions` row, runs migration 104, asserts the four fields exist, remain null for legacy rows, and round-trip through repository decode.

## Final verdict

NEEDS REMEDIATION

REVIEW_VERDICT: NEEDS_REMEDIATION

---

# Ticket 14 Explicit Resume — Remediation Re-review

## Finding 1 — BLOCKING: resume/watchdog sequence collision

**OPEN**

Durable resume journaling is correctly moved to `80` in the coordinator and repository, and the regression test does prove stage `70` can still persist on the resumed attempt:

- `apps/server/src/provider/piSubagentResumeCoordinator.ts` sets `PI_SUBAGENT_RESUME_SEQUENCE = 80`.
- `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts` documents resume band `80`, disjoint from watchdog `70–74`.
- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts` implements the durable row at `80`.
- `apps/server/src/provider/piSubagentResumeCoordinator.test.ts` proves watchdog band `70` still records after resume.
- `apps/server/src/provider/piSubagentWatchdogEscalation.ts` remains the authoritative watchdog `70–74` source, consistent with the project gate in `PROJECT.md`.

However, the remediation is not complete “across coordinator/repository/docs” because the repository’s post-commit lifecycle notification still reports resume as `70`:

- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts` comment still says `resume=70`.
- The `recordResumeEvent` wrapper emits `journalSequence: 70`.

That no longer collides with durable watchdog rows, but it leaves a stale cross-layer contract and can mislabel downstream consumers that rely on `journalSequence` for deterministic ordering/correlation. The original blocking finding is therefore not fully closed.

## Finding 2 — NON-BLOCKING: migration 104 verification

**CLOSED**

The dedicated migration test now exists and covers the missing verification surface:

- Runs through migration `103`, seeds a pre-104 row, then runs `104`.
- Verifies all four added columns exist.
- Verifies legacy `NULL` values decode honestly through the repository.
- Checks migration idempotency.

## Verification assessment

Focused regression for watchdog-after-resume and the dedicated migration-104 test are present. The current tests did not yet cover the stale `journalSequence=70` notification path, which is why the remaining defect escaped.

**Final verdict: NEEDS REMEDIATION**

REVIEW_VERDICT: NEEDS_REMEDIATION

---

# Ticket 14 Explicit Resume — Final Remediation Re-review

## Finding 1 — Resume/watchdog sequence collision

**CLOSED**

- Durable resume row is on band `80`, not `70`: `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts`.
- Post-commit lifecycle notification wrapper now also emits `80`.
- Exported resume constant is `80` and reserves `70–74` for watchdog.
- Watchdog band remains `70–74`.
- The AC1 test captures the lifecycle listener and asserts exactly one resume notification at `PI_SUBAGENT_RESUME_SEQUENCE`.
- The same test proves watchdog stage `70` still persists on the resumed attempt.

Assessment: the stale `journalSequence=70` notification defect is fixed, and coordinator/repository/test/watchdog comments and constants are internally consistent around resume `80` versus watchdog `70–74`.

## Finding 2 — Migration 104 verification gap

**CLOSED**

- A dedicated migration test migrates through `103`, seeds a legacy row, runs `104`, asserts all four columns, verifies legacy `NULL` decode through the repository, and checks idempotency.

Assessment: the prior migration finding remains closed.

## Verification assessment

Source inspection satisfies the narrow remediation criteria. Main-session execution evidence on the remediated candidate:

- focused resume + migration tests: 15/15 passed;
- real-Pi resume + watchdog wallclock: 3/3 passed;
- server typecheck: passed.

## Final verdict

PASS

REVIEW_VERDICT: PASS
