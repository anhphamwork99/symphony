import "../../../index.css";

import { createRef, type ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { SynaraSceneInput } from "../ticket01/SynaraExcalidrawAdapter";
import {
  TICKET01_IMAGE_ID,
  makeExcalidrawTicket01Fixture,
} from "../ticket01/excalidrawTicket01Fixture";
import {
  ExcalidrawTicket02Harness,
  type ExcalidrawTicket02HarnessHandle,
} from "./ExcalidrawTicket02Harness";

const SENTINEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAIAAAD4YuoOAAAAP0lEQVR42mMQVDLGijyjc7Gi5qnLsaKDl59iRQyjFoxaMAQskHUvxIr0I9diRamq3VjR/bm2WNGoBaMWDAELALPRod/0CWeTAAAAAElFTkSuQmCC";
const SENTINEL_BYTE_LENGTH = 120;
const SENTINEL_SHA256 = "820a2c5650f64161d184782ba6659456d5cfca6af1bc7d45a3241416aa33a37e";
const NORMALIZED_BYTE_LENGTH = 171;
const NORMALIZED_SHA256 = "7d9fc3dfc16b9293589a2f87239dfa7a8325441bb1648eac3729f11819e3858c";
const SENTINEL_WIDTH = 32;
const SENTINEL_HEIGHT = 16;
const SENTINEL_MIME = "image/png";
const SENTINEL_COLORS = [
  [17, 34, 51, 255],
  [73, 91, 109, 255],
  [131, 149, 167, 255],
  [193, 211, 229, 255],
  [29, 71, 113, 255],
  [47, 89, 173, 255],
  [101, 37, 139, 255],
  [223, 157, 61, 255],
] as const;

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

async function waitForHarness(ref: {
  current: ExcalidrawTicket02HarnessHandle | null;
}): Promise<ExcalidrawTicket02HarnessHandle> {
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
  const element = document.querySelector<HTMLElement>(".excalidraw.excalidraw-container");
  expect(element, "real Excalidraw drop container").not.toBeNull();
  return element as HTMLElement;
}

function canvas(): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.interactive",
  );
  expect(element, "real Excalidraw interactive canvas").not.toBeNull();
  return element as HTMLCanvasElement;
}

function sentinelBytes(): Uint8Array {
  const bytes = Uint8Array.from(atob(SENTINEL_PNG_BASE64), (char) => char.charCodeAt(0));
  expect(bytes.byteLength).toBe(SENTINEL_BYTE_LENGTH);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const marker = ";base64,";
  const index = dataUrl.indexOf(marker);
  expect(index, "image file data URL must use base64 encoding").toBeGreaterThan(0);
  return Uint8Array.from(atob(dataUrl.slice(index + marker.length)), (char) => char.charCodeAt(0));
}

function activeImages(handle: ExcalidrawTicket02HarnessHandle): Record<string, unknown>[] {
  return handle
    .getAdapter()
    .captureScene()
    .elements.filter((element) => element.type === "image") as unknown as Record<string, unknown>[];
}

async function waitForSingleImage(handle: ExcalidrawTicket02HarnessHandle) {
  await vi.waitFor(
    () => {
      const images = activeImages(handle);
      expect(images).toHaveLength(1);
      const fileId = images[0]?.fileId;
      expect(typeof fileId).toBe("string");
      expect(handle.getAdapter().captureScene().files[String(fileId)]).toBeDefined();
    },
    { timeout: 20_000, interval: 25 },
  );
}

async function assertCompleteClosure(
  handle: ExcalidrawTicket02HarnessHandle,
  expected?: { readonly elementId: string; readonly fileId: string; readonly storedHash: string },
) {
  await waitForSingleImage(handle);
  const scene = handle.getAdapter().captureScene();
  const image = activeImages(handle)[0] as Record<string, unknown>;
  const elementId = String(image.id);
  const fileId = String(image.fileId);
  const file = scene.files[fileId] as unknown as Record<string, unknown>;
  const dataUrl = String(file.dataURL);
  const bytes = dataUrlBytes(dataUrl);

  expect(image.isDeleted ?? false).toBe(false);
  expect(Number(image.width)).toBe(SENTINEL_WIDTH);
  expect(Number(image.height)).toBe(SENTINEL_HEIGHT);
  expect(file.id).toBe(fileId);
  expect(file.mimeType).toBe(SENTINEL_MIME);
  expect(Number.isFinite(Number(file.created))).toBe(true);
  expect(Number(file.created)).toBeGreaterThan(0);
  expect(bytes.byteLength).toBeGreaterThan(0);
  const storedHash = await sha256(bytes);
  const storedBlob = new Blob([bytes], { type: SENTINEL_MIME });
  const storedColors = await decodedColors(storedBlob);
  expect(SENTINEL_COLORS.filter((color) => storedColors.has(color.join(",")))).toEqual([
    ...SENTINEL_COLORS,
  ]);
  if (expected === undefined) {
    expect(bytes.byteLength).toBe(NORMALIZED_BYTE_LENGTH);
    expect(storedHash).toBe(NORMALIZED_SHA256);
  } else {
    expect({ elementId, fileId, storedHash }).toEqual(expected);
  }
  return { elementId, fileId, storedHash, image };
}

function assertMeaningfulSvg(markup: string, present: boolean): void {
  const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  expect(root.tagName.toLowerCase()).toBe("svg");
  expect(root.childElementCount).toBeGreaterThan(0);
  const image = root.querySelector("image");
  if (present) {
    expect(image, "official SVG must contain an image node").not.toBeNull();
    const href = image?.getAttribute("href") ?? image?.getAttribute("xlink:href") ?? "";
    expect(href.startsWith("data:image/png")).toBe(true);
  } else {
    expect(image, "official SVG must not retain active image evidence").toBeNull();
    expect(markup.includes("data:image/png")).toBe(false);
  }
}

async function decodedColors(blob: Blob): Promise<Set<string>> {
  expect(blob.type).toBe("image/png");
  expect([...new Uint8Array(await blob.slice(0, 8).arrayBuffer())]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  const bitmap = await createImageBitmap(blob);
  expect(bitmap.width).toBeGreaterThan(0);
  expect(bitmap.height).toBeGreaterThan(0);
  const output = document.createElement("canvas");
  output.width = bitmap.width;
  output.height = bitmap.height;
  const context = output.getContext("2d", { willReadFrequently: true });
  expect(context).not.toBeNull();
  (context as CanvasRenderingContext2D).drawImage(bitmap, 0, 0);
  const pixels = (context as CanvasRenderingContext2D).getImageData(
    0,
    0,
    bitmap.width,
    bitmap.height,
  ).data;
  bitmap.close();
  const colors = new Set<string>();
  for (let index = 0; index < pixels.length; index += 4) {
    colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
  }
  return colors;
}

async function assertMeaningfulPng(blob: Blob, present: boolean): Promise<void> {
  const colors = await decodedColors(blob);
  const matches = SENTINEL_COLORS.filter((color) => colors.has(color.join(",")));
  if (present) {
    expect(matches, `decoded PNG colors: ${JSON.stringify([...colors].slice(0, 30))}`).toEqual([
      ...SENTINEL_COLORS,
    ]);
  } else {
    expect(matches, "deleted image colors must be absent from official PNG").toEqual([]);
  }
}

async function assertExports(
  handle: ExcalidrawTicket02HarnessHandle,
  present: boolean,
): Promise<void> {
  assertMeaningfulSvg(await handle.getAdapter().exportSvg(), present);
  await assertMeaningfulPng(await handle.getAdapter().exportPng(), present);
}

function dispatchImageDrop(): { readonly clientX: number; readonly clientY: number } {
  const target = editorRoot();
  const box = target.getBoundingClientRect();
  const clientX = box.left + box.width * 0.72;
  const clientY = box.top + box.height * 0.68;
  const transfer = new DataTransfer();
  transfer.items.add(new File([sentinelBytes()], "ticket02-sentinel.png", { type: SENTINEL_MIME }));
  expect(transfer.files).toHaveLength(1);
  for (const type of ["dragenter", "dragover", "drop"] as const) {
    const event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      dataTransfer: transfer,
    });
    target.dispatchEvent(event);
  }
  return { clientX, clientY };
}

async function clickImage(
  handle: ExcalidrawTicket02HarnessHandle,
  image: Record<string, unknown>,
): Promise<void> {
  const rootBox = editorRoot().getBoundingClientRect();
  const canvasBox = canvas().getBoundingClientRect();
  const viewport = handle.getAdapter().captureViewport();
  const centerX =
    rootBox.left +
    (Number(image.x) + Number(image.width) / 2 + viewport.scrollX) * viewport.zoom;
  const centerY =
    rootBox.top +
    (Number(image.y) + Number(image.height) / 2 + viewport.scrollY) * viewport.zoom;
  editorRoot().focus();
  await userEvent.click(canvas(), {
    position: {
      x: Math.round(centerX - canvasBox.left),
      y: Math.round(centerY - canvasBox.top),
    },
  });
  await vi.waitFor(() =>
    expect(handle.getAdapter().captureScene().selectedElementIds).toContain(String(image.id)),
  );
}

async function clickNativeHistory(kind: "undo" | "redo"): Promise<void> {
  await userEvent.click(
    page.getByRole("button", { name: kind === "undo" ? "Undo" : "Redo", exact: true }),
  );
}

async function assertRemoved(handle: ExcalidrawTicket02HarnessHandle): Promise<void> {
  await vi.waitFor(() => expect(activeImages(handle)).toHaveLength(0), {
    timeout: 10_000,
    interval: 25,
  });
  expect(handle.getHistory().events).toHaveLength(0);
  expect(handle.getHistory().lockState).toBe("unlocked");
  await assertExports(handle, false);
}

describe("WP-NATIVE-IMAGE-DROP-GATE in stable Chromium", () => {
  beforeAll(async () => {
    await page.viewport(1280, 900);
  });

  it("preserves complete native image closure through Delete, Undo, Redo, and second Undo", async () => {
    expect(await sha256(sentinelBytes())).toBe(SENTINEL_SHA256);
    const ref = createRef<ExcalidrawTicket02HarnessHandle>();
    const mounted = await render(
      <Shell>
        <ExcalidrawTicket02Harness
          ref={ref}
          initialScene={imageFreeFixture()}
          scenario="native-image-drop-gate"
          settlementMaxWaitMs={500}
        />
      </Shell>,
    );
    const handle = await waitForHarness(ref);
    expect(activeImages(handle)).toHaveLength(0);
    expect(handle.getHistory().events).toHaveLength(0);

    const drop = dispatchImageDrop();
    const initial = await assertCompleteClosure(handle);
    const initialIdentity = {
      elementId: initial.elementId,
      fileId: initial.fileId,
      storedHash: initial.storedHash,
    };
    expect(handle.getAdapter().captureScene().selectedElementIds).toContain(initial.elementId);
    await assertExports(handle, true);

    await clickImage(handle, initial.image);
    editorRoot().focus();
    await userEvent.keyboard("{Delete}");
    await assertRemoved(handle);

    await clickNativeHistory("undo");
    await assertCompleteClosure(handle, initialIdentity);
    await assertExports(handle, true);

    await clickNativeHistory("redo");
    await assertRemoved(handle);

    await clickNativeHistory("undo");
    await assertCompleteClosure(handle, initialIdentity);
    await assertExports(handle, true);

    expect(drop.clientX).toBeGreaterThan(editorRoot().getBoundingClientRect().left);
    expect(drop.clientY).toBeGreaterThan(editorRoot().getBoundingClientRect().top);
    expect(handle.getHistory().events).toHaveLength(0);
    expect(handle.getHistory().lockState).toBe("unlocked");
    expect(
      handle.getDiagnostics().filter((diagnostic) => diagnostic.severity === "critical"),
    ).toEqual([]);
    await mounted.unmount();
  });
});
