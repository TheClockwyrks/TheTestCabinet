import { useCallback } from "react";
import { useOptionalWorkers } from "../../client/context";
import { useAuth } from "../../client/auth";
import { useGalleryData } from "./galleryContext";
import { useRunsRuntime } from "../runtime/runsRuntime";
import type { ConfirmOptions } from "../components/ConfirmDialog";
import { awaitCanceledRunRecords } from "./canceledRunRecords";

/** The shared confirmation shown before an in-flight run is killed. */
export const CONFIRM_KILL_RUN: ConfirmOptions = {
  title: "Kill run",
  message:
    "Kill this run? It stops immediately and is recorded as canceled. This " +
    "cannot be undone.",
  confirmLabel: "Kill run",
};

/** Whether the kill affordance is offered at all, whether it may be used, and why
 * not when it may not. Mirrors `RunDeletionGate`. */
export interface RunKillGate {
  /** Whether to render the control. False only where this host can cancel NO run
   * — the static gallery, or a worker whose transport cannot cancel. */
  offered: boolean;
  /** Whether the control may be pressed. */
  allowed: boolean;
  /** Why not, when it is offered but not allowed. */
  reason: string | null;
}

const SIGNED_OUT_REASON =
  "Sign in to cancel runs, using the account control in the top bar.";

/**
 * The shared gate and action for killing an in-flight run, used by both the
 * live monitor's {@link KillRunControl} and the runs-list right-click menu so the
 * one set of conditions lives in a single place.
 *
 * Cancellation is possible only on a host that can execute runs (the web console;
 * the static public site cannot), with a worker whose transport supports
 * it (`killRun`) and a signed-in account whose token authorizes it — mirroring
 * the backend, which is the real gate (it refuses a run that already finished).
 * Unlike deletion this carries no per-run condition: any run the console can
 * still see running is a candidate, and the caller decides which of a selection
 * are still in flight.
 *
 * A host that could never cancel hides the affordance; a console that simply has
 * nobody signed in shows it disabled and says so, because that is a state the
 * operator can fix from the page they are already on.
 *
 * `killRun` issues the cancel, nudges the runs runtime to re-read, and then
 * watches for the partial record the driver hands back (see
 * {@link watchCanceledRuns}). It rejects (rather than silently no-ops) when the
 * gate would refuse, so callers can surface the failure.
 */
export function useRunKill(): {
  /** The full gate: whether to show the control, and whether to enable it. */
  killGate: RunKillGate;
  /** Whether runs can be killed from this host right now. */
  canKill: boolean;
  /** Kill the run, then refresh the active list. Rejects on failure. */
  killRun: (runId: string) => Promise<void>;
  /**
   * Watch runs that have just been canceled for the partial records their drivers
   * hand back, refreshing the produced worklist as they land.
   *
   * Exported because cancelling is not only `killRun`: the runs section's bulk
   * sweeps cancel through `/jobs/cancel-*`, and without this they fired one
   * immediate refresh — always too early, because a canceled run's record does
   * not exist yet at that moment — and then never looked again.
   *
   * Detached and best-effort: the cancel itself has already succeeded, so a
   * record that never arrives must not surface as a failed cancel.
   */
  watchCanceledRuns: (runIds: readonly string[]) => void;
} {
  const { canExecute } = useGalleryData();
  // Optional: the static site mounts no <WorkersProvider>, and this hook renders
  // there inside the runs list's right-click menu. No worker ⇒ nothing killable.
  const worker = useOptionalWorkers()?.active ?? null;
  const { token } = useAuth();
  const runtime = useRunsRuntime();
  const client = worker?.client ?? null;

  const hostCanKill = canExecute && Boolean(client?.killRun);
  const killGate: RunKillGate = !hostCanKill
    ? { offered: false, allowed: false, reason: null }
    : token
      ? { offered: true, allowed: true, reason: null }
      : { offered: true, allowed: false, reason: SIGNED_OUT_REASON };
  const canKill = killGate.allowed;

  const watchCanceledRuns = useCallback(
    (runIds: readonly string[]): void => {
      if (!client?.getRun || runIds.length === 0) return;
      void awaitCanceledRunRecords(client, runIds, () =>
        runtime.requestRefresh(),
      );
    },
    [client, runtime],
  );

  const killRun = useCallback(
    async (runId: string): Promise<void> => {
      if (!client?.killRun) {
        throw new Error(`cancel ${runId} refused: worker cannot cancel runs`);
      }
      if (!token) {
        throw new Error(`cancel ${runId} refused: not signed in`);
      }
      await client.killRun(runId, token);
      // The run is moving to canceled: refresh so it drops out of the active band.
      runtime.requestRefresh();
      // That refresh is always premature for the RECORD. The backend marks the job
      // canceled at once, but the record only lands when the driver notices, stops
      // the harness, drains telemetry, builds the partial record and posts it back.
      // Watch for it and refresh again when it arrives.
      watchCanceledRuns([runId]);
    },
    [client, token, runtime, watchCanceledRuns],
  );

  return { killGate, canKill, killRun, watchCanceledRuns };
}
