// Centralized URL builders. Never inline path literals in components; call these
// functions so every route is defined in exactly one place.

export const routes = {
  galleryIndex: (): string => "/",
  runDetail: (runId: string): string => `/runs/${encodeURIComponent(runId)}`,
} as const;

// Route patterns for <Route path={...}>. Kept alongside the builders so the
// pattern and the builder stay in sync.
export const routePatterns = {
  galleryIndex: "/",
  runDetail: "/runs/:runId",
} as const;
