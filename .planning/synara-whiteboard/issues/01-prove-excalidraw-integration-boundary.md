# 01 — Prove the Excalidraw integration boundary

**What to build:** Establish a pinned, production-compatible official Excalidraw embed and prove that Synara can preserve representative scenes, update them progressively without remounting, lock editing while retaining navigation, and measure the integration before feature implementation depends on it.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] **AC1:** A pinned official `@excalidraw/excalidraw` release loads and operates in Synara’s actual browser build and runtime environment without a fork.
- [ ] **AC2:** A representative scene containing bindings, bound text, groups, frames, images, and custom data survives import, normalization, persistence-shaped serialization, hydration, and export without semantic loss.
- [ ] **AC3:** Ordered imperative scene updates render progressively without remounting the editor or losing viewport state.
- [ ] **AC4:** Host-controlled edit lock prevents element mutations while pan and zoom remain available.
- [ ] **AC5:** Selection settlement and viewport capture/restoration are observable through the real embedded package.
- [ ] **AC6:** Baseline measurements cover hydration, serialization, progressive updates, hidden-canvas memory, and image-bearing scenes, with blocking incompatibilities reported explicitly.

## Testing Seams

Feature governance: [Decision 0047](../decisions/0047-testing-strategy-governance-reassessment.md).

**Approval status:** Approved — owner approved the proposed seams on 2026-08-26.

- **AC1, AC3–AC5:** Actual embedded Excalidraw browser boundary — prove package loading, non-remounting updates, lock/navigation, selection settlement, and viewport behavior.
- **AC2:** Official Excalidraw restore/serialize/export boundary — prove representative real-scene round-trip fidelity.
- **AC6:** Browser performance instrumentation — record empty, normal, image-bearing, progressive-update, and multi-canvas evidence.
