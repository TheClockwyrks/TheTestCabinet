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
  about: (): string => "/about",
  aboutTesting: (): string => "/about/testing",
  aboutMetrics: (): string => "/about/metrics",
  runDetail: (runId: string): string => `/runs/${encodeURIComponent(runId)}`,
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
  about: "/about",
  aboutTesting: "/about/testing",
  aboutMetrics: "/about/metrics",
  runDetail: "/runs/:runId",
} as const;
