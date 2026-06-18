import { useEffect, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  sampleRuns,
  sampleTestCases,
  type GalleryDataInput,
} from "@test-cabinet/ui/app";
import {
  runs as publishedRuns,
  writeups as publishedWriteups,
  testCases as catalogTestCases,
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

  return {
    runs,
    localIds,
    writeups,
    runsLoading: loading,
    testCases,
    testCasesUsingSamples,
    canExecute: false,
  };
}
