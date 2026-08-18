import { useEffect, useRef } from "react";
import { useOptionalWorkers } from "../../client/context";
import type { WorkerHandle } from "../../client/context";
import { useRunsRuntime } from "./runsRuntime";

// How many mounted components currently need live run updates, per worker id.
//
// Module-level rather than React state on purpose. The count is not rendered — it
// only decides whether a request has been sent — and keeping it out of the tree
// means a page can declare its need with a single hook call, wherever it sits,
// without every such page having to be a descendant of one provider. It is keyed by
// worker because each worker holds its own stream.
const demand = new Map<string, number>();

// A stable empty list, so the no-workers case does not hand the effect a fresh
// array identity on every render.
const NO_WORKERS: WorkerHandle[] = [];

// Declare that this component needs the console stream's run-lifecycle topic for as
// long as it is mounted, and stop needing it on unmount.
//
// The topic is off by default because run events are noisy — every enqueue, every
// phase change, every run of a bulk cancel — and most of the console shows no
// in-flight list. It is turned on only while something is displaying one: the Runs
// section (its list and its waiting/running tab counts) and a run's live monitor.
//
// **Ref-counted**, because more than one of those can be mounted at once — the Runs
// tabs wrap the Runs page, and a navigation mounts the next page before unmounting
// the last. A naive enable-on-mount/disable-on-unmount would have the outgoing
// page's cleanup switch the topic off immediately after the incoming page switched
// it on, leaving the console subscribed to nothing precisely when it is showing the
// list. Only the first mount enables and only the last unmount disables.
export function useLiveRunUpdates(): void {
  // Optional: the static site mounts no <WorkersProvider>, and the runs tab bar
  // that declares this need renders there too. With no workers there is no stream
  // and nothing to subscribe to, which is exactly right — that build shows no
  // in-flight runs at all.
  const workers = useOptionalWorkers()?.workers ?? NO_WORKERS;
  const { requestResync } = useRunsRuntime();
  const requestResyncRef = useRef(requestResync);
  requestResyncRef.current = requestResync;
  // Re-subscribe only when the set of workers changes, not on every render. The
  // handles themselves are read from a ref so the keyed effect still uses current
  // clients (the same pattern the notifications layer uses).
  const workersRef = useRef(workers);
  workersRef.current = workers;
  const workerKey = workers.map((w) => w.id).join("|");

  useEffect(() => {
    // Captured once so the cleanup releases exactly the workers it acquired, even
    // if the set changed in between.
    const acquired = workersRef.current;
    let enabledAny = false;
    for (const worker of acquired) {
      const next = (demand.get(worker.id) ?? 0) + 1;
      demand.set(worker.id, next);
      // First consumer for this worker: ask for the topic. Later ones ride the
      // same subscription.
      if (next === 1) {
        enabledAny = true;
        void worker.client.setRunLifecycleEnabled(true).catch(() => {
          // The topic could not be turned on, so this page will show whatever the
          // resync below fetched and will not advance. The stream's own reconnect
          // re-applies the intent; there is nothing useful to do from here.
        });
      }
    }
    // Re-read the in-flight list whenever the topic goes from off to on. Nothing
    // published while it was off is replayed, so what this console is holding may
    // be arbitrarily stale — a run it never saw start, or one that finished
    // without it. This is the "fetch on navigate" that makes the live events an
    // *update* stream rather than the only source of truth.
    if (enabledAny) requestResyncRef.current();
    return () => {
      for (const worker of acquired) {
        const next = (demand.get(worker.id) ?? 1) - 1;
        if (next <= 0) {
          demand.delete(worker.id);
          void worker.client.setRunLifecycleEnabled(false).catch(() => {
            // Failing to turn it *off* costs only extra traffic on a stream that
            // is about to be idle; nothing to recover.
          });
        } else {
          demand.set(worker.id, next);
        }
      }
    };
  }, [workerKey]);
}

// Reset the module-level demand counts. Test-only: the map outlives any single
// render tree, so a test that mounts and unmounts consumers would otherwise leak
// counts into the next test.
export function resetLiveRunUpdatesForTest(): void {
  demand.clear();
}
