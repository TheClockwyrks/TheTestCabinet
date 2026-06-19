// Centralized URL builders. Never inline path literals in components; call these
// functions so every route is defined in exactly one place.

export const routes = {
  home: (): string => "/",
  testCases: (): string => "/test-cases",
  testCaseDetail: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}`,
  testCaseSpecs: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/specs`,
  testCaseReferences: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/references`,
  testCaseRuns: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/runs`,
  testCaseMetrics: (slug: string): string =>
    `/test-cases/${encodeURIComponent(slug)}/metrics`,
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
  runs: (): string => "/runs",
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
  runSpecs: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/specs`,
  runReferences: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/references`,
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
} as const;

// Route patterns for <Route path={...}>. Kept alongside the builders so the
// pattern and the builder stay in sync.
export const routePatterns = {
  home: "/",
  testCases: "/test-cases",
  testCaseDetail: "/test-cases/:slug",
  testCaseSpecs: "/test-cases/:slug/specs",
  testCaseReferences: "/test-cases/:slug/references",
  testCaseRuns: "/test-cases/:slug/runs",
  testCaseMetrics: "/test-cases/:slug/metrics",
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
  runs: "/runs",
  runNew: "/runs/new",
  runMonitor: "/runs/:runId/live",
  runDetail: "/runs/:runId",
  runSpecs: "/runs/:runId/specs",
  runReferences: "/runs/:runId/references",
  runProof: "/runs/:runId/proof",
  runPlay: "/runs/:runId/play",
  runMetrics: "/runs/:runId/metrics",
  runMetadata: "/runs/:runId/metadata",
  runEvents: "/runs/:runId/events",
} as const;
