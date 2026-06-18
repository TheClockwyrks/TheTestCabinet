import { useEffect, useState } from "react";
import styles from "./App.module.scss";
import { isTauri } from "./api";
import { RunView } from "./views/RunView";
import { SpecsView } from "./views/SpecsView";
import { RunsView } from "./views/RunsView";

type Tab = "run" | "specs" | "runs";

const TABS: { id: Tab; label: string }[] = [
  { id: "run", label: "Run" },
  { id: "specs", label: "Specs" },
  { id: "runs", label: "Runs & Review" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("run");
  const [inTauri, setInTauri] = useState<boolean | null>(null);

  useEffect(() => {
    setInTauri(isTauri());
  }, []);

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>The Test Cabinet</h1>
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

      {inTauri === false && (
        <p className={`${styles.notice} ${styles.error}`}>
          Not running inside the desktop shell. Launch the Tauri app
          (&nbsp;<code>npm run dev -w @test-cabinet/desktop</code> via{" "}
          <code>cargo tauri dev</code>&nbsp;) so the core commands are available.
        </p>
      )}

      <section className={styles.content}>
        {tab === "run" && <RunView />}
        {tab === "specs" && <SpecsView />}
        {tab === "runs" && <RunsView />}
      </section>
    </main>
  );
}
