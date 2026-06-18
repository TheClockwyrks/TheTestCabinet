// The BackendClient over Tauri IPC. The catalog (harnesses, models, test cases,
// specs) is resolved by the desktop core's `#[tauri::command]` handlers, which
// themselves read from the configured backend (`TCAB_BACKEND_URL`) or local
// disk. The published-run read endpoints are not exposed over IPC yet, so those
// throw NotSupported — the desktop gallery shows the local catalog and the
// worker's produced runs until a proxy command is added.
import {
  NotSupportedError,
  type BackendClient,
  type BackendIdentity,
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
    listHarnesses: () => api.listHarnesses(),
    listModels: () => api.listModels(),
    listTestCases: () => api.listTestCases(),
    listVersions: (slug) => api.listVersions(slug),
    resolveVersion: (slug, version) => api.resolveVersion(slug, version),
    readSpecs: (slug, version, variant) =>
      api.readSpecs(slug, version, variant),
    listRuns(): Promise<RunPage> {
      return Promise.reject(new NotSupportedError("listRuns"));
    },
    readRun(): Promise<StoredRun> {
      return Promise.reject(new NotSupportedError("readRun"));
    },
  };
}
