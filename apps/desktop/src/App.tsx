import { useEffect, useState } from "react";
import styles from "./App.module.scss";

// Harness slugs as defined by the run record contract. The Tauri core exposes
// the set of supported harnesses through the `list_harnesses` command.
const HARNESS_SLUGS = [
  "claude",
  "codex",
  "cline",
  "antigravity",
  "goose",
  "kilo",
  "opencode",
  "pi",
] as const;

type HarnessSlug = (typeof HARNESS_SLUGS)[number];

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; harnesses: HarnessSlug[] }
  | { kind: "fallback" }
  | { kind: "error"; message: string };

// Detect whether we are running inside the Tauri shell. Outside Tauri (e.g. a
// plain browser via `vite preview`) the injected globals are absent, so the UI
// degrades gracefully instead of throwing.
function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

async function listHarnesses(): Promise<HarnessSlug[]> {
  // Imported lazily so the bundle does not require Tauri to be present at load
  // time; this keeps the app runnable in a normal browser for development.
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HarnessSlug[]>("list_harnesses");
}

export function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!isTauri()) {
      setState({ kind: "fallback" });
      return;
    }

    let active = true;
    listHarnesses()
      .then((harnesses) => {
        if (active) setState({ kind: "ready", harnesses });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.app}>
      <h1 className={styles.title}>The Test Cabinet</h1>
      <p className={styles.subtitle}>
        Configure and launch benchmark runs against supported agent harnesses.
      </p>

      <p className={styles.sectionLabel}>Available harnesses</p>
      <HarnessSection state={state} />
    </main>
  );
}

function HarnessSection({ state }: { state: LoadState }) {
  switch (state.kind) {
    case "loading":
      return <p className={styles.notice}>Loading harnesses&hellip;</p>;
    case "fallback":
      return (
        <p className={styles.notice}>
          Not running inside the desktop shell. Launch the Tauri app to query
          available harnesses from the core.
        </p>
      );
    case "error":
      return (
        <p className={`${styles.notice} ${styles.error}`}>
          Failed to load harnesses: {state.message}
        </p>
      );
    case "ready":
      return (
        <ul className={styles.harnessList}>
          {state.harnesses.map((slug) => (
            <li key={slug} className={styles.harness}>
              {slug}
            </li>
          ))}
        </ul>
      );
  }
}
