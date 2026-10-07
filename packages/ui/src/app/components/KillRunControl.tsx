import { useState } from "react";
import { CONFIRM_KILL_RUN, useRunKill } from "../data/useRunKill";
import { useConfirm } from "./ConfirmDialog";
import styles from "./KillRunControl.module.scss";

// A control for killing an in-flight run, shown in the live monitor while the run
// is still running. See {@link useRunKill}, which owns the gate shared with the
// runs-list batch menu.
//
// It HIDES only where this host can cancel no run at all — the static gallery, or
// a worker whose transport cannot cancel — and renders DISABLED, with the reason
// on it, where the console could cancel but nobody is signed in. Vanishing for a
// state the operator can fix from the page they are on tells them nothing.
//
// On success the backend moves the run to `canceled` and closes its live stream,
// which the monitor's own subscription reflects (its `onDone` fires and the page
// transitions to the done state), so this control does not itself navigate — it
// only issues the request and reports a failure inline.
export function KillRunControl({ runId }: { runId: string }) {
  const { killGate, killRun } = useRunKill();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!killGate.offered) return null;

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

  const blocked = !killGate.allowed;
  return (
    <div className={styles.killControl}>
      <button
        type="button"
        className={styles.killButton}
        onClick={onKill}
        disabled={busy || blocked}
        data-blocked={blocked ? "" : undefined}
        title={gateTitle(busy, blocked, killGate.reason)}
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

// What the button says about itself on hover: what it is doing, why it cannot be
// pressed, or what it does.
function gateTitle(
  busy: boolean,
  blocked: boolean,
  reason: string | null,
): string {
  if (busy) return "Killing…";
  if (blocked && reason) return reason;
  return "Stop this in-progress run";
}
