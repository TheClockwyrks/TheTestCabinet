import { useMemo } from "react";
import { BrowserRouter } from "react-router";
import {
  AuthProvider,
  BackendProvider,
  WorkersProvider,
  useBackend,
} from "@test-cabinet/ui/client";
import {
  GalleryApp,
  GalleryDataProvider,
  RunsRuntimeProvider,
  useLiveGallery,
} from "@test-cabinet/ui/app";
import { createHttpArena } from "./transport/httpArena";
import {
  useBackendConnection,
  useExecConnection,
} from "./state/useConnections";

// The web console: the full shared gallery app (from @test-cabinet/ui) rendered
// against live data. It talks to a single backend URL — for the catalog and
// published runs, and (since the per-run-Job refactor) for executing runs via the
// backend's `/jobs` queue. That run-execution capability is the only difference
// from the static site. The Tauri app mounts the same app with its own transport
// and a built-in local worker.
export function App() {
  const backend = useBackendConnection();
  // The execution target is the same backend; presented through the shared
  // workers context as a single, fixed handle (no worker list to manage).
  const workers = useExecConnection(backend.url);

  return (
    <BackendProvider value={backend}>
      <WorkersProvider value={workers}>
        {/* Auth lives below the workers provider — register/login go through the
            execution transport (now the backend + auth service) — and above the
            gallery so the review UI can read the signed-in account. */}
        <AuthProvider>
          {/* Above the data source so a launched run's refresh signal reaches it. */}
          <RunsRuntimeProvider>
            <WebGallery />
          </RunsRuntimeProvider>
        </AuthProvider>
      </WorkersProvider>
    </BackendProvider>
  );
}

function WebGallery() {
  // The arena runs matches and reads persisted tournaments against the single
  // backend URL; it is offered only when a backend is configured (the gallery
  // additionally gates the run UI on `canExecute`). Rebuilt when the backend
  // changes so it always targets the current connection.
  const { url: backendUrl } = useBackend();
  const arena = useMemo(
    () => (backendUrl ? createHttpArena(backendUrl) : undefined),
    [backendUrl],
  );
  const data = useLiveGallery(arena);
  return (
    <GalleryDataProvider value={data}>
      <BrowserRouter>
        <GalleryApp />
      </BrowserRouter>
    </GalleryDataProvider>
  );
}
