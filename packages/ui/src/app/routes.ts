// Centralized URL builders. Never inline path literals in components; call these
// functions so every route is defined in exactly one place.

export const routes = {
  home: (): string => "/",
  // Back-compat alias: the gallery now lives at the home route. Existing
  // references to `galleryIndex` keep working; prefer `home` in new code.
  galleryIndex: (): string => "/",
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
  runs: (): string => "/runs",
  // Run-execution routes (consoles only; the static site never links to them).
  runNew: (): string => "/runs/new",
  runMonitor: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/live`,
  runDetail: (runId: string): string => `/runs/${encodeURIComponent(runId)}`,
  runPlay: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/play`,
  runMetrics: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/metrics`,
  runMetadata: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/metadata`,
  runValidation: (runId: string): string =>
    `/runs/${encodeURIComponent(runId)}/validation`,
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
  runs: "/runs",
  runNew: "/runs/new",
  runMonitor: "/runs/:runId/live",
  runDetail: "/runs/:runId",
  runPlay: "/runs/:runId/play",
  runMetrics: "/runs/:runId/metrics",
  runMetadata: "/runs/:runId/metadata",
  runValidation: "/runs/:runId/validation",
} as const;
