// FILE: ComposerStackedPanel.test.tsx
// Purpose: Isolation contract for the execution-strip stacked-panel variant:
// the default ComposerStackedPanel chrome is unchanged (rail inset, border,
// shared translucent surface) while the execution-strip variant is full
// width, borderless, and uses a transparent surface token. The two
// variants must not share styling surface so the strip cleanup cannot alter
// plan/queue/file-change panels.
// Layer: Web chat component tests
// Depends on: renderToStaticMarkup (SSR-safe class contracts).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerStackedPanel, ComposerStackedPanelExecutionStrip } from "./ComposerStackedPanel";

vi.mock("~/lib/utils", () => ({
  // Identity joiner: keep raw class order (first-wins) so the test asserts
  // the ACTUAL authored class sequence instead of tailwind-merge behavior.
  cn: (...inputs: ReadonlyArray<string | false | null | undefined>) =>
    inputs.filter((input): input is string => typeof input === "string").join(" "),
}));

vi.mock("./ComposerColumnFrame", () => ({
  ComposerStackedHeaderFrame: ({
    children,
    className,
    ...rest
  }: {
    children: React.ReactNode;
    className?: string;
  } & Record<string, unknown>) => (
    <div data-testid="stacked-header-frame" className={className} {...rest}>
      {children}
    </div>
  ),
}));

describe("ComposerStackedPanel variants", () => {
  it("default panel keeps the shared stacked chrome (rail inset, border, glass surface)", () => {
    const markup = renderToStaticMarkup(<ComposerStackedPanel>rows</ComposerStackedPanel>);
    expect(markup).toContain("chat-composer-stacked-top");
    expect(markup).toContain("border-b-0");
    expect(markup).not.toContain("w-full");
    expect(markup).not.toContain("--color-background-elevated-secondary");
  });

  it("execution-strip variant is full width, borderless, and uses a transparent surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerStackedPanelExecutionStrip>rows</ComposerStackedPanelExecutionStrip>,
    );
    expect(markup).toContain("w-full");
    expect(markup).toContain("bg-transparent");
    expect(markup).not.toContain("bg-[var(--color-background-elevated-secondary)]");
    expect(markup).toContain("rounded-t-[var(--composer-radius)]");
    // Borderless and no default panel chrome bleed.
    expect(markup).not.toContain("chat-composer-stacked-top");
    expect(markup).not.toContain("border-b-0");
    expect(markup).not.toContain("w-11/12");
  });

  it("execution-strip variant still carries the attached seam marker and forwards panel props", () => {
    const markup = renderToStaticMarkup(
      <ComposerStackedPanelExecutionStrip
        attachedToPrevious
        passthroughSideMargins
        data-testid="strip-frame"
      >
        rows
      </ComposerStackedPanelExecutionStrip>,
    );
    expect(markup).toContain('data-composer-stacked-attached="true"');
    expect(markup).toContain('data-testid="strip-frame"');
    // The variant supplies `w-full` itself; the frame's `w-11/12` rail inset
    // is never part of the execution-strip surface.
    expect(markup).not.toContain("w-11/12");
    expect(markup).toContain("w-full");
    expect(markup).toContain("rounded-t-none");
  });

  it("custom className is appended after the variant chrome (caller can still extend)", () => {
    const markup = renderToStaticMarkup(
      <ComposerStackedPanelExecutionStrip className="extra-chrome">
        rows
      </ComposerStackedPanelExecutionStrip>,
    );
    const classes = markup.slice(markup.indexOf('class="') + 'class="'.length);
    const classList = classes.slice(0, classes.indexOf('"')).split(" ");
    expect(classList.at(-1)).toBe("extra-chrome");
  });
});
