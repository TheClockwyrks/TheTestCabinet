import { Panel } from "@clockwyrks/ui";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import { useBackend } from "../../../client/context";
import styles from "../runs/RunExec.module.scss";

// The Connections tab (`/settings/connections`, web console only). The console
// names no service URL: the backend is `/api` of the origin the console is
// served from (components/web/overview.md, "Configuration"), so there is nothing
// to point it at. The page only says whether that backend answers.
export function ConnectionsPage() {
  return (
    <SettingsLayout tab="connections">
      <Panel>
        <p className={styles.sectionLabel}>Backend</p>
        <p className={styles.muted}>
          The backend is the source of truth for test cases, definitions, and
          published results, and the control plane that runs are executed
          through. The console reaches it at <code>/api</code> of its own
          origin.
        </p>
        <BackendStatusLine />
      </Panel>
    </SettingsLayout>
  );
}

function BackendStatusLine() {
  const backend = useBackend();
  if (backend.status === "connecting") {
    return <p className={styles.muted}>Connecting to the backend…</p>;
  }
  if (backend.status === "error") {
    return (
      <p className={`${styles.notice} ${styles.error}`}>
        Couldn&rsquo;t reach the backend: {backend.error ?? "unavailable"}
      </p>
    );
  }
  const id = backend.identity;
  return (
    <p className={`${styles.notice} ${styles.ok}`}>
      Connected to the backend
      {id?.version ? ` (v${id.version})` : ""}:{" "}
      {id?.storeReady ? "store ready" : "store not ready"}.
    </p>
  );
}
