import "../../../index.css";

import { createRef, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type {
  SynaraSceneInput,
} from "../ticket01/SynaraExcalidrawAdapter";
import {
  TICKET01_IMAGE_ID,
  makeExcalidrawTicket01Fixture,
} from "../ticket01/excalidrawTicket01Fixture";
import {
  ExcalidrawTicket02Harness,
  type ExcalidrawTicket02HarnessHandle,
} from "./ExcalidrawTicket02Harness";

function Shell(props: { readonly children: ReactNode }) {
  return <div style={{ height: 720, minHeight: 720, width: 1120 }}>{props.children}</div>;
}

function imageFreeFixture(): SynaraSceneInput {
  const fixture = makeExcalidrawTicket01Fixture();
  return {
    elements: fixture.elements.filter((element) => element.id !== TICKET01_IMAGE_ID),
    files: {},
  } as unknown as SynaraSceneInput;
}

async function waitForHarness(
  ref: { current: ExcalidrawTicket02HarnessHandle | null },
): Promise<ExcalidrawTicket02HarnessHandle> {
  await vi.waitFor(
    () => {
      expect(ref.current).not.toBeNull();
      expect(ref.current?.getAdapter().getIdentity().apiId).not.toBeNull();
      expect(ref.current?.getHistory().lockState).toBe("unlocked");
    },
    { timeout: 20_000, interval: 25 },
  );
  return ref.current as ExcalidrawTicket02HarnessHandle;
}

function editorRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".excalidraw");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function fileInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
}

/** Time-boxed wrapper so a wedged userEvent call cannot exceed the test budget. */
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    console.log(`[gate-probe] bounded:${label}:settled`);
  }
}

describe("WP-NATIVE-IMAGE-GATE file-chooser route probe in stable Chromium", () => {
  beforeAll(async () => {
    await page.viewport(1280, 900);
  });

  it("drives the package file chooser through public test APIs only", async () => {
    const log: string[] = [];
    const SENTINEL_PNG_BASE64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAF0lEQVR42mP4zwAE/0HwP4xuAIo0NAAAhxcKeJxxfuoAAAAASUVORK5CYII=";
    const binary = Uint8Array.from(atob(SENTINEL_PNG_BASE64), (char) => char.charCodeAt(0));
    log.push(`sentinel-bytes=${binary.length}`);
    log.push(`sentinel-sha256=f4c9aa77ea404b705139be6723be2d2cf74154a9b6a437868ebf8953a754187b`);
    log.push(`show-open-file-picker-typeof=${typeof window.showOpenFilePicker}`);
    log.push(`pre-click-file-inputs=${fileInputs().length}`);

    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    console.log("[gate-probe] mounting");
    await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={imageFreeFixture()}
          scenario="native-image-gate-probe"
        />
      </Shell>,
    );
    const handle = await waitForHarness(ref);
    console.log("[gate-probe] harness-ready");

    editorRoot().focus();
    log.push(`active-tool-before=via-toolbar-checked-count`);
    log.push(
      `image-tool-before=${String(
        (document.querySelector('[data-testid="toolbar-image"]') as HTMLInputElement | null)
          ?.checked ?? "absent",
      )}`,
    );

    // Watch for ANY connected or created file input around the toolbar click.
    const sightings: string[] = [];
    const scanner = window.setInterval(() => {
      const inputs = fileInputs();
      if (inputs.length > 0) {
        sightings.push(
          inputs
            .map(
              (element) =>
                `connected=${String(element.isConnected)} accept=${JSON.stringify(element.accept)}`,
            )
            .join(";"),
        );
      }
    }, 20);

    const clickResult = await bounded(
      userEvent.click(page.getByTestId("toolbar-image")),
      8000,
      "toolbar-click",
    );
    log.push(`toolbar-click=${clickResult === "timeout" ? "TIMEOUT" : "resolved"}`);

    let foundConnectedInput: HTMLInputElement | null = null;
    for (let waitedMs = 0; waitedMs < 4000; waitedMs += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const candidate of fileInputs()) {
        if (candidate.isConnected) {
          foundConnectedInput = candidate;
          break;
        }
      }
      if (foundConnectedInput !== null) break;
    }

    log.push(`connected-input-found=${foundConnectedInput !== null}`);
    log.push(`file-inputs-after-window=${fileInputs().length}`);
    log.push(`sightings=${JSON.stringify(sightings.slice(0, 12))}`);

    if (foundConnectedInput !== null) {
      const uploadOutcome = await bounded(
        (async () => {
          const file = new File([binary], "sentinel.png", { type: "image/png" });
          await userEvent.upload(page.elementLocator(foundConnectedInput as HTMLInputElement), file);
        })(),
        8000,
        "upload",
      );
      log.push(`upload=${uploadOutcome === "timeout" ? "TIMEOUT" : "resolved"}`);
    }

    window.clearInterval(scanner);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const sceneElements = handle.getAdapter().captureScene().elements;
    const imageCount = sceneElements.filter((element) => element.type === "image").length;
    log.push(`scene-elements=${sceneElements.length}`);
    log.push(`image-elements=${imageCount}`);
    log.push(`selection=${JSON.stringify([...handle.getAdapter().captureScene().selectedElementIds])}`);

    console.log("[gate-probe-result]", JSON.stringify(log, null, 1));

    // Probe assertion: the real toolbar/chooser interaction must yield an
    // image element for the Gate to be feasible through public APIs.
    expect(imageCount, log.join("\n")).toBeGreaterThan(0);
  });
});
