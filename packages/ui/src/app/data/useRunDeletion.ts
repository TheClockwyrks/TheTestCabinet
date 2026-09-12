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
    "Delete this run permanently? Its record, reviews, stored media, and its " +
    "playable build and logs are removed. This cannot be undone.",
  confirmLabel: "Delete run",
};

/**
 * What the caller knows about the run it is asking about.
 *
 * A bare id means "all I have is the id" and falls back to the produced worklist.
 * The object form carries the run's OWN publish state, from the source that
 * resolved it — the detail page's record, or a listing card's `publishedAt` — and
 * that is authoritative over the worklist, which is a cache and lags.
 */
export type RunDeletionSubject =
  | string
  | {
      id: string;
      /** Whether the run has been published, per the caller's own source. */
      published: boolean;
    };

/** Whether the delete affordance is offered at all, whether it may be used, and
 * why not when it may not. See {@link useRunDeletion}. */
export interface RunDeletionGate {
  /**
   * Whether to render the control. False only where this host can delete NO run
   * whatsoever — the static gallery, a worker whose transport cannot delete — so
   * the affordance never appears somewhere it could not work at all. A console
   * with nobody signed in is NOT that: it could delete, and signing in is a step
   * the operator takes from the page they are already on, so it is offered
   * disabled with that reason (mirroring {@link useRunKill}).
   */
  offered: boolean;
  /** Whether the control may be pressed. */
  allowed: boolean;
  /** Why not, when it is offered but not allowed. Null when it is allowed. */
  reason: string | null;
}

/** A published run is gone from the console's hands for good; the backend refuses
 * it too (`delete_run` in `crates/backend/src/db.rs`). */
const PUBLISHED_REASON = "A published run cannot be deleted.";

/** Signed out of a console that can otherwise delete. Fixable from the top bar,
 * so the control stays visible and says this — exactly as cancelling does. */
const SIGNED_OUT_REASON =
  "Sign in to delete runs, using the account control in the top bar.";

/** The one genuinely transient state: the run's record has not reached the
 * produced worklist yet, and the caller had nothing better to go on. */
const UNRESOLVED_REASON =
  "This run is not in the unpublished worklist yet. Open the run to delete it.";

/**
 * The shared gate and action for permanently deleting a run, used by the
 * run-detail {@link RunDeleteControl}, the runs-list right-click menu, and the
 * Unreadable worklist, so the one set of conditions lives in a single place.
 *
 * Two conditions, deliberately separated:
 *
 * - **Can this host delete anything?** `canExecute` (the static public site
 *   cannot) and a worker whose transport implements deletion. Failing this hides
 *   the affordance. Being signed out does NOT: a console with nobody signed in
 *   could delete, so the control is shown disabled with that reason rather than
 *   withdrawn — vanishing for a state the operator can fix from the page they
 *   are on tells them nothing, which is the rule {@link useRunKill} already
 *   follows and the UI overview's "Deleting a run" states.
 * - **Is this particular run deletable?** Only an **unpublished** one. The
 *   backend is the real gate and enforces exactly that rule and no other.
 *
 * The second condition used to be answered by `localIds` alone — the produced
 * worklist, re-read only when something bumps the refresh token. That worklist is
 * a *cache of runs known unpublished*, and it LAGS: a run the operator has just
 * canceled has no record until its driver notices, stops the harness, drains
 * telemetry and posts the partial record back, which for a gg run is many seconds
 * of the largest event stream in the cabinet. For that whole window the worklist
 * did not hold the run, and "absent from the worklist" was read as "not
 * deletable" — the same mistake as reading "still loading" as "not found". So a
 * caller that has resolved the run's own publish state passes it (see
 * {@link RunDeletionSubject}) and is answered from that instead.
 *
 * `deleteRun` removes the run record, its reviews, and its stored media, then
 * nudges the data source to drop the run from the worklist. It rejects (rather
 * than silently no-ops) when called for a run the gate would refuse, so callers
 * can surface the failure.
 */
export function useRunDeletion(): {
  /** The full gate for one run: whether to show the control, and whether to
   * enable it. */
  deletionGate: (run: RunDeletionSubject) => RunDeletionGate;
  /** Whether the given run may be deleted from this host right now. */
  canDelete: (run: RunDeletionSubject) => boolean;
  /**
   * The gate for a run this build cannot read.
   *
   * The Unreadable worklist lists runs that appear in no other listing, so
   * `localIds` never holds one and {@link canDelete} would refuse every row on that
   * page. Publication does not gate these: an unreadable run is already absent from
   * the snapshot and the gallery, so the backend deletes it published or not, and
   * this page is the only place it can be got rid of. What is left is the host
   * gate and the signed-in one, split the same way as everywhere else: hidden
   * where the host can delete nothing, disabled with its reason when signed out.
   */
  unreadableGate: () => RunDeletionGate;
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

  // Whether this HOST can delete any run at all. The signed-in check is
  // deliberately not folded in here: it decides whether the control is enabled,
  // not whether it exists.
  const hostCanDelete = canExecute && Boolean(client?.deleteRun);
  const signedIn = Boolean(token);

  const deletionGate = useCallback(
    (run: RunDeletionSubject): RunDeletionGate => {
      if (!hostCanDelete)
        return { offered: false, allowed: false, reason: null };
      const id = typeof run === "string" ? run : run.id;
      // The run's own publish state, where the caller resolved it. It answers the
      // question outright, in both directions, and never consults the worklist.
      // Published comes first because it is the one permanent refusal: signing in
      // would not change it, so that is the reason worth showing.
      if (typeof run !== "string" && run.published) {
        return { offered: true, allowed: false, reason: PUBLISHED_REASON };
      }
      // Every remaining refusal is one the operator can act on, signing in first:
      // without a token the request would be rejected whatever the run's state.
      if (!signedIn) {
        return { offered: true, allowed: false, reason: SIGNED_OUT_REASON };
      }
      if (typeof run !== "string")
        return { offered: true, allowed: true, reason: null };
      // Id only. The worklist is all there is: holding the run proves it is
      // unpublished; not holding it proves nothing either way.
      return localIds.has(id)
        ? { offered: true, allowed: true, reason: null }
        : { offered: true, allowed: false, reason: UNRESOLVED_REASON };
    },
    [hostCanDelete, signedIn, localIds],
  );

  const canDelete = useCallback(
    (run: RunDeletionSubject): boolean => deletionGate(run).allowed,
    [deletionGate],
  );

  const unreadableGate = useCallback(
    (): RunDeletionGate =>
      !hostCanDelete
        ? { offered: false, allowed: false, reason: null }
        : signedIn
          ? { offered: true, allowed: true, reason: null }
          : { offered: true, allowed: false, reason: SIGNED_OUT_REASON },
    [hostCanDelete, signedIn],
  );

  const deleteRun = useCallback(
    async (runId: string): Promise<void> => {
      if (!client?.deleteRun) {
        throw new Error(`delete ${runId} refused: worker cannot delete runs`);
      }
      if (!token) {
        throw new Error(`delete ${runId} refused: not signed in`);
      }
      await client.deleteRun(runId, token);
      // The run is gone: refresh the worklist so it drops out of the list.
      runtime.requestRefresh();
    },
    [client, token, runtime],
  );

  return { deletionGate, canDelete, unreadableGate, deleteRun };
}
