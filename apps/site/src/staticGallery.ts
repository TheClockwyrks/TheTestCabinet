import { useCallback, useEffect, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { HarnessEvent, ProgressCallback } from "@test-cabinet/ui/client";
import { readTextWithProgress } from "@test-cabinet/ui/client";
import {
  sampleRuns,
  sampleTestCases,
  type GalleryDataInput,
} from "@test-cabinet/ui/app";
import {
  runs as publishedRuns,
  writeups as publishedWriteups,
  testCases as catalogTestCases,
  proofMediaUrls as publishedProofMediaUrls,
} from "virtual:tcab-snapshot";

// The static site's gallery data source. It is the build-time public R2 snapshot
// (inlined by vite-plugin-snapshot) — fully static, never querying the backend
// at runtime — merged in dev with produced-but-unpublished runs served from disk
// by the localRuns plugin, and falling back to the design-preview samples when
// nothing has been published yet. This is the old `useRuns`/`useTestCases`
// assembly, now producing one `GalleryDataInput` the shared app consumes. The
// site cannot run tests, so `canExecute` is false and `inProgress` is empty.

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

  // Samples are a fallback only — drop them the moment any real run exists.
  const base =
    publishedRuns.length > 0 || local.length > 0 ? publishedRuns : sampleRuns;
  const runs = [...local, ...base.filter((run) => !localIds.has(run.id))];

  const testCasesUsingSamples = catalogTestCases.length === 0;
  const testCases = testCasesUsingSamples ? sampleTestCases : catalogTestCases;

  // Local previews take precedence over the published framing on id collision.
  const writeups = { ...publishedWriteups, ...localWriteups };

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

  // A published run's proof media, resolved at build time to absolute snapshot
  // URLs keyed by run id then served file name (`<proof-id>.<ext>`). Produced
  // (local, dev-only) runs are not published, so they have no snapshot media.
  const proofMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      publishedProofMediaUrls[runId]?.[file] ?? null,
    [],
  );

  return {
    runs,
    localIds,
    writeups,
    runsLoading: loading,
    testCases,
    testCasesUsingSamples,
    canExecute: false,
    fetchRunEvents,
    proofMediaUrl,
  };
}
