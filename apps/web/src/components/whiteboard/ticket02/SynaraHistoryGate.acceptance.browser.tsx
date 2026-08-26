import "../../../index.css";

import { createRef, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { SynaraSceneInput } from "../ticket01/SynaraExcalidrawAdapter";
import {
  EXCALIDRAW_TICKET01_FIXTURE,
  TICKET01_CARD_ID,
  makeExcalidrawTicket01Fixture,
} from "../ticket01/excalidrawTicket01Fixture";
import { captureDocumentSnapshot, documentSnapshotsEqual } from "./SynaraDocumentSnapshot";
import {
  ExcalidrawTicket02Harness,
  type ExcalidrawTicket02HarnessHandle,
} from "./ExcalidrawTicket02Harness";

const PACKAGE_VERSION = "0.18.1";

function Shell(props: { readonly children: ReactNode }) {
  return (
    <div style={{ height: "700px", minHeight: "700px", width: "1100px" }}>{props.children}</div>
  );
}

function progressScene(progress: number): SynaraSceneInput {
  return {
    elements: EXCALIDRAW_TICKET01_FIXTURE.elements.map((element) => ({
      ...element,
      customData: { ...element.customData, progress },
    })),
    files: EXCALIDRAW_TICKET01_FIXTURE.files,
  };
}

async function waitForAdapter(ref: { current: ExcalidrawTicket02HarnessHandle | null }) {
  await vi.waitFor(
    () => {
      expect(ref.current).not.toBeNull();
      expect(ref.current?.getAdapter().getIdentity().apiId).not.toBeNull();
    },
    { timeout: 20_000, interval: 25 },
  );
  return ref.current as ExcalidrawTicket02HarnessHandle;
}

function nativeHistoryControls(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => {
    const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""} ${button.textContent ?? ""}`;
    return /\b(undo|redo)\b/i.test(label) && !/synara/i.test(label);
  });
}

function assertNativeControlsDisabledAndInert(): void {
  const controls = nativeHistoryControls();
  expect(
    controls.length,
    "real package native Undo/Redo controls must be observable",
  ).toBeGreaterThan(0);
  for (const control of controls) {
    expect(
      control.disabled || control.getAttribute("aria-disabled") === "true",
      `native history control ${control.getAttribute("aria-label") ?? control.textContent} must stay disabled`,
    ).toBe(true);
  }
}

describe("Ticket 02 real Chromium public-only history gate", () => {
  beforeAll(async () => {
    await page.viewport(1280, 860);
  });

  it("proves one completed three-progress batch and one Synara route", async () => {
    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    const mounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          scenario="ticket-02-gate"
        />
      </Shell>,
    );
    const handle = await waitForAdapter(ref);
    expect(PACKAGE_VERSION).toBe("0.18.1");
    const identity = handle.getAdapter().getIdentity();
    const pre = captureDocumentSnapshot(handle.getAdapter().captureScene());

    assertNativeControlsDisabledAndInert();
    handle.beginAiBatch("completed-batch");
    handle.applyAiProgress("completed-batch", { sequence: 1, ...progressScene(1) });
    handle.applyAiProgress("completed-batch", { sequence: 2, ...progressScene(2) });
    handle.applyAiProgress("completed-batch", { sequence: 3, ...progressScene(3) });
    expect(handle.getHistory().events).toHaveLength(0);
    assertNativeControlsDisabledAndInert();
    handle.completeAiBatch("completed-batch");
    const final = captureDocumentSnapshot(handle.getAdapter().captureScene());
    expect(handle.getHistory().cursor).toBe(1);
    expect(handle.getHistory().events).toHaveLength(1);
    expect(final.semanticFingerprint).not.toBe(pre.semanticFingerprint);

    await userEvent.click(page.getByRole("button", { name: "Synara Undo" }));
    await vi.waitFor(() =>
      expect(
        documentSnapshotsEqual(pre, captureDocumentSnapshot(handle.getAdapter().captureScene())),
      ).toBe(true),
    );
    expect(handle.getHistory().cursor).toBe(0);
    await userEvent.click(page.getByRole("button", { name: "Synara Redo" }));
    await vi.waitFor(() =>
      expect(
        documentSnapshotsEqual(final, captureDocumentSnapshot(handle.getAdapter().captureScene())),
      ).toBe(true),
    );
    expect(handle.getHistory().cursor).toBe(1);

    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.interactive",
    );
    expect(canvas).not.toBeNull();
    (document.querySelector(".excalidraw") as HTMLElement).focus();
    await userEvent.keyboard("{Meta>}z{/Meta}");
    await vi.waitFor(() => expect(handle.getHistory().cursor).toBe(0));
    expect(
      documentSnapshotsEqual(pre, captureDocumentSnapshot(handle.getAdapter().captureScene())),
    ).toBe(true);
    expect(handle.getAdapter().getIdentity()).toEqual(identity);
    assertNativeControlsDisabledAndInert();

    // A real package keyboard mutation is observed only after the adapter has
    // synchronously cleared native history. It becomes one human event.
    handle.getAdapter().updateScene({
      sequence: 4,
      appState: { selectedElementIds: { [TICKET01_CARD_ID]: true } },
    });
    (document.querySelector(".excalidraw") as HTMLElement).focus();
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() => expect(handle.getHistory().events).toHaveLength(1));
    expect(handle.getHistory().cursor).toBe(1);
    assertNativeControlsDisabledAndInert();
    await mounted.unmount();
  });

  it("consumes platform Redo from canvas and text-edit focus without package competition", async () => {
    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    const mounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={makeExcalidrawTicket01Fixture() as unknown as SynaraSceneInput}
          scenario="ticket-02-keyboard-containment"
        />
      </Shell>,
    );
    const handle = await waitForAdapter(ref);
    handle.beginAiBatch("keyboard-batch");
    handle.applyAiProgress("keyboard-batch", { sequence: 1, ...progressScene(1) });
    handle.applyAiProgress("keyboard-batch", { sequence: 2, ...progressScene(2) });
    handle.applyAiProgress("keyboard-batch", { sequence: 3, ...progressScene(3) });
    handle.completeAiBatch("keyboard-batch");
    const before = handle.getHistory().cursor;
    (document.querySelector(".excalidraw") as HTMLElement).focus();
    await userEvent.keyboard("{Meta>}z{/Meta}");
    expect(handle.getHistory().cursor).toBe(before - 1);
    await userEvent.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");
    expect(handle.getHistory().cursor).toBe(before);
    expect(handle.getHistoryDiagnostics()).toEqual([]);
    assertNativeControlsDisabledAndInert();
    await mounted.unmount();
  });
});
