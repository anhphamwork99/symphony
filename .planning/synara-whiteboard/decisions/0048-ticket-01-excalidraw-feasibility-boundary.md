# Decision 0048: Bound the Ticket 01 Excalidraw feasibility gate

Status: Accepted
Date: 2026-08-26
Trigger: Material technical decision verification/escalation
Supersedes: None

## Question

Before implementation of Ticket 01, what exact package pin, integration boundary, browser-harness scope, semantic round-trip proof, selection-settlement policy, performance-reporting protocol, Undo responsibility, dot-grid scope, and diagnostic behavior govern the isolated Excalidraw feasibility gate?

## Governing references

### Authoritative

- `../PROJECT.md` — Project Home, routing, and Ticket 01 frontier.
- `../issues/01-prove-excalidraw-integration-boundary.md` — Ticket 01 acceptance criteria and owner-approved test seams.
- `../spec.md` — Excalidraw boundary, performance policy, implementation contract, and non-goals.
- `../PRODUCT-CONTRACT.md` — owner-confirmed outcomes and first-release boundaries.
- `0001-embed-excalidraw-behind-synara-integration.md` — official package behind a Synara-owned boundary, no fork.
- `0047-testing-strategy-governance-reassessment.md` — actual browser, official utility, failure-pairing, and measurement requirements.

### Supporting

- `../RESEARCH.md` — researched Excalidraw 0.18.1 API surface and known history/cancellation limitations.
- npm registry evidence for package availability and React 19 peer compatibility.
- Designer solution contract recommending the exact pin, lazy leaf isolation, semantic-fidelity comparison, and Chromium-based proof.

## Evidence

- `@excalidraw/excalidraw` 0.18.1 is the researched package release and exposes the public APIs needed by this feasibility work.
- The package is ESM-only, so compatibility must be proven through Synara's actual browser build and runtime rather than inferred from a unit-test transform.
- `updateScene` supplies the public imperative update boundary needed for AC3.
- Selected IDs and viewport state are observable through the package's public application state.
- `viewModeEnabled` is the available coarse host-controlled lock candidate whose mutation and navigation behavior must be verified in a real browser.
- Official restore, serialization, and export utilities exist, but their normalization behavior makes semantic comparison more appropriate than raw JSON equality.
- No documented public Excalidraw transaction API independently guarantees that an arbitrary progressive AI batch becomes exactly one native history entry.
- Ticket 01 does not authorize production RightDock, persistence, composer, agent, dot-grid, or session-history implementation.
- Unrelated Agentation working-tree changes in `apps/web/package.json`, `apps/web/src/main.tsx`, and `bun.lock` are excluded from Ticket 01 evidence and must be preserved.

## Settled direction

### 1. Version pin and update behavior

Ticket 01 shall depend on exactly:

```json
"@excalidraw/excalidraw": "0.18.1"
```

A caret, tilde, wildcard, npm tag, or other floating range is not permitted. The lockfile must resolve the same release. Ticket 01 evidence must record the exact package version and resolved package identity.

A future update is deliberate: change the exact version, rerun all Ticket 01 browser, fidelity, and measurement evidence, update the baseline report, and review public-API or behavioral differences at the adapter boundary. A new Decision Record is required only if the update materially changes the accepted boundary, requires undocumented internals or a fork, weakens semantic fidelity or browser evidence, or invalidates binding product behavior.

### 2. Adapter, lazy loading, and public-API isolation

Create one Synara-owned adapter leaf as the only runtime module permitted to understand Excalidraw component/API types and package-specific scene behavior.

The adapter must:

- be lazy-loaded so normal web application startup does not eagerly load Excalidraw;
- expose a small Synara-owned interface for Ticket 01 behavior;
- own package-specific conversion and normalization;
- expose imperative update, hydration, serialization/export, lock, selection, and viewport operations through that interface;
- avoid leaking Excalidraw element or app-state types into future canonical persistence, composer, agent, or shared-contract surfaces;
- consume documented public package APIs rather than internal source paths or undocumented mutation;
- apply ordered updates to the existing mounted editor instance rather than replacing `initialData` or remounting it.

Direct package imports are allowed only in the adapter, isolated harness support, and package-specific tests where necessary. The package's required styles and browser assets must load through the same lazy boundary or another explicitly isolated package-integration seam; they must not force an eager application-level import.

### 3. Production-compatible adapter versus isolated harness

Ticket 01 may add a production-quality reusable adapter leaf, but it must remain inert outside its isolated browser harness.

The harness must:

- use Synara's actual web toolchain, React runtime, CSS processing, asset loading, and production-compatible browser build;
- run in actual Chromium;
- mount the official package through the Synara adapter;
- support deterministic fixtures and observable remount, selection, viewport, mutation, navigation, serialization, export, and timing evidence;
- be test-only or otherwise inaccessible from normal user navigation.

Ticket 01 must not register a Whiteboard RightDock kind; modify normal startup to mount the editor; add a production route, launcher, tab, or dock; implement native Whiteboard or File-canvas persistence; create composer chips; add agent operations, Take Over, cancellation, or generation fencing; implement production session history; or implement the two-mounted-canvas product lifecycle.

"Production-compatible" means the adapter and official package successfully build and execute under Synara's real browser environment. It does not mean installing a partial Whiteboard product into production navigation.

### 4. AC2 official utility and semantic-fidelity boundary

AC2 must exercise the official Excalidraw boundary, not a mocked editor or Synara-only JSON transformer.

The representative fixture must contain at minimum:

- an element binding with reciprocal relationship evidence;
- bound text and its container relationship;
- a group with multiple members;
- a frame and framed children;
- an image element plus corresponding file/image data;
- non-empty custom data;
- stable identities and relevant ordering evidence needed to identify relationships.

The proof sequence is:

1. decode/import the representative fixture;
2. restore or normalize it using official Excalidraw utilities;
3. hydrate the real embedded editor;
4. obtain normalized current scene state through the adapter;
5. serialize it into a persistence-shaped `.excalidraw` representation;
6. parse and restore that representation again;
7. hydrate the restored representation;
8. export editable `.excalidraw` and rendered output through official utilities where browser semantics are material;
9. compare a canonical semantic projection before and after the round trip.

The semantic projection must verify preservation of element identities where supported, element kinds and meaningful geometry, text/container relationships, connector endpoint and binding relationships, reciprocal `boundElements`, group membership, frame membership, image/file references and availability, custom data, and ordering needed to retain the intended scene.

Raw JSON or byte equality is not the acceptance criterion because official normalization may add defaults, remove transient fields, or normalize representation. Conversely, successful parsing or visual resemblance alone is insufficient. PNG/SVG evidence must use official export utilities in an actual browser; mocked canvas/export evidence cannot satisfy the boundary.

### 5. Selection settlement and viewport policy

Selection settlement is an adapter policy input rather than a scattered literal. The harness must configure the delay and observe:

- the raw package change sequence;
- the resulting settled selected-ID sequence;
- suppression of duplicate notifications when selected identity does not change;
- time from the final relevant package event to settled publication;
- selection, deselection, and rapid selection replacement.

Ticket 01 must exercise at least a zero-delay/control configuration and one or more non-zero candidate configurations sufficient to expose whether package events require coalescing. It reports observations rather than selecting a final production delay. No final product delay, threshold, or debounce constant is approved here.

Viewport evidence must capture and restore package-supported viewport state and verify meaningful scroll/zoom preservation after imperative updates. Selection observation must not require scene serialization or composer publication. Failure to observe stable selection or restore viewport through supported public APIs is a blocking incompatibility and must not be concealed behind private APIs.

### 6. AC6 measurement and report protocol

AC6 is a feasibility baseline, not a product latency, memory, board-size, or image-size budget.

Measurements must use the production-compatible browser build and record:

- exact Excalidraw version;
- relevant Synara revision;
- browser name/version;
- operating system and architecture;
- build mode;
- fixture category and size characteristics;
- sample and warm-up method;
- timer or memory instrumentation;
- whether garbage collection could be controlled or merely observed;
- known limitations.

The report must cover empty-scene hydration; representative normal-scene hydration; image-bearing-scene hydration; persistence-shaped serialization; ordered progressive updates through `updateScene`; non-remount proof; viewport retention; one visible and one hidden retained canvas in the harness; memory observations for the hidden retained canvas and repeated visibility/mount cycles; and image-bearing export/serialization behavior.

For repeatable latency operations, retain raw samples and summary statistics such as median and upper-percentile observations. Memory evidence must disclose browser-instrumentation limitations and must not present coarse process-wide readings as precise per-canvas retained size.

Pass/fail interpretation:

- **Pass:** all AC scenarios use the required real boundaries; observations are reproducible enough to form a baseline; semantic invariants hold; progressive updates do not remount or lose viewport; lock/navigation works; and no blocking incompatibility is found.
- **Reject/not complete:** a required measurement or browser proof is missing, unavailable instrumentation is silently omitted, the scene loses semantics, required public behavior cannot be achieved, or mocks substitute for material Excalidraw behavior.
- **Report without invented failure:** a high but finite timing or memory observation is baseline evidence when no approved product budget exists.
- **Blocking incompatibility:** build/runtime failure, unsupported required public behavior, semantic loss, remount requirement, viewport loss, inability to lock mutations while retaining navigation, or any need for a fork or undocumented internal dependency.

### 7. Ticket 01 and Ticket 02 AI Undo boundary

Ticket 01 does not implement, accept, or claim the exact one-event AI Undo guarantee. It must record relevant feasibility facts from the pinned package, including available documented update-capture/history controls, absence or presence of a documented transaction boundary, whether progressive external updates visibly contaminate ordinary editor history, and any behavior that would prevent Synara from owning a pre-batch recovery boundary.

Ticket 02 owns the concrete Synara-managed exact one-event AI Undo implementation and its real-package proof for completed, interrupted, and failed partial AI batches.

If Ticket 01 discovers that 0.18.1 makes a Synara-owned exact recovery boundary impossible without a fork, inaccessible internal state, or unacceptable semantic loss, that is a blocking incompatibility and Ticket 02 must not proceed until the version or boundary is reassessed.

### 8. Dot-grid exclusion

Ticket 01 must not implement the FigJam-like dot grid. It may only note whether the embedding boundary leaves a future overlay/background seam. Grid rendering, preference state, export inclusion controls, persistence, accessibility, and theme behavior belong to later tickets. Absence of a dot grid is not a Ticket 01 failure.

### 9. Failure behavior and diagnostics

The harness and report must fail explicitly and retain actionable evidence for lazy package/chunk load failure; CSS or asset-load failure; browser/runtime incompatibility; fixture decode/restore failure; unsupported or dropped elements; semantic relationship mismatch; missing image data; serialization or export failure; editor remount; update-order mismatch; viewport loss; mutation succeeding under lock; pan/zoom failing under lock; selection-settlement timeout or unstable selection; viewport mismatch; missing required public API; and unavailable or failed performance instrumentation.

Diagnostics identify the AC, operation phase, package version, fixture/scenario, expected invariant, and observed result. Large scene payloads may be represented by bounded artifact references.

Prohibited behavior:

- replacing failed hydration with an empty scene and continuing as success;
- dropping unsupported elements without reporting semantic loss;
- remounting as fallback for failed imperative updates;
- using private Excalidraw APIs without reporting a blocking violation;
- treating "no exception" as fidelity proof;
- accepting Blob/SVG creation without meaningful validation;
- reporting unavailable measurements as zero;
- attributing unrelated Agentation changes to Ticket 01.

### 10. Exact Ticket 01 implementation boundary

Ticket 01 may own:

- the exact dependency pin and lockfile resolution;
- the isolated lazy adapter leaf;
- deterministic representative scene fixtures;
- the isolated production-compatible browser harness;
- focused utility/browser tests for AC1–AC6;
- baseline measurement artifacts and an incompatibility report;
- minimal build or test configuration required for the harness.

Ticket 01 does not own RightDock or normal production navigation; launcher/tabs/Focus mode; native or File-canvas persistence; canonical shared Whiteboard schemas beyond a minimal private harness shape; composer chips; agent operations and Take Over; exact one-event AI Undo implementation; production Undo/Redo history; two-canvas retention policy; Auto-save; production image storage; thumbnails; import product flows; file conflicts; dot grid; final selection delay; final image limits; latency/memory budgets; or product-visible diagnostics/recovery UI.

Minimal scaffolding must not become a parallel Whiteboard architecture. Later tickets may reuse the adapter, fixtures, and findings, but Ticket 01 must not preempt their decisions.

## Rejected alternatives

- Floating dependency ranges.
- Forking Excalidraw.
- Eager application-level import.
- Direct package use throughout future UI/domain code.
- Production RightDock integration as the Ticket 01 harness.
- A standalone demo with a materially different bundler/runtime.
- Mocked editor/export as sole AC evidence.
- Byte-for-byte round-trip equality.
- Visual-only fidelity proof.
- A hard-coded final selection debounce.
- Invented latency or memory budgets.
- Implementing exact AI Undo in Ticket 01, or ignoring Undo feasibility entirely.
- Implementing the dot grid now.
- Silent fallback to empty content or remounting.

## Assumptions

- npm registry and React 19 peer-compatibility evidence for 0.18.1 is accurate at implementation start.
- The researched official 0.18.1 public APIs remain available in the resolved package.
- Ticket 02 owns exact one-event AI Undo and real-package proof.
- Existing browser-test infrastructure can run actual Chromium with the real web build or be minimally extended without changing the approved strategy.
- Unrelated Agentation changes remain present and must be preserved during dependency and lockfile work.

Contradictory package resolution or browser behavior is implementation evidence, not permission to silently switch versions or boundaries.

## Residual uncertainty

The production selection-settlement delay; final latency, memory, image-size, and board-size policies; precise browser memory attribution; Excalidraw history interactions needed by Ticket 02; future package normalization behavior; and dot-grid composition remain intentionally unresolved. These do not block Ticket 01 because this decision defines how to measure and report them without inventing product authority.

## Downstream effect

- Ticket 01 implementation may begin only after this record is persisted and cited as authoritative.
- Evidence must use exactly 0.18.1 and the isolated real-browser boundary defined here.
- Later tickets may depend on the adapter only after Ticket 01 reports no blocking incompatibility.
- Ticket 02 owns exact one-event AI Undo and must use Ticket 01 findings rather than assuming an undocumented native transaction.
- RightDock, persistence, agent workflow, and dot-grid work remain unopened.
- Unrelated Agentation changes are neither inputs nor acceptance evidence.

## Failure and rollback implications

Because Ticket 01 is isolated and has no normal production wiring, rollback is limited to the exact dependency, adapter leaf, harness, fixtures, and associated test/build configuration.

A failed Ticket 01 must not be recovered by silently changing versions, importing private internals, forking Excalidraw, weakening fidelity assertions, replacing browser evidence with mocks, or implementing later product architecture to mask an adapter limitation.

If 0.18.1 is blocking, dependent Whiteboard implementation stops for a bounded reassessment of version or public-boundary feasibility.

## Reopening conditions

Reassess if 0.18.1 cannot resolve/build/run; React 19 runtime behavior contradicts supplied compatibility; required semantics cannot survive official restore/export; progressive updates require remounting or internals; lock mode cannot prevent mutations while preserving pan/zoom; selection or viewport cannot be observed publicly; exact AI recovery appears impossible without a fork or inaccessible internals; a materially different package version is proposed; Ticket 01 begins absorbing later scope; or owner-approved behavior/testing governance changes.

Routine implementation details within this boundary do not reopen the decision.

## Superseded record

None.
