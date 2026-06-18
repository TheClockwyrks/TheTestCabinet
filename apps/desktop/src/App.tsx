import { BrowserRouter } from "react-router";
import { BackendProvider, WorkersProvider } from "@test-cabinet/ui/client";
import {
  GalleryApp,
  GalleryDataProvider,
  RunsRuntimeProvider,
  useLiveGallery,
} from "@test-cabinet/ui/app";
import { useTauriBackend, useTauriWorkers } from "./state/useConnections";

// The desktop app: the same shared gallery app the web console renders, but with
// Tauri-backed transports — the catalog over IPC and a built-in local worker
// (the embedded core) pre-added. That single difference (a local worker, and no
// URLs to configure) is the whole difference from the web app.
export function App() {
  const backend = useTauriBackend();
  const workers = useTauriWorkers();

  return (
    <BackendProvider value={backend}>
      <WorkersProvider value={workers}>
        {/* Above the data source so a launched run's refresh signal reaches it. */}
        <RunsRuntimeProvider>
          <DesktopGallery />
        </RunsRuntimeProvider>
      </WorkersProvider>
    </BackendProvider>
  );
}

function DesktopGallery() {
  const data = useLiveGallery();
  return (
    <GalleryDataProvider value={data}>
      <BrowserRouter>
        <GalleryApp />
      </BrowserRouter>
    </GalleryDataProvider>
  );
}
