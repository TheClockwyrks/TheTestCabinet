import { useMemo } from "react";
import { BrowserRouter } from "react-router";
import {
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
        {/* Above the data source so a launched run's refresh signal reaches it. */}
        <RunsRuntimeProvider>
          <WebGallery />
        </RunsRuntimeProvider>
      </WorkersProvider>
    </BackendProvider>
  );
}

function WebGallery() {
  // The arena runs matches on the active worker and reads persisted tournaments
  // from the backend; it is offered only when a worker is connected (the gallery
  // additionally gates the run UI on `canExecute`). Rebuilt when either base URL
  // changes so it always targets the current connections.
  const { url: backendUrl } = useBackend();
  const { active: worker } = useWorkers();
  const workerUrl = worker?.url ?? null;
  const arena = useMemo(
    () => (workerUrl ? createHttpArena(workerUrl, backendUrl) : undefined),
    [workerUrl, backendUrl],
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
