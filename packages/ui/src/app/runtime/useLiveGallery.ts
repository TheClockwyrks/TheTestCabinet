import { useCallback, useEffect, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  NotSupportedError,
  type BackendClient,
  type WorkerClient,
} from "../../client/clients";
import { useBackend, useWorkers } from "../../client/context";
import type {
  ProgressCallback,
  StoredRun,
  TestCase,
  VersionInfo,
} from "../../client/types";
import { frameReview } from "../data/frameReview";
import { sampleTestCases } from "../data/sampleTestCases";
import type { GalleryDataInput } from "../data/galleryContext";
import type { SeededInput, TestCaseSummary } from "../data/testCases";
import { useRunsRuntime } from "./runsRuntime";

// The shared live gallery data source for the consoles (web and desktop). It is
// written against the BackendClient/WorkerClient interfaces alone, so the two
// apps differ only in the transports behind those contexts. The published
// gallery (runs, test cases) comes from the active backend; produced-but-
// unpublished runs come from the active worker and are flagged local so they
// read as unpublished and become editable on the Verdict tab. It re-reads
// produced runs whenever the runs runtime bumps its refresh token (e.g. a
// launched run finishes). Operations a transport doesn't support are treated as
// "none" so the rest of the gallery still renders.

// Cap the published-run pagination so a misbehaving backend can't loop forever.
const MAX_PAGES = 100;

interface AssembledRuns {
  runs: RunRecord[];
  localIds: Set<string>;
  writeups: Record<string, string>;
}

function emptyRuns(): AssembledRuns {
  return { runs: [], localIds: new Set(), writeups: {} };
}

// Map a backend StoredRun (published or produced) into the gallery's run +
// writeup shapes. The record already carries populated links.
function ingest(stored: StoredRun, into: AssembledRuns, local: boolean): void {
  into.runs.push(stored.record);
  if (local) into.localIds.add(stored.id);
  if (stored.review) into.writeups[stored.id] = frameReview(stored.review);
}

async function fetchPublishedRuns(
  backend: BackendClient,
): Promise<AssembledRuns> {
  const acc = emptyRuns();
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { runs, nextCursor } = await backend.listRuns({ before });
    for (const run of runs) ingest(run, acc, false);
    if (!nextCursor || runs.length === 0) break;
    before = nextCursor;
  }
  return acc;
}

async function fetchProducedRuns(worker: WorkerClient): Promise<AssembledRuns> {
  const acc = emptyRuns();
  try {
    for (const run of await worker.listRuns()) ingest(run, acc, true);
  } catch (e) {
    // A worker that can't enumerate produced runs simply contributes none.
    if (!(e instanceof NotSupportedError)) throw e;
  }
  return acc;
}

// The files a run of a variant is seeded with, read from the backend. Spec
// bodies are served per file (by store key), so the catalog read alone can't
// carry them; we fetch the variant's resolved spec set and present each as a
// seeded text input. A variant whose specs can't be read contributes none rather
// than failing the whole catalog load.
async function fetchSeededInputs(
  backend: BackendClient,
  slug: string,
  version: string,
  variant: string,
): Promise<SeededInput[]> {
  try {
    const spec = await backend.readSpecs(slug, version, variant);
    return spec.specs.map((s) => ({
      path: s.dest,
      kind: "text" as const,
      text: s.body,
    }));
  } catch {
    return [];
  }
}

async function toTestCaseSummary(
  backend: BackendClient,
  tc: TestCase,
  info: VersionInfo,
): Promise<TestCaseSummary> {
  const variants = await Promise.all(
    info.variants.map(async (v) => ({
      slug: v.slug,
      name: v.name,
      description: v.description,
      // The rendered prompt is a run-time artifact (it interpolates the seeded
      // specs and the container workspace path), so the catalog read can't carry
      // it; it stays empty here and the Specifications tab simply omits the
      // panel. Seeded inputs and references do come from the backend.
      prompt: v.prompt ?? "",
      seededInputs: await fetchSeededInputs(backend, info.slug, info.version, v.slug),
      referenceScreenshots: (v.references ?? []).map((r) => ({
        view: r.view,
        url: r.url,
      })),
    })),
  );
  return {
    slug: info.slug,
    name: info.name,
    difficulty: info.difficulty,
    tags: info.tags,
    summary: info.summary,
    description: info.description ?? null,
    versions: tc.versions,
    latestVersion: tc.versions[0] ?? info.version,
    variants,
  };
}

async function fetchTestCases(
  backend: BackendClient,
): Promise<TestCaseSummary[]> {
  const cases = await backend.listTestCases();
  // Resolve each case's latest version for its display metadata and variants.
  return Promise.all(
    cases
      .filter((tc) => tc.versions[0])
      .map(async (tc) => {
        const info = await backend.resolveVersion(tc.slug, tc.versions[0]!);
        return toTestCaseSummary(backend, tc, info);
      }),
  );
}

export function useLiveGallery(): GalleryDataInput {
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const { refreshToken } = useRunsRuntime();

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [localIds, setLocalIds] = useState<ReadonlySet<string>>(new Set());
  const [writeups, setWriteups] = useState<Record<string, string>>({});
  const [runsLoading, setRunsLoading] = useState(false);
  const [testCases, setTestCases] = useState<TestCaseSummary[]>([]);

  const workerClient = worker?.client ?? null;

  useEffect(() => {
    let active = true;
    setRunsLoading(true);
    (async () => {
      const published = backend
        ? await fetchPublishedRuns(backend).catch(() => emptyRuns())
        : emptyRuns();
      const produced = workerClient
        ? await fetchProducedRuns(workerClient).catch(() => emptyRuns())
        : emptyRuns();
      if (!active) return;
      // Produced (local) runs lead; published runs follow, minus any the worker
      // also holds locally (the local copy wins on id collision).
      const merged = [
        ...produced.runs,
        ...published.runs.filter((r) => !produced.localIds.has(r.id)),
      ];
      setRuns(merged);
      setLocalIds(produced.localIds);
      setWriteups({ ...published.writeups, ...produced.writeups });
      setRunsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [backend, workerClient, refreshToken]);

  useEffect(() => {
    if (!backend) {
      setTestCases([]);
      return;
    }
    let active = true;
    fetchTestCases(backend)
      .then((cs) => active && setTestCases(cs))
      .catch(() => active && setTestCases([]));
    return () => {
      active = false;
    };
  }, [backend]);

  const testCasesUsingSamples = testCases.length === 0;

  // Resolve a run's recorded events by origin: a produced (local) run's streams
  // come from the worker (events + raw, off its output directory); any other run
  // is a published one read from the backend (TTC events only). A transport that
  // can't reach them (`NotSupportedError`) resolves to null so the Events tab
  // shows a clear "not available here" state rather than erroring.
  const fetchRunEvents = useCallback(
    async (runId: string, onProgress?: ProgressCallback) => {
      try {
        if (localIds.has(runId) && workerClient) {
          return await workerClient.readRunEvents(runId, onProgress);
        }
        if (backend) return await backend.readRunEvents(runId, onProgress);
        if (workerClient) {
          return await workerClient.readRunEvents(runId, onProgress);
        }
        return null;
      } catch (e) {
        if (e instanceof NotSupportedError) return null;
        throw e;
      }
    },
    [backend, workerClient, localIds],
  );

  return {
    runs,
    localIds,
    writeups,
    runsLoading,
    testCases: testCasesUsingSamples ? sampleTestCases : testCases,
    testCasesUsingSamples,
    canExecute: true,
    fetchRunEvents,
  };
}
