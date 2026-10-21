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
} from "@clockwyrks/ui/client";
import {
  ARENA_PATH,
  BACKEND_PATH,
  createHttpArena,
} from "@clockwyrks/ui/transport";
import { useMemo, useState } from "react";
import { RouterProvider, createBrowserRouter } from "react-router";

import {
  useBackendConnection,
  useExecConnection,
} from "./state/use-connections";

// The web console: the full shared gallery app (from @clockwyrks/ui) rendered
// against live data. It names no service URL: every service is a path of the
// origin it is served from (`/api`, `/artifacts`, `/arena`). The backend at
// `/api` serves the catalog and published runs and executes runs through its
// `/jobs` queue. That run-execution capability is the only difference from the
// static site.
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
  // the console's own origin, as the backend is at `/api` of it.
  const arena = useMemo(() => createHttpArena(BACKEND_PATH, ARENA_PATH), []);
  const data = useLiveGallery(arena);
  // A data router, because only a data router can hold a navigation: a form with unsaved
  // work asks before any link, back control or history step takes the operator away from
  // it. The gallery declares its own routes beneath the one catch-all route here. Built
  // when the gallery mounts rather than when the module loads, so it starts from the
  // address the page is at by then.
  const [router] = useState(() =>
    createBrowserRouter([{ path: "*", element: <GalleryApp /> }]),
  );
  return (
    <GalleryDataProvider value={data}>
      <RouterProvider router={router} />
    </GalleryDataProvider>
  );
}
