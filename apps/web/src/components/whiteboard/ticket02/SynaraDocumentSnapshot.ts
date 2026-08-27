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
  // `lastCommittedPoint` is package editing state, not document meaning.
  "fileId",
  "scale",
  // Excalidraw's seed/version/index/deletion/update fields are package
  // normalization and history state, so they are intentionally excluded.
  "name",
  "customData",
] as const;

export interface SynaraActiveFileReference {
  readonly fileId: string;
  readonly mimeType: string | null;
  readonly created: number | null;
}

export interface SynaraDocumentSnapshot {
  readonly elements: readonly SynaraSceneElement[];
  readonly files: Readonly<Record<string, SynaraSceneFile>>;
  readonly activeFileReferences: readonly SynaraActiveFileReference[];
  readonly semanticFingerprint: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Convert package/caller values into an owned, JSON-shaped value. In
 * particular, no Date, Map, Set, typed array, class instance, or other
 * mutable host object is allowed to cross the snapshot boundary.
 */
function canonicalizeValue(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return null;
  }
  if (typeof value === "bigint") return value.toString();

  const object = value as object;
  if (active.has(object)) throw new TypeError("canonical snapshot cannot contain a cyclic value");
  active.add(object);
  try {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.toString();
    if (value instanceof ArrayBuffer) return [...new Uint8Array(value)].map((entry) => entry);
    if (ArrayBuffer.isView(value)) {
      return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (value instanceof Map) {
      return [...value.entries()]
        .map(([key, nested]) => [
          canonicalizeValue(key, active),
          canonicalizeValue(nested, active),
        ])
        .toSorted(([left], [right]) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    if (value instanceof Set) {
      return [...value.values()]
        .map((nested) => canonicalizeValue(nested, active))
        .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    if (Array.isArray(value)) {
      return value.map((nested) => canonicalizeValue(nested, active));
    }

    // Class instances are copied by their enumerable data only. This strips
    // prototype methods and preserves no caller-owned object identity.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeValue(nested, active)]),
    );
  } finally {
    active.delete(object);
  }
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

function canonicalOwnedValue(value: unknown): unknown {
  return canonicalizeValue(value, new WeakSet<object>());
}

/**
 * The named canonical semantic projection: canonical element fields only,
 * sorted by stable id, with package-default normalization through the
 * restore-owned fields already applied upstream.
 */
export function canonicalSemanticProjection(
  scene: Pick<SynaraSceneSnapshot, "elements" | "files">,
): {
  readonly elements: readonly SynaraSceneElement[];
  readonly activeFileReferences: readonly SynaraActiveFileReference[];
} {
  const elements = [...scene.elements]
    .map((element) => {
      const projected: Record<string, unknown> = {};
      for (const field of CANONICAL_ELEMENT_FIELDS) {
        const value = (element as Record<string, unknown>)[field];
        if (value !== undefined) {
          projected[field] = canonicalOwnedValue(value);
        }
      }
      return projected as unknown as SynaraSceneElement;
    })
    .toSorted((left, right) => {
      const leftId = String((left as Record<string, unknown>).id ?? "");
      const rightId = String((right as Record<string, unknown>).id ?? "");
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });

  const referencedFileIds = new Set(
    scene.elements.flatMap((element) => {
      const fileId = (element as Record<string, unknown>).fileId;
      return typeof fileId === "string" ? [fileId] : [];
    }),
  );
  const activeFileReferences = Object.entries(scene.files ?? {})
    .filter(([fileId]) => referencedFileIds.has(fileId))
    .map(([fileId, file]) => {
      const record = file as Record<string, unknown>;
      // The Excalidraw file map key is authoritative. `file.id` is package
      // metadata and can be stale/malformed; never confuse it with fileId.
      return {
        fileId,
        mimeType:
          typeof record.mimeType === "string" ? record.mimeType : null,
        created:
          typeof record.created === "number" && Number.isFinite(record.created)
            ? record.created
            : null,
      } satisfies SynaraActiveFileReference;
    })
    .toSorted((left, right) =>
      left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0,
    );

  return Object.freeze({
    elements: Object.freeze(elements),
    activeFileReferences: Object.freeze(activeFileReferences),
  });
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
  return JSON.stringify(stableValue(canonicalSemanticProjection(scene)));
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
    semanticFingerprint: JSON.stringify(stableValue(projection)),
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
