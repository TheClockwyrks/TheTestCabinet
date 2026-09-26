import { useEffect, useMemo, useState } from "react";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { useGalleryData } from "./galleryContext";
import type { RunQuery, RunQueryResult } from "./runQuery";

// A model's runs are drained a bounded window at a time, model-scoped, the same
// way the case tabs drain their case (see `useCaseRunSummaries`). One model rarely
// has enough runs to need more than a page.
const MODEL_PAGE_LIMIT = 1000;

export interface ModelRunSummariesState {
  /** Every published run summary across the model's ids, deduped by run id. */
  summaries: RunSummary[];
  /** True while the model's runs are still being fetched. */
  loading: boolean;
}

// Drain every published run summary for a single model id, a bounded window at a
// time (a single model rarely holds more than a page). Host-agnostic: the console
// forwards each window to the backend offset endpoint; the static site slices its
// in-memory index — same param shape, same result.
async function drainModelSummaries(
  query: (q: RunQuery) => Promise<RunQueryResult>,
  modelId: string,
): Promise<RunSummary[]> {
  const acc: RunSummary[] = [];
  for (let offset = 0; ; offset += MODEL_PAGE_LIMIT) {
    const { summaries, total } = await query({
      state: "published",
      model: modelId,
      offset,
      limit: MODEL_PAGE_LIMIT,
    });
    acc.push(...summaries);
    if (summaries.length === 0 || acc.length >= total) break;
  }
  return acc;
}

// Every published run of a model, across all of the model ids it covers, deduped
// by run id. A curated model can claim more than one canonical id, and the server
// filters by a single id at a time, so we drain each id and merge — otherwise a
// model's runs recorded under a secondary id would be missed (the same
// single-id caveat `ModelRunsPage` notes for its paged listing). Only published
// runs are returned, so downstream rates read as fractions of the model's public
// runs — identical on the static site and the console.
export function useModelRunSummaries(
  modelIds: readonly string[],
): ModelRunSummariesState {
  const { queryRunSummaries } = useGalleryData();
  const [summaries, setSummaries] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Stabilize the id list so the effect only re-runs when the actual ids change,
  // not on every render's fresh array identity.
  // Joined on NUL — the one character a model id cannot contain, so the key round-trips
  // back into exactly the ids that went in.
  const idsKey = useMemo(() => modelIds.join("\u0000"), [modelIds]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const ids = idsKey ? idsKey.split("\u0000") : [];
    Promise.all(ids.map((id) => drainModelSummaries(queryRunSummaries, id)))
      .then((perId) => {
        if (!active) return;
        // Merge across ids, keeping one row per run id (a run has exactly one
        // model id, so overlap only happens if the same id repeats).
        const byId = new Map<string, RunSummary>();
        for (const rows of perId) {
          for (const row of rows) byId.set(row.id, row);
        }
        setSummaries([...byId.values()]);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSummaries([]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryRunSummaries, idsKey]);

  return { summaries, loading };
}
