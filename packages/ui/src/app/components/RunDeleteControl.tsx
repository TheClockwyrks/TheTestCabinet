import { useState } from "react";
import { useNavigate } from "react-router";
import { CONFIRM_DELETE_RUN, useRunDeletion } from "../data/useRunDeletion";
import { useConfirm } from "./ConfirmDialog";
import { routes } from "../routes";
import { TrashIcon } from "./TrashIcon";
import styles from "./RunDeleteControl.module.scss";

// A destructive control for permanently deleting a run, offered only where it is
// allowed (see {@link useRunDeletion} for the full gate): an **unpublished** run
// the active worker produced, on a host that can execute runs, with a worker
// whose transport supports deletion and a signed-in account. When the gate
// refuses the run the control hides entirely rather than showing a disabled,
// unexplained button.
//
// Deleting removes the run record, its reviews, and its stored media. On success
// the run no longer exists, so we leave the (now-dead) detail page for the runs
// list. A failure keeps the user on the page with the reason shown inline.
export function RunDeleteControl({ runId }: { runId: string }) {
  const { canDelete, deleteRun } = useRunDeletion();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canDelete(runId)) return null;

  const onDelete = async () => {
    if (!(await confirm(CONFIRM_DELETE_RUN))) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRun(runId);
      // The run is gone: leave the detail page (which would now 404 on a reload)
      // for the runs list.
      navigate(routes.runs());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className={styles.deleteControl}>
      <button
        type="button"
        className={styles.deleteButton}
        onClick={onDelete}
        disabled={busy}
        aria-label={busy ? "Deleting run…" : "Delete run"}
        title={busy ? "Deleting…" : "Permanently delete this unpublished run"}
      >
        <TrashIcon className={styles.deleteIcon} />
      </button>
      {error && (
        <span className={styles.deleteError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
