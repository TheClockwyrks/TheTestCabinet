import { useMemo } from "react";
import { BrowserRouter } from "react-router";
import {
  AuthProvider,
  BackendProvider,
  WorkersProvider,
  useBackend,
  useWorkers,
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
  useWorkerConnections,
} from "./state/useConnections";

// The web console: the full shared gallery app (from @test-cabinet/ui) rendered
// against live data. It points at a backend for the catalog and published runs,
// and at worker servers (added in the connections drawer) for execution; that
// run-execution capability is the only difference from the static site. The
// Tauri app mounts the same app with its own transport and a built-in local
// worker pre-added.
export function App() {
  const backend = useBackendConnection();
  const workers = useWorkerConnections(backend.identity);

  return (
    <BackendProvider value={backend}>
      <WorkersProvider value={workers}>
        {/* Auth lives below the workers provider — register/login go through the
            active worker transport — and above the gallery so the review UI can
            read the signed-in account. */}
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
  // The arena runs matches on a chosen worker (the active one by default) and reads
  // persisted tournaments from the backend; it is offered only when a worker is
  // connected (the gallery additionally gates the run UI on `canExecute`). Rebuilt
  // when the worker set or backend changes so it always targets the current
  // connections.
  const { url: backendUrl } = useBackend();
  const { workers, activeId } = useWorkers();
  // The arena needs every worker's id/label/url so its dropdown can switch which
  // worker contributes its local runs; the key folds the set so the memo rebuilds
  // when a worker is added/removed or its URL changes.
  const arenaWorkers = useMemo(
    () => workers.map((w) => ({ id: w.id, label: w.label, url: w.url })),
    [workers],
  );
  const workersKey = arenaWorkers
    .map((w) => `${w.id}:${w.url ?? ""}`)
    .join("|");
  const arena = useMemo(
    () =>
      arenaWorkers.length > 0
        ? createHttpArena(arenaWorkers, activeId, backendUrl)
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workersKey, activeId, backendUrl],
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
