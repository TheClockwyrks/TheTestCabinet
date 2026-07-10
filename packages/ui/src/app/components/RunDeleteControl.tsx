import { useState } from "react";
import { useNavigate } from "react-router";
import { useWorkers } from "../../client/context";
import { useAuth } from "../../client/auth";
import { useGalleryData } from "../data/galleryContext";
import { useRunsRuntime } from "../runtime/runsRuntime";
import { routes } from "../routes";
import styles from "./RunDeleteControl.module.scss";

// A destructive control for permanently deleting a run, offered only where it is
// allowed: an **unpublished** run the active worker produced (`localIds` is the
// pushed-but-unpublished worklist, so a published run — absent from it — never
// shows the affordance), with a worker whose transport supports deletion and a
// signed-in account whose token authorizes it. The backend is the real gate: it
// refuses a published run regardless, so this is the matching UI restriction.
//
// Deleting removes the run record, its reviews, and its stored media. On success
// the run no longer exists, so we leave the (now-dead) detail page for the runs
// list and nudge the data source to drop it from the worklist. A failure keeps
// the user on the page with the reason shown inline.
export function RunDeleteControl({ runId }: { runId: string }) {
  const { canExecute, localIds } = useGalleryData();
  const { active: worker } = useWorkers();
  const { token } = useAuth();
  const runtime = useRunsRuntime();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = worker?.client ?? null;
  // Every condition that makes deletion possible here; any one missing hides the
  // control entirely rather than showing a disabled, unexplained button.
  const deletable =
    canExecute &&
    localIds.has(runId) &&
    Boolean(client?.deleteRun) &&
    Boolean(token);
  if (!deletable) return null;

  const onDelete = async () => {
    if (!client?.deleteRun || !token) return;
    if (
      !window.confirm(
        "Delete this run permanently? Its record, reviews, and stored media are " +
          "removed. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.deleteRun(runId, token);
      // The run is gone: refresh the worklist so it drops out, then leave the
      // detail page (which would now 404 on a reload).
      runtime.requestRefresh();
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
        title="Permanently delete this unpublished run"
      >
        {busy ? "Deleting…" : "Delete run"}
      </button>
      {error && (
        <span className={styles.deleteError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
