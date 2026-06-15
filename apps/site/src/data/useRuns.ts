import { useEffect, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { runs as publishedRuns } from "./runs";
import { sampleRuns } from "./sampleRuns";

// Dev endpoint exposed by the `localRuns` Vite plugin.
const LOCAL_RUNS_URL = "/__local-runs__/index.json";

export interface RunsState {
  /** The runs to display: local (unpublished) first, then published. */
  runs: RunRecord[];
  /** Ids of runs sourced from local disk — i.e. not yet published. */
  localIds: ReadonlySet<string>;
  /** Raw writeups for local runs, keyed by run id, for pre-publish preview. */
  localWriteups: Readonly<Record<string, string>>;
  /** True while local runs are still being fetched (dev only). */
  loading: boolean;
}

interface LocalRunsResponse {
  runs?: RunRecord[];
  writeups?: Record<string, string>;
}

// Assembles the gallery's run list. In dev it fetches produced-but-unpublished
// runs from disk and merges them ahead of the published dataset (local wins on
// id collision). When neither published nor local runs exist, it falls back to
// the design-preview samples so the UI still has content. In a production build
// the fetch is skipped and only published runs are shown.
export function useRuns(): RunsState {
  const [localRuns, setLocalRuns] = useState<RunRecord[] | null>(null);
  const [localWriteups, setLocalWriteups] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(import.meta.env.DEV);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let active = true;
    fetch(LOCAL_RUNS_URL)
      .then((response) =>
        response.ok ? (response.json() as Promise<LocalRunsResponse>) : { runs: [] },
      )
      .then((data) => {
        if (!active) return;
        setLocalRuns(data.runs ?? []);
        setLocalWriteups(data.writeups ?? {});
      })
      .catch(() => {
        if (active) setLocalRuns([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const local = localRuns ?? [];
  const localIds = new Set(local.map((run) => run.id));

  // Samples are a fallback only — drop them the moment any real run exists.
  const base =
    publishedRuns.length > 0 || local.length > 0 ? publishedRuns : sampleRuns;
  const runs = [...local, ...base.filter((run) => !localIds.has(run.id))];

  return { runs, localIds, localWriteups, loading };
}
