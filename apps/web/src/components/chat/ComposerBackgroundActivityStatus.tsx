// FILE: ComposerBackgroundActivityStatus.tsx
// Purpose: Aggregate provider background-work status line stacked above the
// composer input. Pure presenter over the WP3a derivation
// (deriveActiveTurnBackgroundActivityState): aggregate-only by contract, so
// this row renders one lifecycle label + spinner and carries no per-job ids,
// counts, or detail payloads.
// Layer: Chat composer UI
// Exports: ComposerBackgroundActivityStatus

import type { ActiveTurnBackgroundActivityState } from "../../session-logic";
import { LoaderIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  ComposerStackedPanelRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import { COMPOSER_STACKED_PANEL_ICON_CLASS_NAME } from "./composerStackedPanelStyles";

const ACTIVE_LABEL = "Waiting for background tasks…";
const IDLE_OR_FINALIZING_LABEL = "Finishing…";

function backgroundActivityStatusLabel(
  state: ActiveTurnBackgroundActivityState["state"],
): string {
  // `idle` still means background work exists that has not reported completion;
  // from the user's perspective the provider is wrapping the turn up.
  return state === "active" ? ACTIVE_LABEL : IDLE_OR_FINALIZING_LABEL;
}

interface ComposerBackgroundActivityStatusProps {
  backgroundActivity: ActiveTurnBackgroundActivityState | null;
  attachedToPrevious?: boolean;
}

export function ComposerBackgroundActivityStatus({
  backgroundActivity,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerBackgroundActivityStatusProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  if (!backgroundActivity) {
    return null;
  }

  return (
    <ComposerStackedPanel
      passthroughSideMargins
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-background-activity-status"
    >
      <ComposerStackedPanelRow>
        <ComposerStackedPanelRowMain>
          <LoaderIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "animate-spin")} />
          <ComposerStackedPanelRowLabel tone="meta">
            {backgroundActivityStatusLabel(backgroundActivity.state)}
          </ComposerStackedPanelRowLabel>
        </ComposerStackedPanelRowMain>
      </ComposerStackedPanelRow>
    </ComposerStackedPanel>
  );
}
