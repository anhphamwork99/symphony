// FILE: excalidrawTicket01Semantics.ts
// Purpose: Projects the representative Ticket 01 scene onto stable semantic data
//          and reports focused AC2 fidelity failures.
// Layer: Whiteboard feasibility test fixture
// Exports: Semantic projection and comparison helpers

import type {
  ExcalidrawTicket01Element,
  ExcalidrawTicket01Scene,
} from "./excalidrawTicket01Fixture";

export type ExcalidrawTicket01SemanticDifferenceCode =
  | "custom-data-loss"
  | "element-changed"
  | "element-missing"
  | "meaningful-order-changed"
  | "missing-frame-membership"
  | "missing-group-member"
  | "missing-image-file"
  | "missing-reciprocal-binding"
  | "wrong-text-container";

export interface ExcalidrawTicket01SemanticElement {
  readonly id: string;
  readonly type: ExcalidrawTicket01Element["type"];
  readonly geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly angle: number;
    readonly points: readonly (readonly [number, number])[] | null;
  };
  readonly relationships: {
    readonly boundElements: readonly { readonly id: string; readonly type: string }[];
    readonly containerId: string | null;
    readonly startBinding: {
      readonly elementId: string;
      readonly focus: number;
      readonly gap: number;
    } | null;
    readonly endBinding: {
      readonly elementId: string;
      readonly focus: number;
      readonly gap: number;
    } | null;
    readonly groupIds: readonly string[];
    readonly frameId: string | null;
  };
  readonly text: string | null;
  readonly image: {
    readonly fileId: string | null;
    readonly fileAvailable: boolean;
    readonly mimeType: string | null;
  } | null;
  readonly customData: unknown;
}

export interface ExcalidrawTicket01SemanticFile {
  readonly id: string;
  readonly mimeType: string | null;
  readonly hasData: boolean;
}

export interface ExcalidrawTicket01SemanticProjection {
  readonly elements: readonly ExcalidrawTicket01SemanticElement[];
  readonly files: readonly ExcalidrawTicket01SemanticFile[];
}

export interface ExcalidrawTicket01SemanticDifference {
  readonly code: ExcalidrawTicket01SemanticDifferenceCode;
  readonly path: string;
  readonly message: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface ExcalidrawTicket01SemanticComparison {
  readonly equal: boolean;
  readonly before: ExcalidrawTicket01SemanticProjection;
  readonly after: ExcalidrawTicket01SemanticProjection;
  readonly differences: readonly ExcalidrawTicket01SemanticDifference[];
  readonly diagnostics: readonly string[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function bindingValue(binding: ExcalidrawTicket01Element["startBinding"]) {
  return binding
    ? {
        elementId: binding.elementId,
        focus: binding.focus,
        gap: binding.gap,
      }
    : null;
}

function projectElement(
  element: ExcalidrawTicket01Element,
  files: ExcalidrawTicket01Scene["files"],
): ExcalidrawTicket01SemanticElement {
  const imageFile = element.fileId === undefined ? undefined : files[element.fileId];

  return {
    id: element.id,
    type: element.type,
    geometry: {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      angle: element.angle,
      points: element.points === undefined ? null : element.points.map((point) => [...point] as const),
    },
    relationships: {
      boundElements: (element.boundElements ?? []).map(({ id, type }) => ({ id, type })),
      containerId: element.containerId ?? null,
      startBinding: bindingValue(element.startBinding),
      endBinding: bindingValue(element.endBinding),
      groupIds: [...(element.groupIds ?? [])],
      frameId: element.frameId ?? null,
    },
    text: element.type === "text" ? (element.text ?? null) : null,
    image:
      element.type === "image"
        ? {
            fileId: element.fileId ?? null,
            fileAvailable: imageFile?.dataURL.length > 0,
            mimeType: imageFile?.mimeType ?? null,
          }
        : null,
    customData: stableValue(element.customData ?? null),
  };
}

/**
 * Keep only fields that carry scene meaning across official restore and
 * persistence-shaped serialization. Version, seed, status, and other package
 * normalization fields are intentionally not part of this projection.
 */
export function projectExcalidrawTicket01Semantics(
  scene: ExcalidrawTicket01Scene,
): ExcalidrawTicket01SemanticProjection {
  const elements = scene.elements.map((element) => projectElement(element, scene.files));
  const referencedFileIds: string[] = [];
  for (const element of elements) {
    const fileId = element.image?.fileId;
    if (fileId !== null && fileId !== undefined) {
      referencedFileIds.push(fileId);
    }
  }
  const uniqueFileIds: string[] = [...new Set(referencedFileIds)];

  return {
    elements,
    files: uniqueFileIds.map((id) => {
      const file = scene.files[id];
      return {
        id,
        mimeType: file?.mimeType ?? null,
        hasData: file?.dataURL.length > 0,
      };
    }),
  };
}

function difference(
  code: ExcalidrawTicket01SemanticDifferenceCode,
  path: string,
  message: string,
  expected: unknown,
  actual: unknown,
): ExcalidrawTicket01SemanticDifference {
  return { code, path, message, expected, actual };
}

function elementById(
  projection: ExcalidrawTicket01SemanticProjection,
): ReadonlyMap<string, ExcalidrawTicket01SemanticElement> {
  return new Map(projection.elements.map((element) => [element.id, element]));
}

/**
 * Compare two scenes without requiring byte-for-byte equality. Differences are
 * classified by the AC2 invariant they violate so a failed round-trip points to
 * the broken relationship instead of producing a generic object diff.
 */
export function compareExcalidrawTicket01Semantics(
  beforeScene: ExcalidrawTicket01Scene,
  afterScene: ExcalidrawTicket01Scene,
): ExcalidrawTicket01SemanticComparison {
  const before = projectExcalidrawTicket01Semantics(beforeScene);
  const after = projectExcalidrawTicket01Semantics(afterScene);
  const differences: ExcalidrawTicket01SemanticDifference[] = [];
  const beforeIds = before.elements.map((element) => element.id);
  const afterIds = after.elements.map((element) => element.id);

  if (!valuesEqual(beforeIds, afterIds)) {
    differences.push(
      difference(
        "meaningful-order-changed",
        "elements.order",
        `meaningful element order changed: expected [${beforeIds.join(", ")}] but observed [${afterIds.join(", ")}].`,
        beforeIds,
        afterIds,
      ),
    );
  }

  const afterById = elementById(after);
  for (const expectedElement of before.elements) {
    const actualElement = afterById.get(expectedElement.id);
    if (actualElement === undefined) {
      differences.push(
        difference(
          "element-missing",
          `elements.${expectedElement.id}`,
          `element ${expectedElement.id} is missing after round-trip.`,
          expectedElement,
          undefined,
        ),
      );
      continue;
    }

    if (!valuesEqual(expectedElement.type, actualElement.type)) {
      differences.push(
        difference(
          "element-changed",
          `elements.${expectedElement.id}.type`,
          `element ${expectedElement.id} type changed.`,
          expectedElement.type,
          actualElement.type,
        ),
      );
    }
    if (!valuesEqual(expectedElement.geometry, actualElement.geometry)) {
      differences.push(
        difference(
          "element-changed",
          `elements.${expectedElement.id}.geometry`,
          `element ${expectedElement.id} meaningful geometry changed.`,
          expectedElement.geometry,
          actualElement.geometry,
        ),
      );
    }

    const expectedRelationships = expectedElement.relationships;
    const actualRelationships = actualElement.relationships;
    if (!valuesEqual(expectedRelationships.containerId, actualRelationships.containerId)) {
      differences.push(
        difference(
          "wrong-text-container",
          `elements.${expectedElement.id}.relationships.containerId`,
          `text element ${expectedElement.id} has the wrong container: expected ${expectedRelationships.containerId ?? "none"} but observed ${actualRelationships.containerId ?? "none"}.`,
          expectedRelationships.containerId,
          actualRelationships.containerId,
        ),
      );
    }
    if (!valuesEqual(expectedRelationships.groupIds, actualRelationships.groupIds)) {
      differences.push(
        difference(
          "missing-group-member",
          `elements.${expectedElement.id}.relationships.groupIds`,
          `group membership changed for ${expectedElement.id}: expected [${expectedRelationships.groupIds.join(", ")}] but observed [${actualRelationships.groupIds.join(", ")}].`,
          expectedRelationships.groupIds,
          actualRelationships.groupIds,
        ),
      );
    }
    if (!valuesEqual(expectedRelationships.frameId, actualRelationships.frameId)) {
      differences.push(
        difference(
          "missing-frame-membership",
          `elements.${expectedElement.id}.relationships.frameId`,
          `frame membership changed for ${expectedElement.id}: expected ${expectedRelationships.frameId ?? "none"} but observed ${actualRelationships.frameId ?? "none"}.`,
          expectedRelationships.frameId,
          actualRelationships.frameId,
        ),
      );
    }

    const expectedHasConnector = expectedRelationships.boundElements.some(
      (boundElement) => boundElement.type === "arrow",
    );
    const bindingChanged =
      !valuesEqual(expectedRelationships.startBinding, actualRelationships.startBinding) ||
      !valuesEqual(expectedRelationships.endBinding, actualRelationships.endBinding);
    const boundElementsChanged = !valuesEqual(
      expectedRelationships.boundElements,
      actualRelationships.boundElements,
    );
    if (bindingChanged || (expectedHasConnector && boundElementsChanged)) {
      differences.push(
        difference(
          "missing-reciprocal-binding",
          `elements.${expectedElement.id}.relationships`,
          `connector relationship is not reciprocal for ${expectedElement.id}; expected endpoint bindings and boundElements evidence to survive.`,
          expectedRelationships,
          actualRelationships,
        ),
      );
    } else if (boundElementsChanged) {
      differences.push(
        difference(
          "element-changed",
          `elements.${expectedElement.id}.relationships.boundElements`,
          `bound element relationships changed for ${expectedElement.id}.`,
          expectedRelationships.boundElements,
          actualRelationships.boundElements,
        ),
      );
    }

    if (!valuesEqual(expectedElement.text, actualElement.text)) {
      differences.push(
        difference(
          "element-changed",
          `elements.${expectedElement.id}.text`,
          `text content changed for ${expectedElement.id}.`,
          expectedElement.text,
          actualElement.text,
        ),
      );
    }
    if (!valuesEqual(expectedElement.customData, actualElement.customData)) {
      differences.push(
        difference(
          "custom-data-loss",
          `elements.${expectedElement.id}.customData`,
          `customData changed or was dropped for ${expectedElement.id}.`,
          expectedElement.customData,
          actualElement.customData,
        ),
      );
    }
    if (!valuesEqual(expectedElement.image, actualElement.image)) {
      differences.push(
        difference(
          "missing-image-file",
          `elements.${expectedElement.id}.image`,
          `image/file relationship changed for ${expectedElement.id}; expected file ${expectedElement.image?.fileId ?? "none"} with availability ${expectedElement.image?.fileAvailable ? "present" : "missing"}.`,
          expectedElement.image,
          actualElement.image,
        ),
      );
    }
  }

  const diagnostics = differences.map(
    ({ code, path, message }) => `[${code}] ${path}: ${message}`,
  );
  return {
    equal: differences.length === 0,
    before,
    after,
    differences,
    diagnostics,
  };
}

export const projectTicket01ExcalidrawSemantics = projectExcalidrawTicket01Semantics;
export const compareTicket01ExcalidrawSemantics = compareExcalidrawTicket01Semantics;
