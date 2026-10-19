import type {
  BackendClient,
  BackendContextValue,
  BackendIdentity,
  BackendStatus,
  WorkerHandle,
  WorkersContextValue,
} from "@clockwyrks/ui/client";
import {
  ARTIFACTS_PATH,
  BACKEND_PATH,
  createBackendExec,
  createHttpBackend,
} from "@clockwyrks/ui/transport";
import { useEffect, useMemo, useState } from "react";

/** One answer to a backend's identity probe, and the client it came from. */
interface Probe {
  readonly client: BackendClient;
  readonly identity: BackendIdentity | null;
  readonly status: "ready" | "error";
  readonly error: string | null;
}

// The active backend: `/api` of the origin the console is served from
// (`BACKEND_PATH`). The console names no service URL, so there is nothing to
// configure, store or switch: the edge routes the path to the environment's
// backend, and the Vite dev server proxies it to the forwarded local one
// (components/web/overview.md, "Configuration"). It is the source of truth for
// the catalog and published data (the `BackendClient`) and the control plane
// for executing runs (see {@link useExecConnection}). Probes `/healthz` to
// confirm reachability and learn the backend's identity.
export function useBackendConnection(): BackendContextValue {
  const url = BACKEND_PATH;
  // What the last probe answered, kept with the client it probed, so the state
  // is derived from which client the answer is for.
  const [probe, setProbe] = useState<Probe | null>(null);

  // One client instance, stable across renders.
  const client = useMemo<BackendClient>(() => createHttpBackend(url), [url]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const identity = await client.identity();
        if (!controller.signal.aborted)
          setProbe({ client, identity, status: "ready", error: null });
      } catch (error_: unknown) {
        if (!controller.signal.aborted) {
          setProbe({
            client,
            identity: null,
            status: "error",
            error: String(error_),
          });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [client]);

  const current = probe?.client === client ? probe : null;
  const status: BackendStatus = current?.status ?? "connecting";
  const identity = current?.identity ?? null;
  const error = current?.error ?? null;

  return { client, identity, status, error, url };
}

// The run-execution connection. There is no longer a separate worker the console
// registers or talks to — a run is enqueued on the backend's `/jobs` queue, a
// driver pod runs it, and progress streams back through the backend. So this
// resolves to a *single* execution handle bound to the active backend, presented
// through the shared `WorkersContextValue` the gallery already reads (one
// non-removable entry, no list, no per-pod registration, no `tcab.web.workers`
// storage). Add/remove are absent — there is nothing to add.
//
// A pre-publish run's build and media live behind the separate artifacts service,
// served at `/artifacts` of the console's own origin (`ARTIFACTS_PATH`), so the
// execution client resolves those root-relative links against that path.
export function useExecConnection(
  backendUrl: string | null,
): WorkersContextValue {
  const worker = useMemo<WorkerHandle | null>(
    () =>
      backendUrl
        ? {
            id: "backend",
            label: "Backend",
            url: backendUrl,
            client: createBackendExec(backendUrl, ARTIFACTS_PATH),
            identity: { url: backendUrl, version: null, backendId: backendUrl },
            // The execution path *is* the backend, so it trivially matches it.
            backendMatch: "match",
          }
        : null,
    [backendUrl],
  );

  const workers = useMemo(() => (worker ? [worker] : []), [worker]);

  return {
    workers,
    activeId: worker?.id ?? null,
    active: worker,
    // There is a single, fixed execution target now; switching/adding/removing a
    // worker no longer exists, so these are no-ops.
    setActive: () => {
      // The one target is always the active one.
    },
    addWorker: () => {
      // There is nothing to add.
    },
    removeWorker: () => {
      // The one target cannot be removed.
    },
  };
}
