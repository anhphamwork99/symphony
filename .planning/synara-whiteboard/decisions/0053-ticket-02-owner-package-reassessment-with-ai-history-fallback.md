# Decision 0053: Owner-authorized Ticket 02 package/public-API reassessment with AI-history fallback

Status: Binding — owner-authorized bounded reassessment; no implementation activated
Date: 2026-08-27
Trigger: Human-owner boundary decision after the Decision 0052 timing remediation failed
Supersedes: None as historical records; conditionally supersedes the specified product/history clauses below only if the fallback activates
Reopens Decisions 0047, 0048, or 0050: No

## Owner decision

The human owner chose:

> Chọn 1, nếu không có thì làm theo hướng 4

The binding interpretation is:

1. First research/reassess Excalidraw versions and their documented public APIs for a supported host-owned single-route history-containment boundary.
2. Do not upgrade the package, change the lockfile, or begin implementation while that research gate is open.
3. If the research finds no supported public boundary, direction 4 from Decision 0052 is pre-authorized: change the mixed human/AI history product model to native Excalidraw Undo/Redo for human edits plus dedicated Synara `Undo AI batch` and `Redo AI batch` actions.

This record captures owner authority and ordering. It does not claim that the research has passed or failed, and it does not activate either implementation path.

## Question

How should Ticket 02 proceed after Decision 0052 exhausted the one authorized public timing probe, while preserving the historical decisions and making the owner's ordered package-first choice and fallback product direction explicit?

## Governing references

### Authoritative

1. `.planning/synara-whiteboard/PROJECT.md`
2. `.planning/synara-whiteboard/issues/02-prove-ai-batch-undo-redo.md`
3. `.planning/synara-whiteboard/PRODUCT-CONTRACT.md`
4. `.planning/synara-whiteboard/spec.md`
5. `.planning/synara-whiteboard/decisions/0051-ticket-02-exact-batch-history-direction.md`
6. `.planning/synara-whiteboard/decisions/0052-ticket-02-native-history-timing-probe.md`
7. `.planning/synara-whiteboard/decisions/0048-ticket-01-excalidraw-feasibility-boundary.md`
8. `.planning/synara-whiteboard/decisions/0047-testing-strategy-governance-reassessment.md`

### Owner authority

The current-session owner message, recorded verbatim above, is the authority for the ordered reassessment and conditional fallback. No agent may choose a different package, integration, or product direction while this record governs.

## Current evidence boundary

Decision 0052 remains the governing historical account of the current candidate:

- the exact `@excalidraw/excalidraw@0.18.1` candidate failed AC4 and AC7 after the bounded public post-commit clear probe;
- the public timing remediation is exhausted;
- broad Ticket 02 work remains stopped;
- no private API, undocumented action key, DOM/CSS suppression, package mutation, fork, remount, or version change was attempted.

Those facts are retained. They are not evidence that every other Excalidraw version or documented public API is impossible. This decision therefore opens only the bounded research/reassessment phase and makes no claim about its result.

## Ordered research gate

The active phase is **version/public-API research**, not package upgrade and not broad Ticket 02 implementation.

Research may compare supported Excalidraw releases and documented public APIs, including their published types and official documentation, to determine whether at least one candidate can support the accepted history boundary. Research must not modify the package manifest, lockfile, protected Agentation work, or runtime source.

### Supported-boundary pass criteria

A candidate is research-positive only if its documented/public boundary provides a credible path to prove all of the following in the real embedded product boundary:

1. Synara can own one effective user-visible history route for human edits and AI batches.
2. Native toolbar and keyboard Undo/Redo can be made inert or routed through Synara without any transient enabled or invokable window after a human mutation.
3. Human mutation capture remains reliable after containment and grouping.
4. Progressive AI updates can remain non-user-visible intermediate history, while completion, acknowledged interruption, and failed partial work can be represented as exactly one AI-batch event.
5. Undo and Redo can restore the required scene and image/file-reference semantics through supported APIs.
6. The 20-event mixed human/AI session-history and reset requirements remain implementable.
7. The proof can use only supported/documented APIs and ordinary host event handling, without private internals, undocumented action keys, native-stack inspection, DOM/CSS suppression, monkey-patching, package mutation, remounting, or a fork.

A research-positive candidate is only a viable boundary finding. It is not a package-upgrade authorization, an implementation approval, or a Ticket 02 acceptance. Any subsequent candidate must still pass the applicable real-Chromium gate before broad work.

### Research-fail criteria

The research gate fails if no supported version/public-API combination meets the criteria above, or if every candidate requires one of the prohibited techniques or cannot establish host-owned single-route containment without a transient native route. A timing variant, arbitrary delay, repeated probe, or weakened no-transient requirement is not a research pass.

## No-upgrade-before-evidence rule

Until the research gate has a recorded result:

- do not change `@excalidraw/excalidraw` or any other package version;
- do not change `bun.lock`;
- do not install a candidate as an implementation change;
- do not alter runtime source, adapter behavior, production navigation, or broad Ticket 02 code;
- do not claim AC4, AC7, or the Ticket 02 gate has passed;
- do not treat a documented API inventory as browser acceptance evidence.

The current `0.18.1` failure remains a failure of that measured candidate. A different candidate, if found, requires its own exact versioned evidence and gate.

## Conditional fallback direction 4

If and only if the research gate fails, direction 4 is pre-authorized for the next product-boundary update. Its exact semantics are:

1. **Human edits:** Excalidraw's native Undo/Redo route remains the user-visible route for human edits, including the package-native toolbar and the package-native platform keyboard behavior supported by that version.
2. **AI batches:** Synara exposes dedicated `Undo AI batch` and `Redo AI batch` actions. These actions operate on Synara-owned AI-batch snapshots and do not invoke or pretend to be the native human Undo/Redo route.
3. **AI exactness remains required:** one completed, acknowledged interrupted, or failed-partial AI batch is one AI-batch event; progressive AI updates do not become individual user-visible AI events; AI Undo/Redo restores the required pre/post scene and image/file-reference semantics.
4. **Separate route semantics are explicit:** the fallback does not claim that human native history and Synara AI-batch history are one coherent stack or one cursor. Their interaction, labels, focus behavior, branch invalidation, and user-facing history presentation must be specified in the fallback implementation contract before source work begins.
5. **No silent weakening:** the fallback changes the mixed human/AI history model; it does not authorize private APIs, undocumented keys, native-stack inspection, DOM/CSS suppression, monkey-patching, package mutation, remount restore, or a fork.

Pre-authorization means the owner has already chosen this product direction if the research condition is met. It does not mean that fallback implementation starts automatically from this record. The failed research result, revised product/history contract, and a new bounded implementation route must be recorded before source implementation.

## Conditional supersession of Decisions 0051 and 0052

Decisions 0051 and 0052 remain preserved historical governing records. They are not rewritten and remain binding for the current single-route direction until the fallback condition is formally recorded as met. If the research gate fails and fallback direction 4 is activated, only these specific clauses are conditionally superseded:

| Historical clause | Conditional change if fallback activates |
| --- | --- |
| Decision 0051 D1: Synara owns the complete user-visible human-plus-AI Undo/Redo history; native history is containment-only; standard human shortcuts dispatch through Synara | Superseded only for the human portion: native Excalidraw history owns human Undo/Redo, while Synara owns dedicated AI-batch Undo/Redo. |
| Decision 0051 D2 and its sole-effective-route/no-transient native-control requirements | Superseded only to the extent that native controls and native keyboard are intentionally the human route. The prohibition on private, undocumented, DOM/CSS, monkey-patched, forked, or package-mutating integration remains. |
| Decision 0051 D6's conversion of representative human mutations into Synara events for one shared route | Superseded for human Undo/Redo ownership. Human behavior is tested as native behavior; AI-batch behavior remains Synara-owned. |
| Decision 0051 D8 step 1's mandatory native-route containment before the mixed history matrix | Superseded by a new fallback-specific proof order: native human history and dedicated Synara AI-batch actions are each proved without claiming a shared stack. |
| Decision 0051's product/history requirement for one ordered 20-event session history shared by human actions and AI batches, including the mixed-history coordinator array/cursor rules | Conditionally superseded. A separate human-native/AI-batch history model must replace it before implementation; no 20-event shared-stack claim may be made during research. |
| Ticket 02 AC4's requirement that toolbar Undo/Redo and `Cmd/Ctrl+Z` use one coherent history route | Conditionally superseded and must be replaced by fallback-specific acceptance criteria distinguishing the native human route from dedicated AI-batch actions. |
| Ticket 02 AC6's requirement that human and AI events share one bounded 20-event session history | Conditionally superseded and must be replaced by explicit fallback interaction and retention criteria before implementation. |

The following remain unchanged unless a later owner decision says otherwise:

- exact AI batch event semantics and recovery obligations;
- no intermediate progressive AI history event;
- snapshot, asset-reference, semantic-restore, no-op, and presentation-state safeguards for AI-batch recovery;
- deterministic AI-batch Redo invalidation rules once specified for the separate AI route;
- the prohibition on durable history after restart and the applicable reset/lifecycle requirements;
- Decisions 0047, 0048, and 0050;
- Decision 0052's evidence that the 0.18.1 timing remediation was exhausted and its prohibition on repeating that probe.

No conditional supersession is active merely because this record exists. Activation requires the research-fail result to be recorded and routing to be updated.

## Downstream authorization and routing

Effective immediately, one bounded worker/research phase is authorized to investigate versions and documented public APIs under the criteria above. Broad Ticket 02 implementation, package upgrade, and fallback source work are not authorized by this record.

When the research result is known:

1. **Research pass:** record the exact candidate and evidence, keep Decision 0051's product model, and obtain a new implementation-boundary route before changing the package or source.
2. **Research fail:** record that no supported public boundary exists, activate the pre-authorized fallback semantics above, revise the Ticket 02 product/history acceptance language, and then authorize only the newly bounded fallback implementation.

Until one of those outcomes is recorded, Project routing must identify Ticket 02 as `researching-package-boundary`, with broad work prohibited.
