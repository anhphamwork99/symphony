import type {
  SynaraSceneElement,
  SynaraSceneFile,
  SynaraSceneSnapshot,
} from "../ticket01/SynaraExcalidrawAdapter";

/**
 * Deep canonical snapshot ownership (plan §4.1).
 *
 * One named canonical semantic projection is the single source for capture,
 * verification, no-op comparison, and evidence. It excludes viewport, zoom,
 * selection, active tool, dialogs, theme, transient status, and the complete
 * package `AppState`. Fingerprints are computed only from this projection and
 * are never provenance, identity, callback correlation, or applicability
 * authority — those live in the adapter's opaque scope records.
 */

/** Semantic element fields retained by the canonical projection. */
const CANONICAL_ELEMENT_FIELDS = [
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "groupIds",
  "frameId",
  "containerId",
  "boundElements",
  "text",
  "originalText",
  "fontSize",
  "fontFamily",
  "textAlign",
  "verticalAlign",
  "lineHeight",
  "points",
  "startBinding",
  "endBinding",
  "startArrowhead",
  "endArrowhead",
  "lastCommittedPoint",
  "fileId",
  "scale",
  "seed",
  "version",
  "versionNonce",
  "index",
  "isDeleted",
  "updated",
  "name",
  "customData",
  "status",
] as const;

/** Semantic file-reference metadata retained by the projection. */
const CANONICAL_FILE_FIELDS = ["id", "mimeType", "created"] as const;

export interface SynaraActiveFileReference {
  readonly fileId: string;
  readonly mimeType: string;
  readonly created: number;
}

export interface SynaraDocumentSnapshot {
  readonly elements: readonly SynaraSceneElement[];
  readonly files: Readonly<Record<string, SynaraSceneFile>>;
  readonly activeFileReferences: readonly SynaraActiveFileReference[];
  readonly semanticFingerprint: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneFrozen<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneFrozen(entry))) as unknown as T;
  }
  if (isPlainObject(value)) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneFrozen(nested)])),
    ) as unknown as T;
  }
  return value;
}

/**
 * The named canonical semantic projection: canonical element fields only,
 * sorted by stable id, with package-default normalization through the
 * restore-owned fields already applied upstream.
 */
export function canonicalSemanticProjection(
  scene: Pick<SynaraSceneSnapshot, "elements" | "files">,
): { readonly elements: readonly SynaraSceneElement[]; readonly activeFileReferences: readonly SynaraActiveFileReference[] } {
  const elements = [...scene.elements]
    .map((element) => {
      const projected: Record<string, unknown> = {};
      for (const field of CANONICAL_ELEMENT_FIELDS) {
        if (field in (element as Record<string, unknown>)) {
          projected[field] = (element as Record<string, unknown>)[field];
        }
      }
      return projected as unknown as SynaraSceneElement;
    })
    .toSorted((left, right) => {
      const leftId = String((left as Record<string, unknown>).id ?? "");
      const rightId = String((right as Record<string, unknown>).id ?? "");
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });

  const activeFileReferences = Object.values(scene.files ?? {})
    .map((file) => {
      const record = file as Record<string, unknown>;
      const projected: Record<string, unknown> = {};
      for (const field of CANONICAL_FILE_FIELDS) {
        if (field in record) projected[field] = record[field];
      }
      return projected as unknown as SynaraActiveFileReference;
    })
    .toSorted((left, right) =>
      left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0,
    );

  return { elements, activeFileReferences };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

/** Content-only fingerprint over the canonical semantic projection. */
export function semanticFingerprint(
  scene: Pick<SynaraSceneSnapshot, "elements" | "files">,
): string {
  const { elements, activeFileReferences } = canonicalSemanticProjection(scene);
  return JSON.stringify(stableValue({ elements, activeFileReferences }));
}

/**
 * Deep-clone and deep-freeze at capture time. No mutable package object,
 * array, binary view, or caller-owned reference is retained. The Gate is
 * image-free: active file IDs/metadata are stored as a closed reference set,
 * never as binary payloads.
 */
export function captureDocumentSnapshot(scene: SynaraSceneSnapshot): SynaraDocumentSnapshot {
  const projection = canonicalSemanticProjection(scene);
  const elements = cloneFrozen(projection.elements);
  const files = Object.freeze({});
  const activeFileReferences = cloneFrozen(projection.activeFileReferences);
  return Object.freeze({
    elements,
    files,
    activeFileReferences,
    semanticFingerprint: semanticFingerprint({ elements, files: {} }),
  });
}

/** Equality over the canonical projection only — never provenance. */
export function documentSnapshotsEqual(
  left: SynaraDocumentSnapshot,
  right: SynaraDocumentSnapshot,
): boolean {
  return left.semanticFingerprint === right.semanticFingerprint;
}

/** Rebuild a restore input from a frozen snapshot; never mutates the source. */
export function toSceneSnapshot(snapshot: SynaraDocumentSnapshot): SynaraSceneSnapshot {
  const thawed = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(thawed);
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, thawed(nested)]));
    }
    return value;
  };
  return {
    elements: thawed(snapshot.elements) as SynaraSceneElement[],
    files: {},
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    selectedElementIds: [],
  };
}
