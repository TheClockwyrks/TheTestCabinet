import { useState } from "react";
import { useWorkers } from "../../client/context";
import { useAuth } from "../../client/auth";
import { useGalleryData } from "../data/galleryContext";
import styles from "./KillRunControl.module.scss";

// A control for killing an in-flight run, shown in the live monitor while the run
// is still running. Offered only where cancellation is possible: an
// execution-enabled console (`canExecute`), a worker whose transport supports it
// (`killRun`), and a signed-in account whose token authorizes it — any one missing
// hides the control entirely rather than showing a disabled, unexplained button.
// The backend is the real gate: it refuses to cancel a run that already finished,
// so this mirrors that as a UI affordance.
//
// On success the backend moves the run to `canceled` and closes its live stream,
// which the monitor's own subscription reflects (its `onDone` fires and the page
// transitions to the done state), so this control does not itself navigate — it
// only issues the request and reports a failure inline.
export function KillRunControl({ runId }: { runId: string }) {
  const { canExecute } = useGalleryData();
  const { active: worker } = useWorkers();
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = worker?.client ?? null;
  const killable = canExecute && Boolean(client?.killRun) && Boolean(token);
  if (!killable) return null;

  const onKill = async () => {
    if (!client?.killRun || !token) return;
    if (
      !window.confirm(
        "Kill this run? It stops immediately and is recorded as canceled. This " +
          "cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.killRun(runId, token);
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
