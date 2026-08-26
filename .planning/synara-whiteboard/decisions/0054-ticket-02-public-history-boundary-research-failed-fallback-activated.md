# Decision 0054: Ticket 02 public-history boundary research failed; activate fallback direction 4

Status: Binding — research gate failed; fallback direction 4 active; fallback contract required before implementation
Date: 2026-08-27
Trigger: Completion of the bounded version/public-API reassessment authorized by Decision 0053
Supersedes: No historical record; activates the conditional fallback in Decision 0053
Reopens Decisions 0047, 0048, or 0050: No

## Question

Did the supported Excalidraw versions and documented public APIs provide a supported host-owned single-route history boundary, and if not, what is the authorized next route for Ticket 02?

## Governing decision

Decision 0053 required version and documented public-API research before any package, lockfile, or implementation change. It pre-authorized direction 4 if that research found no supported public boundary. The research is complete and the gate is **FAIL**. Direction 4 is therefore activated for planning and fallback-contract design.

This decision records the research result and routing only. It does not amend `PRODUCT-CONTRACT.md`, `spec.md`, or the Ticket 02 acceptance criteria. Those product details remain the current recorded requirements until a fallback contract is designed and approved.

## Versions and public surfaces examined

The reassessment examined the supported public surfaces available from:

1. Stable npm `latest`: `@excalidraw/excalidraw@0.18.1`, confirmed by the npm registry dist-tags.
2. The npm `next` dist-tag: `@excalidraw/excalidraw@0.18.0-abeeaeb`, including its published declaration surface.
3. The upstream unreleased/current public surface described in the Excalidraw changelog, together with the current official API documentation.
4. The published declaration files for `0.18.1` and `next`, and the official `ExcalidrawAPI`, props, UI-options, and interaction documentation.

The exact supporting sources are preserved in [`RESEARCH.md`](../RESEARCH.md) and listed below.

## Exact public-boundary finding

Across the examined stable and next/unreleased public surfaces:

- `ExcalidrawAPI.history` exposes only `history.clear(): void`.
- `updateScene` exposes `captureUpdate` values for immediate, eventual, or never-captured updates. It does not expose a public history transaction begin/end, pause/disable, delegation, stack inspection, stack trimming/capping, or native Undo/Redo route-control API.
- The public API provides scene/app/file reads and writes, but no supported operation that makes the native route permanently inert while retaining reliable human mutation capture.
- `ui={false}` hides Excalidraw's default UI only. The editor remains interactive, so native keyboard behavior and native history remain available.
- `interaction={false}` makes the editor inert, including keyboard and human editing. It therefore cannot preserve the required human capture path. Its public exceptions do not provide the required mixed history boundary.

Consequently, no examined supported version/public-API combination can prove all of Decision 0053's requirements simultaneously: one host-owned effective route, no transient native availability, reliable human capture, non-user-visible progressive AI updates, exact one-event AI batches, exact scene/file restoration, and bounded host history. Achieving that boundary would require a prohibited or unavailable mechanism such as private/undocumented integration, native-stack inspection, DOM/CSS suppression, package mutation, remounting, or a fork.

## Gate verdict and fallback activation

```text
VERSION/PUBLIC-API RESEARCH: FAIL
SUPPORTED HOST-OWNED SINGLE-ROUTE BOUNDARY: NOT FOUND
DECISION 0053 DIRECTION 4: ACTIVE
TICKET 02 BROAD IMPLEMENTATION: NOT AUTHORIZED
```

The activated fallback direction is:

1. Excalidraw native Undo/Redo remains the user-visible route for human edits, including the package-native toolbar and package-native keyboard behavior supported by the selected package.
2. Synara provides dedicated `Undo AI batch` and `Redo AI batch` actions over Synara-owned AI-batch snapshots.
3. One completed, acknowledged interrupted, or failed-partial AI batch remains one AI-batch event; progressive updates do not become individual user-visible AI events.
4. AI Undo/Redo must retain the existing exact scene and image/file-reference recovery obligations.
5. The fallback makes human-native and AI-batch history separate routes. It does not claim a shared stack, shared cursor, or coherent mixed-history presentation.

Activation does not authorize source work or a package upgrade. It authorizes the next planning phase: design and owner approval of the fallback contract.

## Unresolved before implementation

The fallback contract must explicitly resolve, without silently weakening the accepted obligations:

- how the separate human-native and AI-batch routes are presented and named;
- focus behavior and command availability for the dedicated AI actions;
- keyboard behavior and any cross-stack interaction rules;
- Redo-branch invalidation across human and AI activity;
- retention/cap/reset semantics for the separate routes, including what replaces the prior shared 20-event requirement;
- exact failure, interruption, no-op, asset, and restart behavior for AI-batch recovery;
- browser acceptance seams proving the native human route and Synara AI-batch route independently.

No unresolved keyboard, cap, or cross-stack behavior is invented by this decision. Until the fallback contract is approved, no product acceptance clause is rewritten and no implementation route is authorized.

## Preserved prohibitions

Decision 0053 and the earlier accepted boundaries continue to prohibit:

- changing `@excalidraw/excalidraw` or any package version;
- changing `bun.lock` or installing a candidate as an implementation change;
- runtime source or adapter changes;
- private APIs, private imports, undocumented action keys, or native-stack inspection;
- DOM/CSS suppression, runtime native-control queries, monkey-patching, remount restore, or a fork;
- claiming AC4, AC7, or the Ticket 02 gate has passed;
- broad Ticket 02 implementation before the fallback contract and a new bounded implementation route are approved.

The protected Agentation files and all existing evidence logs remain untouched.

## Routing

Update Synara Whiteboard and Ticket 02 to:

```text
designing-fallback-history-contract
```

The next deliverable is a bounded fallback history contract and its owner review. Only after that contract is approved may a new implementation-boundary decision revise the affected acceptance language and authorize source work.

## Authoritative sources

- [Decision 0053](0053-ticket-02-owner-package-reassessment-with-ai-history-fallback.md)
- [Decision 0052](0052-ticket-02-native-history-timing-probe.md)
- [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md)
- [Official Excalidraw API docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)
- [Official UI options docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/ui-options)
- [Official props/interaction docs](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props)
- [Upstream changelog](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/CHANGELOG.md)
- [0.18.1 public declarations](https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.18.1/dist/types/excalidraw/types.d.ts)
- [next public declarations](https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@next/dist/types/excalidraw/types.d.ts)
- [npm registry dist-tags](https://registry.npmjs.org/@excalidraw%2fexcalidraw)
