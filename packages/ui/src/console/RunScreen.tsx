import { useEffect, useRef, useState } from "react";
import { useBackend, useWorkers } from "../client/context";
import type {
  HarnessEvent,
  HarnessInfo,
  Model,
  RunOutcome,
} from "../client/types";
import { CaseSelector } from "./CaseSelector";
import { useCatalog } from "./useCatalog";
import styles from "./Console.module.scss";

type RunStatus =
  | { kind: "idle" }
  | { kind: "running"; runId: string }
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

// Configure and launch a run. The catalog (cases, harnesses, models) comes from
// the active backend; the run is submitted to the active worker, whose live
// event stream is rendered below.
export function RunScreen() {
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const sel = useCatalog();
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [harness, setHarness] = useState("");
  const [modelId, setModelId] = useState("");
  const [maxRuntime, setMaxRuntime] = useState("");
  const [status, setStatus] = useState<RunStatus>({ kind: "idle" });
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!backend) return;
    backend
      .listHarnesses()
      .then((hs) => {
        setHarnesses(hs);
        if (hs[0]) setHarness(hs[0].slug);
      })
      .catch((e) => setLaunchError(String(e)));
    backend
      .listModels()
      .then((ms) => {
        setModels(ms);
        const firstId = ms[0]?.modelIds[0] ?? ms[0]?.slug ?? "";
        setModelId(firstId);
      })
      .catch(() => {
        // The model catalog is optional; leave the field free-text.
      });
  }, [backend]);

  // Auto-scroll the feed as events arrive.
  useEffect(() => {
    feedRef.current?.scrollTo(0, feedRef.current.scrollHeight);
  }, [events]);

  async function onLaunch() {
    if (!worker) return;
    setLaunchError(null);
    setEvents([]);
    let unsubscribe: (() => void) | null = null;
    try {
      const runId = await worker.client.launchRun({
        testCase: sel.slug,
        version: sel.version,
        variant: sel.variant,
        harness,
        modelId,
        maxRuntimeOverride: maxRuntime ? Number(maxRuntime) : null,
      });
      setStatus({ kind: "running", runId });

      unsubscribe = worker.client.subscribeToRun(runId, {
        onEvent: (event) => setEvents((prev) => [...prev, event]),
        onDone: (outcome) => {
          setStatus({ kind: "done", outcome });
          unsubscribe?.();
        },
        onError: (e) => {
          setLaunchError(String(e));
          unsubscribe?.();
        },
      });
    } catch (e) {
      // A synchronous launch failure (bad config, no runtime) returns an error.
      setLaunchError(String(e));
      setStatus({ kind: "idle" });
      unsubscribe?.();
    }
  }

  const running = status.kind === "running";
  const mismatched = worker?.backendMatch === "mismatch";
  const canLaunch = Boolean(
    worker &&
      !mismatched &&
      sel.slug &&
      sel.version &&
      sel.variant &&
      harness &&
      modelId &&
      !running,
  );

  return (
    <div className={styles.view}>
      <h2 className={styles.viewTitle}>Configure & launch a run</h2>

      {!worker && (
        <p className={`${styles.notice} ${styles.warn}`}>
          No worker connected — open the Connections tab to add a worker server
          to run on.
        </p>
      )}
      {mismatched && (
        <p className={`${styles.notice} ${styles.error}`}>
          The active worker is bound to a different backend than the one this
          console is pointed at. Launching is disabled to avoid asking for a test
          case the worker can't resolve.
        </p>
      )}
      {sel.noBackend && (
        <p className={`${styles.notice} ${styles.warn}`}>
          No backend configured — the test-case catalog comes from the backend.
        </p>
      )}

      <CaseSelector sel={sel} />

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Harness</span>
          <select
            className={styles.select}
            value={harness}
            onChange={(e) => setHarness(e.target.value)}
          >
            {harnesses.map((h) => (
              <option key={h.slug} value={h.slug}>
                {h.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Model</span>
          <input
            className={styles.input}
            list="model-ids"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="model id (e.g. claude-opus-4-8)"
          />
          <datalist id="model-ids">
            {models.flatMap((m) =>
              m.modelIds.map((id) => <option key={id} value={id} />),
            )}
          </datalist>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Max runtime (s, optional)</span>
          <input
            className={styles.input}
            type="number"
            min={1}
            value={maxRuntime}
            onChange={(e) => setMaxRuntime(e.target.value)}
            placeholder={
              sel.versionInfo
                ? `default ${sel.versionInfo.maxRuntimeSeconds}`
                : "default"
            }
          />
        </label>
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} onClick={onLaunch} disabled={!canLaunch}>
          {running ? "Running…" : "Launch run"}
        </button>
        {sel.loading && <span className={styles.muted}>resolving version…</span>}
      </div>

      {(launchError || sel.error) && (
        <p className={`${styles.notice} ${styles.error}`}>
          {launchError ?? sel.error}
        </p>
      )}

      <RunStatusBanner status={status} />

      <div className={styles.feedWrap}>
        <p className={styles.sectionLabel}>Live harness events</p>
        <div className={styles.feed} ref={feedRef}>
          {events.length === 0 && (
            <p className={styles.muted}>
              No events yet. Launch a run to watch its activity stream.
            </p>
          )}
          {events.map((e, i) => (
            <div key={i} className={styles.feedLine}>
              <span className={styles.feedType}>{e.type}</span>
              <span className={styles.feedBody}>{describeEvent(e)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RunStatusBanner({ status }: { status: RunStatus }) {
  if (status.kind === "running") {
    return (
      <p className={styles.notice}>
        Run in progress — id <code>{status.runId}</code>. Events stream below.
      </p>
    );
  }
  if (status.kind === "done") {
    if (status.outcome.kind === "failed") {
      return (
        <p className={`${styles.notice} ${styles.error}`}>
          Run failed: {status.outcome.message}
        </p>
      );
    }
    const r = status.outcome.record;
    return (
      <p className={`${styles.notice} ${styles.ok}`}>
        Run {r.id} complete — state {r.status.state}, loaded{" "}
        {String(r.validation.loaded)}, cost ${r.metrics.cost.comparable.toFixed(4)}.
        Open the Review tab to review and publish it.
      </p>
    );
  }
  return null;
}
