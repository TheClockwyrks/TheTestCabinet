// Centralized URL builders. Never inline path literals in components; call these
// functions so every route is defined in exactly one place.

// The catalog's type tabs, each its own route so the selected tab survives a
// reload and is linkable. Asset-generation is split into five tabs by asset
// family — 2D (sprite + paint), 3D (voxel/mesh/skinned), Blender (glTF
// characters), particle, and audio; the rest map one-to-one to a `TestType`.
// Each tab slug is a literal path
// segment under `/test-cases`, a sibling of the `:slug` detail route (the same
// literal-beside-param shape as `/runs/failures` beside `/runs/:runId`) — none
// collides with a real case slug.
export type CatalogTab =
  | "end-to-end"
  | "full-stack"
  | "2d"
  | "3d"
  | "blender"
  | "particle"
  | "audio"
  | "adversarial"
  | "performance";

export const routes = {
  home: (): string => "/",
  testCases: (): string => "/test-cases",
  // The catalog scoped to one type tab (e.g. `/test-cases/2d`).
  testCasesCatalog: (tab: CatalogTab): string => `/test-cases/${tab}`,
  testCaseDetail: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}`,
  testCaseInputs: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/inputs`,
  testCaseRuns: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/runs`,
  testCaseLeaderboard: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/leaderboard`,
  testCaseMetrics: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/metrics`,
  // The case's changelog: every version's entry, newest first.
  testCaseChangelog: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/changelog`,
  // The adversarial arena for a case (consoles only): pit two controllers in a
  // quick match or run a tournament over a field.
  testCaseArena: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/arena`,
  // The case's reference implementation: the authored, correct static build for
  // the selected variant, embedded inline. Shown only for an end-to-end case whose
  // selected variant declares a `reference_implementation`.
  testCaseReference: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/reference`,
  models: (): string => "/models",
  modelDetail: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}`,
  modelStats: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/stats`,
  modelPricing: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/pricing`,
  modelRuns: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/runs`,
  // The add/edit model config form (consoles only; the static site is read-only
  // and never links here). `modelNew` opens a blank draft, optionally seeded from
  // a run of an unknown model (`?fromRun=<runId>`) or pre-claiming a known id
  // (`?alias=<modelId>`); `modelEdit` opens an existing config for revision. The
  // `/models/new` static path outranks the `/models/:modelId` dynamic route.
  modelNew: (opts?: { fromRun?: string; alias?: string }): string => {
    const params = new URLSearchParams();
    if (opts?.fromRun) params.set("fromRun", opts.fromRun);
    if (opts?.alias) params.set("alias", opts.alias);
    const query = params.toString();
    return query ? `/models/new?${query}` : "/models/new";
  },
  modelEdit: (slug: string): string =>
    `/models/${encodeURIComponent(slug)}/edit`,
  about: (): string => "/about",
  aboutTesting: (): string => "/about/testing",
  aboutMetrics: (): string => "/about/metrics",
  // Settings routes (consoles only; the static site never links to them). The
  // base path redirects to Appearance, the section's first tab.
  settings: (): string => "/settings",
  settingsAppearance: (): string => "/settings/appearance",
  settingsConnections: (): string => "/settings/connections",
  settingsHarnesses: (): string => "/settings/harnesses",
  // Account routes (consoles only; the static site is read-only and never links
  // to them). The account view shows the signed-in user and a sign-out control;
  // login/register are their own pages. `login`/`register` take an optional
  // `next` path to return to after authenticating (defaults to the account view).
  account: (): string => "/account",
  login: (next?: string): string =>
    next ? `/login?next=${encodeURIComponent(next)}` : "/login",
  register: (next?: string): string =>
    next ? `/register?next=${encodeURIComponent(next)}` : "/register",
  // The account section's reviewer-coverage tab (consoles only): the list of the
  // signed-in reviewer's coverage plans, each opening its own dashboard/editor.
  accountCoverage: (): string => "/account/coverage",
  // Create a new plan, and open / edit an existing one by id. `new` is a static
  // segment so it ranks above the dynamic `:planId`.
  accountCoveragePlanNew: (): string => "/account/coverage/new",
  accountCoveragePlan: (planId: string): string =>
    `/account/coverage/${planId}`,
  accountCoveragePlanEdit: (planId: string): string =>
    `/account/coverage/${planId}/edit`,
  // The account section's coverage-groups tab: the reusable model/case groups
  // plans reference, plus their create/edit pages.
  accountGroups: (): string => "/account/groups",
  accountGroupNew: (): string => "/account/groups/new",
  accountGroupEdit: (groupId: string): string =>
    `/account/groups/${groupId}/edit`,
  runs: (): string => "/runs",
  // The publishable-failures worklist (consoles only): produced catastrophic /
  // timed-out runs awaiting publish. The static site never links to it.
  runFailures: (): string => "/runs/failures",
  // Reviewer tooling (consoles only): the unreviewed-runs worklist. A console-only
  // reviewer surface the static site never links to. Static segment beside
  // `/runs/:runId`, like `/runs/new`.
  runUnreviewed: (): string => "/runs/unreviewed",
  // Run-execution routes (consoles only; the static site never links to them).
  // `runNew` optionally carries a test case to pre-select, so the Run button on
  // a test case lands on the new-run form with that case already chosen.
  runNew: (preselect?: {
    slug?: string;
    version?: string;
    variant?: string;
  }): string => {
    const params = new URLSearchParams();
    if (preselect?.slug) params.set("slug", preselect.slug);
    if (preselect?.version) params.set("version", preselect.version);
    if (preselect?.variant) params.set("variant", preselect.variant);
    const query = params.toString();
    return query ? `/runs/new?${query}` : "/runs/new";
  },
  runMonitor: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/live`,
  // The run's default (Verdict) tab. `edit` opens the review editor in revise
  // mode — used by the single-review page's Edit control to return here with the
  // owner's review form reopened.
  runDetail: (runId: string, opts?: { edit?: boolean }): string =>
    `/runs/${encodeURIComponent(runId)}${opts?.edit ? "?edit=1" : ""}`,
  // One reviewer's full review of a run: their writeup and per-item verdicts.
  // Keyed by the reviewing account's id (a run carries at most one review per
  // account), so each review is its own linkable URL.
  runReview: (runId: string, reviewerId: string): string =>
    `/runs/${encodeURIComponent(runId)}/reviews/${encodeURIComponent(reviewerId)}`,
  runInputs: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/inputs`,
  runProof: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/proof`,
  runPlay: (runId: string): string => `/runs/${encodeURIComponent(runId)}/play`,
  runMetrics: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/metrics`,
  runMetadata: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/metadata`,
  runEvents: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/events`,
  // Tournament routes (consoles only; the static site never links to them). The
  // arena persists tournaments and lists them here, each revisitable by id.
  tournaments: (): string => "/tournaments",
  tournamentDetail: (id: string): string =>
    `/tournaments/${encodeURIComponent(id)}`,
} as const;

// Route patterns for <Route path={...}>. Kept alongside the builders so the
// pattern and the builder stay in sync.
export const routePatterns = {
  home: "/",
  testCases: "/test-cases",
  // The catalog's type tabs — literal siblings of `:slug` below (static segments
  // rank above the dynamic `:slug`, and no case slug matches these words).
  testCasesE2E: "/test-cases/end-to-end",
  testCasesFullStack: "/test-cases/full-stack",
  testCases2D: "/test-cases/2d",
  testCases3D: "/test-cases/3d",
  testCasesBlender: "/test-cases/blender",
  testCasesParticle: "/test-cases/particle",
  testCasesAudio: "/test-cases/audio",
  testCasesAdversarial: "/test-cases/adversarial",
  testCasesPerformance: "/test-cases/performance",
  testCaseDetail: "/test-cases/:slug",
  testCaseInputs: "/test-cases/:slug/inputs",
  testCaseRuns: "/test-cases/:slug/runs",
  testCaseLeaderboard: "/test-cases/:slug/leaderboard",
  testCaseMetrics: "/test-cases/:slug/metrics",
  testCaseChangelog: "/test-cases/:slug/changelog",
  testCaseArena: "/test-cases/:slug/arena",
  testCaseReference: "/test-cases/:slug/reference",
  models: "/models",
  // The `/models/new` static path outranks the `/models/:modelId` dynamic route,
  // so a blank/seeded config form is reachable at a literal segment beside the
  // model detail (the same literal-beside-param shape `/runs/new` uses).
  modelNew: "/models/new",
  modelDetail: "/models/:modelId",
  modelStats: "/models/:modelId/stats",
  modelPricing: "/models/:modelId/pricing",
  modelEdit: "/models/:modelId/edit",
  modelRuns: "/models/:modelId/runs",
  about: "/about",
  aboutTesting: "/about/testing",
  aboutMetrics: "/about/metrics",
  settings: "/settings",
  settingsAppearance: "/settings/appearance",
  settingsConnections: "/settings/connections",
  settingsHarnesses: "/settings/harnesses",
  account: "/account",
  login: "/login",
  register: "/register",
  // The account section's reviewer-coverage surfaces. `new` and `:planId/edit`
  // are more specific than the bare list/detail, and `new` (static) ranks above
  // the dynamic `:planId`, so react-router matches them correctly.
  accountCoverage: "/account/coverage",
  accountCoveragePlanNew: "/account/coverage/new",
  accountCoveragePlan: "/account/coverage/:planId",
  accountCoveragePlanEdit: "/account/coverage/:planId/edit",
  accountGroups: "/account/groups",
  accountGroupNew: "/account/groups/new",
  accountGroupEdit: "/account/groups/:groupId/edit",
  runs: "/runs",
  runFailures: "/runs/failures",
  runUnreviewed: "/runs/unreviewed",
  runNew: "/runs/new",
  runMonitor: "/runs/:runId/live",
  runDetail: "/runs/:runId",
  runReview: "/runs/:runId/reviews/:reviewerId",
  runInputs: "/runs/:runId/inputs",
  runProof: "/runs/:runId/proof",
  runPlay: "/runs/:runId/play",
  runMetrics: "/runs/:runId/metrics",
  runMetadata: "/runs/:runId/metadata",
  runEvents: "/runs/:runId/events",
  tournaments: "/tournaments",
  tournamentDetail: "/tournaments/:id",
} as const;
