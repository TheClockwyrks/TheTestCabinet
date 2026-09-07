import { useCallback, useEffect, useState } from "react";
import type { RunRecord, RunSubject } from "@clockwyrks/run-record";
import type { CodeAnalysisDocument } from "@clockwyrks/run-record/code-analysis";
import type { Comparison } from "@clockwyrks/run-record/comparison";
import type { HarnessEvent, ProgressCallback } from "@clockwyrks/ui/client";
import { readTextWithProgress } from "@clockwyrks/ui/client";
import {
  DEFAULT_ENGINE_SLUG,
  findModelByModelId,
  foldCabinetStats,
  runSummaryPage,
  toModelSummary,
  toRunSummary,
  type CabinetStats,
  type CaseVariantRef,
  type GalleryDataInput,
  type RunDetail,
  type RunQuery,
  type VariantSummary,
} from "@clockwyrks/ui/app";
import {
  runSummaries as publishedRunSummaries,
  writeups as publishedWriteups,
  reviews as publishedReviews,
  testCases as catalogTestCases,
  models as catalogModels,
  comparisons as publishedComparisons,
  testCaseGroups as publishedTestCaseGroups,
  ggRuns as publishedGgRuns,
  codeAnalysisUrls as publishedCodeAnalysisUrls,
  proofMediaUrls as publishedProofMediaUrls,
  assetMediaUrls as publishedAssetMediaUrls,
  validationMediaUrls as publishedValidationMediaUrls,
  validationStorePrefixes as publishedValidationStorePrefixes,
  showcaseMediaUrls as publishedShowcaseMediaUrls,
  caseShowcaseMediaUrls as publishedCaseShowcaseMediaUrls,
  validationBaselineUrls as publishedValidationBaselineUrls,
  baselineStorePrefixes as publishedBaselineStorePrefixes,
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

/**
 * Where one file of a recording's shared image store is, under `prefix`.
 *
 * The store is the one media the snapshot does NOT list file by file. A run's — or
 * a case version's — store holds a distinct file per unique image its recordings
 * drew, and this module's lookup tables are inlined into the chunk every visitor
 * downloads before the home page renders, so listing them would put hundreds of
 * kilobytes of JavaScript in front of every visitor for URLs one replay on one page
 * will ever ask for. Instead each namespace carries a single URL prefix and the name
 * the recording itself carries completes it, which works because a store file's name
 * is a hash of its bytes and is published verbatim.
 *
 * The `img.` prefix MIRRORS `IMAGE_STORE_PREFIX` in
 * `packages/case-harness/src/replay/store.ts` and `VALIDATION_IMAGE_PREFIX` in
 * `crates/core/src/validator.rs`; a declared output never carries it, so asking here
 * first costs a declared name nothing.
 */
function storeUrl(prefix: string | undefined, file: string): string | null {
  if (prefix === undefined || !file.startsWith("img.")) return null;
  return `${prefix}${file}`;
}

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

  // The produced (dev-only local) runs as their own summary cards — mirroring the
  // console's `producedSummaries`, and folded into the `any` slice by
  // `queryRunSummaries` below so a listing sorts and pages them with the published
  // rows. Dev-only local runs have no published summary, so derive theirs from the
  // full record (they are unreviewed previews, so no reviews / null rating is
  // correct). The published summary index stays internal to this module (queried by
  // `queryRunSummaries` below); it is never exposed whole.
  // A dev-only local run is a legacy-shaped preview: the site has no store to say
  // whether it is validator-rated, so it carries neither channel decided.
  const producedSummaries = local.map((run) =>
    toRunSummary({
      id: run.id,
      record: run,
      reviews: [],
      published: false,
      rating: null,
      aesthetic: null,
      validatorRated: false,
      score: null,
    }),
  );

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

  // The snapshot inlines each case in full at build time, so this host holds both
  // halves of the catalog contract: the listing summaries and, behind
  // `readTestCase`, the detail a case page needs. There is nothing to fetch —
  // `readTestCase` just resolves out of the same in-memory array — but supplying
  // it is what keeps the detail pages working here, since they no longer read
  // variants and errata off the listing.
  const testCases = catalogTestCases;
  const readTestCase = useCallback(
    async (slug: string) =>
      catalogTestCases.find((entry) => entry.slug === slug) ?? null,
    [],
  );

  // The inputs one run was given: the variant of the run's OWN case version,
  // rendered for the run's OWN engine. The snapshot carries a document per
  // published version, so an older version resolves out of
  // `priorVariantsByVersion` rather than the latest version's variants; and it
  // carries each variant's
  // prompt and specs re-rendered per engine, so a run on an engine reads that
  // engine's rendering. The engineless slug is the top-level pair, which is what a
  // run selecting no engine received. A version, variant, or engine this snapshot
  // does not carry resolves null, which the Inputs tab reports as unavailable.
  const readCaseVariant = useCallback(
    async (ref: CaseVariantRef): Promise<VariantSummary | null> => {
      const testCase = catalogTestCases.find(
        (entry) => entry.slug === ref.slug,
      );
      if (!testCase) return null;
      const variants =
        ref.version === testCase.latestVersion
          ? testCase.variants
          : testCase.priorVariantsByVersion[ref.version];
      const variant = variants?.find((entry) => entry.slug === ref.variant);
      if (!variant) return null;
      if (ref.engine === DEFAULT_ENGINE_SLUG) return variant;
      const rendering = variant.engineRenderings[ref.engine];
      if (!rendering) return null;
      return {
        ...variant,
        prompt: rendering.prompt,
        seededInputs: rendering.seededInputs,
        // The starter workspace is engine-keyed exactly as the prompt and specs
        // are (a starter project is written against a runtime), so the
        // rendering's set replaces the variant's engineless one too.
        workspace: rendering.workspace,
      };
    },
    [],
  );

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

  // The Code tab's explorer tier on the static site: a published run's unbounded
  // code-analysis document, emitted at build time as its own generation-keyed snapshot
  // object and fetched here on demand (the bounded summary rides on the record, so the
  // provenance strip and figure table never wait on this).
  //
  // A run absent from the URL map resolves to `null`, which the tab renders as "never
  // analysed" — the honest reading, since the corpus is deliberately not backfilled and
  // therefore starts on the day the analyzer shipped. Stable identity so the tab doesn't
  // refetch on every render.
  const readCodeAnalysis = useCallback(async (runId: string) => {
    const url = publishedCodeAnalysisUrls[runId];
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `code analysis fetch failed: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as CodeAnalysisDocument;
  }, []);

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
      // static site serves as an emitted asset is. It is also a legacy-shaped
      // preview (no store to decide its channels).
      if (localRun)
        return {
          record: localRun,
          reviews: runReviews,
          published: false,
          validatorRated: false,
          rating: null,
          aesthetic: null,
          // Lifted off the record the same way the rating channels are, so a
          // page reads `run.showcase` directly.
          showcase: localRun.showcase ?? null,
        };
      const url = `${import.meta.env.BASE_URL}runs/${encodeURIComponent(
        runId,
      )}.json`;
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const record = (await response.json()) as RunRecord;
        // The published summary card carries the store's word on the two rating
        // channels and whether the run is validator-rated — the same fields the
        // console reads off `GET /runs/{id}`.
        const summary = publishedRunSummaries.find((s) => s.id === runId);
        return {
          record,
          reviews: runReviews,
          published: true,
          validatorRated: summary?.validatorRated ?? false,
          rating: summary?.rating ?? null,
          aesthetic: summary?.aesthetic ?? null,
          showcase: record.showcase ?? null,
        };
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
  // index (minus any dev local overrides, which the local card supersedes), plus —
  // for the `any` slice the listings ask for — the dev-only produced runs, so an
  // unpublished preview sorts and pages among the published rows exactly as it does
  // against the backend's `any` slice. `runSummaryPage` filters/sorts/windows the
  // set with the same semantics the backend uses, so a numbered page behaves
  // identically on both hosts. Stable identity keyed on the loaded local runs (the
  // only varying input).
  const queryRunSummaries = useCallback(
    async (query: RunQuery) => {
      const published = publishedRunSummaries.filter(
        (summary) => !localIds.has(summary.id),
      );
      return runSummaryPage(
        query.state === "any"
          ? [...producedSummaries, ...published]
          : published,
        query,
      );
    },
    // `localIds` is rebuilt each render from the loaded local runs; key on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localRuns],
  );

  // The cabinet's headline figures, folded locally from the inlined published
  // summary index with the mirror of the backend's `fold_cabinet_stats` — the
  // static analog of the console's `GET /stats/cabinet`. The site's corpus is
  // the published snapshot alone (the backend's additionally counts unpublished
  // runs), so the figures are the published cabinet's. Pure and in-memory, so it
  // never rejects; async only to satisfy the host contract. Stable identity so
  // the home page doesn't refetch on every render.
  const getCabinetStats = useCallback(
    async (): Promise<CabinetStats | null> =>
      foldCabinetStats(publishedRunSummaries, new Date()),
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
      publishedValidationMediaUrls[runId]?.[file] ??
      storeUrl(publishedValidationStorePrefixes[runId], file),
    [],
  );

  // A published run's showcase media (the carousel files, plus any image the
  // description references), resolved at build time to absolute snapshot URLs keyed
  // by run id then the recorded file name (a video's `.webm` request resolving to
  // its published `.mp4`). Produced (local, dev-only) runs are not published, so
  // they have no snapshot media.
  const showcaseMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      publishedShowcaseMediaUrls[runId]?.[file] ?? null,
    [],
  );

  // A CASE variant's authored showcase media (the carousel captured from the
  // reference implementation) — the case-side counterpart of the run showcase
  // above, resolved at build time and keyed case-scoped by a
  // `<slug>/<version>/<variant>` subject key then the authored file name (a
  // video's `.webm` request resolving to its published `.mp4`). Null for a
  // variant with no published showcase, and the surfaces then degrade exactly
  // like the run showcase.
  const caseShowcaseMediaUrl = useCallback(
    (
      slug: string,
      version: string,
      variant: string,
      file: string,
    ): string | null =>
      publishedCaseShowcaseMediaUrls[`${slug}/${version}/${variant}`]?.[file] ??
      null,
    [],
  );

  // A published reference build's *baseline* validation media (the reference
  // implementation's declared outputs), resolved at build time and keyed case-scoped
  // by a `<slug>/<version>/<engine>/<variant>` subject key then the flat
  // `<item>__<output>.<ext>` name — the same file name the actual media is requested
  // under, resolved through the case-scoped map instead of the run-scoped one. The
  // engine is in the key because a variant has one reference implementation per
  // engine, and a run is only comparable against the one it was built on.
  const validationBaselineUrl = useCallback(
    (subject: RunSubject, file: string): string | null => {
      const subjectKey = `${subject.testCaseSlug}/${subject.testCaseVersion}/${subject.engineSlug}/${subject.variant}`;
      return (
        publishedValidationBaselineUrls[subjectKey]?.[file] ??
        storeUrl(publishedBaselineStorePrefixes[subjectKey], file)
      );
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
    getCabinetStats,
    testCases,
    testCasesStatus: "ready",
    // The test-case groups, baked into the snapshot at build time and already in
    // display order. Empty when the snapshot predates them, and the home page
    // then renders no group leaderboards.
    testCaseGroups: publishedTestCaseGroups,
    readCaseVariant,
    readTestCase,
    // The model catalog is baked into the snapshot at build time, so it is always
    // resolved; the site has no backend to mutate it, so the config affordances
    // hide (no `createModel` on any client here). Narrowed above to the models a
    // run has actually used, so run-less curated entries don't show here.
    models,
    modelsStatus: "ready",
    // The published harness comparisons, baked into the snapshot at build time and
    // rendered read-only (no backend to create/run/publish — those affordances gate
    // on `canExecute`, which is false here). A single comparison is resolved by id
    // for the detail view.
    comparisons: publishedComparisons as Comparison[],
    readComparison: (id: string) =>
      (publishedComparisons as Comparison[]).find((c) => c.id === id) ?? null,
    canExecute: false,
    // The exported gg document corpus, inlined at build time. This is the whole of the
    // site's analysis surface: `useGgSource` evaluates every query against these
    // documents in the browser with the mirrored evaluator, so `/gg/query` makes no
    // request at all. A snapshot without the corpus (one published before the export
    // existed) leaves this undefined, and the section is simply not mounted.
    ggData: publishedGgRuns ?? undefined,
    // The public gallery has no backend to ask for a Grafana URL, and its readers
    // have no access to one — the observability stack is VPN-only. Always null, so
    // the run view never offers a link nobody could follow.
    grafanaUrl: null,
    fetchRunEvents,
    readCodeAnalysis,
    // The host's lazy single-run fetcher; the gallery context's `fetchRun`
    // delegates to it (falling back to the in-memory `runs` internally).
    readRun: fetchRun,
    proofMediaUrl,
    assetMediaUrl,
    validationMediaUrl,
    showcaseMediaUrl,
    caseShowcaseMediaUrl,
    validationBaselineUrl,
    referenceMediaUrl,
  };
}
