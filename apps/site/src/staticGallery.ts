import { useCallback, useEffect, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { HarnessEvent, ProgressCallback } from "@test-cabinet/ui/client";
import { readTextWithProgress } from "@test-cabinet/ui/client";
import {
  toModelSummary,
  toRunSummary,
  type GalleryDataInput,
} from "@test-cabinet/ui/app";
import {
  runs as publishedRuns,
  runSummaries as publishedRunSummaries,
  writeups as publishedWriteups,
  reviews as publishedReviews,
  testCases as catalogTestCases,
  models as catalogModels,
  proofMediaUrls as publishedProofMediaUrls,
  assetMediaUrls as publishedAssetMediaUrls,
} from "virtual:tcab-snapshot";

// The static site's gallery data source. It is the build-time public R2 snapshot
// (inlined by vite-plugin-snapshot) — fully static, never querying the backend
// at runtime — merged in dev with produced-but-unpublished runs served from disk
// by the localRuns plugin. This is the old `useRuns`/`useTestCases` assembly, now
// producing one `GalleryDataInput` the shared app consumes. Its data is static,
// so the catalog is always resolved (`testCasesStatus: "ready"`); an empty
// snapshot simply renders the empty states. The site cannot run tests, so
// `canExecute` is false and `inProgress` is empty.

const LOCAL_RUNS_URL = "/__local-runs__/index.json";

interface LocalRunsResponse {
  runs?: RunRecord[];
  writeups?: Record<string, string>;
}

export function useStaticGallery(): GalleryDataInput {
  const [localRuns, setLocalRuns] = useState<RunRecord[] | null>(null);
  const [localWriteups, setLocalWriteups] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState<boolean>(import.meta.env.DEV);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let active = true;
    fetch(LOCAL_RUNS_URL)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<LocalRunsResponse>)
          : { runs: [] },
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

  const runs = [
    ...local,
    ...publishedRuns.filter((run) => !localIds.has(run.id)),
  ];

  // The bounded summary cards, in the same order as `runs`: dev-only local runs
  // have no published summary, so derive theirs from the full record (they are
  // unreviewed previews, so no reviews / null rating is correct); the published
  // runs supply their cards verbatim from the snapshot's summary index.
  const runSummaries = [
    ...local.map((run) => toRunSummary(run, [])),
    ...publishedRunSummaries.filter((summary) => !localIds.has(summary.id)),
  ];

  const testCases = catalogTestCases;

  // Local previews take precedence over the published framing on id collision.
  const writeups = { ...publishedWriteups, ...localWriteups };

  // The published per-reviewer breakdown (the run-detail page's source). The site
  // never has unpublished, multi-review local runs, so the snapshot's reviews are
  // the whole of it.
  const reviews = publishedReviews;

  // The Events tab's data source on the static site: a published run's normalized
  // event stream, emitted at build time as a per-run static asset by
  // vite-plugin-snapshot (raw harness output is never published). A run without
  // events (or one published before they were captured) resolves to an empty
  // stream rather than failing. Stable identity so the Events tab doesn't refetch
  // on every render.
  const fetchRunEvents = useCallback(
    async (runId: string, onProgress?: ProgressCallback) => {
      const url = `${import.meta.env.BASE_URL}run-events/${encodeURIComponent(
        runId,
      )}.json`;
      try {
        const response = await fetch(url);
        if (!response.ok) return { events: [], raw: null };
        // The published event asset can be large, so stream it with transfer
        // progress for the Events tab's progress bar.
        const text = await readTextWithProgress(response, onProgress);
        const events = JSON.parse(text) as HarnessEvent[];
        return { events, raw: null };
      } catch {
        return { events: [], raw: null };
      }
    },
    [],
  );

  // Lazily resolve one run's full record. Published runs are emitted at build
  // time as a per-run static asset (`runs/<id>.json`) by vite-plugin-snapshot, so
  // a summary-first page can fetch a whole record on demand without the bundle
  // inlining every record (the U7 cleanup drops the inlined `runs` array in favor
  // of this). Falls back to the in-memory `runs` array — dev-only local runs (not
  // emitted as assets) and any published run whose asset 404s — and finally null.
  // Wired as the host's `readRun` hook; the gallery context's `fetchRun`
  // delegates to it. Stable identity so consumers don't refetch on every render.
  const fetchRun = useCallback(
    async (runId: string): Promise<RunRecord | null> => {
      const inMemory = runs.find((run) => run.id === runId);
      if (inMemory) return inMemory;
      const url = `${import.meta.env.BASE_URL}runs/${encodeURIComponent(
        runId,
      )}.json`;
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return (await response.json()) as RunRecord;
      } catch {
        return null;
      }
    },
    // `runs` is rebuilt each render, but its only varying input is the loaded
    // local runs (the published set is a build-time constant); key on that.
    [localRuns],
  );

  // A published run's proof media, resolved at build time to absolute snapshot
  // URLs keyed by run id then served file name (`<proof-id>.<ext>`). Produced
  // (local, dev-only) runs are not published, so they have no snapshot media.
  const proofMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      publishedProofMediaUrls[runId]?.[file] ?? null,
    [],
  );

  // A published asset-generation run's media (regenerated/preview/target image +
  // action log), resolved at build time to absolute snapshot URLs keyed by run id
  // then served file name (`regenerated.png`, etc.). Produced (local, dev-only)
  // runs are not published, so they have no snapshot media.
  const assetMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      publishedAssetMediaUrls[runId]?.[file] ?? null,
    [],
  );

  return {
    runs,
    runSummaries,
    localIds,
    writeups,
    reviews,
    runsLoading: loading,
    testCases,
    testCasesStatus: "ready",
    // The model catalog is baked into the snapshot at build time, so it is always
    // resolved; the site has no backend to mutate it, so the config affordances
    // hide (no `createModel` on any client here).
    models: catalogModels.map(toModelSummary),
    modelsStatus: "ready",
    canExecute: false,
    fetchRunEvents,
    // The host's lazy single-run fetcher; the gallery context's `fetchRun`
    // delegates to it (falling back to the in-memory `runs` internally).
    readRun: fetchRun,
    proofMediaUrl,
    assetMediaUrl,
  };
}
