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

// How often the console reconciles its in-progress list against the workers'
// authoritative active sets.
//
// This used to be the console's *primary* way of learning about in-flight runs, at
// 15s, because the push feed carried only completions: it announced no enqueue and
// no phase change, so a run started by a coverage plan, a ladder, another tab or
// another machine appeared only when a poll happened to find it. The stream now
// carries the whole lifecycle (`onRunLifecycle`), so this is demoted to a genuine
// backstop and can be far slower.
//
// It is not removed, because two failure modes survive an event-driven list, and
// neither announces itself:
//
//   - The stream is only subscribed to run events while a page that needs them is
//     mounted. Anything that happens while it is off is not replayed when it comes
//     back on — the reconcile on enable covers the common case, this covers the rest.
//   - An `EventSource` can wedge: errored without reconnecting, so `onOpen` never
//     fires again, with no error surfaced to the page. (The other silent-loss case,
//     the backend dropping messages for a client that fell behind, *is* signalled —
//     see `onResync` — and recovers immediately rather than waiting for this.)
const RECONCILE_INTERVAL_MS = 120_000;

// The console's notification subsystem, mounted once inside the router (so its
// toasts and sidebar can use <Link>) and only where runs execute. It:
//   - seeds the in-progress list from each worker's active runs, so a run the
//     user is watching survives a page reload (the session store is rebuilt);
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
  // latest in a ref so the subscription/seed effects don't depend on it (and
  // re-run, churning subscriptions) every time a run is tracked or removed.
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  // Re-seed and re-subscribe only when the set of workers changes, not on every
  // render. Read the live worker handles from a ref so the keyed effect still
  // uses current clients.
  const workersRef = useRef(workers);
  workersRef.current = workers;
  const workerKey = workers.map((w) => w.id).join("|");

  // Seed the in-progress list from each worker's currently-running jobs.
  useEffect(() => {
    let cancelled = false;
    for (const worker of workersRef.current) {
      worker.client
        .listActiveRuns()
        .then((runs) => {
          if (cancelled) return;
          for (const run of runs) runtimeRef.current.track(run);
        })
        .catch(() => {
          // A worker that can't enumerate active runs simply seeds none.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [workerKey]);

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

  // Apply one run-lifecycle event to the in-progress list. This is what keeps the
  // list current between fetches; the reconcile below is only its backstop. What
  // each event means for the list is decided by `runListAction`; this only applies
  // the result.
  const handleRunLifecycle = useCallback((event: RunLifecycleEvent) => {
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

  // Reconcile the in-progress list against every worker's active runs and apply the
  // result: track newly-seen runs, drop finished ones, and re-read produced runs so
  // a recovered completion surfaces. This is exactly what a manual page refresh
  // does; wiring it to the push channel's (re)connect and to a periodic timer makes
  // the list self-heal when a completion's live push was missed — the reported bug,
  // where a whole batch of finished runs sat as "in progress" until a manual reload.
  const reconcileActive = useCallback(async () => {
    const workers = workersRef.current;
    if (workers.length === 0) return;
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
    // A pruned run has finished; nudge the data source to re-read produced runs so
    // it reappears as a completed run rather than simply vanishing.
    if (toRemove.length > 0) runtime.requestRefresh();
  }, []);

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
        // dropped messages for it. Same recovery as a reconnect, and the reason the
        // periodic poll can be slow: the one silent-loss case that is not a
        // disconnect reports itself.
        onResync: () => {
          void reconcileActive();
        },
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [workerKey, handlePush, handleRunLifecycle, reconcileActive]);

  // A periodic backstop for reconnect-time reconciliation: that only recovers a
  // missed completion if the channel actually reconnects. If it wedges — an
  // EventSource stuck after an error, or a push dropped with the connection still
  // up — polling the active list heals the list within an interval instead of
  // waiting on a manual refresh.
  //
  // It polls unconditionally, and not merely while this session already has a run in
  // flight. A run this browser never launched is exactly as real: a coverage plan or
  // ladder top-up enqueues server-side, and so does another tab or another machine
  // signed into the same cabinet. Gating the poll on a non-empty list left every one
  // of those invisible until the user happened to launch something by hand — the seed
  // runs once on mount, so navigating to the Runs page (which never remounts this
  // layer) showed nothing at all.
  useEffect(() => {
    const timer = setInterval(() => {
      void reconcileActive();
    }, RECONCILE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reconcileActive]);

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
