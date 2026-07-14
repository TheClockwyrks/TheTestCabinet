// `@test-cabinet/ui/app` — the shared, routed gallery application.
//
// This is the whole site UI (the routed pages, the topbar, the synthwave
// backdrop) plus the run-execution extensions, packaged so every GUI renders the
// same app. A host mounts <GalleryApp/> inside its own router and a
// <GalleryDataProvider> built from its data source (the static site from the
// build-time snapshot; the web/desktop consoles from a backend + worker). The
// app's global stylesheet is imported here as a side effect so a host needs only
// to import this entry.
import "./styles/global.scss";

export { GalleryApp } from "./GalleryApp";

export {
  GalleryDataProvider,
  useGalleryData,
  type ArenaApi,
  type ArenaWorkerOption,
  type GalleryData,
  type GalleryDataInput,
  type HarnessAuth,
  type HarnessAuthApi,
  type HarnessAuthMode,
  type InProgressRun,
  type RunDetail,
  type SubscriptionFile,
} from "./data/galleryContext";

// Run-execution runtime (session-scoped in-progress runs + refresh signal) and
// the review-framing helper a live host uses to feed the gallery.
export {
  useRunsRuntime,
  RunsRuntimeProvider,
  type RunsRuntime,
} from "./runtime/runsRuntime";
export { frameReview, frameReviews } from "./data/frameReview";

// The shared live gallery data source for the consoles (web + desktop), built
// from the BackendClient/WorkerClient contexts. Each console supplies its own
// transport behind those contexts; the assembly is identical.
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
  type VariantSummary,
  type SeededInput,
  type ReferenceScreenshot,
} from "./data/testCases";
export { type ParsedWriteup, parseWriteup } from "./data/ratings";

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
