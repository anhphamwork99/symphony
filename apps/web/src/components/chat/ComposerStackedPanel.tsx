// FILE: ComposerStackedPanel.tsx
// Purpose: Shared chrome for panels stacked above the composer input.
// Layer: Chat composer layout primitive
// Exports: ComposerStackedPanel, ComposerStackedPanelExecutionStrip (isolated
//          execution-strip variant), and the divider token for inner rows.

import { type HTMLAttributes, type ReactNode, type Ref } from "react";

import { cn } from "~/lib/utils";
import { ComposerStackedHeaderFrame } from "./ComposerColumnFrame";
import {
  COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME,
  COMPOSER_STACKED_PANEL_EXECUTION_STRIP_CLASS_NAME,
} from "./composerStackedPanelStyles";

export { COMPOSER_STACKED_PANEL_DIVIDER_CLASS_NAME } from "./composerStackedPanelStyles";

interface ComposerStackedPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
  /** Removes the top radius so this panel visually merges into the one above it. */
  attachedToPrevious?: boolean;
  /** Lets clicks pass through the side margins to the transcript underneath. */
  passthroughSideMargins?: boolean;
}

/** Single owner for composer-stacked panel frame, border, radius, and surface chrome. */
export function ComposerStackedPanel({
  children,
  className,
  ref,
  attachedToPrevious: attachedToPreviousProp,
  passthroughSideMargins: passthroughSideMarginsProp,
  ...rest
}: ComposerStackedPanelProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const passthroughSideMargins = passthroughSideMarginsProp ?? false;
  return (
    <ComposerStackedHeaderFrame
      ref={ref}
      passthroughSideMargins={passthroughSideMargins}
      data-composer-stacked-attached={attachedToPrevious ? "true" : undefined}
      className={cn(COMPOSER_STACKED_PANEL_CHROME_CLASS_NAME, className)}
      {...rest}
    >
      {children}
    </ComposerStackedHeaderFrame>
  );
}

/**
 * Isolated execution-strip variant: full width inside ComposerColumnFrame (no
 * `w-11/12` rail inset), borderless, with its own elevated secondary surface.
 * Deliberately NOT a `variant` on the default panel — default stacked panels
 * (plan activity, queued follow-ups, live file changes) keep the shared
 * translucent glass chrome untouched.
 */
export function ComposerStackedPanelExecutionStrip({
  children,
  className,
  ref,
  attachedToPrevious: attachedToPreviousProp,
  passthroughSideMargins: passthroughSideMarginsProp,
  ...rest
}: ComposerStackedPanelProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const passthroughSideMargins = passthroughSideMarginsProp ?? false;
  return (
    <ComposerStackedHeaderFrame
      ref={ref}
      passthroughSideMargins={passthroughSideMargins}
      data-composer-stacked-attached={attachedToPrevious ? "true" : undefined}
      // `w-full` is merged after the frame's `w-11/12` rail inset via
      // tailwind-merge, so the strip spans ComposerColumnFrame edge to edge.
      className={cn(
        "w-full",
        COMPOSER_STACKED_PANEL_EXECUTION_STRIP_CLASS_NAME,
        attachedToPrevious && "rounded-t-none",
        className,
      )}
      {...rest}
    >
      {children}
    </ComposerStackedHeaderFrame>
  );
}
