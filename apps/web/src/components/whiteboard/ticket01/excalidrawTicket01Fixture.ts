// FILE: excalidrawTicket01Fixture.ts
// Purpose: Provides a deterministic, package-independent representative scene for
//          Ticket 01's AC2 semantic-fidelity proof.
// Layer: Whiteboard feasibility test fixture
// Exports: Fixture-local Excalidraw-shaped scene and related private types
//
// This module intentionally does not import Excalidraw. Its shape follows the
// documented 0.18.1 scene fields that the later isolated adapter will translate.

export type ExcalidrawTicket01ElementType =
  | "arrow"
  | "diamond"
  | "frame"
  | "image"
  | "rectangle"
  | "text";

export interface ExcalidrawTicket01BoundElement {
  readonly id: string;
  readonly type: "arrow" | "text";
}

export interface ExcalidrawTicket01Binding {
  readonly elementId: string;
  readonly focus: number;
  readonly gap: number;
}

export interface ExcalidrawTicket01File {
  readonly id: string;
  readonly dataURL: string;
  readonly mimeType: "image/png";
  readonly created: number;
}

export interface ExcalidrawTicket01Element {
  readonly id: string;
  readonly type: ExcalidrawTicket01ElementType;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
  readonly groupIds?: readonly string[];
  readonly frameId?: string | null;
  readonly boundElements?: readonly ExcalidrawTicket01BoundElement[] | null;
  readonly customData?: Readonly<Record<string, unknown>>;
  readonly containerId?: string | null;
  readonly text?: string;
  readonly originalText?: string;
  readonly fontSize?: number;
  readonly fontFamily?: number;
  readonly textAlign?: "left" | "center" | "right";
  readonly verticalAlign?: "top" | "middle";
  readonly autoResize?: boolean;
  readonly lineHeight?: number;
  readonly points?: readonly (readonly [number, number])[];
  readonly startBinding?: ExcalidrawTicket01Binding | null;
  readonly endBinding?: ExcalidrawTicket01Binding | null;
  readonly fileId?: string;
  readonly lastCommittedPoint?: readonly [number, number] | null;
  readonly startArrowhead?: "arrow" | "bar" | "dot" | "circle" | null;
  readonly endArrowhead?: "arrow" | "bar" | "dot" | "circle" | null;
  readonly elbowed?: boolean;
  readonly name?: string | null;
  readonly status?: "pending" | "saved" | "error";
  readonly scale?: readonly [number, number];
  readonly crop?: null;
  readonly strokeColor?: string;
  readonly backgroundColor?: string;
  readonly fillStyle?: "hachure" | "cross-hatch" | "solid" | "zigzag";
  readonly strokeWidth?: number;
  readonly strokeStyle?: "solid" | "dashed" | "dotted";
  readonly roundness?: null | { readonly type: number; readonly value?: number };
  readonly roughness?: number;
  readonly opacity?: number;
  readonly seed?: number;
  readonly version?: number;
  readonly versionNonce?: number;
  readonly index?: string | null;
  readonly isDeleted?: boolean;
  readonly updated?: number;
  readonly link?: string | null;
  readonly locked?: boolean;
}

export interface ExcalidrawTicket01Scene {
  readonly elements: readonly ExcalidrawTicket01Element[];
  readonly files: Readonly<Record<string, ExcalidrawTicket01File>>;
}

const FRAME_ID = "frame-release-plan";
const CARD_ID = "card-api-boundary";
const CARD_TEXT_ID = "card-api-boundary-text";
const TARGET_ID = "target-browser-proof";
const CONNECTOR_ID = "connector-card-to-target";
const IMAGE_ID = "image-excalidraw-mark";
const IMAGE_FILE_ID = "file-excalidraw-mark";
const GROUP_ID = "group-api-card";

/**
 * Build a fresh fixture so a test can pass it through a mutating package API
 * without sharing state with another test.
 */
export function makeExcalidrawTicket01Fixture(): ExcalidrawTicket01Scene {
  return {
    elements: [
      {
        id: FRAME_ID,
        type: "frame",
        x: 80,
        y: 60,
        width: 760,
        height: 480,
        angle: 0,
        name: "Release plan",
        strokeColor: "#1b1b1f",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 1001,
        version: 1,
        versionNonce: 2001,
        index: "a0",
        isDeleted: false,
        updated: 1_725_000_000_000,
        link: null,
        locked: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        customData: { role: "acceptance-frame", revision: 1 },
      },
      {
        id: CARD_ID,
        type: "rectangle",
        x: 140,
        y: 150,
        width: 220,
        height: 110,
        angle: 0,
        strokeColor: "#1b1b1f",
        backgroundColor: "#dbeafe",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 1002,
        version: 1,
        versionNonce: 2002,
        index: "a1",
        isDeleted: false,
        updated: 1_725_000_000_001,
        link: null,
        locked: false,
        groupIds: [GROUP_ID],
        frameId: FRAME_ID,
        boundElements: [
          { id: CARD_TEXT_ID, type: "text" },
          { id: CONNECTOR_ID, type: "arrow" },
        ],
        customData: { role: "source-card", semanticTag: "api-boundary" },
      },
      {
        id: CARD_TEXT_ID,
        type: "text",
        x: 174,
        y: 190,
        width: 178.857421875,
        height: 25,
        angle: 0,
        strokeColor: "#1b1b1f",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 1003,
        version: 1,
        versionNonce: 2003,
        index: "a2",
        isDeleted: false,
        updated: 1_725_000_000_002,
        link: null,
        locked: false,
        groupIds: [GROUP_ID],
        frameId: FRAME_ID,
        containerId: CARD_ID,
        text: "Official API boundary",
        originalText: "Official API boundary",
        fontSize: 20,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "middle",
        autoResize: true,
        lineHeight: 1.25,
        boundElements: [],
        customData: { role: "bound-label" },
      },
      {
        id: TARGET_ID,
        type: "diamond",
        x: 570,
        y: 155,
        width: 190,
        height: 100,
        angle: 0,
        strokeColor: "#1b1b1f",
        backgroundColor: "#dcfce7",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 1004,
        version: 1,
        versionNonce: 2004,
        index: "a3",
        isDeleted: false,
        updated: 1_725_000_000_003,
        link: null,
        locked: false,
        groupIds: [],
        frameId: FRAME_ID,
        boundElements: [{ id: CONNECTOR_ID, type: "arrow" }],
        customData: { role: "target-card", semanticTag: "browser-proof" },
      },
      {
        id: CONNECTOR_ID,
        type: "arrow",
        x: 360,
        y: 205,
        width: 210,
        height: 0,
        angle: 0,
        strokeColor: "#1b1b1f",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 1005,
        version: 1,
        versionNonce: 2005,
        index: "a4",
        isDeleted: false,
        updated: 1_725_000_000_004,
        link: null,
        locked: false,
        groupIds: [],
        frameId: FRAME_ID,
        boundElements: null,
        points: [
          [0, 0],
          [210, 0],
        ],
        startBinding: { elementId: CARD_ID, focus: 0, gap: 8 },
        endBinding: { elementId: TARGET_ID, focus: 0, gap: 8 },
        lastCommittedPoint: null,
        startArrowhead: null,
        endArrowhead: "arrow",
        elbowed: false,
        customData: { role: "relationship", meaning: "source-to-target" },
      },
      {
        id: IMAGE_ID,
        type: "image",
        x: 180,
        y: 350,
        width: 96,
        height: 96,
        angle: 0,
        strokeColor: "#1b1b1f",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 0,
        opacity: 100,
        seed: 1006,
        version: 1,
        versionNonce: 2006,
        index: "a5",
        isDeleted: false,
        updated: 1_725_000_000_005,
        link: null,
        locked: false,
        groupIds: [],
        frameId: FRAME_ID,
        boundElements: null,
        fileId: IMAGE_FILE_ID,
        status: "saved",
        scale: [1, 1],
        crop: null,
        customData: { role: "fixture-image", assetKind: "png" },
      },
    ],
    files: {
      [IMAGE_FILE_ID]: {
        id: IMAGE_FILE_ID,
        dataURL:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        mimeType: "image/png",
        created: 1_725_000_000_000,
      },
    },
  };
}

export const EXCALIDRAW_TICKET01_FIXTURE = makeExcalidrawTicket01Fixture();

export {
  CARD_ID as TICKET01_CARD_ID,
  CARD_TEXT_ID as TICKET01_CARD_TEXT_ID,
  CONNECTOR_ID as TICKET01_CONNECTOR_ID,
  FRAME_ID as TICKET01_FRAME_ID,
  GROUP_ID as TICKET01_GROUP_ID,
  IMAGE_FILE_ID as TICKET01_IMAGE_FILE_ID,
  IMAGE_ID as TICKET01_IMAGE_ID,
  TARGET_ID as TICKET01_TARGET_ID,
};
