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
import { useDesktopConnections } from "./state/useConnections";

// The desktop app: the same shared gallery app the web console renders, talking
// to the same backend over the same HTTP API. The only differences from the web
// host are that the shell resolves the backend/auth URLs from its environment
// (rather than a stored URL) and that the adversarial arena runs in-process in the
// embedded core (the web console drives a remote arena service over HTTP). So runs
// enqueue + stream over HTTP exactly like the web console, while matches and
// tournaments stay local via Tauri IPC.
export function App() {
  const { backend, workers } = useDesktopConnections();

  return (
    <BackendProvider value={backend}>
      <WorkersProvider value={workers}>
        {/* Auth lives below the workers provider — register/login go through the
            execution transport (the backend + auth service over HTTP) — and above
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
  // The embedded local core always exposes the arena over IPC (matches and
  // tournaments run in process); it is a constant capability, so build it once.
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
