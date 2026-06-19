import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./notifications.scss";
import { useWorkers } from "../../client/context";
import type { RunNotification } from "../../client/types";
import { useRunsRuntime } from "../runtime/runsRuntime";
import {
  notificationFromPush,
  useNotifications,
} from "../runtime/notifications";
import { NotificationToast } from "./NotificationToast";
import { NotificationsSidebar } from "./NotificationsSidebar";

// The console's notification subsystem, mounted once inside the router (so its
// toasts and sidebar can use <Link>) and only where runs execute. It:
//   - seeds the in-progress list from each worker's active runs, so a run the
//     user is watching survives a page reload (the session store is rebuilt);
//   - subscribes to every worker's completion push (SSE on web, a Tauri event on
//     desktop) and, per completion, raises a toast, files the notification for the
//     bell, and prunes the finished run from the in-progress list — globally, so
//     it works even when the live monitor isn't open;
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

  // Handle one completion push: file it, prune the in-progress run, and toast.
  const handlePush = useCallback(
    (push: RunNotification) => {
      const notification = notificationFromPush(push);
      add(notification);

      // The run is no longer in progress; drop it from the list (keyed by the
      // live job id) and refresh produced runs so a completed run appears.
      const current = runtimeRef.current;
      current.remove(push.jobId);
      current.requestRefresh();

      // toastId dedupes if the same completion is delivered twice (e.g. a brief
      // reconnect); the container owns the close/auto-dismiss behavior.
      toast(({ closeToast }) => (
        <NotificationToast notification={notification} closeToast={closeToast} />
      ), {
        toastId: notification.id,
        type: push.outcome === "failed" ? "error" : "success",
      });
    },
    [add],
  );

  useEffect(() => {
    const unsubscribes = workersRef.current.map((worker) =>
      worker.client.subscribeToNotifications({
        onNotification: handlePush,
        // A transport fault is non-fatal: the web EventSource reconnects on its
        // own; a desktop listen error just means no notifications until retried.
        onError: () => {},
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [workerKey, handlePush]);

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
