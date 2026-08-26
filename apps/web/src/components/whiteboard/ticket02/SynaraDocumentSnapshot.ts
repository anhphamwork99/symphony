import type {
  SynaraSceneElement,
  SynaraSceneFile,
  SynaraSceneSnapshot,
} from "../ticket01/SynaraExcalidrawAdapter";

export interface SynaraDocumentSnapshot {
  readonly elements: readonly SynaraSceneElement[];
  readonly files: Readonly<Record<string, SynaraSceneFile>>;
  readonly selectedElementIds: readonly string[];
  readonly semanticFingerprint: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function semanticFingerprint(
  scene: Pick<SynaraSceneSnapshot, "elements" | "files">,
): string {
  return JSON.stringify(stableValue({ elements: scene.elements, files: scene.files }));
}

export function captureDocumentSnapshot(scene: SynaraSceneSnapshot): SynaraDocumentSnapshot {
  const elements = clone(scene.elements);
  const files = clone(scene.files);
  const snapshot = {
    elements,
    files,
    selectedElementIds: [...scene.selectedElementIds].toSorted(),
    semanticFingerprint: semanticFingerprint({ elements, files }),
  } satisfies SynaraDocumentSnapshot;
  return Object.freeze(snapshot);
}

export function documentSnapshotsEqual(
  left: SynaraDocumentSnapshot,
  right: SynaraDocumentSnapshot,
): boolean {
  return left.semanticFingerprint === right.semanticFingerprint;
}

export function toSceneSnapshot(snapshot: SynaraDocumentSnapshot): SynaraSceneSnapshot {
  return {
    elements: clone(snapshot.elements),
    files: clone(snapshot.files),
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    selectedElementIds: [...snapshot.selectedElementIds],
  };
}
