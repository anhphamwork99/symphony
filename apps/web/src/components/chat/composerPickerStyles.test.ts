// FILE: composerPickerStyles.test.ts
// Purpose: Pins the shared composer picker option-row interaction token (cursor + disabled non-interactivity).
// Layer: Chat composer regression test
// Depends on: composerPickerStyles option tokens shared by ui/menu.tsx, ui/select.tsx, and picker popups.

import { describe, expect, it } from "vitest";

import {
  COMPOSER_PICKER_MENU_OPTION_CLASS_NAME,
  COMPOSER_PICKER_SELECT_OPTION_CLASS_NAME,
} from "./composerPickerStyles";

describe("COMPOSER_PICKER_MENU_OPTION_CLASS_NAME", () => {
  const classes = COMPOSER_PICKER_MENU_OPTION_CLASS_NAME.split(/\s+/);

  it("shows the pointer cursor for enabled options", () => {
    expect(classes).toContain("cursor-pointer");
    expect(classes).not.toContain("cursor-default");
  });

  it("keeps disabled options non-interactive with the default cursor", () => {
    // pointer-events must stay suppressed on disabled rows.
    expect(classes).toContain("data-disabled:pointer-events-none");
    // Enabled cursor-pointer is overridden back to the platform default on disabled rows,
    // so disabled options never advertise clickability while remaining inert.
    expect(classes).toContain("data-disabled:cursor-default");
  });

  it("preserves option row semantics: highlight, opacity, and layout classes", () => {
    // Keyboard/hover highlight fill + text color.
    expect(classes).toContain("data-highlighted:bg-[var(--color-background-button-secondary-hover)]");
    expect(classes).toContain("data-highlighted:text-[var(--color-text-foreground)]");
    // Disabled dimming.
    expect(classes).toContain("data-disabled:opacity-64");
    // Base layout/interaction hygiene shared by every option row.
    expect(classes).toContain("flex");
    expect(classes).toContain("select-none");
    expect(classes).toContain("items-center");
    expect(classes).toContain("outline-none");
    expect(classes).toContain("text-[length:var(--app-font-size-ui,12px)]");
    // Leading icons stay inert and sized within the row.
    expect(classes).toContain("[&>svg,&>[data-slot=central-icon]]:pointer-events-none");
    expect(classes).toContain("[&>svg,&>[data-slot=central-icon]]:shrink-0");
  });
});

describe("COMPOSER_PICKER_SELECT_OPTION_CLASS_NAME", () => {
  it("inherits the enabled pointer cursor and the disabled default-cursor override", () => {
    const classes = COMPOSER_PICKER_SELECT_OPTION_CLASS_NAME.split(/\s+/);

    expect(classes).toContain("cursor-pointer");
    expect(classes).not.toContain("cursor-default");
    expect(classes).toContain("data-disabled:cursor-default");
    expect(classes).toContain("data-disabled:pointer-events-none");
    // Select item grid layout adaptation stays intact.
    expect(classes).toContain("grid");
    expect(classes).toContain("in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)]");
  });
});
