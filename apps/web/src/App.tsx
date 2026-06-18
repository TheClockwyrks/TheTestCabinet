import { BackendProvider, WorkersProvider } from "@test-cabinet/ui/client";
import { Console } from "@test-cabinet/ui/console";
import {
  useBackendConnection,
  useWorkerConnections,
} from "./state/useConnections";

// The web console: the shared runner/reporter console (from @test-cabinet/ui)
// wired to HTTP transports. It starts with no workers — the user adds worker
// servers in the Connections tab — and points at a backend for the catalog and
// published data. The Tauri app (a later item) mounts the same <Console> with
// its own transport and a built-in local worker pre-added; that single
// difference is the whole difference between the two apps.
export function App() {
  const backend = useBackendConnection();
  const workers = useWorkerConnections(backend.identity);

  return (
    <BackendProvider value={backend}>
      <WorkersProvider value={workers}>
        <Console />
      </WorkersProvider>
    </BackendProvider>
  );
}
