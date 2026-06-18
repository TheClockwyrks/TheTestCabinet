import { BrowserRouter } from "react-router";
import { BackendProvider, WorkersProvider } from "@test-cabinet/ui/client";
import {
  GalleryApp,
  GalleryDataProvider,
  RunsRuntimeProvider,
  useLiveGallery,
} from "@test-cabinet/ui/app";
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
  const data = useLiveGallery();
  return (
    <GalleryDataProvider value={data}>
      <BrowserRouter>
        <GalleryApp />
      </BrowserRouter>
    </GalleryDataProvider>
  );
}
