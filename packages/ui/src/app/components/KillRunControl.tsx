import { useState } from "react";
import { CONFIRM_KILL_RUN, useRunKill } from "../data/useRunKill";
import { useConfirm } from "./ConfirmDialog";
import styles from "./KillRunControl.module.scss";

// A control for killing an in-flight run, shown in the live monitor while the run
// is still running. Offered only where cancellation is possible — see {@link
// useRunKill}, which owns the gate (execution-enabled host, a worker whose
// transport supports it, and an authorizing token) shared with the runs-list
// batch menu; any one missing hides the control entirely rather than showing a
// disabled, unexplained button. The backend is the real gate: it refuses to
// cancel a run that already finished, so this mirrors that as a UI affordance.
//
// On success the backend moves the run to `canceled` and closes its live stream,
// which the monitor's own subscription reflects (its `onDone` fires and the page
// transitions to the done state), so this control does not itself navigate — it
// only issues the request and reports a failure inline.
export function KillRunControl({ runId }: { runId: string }) {
  const { canKill, killRun } = useRunKill();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canKill) return null;

  const onKill = async () => {
    if (!(await confirm(CONFIRM_KILL_RUN))) return;
    setBusy(true);
    setError(null);
    try {
      await killRun(runId);
      // The backend closes the live stream on cancel; the monitor's subscription
      // fires `onDone` and takes over the page from here. Leave `busy` set so the
      // button reads "Killing…" through the brief window until that transition.
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className={styles.killControl}>
      <button
        type="button"
        className={styles.killButton}
        onClick={onKill}
        disabled={busy}
        title="Stop this in-progress run"
      >
        {busy ? "Killing…" : "Kill run"}
      </button>
      {error && (
        <span className={styles.killError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
