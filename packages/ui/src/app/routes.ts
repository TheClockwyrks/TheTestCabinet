// Centralized URL builders. Never inline path literals in components; call these
// functions so every route is defined in exactly one place.

export const routes = {
  home: (): string => "/",
  testCases: (): string => "/test-cases",
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
  // The adversarial arena for a case (consoles only): pit two controllers in a
  // quick match or run a tournament over a field.
  testCaseArena: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/arena`,
  models: (): string => "/models",
  modelDetail: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}`,
  modelStats: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/stats`,
  modelRuns: (modelId: string): string =>
    `/models/${encodeURIComponent(modelId)}/runs`,
  about: (): string => "/about",
  aboutTesting: (): string => "/about/testing",
  aboutMetrics: (): string => "/about/metrics",
  // Settings routes (consoles only; the static site never links to them). The
  // base path redirects to Appearance, the section's first tab.
  settings: (): string => "/settings",
  settingsAppearance: (): string => "/settings/appearance",
  settingsConnections: (): string => "/settings/connections",
  settingsAuth: (): string => "/settings/authentication",
  // Account routes (consoles only; the static site is read-only and never links
  // to them). The account view shows the signed-in user and a sign-out control;
  // login/register are their own pages. `login`/`register` take an optional
  // `next` path to return to after authenticating (defaults to the account view).
  account: (): string => "/account",
  login: (next?: string): string =>
    next ? `/login?next=${encodeURIComponent(next)}` : "/login",
  register: (next?: string): string =>
    next ? `/register?next=${encodeURIComponent(next)}` : "/register",
  runs: (): string => "/runs",
  // The publishable-failures worklist (consoles only): produced catastrophic /
  // timed-out runs awaiting publish. The static site never links to it.
  runFailures: (): string => "/runs/failures",
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
  runDetail: (runId: string): string => `/runs/${encodeURIComponent(runId)}`,
  runInputs: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/inputs`,
  runProof: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/proof`,
  runPlay: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/play`,
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
  testCaseDetail: "/test-cases/:slug",
  testCaseInputs: "/test-cases/:slug/inputs",
  testCaseRuns: "/test-cases/:slug/runs",
  testCaseLeaderboard: "/test-cases/:slug/leaderboard",
  testCaseMetrics: "/test-cases/:slug/metrics",
  testCaseArena: "/test-cases/:slug/arena",
  models: "/models",
  modelDetail: "/models/:modelId",
  modelStats: "/models/:modelId/stats",
  modelRuns: "/models/:modelId/runs",
  about: "/about",
  aboutTesting: "/about/testing",
  aboutMetrics: "/about/metrics",
  settings: "/settings",
  settingsAppearance: "/settings/appearance",
  settingsConnections: "/settings/connections",
  settingsAuth: "/settings/authentication",
  account: "/account",
  login: "/login",
  register: "/register",
  runs: "/runs",
  runFailures: "/runs/failures",
  runNew: "/runs/new",
  runMonitor: "/runs/:runId/live",
  runDetail: "/runs/:runId",
  runInputs: "/runs/:runId/inputs",
  runProof: "/runs/:runId/proof",
  runPlay: "/runs/:runId/play",
  runMetrics: "/runs/:runId/metrics",
  runMetadata: "/runs/:runId/metadata",
  runEvents: "/runs/:runId/events",
  tournaments: "/tournaments",
  tournamentDetail: "/tournaments/:id",
} as const;
