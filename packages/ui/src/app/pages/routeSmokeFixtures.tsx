import type { ReactNode } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type { BackendClient, WorkerClient } from "../../client/clients";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../client/context";
import { AuthProvider } from "../../client/auth";
import type { StoredReview } from "../../client/types";
import {
  GalleryDataProvider,
  type GalleryDataInput,
  type RunDetail,
} from "../data/galleryContext";
import { runSummaryPage } from "../data/runQuery";
import type { ModelSummary } from "../data/models";
import type {
  TestCaseDetail,
  TestCaseGroupSummary,
  TestCaseSummary,
} from "../data/testCases";
import { RunsRuntimeProvider } from "../runtime/runsRuntime";

// The data and providers the route smoke test stands the whole app up against.
// They live beside the test rather than inside it because they describe a *host*,
// not a case: each function here is one shape of console the app has to render on
// (a stocked one, an empty one, the read-only site), and the test is just the loop
// that walks every route through them.
//
// Everything is deliberately the thinnest thing that satisfies the contract. The
// point of the suite is that every page MOUNTS, so a fixture that grew a faithful
// copy of a real run record would only make it fragile without making it stricter.

/** The ids the route patterns' `:params` are filled with; the fixtures below
 * resolve each of them, so a detail page finds the thing it is about. */
export const FIXTURE_IDS = {
  slug: "carom",
  jamSlug: "well-well-well",
  runId: "run-1",
  modelId: "claude-opus-5",
  reviewerId: "reviewer-1",
  planId: "plan-1",
  ladderId: "ladder-1",
  groupId: "group-1",
  configId: "config-1",
  agentId: "agent-1",
  dashboardId: "dashboard-1",
  jobId: "job-1",
  comparisonId: "comparison-1",
  tournamentId: "tournament-1",
} as const;

// ---- Catalog -----------------------------------------------------------------

// The one case-side showcase carousel the stocked catalog carries (on the carom
// case): one image and one replay entry, so both media shapes render on the walk.
// The other cases deliberately omit the key — a host that predates the field is a
// shape the pages must survive too.
const CASE_SHOWCASE_MEDIA = [
  { file: "title.png", name: "Title screen", kind: "image" },
  {
    file: "rally.json.gz",
    name: "A rally through the obstacles",
    kind: "replay",
  },
] as const;

// One case per test type the catalog partitions on, so the type tabs, the
// type-specific detail tabs (the adversarial Arena), and the Other section's game
// jams all have something to render.
function testCases(): TestCaseSummary[] {
  const base = {
    difficulty: "medium",
    tags: ["fixture"],
    summary: "A case the smoke test renders.",
    versions: ["v2.0.0", "v1.0.0"],
    latestVersion: "v2.0.0",
  };
  return [
    {
      ...base,
      slug: FIXTURE_IDS.slug,
      name: "Carom",
      testType: "end-to-end",
      assetKind: null,
      // The catalog showcase preview (latest version, first variant with one),
      // so the catalog's preview stage renders real media through the stocked
      // host's `caseShowcaseMediaUrl`.
      showcase: {
        version: "v2.0.0",
        variant: "base",
        media: [...CASE_SHOWCASE_MEDIA],
      },
    },
    {
      ...base,
      slug: "spectra",
      name: "Spectra",
      testType: "full-stack",
      assetKind: null,
    },
    {
      ...base,
      slug: "spectra-burst",
      name: "Spectra Burst",
      testType: "asset-generation",
      assetKind: "particle",
    },
    {
      ...base,
      slug: "foray",
      name: "Foray",
      testType: "adversarial",
      assetKind: null,
    },
    {
      ...base,
      slug: "lattice",
      name: "Lattice",
      testType: "performance",
      assetKind: null,
    },
    {
      ...base,
      slug: FIXTURE_IDS.jamSlug,
      name: "Well, Well, Well",
      testType: "game-jam",
      assetKind: null,
      difficulty: "unclassified",
    },
  ] as unknown as TestCaseSummary[];
}

function testCaseDetail(slug: string): TestCaseDetail {
  const summary = testCases().find((entry) => entry.slug === slug);
  if (!summary) return null as unknown as TestCaseDetail;
  return {
    ...summary,
    description: "A case the smoke test renders.",
    changelog: [{ version: "v2.0.0", body: "Initial." }],
    errata: [],
    // Two versions and two engines, so the header's version and engine
    // selectors are actually rendered on the walk rather than hidden as a
    // single-choice case.
    enginesByVersion: {
      "v2.0.0": ["none", "simple-2d"],
      "v1.0.0": ["none"],
    },
    variantsByVersion: {
      "v2.0.0": [{ slug: "base", name: "Base" }],
      "v1.0.0": [{ slug: "base", name: "Base" }],
    },
    domains: [{ id: "approach", name: "Approach", description: null }],
    variants: [
      {
        slug: "base",
        name: "Base",
        description: null,
        prompt: "Build the thing.",
        seededInputs: [],
        packages: [],
        referenceScreenshots: [],
        reviewItems: [],
        domains: [],
        validatorRated: false,
        referenceBuilds: {},
        // The variant-level half of the case showcase: the description the Play
        // tab renders beside the same two-entry carousel the catalog previews.
        showcase: {
          description: "Captured from the reference implementation.",
          media: [...CASE_SHOWCASE_MEDIA],
        },
        // Starter-workspace refs for the Inputs file tree: one file the host can
        // serve and one it cannot (`url: null`), so both states render.
        workspace: [
          {
            path: "src/main.ts",
            url: "https://cdn.example/files/cases/carom/v2.0.0/workspace/digest-main.ts",
          },
          { path: "index.html", url: null },
        ],
      },
    ],
  } as unknown as TestCaseDetail;
}

// One test-case group over the stocked cases, so the home page renders a
// populated group leaderboard on the walk.
function testCaseGroups(): TestCaseGroupSummary[] {
  return [
    {
      slug: "fixture-group",
      name: "Fixture Group",
      summary: "The cases the smoke test stocks.",
      cases: [FIXTURE_IDS.slug, "spectra"],
    },
  ];
}

// The home page's totals band + activity chart, in the wire shape. Small and
// literal: the page formats and charts it, nothing recomputes it.
function cabinetStats() {
  return {
    runs: 2,
    tokens: { total: 200, unreportedRuns: 1 },
    cost: { total: 2, unreportedRuns: 0 },
    testCases: 1,
    models: 1,
    weekly: [
      { weekStart: "2026-07-27", runs: 1 },
      { weekStart: "2026-08-03", runs: 1 },
    ],
  };
}

function models(): ModelSummary[] {
  return [
    {
      slug: FIXTURE_IDS.modelId,
      name: "Claude Opus 5",
      provider: "anthropic",
      isConfigured: true,
      openrouterUrl: null,
      description: null,
      logoSvg: null,
      modelIds: [FIXTURE_IDS.modelId],
      aliases: [{ slug: FIXTURE_IDS.modelId, harnessFamily: "openrouter" }],
      prices: null,
      priceHistory: [],
      contextLength: null,
      releasedAt: null,
      inputModalities: ["text"],
    },
  ] as unknown as ModelSummary[];
}

// ---- Runs --------------------------------------------------------------------

function runSummary(id: string, slug: string): RunSummary {
  return {
    id,
    publishedAt: "2026-08-02T00:00:00Z",
    startedAt: "2026-08-01T00:00:00Z",
    finishedAt: "2026-08-01T01:00:00Z",
    subject: {
      testCaseSlug: slug,
      testCaseVersion: "v2.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1.0.0",
      modelId: FIXTURE_IDS.modelId,
    },
    metrics: {
      runTimeSeconds: 60,
      tokens: {
        uncachedInput: 100,
        cachedInput: null,
        output: null,
        reasoning: null,
      },
      cost: { comparable: 1, actual: 1 },
    },
    state: "completed",
    rating: "great",
    aesthetic: null,
    score: { earned: 8, total: 10, reviews: 1 },
    validatorRated: false,
    caseName: "Carom",
  } as unknown as RunSummary;
}

// A newer, legendary-rated run: what the home page's showcase queries for. Its
// detail (below) is the one fixture that carries a `showcase`, so the walk
// stages real media through the fixture's `showcaseMediaUrl` map; every other
// detail keeps omitting the key, which is a shape the page must survive too.
function legendarySummary(id: string): RunSummary {
  return {
    ...runSummary(id, FIXTURE_IDS.slug),
    startedAt: "2026-08-03T00:00:00Z",
    finishedAt: "2026-08-03T01:00:00Z",
    aesthetic: "legendary",
  } as unknown as RunSummary;
}

function review(): StoredReview {
  return {
    reviewerId: FIXTURE_IDS.reviewerId,
    reviewer: "A Reviewer",
    username: "reviewer",
    ratings: [{ domain: "approach", rating: "great" }],
    aesthetics: [],
    checklist: [],
    writeup: "Solid.",
    reviewedAt: "2026-08-02T00:00:00Z",
  } as unknown as StoredReview;
}

function runDetail(id: string): RunDetail {
  const summary = runSummary(id, FIXTURE_IDS.slug);
  return {
    record: {
      id,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      subject: summary.subject,
      tooling: { testCabinetCommit: "abc1234" },
      environment: {
        os: "Debian GNU/Linux 12 (bookworm)",
        containerImage: "test-cabinet-base:local",
        nodeVersion: "v22.11.0",
        authMode: "api-key",
      },
      metrics: summary.metrics,
      validation: {
        loaded: true,
        detail: null,
        install: null,
        build: null,
        checks: [],
        proofs: [],
      },
      links: {},
      status: { state: "completed", detail: null },
    },
    reviews: [review()],
    published: true,
    validatorRated: false,
    rating: "great",
    aesthetic: null,
  } as unknown as RunDetail;
}

// ---- Gallery hosts -----------------------------------------------------------

/** A console holding a stocked cabinet: a case of every type, a model, a
 * published run with a review. The shape most pages are written against.
 *
 * The run id is a parameter because the run-detail layout keeps a PROCESS-WIDE
 * cache of resolved runs, so a run any earlier test resolved would otherwise
 * render on a host that holds nothing — quietly turning the empty-host walk into
 * a second stocked one. Each host gets its own id and the cache can't reach
 * across. */
export function stockedGallery(runId: string): GalleryDataInput {
  // Per-host id for the same reason `runId` is a parameter (see above).
  const legendaryId = `${runId}-halo`;
  const summaries = [
    runSummary(runId, FIXTURE_IDS.slug),
    legendarySummary(legendaryId),
  ];
  // The static-gallery shape of the showcase resolver: a map from run id to
  // served file name, anything else null.
  const showcaseUrls: Record<string, Record<string, string>> = {
    [legendaryId]: {
      "title.png": `https://cdn.example/media/runs/${legendaryId}/showcase/title.png`,
    },
  };
  // The case-side counterpart, keyed the way the static gallery keys it: a
  // `<slug>/<version>/<variant>` subject then the authored file name. It stages
  // the carom fixture's two-entry carousel (the catalog preview and the detail
  // Play tab both resolve through this); anything else null.
  const caseShowcaseUrls: Record<string, Record<string, string>> = {
    [`${FIXTURE_IDS.slug}/v2.0.0/base`]: Object.fromEntries(
      CASE_SHOWCASE_MEDIA.map((media) => [
        media.file,
        `https://cdn.example/media/cases/${FIXTURE_IDS.slug}/v2.0.0/showcase/base/${media.file}`,
      ]),
    ),
  };
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: { [runId]: "---\nrating: great\n---\n\nSolid." },
    reviews: { [runId]: [review()] },
    runsLoading: false,
    testCases: testCases(),
    testCasesStatus: "ready",
    readTestCase: (slug) => Promise.resolve(testCaseDetail(slug)),
    // The run Inputs tab resolves a run's OWN case version and engine through this
    // rather than through the case catalog, so a stocked host has to answer it or
    // the walk would only ever see that tab's empty state.
    readCaseVariant: (ref) =>
      Promise.resolve(
        testCaseDetail(ref.slug)?.variants.find(
          (variant) => variant.slug === ref.variant,
        ) ?? null,
      ),
    models: models(),
    modelsStatus: "ready",
    canExecute: true,
    grafanaUrl: null,
    queryRunSummaries: (query) =>
      Promise.resolve(runSummaryPage(summaries, query)),
    readRun: (id) => {
      const detail = runDetail(id);
      if (id !== legendaryId) return Promise.resolve(detail);
      // Only the legendary run's detail carries a showcase (an image entry the
      // home page's hero stages); the others deliberately omit the key.
      return Promise.resolve({
        ...detail,
        showcase: {
          description: "A **legendary** build.",
          media: [{ file: "title.png", name: "Title screen", kind: "image" }],
        },
      } as RunDetail);
    },
    showcaseMediaUrl: (id, file) => showcaseUrls[id]?.[file] ?? null,
    caseShowcaseMediaUrl: (slug, version, variant, file) =>
      caseShowcaseUrls[`${slug}/${version}/${variant}`]?.[file] ?? null,
    testCaseGroups: testCaseGroups(),
    getCabinetStats: () => Promise.resolve(cabinetStats()),
  };
}

/**
 * A console holding nothing: both catalogs resolved but empty, no runs, no
 * detail resolvable. Every page has an empty state and this is what proves each
 * one renders it rather than reaching into an absent first element.
 */
export function emptyGallery(_runId: string): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    testCases: [],
    testCasesStatus: "ready",
    readTestCase: () => Promise.resolve(null),
    readCaseVariant: () => Promise.resolve(null),
    models: [],
    modelsStatus: "ready",
    canExecute: true,
    grafanaUrl: null,
    queryRunSummaries: () => Promise.resolve({ summaries: [], total: 0 }),
    readRun: () => Promise.resolve(null),
  };
}

/**
 * The read-only static gallery: the same catalog, but no execution capability —
 * which is a different app (no run-execution routes, no notifications layer, no
 * account control), so it is worth walking every route against too.
 */
export function readOnlyGallery(runId: string): GalleryDataInput {
  return { ...stockedGallery(runId), canExecute: false };
}

// ---- Client stubs ------------------------------------------------------------

// A backend that answers the reads a page makes on mount with empty, well-formed
// results. Only the methods `BackendClient` declares as REQUIRED are implemented:
// the optional ones are optional precisely so a page can tell a backend that
// cannot do a thing from one that can, and leaving them off means every page
// gated on a capability renders its unsupported state — which is a state that has
// to render too.
function backendClient(): BackendClient {
  return {
    identity: () =>
      Promise.resolve({
        id: "fixture",
        url: "http://backend.test",
        version: "0.0.0",
        storeReady: true,
      }),
    listModels: () => Promise.resolve([]),
    // The Probes tab lists a model's probes on mount; with no probes it never
    // reads a detail, so the detail read can refuse.
    listModelProbes: () => Promise.resolve([]),
    getModelProbe: () => Promise.reject(new Error("no probes in the fixture")),
    listTestCases: () => Promise.resolve([]),
    listVersions: () => Promise.resolve(["v2.0.0"]),
    resolveVersion: () => Promise.resolve(null),
    readSpecs: () => Promise.resolve([]),
    listRuns: () => Promise.resolve({ runs: [], nextBefore: null }),
    listRunSummaries: () => Promise.resolve({ summaries: [], total: 0 }),
    readRun: () => Promise.resolve(null),
    readRunEvents: () => Promise.resolve(null),
    readReviewItems: () => Promise.resolve([]),
  } as unknown as BackendClient;
}

function workerClient(): WorkerClient {
  return {
    identity: () =>
      Promise.resolve({ id: "fixture", url: "http://worker.test" }),
    listRuns: () => Promise.resolve([]),
    listActiveRuns: () => Promise.resolve([]),
    listFailures: () => Promise.resolve([]),
    getRun: () => Promise.resolve(null),
    readRun: () => Promise.resolve(null),
    readRunEvents: () => Promise.resolve(null),
    subscribeToRun: () => () => {},
    subscribeToNotifications: () => () => {},
    // The console stream's run-lifecycle topic, which every page showing an
    // in-flight list turns on for as long as it is mounted (the Runs tabs, a run's
    // live monitor, a ladder's board). A stub that omits it takes those pages down
    // on mount, which is precisely what this suite is here to catch.
    setRunLifecycleEnabled: () => Promise.resolve(),
  } as unknown as WorkerClient;
}

function backendContext(): BackendContextValue {
  return {
    client: backendClient(),
    identity: {
      id: "fixture",
      url: "http://backend.test",
      version: "0.0.0",
      storeReady: true,
    },
    status: "ready",
    error: null,
    url: "http://backend.test",
    setUrl: () => {},
  };
}

function workersContext(): WorkersContextValue {
  const handle = {
    id: "local",
    label: "Local",
    url: null,
    local: true,
    client: workerClient(),
    identity: { id: "fixture", url: "http://worker.test" },
    backendMatch: "match",
  } as unknown as WorkersContextValue["workers"][number];
  return {
    workers: [handle],
    activeId: handle.id,
    active: handle,
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  };
}

/**
 * The provider stack a host mounts around {@link GalleryApp}, mirroring
 * `apps/web/src/App.tsx`: backend → workers → auth → runs runtime → gallery data.
 * A read-only host mounts neither client provider (the static site has no backend
 * to talk to), which is itself worth exercising — a component that reaches for one
 * without checking throws there and only there.
 */
export function HostProviders({
  data,
  children,
}: {
  data: GalleryDataInput;
  children: ReactNode;
}) {
  const inner = (
    <RunsRuntimeProvider>
      <GalleryDataProvider value={data}>{children}</GalleryDataProvider>
    </RunsRuntimeProvider>
  );
  if (!data.canExecute) return inner;
  return (
    <BackendProvider value={backendContext()}>
      <WorkersProvider value={workersContext()}>
        <AuthProvider>{inner}</AuthProvider>
      </WorkersProvider>
    </BackendProvider>
  );
}
