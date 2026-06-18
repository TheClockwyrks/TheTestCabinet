// The WorkerClient over Tauri IPC: the built-in local core that executes runs.
// Launch and the live event/done channels map to the desktop core's commands and
// emitted events; produced-run listing, review, and publish map to its run-store
// commands. This is the "local worker" the desktop pre-adds.
import {
  NotSupportedError,
  type HarnessEvent,
  type RunJob,
  type RunOutcome,
  type RunSubscription,
  type WorkerClient,
  type WorkerIdentity,
} from "@test-cabinet/ui/client";
import * as api from "../api";

export function createTauriWorker(): WorkerClient {
  return {
    async identity(): Promise<WorkerIdentity> {
      const version = await api.appVersion().catch(() => null);
      // The local core publishes to the same backend the catalog resolves from;
      // there is no separate id to verify, so report it unverified.
      return { url: "tauri://local", version, backendId: null };
    },

    launchRun: (config) => api.launchRun(config),

    async getRun(runId: string): Promise<RunJob> {
      // The core exposes no live job-status command; a produced run reads as
      // completed, otherwise the live state is observed via subscribeToRun.
      try {
        const stored = await api.readRun(runId);
        return {
          runId,
          state: "completed",
          record: stored.record,
          message: null,
        };
      } catch {
        throw new NotSupportedError("getRun");
      }
    },

    subscribeToRun(runId: string, handlers: RunSubscription): () => void {
      let unEvent: (() => void) | null = null;
      let unDone: (() => void) | null = null;
      let cancelled = false;
      api
        .listen<HarnessEvent>(api.eventChannel(runId), (e) =>
          handlers.onEvent(e),
        )
        .then((u) => (cancelled ? u() : (unEvent = u)))
        .catch((err) => handlers.onError?.(err));
      api
        .listen<RunOutcome>(api.doneChannel(runId), (o) => handlers.onDone(o))
        .then((u) => (cancelled ? u() : (unDone = u)))
        .catch((err) => handlers.onError?.(err));
      return () => {
        cancelled = true;
        unEvent?.();
        unDone?.();
      };
    },

    listRuns: () => api.listRuns(),
    readRun: (id) => api.readRun(id),
    // The worker contract carries the review with the publish. The local core
    // keeps a run-store, so persist the review there first, then publish by id —
    // the store is the core's system of record for a produced run's review.
    publish: async (id, review) => {
      await api.saveReview(id, review.rating, review.writeup, review.checklist);
      return api.publishRun(id);
    },
  };
}
