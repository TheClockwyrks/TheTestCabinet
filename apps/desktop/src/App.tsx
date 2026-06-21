import { useMemo } from "react";
import { BrowserRouter } from "react-router";
import {
  AuthProvider,
  BackendProvider,
  WorkersProvider,
} from "@test-cabinet/ui/client";
import {
  GalleryApp,
  GalleryDataProvider,
  RunsRuntimeProvider,
  useLiveGallery,
} from "@test-cabinet/ui/app";
import { createTauriArena } from "./transport/tauriArena";
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
        {/* Auth lives below the workers provider — register/login invoke the
            local core's commands through the active worker transport — and above
            the gallery so the review UI can read the signed-in account. */}
        <AuthProvider>
          {/* Above the data source so a launched run's refresh signal reaches it. */}
          <RunsRuntimeProvider>
            <DesktopGallery />
          </RunsRuntimeProvider>
        </AuthProvider>
      </WorkersProvider>
    </BackendProvider>
  );
}

function DesktopGallery() {
  // The local core always exposes the arena over IPC (matches/tournaments run in
  // process); it is a constant capability, so build it once.
  const arena = useMemo(() => createTauriArena(), []);
  const data = useLiveGallery(arena);
  return (
    <GalleryDataProvider value={data}>
      <BrowserRouter>
        <GalleryApp />
      </BrowserRouter>
    </GalleryDataProvider>
  );
}
