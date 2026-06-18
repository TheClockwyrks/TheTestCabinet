import { useState } from "react";
import { useBackend, useWorkers } from "../../client/context";
import type { BackendMatch } from "../../client/types";
import styles from "../pages/runs/RunExec.module.scss";

const MATCH_LABEL: Record<BackendMatch, string> = {
  match: "backend ✓",
  mismatch: "backend ✗",
  unverified: "unverified",
};

// The connections settings drawer, opened from the topbar gear (web/desktop
// only). Manages the single active backend (catalog + published data) and the
// set of workers (execution). Each worker is checked against the active backend
// so the UI never asks a worker for a test case it can't resolve. Ported from the
// old console Connections screen.
export function ConnectionsDrawer({ onClose }: { onClose: () => void }) {
  const backend = useBackend();
  const workers = useWorkers();
  const [backendUrl, setBackendUrl] = useState(backend.url ?? "");
  const [workerUrl, setWorkerUrl] = useState("");
  const [workerLabel, setWorkerLabel] = useState("");

  return (
    <div
      className={styles.drawerOverlay}
      onClick={onClose}
      role="presentation"
    >
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Connections"
      >
        <div className={styles.drawerHead}>
          <h2 className={styles.drawerTitle}>Connections</h2>
          <button
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Close connections"
          >
            ×
          </button>
        </div>

        <p className={styles.sectionLabel}>Backend</p>
        <p className={styles.muted}>
          The backend is the source of truth for test cases, definitions, and
          published results. Every connected worker must be bound to it.
        </p>
        <form
          className={styles.addForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (backendUrl.trim()) backend.setUrl(backendUrl.trim());
          }}
        >
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Backend URL</span>
            <input
              className={styles.input}
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://backend.internal"
            />
          </label>
          <button className={styles.secondary} type="submit">
            Connect
          </button>
        </form>
        <BackendStatusLine />

        <p className={styles.sectionLabel}>Workers</p>
        <p className={styles.muted}>
          Workers execute runs. The active worker is the one a launched run is
          submitted to.
        </p>
        <ul className={styles.connList}>
          {workers.workers.length === 0 && (
            <li className={styles.muted}>
              No workers connected. Add one below to launch runs.
            </li>
          )}
          {workers.workers.map((w) => (
            <li
              key={w.id}
              className={`${styles.connItem} ${w.id === workers.activeId ? styles.connItemActive : ""}`}
              onClick={() => workers.setActive(w.id)}
            >
              <div className={styles.connMain}>
                <div className={styles.connLabel}>
                  {w.label}
                  {w.local ? " (local)" : ""}
                </div>
                <div className={styles.connUrl}>
                  {w.url ?? "built-in local core"}
                </div>
              </div>
              <span className={styles.matchBadge} data-match={w.backendMatch}>
                {MATCH_LABEL[w.backendMatch]}
              </span>
              {!w.local && (
                <button
                  className={styles.secondary}
                  onClick={(e) => {
                    e.stopPropagation();
                    workers.removeWorker(w.id);
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        <form
          className={styles.addForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (!workerUrl.trim()) return;
            workers.addWorker({
              url: workerUrl.trim(),
              label: workerLabel.trim() || undefined,
            });
            setWorkerUrl("");
            setWorkerLabel("");
          }}
        >
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Worker URL</span>
            <input
              className={styles.input}
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="http://worker.internal:8080"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Label (optional)</span>
            <input
              className={styles.input}
              value={workerLabel}
              onChange={(e) => setWorkerLabel(e.target.value)}
              placeholder="e.g. gpu-box"
            />
          </label>
          <button className={styles.secondary} type="submit">
            Add worker
          </button>
        </form>
      </aside>
    </div>
  );
}

function BackendStatusLine() {
  const backend = useBackend();
  if (backend.status === "unconfigured") {
    return <p className={styles.muted}>No backend configured.</p>;
  }
  if (backend.status === "connecting") {
    return <p className={styles.muted}>Connecting to {backend.url}…</p>;
  }
  if (backend.status === "error") {
    return (
      <p className={`${styles.notice} ${styles.error}`}>
        Couldn&rsquo;t reach {backend.url}: {backend.error ?? "unavailable"}
      </p>
    );
  }
  const id = backend.identity;
  return (
    <p className={`${styles.notice} ${styles.ok}`}>
      Connected to {backend.url}
      {id?.version ? ` (v${id.version})` : ""} —{" "}
      {id?.storeReady ? "store ready" : "store not ready"}.
    </p>
  );
}
