import { useState, type CSSProperties } from "react";
import { useBackend, useWorkers } from "../client/context";
import { RunScreen } from "./RunScreen";
import { SpecsScreen } from "./SpecsScreen";
import { ReviewScreen } from "./ReviewScreen";
import { ConnectionsScreen } from "./ConnectionsScreen";
import styles from "./Console.module.scss";

type Tab = "run" | "specs" | "review" | "connections";

const TABS: { id: Tab; label: string }[] = [
  { id: "run", label: "Run" },
  { id: "specs", label: "Specs" },
  { id: "review", label: "Runs & Review" },
  { id: "connections", label: "Connections" },
];

interface ConsoleProps {
  /** App title shown in the header (e.g. "The Test Cabinet"). */
  title?: string;
}

// The shared runner/reporter console: the app shell that web and tauri both
// mount. It assumes a <BackendProvider> and <WorkersProvider> are above it (each
// app supplies its own transport and connection state). The only difference
// between web and tauri is what those providers contain.
export function Console({ title = "The Test Cabinet" }: ConsoleProps) {
  const [tab, setTab] = useState<Tab>("run");

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <nav className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <ConnectionBar onManage={() => setTab("connections")} />

      <section className={styles.content}>
        {tab === "run" && <RunScreen />}
        {tab === "specs" && <SpecsScreen />}
        {tab === "review" && <ReviewScreen />}
        {tab === "connections" && <ConnectionsScreen />}
      </section>
    </main>
  );
}

// A compact summary of the current connections, with a shortcut to manage them.
function ConnectionBar({ onManage }: { onManage: () => void }) {
  const backend = useBackend();
  const workers = useWorkers();
  const backendOk = backend.status === "ready";
  const active = workers.active;

  return (
    <div className={styles.bar}>
      <span
        className={styles.barDot}
        style={
          {
            "--dot-color": backendOk
              ? "var(--tcab-positive)"
              : "var(--tcab-negative)",
          } as CSSProperties
        }
      />
      <span>
        Backend: {backend.url ?? "none"}
        {backendOk ? "" : ` (${backend.status})`}
      </span>
      <span>·</span>
      <span>
        Worker:{" "}
        {active
          ? `${active.label} [${active.backendMatch}]`
          : `none (${workers.workers.length} configured)`}
      </span>
      <button className={styles.secondary} onClick={onManage}>
        Manage
      </button>
    </div>
  );
}
