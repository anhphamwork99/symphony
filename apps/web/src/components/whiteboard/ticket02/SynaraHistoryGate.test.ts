import { describe, expect, it } from "vitest";

import type { SynaraSceneInput, SynaraSceneSnapshot } from "../ticket01/SynaraExcalidrawAdapter";
import { SynaraHistoryCommands } from "./SynaraHistoryCommands";
import { captureDocumentSnapshot } from "./SynaraDocumentSnapshot";
import { SynaraSessionHistory, type SynaraHistoryAdapter } from "./SynaraSessionHistory";

function scene(progress = 0): SynaraSceneSnapshot {
  return {
    elements: [{ id: "shape", type: "rectangle", progress }],
    files: {},
    viewport: { scrollX: 10, scrollY: 20, zoom: 1 },
    selectedElementIds: [],
  };
}

function fakeAdapter(): SynaraHistoryAdapter & { current: SynaraSceneSnapshot } {
  const adapter = {
    current: scene(),
    captureScene() {
      return this.current;
    },
    restoreScene(snapshot: SynaraSceneSnapshot) {
      this.current = { ...snapshot, viewport: this.current.viewport };
    },
    applyProgress(update: SynaraSceneInput & { readonly sequence: number }) {
      this.current = {
        ...this.current,
        elements: update.elements ?? this.current.elements,
        files: update.files ?? this.current.files,
      };
    },
  };
  return adapter;
}

describe("Ticket 02 public-history gate coordinator", () => {
  it("turns three NEVER-style progress updates into one exact event", () => {
    const adapter = fakeAdapter();
    const history = new SynaraSessionHistory(adapter);
    const commands = new SynaraHistoryCommands(history);
    const before = captureDocumentSnapshot(adapter.current);

    history.beginAiBatch("batch-1");
    history.applyAiProgress("batch-1", { sequence: 1, elements: [{ id: "shape", progress: 1 }] });
    history.applyAiProgress("batch-1", { sequence: 2, elements: [{ id: "shape", progress: 2 }] });
    history.applyAiProgress("batch-1", { sequence: 3, elements: [{ id: "shape", progress: 3 }] });
    history.completeAiBatch("batch-1");

    expect(history.getState()).toMatchObject({ cursor: 1, activeTransaction: "none" });
    expect(history.getState().events).toHaveLength(1);
    expect(history.getState().events[0]?.acceptedUpdateCount).toBe(3);
    expect(commands.dispatch("undo")).toBe(true);
    expect(captureDocumentSnapshot(adapter.current)).toEqual(before);
    expect(history.getState().cursor).toBe(0);
    expect(commands.dispatch("redo")).toBe(true);
    expect(adapter.current.elements).toEqual([{ id: "shape", progress: 3 }]);
    expect(history.getState().cursor).toBe(1);
  });

  it("does not expose progress checkpoints or move twice for one command", () => {
    const adapter = fakeAdapter();
    const history = new SynaraSessionHistory(adapter);
    const commands = new SynaraHistoryCommands(history);
    history.beginAiBatch("batch-2");
    history.applyAiProgress("batch-2", { sequence: 1, elements: [{ id: "shape", progress: 1 }] });
    history.applyAiProgress("batch-2", { sequence: 2, elements: [{ id: "shape", progress: 2 }] });
    history.applyAiProgress("batch-2", { sequence: 3, elements: [{ id: "shape", progress: 3 }] });
    history.completeAiBatch("batch-2");

    expect(history.getState().events).toHaveLength(1);
    expect(history.getTraces().filter((trace) => trace.phase === "append")).toHaveLength(1);
    expect(commands.dispatch("undo")).toBe(true);
    expect(commands.dispatch("undo")).toBe(false);
    expect(commands.getDispatchCount()).toBe(2);
    expect(history.getState().cursor).toBe(0);
  });

  it("rejects non-contiguous progress before applying it", () => {
    const adapter = fakeAdapter();
    const history = new SynaraSessionHistory(adapter);
    history.beginAiBatch("batch-3");
    expect(() =>
      history.applyAiProgress("batch-3", { sequence: 2, elements: [{ id: "shape", progress: 2 }] }),
    ).toThrow("expected progress sequence 1");
    expect(adapter.current).toEqual(scene());
    expect(history.getDiagnostics()[0]).toMatchObject({ code: "sequence-mismatch" });
  });
});
