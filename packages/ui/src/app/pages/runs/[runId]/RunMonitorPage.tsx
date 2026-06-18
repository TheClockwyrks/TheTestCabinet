import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useWorkers } from "../../../../client/context";
import type { HarnessEvent, RunOutcome } from "../../../../client/types";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { routes } from "../../../routes";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import styles from "../RunExec.module.scss";

type MonitorStatus =
  | { kind: "running" }
  | { kind: "done"; outcome: RunOutcome };

// A one-line summary of a normalized harness event for the live feed.
function describeEvent(e: HarnessEvent): string {
  switch (e.type) {
    case "agent":
      return `agent: ${e.message ?? ""}`;
    case "command":
      return `command: ${e.command ?? ""}`;
    case "read":
      return `read: ${e.path ?? ""}`;
    case "write":
      return `write: ${e.path ?? ""}`;
    case "search":
      return `search: ${e.query ?? ""}`;
    case "list":
      return `list: ${e.path ?? ""}`;
    case "skill":
      return `skill: ${e.path ?? ""}`;
    case "orchestration":
      return `orchestration: ${String(e.action ?? "")}`;
    case "error":
      return `error: ${e.message ?? ""}`;
    case "warning":
      return `warning: ${e.message ?? ""}`;
    default:
      return `${e.type}: ${JSON.stringify(e.raw ?? e)}`;
  }
}

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
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!worker || !runId) return;
    setEvents([]);
    setStatus({ kind: "running" });
    setError(null);
    const unsubscribe = worker.client.subscribeToRun(runId, {
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      onDone: (outcome) => {
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
  }, [worker, runId, runtime]);

  // Auto-scroll the feed as events arrive.
  useEffect(() => {
    feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
  }, [events]);

  return (
    <PageLayout>
      <PromptHeader command="--monitor" comment={<>// live run activity</>} />

      {!worker && (
        <p className={`${styles.notice} ${styles.warn}`}>
          No worker connected — the live stream comes from the worker that ran
          this job.
        </p>
      )}

      <p className={styles.muted}>
        Run id <code>{runId}</code>
      </p>

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

      <p className={styles.sectionLabel}>Live harness events</p>
      <div className={styles.feed} ref={feedRef}>
        {events.length === 0 && (
          <p className={styles.muted}>
            {status.kind === "running"
              ? "Waiting for events…"
              : "No events were recorded."}
          </p>
        )}
        {events.map((e, i) => (
          <div key={i} className={styles.feedLine}>
            <span className={styles.feedType}>{e.type}</span>
            <span className={styles.feedBody}>{describeEvent(e)}</span>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
