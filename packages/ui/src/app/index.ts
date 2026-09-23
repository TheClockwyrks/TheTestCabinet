// `@clockwyrks/ui/app` — the shared, routed gallery application.
//
// This is the whole site UI (the routed pages, the topbar, the synthwave
// backdrop) plus the run-execution extensions, packaged so the static site and
// the web console render the same app. A host mounts <GalleryApp/> inside its own
// router and a <GalleryDataProvider> built from its data source (the static site
// from the build-time snapshot; the web console from a backend + worker). The
// app's global stylesheet is imported here as a side effect so a host needs only
// to import this entry.
import "./styles/global.scss";

export { GalleryApp } from "./GalleryApp";

export {
  GalleryDataProvider,
  useGalleryData,
  type ArenaApi,
  type ArenaWorkerOption,
  type CaseVariantRef,
  type GalleryData,
  type GalleryDataInput,
  type InProgressRun,
  type RunDetail,
} from "./data/galleryContext";

// Run-execution runtime (session-scoped in-progress runs + refresh signal) and
// the review-framing helper a live host uses to feed the gallery.
export {
  useRunsRuntime,
  RunsRuntimeProvider,
  type RunsRuntime,
} from "./runtime/runsRuntime";
export { frameReview, frameReviews } from "./data/frameReview";

// The live gallery data source for the web console, built from the
// BackendClient/WorkerClient contexts it mounts with the HTTP transport.
export { useLiveGallery } from "./runtime/useLiveGallery";

// Data hooks (read the provider) and their state shapes.
export {
  useCaseRunSummaries,
  type CaseRunSummariesState,
} from "./data/useRuns";
export { toRunSummary } from "./data/runSummary";
export {
  runSummaryPage,
  type RunQuery,
  type RunQueryResult,
  type RunSort,
  type SortDir,
} from "./data/runQuery";
export { useTestCases, type TestCasesState } from "./data/useTestCases";
export { useTestCaseGroups } from "./data/useTestCaseGroups";
// The static site's local mirror of `GET /stats/cabinet` (the consoles ask the
// backend instead).
export { foldCabinetStats, type CabinetStats } from "./data/cabinetStats";
export { useTestCase, type TestCaseState } from "./data/useTestCase";
export {
  useCaseVariant,
  useReviewModel,
  useRunVariant,
  type ReviewModelState,
  type RunVariantState,
} from "./data/useRunVariant";
export { useModels, useFindModel, type ModelsState } from "./data/useModels";
export { useFindReview } from "./data/writeups";

// The model catalog: shapes + mappers. The catalog itself is transport-driven
// (the console fetches it from the backend, the site reads it from the snapshot).
export {
  findModelByModelId,
  toModelSummary,
  type ModelSummary,
  type ModelPrices,
  type PriceObservation,
} from "./data/models";
export {
  type TestCaseSummary,
  type TestCaseGroupSummary,
  type TestCaseDetail,
  type VariantSummary,
  type SeededInput,
  type ReferenceScreenshot,
} from "./data/testCases";
export { type ParsedWriteup, parseWriteup } from "./data/ratings";

// The engine catalogue as the console names it: display names for the run
// dimension, and the slug that means "no runtime" — which is also the engine a
// surface renders for when it is showing a case rather than a run.
export {
  DEFAULT_ENGINE_SLUG,
  ENGINES,
  engineName,
  orderEngines,
  type EngineOption,
} from "./data/engines";

// Route builders/patterns, for hosts that link into the app (e.g. after a run
// launches).
export { routes, routePatterns } from "./routes";

// Shared, persisted console preferences (the decorative sun, the live event-feed
// style). A global store, so a host can read or set a preference too.
export {
  useAppSettings,
  EVENT_FEED_STYLES,
  type EventFeedStyle,
} from "./store/appSettings";
