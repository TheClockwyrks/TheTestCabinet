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
  // How a run of the case is graded: the read-only reviewer checklist (the scoring
  // domains and their weighted items) a reviewer would work through, shown with no
  // verdicts because it is not tied to any run.
  testCaseReviewing: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/reviewing`,
  testCaseRuns: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/runs`,
  testCaseLeaderboard: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/leaderboard`,
  testCaseMetrics: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/metrics`,
  // The case's changelog: every version's entry, newest first.
  testCaseChangelog: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/changelog`,
  // The case's errata: known issues recorded against a version after it shipped,
  // grouped by version (newest first). Shown only when a version records any.
  testCaseErrata: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/errata`,
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
  // The Models section's Providers tab — per-provider health folded from
  // recorded gg runs and probe evidence.
  modelsProviders: (): string => "/models/providers",
  // The model detail index — its Overview tab, which reports the model one test
  // case at a time. The `?case=`/`?variant=` parameters the tab writes select
  // which cohort it opens on, so a specific reading is linkable.
  modelDetail: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}`,
  modelStats: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/stats`,
  modelRuns: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/runs`,
  // The Probes tab — the model's responses-as-code readiness probes: trigger
  // controls, history, and per-probe detail, all on the one page.
  modelProbes: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/probes`,
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
  settingsReviewing: (): string => "/settings/reviewing",
  // Account routes (consoles only; the static site is read-only and never links
  // to them). The account view shows the signed-in user and a sign-out control;
  // login/register are their own pages. `login`/`register` take an optional
  // `next` path to return to after authenticating (defaults to the account view).
  account: (): string => "/account",
  login: (next?: string): string =>
    next ? `/login?next=${encodeURIComponent(next)}` : "/login",
  register: (next?: string): string =>
    next ? `/register?next=${encodeURIComponent(next)}` : "/register",
  // The account section's Reviews tab (consoles only): a paginated table of the
  // signed-in account's own submitted reviews, each row linking to that review.
  accountReviews: (): string => "/account/reviews",
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
  // The account section's ladders tab (consoles only): the reviewer's ladders — an
  // ordered climb of version-pinned cases each harness/model combination advances
  // through on its own, gated on that account's own reviews. A sibling of coverage,
  // not a mode of it, so it gets its own routes rather than a query parameter.
  accountLadders: (): string => "/account/ladders",
  // Create a new ladder, and open / edit an existing one by id. `new` is a static
  // segment so it ranks above the dynamic `:ladderId`.
  accountLadderNew: (): string => "/account/ladders/new",
  accountLadder: (ladderId: string): string => `/account/ladders/${ladderId}`,
  accountLadderEdit: (ladderId: string): string =>
    `/account/ladders/${ladderId}/edit`,
  // The account section's coverage-groups tab: the reusable model/case groups
  // plans reference, plus their create/edit pages.
  accountGroups: (): string => "/account/groups",
  accountGroupNew: (): string => "/account/groups/new",
  accountGroupEdit: (groupId: string): string =>
    `/account/groups/${groupId}/edit`,
  // The account section's gg Configs tab: the operator's registered gg
  // configurations (named capability sets) and their create/edit pages. A configuration is what the
  // new-run form launches once `gg` is picked as the orchestrator. `new` is a static
  // segment so it ranks above `:configId`; the create page optionally seeds itself
  // from an existing configuration (`?from=saved:<id>`) so one can be duplicated.
  accountGgConfigs: (): string => "/account/gg",
  accountGgConfigNew: (from?: string): string =>
    from
      ? `/account/gg/new?from=${encodeURIComponent(from)}`
      : "/account/gg/new",
  accountGgConfigEdit: (configId: string): string =>
    `/account/gg/${configId}/edit`,
  // The account section's gg Agents tab: the operator's saved gg agents, agent
  // profiles authored on their own for configurations to import. Its own section
  // tab, but still pathed under `/account/gg` — `agents` is a static segment there,
  // so it ranks above `:configId` the same way `new` does, and its own pages sit
  // under it.
  accountGgAgents: (): string => "/account/gg/agents",
  accountGgAgentNew: (from?: string): string =>
    from
      ? `/account/gg/agents/new?from=${encodeURIComponent(from)}`
      : "/account/gg/agents/new",
  accountGgAgentEdit: (agentId: string): string =>
    `/account/gg/agents/${agentId}/edit`,
  runs: (): string => "/runs",
  // The publishable-failures worklist (consoles only): produced catastrophic /
  // timed-out runs awaiting publish. The static site never links to it.
  runFailures: (): string => "/runs/failures",
  // Reviewer tooling (consoles only): the unreviewed-runs worklist. A console-only
  // reviewer surface the static site never links to. Static segment beside
  // `/runs/:runId`, like `/runs/new`.
  runUnreviewed: (): string => "/runs/unreviewed",
  // The publish worklist (consoles only): runs that have cleared the publish gate
  // but have not been released yet, so a reviewer can find and batch-publish them
  // instead of hunting through the all-runs listing. Nothing on the public gallery
  // could appear here by definition.
  runUnpublished: (): string => "/runs/unpublished",
  // The harness-comparisons list — the Runs section's "Comparisons" tab, beside
  // "Tests". Rendered on BOTH hosts (read-only on the static site, off the
  // snapshot); a static segment beside `/runs/:runId`, like the others.
  runsComparisons: (): string => "/runs/comparisons",
  // Run-execution routes (consoles only; the static site never links to them).
  // `runNew` optionally carries a test case to pre-select, so the Run button on
  // a test case lands on the new-run form with that case already chosen.
  runNew: (preselect?: {
    slug?: string;
    version?: string;
    variant?: string;
    engine?: string;
  }): string => {
    const params = new URLSearchParams();
    if (preselect?.slug) params.set("slug", preselect.slug);
    if (preselect?.version) params.set("version", preselect.version);
    if (preselect?.variant) params.set("variant", preselect.variant);
    if (preselect?.engine) params.set("engine", preselect.engine);
    const query = params.toString();
    return query ? `/runs/new?${query}` : "/runs/new";
  },
  runMonitor: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/live`,
  // gg run-execution routes (consoles only; the static site never links to them).
  // gg is launched from the ordinary new-run form — picking `gg` as the
  // orchestrator swaps the harness picker for the operator's saved gg
  // configurations — so there is no separate gg launch page. `ggMonitor` watches an
  // enqueued gg run: it rides the same `GET /jobs/{id}/live` relay as `runMonitor`
  // but renders gg's native telemetry, so it is its own page keyed by the launch
  // ack's job id. It lives under a literal `/runs/gg` segment (more specific than
  // the `/runs/:runId` dynamic route, so no collision).
  ggMonitor: (jobId: string): string =>
    `/runs/gg/${encodeURIComponent(jobId)}/live`,
  // The gg **analysis** section (consoles only): its own top-level `/gg` space,
  // entered from the topbar's analyze control. It keeps the app's chrome but swaps
  // the mark for a back arrow and the section nav for gg's own tabs. It opens on
  // the recorded sessions, with Dashboards, Discover and Saved as its siblings
  // below.
  ggAnalysis: (): string => "/gg",
  // **Discover** — the TCQ query surface. The whole query rides in the URL as its
  // **source text**, never its compiled form: that is what keeps `now-30d`
  // relative, so a link shared on Monday still means "the last thirty days" when it
  // is opened on Friday, and what stops a later grammar addition from invalidating
  // a link somebody already pasted somewhere.
  ggAnalysisDiscover: (query?: string, opts?: { range?: string }): string => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (opts?.range) params.set("range", opts.range);
    const search = params.toString();
    return search ? `/gg/query?${search}` : "/gg/query";
  },
  // **Dashboards** — the boards list. The built-in overview lives at the
  // `overview` id below rather than in this list's storage: it is defined as
  // ordinary query text through the same machinery a user board uses, so it cannot
  // silently rot the way a hardcoded breakdown did.
  ggAnalysisDashboards: (): string => "/gg/dashboards",
  // One board, rendered. Deep-linkable, because a board is the thing people leave
  // open — and answered by exactly one batched request whatever its panel count.
  ggAnalysisDashboard: (dashboardId: string): string =>
    `/gg/dashboards/${encodeURIComponent(dashboardId)}`,
  // **Saved** — the operator's saved queries. `new` prefills the form from
  // Discover's editor (`?q=` as **text**, `?range=` as the picker token), so a
  // question is composed where the completer and the field sidebar are and saved
  // without a second editor existing anywhere.
  ggAnalysisSaved: (opts?: {
    create?: { query: string; range?: string };
  }): string => {
    if (!opts?.create) return "/gg/saved";
    const params = new URLSearchParams({ new: "1" });
    if (opts.create.query) params.set("q", opts.create.query);
    if (opts.create.range) params.set("range", opts.create.range);
    return `/gg/saved?${params.toString()}`;
  },
  // **Reference** — gg's own tool and responses-as-code surface, as models are
  // shown it. The bare path is what the section nav links to and what a reader
  // types; it redirects to the Tools tab rather than rendering it, so the tab a
  // page is on is always readable in the address bar (the same shape the
  // test-case catalog's bare `/test-cases` takes).
  ggReference: (): string => "/gg/reference",
  // One entry of either tab is linkable through a search parameter rather than a
  // path segment: a tool name is the model's own identifier and a function's is
  // `object.name`, neither of which is ours to put in a path, and the selection is
  // a *view* of a page that is otherwise the same document either way.
  ggReferenceTools: (tool?: string): string =>
    tool
      ? `/gg/reference/tools?tool=${encodeURIComponent(tool)}`
      : "/gg/reference/tools",
  // The API tab carries a second parameter, because its document is per **SDK arm**:
  // gg offers one set of capabilities under eleven idiomatic spellings, so "which
  // function" and "spelled in which language" are two independent halves of one
  // address and a link that pinned only the first would land a reader on whichever
  // arm the page happened to open on. `lang` is a `GgProgramLanguage` id, the same
  // string a run's language capability is configured with.
  ggReferenceApi: (opts?: { fn?: string; lang?: string }): string => {
    const params = new URLSearchParams();
    if (opts?.lang) params.set("lang", opts.lang);
    if (opts?.fn) params.set("fn", opts.fn);
    const query = params.toString();
    return query ? `/gg/reference/api?${query}` : "/gg/reference/api";
  },
  // The run's landing tab: the bare run URL is the Play tab (the build exactly as
  // the model wrote it). A run with no playable build — an asset-generation,
  // adversarial, or performance run, or one whose state produced nothing to host —
  // redirects from here to its Verdict tab. Generic "open this run" links use
  // this; links that mean "this run's verdict/review" use `runVerdict`.
  runDetail: (runId: string): string => `/runs/${encodeURIComponent(runId)}`,
  // The run's Verdict tab (labelled "Results" for a results-scored run). `edit`
  // opens the review editor in revise mode — used by the single-review page's
  // Edit control to return here with the owner's review form reopened.
  runVerdict: (runId: string, opts?: { edit?: boolean }): string =>
    `/runs/${encodeURIComponent(runId)}/verdict${opts?.edit ? "?edit=1" : ""}`,
  // One reviewer's full review of a run: their writeup and per-item verdicts.
  // Keyed by the reviewing account's id (a run carries at most one review per
  // account), so each review is its own linkable URL.
  runReview: (runId: string, reviewerId: string): string =>
    `/runs/${encodeURIComponent(runId)}/reviews/${encodeURIComponent(reviewerId)}`,
  runInputs: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/inputs`,
  runProof: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/proof`,
  // Legacy: Play now lives at the bare run URL (`runDetail`), and `/play` only
  // redirects there so old deep links keep working. Nothing new should link here.
  runPlay: (runId: string): string => `/runs/${encodeURIComponent(runId)}/play`,
  runMetrics: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/metrics`,
  runMetadata: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/metadata`,
  runEvents: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/events`,
  // A finished **gg** run's rich view: the same capability-shaped panels its live
  // monitor rendered (activity, agent tree, context fill, plan, board, tasks,
  // knowledge), rebuilt from the recorded telemetry. Offered only on a gg run, so
  // opening one from the runs list gets back everything the live view showed.
  runGg: (runId: string): string => `/runs/${encodeURIComponent(runId)}/gg`,
  // The static read of the code the run's model wrote: the provenance it was measured
  // under, the shape of the tree, and an explorer over every file and function. Offered
  // on any harness's run that carries an analysis (analysing a directory is
  // harness-agnostic), which means runs from the day the analyzer shipped onward.
  runCode: (runId: string): string => `/runs/${encodeURIComponent(runId)}/code`,
  // The "Other" section (consoles only): a tabbed list page collecting the
  // surfaces that don't belong on the Test Cases page — Game Jams and
  // Tournaments. The bare `/other` redirects to the first tab (Game Jams). Each
  // tab is its own route so the selection survives a reload and is linkable.
  other: (): string => "/other",
  otherGameJams: (): string => "/other/game-jams",
  otherTournaments: (): string => "/other/tournaments",
  // A game jam's detail page and its reduced tab set (Overview / Inputs / Runs /
  // Leaderboard / Metrics — a jam has no changelog, reference, or arena). Lives at
  // its own top-level `/game-jams/:slug`, a sibling of the `/other/game-jams`
  // list tab.
  gameJamDetail: (slug: string): string =>
    `/game-jams/${encodeURIComponent(slug)}`,
  gameJamInputs: (slug: string): string =>
    `/game-jams/${encodeURIComponent(slug)}/inputs`,
  gameJamRuns: (slug: string): string =>
    `/game-jams/${encodeURIComponent(slug)}/runs`,
  gameJamLeaderboard: (slug: string): string =>
    `/game-jams/${encodeURIComponent(slug)}/leaderboard`,
  gameJamMetrics: (slug: string): string =>
    `/game-jams/${encodeURIComponent(slug)}/metrics`,
  // Harness-comparison routes. The list is the Runs section's Comparisons tab
  // (`runsComparisons`) and a comparison's detail (`/comparisons/:id`) both render
  // on every host (read-only on the static site). Create/edit mutate a per-account
  // comparison, so they are console-only. `new` is a static segment so it outranks
  // the dynamic `:id`.
  comparisonNew: (): string => "/comparisons/new",
  comparisonDetail: (id: string): string =>
    `/comparisons/${encodeURIComponent(id)}`,
  comparisonEdit: (id: string): string =>
    `/comparisons/${encodeURIComponent(id)}/edit`,
  // A tournament's standings + matches (consoles only). The Tournaments list now
  // lives under Other (`/other/tournaments`), but each tournament keeps its own
  // revisitable detail route.
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
  testCaseReviewing: "/test-cases/:slug/reviewing",
  testCaseRuns: "/test-cases/:slug/runs",
  testCaseLeaderboard: "/test-cases/:slug/leaderboard",
  testCaseMetrics: "/test-cases/:slug/metrics",
  testCaseChangelog: "/test-cases/:slug/changelog",
  testCaseErrata: "/test-cases/:slug/errata",
  testCaseArena: "/test-cases/:slug/arena",
  testCaseReference: "/test-cases/:slug/reference",
  models: "/models",
  // The `/models/providers` static path outranks the `/models/:modelId` dynamic
  // route, so the section's Providers tab is reachable at a literal segment
  // beside the model detail (the same literal-beside-param shape `/models/new`
  // uses).
  modelsProviders: "/models/providers",
  // The `/models/new` static path outranks the `/models/:modelId` dynamic route,
  // so a blank/seeded config form is reachable at a literal segment beside the
  // model detail (the same literal-beside-param shape `/runs/new` uses).
  modelNew: "/models/new",
  modelDetail: "/models/:modelId",
  modelStats: "/models/:modelId/stats",
  modelEdit: "/models/:modelId/edit",
  modelRuns: "/models/:modelId/runs",
  modelProbes: "/models/:modelId/probes",
  about: "/about",
  aboutTesting: "/about/testing",
  aboutMetrics: "/about/metrics",
  settings: "/settings",
  settingsAppearance: "/settings/appearance",
  settingsConnections: "/settings/connections",
  settingsHarnesses: "/settings/harnesses",
  settingsReviewing: "/settings/reviewing",
  account: "/account",
  login: "/login",
  register: "/register",
  accountReviews: "/account/reviews",
  // The account section's reviewer-coverage surfaces. `new` and `:planId/edit`
  // are more specific than the bare list/detail, and `new` (static) ranks above
  // the dynamic `:planId`, so react-router matches them correctly.
  accountCoverage: "/account/coverage",
  accountCoveragePlanNew: "/account/coverage/new",
  accountCoveragePlan: "/account/coverage/:planId",
  accountCoveragePlanEdit: "/account/coverage/:planId/edit",
  // The ladder surfaces, laid out exactly as the plan ones: `new` (static) ranks
  // above the dynamic `:ladderId`, and `:ladderId/edit` is more specific than the
  // bare detail, so react-router matches them correctly.
  accountLadders: "/account/ladders",
  accountLadderNew: "/account/ladders/new",
  accountLadder: "/account/ladders/:ladderId",
  accountLadderEdit: "/account/ladders/:ladderId/edit",
  accountGroups: "/account/groups",
  accountGroupNew: "/account/groups/new",
  accountGroupEdit: "/account/groups/:groupId/edit",
  // The account section's gg configurations. `new` (static) outranks the dynamic
  // `:configId`, so route order does not matter.
  accountGgConfigs: "/account/gg",
  accountGgConfigNew: "/account/gg/new",
  accountGgConfigEdit: "/account/gg/:configId/edit",
  // The saved gg agents — their own section tab, sharing the `/account/gg`
  // prefix. `agents` is static, so it and its children outrank the dynamic
  // `:configId`.
  accountGgAgents: "/account/gg/agents",
  accountGgAgentNew: "/account/gg/agents/new",
  accountGgAgentEdit: "/account/gg/agents/:agentId/edit",
  runs: "/runs",
  runFailures: "/runs/failures",
  runUnreviewed: "/runs/unreviewed",
  runUnpublished: "/runs/unpublished",
  runsComparisons: "/runs/comparisons",
  runNew: "/runs/new",
  // gg run-execution routes. The literal `/runs/gg` segment outranks the
  // `/runs/:runId` dynamic route, and `ggMonitor`'s `/runs/gg/:jobId` is a sibling
  // of the plain `runMonitor` under that same static prefix.
  ggMonitor: "/runs/gg/:jobId/live",
  // The gg analysis section's own top-level space (console-only). One route per
  // tab, so a surface is linkable and survives a reload; the index is the sessions
  // list, and Discover is its sibling.
  ggAnalysis: "/gg",
  ggAnalysisDiscover: "/gg/query",
  // Dashboards and Saved. `/gg/dashboards` is static and `/gg/dashboards/:id` its
  // child, so neither collides with `/gg/query`.
  ggAnalysisDashboards: "/gg/dashboards",
  ggAnalysisDashboard: "/gg/dashboards/:dashboardId",
  ggAnalysisSaved: "/gg/saved",
  // Reference. `/gg/reference` is static — it redirects to the Tools tab — and its
  // two tabs are static children of it, so nothing here collides with `/gg/query`
  // or `/gg/dashboards`. The selected tool/function
  // rides in the query string, so no dynamic segment is needed under either tab.
  ggReference: "/gg/reference",
  ggReferenceTools: "/gg/reference/tools",
  ggReferenceApi: "/gg/reference/api",
  runMonitor: "/runs/:runId/live",
  runDetail: "/runs/:runId",
  runVerdict: "/runs/:runId/verdict",
  runReview: "/runs/:runId/reviews/:reviewerId",
  runInputs: "/runs/:runId/inputs",
  runProof: "/runs/:runId/proof",
  // Legacy: redirects to the bare run URL, which is now the Play tab.
  runPlay: "/runs/:runId/play",
  runMetrics: "/runs/:runId/metrics",
  runMetadata: "/runs/:runId/metadata",
  runEvents: "/runs/:runId/events",
  runGg: "/runs/:runId/gg",
  runCode: "/runs/:runId/code",
  // The Other section: the tabbed list (Game Jams / Tournaments) and the game-jam
  // detail routes. The tab slugs are literal siblings under `/other`; the
  // game-jam detail's sub-tabs mirror the test-case detail's, one route each so a
  // tab (and the variant carried in the query string) is linkable.
  other: "/other",
  otherGameJams: "/other/game-jams",
  otherTournaments: "/other/tournaments",
  gameJamDetail: "/game-jams/:slug",
  gameJamInputs: "/game-jams/:slug/inputs",
  gameJamRuns: "/game-jams/:slug/runs",
  gameJamLeaderboard: "/game-jams/:slug/leaderboard",
  gameJamMetrics: "/game-jams/:slug/metrics",
  // Harness-comparison routes. `new` (static) outranks the dynamic `:id`, like
  // the account section's gg-config/coverage-plan routes above.
  comparisonNew: "/comparisons/new",
  comparisonDetail: "/comparisons/:id",
  comparisonEdit: "/comparisons/:id/edit",
  tournamentDetail: "/tournaments/:id",
} as const;

// A path's non-empty segments. Leading, trailing, and repeated slashes collapse
// away, which matches how react-router treats them.
function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

// Every pattern above, pre-split into path segments, for `isKnownRoute`.
const PATTERN_SEGMENTS: ReadonlyArray<readonly string[]> =
  Object.values(routePatterns).map(segmentsOf);

/**
 * Whether a path is addressed by any route in {@link routePatterns}.
 *
 * This exists for whatever **serves** the app, not for the app itself: the gallery
 * is a client-routed single-page app served from one `index.html`, so a static host
 * answers every path with the shell and a `200` — including paths the app has no
 * route for. A server that holds this table can tell an unrecognized URL apart from
 * a real page and answer the former with a `404`. Nothing in the app needs it; the
 * router's own catch-all renders the not-found *page* regardless of status.
 *
 * No host calls it today — the gallery is still served as a static bundle. It is
 * exported and tested here so the table stays a single source of truth for the
 * server that will.
 *
 * A `:param` segment matches any one segment, so this answers whether the path is
 * *shaped* like a route, not whether the thing it names exists. Whether a run id
 * addresses a real run is a separate question, answerable only from the published
 * set.
 *
 * **It deliberately ignores the host gates.** Several patterns mount only where
 * the host can execute runs (`/runs/new`, the whole account section, the
 * console-only settings tabs), and that gating lives in each section's
 * `router.tsx` — where it belongs, next to the elements it gates. Duplicating it
 * here would be a second source of truth that drifts. The cost is that a
 * console-only path requested on the gallery is answered `200` with the
 * router's not-found page rather than a `404`. It renders correctly either way,
 * and it is not a URL anything links to; being coarse here beats being wrong
 * about the whole table later.
 */
export function isKnownRoute(pathname: string): boolean {
  const segments = segmentsOf(pathname);
  return PATTERN_SEGMENTS.some(
    (pattern) =>
      pattern.length === segments.length &&
      pattern.every(
        (segment, index) =>
          segment.startsWith(":") || segment === segments[index],
      ),
  );
}
