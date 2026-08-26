import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const adapterPath = join(directory, "SynaraExcalidrawAdapter.tsx");
const harnessPath = join(directory, "ExcalidrawTicket01Harness.tsx");
const testPath = join(directory, "excalidrawImportBoundary.test.ts");

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("Ticket 01 Excalidraw import boundary", () => {
  it("keeps runtime package and CSS imports in the adapter leaf", async () => {
    const [adapter, harness, test] = await Promise.all([
      source(adapterPath),
      source(harnessPath),
      source(testPath),
    ]);

    expect(adapter).toContain('from "@excalidraw/excalidraw"');
    expect(adapter).toContain('"@excalidraw/excalidraw/index.css"');
    expect(harness).not.toContain("@excalidraw/excalidraw");
    expect(test).toContain("@excalidraw/excalidraw");
  });

  it("does not leak package element or application-state types through Synara exports", async () => {
    const adapter = await source(adapterPath);
    const exportedRawType =
      /export[^\n]*(ExcalidrawAPI|AppState|BinaryFiles|ExcalidrawElement|OrderedExcalidrawElement)/;

    expect(adapter).not.toMatch(exportedRawType);
    expect(adapter).toContain("export interface SynaraExcalidrawHandle");
    expect(adapter).toContain("export interface SynaraSceneInput");
  });

  it("lazy-loads the adapter and preserves an explicit failure surface", async () => {
    const harness = await source(harnessPath);

    expect(harness).toContain('import("./SynaraExcalidrawAdapter")');
    expect(harness).toContain("<Suspense fallback={<LoadingState />}>");
    expect(harness).toContain("lazy-load-failed");
    expect(harness).toContain("data-ticket01-mount-count={mountCount}");
    expect(harness).toContain("data-ticket01-diagnostic-count={diagnosticsRef.current.length}");
  });

  it("uses imperative updates rather than progressive initial-data replacement", async () => {
    const adapter = await source(adapterPath);
    const updateStart = adapter.indexOf("const updateScene = useCallback");
    const updateEnd = adapter.indexOf("const setViewMode = useCallback", updateStart);
    const updateBlock = adapter.slice(updateStart, updateEnd);

    expect(updateStart).toBeGreaterThanOrEqual(0);
    expect(updateBlock).not.toContain("initialData");
    expect(updateBlock).toContain("api.updateScene");
    expect(adapter).toContain("lastUpdateSequenceRef.current + 1");
    expect(adapter).toContain("update-order-mismatch");
  });

  it("keeps the Ticket 01 boundary isolated without a production barrel", async () => {
    const entries = await (await import("node:fs/promises")).readdir(directory);
    expect(entries).toEqual(
      expect.arrayContaining([
        "ExcalidrawTicket01Harness.tsx",
        "SynaraExcalidrawAdapter.tsx",
        "excalidrawImportBoundary.test.ts",
        "excalidrawTicket01Fixture.test.ts",
        "excalidrawTicket01Fixture.ts",
        "excalidrawTicket01Semantics.ts",
      ]),
    );
    expect(entries).not.toContain("index.ts");
    expect(entries).not.toContain("index.tsx");
  });
});
