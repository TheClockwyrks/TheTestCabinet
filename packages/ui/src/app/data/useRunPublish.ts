import { useCallback } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { useOptionalWorkers } from "../../client/context";
import { useAuth } from "../../client/auth";
import { describeRunState } from "./runState";
import { useGalleryData } from "./galleryContext";
import { useRunsRuntime } from "../runtime/runsRuntime";

/**
 * Whether a run summary card describes a run that would publish **right now**,
 * mirroring the backend's publish gate (`gate_publishable`) and the
 * `state=publishable` slice the Unpublished worklist is drawn from:
 *
 * - an already-published run is done (the card's `publishedAt` is empty until it
 *   is released, which is also how the run log marks a row unpublished);
 * - an infrastructure failure is the Test Cabinet's own fault and is never
 *   publishable, whatever reviews it carries;
 * - a publishable failure tier is real model signal with no checklist to complete,
 *   so it publishes with no review;
 * - anything else needs at least one review.
 *
 * The backend is the real gate — it refuses regardless — so this exists to keep the
 * console from *offering* a publish that is about to be refused.
 */
export function isPublishable(summary: RunSummary): boolean {
  if (summary.publishedAt) return false;
  const state = describeRunState(summary.state);
  if (state.isPublishableFailure) return true;
  if (summary.state === "infrastructure") return false;
  return summary.reviewCount > 0;
}

/**
 * The shared gate and action for publishing a run, used by the runs-list
 * right-click menu (one run, or a whole checked selection). The sibling of
 * {@link useRunDeletion} / {@link useRunKill}, and gated the same way: a host that
 * can execute runs (the consoles; the static public site cannot), a worker whose
 * transport can publish, and a signed-in account whose token authorizes it.
 *
 * `publishRun` **enqueues** the release and resolves as soon as the backend accepts
 * it — it does not wait for the gh/wrangler Job to finish. That is deliberate: a
 * release takes minutes, and awaiting each one would hold a live stream open per
 * run and pin the user to the page. A refused gate still rejects here, immediately;
 * a release that starts and then fails is reported by the backend's `publish-failed`
 * notification, which is what makes handing the work off safe in the first place.
 */
export function useRunPublish(): {
  /** Whether runs can be published from this host at all. */
  canPublish: boolean;
  /** Enqueue the run's release, then refresh the worklist. Rejects on failure. */
  publishRun: (runId: string) => Promise<void>;
} {
  const { canExecute } = useGalleryData();
  // Optional: the static site mounts no <WorkersProvider>, and this hook renders
  // there inside the runs list's right-click menu. No worker ⇒ nothing publishable.
  const worker = useOptionalWorkers()?.active ?? null;
  const { token } = useAuth();
  const runtime = useRunsRuntime();
  const client = worker?.client ?? null;

  const canPublish =
    canExecute && Boolean(client?.enqueuePublish) && Boolean(token);

  const publishRun = useCallback(
    async (runId: string): Promise<void> => {
      if (!client?.enqueuePublish || !token) {
        throw new Error("Publishing is not available here.");
      }
      await client.enqueuePublish(runId, token);
      // The run is now releasing. Re-read so anything already resolved settles;
      // the run leaves the publish worklist only once its release lands, which is
      // minutes away and arrives on its own.
      runtime.requestRefresh();
    },
    [client, token, runtime],
  );

  return { canPublish, publishRun };
}
