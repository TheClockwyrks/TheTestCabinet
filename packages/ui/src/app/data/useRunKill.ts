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
      // The killed run does not appear in the produced list yet. Its driver notices
      // the cancellation on its own poll, stops the harness, and only then hands
      // back the partial record the backend retains — seconds later. Watch for that
      // record and refresh again when it lands, so the killed run shows up in the
      // run list on its own instead of waiting for the next manual reload. Detached
      // and best-effort: the kill itself has already succeeded, so a record that
      // never arrives must not surface as a failed cancel.
      void awaitKilledRunRecord(client, runId).then((landed) => {
        if (landed) runtime.requestRefresh();
      });
    },
    [client, token, runtime],
  );

  return { canKill, killRun };
}

// How long to watch a killed run for the record its driver hands back, and how
// often to re-read it. Mirrors the live monitor's wait: the driver's cancellation
// poll plus stopping the harness and uploading what it collected is a matter of
// seconds, and a driver that died with its pod never posts one at all.
const KILLED_RECORD_WAIT_MS = 30_000;
const KILLED_RECORD_POLL_MS = 1_000;

// Poll a killed run until the backend reports the retained record for it, resolving
// `true` once it lands and `false` if the wait runs out. A read that fails is
// treated as "not yet" — this is a courtesy refresh, never a source of errors.
async function awaitKilledRunRecord(
  client: { getRun(runId: string): Promise<{ record: unknown | null }> },
  runId: string,
): Promise<boolean> {
  const deadline = Date.now() + KILLED_RECORD_WAIT_MS;
  for (;;) {
    try {
      const job = await client.getRun(runId);
      if (job.record) return true;
    } catch {
      // Keep waiting; the next tick re-reads.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, KILLED_RECORD_POLL_MS));
  }
}
