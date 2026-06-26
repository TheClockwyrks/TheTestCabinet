import { useEffect, useState, type ReactNode } from "react";
import {
  clusterRetry,
  clusterStatus,
  isTauri,
  listenClusterLog,
  listenClusterProgress,
  type ClusterStatus,
} from "./api";
import styles from "./BootGate.module.css";

// Holds a loading screen over the console until the desktop shell reports its
// self-contained cluster is up (see crates/desktop/src/cluster.rs). The shell
// stands the cluster up on launch; standing it up takes a while (pulling images,
// rolling out services, ingesting the catalog), so the console must not flash an
// unconfigured/empty state in the meantime. Once the bootstrap reaches a terminal
// non-error state (`ready`, or `skipped` when an external backend is configured),
// the console is revealed.
//
// In a plain browser (developing the desktop UI without the Tauri shell) there is
// no cluster and the shell commands are absent, so the gate steps aside.

// The ordered steps shown in the stepper, in bootstrap order. `ready`/`skipped`
// mean every step is complete; `error` is rendered as its own state.
const STEPS: { id: ClusterStatus["phase"]; label: string }[] = [
  { id: "preflight", label: "Prerequisites" },
  { id: "cluster", label: "Cluster" },
  { id: "services", label: "Services" },
  { id: "ingest", label: "Catalog" },
];

const SKIPPED: ClusterStatus = {
  phase: "skipped",
  detail: "",
  done: true,
  error: false,
};

// How many trailing lines of subprocess output the live tail keeps, and the
// opacity of each by distance from the newest (bottom) line — the newest three are
// full strength, the two above them fade out, so the tail reads top-to-bottom like
// a terminal while drawing the eye to the latest activity.
const TAIL = 5;
const TAIL_OPACITY = [1, 1, 1, 0.55, 0.28];

export function BootGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ClusterStatus | null>(() =>
    isTauri() ? null : SKIPPED,
  );
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    let unlistenLog: (() => void) | undefined;
    (async () => {
      // Subscribe before seeding so a status the shell set before this mount
      // (the bootstrap starts in the shell's setup hook) is never missed.
      unlisten = await listenClusterProgress((next) => {
        if (active) setStatus(next);
      });
      unlistenLog = await listenClusterLog((line) => {
        if (active) setLog((prev) => [...prev, line].slice(-TAIL));
      });
      try {
        const initial = await clusterStatus();
        if (active) setStatus((prev) => prev ?? initial);
      } catch {
        // No shell command available — treat as a host with nothing to stand up.
        if (active) setStatus((prev) => prev ?? SKIPPED);
      }
    })();
    return () => {
      active = false;
      unlisten?.();
      unlistenLog?.();
    };
  }, []);

  // Reveal the console once the bootstrap is done and didn't fail.
  if (status?.done && !status.error) {
    return <>{children}</>;
  }

  const onRetry = async () => {
    setStatus({
      phase: "preflight",
      detail: "Retrying…",
      done: false,
      error: false,
    });
    setLog([]);
    try {
      await clusterRetry();
    } catch {
      // The next progress event (or its absence) will reflect the outcome.
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <p className={styles.brand}>THE&nbsp;TEST&nbsp;CABINET</p>

        {status?.error ? (
          <Failure detail={status.detail} onRetry={onRetry} />
        ) : (
          <Progress status={status} log={log} />
        )}
      </div>
    </div>
  );
}

function Progress({
  status,
  log,
}: {
  status: ClusterStatus | null;
  log: string[];
}) {
  const phase = status?.phase ?? "preflight";
  const activeIndex = STEPS.findIndex((step) => step.id === phase);
  // `ready`/`skipped` aren't in STEPS — treat them as "all complete".
  const current = activeIndex === -1 ? STEPS.length : activeIndex;

  return (
    <>
      <p className={styles.caption}>Starting The Test Cabinet…</p>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => {
          const state =
            index < current ? "done" : index === current ? "active" : "pending";
          return (
            <li key={step.id} className={styles.step} data-state={state}>
              <span className={styles.dot} />
              {step.label}
            </li>
          );
        })}
      </ol>
      <div className={styles.bar}>
        <span className={styles.barFill} />
      </div>
      <p className={styles.detail}>{status?.detail ?? "Starting…"}</p>
      <Console log={log} />
    </>
  );
}

// A live tail of the most recent subprocess output lines (k3d/kubectl), so the
// long cluster-create and rollout waits aren't an opaque progress bar. Each line
// is a positional slot keyed by index — as new lines stream in the buffer shifts
// and the slot's opacity (oldest faintest) stays fixed, so it reads like a
// terminal scrolling upward.
function Console({ log }: { log: string[] }) {
  if (log.length === 0) return null;
  return (
    <div className={styles.console} aria-hidden>
      {log.map((line, index) => {
        const fromBottom = log.length - 1 - index;
        return (
          <span
            // eslint-disable-next-line react/no-array-index-key -- positional slot
            key={index}
            className={styles.logLine}
            style={{ opacity: TAIL_OPACITY[fromBottom] ?? 0.28 }}
          >
            {line}
          </span>
        );
      })}
    </div>
  );
}

function Failure({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <div className={styles.errorCard}>
      <p className={styles.errorTitle}>Couldn&apos;t start the local cluster</p>
      <p className={styles.errorDetail}>{detail}</p>
      <button type="button" className={styles.retry} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
