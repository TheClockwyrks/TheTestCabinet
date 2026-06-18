// The BackendClient over Tauri IPC. The catalog (harnesses, models, test cases,
// specs) is resolved by the desktop core's `#[tauri::command]` handlers, which
// themselves read from the configured backend (`TCAB_BACKEND_URL`) or local
// disk. The published-run read endpoints proxy to the backend's `GET /runs` /
// `GET /runs/{id}` through the `list_published_runs` / `read_published_run`
// commands; with no backend configured they fail gracefully (an empty published
// gallery), leaving the local catalog and the worker's produced runs.
import {
  NotSupportedError,
  type BackendClient,
  type BackendIdentity,
  type ReviewItem,
  type RunEventStreams,
  type RunPage,
  type StoredRun,
} from "@test-cabinet/ui/client";
import * as api from "../api";

export function createTauriBackend(): BackendClient {
  return {
    async identity(): Promise<BackendIdentity> {
      const [version, configured] = await Promise.all([
        api.appVersion().catch(() => null),
        api.backendConfigured().catch(() => false),
      ]);
      return {
        id: "tauri-local-core",
        url: "tauri://local",
        version,
        storeReady: configured,
      };
    },
    listModels: () => api.listModels(),
    listTestCases: () => api.listTestCases(),
    listVersions: (slug) => api.listVersions(slug),
    resolveVersion: (slug, version) => api.resolveVersion(slug, version),
    readSpecs: (slug, version, variant) =>
      api.readSpecs(slug, version, variant),
    readReviewItems: (slug, version, variant): Promise<ReviewItem[]> =>
      api.readReviewItems(slug, version, variant),
    listRuns(opts): Promise<RunPage> {
      return api.listPublishedRuns(opts);
    },
    readRun(id): Promise<StoredRun> {
      return api.readPublishedRun(id);
    },
    readRunEvents(): Promise<RunEventStreams> {
      // The desktop core proxies published runs but exposes no events endpoint for
      // them; a published run's events come from the worker copy on disk when it
      // is still produced locally. For a purely-published run viewed here, report
      // unsupported so the Events tab shows a clear "not available here" state.
      throw new NotSupportedError("readRunEvents");
    },
  };
}
