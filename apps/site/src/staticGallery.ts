import type { RunRecord, RunSubject } from "@clockwyrks/run-record";
import type { CodeAnalysisDocument } from "@clockwyrks/run-record/code-analysis";
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
import type { HarnessEvent, ProgressCallback } from "@clockwyrks/ui/client";
import { readOutcome, readTextWithProgress } from "@clockwyrks/ui/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  runSummaries as publishedRunSummaries,
  testCases as catalogTestCases,
  models as catalogModels,
  comparisons as publishedComparisons,
  testCaseGroups as publishedTestCaseGroups,
  ggRuns as publishedGgRuns,
  catalogShowcaseMediaUrls as publishedCatalogShowcaseMediaUrls,
} from "virtual:tcab-snapshot";

import { createStaticFiles } from "./static-files";

// The static site's gallery data source. It is the build-time public R2 snapshot
// — fully static, never querying the backend at runtime — merged in dev with
// produced-but-unpublished runs served from disk by the localRuns plugin. It
// produces the one `GalleryDataInput` the shared app consumes.
//
// The snapshot reaches this module in two forms (see vite-plugin-snapshot). The
// INDEX — what a listing shows for every run and every case — is inlined into
// the bundle as `virtual:tcab-snapshot`, so the catalog is always resolved
// (`testCasesStatus: "ready"`) and an empty snapshot simply renders the empty
// states. Everything that describes one run or one case in detail is a static
// file beside the bundle, read through `staticFiles` when a page of that run or
// case opens. The site cannot run tests, so `canExecute` is false and
// `inProgress` is empty.

const LOCAL_RUNS_URL = "/__local-runs__/index.json";

// The build's static files, read from the site's own origin. One reader for the
// page, so every surface shares what it has loaded.
const staticFiles = createStaticFiles(import.meta.env.BASE_URL);

// The catalog's listing cards by slug. A card lists a version exactly when the
// build wrote that version's file, so this is also what says which case files
// exist to ask for.
const catalogBySlug = new Map(
  catalogTestCases.map((entry) => [entry.slug, entry]),
);

/** Whether the build wrote a file for this version of this case. */
function isPublishedVersion(slug: string, version: string): boolean {
  return catalogBySlug.get(slug)?.versions.includes(version) ?? false;
}

/**
 * Where one file of a recording's shared image store is, under `prefix`.
 *
 * The store is the one media the snapshot does NOT list file by file. A run's — or
 * a case version's — store holds a distinct file per unique image its recordings
 * drew, some fifteen hundred for the busiest case in the corpus, and one replay on
 * one page is all that ever asks for them. Instead each namespace carries a single
 * URL prefix and the name the recording itself carries completes it, which works
 * because a store file's name is a hash of its bytes and is published verbatim.
 *
 * The `img.` prefix MIRRORS `IMAGE_STORE_PREFIX` in
 * `engines/packages/case-harness/src/replay/store.ts` and `VALIDATION_IMAGE_PREFIX` in
 * `contracts/crates/contracts/src/layout.rs`; a declared output never carries it, so asking here
 * first costs a declared name nothing.
 */
function storeUrl(
  prefix: string | null | undefined,
  file: string,
): string | null {
  return prefix == null || !file.startsWith("img.") ? null : `${prefix}${file}`;
}

// The gallery-wide reviews map of a host that holds none outside a run's own
// file. One object, so the lookups memoized on it are built once.
const NO_REVIEWS: Readonly<Record<string, never>> = {};

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

  // Everything derived from the loaded local runs is memoized on them, so a
  // render for any other reason — a case version's file arriving — hands the
  // gallery the same tables and does not restart the surfaces keyed on them.
  const local = useMemo(() => localRuns ?? [], [localRuns]);
  const localIds = useMemo(() => new Set(local.map((run) => run.id)), [local]);
  // A small in-memory map of the DEV local runs' full records, keyed by id — the
  // only full records held in memory. The lazy `fetchRun` resolves a dev local
  // run from here; any other id fetches the run's own file.
  const localById = useMemo(
    () => new Map(local.map((run) => [run.id, run])),
    [local],
  );

  // The produced (dev-only local) runs as their own summary cards — mirroring the
  // console's `producedSummaries`, and folded into the `any` slice by
  // `queryRunSummaries` below so a listing sorts and pages them with the published
  // rows. Dev-only local runs have no published summary, so derive theirs from the
  // full record (they are unreviewed previews, so no reviews / null rating is
  // correct). The published summary index stays internal to this module (queried by
  // `queryRunSummaries` below); it is never exposed whole.
  // A dev-only local run is a legacy-shaped preview: the site has no store to say
  // whether it is validator-rated, so it carries neither channel decided.
  const producedSummaries = useMemo(
    () =>
      local.map((run) =>
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
      ),
    [local],
  );

  // The public gallery lists only models that a run has actually used. The
  // catalog already surfaces any model with a recorded run automatically, so the
  // rows this drops are curated-but-never-run entries (added in the console but
  // not yet exercised) — real on a management console, but noise on the public
  // site. Resolve every run the site knows about (the published snapshot, plus
  // any dev-only local runs) to its catalog model with the same harness-aware
  // matcher the rest of the app uses, and keep only the models something
  // references.
  const models = useMemo(() => {
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
    return allModels.filter((model) => referencedModelSlugs.has(model.slug));
  }, [producedSummaries]);

  // The catalog is the index's listing cards. A case's detail is two files of
  // the build: the one that spans its versions, and the latest version's own,
  // which holds the variants a case page opens on. Both are read together when a
  // visitor opens the case. A slug the catalog does not list has no files to ask
  // for, and resolves null.
  const testCases = catalogTestCases;
  const readTestCase = useCallback(async (slug: string) => {
    const summary = catalogBySlug.get(slug);
    if (!summary) return null;
    const [detail, latest] = await Promise.all([
      staticFiles.loadCaseDetail(slug),
      staticFiles.loadCaseVersion(slug, summary.latestVersion),
    ]);
    return detail === null || latest === null
      ? null
      : { ...summary, ...detail, variants: latest.variants };
  }, []);

  // The inputs one run was given: the variant of the run's OWN case version,
  // rendered for the run's OWN engine. The build writes a file per published
  // version, so an older version resolves out of its own file rather than the
  // latest version's; and a version's file carries each variant's prompt and
  // specs re-rendered per engine, so a run on an engine reads that engine's
  // rendering. The engineless slug is the top-level pair, which is what a run
  // selecting no engine received. A version, variant, or engine this snapshot
  // does not carry resolves null, which the Inputs tab reports as unavailable.
  const readCaseVariant = useCallback(
    async (ref: CaseVariantRef): Promise<VariantSummary | null> => {
      if (!isPublishedVersion(ref.slug, ref.version)) return null;
      const file = await staticFiles.loadCaseVersion(ref.slug, ref.version);
      const variant = file?.variants.find(
        (entry) => entry.slug === ref.variant,
      );
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

  // The only writeups and reviews this host holds outside a run's own file are
  // the dev-only local previews. A published run's cards, badges and leaderboard
  // rows read its rating, aesthetic and score off its summary card, and its page
  // reads its reviews from the run's file through `readRun`, exactly as the
  // console's do.
  const writeups = localWriteups;
  const reviews = NO_REVIEWS;

  // The Events tab's data source on the static site: a published run's normalized
  // event stream, emitted at build time as a per-run static asset by
  // vite-plugin-snapshot (raw harness output is never published). A run without
  // events (or one published before they were captured) has no asset at all, and
  // that is an absence: an empty stream, which the tab renders as a run that
  // recorded none. Every other outcome — offline, a 500, a truncated body that
  // won't parse — is a read that FAILED and is thrown, so the tab reports the
  // failure instead of showing an empty feed for events that exist. Stable
  // identity so the Events tab doesn't refetch on every render.
  const fetchRunEvents = useCallback(
    async (runId: string, onProgress?: ProgressCallback) => {
      const response = await staticFiles.response(
        `run-events/${encodeURIComponent(runId)}.json`,
        `events for run ${runId}`,
      );
      if (response === null) return { events: [], raw: null };
      // The published event asset can be large, so stream it with transfer
      // progress for the Events tab's progress bar.
      const text = await readTextWithProgress(response, onProgress);
      const events = JSON.parse(text) as HarnessEvent[];
      return { events, raw: null };
    },
    [],
  );

  // The Code tab's explorer tier on the static site: a published run's unbounded
  // code-analysis document, emitted at build time as its own generation-keyed snapshot
  // object and fetched here on demand (the bounded summary rides on the record, so the
  // provenance strip and figure table never wait on this). The run's file says where
  // the document is; the tab holds the run, so the file is normally loaded already.
  //
  // A run whose file names no document resolves to `null`, which the tab renders as
  // "never analysed" — the honest reading, since the corpus is deliberately not
  // backfilled and therefore starts on the day the analyzer shipped. Stable identity
  // so the tab doesn't refetch on every render.
  const readCodeAnalysis = useCallback(async (runId: string) => {
    let media = staticFiles.runMedia(runId);
    if (media === undefined) {
      const file = await staticFiles.loadRun(runId);
      media = file?.media;
    }
    const url = media?.codeAnalysisUrl;
    if (!url) return null;
    const response = await fetch(url);
    // A listed object the store no longer holds is still an absence ("never
    // analysed"); a read that failed for any other reason is reported as one.
    return readOutcome(response, `code analysis for run ${runId}`) === "absent"
      ? null
      : ((await response.json()) as CodeAnalysisDocument);
  }, []);

  // Lazily resolve one run's detail — its full record plus every review. A
  // published run's record, reviews and media addresses are one file of the build
  // (`runs/<id>.json`, written by vite-plugin-snapshot), so a summary-first page
  // fetches a whole run on demand, and the media resolvers below answer for it
  // from the moment this resolves. A dev-only local run (which has no file) is
  // resolved from the in-memory `localById` map first. Wired as the host's
  // `readRun` hook; the gallery context's `fetchRun` delegates to it. Stable
  // identity so consumers don't refetch on every render.
  const fetchRun = useCallback(
    async (runId: string): Promise<RunDetail | null> => {
      const localRun = localById.get(runId);
      // A dev-only local run is by definition not published; everything the
      // static site serves as a file is. It is also a legacy-shaped, unreviewed
      // preview (no store to decide its channels).
      if (localRun)
        return {
          record: localRun,
          reviews: [],
          published: false,
          validatorRated: false,
          rating: null,
          aesthetic: null,
          // Lifted off the record the same way the rating channels are, so a
          // page reads `run.showcase` directly.
          showcase: localRun.showcase ?? null,
        };
      // Only an absent file means this gallery holds no such run, which is what
      // the run-detail layout prints as "No run found". An offline visitor, a
      // 500 from the CDN, or a body that won't parse is a read that FAILED and
      // throws, so the layout reports the failure instead — the same contract
      // the console's `readRun` follows, and the reason this host must not
      // collapse the two into one null.
      const file = await staticFiles.loadRun(runId);
      if (file === null) return null;
      // The published summary card carries the store's word on the two rating
      // channels and whether the run is validator-rated — the same fields the
      // console reads off `GET /runs/{id}`.
      const summary = publishedRunSummaries.find((s) => s.id === runId);
      return {
        record: file.record,
        reviews: file.reviews,
        published: true,
        validatorRated: summary?.validatorRated ?? false,
        rating: summary?.rating ?? null,
        aesthetic: summary?.aesthetic ?? null,
        showcase: file.record.showcase ?? null,
      };
    },
    [localById],
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
    [localIds, producedSummaries],
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

  // A published run's media, each resolved at build time to an absolute snapshot
  // URL and carried in the run's own file. These resolvers are synchronous and
  // answer from the files `readRun` has loaded: a surface that holds a run got it
  // through `readRun`, so the run's media is on hand by the time it asks.
  // Produced (local, dev-only) runs are not published, so they have no snapshot
  // media. Stable identities, so a surface keyed on one never refetches.

  // Proof media, keyed by served file name (`<proof-id>.<ext>`).
  const proofMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      staticFiles.runMedia(runId)?.proof[file] ?? null,
    [],
  );

  // Asset-generation media (regenerated/preview/target image + action log), keyed
  // by served file name (`regenerated.png`, etc.).
  const assetMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      staticFiles.runMedia(runId)?.asset[file] ?? null,
    [],
  );

  // The synthesized *actual* validation media (the model build's debug-script
  // outputs), keyed by the flat `<item>__<output>.<ext>` name the reviewer UI
  // requests (a video's `.webm` request resolving to its published `.mp4`). A
  // recording's shared image store resolves under the run's one prefix.
  const validationMediaUrl = useCallback((runId: string, file: string) => {
    const media = staticFiles.runMedia(runId);
    return (
      media?.validation[file] ?? storeUrl(media?.validationStorePrefix, file)
    );
  }, []);

  // Showcase media (the carousel files, plus any image the description
  // references), keyed by the recorded file name (a video's `.webm` request
  // resolving to its published `.mp4`).
  const showcaseMediaUrl = useCallback(
    (runId: string, file: string): string | null =>
      staticFiles.runMedia(runId)?.showcase[file] ?? null,
    [],
  );

  // A case version's media is carried in that version's own file, and the three
  // resolvers below answer from the versions loaded so far. A surface showing a
  // case holds a variant it got through `readTestCase` or `readCaseVariant`, so
  // its version is on hand; a run's page compares against a baseline of a case
  // version nothing on the page need have loaded. So a resolver asked about a
  // published version that is not loaded starts loading it and answers null, and
  // each takes a new identity when a version arrives — which re-renders the
  // surfaces reading it through the gallery, now with the answer.
  const caseVersionsLoaded = useSyncExternalStore(
    staticFiles.subscribe,
    staticFiles.revision,
  );
  const caseVersionMedia = useCallback(
    (slug: string, version: string) => {
      const file = staticFiles.caseVersion(slug, version);
      if (file === undefined && isPublishedVersion(slug, version)) {
        staticFiles.requestCaseVersion(slug, version);
      }
      return file?.media;
    },
    // The count of loaded versions is what this reads through `staticFiles`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseVersionsLoaded],
  );

  // A CASE variant's authored showcase media (the carousel captured from the
  // reference implementation) — the case-side counterpart of the run showcase
  // above, keyed by variant then the authored file name (a video's `.webm`
  // request resolving to its published `.mp4`). The media a catalog card
  // previews is in the index, so the catalog shows it without loading any case.
  // Null for a variant with no published showcase, and the surfaces then degrade
  // exactly like the run showcase.
  const caseShowcaseMediaUrl = useCallback(
    (
      slug: string,
      version: string,
      variant: string,
      file: string,
    ): string | null =>
      publishedCatalogShowcaseMediaUrls[`${slug}/${version}/${variant}`]?.[
        file
      ] ??
      caseVersionMedia(slug, version)?.showcase[variant]?.[file] ??
      null,
    [caseVersionMedia],
  );

  // A published reference build's *baseline* validation media (the reference
  // implementation's declared outputs), keyed by `<engine>/<variant>` then the
  // flat `<item>__<output>.<ext>` name — the same file name the actual media is
  // requested under, resolved through the case version instead of the run. The
  // engine is in the key because a variant has one reference implementation per
  // engine, and a run is only comparable against the one it was built on.
  const validationBaselineUrl = useCallback(
    (subject: RunSubject, file: string): string | null => {
      const media = caseVersionMedia(
        subject.testCaseSlug,
        subject.testCaseVersion,
      );
      const key = `${subject.engineSlug}/${subject.variant}`;
      return (
        media?.baselines[key]?.[file] ??
        storeUrl(media?.baselineStorePrefixes[key], file)
      );
    },
    [caseVersionMedia],
  );

  // An asset-generation case variant's published reference frames — the rendered
  // image and the action log each was drawn from. Resolved at build time by joining
  // the snapshot base with the deterministic keys `tcab publish-reference` wrote
  // (see vite-plugin-snapshot), and keyed by variant then the file below that
  // variant's prefix (`frames/<index>.png`). Null for a variant with no published
  // reference, which is every non-asset case.
  const referenceMediaUrl = useCallback(
    (
      slug: string,
      version: string,
      variant: string,
      file: string,
    ): string | null =>
      caseVersionMedia(slug, version)?.reference[variant]?.[file] ?? null,
    [caseVersionMedia],
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
    // The test-case groups, baked into the index at build time and already in
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
    comparisons: publishedComparisons,
    readComparison: (id: string) =>
      publishedComparisons.find((c) => c.id === id) ?? null,
    canExecute: false,
    // The exported gg document corpus, inlined with the index at build time. This is the whole of the
    // site's analysis surface: `useGgSource` evaluates every query against these
    // documents in the browser with the mirrored evaluator, so `/gg/query` makes no
    // request at all. A snapshot without the corpus (one published before the export
    // existed) leaves this undefined, and the section is simply not mounted.
    ggData: publishedGgRuns ?? undefined,
    // The public gallery has no backend to ask for a Grafana URL, and its readers
    // have no access to one — Grafana sits behind the edge's Access sign-in. Always
    // null, so the run view never offers a link nobody could follow.
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
