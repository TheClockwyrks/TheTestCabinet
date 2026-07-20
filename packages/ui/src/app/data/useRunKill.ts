import { useCallback } from "react";
import { useOptionalWorkers } from "../../client/context";
import { useAuth } from "../../client/auth";
import { useGalleryData } from "./galleryContext";
import { useRunsRuntime } from "../runtime/runsRuntime";

/** The shared confirmation shown before an in-flight run is killed. */
export const CONFIRM_KILL_RUN =
  "Kill this run? It stops immediately and is recorded as canceled. This " +
  "cannot be undone.";

/**
 * The shared gate and action for killing an in-flight run, used by both the
 * live monitor's {@link KillRunControl} and the runs-list right-click menu so the
 * one set of conditions lives in a single place.
 *
 * Cancellation is possible only on a host that can execute runs (the consoles /
 * Tauri; the static public site cannot), with a worker whose transport supports
 * it (`killRun`) and a signed-in account whose token authorizes it — mirroring
 * the backend, which is the real gate (it refuses a run that already finished).
 * Unlike deletion this carries no per-run local-worklist condition: any run the
 * console can still see running is a candidate, and the caller decides which of a
 * selection are still in flight.
 *
 * `killRun` issues the cancel and then nudges the runs runtime to re-read, so a
 * killed run drops out of the active band promptly. It rejects (rather than
 * silently no-ops) when the gate would refuse, so callers can surface the failure.
 */
export function useRunKill(): {
  /** Whether runs can be killed from this host at all. */
  canKill: boolean;
  /** Kill the run, then refresh the active list. Rejects on failure. */
  killRun: (runId: string) => Promise<void>;
} {
  const { canExecute } = useGalleryData();
  // Optional: the static site mounts no <WorkersProvider>, and this hook renders
  // there inside the runs list's right-click menu. No worker ⇒ nothing killable.
  const worker = useOptionalWorkers()?.active ?? null;
  const { token } = useAuth();
  const runtime = useRunsRuntime();
  const client = worker?.client ?? null;

  const canKill = canExecute && Boolean(client?.killRun) && Boolean(token);

  const killRun = useCallback(
    async (runId: string): Promise<void> => {
      if (!client?.killRun || !token) {
        throw new Error("Cancellation is not available here.");
      }
      await client.killRun(runId, token);
      // The run is moving to canceled: refresh so it drops out of the active band.
      runtime.requestRefresh();
    },
    [client, token, runtime],
  );

  return { canKill, killRun };
}
