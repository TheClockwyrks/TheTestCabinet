import { useState } from "react";
import { useNavigate } from "react-router";
import { CONFIRM_DELETE_RUN, useRunDeletion } from "../data/useRunDeletion";
import { useConfirm } from "./ConfirmDialog";
import { routes } from "../routes";
import { TrashIcon } from "./TrashIcon";
import styles from "./RunDeleteControl.module.scss";

interface RunDeleteControlProps {
  runId: string;
  /**
   * Whether the run has been published, as the page that resolved its record
   * knows it. This is what makes the control correct for a run the produced
   * worklist has not caught up with — a run just canceled, whose partial record
   * is still being written — so pass it wherever the record is in hand. Omitted,
   * the gate falls back to the (lagging) worklist.
   */
  published?: boolean;
}

// A destructive control for permanently deleting a run (see {@link
// useRunDeletion} for the full gate).
//
// It HIDES only where this host can delete no run at all — the static gallery, a
// worker whose transport cannot delete, a logged-out console — and otherwise
// renders DISABLED with the reason on it. That distinction is the point: a run
// the console cannot delete *yet* is a transient state, and a control that simply
// vanishes for it tells the operator nothing, which is exactly how a canceled run
// came to look permanently undeletable.
//
// Deleting removes the run record, its reviews, and its stored media. On success
// the run no longer exists, so we leave the (now-dead) detail page for the runs
// list. A failure keeps the user on the page with the reason shown inline.
export function RunDeleteControl({ runId, published }: RunDeleteControlProps) {
  const { deletionGate, deleteRun } = useRunDeletion();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gate = deletionGate(
    published === undefined ? runId : { id: runId, published },
  );
  if (!gate.offered) return null;

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

  const blocked = !gate.allowed;
  return (
    <div className={styles.deleteControl}>
      <button
        type="button"
        className={styles.deleteButton}
        onClick={onDelete}
        disabled={busy || blocked}
        data-blocked={blocked ? "" : undefined}
        aria-label={busy ? "Deleting run…" : "Delete run"}
        title={
          busy
            ? "Deleting…"
            : (gate.reason ?? "Permanently delete this unpublished run")
        }
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
