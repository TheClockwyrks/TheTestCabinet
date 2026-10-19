import {
  GalleryApp,
  GalleryDataProvider,
  RunsRuntimeProvider,
  useLiveGallery,
} from "@clockwyrks/ui/app";
import {
  BackendProvider,
  IdentityProvider,
  WorkersProvider,
  fetchEdgeIdentity,
  useBackend,
} from "@clockwyrks/ui/client";
import { ARENA_PATH, createHttpArena } from "@clockwyrks/ui/transport";
import { useMemo } from "react";
import { BrowserRouter } from "react-router";

import {
  useBackendConnection,
  useExecConnection,
} from "./state/use-connections";

// The web console: the full shared gallery app (from @clockwyrks/ui) rendered
// against live data. It talks to a single backend URL — for the catalog and
// published runs, and (since the per-run-Job refactor) for executing runs via the
// backend's `/jobs` queue. That run-execution capability is the only difference
// from the static site.
export function App() {
  const backend = useBackendConnection();
  // The execution target is the same backend; presented through the shared
  // workers context as a single, fixed handle (no worker list to manage).
  const workers = useExecConnection(backend.url);

  return (
    <BackendProvider value={backend}>
      <WorkersProvider value={workers}>
        {/* The identity the edge signed the reader in as, so the review UI can
            recognise the reader's own review. It gates nothing: the services
            decide from the assertion the edge adds to every request. */}
        <IdentityProvider resolve={fetchEdgeIdentity}>
          {/* Above the data source so a launched run's refresh signal reaches it. */}
          <RunsRuntimeProvider>
            <WebGallery />
          </RunsRuntimeProvider>
        </IdentityProvider>
      </WorkersProvider>
    </BackendProvider>
  );
}

function WebGallery() {
  // The arena reads persisted tournaments from the backend but runs matches and
  // tournaments against the dedicated `tcab-arena` service, served at `/arena` of
  // the console's own origin. The handle is rebuilt when the backend changes so it
  // always targets the current connection.
  const { url: backendUrl } = useBackend();
  const arena = useMemo(
    () => (backendUrl ? createHttpArena(backendUrl, ARENA_PATH) : undefined),
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
