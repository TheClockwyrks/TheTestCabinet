import { useEffect, useState, type ReactNode } from "react";
import {
  clusterRetry,
  clusterStatus,
  isTauri,
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

export function BootGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ClusterStatus | null>(() =>
    isTauri() ? null : SKIPPED,
  );

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    (async () => {
      // Subscribe before seeding so a status the shell set before this mount
      // (the bootstrap starts in the shell's setup hook) is never missed.
      unlisten = await listenClusterProgress((next) => {
        if (active) setStatus(next);
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
          <Progress status={status} />
        )}
      </div>
    </div>
  );
}

function Progress({ status }: { status: ClusterStatus | null }) {
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
    </>
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
