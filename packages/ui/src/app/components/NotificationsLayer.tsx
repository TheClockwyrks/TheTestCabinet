import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./notifications.scss";
import { useWorkers } from "../../client/context";
import type { RunLifecycleEvent, RunNotification } from "../../client/types";
import { useRunsRuntime } from "../runtime/runsRuntime";
import {
  notificationFromPush,
  useNotifications,
} from "../runtime/notifications";
import {
  reconcileActiveRuns,
  type ActiveRunsResult,
} from "../runtime/reconcileActiveRuns";
import { runListAction } from "../runtime/runLifecycle";
import { NotificationToast } from "./NotificationToast";
import { NotificationsSidebar } from "./NotificationsSidebar";

// The console does not poll for run state. It re-reads the workers' active lists
// only when something says its own list may be wrong, and lives on the console
// stream's run-lifecycle events in between. There are exactly four such moments,
// and between them they cover every way this console can fall out of step:
//
//   - **On mount and on a resync request** — `useLiveRunUpdates` asks for one on
//     navigating onto a page that shows in-flight runs, because the run topic is
//     off the rest of the time and nothing published while it was off is replayed.
//   - **On every (re)connect** (`onOpen`) — the stream keeps no backlog, so a gap
//     loses whatever happened during it.
//   - **On a `resync` frame** — the connection is healthy but the backend dropped
//     messages for a client that fell behind. It used to skip these in silence,
//     which is what a periodic poll was really compensating for.
//   - **On a reopen the transport forces** — an `EventSource` that gave up, or one
//     that believes it is connected and is not. The backend heartbeats so the
//     transport can tell the second case from an idle queue; see
//     `subscribeToNotifications`. That reopen surfaces here as an `onOpen`.

// The console's notification subsystem, mounted once inside the router (so its
// toasts and sidebar can use <Link>) and only where runs execute. It:
//   - re-bases the in-progress list on each worker's active runs whenever that
//     list may have gone stale (see above), so a run the user is watching survives
//     a page reload (the session store is rebuilt);
//   - holds each worker's console stream (SSE) open for the whole session and, per
//     completion alert, raises a toast, files the notification for the bell, and
//     prunes the finished run from the in-progress list — globally, so it works
//     even when the live monitor isn't open;
//   - does the same, minus the pruning, for a **failed publish** — the alert that
//     exists because publishing is asynchronous and the console has usually
//     navigated away from the release's live stream by the time it fails;
//   - applies the stream's run-lifecycle events to the in-progress list, which is
//     what keeps that list current as runs are enqueued and advance. Those arrive
//     only while some page has asked for them (`useLiveRunUpdates`); the alerts
//     above arrive always, which is why the stream is opened here rather than by
//     the pages that read the list;
//   - marks a run's notification read once the user opens that run.
// It is rendered by `GalleryApp` behind the `canExecute` gate, so the static site
// (no workers, no bell) never mounts it.
export function NotificationsLayer() {
  const { workers } = useWorkers();
  const runtime = useRunsRuntime();
  const add = useNotifications((s) => s.add);
  const markReadByRunId = useNotifications((s) => s.markReadByRunId);

  // The runtime object is recreated whenever its own state changes; hold the
  // latest in a ref so the subscription and reconcile effects don't depend on it
  // (and re-run, churning subscriptions) every time a run is tracked or removed.
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  // Re-subscribe only when the set of workers changes, not on every render. Read
  // the live worker handles from a ref so the keyed effect still uses current
  // clients.
  const workersRef = useRef(workers);
  workersRef.current = workers;
  const workerKey = workers.map((w) => w.id).join("|");

  // Handle one push: file it, reconcile whatever it changed, and toast.
  const handlePush = useCallback(
    (push: RunNotification) => {
      const notification = notificationFromPush(push);
      add(notification);

      if (push.kind === "run-completed") {
        // The run is no longer in progress; drop it from the list (keyed by the
        // live job id) and refresh produced runs so a completed run appears.
        const current = runtimeRef.current;
        current.remove(push.jobId);
        current.requestRefresh();
      }
      // A failed publish changes neither list: the run finished long ago and is
      // simply still unpublished, exactly as the console already shows it. (Its
      // `jobId` is a publish job, so pruning by it would match nothing anyway.)

      // toastId dedupes if the same completion is delivered twice (e.g. a brief
      // reconnect); the container owns the close/auto-dismiss behavior.
      toast(
        ({ closeToast }) => (
          <NotificationToast
            notification={notification}
            closeToast={closeToast}
          />
        ),
        {
          toastId: notification.id,
          type: push.outcome === "failed" ? "error" : "success",
        },
      );
    },
    [add],
  );

  // Events that arrived while a reconcile was in flight, held back until its
  // snapshot has been applied. Null when no reconcile is running, which is the
  // normal case — events are applied as they arrive.
  const bufferedRef = useRef<RunLifecycleEvent[] | null>(null);
  // Whether a reconcile is running, and whether another was asked for while it
  // was. Requests that land mid-flight are coalesced into one follow-up rather
  // than run concurrently, which would have two snapshots racing each other.
  const reconcilingRef = useRef(false);
  const reconcileAgainRef = useRef(false);

  // Apply one run-lifecycle event to the in-progress list. What each event means
  // for the list is decided by `runListAction`; this only applies the result.
  const applyRunLifecycle = useCallback((event: RunLifecycleEvent) => {
    const runtime = runtimeRef.current;
    const action = runListAction(event, runtime.inProgress);
    switch (action.kind) {
      case "track":
        runtime.track(action.run);
        break;
      case "update":
        runtime.update(action.runId, { state: action.state });
        break;
      case "remove":
        runtime.remove(action.runId);
        if (action.refresh) runtime.requestRefresh();
        break;
      case "ignore":
        break;
    }
  }, []);

  // This is what keeps the list current; the reconcile below only re-bases it.
  const handleRunLifecycle = useCallback(
    (event: RunLifecycleEvent) => {
      if (bufferedRef.current) {
        bufferedRef.current.push(event);
        return;
      }
      applyRunLifecycle(event);
    },
    [applyRunLifecycle],
  );

  // Re-base the in-progress list on every worker's authoritative active set: track
  // newly-seen runs, patch phases, drop finished ones, and re-read produced runs so
  // a recovered completion surfaces. This is exactly what a manual page refresh
  // does.
  //
  // Events are **buffered for its duration** and replayed on top afterward. The
  // snapshot describes the queue as of the moment the request was served, so
  // applying it over a list that live events have since moved forward would undo
  // them — re-adding a run that finished a moment ago, and leaving that row stranded
  // for good now that nothing polls to correct it. Buffering makes the two ordered
  // rather than racing: snapshot first, then everything that happened after it.
  const reconcileActive = useCallback(async () => {
    const workers = workersRef.current;
    if (workers.length === 0) return;
    if (reconcilingRef.current) {
      reconcileAgainRef.current = true;
      return;
    }
    reconcilingRef.current = true;
    bufferedRef.current = [];
    try {
      const settled = await Promise.allSettled(
        workers.map((worker) => worker.client.listActiveRuns()),
      );
      const results: ActiveRunsResult[] = settled.map((result) =>
        result.status === "fulfilled"
          ? { ok: true, runs: result.value }
          : { ok: false },
      );
      const runtime = runtimeRef.current;
      const { toTrack, toUpdate, toRemove } = reconcileActiveRuns(
        runtime.inProgress,
        results,
      );
      for (const activeRun of toTrack) runtime.track(activeRun);
      for (const { runId, state } of toUpdate) runtime.update(runId, { state });
      for (const runId of toRemove) runtime.remove(runId);
      // A pruned run has finished; nudge the data source to re-read produced runs
      // so it reappears as a completed run rather than simply vanishing.
      if (toRemove.length > 0) runtime.requestRefresh();
    } finally {
      const buffered = bufferedRef.current ?? [];
      bufferedRef.current = null;
      reconcilingRef.current = false;
      for (const event of buffered) applyRunLifecycle(event);
    }
    if (reconcileAgainRef.current) {
      reconcileAgainRef.current = false;
      void reconcileActive();
    }
  }, [applyRunLifecycle]);

  useEffect(() => {
    const unsubscribes = workersRef.current.map((worker) =>
      worker.client.subscribeToNotifications({
        onNotification: handlePush,
        onRunLifecycle: handleRunLifecycle,
        // A transport fault is non-fatal: the web EventSource reconnects on its
        // own; a desktop listen error just means no notifications until retried.
        onError: () => {},
        // The feed carries no backlog, so anything published while the channel was
        // down is never replayed. Reconcile against the active list on every
        // (re)connect to recover whatever was missed during the gap.
        onOpen: () => {
          void reconcileActive();
        },
        // The connection stayed up but this client fell behind and the backend
        // dropped messages for it. Same recovery as a reconnect — and the reason
        // there is no longer a timer: the one silent-loss case that is not a
        // disconnect now reports itself instead of being waited out.
        onResync: () => {
          void reconcileActive();
        },
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [workerKey, handlePush, handleRunLifecycle, reconcileActive]);

  // Re-base the list whenever something asks for it: `useLiveRunUpdates` does on
  // navigating onto a page that shows in-flight runs, because nothing published
  // while the topic was off is replayed. The token starts at 0 and this runs on
  // mount, which is also what seeds the list for the very first page.
  const { resyncToken } = runtime;
  useEffect(() => {
    void reconcileActive();
  }, [workerKey, resyncToken, reconcileActive]);

  // Opening a run dismisses its alert: mark every notification for that run read
  // whenever the location lands on a run's pages (`/runs/:id...`).
  const { pathname } = useLocation();
  useEffect(() => {
    const match = pathname.match(/^\/runs\/([^/]+)/);
    if (!match) return;
    const runId = decodeURIComponent(match[1]!);
    // `/runs/new` is the launch form, not a run.
    if (runId === "new") return;
    markReadByRunId(runId);
  }, [pathname, markReadByRunId]);

  return (
    <>
      <ToastContainer
        position="top-right"
        theme="dark"
        autoClose={6000}
        closeOnClick={false}
        closeButton={false}
        newestOnTop
        pauseOnHover
      />
      <NotificationsSidebar />
    </>
  );
}
