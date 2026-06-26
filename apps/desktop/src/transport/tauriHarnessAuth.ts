// The HarnessAuthApi over Tauri IPC: the desktop shell manages the harness
// credentials its self-contained cluster authenticates runs with (API keys, auth
// methods, and subscription files), persisting them and applying them to the
// running cluster. Mirrors `crates/desktop/src/harness_auth.rs`.
import type { HarnessAuthApi } from "@test-cabinet/ui/app";
import * as api from "../api";

export function createTauriHarnessAuth(): HarnessAuthApi {
  return {
    list: () => api.listHarnessAuth(),
    setAuthMode: (slug, mode) => api.setHarnessAuthMode(slug, mode),
    setApiKey: (slug, key) => api.setHarnessApiKey(slug, key),
    refreshSubscription: (slug) => api.refreshSubscription(slug),
  };
}
