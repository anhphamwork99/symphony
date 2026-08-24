// FILE: ComposerBackgroundActivityStatus.test.tsx
// Purpose: Pins the aggregate composer background-activity status line: null
//   passthrough, state → label mapping, spinner on every state, stacked-panel
//   chrome reuse, attachedToPrevious merging, and the aggregate-only contract
//   (no detail/count/id surface).
// Layer: Component rendering tests
// Depends on: ComposerBackgroundActivityStatus presenter and React server rendering.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerBackgroundActivityStatus } from "./ComposerBackgroundActivityStatus";
import { COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME } from "./composerStackedPanelStyles";
import { COMPOSER_STACKED_PANEL_ROW_CLASS_NAME } from "./composerStackedPanelStyles";

describe("ComposerBackgroundActivityStatus", () => {
  it("renders nothing for a null background-activity state", () => {
    expect(
      renderToStaticMarkup(<ComposerBackgroundActivityStatus backgroundActivity={null} />),
    ).toBe("");
  });

  it("labels the active state as waiting for background tasks", () => {
    const markup = renderToStaticMarkup(
      <ComposerBackgroundActivityStatus backgroundActivity={{ state: "active" }} />,
    );

    expect(markup).toContain("Waiting for background tasks…");
    expect(markup).not.toContain("Finishing…");
  });

  it.each(["idle", "finalizing"] as const)("labels the %s state as finishing", (state) => {
    const markup = renderToStaticMarkup(
      <ComposerBackgroundActivityStatus backgroundActivity={{ state }} />,
    );

    expect(markup).toContain("Finishing…");
    expect(markup).not.toContain("Waiting for background tasks…");
  });

  it.each(["active", "idle", "finalizing"] as const)(
    "shows a spinner in the %s state and reuses the shared stacked-panel row",
    (state) => {
      const markup = renderToStaticMarkup(
        <ComposerBackgroundActivityStatus backgroundActivity={{ state }} />,
      );

      expect(markup).toContain("animate-spin");
      for (const className of COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME.split(/\s+/)) {
        expect(markup).toContain(className);
      }
      expect(markup).toContain(COMPOSER_STACKED_PANEL_ROW_CLASS_NAME);
      expect(markup).toContain('data-testid="composer-background-activity-status"');
    },
  );

  it("marks the panel attached to the previous stacked panel only when requested", () => {
    const detachedMarkup = renderToStaticMarkup(
      <ComposerBackgroundActivityStatus backgroundActivity={{ state: "active" }} />,
    );
    const attachedMarkup = renderToStaticMarkup(
      <ComposerBackgroundActivityStatus
        backgroundActivity={{ state: "active" }}
        attachedToPrevious
      />,
    );

    expect(detachedMarkup).not.toContain("data-composer-stacked-attached");
    expect(attachedMarkup).toContain('data-composer-stacked-attached="true"');
  });

  it("renders no per-job detail, counts, or ids", () => {
    const markup = renderToStaticMarkup(
      <ComposerBackgroundActivityStatus backgroundActivity={{ state: "active" }} />,
    );

    expect(markup).not.toMatch(/data-testid="[^"]*(?:count|detail|job|task-id)[^"]*"/i);
    // Aggregate-only status line: exactly one label text node beyond chrome classes.
    const labels = markup.match(/Waiting for background tasks…/g);
    expect(labels).toHaveLength(1);
  });
});
