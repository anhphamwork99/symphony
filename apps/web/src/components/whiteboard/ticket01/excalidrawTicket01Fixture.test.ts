// FILE: excalidrawTicket01Fixture.test.ts
// Purpose: Verifies the deterministic AC2 fixture and semantic failure pairing.
// Layer: Whiteboard feasibility tests

import { describe, expect, it } from "vitest";

import {
  EXCALIDRAW_TICKET01_FIXTURE,
  makeExcalidrawTicket01Fixture,
  TICKET01_CARD_ID,
  TICKET01_CARD_TEXT_ID,
  TICKET01_CONNECTOR_ID,
  TICKET01_FRAME_ID,
  TICKET01_GROUP_ID,
  TICKET01_IMAGE_FILE_ID,
  TICKET01_IMAGE_ID,
  TICKET01_TARGET_ID,
  type ExcalidrawTicket01Scene,
} from "./excalidrawTicket01Fixture";
import {
  compareExcalidrawTicket01Semantics,
  projectExcalidrawTicket01Semantics,
} from "./excalidrawTicket01Semantics";

type MutableElement = {
  id: string;
  [key: string]: unknown;
};

type MutableFixture = {
  elements: MutableElement[];
  files: Record<string, Record<string, unknown>>;
};

function mutableFixture(): MutableFixture {
  return structuredClone(makeExcalidrawTicket01Fixture()) as unknown as MutableFixture;
}

function compare(fixture: MutableFixture) {
  return compareExcalidrawTicket01Semantics(
    EXCALIDRAW_TICKET01_FIXTURE,
    fixture as unknown as ExcalidrawTicket01Scene,
  );
}

describe("Ticket 01 Excalidraw representative fixture", () => {
  it("is deterministic and contains every AC2 relationship category", () => {
    const first = projectExcalidrawTicket01Semantics(makeExcalidrawTicket01Fixture());
    const second = projectExcalidrawTicket01Semantics(makeExcalidrawTicket01Fixture());

    expect(first).toEqual(second);
    expect(first.elements.map((element) => element.id)).toEqual([
      TICKET01_FRAME_ID,
      TICKET01_CARD_ID,
      TICKET01_CARD_TEXT_ID,
      TICKET01_TARGET_ID,
      TICKET01_CONNECTOR_ID,
      TICKET01_IMAGE_ID,
    ]);
    expect(first.elements.find((element) => element.id === TICKET01_CARD_TEXT_ID)?.relationships).toMatchObject({
      containerId: TICKET01_CARD_ID,
      groupIds: [TICKET01_GROUP_ID],
      frameId: TICKET01_FRAME_ID,
    });
    expect(first.elements.find((element) => element.id === TICKET01_CONNECTOR_ID)?.relationships).toMatchObject({
      startBinding: { elementId: TICKET01_CARD_ID },
      endBinding: { elementId: TICKET01_TARGET_ID },
    });
    expect(first.elements.find((element) => element.id === TICKET01_IMAGE_ID)?.image).toEqual({
      fileId: TICKET01_IMAGE_FILE_ID,
      fileAvailable: true,
      mimeType: "image/png",
    });
    expect(first.elements.some((element) => element.customData !== null)).toBe(true);
  });

  it("ignores package normalization fields while retaining semantic meaning", () => {
    const after = mutableFixture();
    after.elements = after.elements.map((element) => ({
      ...element,
      version: 999,
      versionNonce: 888,
      seed: 777,
      updated: 666,
      status: "saved",
      isDeleted: false,
    }));

    const result = compare(after);

    expect(result.equal).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("diagnoses a missing reciprocal connector binding", () => {
    const after = mutableFixture();
    const connector = after.elements.find((element) => element.id === TICKET01_CONNECTOR_ID);
    connector!["startBinding"] = null;

    const result = compare(after);

    expect(result.equal).toBe(false);
    expect(result.differences.map((difference) => difference.code)).toContain(
      "missing-reciprocal-binding",
    );
    expect(result.diagnostics.join("\n")).toContain("connector relationship is not reciprocal");
  });

  it("diagnoses a bound text element pointing at the wrong container", () => {
    const after = mutableFixture();
    const text = after.elements.find((element) => element.id === TICKET01_CARD_TEXT_ID);
    text!["containerId"] = TICKET01_TARGET_ID;

    const result = compare(after);

    expect(result.equal).toBe(false);
    expect(result.differences.map((difference) => difference.code)).toContain("wrong-text-container");
    expect(result.diagnostics.join("\n")).toContain("has the wrong container");
  });

  it("diagnoses a dropped group member", () => {
    const after = mutableFixture();
    const text = after.elements.find((element) => element.id === TICKET01_CARD_TEXT_ID);
    text!["groupIds"] = [];

    const result = compare(after);

    expect(result.equal).toBe(false);
    expect(result.differences.map((difference) => difference.code)).toContain("missing-group-member");
    expect(result.diagnostics.join("\n")).toContain("group membership changed");
  });

  it("diagnoses a dropped frame membership", () => {
    const after = mutableFixture();
    const target = after.elements.find((element) => element.id === TICKET01_TARGET_ID);
    target!["frameId"] = null;

    const result = compare(after);

    expect(result.equal).toBe(false);
    expect(result.differences.map((difference) => difference.code)).toContain(
      "missing-frame-membership",
    );
    expect(result.diagnostics.join("\n")).toContain("frame membership changed");
  });

  it("diagnoses image data missing behind an image reference", () => {
    const after = mutableFixture();
    delete after.files[TICKET01_IMAGE_FILE_ID];

    const result = compare(after);

    expect(result.equal).toBe(false);
    expect(result.differences.map((difference) => difference.code)).toContain("missing-image-file");
    expect(result.diagnostics.join("\n")).toContain("image/file relationship changed");
  });

  it("diagnoses dropped customData", () => {
    const after = mutableFixture();
    const image = after.elements.find((element) => element.id === TICKET01_IMAGE_ID);
    image!["customData"] = null;

    const result = compare(after);

    expect(result.equal).toBe(false);
    expect(result.differences.map((difference) => difference.code)).toContain("custom-data-loss");
    expect(result.diagnostics.join("\n")).toContain("customData changed or was dropped");
  });

  it("diagnoses a changed meaningful element order", () => {
    const after = mutableFixture();
    [after.elements[1], after.elements[2]] = [after.elements[2], after.elements[1]];

    const result = compare(after);

    expect(result.equal).toBe(false);
    expect(result.differences.map((difference) => difference.code)).toContain(
      "meaningful-order-changed",
    );
    expect(result.diagnostics.join("\n")).toContain("meaningful element order changed");
  });
});
