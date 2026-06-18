import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useWorkers } from "../../../../client/context";
import type { HarnessEvent, RunOutcome } from "../../../../client/types";
import { EventFeed } from "../../../components/EventFeed";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { routes } from "../../../routes";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import { useAppSettings } from "../../../store/appSettings";
import styles from "../RunExec.module.scss";

type MonitorStatus =
  | { kind: "running" }
  | { kind: "done"; outcome: RunOutcome };

// The live monitor for an active run (`/runs/:runId/live`). It subscribes to the
// active worker's event stream (which replays events so far, then streams new
// ones), rendering the harness activity feed until the run reaches a terminal
// state. On completion it reflects the run into the runs runtime and links to the
// finished run's detail page. This is the routed home of the old console Run
// screen's live-feed half.
export function RunMonitorPage() {
  const { runId } = useParams<{ runId: string }>();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [status, setStatus] = useState<MonitorStatus>({ kind: "running" });
  const [error, setError] = useState<string | null>(null);
  // Whether the feed auto-follows the newest event. On by default; the user
  // scrolling up (reported by the feed) or toggling the Follow button turns it
  // off, and toggling it back on snaps to the bottom and resumes.
  const [following, setFollowing] = useState(true);
  const feedStyle = useAppSettings((s) => s.eventFeedStyle);

  // Hold the latest runtime in a ref so the subscription effect can reach its
  // callbacks without depending on it. The runtime object is recreated whenever
  // its own state (inProgress/refreshToken) changes — and `onDone` changes that
  // state (update/remove/requestRefresh). Depending on `runtime` directly would
  // re-run the effect on completion, resetting state and re-subscribing, which
  // replays the stream and fires `onDone` again — an infinite loop that flickers
  // the UI between "running" and "done".
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    if (!worker || !runId) return;
    setEvents([]);
    setStatus({ kind: "running" });
    setError(null);
    const unsubscribe = worker.client.subscribeToRun(runId, {
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      onDone: (outcome) => {
        const runtime = runtimeRef.current;
        setStatus({ kind: "done", outcome });
        runtime.update(runId, {
          state: outcome.kind === "failed" ? "failed" : "running",
        });
        if (outcome.kind === "completed") {
          // The finished run is now a produced run; drop the in-progress entry
          // and ask the data source to re-read the worker's produced runs.
          runtime.remove(runId);
          runtime.requestRefresh();
        }
      },
      onError: (e) => setError(String(e)),
    });
    return unsubscribe;
  }, [worker, runId]);

  return (
    <PageLayout fill>
      <PromptHeader command="--monitor" comment={<>// live run activity</>} />

      {!worker && (
        <p className={`${styles.notice} ${styles.warn}`}>
          No worker connected — the live stream comes from the worker that ran
          this job.
        </p>
      )}

      {status.kind === "done" && status.outcome.kind === "completed" && (
        <p className={`${styles.notice} ${styles.ok}`}>
          Run complete — state {status.outcome.record.status.state}, loaded{" "}
          {String(status.outcome.record.validation.loaded)}.{" "}
          <Link to={routes.runDetail(status.outcome.record.id)}>
            Open the run to review and publish it.
          </Link>
        </p>
      )}
      {status.kind === "done" && status.outcome.kind === "failed" && (
        <p className={`${styles.notice} ${styles.error}`}>
          Run failed: {status.outcome.message}
        </p>
      )}
      {error && <p className={`${styles.notice} ${styles.error}`}>{error}</p>}

      <div className={styles.feedHeader}>
        <div className={styles.feedHeading}>
          <span className={styles.feedTitle}>Live Event Feed</span>
          <span className={styles.feedRunId}>
            Run id <code>{runId}</code>
          </span>
        </div>
        <button
          type="button"
          className={styles.followButton}
          data-active={following ? "" : undefined}
          aria-pressed={following}
          onClick={() => setFollowing((on) => !on)}
        >
          Follow
        </button>
      </div>
      <EventFeed
        events={events}
        feedStyle={feedStyle}
        fill
        follow={following}
        onFollowChange={setFollowing}
        emptyLabel={
          status.kind === "running"
            ? "Waiting for events…"
            : "No events were recorded."
        }
      />
    </PageLayout>
  );
}
