import { useCallback, useEffect, useState } from "react";
import type { RunRecord, RunSubject } from "@test-cabinet/run-record";
import type { HarnessEvent, ProgressCallback } from "@test-cabinet/ui/client";
import { readTextWithProgress } from "@test-cabinet/ui/client";
import {
  findModelByModelId,
  runSummaryPage,
  toModelSummary,
  toRunSummary,
  type GalleryDataInput,
  type RunDetail,
  type RunQuery,
} from "@test-cabinet/ui/app";
import {
  runSummaries as publishedRunSummaries,
  writeups as publishedWriteups,
  reviews as publishedReviews,
  testCases as catalogTestCases,
  models as catalogModels,
  proofMediaUrls as publishedProofMediaUrls,
  assetMediaUrls as publishedAssetMediaUrls,
  validationMediaUrls as publishedValidationMediaUrls,
  validationBaselineUrls as publishedValidationBaselineUrls,
  referenceMediaUrls as publishedReferenceMediaUrls,
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
  // A small in-memory map of the DEV local runs' full records, keyed by id — the
  // only full records held in memory (the published set is no longer inlined). The
  // lazy `fetchRun` resolves a dev local run from here; any other id fetches the
  // emitted `runs/<id>.json` asset.
  const localById = new Map(local.map((run) => [run.id, run]));

  // The produced (dev-only local) runs as their own summary cards, pinned ahead of
  // the queried published window by a paged page — mirroring the console's
  // `producedSummaries`. Dev-only local runs have no published summary, so derive
  // theirs from the full record (they are unreviewed previews, so no reviews / null
  // rating is correct). The published summary index stays internal to this module
  // (queried by `queryRunSummaries` below); it is never exposed whole.
  const producedSummaries = local.map((run) => toRunSummary(run, []));

  // The public gallery lists only models that a run has actually used. The
  // catalog already surfaces any model with a recorded run automatically, so the
  // rows this drops are curated-but-never-run entries (added in the console but
  // not yet exercised) — real on a management console, but noise on the public
  // site. Resolve every run the site knows about (the published snapshot, plus
  // any dev-only local runs) to its catalog model with the same harness-aware
  // matcher the rest of the app uses, and keep only the models something
  // references.
  const allModels = catalogModels.map(toModelSummary);
  const referencedModelSlugs = new Set<string>();
  for (const summary of [...publishedRunSummaries, ...producedSummaries]) {
    const model = findModelByModelId(
      allModels,
      summary.subject.modelId,
      summary.subject.harnessSlug,
    );
    if (model) referencedModelSlugs.add(model.slug);
  }
  const models = allModels.filter((model) =>
    referencedModelSlugs.has(model.slug),
  );

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

  // Lazily resolve one run's detail — its full record plus every review. The
  // bundle no longer inlines full records: a published run's record is emitted at
  // build time as a per-run static asset (`runs/<id>.json`) by
  // vite-plugin-snapshot, so a summary-first page fetches a whole record on demand.
  // A dev-only local run (not emitted as an asset) is resolved from the in-memory
  // `localById` map first; any other id fetches the emitted asset. The reviews come
  // from the inlined published-reviews map (small, kept in the bundle), so the
  // run-detail layer frames the verdict from these rather than the global writeups
  // map. Wired as the host's `readRun` hook; the gallery context's `fetchRun`
  // delegates to it. Stable identity so consumers don't refetch on every render.
  const fetchRun = useCallback(
    async (runId: string): Promise<RunDetail | null> => {
      const runReviews = publishedReviews[runId] ?? [];
      const localRun = localById.get(runId);
      // A dev-only local run is by definition not published; everything the
      // static site serves as an emitted asset is.
      if (localRun)
        return { record: localRun, reviews: runReviews, published: false };
      const url = `${import.meta.env.BASE_URL}runs/${encodeURIComponent(
        runId,
      )}.json`;
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const record = (await response.json()) as RunRecord;
        return { record, reviews: runReviews, published: true };
      } catch {
        return null;
      }
    },
    // `localById` is rebuilt each render, but its only varying input is the loaded
    // local runs (the published set is no longer inlined); key on that.
    [localRuns],
  );

  // Answer a paged summary query purely in memory — the static analog of the
  // console's backend offset endpoint. The queryable set is the published summary
  // index (minus any dev local overrides, which a page pins via
  // `producedSummaries`); `runSummaryPage` filters/sorts/windows it with the same
  // semantics the backend uses, so a numbered page behaves identically on both
  // hosts. Stable identity keyed on the loaded local runs (the only varying input).
  const queryRunSummaries = useCallback(
    async (query: RunQuery) =>
      runSummaryPage(
        publishedRunSummaries.filter((summary) => !localIds.has(summary.id)),
        query,
      ),
    // `localIds` is rebuilt each render from the loaded local runs; key on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // A published run's synthesized *actual* validation media (the model build's
  // debug-script outputs), resolved at build time to absolute snapshot URLs keyed by
  // run id then the flat `<item>__<output>.<ext>` name the reviewer UI requests (a
  // video's `.webm` request resolving to its published `.mp4`). Produced (local,
  // dev-only) runs are not published, so they have no snapshot media.
  const validationMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      publishedValidationMediaUrls[runId]?.[file] ?? null,
    [],
  );

  // A published case variant's *baseline* validation media (the reference
  // implementation's debug-script outputs), resolved at build time and keyed
  // case-scoped by a `<slug>/<version>/<variant>` subject key then the flat
  // `<item>__<output>.<ext>` name — the same file name the actual media is requested
  // under, resolved through the case-scoped map instead of the run-scoped one.
  const validationBaselineUrl = useCallback(
    (subject: RunSubject, file: string): string | null => {
      const subjectKey = `${subject.testCaseSlug}/${subject.testCaseVersion}/${subject.variant}`;
      return publishedValidationBaselineUrls[subjectKey]?.[file] ?? null;
    },
    [],
  );

  // An asset-generation case variant's published reference frames — the rendered
  // image and the action log each was drawn from. Resolved at build time by joining
  // the snapshot base with the deterministic keys `tcab publish-reference` wrote
  // (see vite-plugin-snapshot), and keyed case-scoped by a `<slug>/<version>/<variant>`
  // subject key then the file below that variant's prefix (`frames/<index>.png`).
  // Null for a variant with no published reference, which is every non-asset case.
  const referenceMediaUrl = useCallback(
    (
      slug: string,
      version: string,
      variant: string,
      file: string,
    ): string | null =>
      publishedReferenceMediaUrls[`${slug}/${version}/${variant}`]?.[file] ??
      null,
    [],
  );

  return {
    producedSummaries,
    localIds,
    writeups,
    reviews,
    runsLoading: loading,
    queryRunSummaries,
    testCases,
    testCasesStatus: "ready",
    // The model catalog is baked into the snapshot at build time, so it is always
    // resolved; the site has no backend to mutate it, so the config affordances
    // hide (no `createModel` on any client here). Narrowed above to the models a
    // run has actually used, so run-less curated entries don't show here.
    models,
    modelsStatus: "ready",
    canExecute: false,
    // The public gallery has no backend to ask for a Grafana URL, and its readers
    // have no access to one — the observability stack is VPN-only. Always null, so
    // the run view never offers a link nobody could follow.
    grafanaUrl: null,
    fetchRunEvents,
    // The host's lazy single-run fetcher; the gallery context's `fetchRun`
    // delegates to it (falling back to the in-memory `runs` internally).
    readRun: fetchRun,
    proofMediaUrl,
    assetMediaUrl,
    validationMediaUrl,
    validationBaselineUrl,
    referenceMediaUrl,
  };
}
