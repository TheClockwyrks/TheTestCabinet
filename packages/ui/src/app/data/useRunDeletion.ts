import { useCallback } from "react";
import { useOptionalWorkers } from "../../client/context";
import { useAuth } from "../../client/auth";
import { useGalleryData } from "./galleryContext";
import { useRunsRuntime } from "../runtime/runsRuntime";
import type { ConfirmOptions } from "../components/ConfirmDialog";

/** The shared confirmation shown before a run is permanently deleted. */
export const CONFIRM_DELETE_RUN: ConfirmOptions = {
  title: "Delete run",
  message:
    "Delete this run permanently? Its record, reviews, and stored media are " +
    "removed. This cannot be undone.",
  confirmLabel: "Delete run",
};

/**
 * The shared gate and action for permanently deleting a run, used by both the
 * run-detail {@link RunDeleteControl} and the runs-list right-click menu so the
 * one set of conditions lives in a single place.
 *
 * Deletion is possible only for an **unpublished** run the active worker produced
 * (`localIds` is the pushed-but-unpublished worklist, so a published run — absent
 * from it — is never deletable), on a host that can execute runs (the consoles /
 * Tauri; the static public site cannot), with a worker whose transport supports
 * deletion and a signed-in account whose token authorizes it. The backend is the
 * real gate — it refuses a published run regardless — so this is the matching UI
 * restriction. Because `canExecute` is false on the static site, the affordance
 * is inherently limited to the internal console and the Tauri app.
 *
 * `deleteRun` removes the run record, its reviews, and its stored media, then
 * nudges the data source to drop the run from the worklist. It rejects (rather
 * than silently no-ops) when called for a run the gate would refuse, so callers
 * can surface the failure.
 */
export function useRunDeletion(): {
  /** Whether the given run may be deleted from this host. */
  canDelete: (runId: string) => boolean;
  /** Permanently delete the run, then refresh the worklist. Rejects on failure. */
  deleteRun: (runId: string) => Promise<void>;
} {
  const { canExecute, localIds } = useGalleryData();
  // Optional: the static site mounts no <WorkersProvider>, and this hook renders
  // there inside the runs list's right-click menu. No worker ⇒ nothing deletable.
  const worker = useOptionalWorkers()?.active ?? null;
  const { token } = useAuth();
  const runtime = useRunsRuntime();
  const client = worker?.client ?? null;

  const canDelete = useCallback(
    (runId: string): boolean =>
      canExecute &&
      localIds.has(runId) &&
      Boolean(client?.deleteRun) &&
      Boolean(token),
    [canExecute, localIds, client, token],
  );

  const deleteRun = useCallback(
    async (runId: string): Promise<void> => {
      if (!client?.deleteRun || !token) {
        throw new Error("Deletion is not available here.");
      }
      await client.deleteRun(runId, token);
      // The run is gone: refresh the worklist so it drops out of the list.
      runtime.requestRefresh();
    },
    [client, token, runtime],
  );

  return { canDelete, deleteRun };
}
