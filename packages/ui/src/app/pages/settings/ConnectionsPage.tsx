import { useState } from "react";
import { Panel } from "@test-cabinet/ui";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import { useBackend } from "../../../client/context";
import styles from "../runs/RunExec.module.scss";

// The Connections tab (`/settings/connections`, web/desktop only). The console
// now talks to a single backend URL — the source of truth for test cases,
// definitions, and published results, and the control plane for executing runs
// (the backend's `/jobs` queue). There is no separate worker to register: the old
// worker list and per-worker backend-match check are gone. This page just manages
// that one backend connection.
export function ConnectionsPage() {
  const backend = useBackend();
  const [backendUrl, setBackendUrl] = useState(backend.url ?? "");

  return (
    <SettingsLayout tab="connections">
      <Panel>
        <p className={styles.sectionLabel}>Backend</p>
        <p className={styles.muted}>
          The backend is the source of truth for test cases, definitions, and
          published results, and the control plane that runs are executed
          through.
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
      </Panel>
    </SettingsLayout>
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
