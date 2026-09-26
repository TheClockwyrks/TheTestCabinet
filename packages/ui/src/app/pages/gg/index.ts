// Barrel for the gg analysis section: the recorded-sessions list the section opens
// on, and Discover — the TCQ query surface. These are the *analysis* surfaces —
// configuring a gg run lives in the account section, and watching one lives beside
// the other run monitors. See apps/docs `gg/`.
export { GgDiscoverPage } from "./GgDiscoverPage";
export { GgSessionsPage } from "./GgSessionsPage";
export { GG_CHROME, GG_PUBLIC_CHROME, ggChrome } from "./ggChrome";
export { useGgSource, type GgSource } from "./ggSource";
export { ggAnalysisRoutes } from "./router";
