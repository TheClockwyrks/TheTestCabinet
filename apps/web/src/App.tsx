import { useEffect, useMemo, useState } from "react";
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
import { fetchArenaUrl } from "./transport/httpBackend";
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
  // The arena reads persisted tournaments from the backend but runs matches and
  // tournaments against the dedicated `tcab-arena` service, whose base URL the
  // backend reports at `GET /config`. Resolve it once per backend (best-effort:
  // null leaves the run methods to fail loudly and the gallery to degrade the
  // adversarial run UI, which it already gates on `canExecute`). The arena handle is
  // rebuilt when either URL changes so it always targets the current connection.
  const { url: backendUrl } = useBackend();
  const [arenaUrl, setArenaUrl] = useState<string | null>(null);
  useEffect(() => {
    setArenaUrl(null);
    if (!backendUrl) return;
    let active = true;
    fetchArenaUrl(backendUrl)
      .then((u) => active && setArenaUrl(u))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [backendUrl]);
  const arena = useMemo(
    () => (backendUrl ? createHttpArena(backendUrl, arenaUrl) : undefined),
    [backendUrl, arenaUrl],
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
