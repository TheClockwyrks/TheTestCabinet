import { create } from "zustand";
import type { ArtifactStorageStatus } from "@clockwyrks/run-record/jobs-api";
import { storageHoldReason } from "../../client/artifactStorage";

// The artifact store's status, as each backend this console is connected to last
// reported it on its console stream.
//
// A zustand store, like the notification center, because the writer and the
// readers sit far apart: the notifications layer owns the stream and writes each
// status as it arrives, while the page chrome draws the notice and the run
// listings explain a held run. It is not persisted. A status is sent on every
// connect, so a reload has the current one as soon as its stream opens, and a
// stored one could only be staler than that.
//
// Keyed by worker id because a console can hold more than one backend, each with
// its own artifact store. The static site never writes here, so it shows nothing.

interface ArtifactStorageState {
  byWorker: Readonly<Record<string, ArtifactStorageStatus>>;
  /** Record the status a worker's stream just delivered. */
  setStatus: (workerId: string, status: ArtifactStorageStatus) => void;
  /** Forget every worker not in `workerIds` (one was removed from the console). */
  retain: (workerIds: readonly string[]) => void;
}

export const useArtifactStorage = create<ArtifactStorageState>((set) => ({
  byWorker: {},
  setStatus: (workerId, status) =>
    set((state) => ({ byWorker: { ...state.byWorker, [workerId]: status } })),
  retain: (workerIds) =>
    set((state) => {
      const kept = Object.entries(state.byWorker).filter(([id]) =>
        workerIds.includes(id),
      );
      if (kept.length === Object.keys(state.byWorker).length) return state;
      return { byWorker: Object.fromEntries(kept) };
    }),
}));

/** Why waiting runs are being held by the artifact store, or null when they are not. */
export function selectStorageHoldReason(
  state: ArtifactStorageState,
): string | null {
  for (const status of Object.values(state.byWorker)) {
    const reason = storageHoldReason(status);
    if (reason) return reason;
  }
  return null;
}
