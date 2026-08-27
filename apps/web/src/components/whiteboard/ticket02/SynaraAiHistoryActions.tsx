/**
 * Synara-owned AI history actions for the bounded Gate replacement contract.
 *
 * Exact labels only: `Undo AI batch` and `Redo AI batch`. `aria-disabled`
 * keeps unavailable actions discoverable with their exact reason. There is
 * no AI keyboard chord and no interception of native shortcuts.
 */

export interface SynaraAiHistoryActionsProps {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoReason: string;
  readonly redoReason: string;
  readonly busy: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

const UNDO_LABEL = "Undo AI batch";
const REDO_LABEL = "Redo AI batch";

export function SynaraAiHistoryActions(props: SynaraAiHistoryActionsProps) {
  const disabledByLock = props.busy;
  const undoEnabled = props.canUndo && !disabledByLock;
  const redoEnabled = props.canRedo && !disabledByLock;
  return (
    <div role="toolbar" aria-label="AI history" data-ticket02-ai-history="true">
      <button
        type="button"
        aria-label={UNDO_LABEL}
        title={
          undoEnabled ? "Undo the latest AI batch. Manual undo is separate." : props.undoReason
        }
        aria-disabled={!undoEnabled}
        data-ticket02-action="undo-ai-batch"
        data-ticket02-reason={props.undoReason}
        onClick={() => {
          if (!undoEnabled) return;
          props.onUndo();
        }}
      >
        {UNDO_LABEL}
      </button>
      <button
        type="button"
        aria-label={REDO_LABEL}
        title={
          redoEnabled ? "Redo the last undone AI batch. Manual redo is separate." : props.redoReason
        }
        aria-disabled={!redoEnabled}
        data-ticket02-action="redo-ai-batch"
        data-ticket02-reason={props.redoReason}
        onClick={() => {
          if (!redoEnabled) return;
          props.onRedo();
        }}
      >
        {REDO_LABEL}
      </button>
    </div>
  );
}
