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
  StoredReview,
  StoredRun,
  TestCase,
  VersionInfo,
} from "../../client/types";
import { frameReviews } from "../data/frameReview";
import { toModelSummary, type ModelSummary } from "../data/models";
import type {
  ArenaApi,
  CatalogStatus,
  GalleryDataInput,
  HarnessAuthApi,
} from "../data/galleryContext";
import type {
  ChangelogEntry,
  SeededInput,
  TestCaseSummary,
} from "../data/testCases";
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
  reviews: Record<string, StoredReview[]>;
}

function emptyRuns(): AssembledRuns {
  return { runs: [], localIds: new Set(), writeups: {}, reviews: {} };
}

// Map a backend StoredRun (published or produced) into the gallery's run +
// review shapes. The record already carries populated links. A run can carry more
// than one review now; the individual reviews are kept for the detail page, and
// an aggregate writeup (worst rating per domain, strictest checklist) is framed
// for the cards/leaderboard/badges that read one writeup per run.
function ingest(stored: StoredRun, into: AssembledRuns, local: boolean): void {
  into.runs.push(stored.record);
  if (local) into.localIds.add(stored.id);
  const reviews = stored.reviews ?? [];
  if (reviews.length > 0) into.reviews[stored.id] = reviews;
  const framed = frameReviews(reviews);
  if (framed !== null) into.writeups[stored.id] = framed;
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
    // `listRuns` is the worker's full produced worklist: every pushed-but-
    // unpublished run, whatever its terminal state — completed (awaiting review),
    // a publishable failure (awaiting publish), and an infrastructure failure
    // (retained for inspection, in no other worklist). All are flagged local so
    // they read as unpublished and stay visible — in the run list and the detail
    // page — until published. The separate publishable-failures worklist
    // (`listFailures`) is read by the Publish-failures page directly, so it is not
    // merged here (it would duplicate the unpublished failures and pull in the
    // published ones).
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
      role: s.kind ?? "spec",
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
  changelog: ChangelogEntry[],
): Promise<TestCaseSummary> {
  const variants = await Promise.all(
    info.variants.map(async (v) => ({
      slug: v.slug,
      name: v.name,
      description: v.description,
      // The backend renders the prompt and serves the references; the seeded
      // spec bodies are fetched per file (see fetchSeededInputs).
      prompt: v.prompt,
      seededInputs: await fetchSeededInputs(
        backend,
        info.slug,
        info.version,
        v.slug,
      ),
      // Case-level runtime packages ride on the resolved version; every variant of
      // the case ships the same set, so carry them onto each variant summary.
      packages: info.packages ?? [],
      referenceScreenshots: v.references.map((r) => ({
        view: r.view,
        kind: r.kind,
        url: r.url,
      })),
      reviewItems: v.reviewItems.map((item) => ({
        id: item.id,
        title: item.title,
        text: item.text,
        reference: item.reference ?? null,
        proof: item.proof ?? null,
        sequences: item.sequences ?? [],
        frames: item.frames ?? [],
        weight: item.weight,
        domain: item.domain ?? null,
      })),
      // The variant's effective scoring domains (common + its own), already
      // merged on the resolved VariantInfo — the set a run of this variant is
      // rated against.
      domains: v.domains.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
      })),
    })),
  );
  return {
    slug: info.slug,
    name: info.name,
    testType: info.testType,
    // The asset shape (asset family), so the catalog can partition its 2D / 3D /
    // Particle / Audio tabs. Null for a non-asset case or a host that omits it.
    assetKind: info.assetKind ?? null,
    difficulty: info.difficulty,
    tags: info.tags,
    summary: info.summary,
    description: info.description ?? null,
    changelog,
    versions: tc.versions,
    latestVersion: tc.versions[0] ?? info.version,
    variants,
    domains: info.domains.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
    })),
    // Case-level: the sprite-sheet declaration (frames + named sequences), so the
    // live monitor can render one stable slot per declared frame. Null for a
    // single sprite or any non-asset case.
    sheet: info.sheet ?? null,
    // Case-level: the voxel rig (parts + joints), so the live monitor can render
    // one stable slot per declared part. Null for a static voxel model, a 2D
    // sprite/sheet, or any non-asset case.
    model: info.model ?? null,
  };
}

async function fetchTestCases(
  backend: BackendClient,
): Promise<TestCaseSummary[]> {
  const cases = await backend.listTestCases();
  return Promise.all(
    cases
      .filter((tc) => tc.versions.length > 0)
      .map(async (tc) => {
        // The backend lists a case's versions oldest-first; the catalog presents
        // them newest-first (see TestCaseSummary.versions), so sort before use.
        // The newest then supplies the case's display metadata and variants, and
        // resolving in this order yields the changelog newest-first — each version
        // contributing its own entry (every version declares a changelog).
        const versions = [...tc.versions].sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true }),
        );
        const infos = await Promise.all(
          versions.map((version) => backend.resolveVersion(tc.slug, version)),
        );
        const changelog: ChangelogEntry[] = infos.map((info) => ({
          version: info.version,
          body: info.changelog,
        }));
        return toTestCaseSummary(
          backend,
          { ...tc, versions },
          infos[0]!,
          changelog,
        );
      }),
  );
}

// The host supplies its own arena capability (the consoles wire one when a worker
// is connected; the static site never calls this hook). It is threaded through
// unchanged so the arena UI resolves it off the shared gallery data. `harnessAuth`
// is the same: only the desktop host (which manages the local cluster's harness
// credentials) supplies it, so it gates the Tauri-only Authentication settings.
export function useLiveGallery(
  arena?: ArenaApi,
  harnessAuth?: HarnessAuthApi,
): GalleryDataInput {
  const { client: backend, url: backendUrl } = useBackend();
  const { active: worker } = useWorkers();
  const { refreshToken } = useRunsRuntime();

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [localIds, setLocalIds] = useState<ReadonlySet<string>>(new Set());
  const [writeups, setWriteups] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, StoredReview[]>>({});
  const [runsLoading, setRunsLoading] = useState(false);
  const [testCases, setTestCases] = useState<TestCaseSummary[]>([]);
  // Starts "loading" so the catalog never momentarily reads as an empty "ready"
  // before the first fetch resolves; flips to "error" when the backend can't be
  // reached, distinct from a reachable-but-empty catalog.
  const [testCasesStatus, setTestCasesStatus] =
    useState<CatalogStatus>("loading");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [modelsStatus, setModelsStatus] = useState<CatalogStatus>("loading");

  const workerClient = worker?.client ?? null;
  const workerUrl = worker?.url ?? null;

  // Resolve a run's proof media URL: a produced (local) run is served by its
  // worker, any other (published) run by the backend. A worker reachable over HTTP
  // serves proofs under its base URL; a worker with no HTTP base (the built-in
  // Tauri worker) instead supplies its own resolver — `proofMediaUrl` — returning a
  // custom-scheme URL the desktop shell serves. When neither is available the proof
  // is not URL-loadable here and resolves to null (the UI then shows presence
  // without media).
  const proofMediaUrl = useCallback(
    (runId: string, file: string): string | null => {
      const path = `/runs/${encodeURIComponent(runId)}/proof/${encodeURIComponent(file)}`;
      if (localIds.has(runId)) {
        if (workerClient?.proofMediaUrl) {
          return workerClient.proofMediaUrl(runId, file);
        }
        return workerUrl ? joinPath(workerUrl, path) : null;
      }
      return backendUrl ? joinPath(backendUrl, path) : null;
    },
    [backendUrl, workerUrl, workerClient, localIds],
  );

  // Asset-generation run media (regenerated/preview/target/actions) resolves the
  // same way proof media does: the desktop transport supplies a custom-scheme
  // resolver, the web worker/backend an HTTP endpoint.
  const assetMediaUrl = useCallback(
    (runId: string, file: string): string | null => {
      const path = `/runs/${encodeURIComponent(runId)}/asset/${encodeURIComponent(file)}`;
      if (localIds.has(runId)) {
        if (workerClient?.assetMediaUrl) {
          return workerClient.assetMediaUrl(runId, file);
        }
        return workerUrl ? joinPath(workerUrl, path) : null;
      }
      return backendUrl ? joinPath(backendUrl, path) : null;
    },
    [backendUrl, workerUrl, workerClient, localIds],
  );

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
      setReviews({ ...published.reviews, ...produced.reviews });
      setRunsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [backend, workerClient, refreshToken]);

  useEffect(() => {
    // No backend configured is the same broken state as an unreachable one: the
    // catalog can't be resolved, so it reads as an error rather than empty.
    if (!backend) {
      setTestCases([]);
      setTestCasesStatus("error");
      return;
    }
    let active = true;
    setTestCasesStatus("loading");
    fetchTestCases(backend)
      .then((cs) => {
        if (!active) return;
        setTestCases(cs);
        setTestCasesStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setTestCases([]);
        setTestCasesStatus("error");
      });
    return () => {
      active = false;
    };
  }, [backend]);

  // The model catalog, from the backend `GET /models`. Re-fetched when the runs
  // runtime bumps its refresh token, so a model created/edited/deleted in the
  // config UI (which requests a refresh) reappears without a reload.
  useEffect(() => {
    if (!backend) {
      setModels([]);
      setModelsStatus("error");
      return;
    }
    let active = true;
    setModelsStatus("loading");
    backend
      .listModels()
      .then((ms) => {
        if (!active) return;
        setModels(ms.map(toModelSummary));
        setModelsStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
        setModelsStatus("error");
      });
    return () => {
      active = false;
    };
  }, [backend, refreshToken]);

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

  // Resolve a single run's record by id for a run the loaded list doesn't carry
  // (an infrastructure failure, in no worklist; or a run off the current page).
  // A produced (local) run is read from its worker, any other from the backend;
  // both expose the run store's `GET /runs/{id}`, which serves a stored run
  // whatever its state. A transport that can't reach it resolves to null so the
  // detail page falls back cleanly to its "no run found" state.
  const readRun = useCallback(
    async (runId: string): Promise<RunRecord | null> => {
      try {
        if (localIds.has(runId) && workerClient) {
          return (await workerClient.readRun(runId)).record;
        }
        if (backend) return (await backend.readRun(runId)).record;
        if (workerClient) return (await workerClient.readRun(runId)).record;
        return null;
      } catch (e) {
        if (e instanceof NotSupportedError) return null;
        return null;
      }
    },
    [backend, workerClient, localIds],
  );

  return {
    runs,
    localIds,
    writeups,
    reviews,
    runsLoading,
    testCases,
    testCasesStatus,
    models,
    modelsStatus,
    canExecute: true,
    fetchRunEvents,
    readRun,
    proofMediaUrl,
    assetMediaUrl,
    arena,
    harnessAuth,
  };
}

/** Join a base URL and an absolute path, collapsing the boundary slash. */
function joinPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}
