import { useEffect, useMemo, useState } from "react";
import type {
  BackendClient,
  BackendContextValue,
  BackendIdentity,
  BackendStatus,
  WorkerHandle,
  WorkersContextValue,
} from "@test-cabinet/ui/client";
import {
  createBackendExec,
  createHttpBackend,
  fetchArtifactsUrl,
} from "@test-cabinet/ui/transport";
import { authUrl, backendUrl } from "../api";

// The desktop console talks to a backend over the exact same HTTP API the web
// console uses: the backend serves the catalog and published data, owns the run
// queue (enqueue + live stream), and proxies the artifact service. The only
// difference from the web host is where the service URLs come from — the desktop
// shell resolves them from its environment (`TCAB_BACKEND_URL` / `TCAB_AUTH_URL`)
// and hands them to the webview over IPC, rather than the web console's stored
// URL — and that the local arena runs in-process (see App.tsx / tauriArena).
//
// The shell's URLs are fixed for the app's lifetime (set in its environment), so
// these connections are not switchable: there is nothing to add, remove, or
// reconfigure.

// Resolve the shell's configured service URLs once. `backend` is null until the
// IPC call resolves and stays null when the shell has no backend configured (the
// console then reads as unconfigured, exactly like the web console with no URL).
function useShellUrls(): { backend: string | null; auth: string | null } {
  const [urls, setUrls] = useState<{
    backend: string | null;
    auth: string | null;
  }>({ backend: null, auth: null });
  useEffect(() => {
    let active = true;
    Promise.all([backendUrl().catch(() => null), authUrl().catch(() => null)])
      .then(([backend, auth]) => {
        if (active) setUrls({ backend, auth });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return urls;
}

// The active backend: the single URL the console reads the catalog and published
// data from, and (since the per-run-Job refactor) enqueues runs against. Probes
// `/healthz` to confirm reachability and learn the backend's identity.
export function useBackendConnection(
  backendUrlValue: string | null,
): BackendContextValue {
  const [identity, setIdentity] = useState<BackendIdentity | null>(null);
  const [status, setStatus] = useState<BackendStatus>("unconfigured");
  const [error, setError] = useState<string | null>(null);

  const client = useMemo<BackendClient | null>(
    () => (backendUrlValue ? createHttpBackend(backendUrlValue) : null),
    [backendUrlValue],
  );

  useEffect(() => {
    if (!client) {
      setStatus("unconfigured");
      setIdentity(null);
      return;
    }
    let active = true;
    setStatus("connecting");
    setError(null);
    client
      .identity()
      .then((id) => {
        if (!active) return;
        setIdentity(id);
        setStatus("ready");
      })
      .catch((e) => {
        if (!active) return;
        setIdentity(null);
        setStatus("error");
        setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [client]);

  return {
    client,
    identity,
    status,
    error,
    url: backendUrlValue ?? "",
    // The shell owns the backend URL; the webview cannot reconfigure it.
    setUrl: () => {},
  };
}

// The run-execution connection. A run is enqueued on the backend's `/jobs` queue,
// a driver pod runs it, and progress streams back through the backend — there is
// no separate worker to register. Presented through the shared
// `WorkersContextValue` the gallery already reads as a single, fixed entry. A
// pre-publish run's build and media live behind the artifact service, whose base
// URL the backend reports at `GET /config`; resolve it once so the execution
// client can build those media links.
export function useExecConnection(
  backendUrlValue: string | null,
  authUrlValue: string | null,
): WorkersContextValue {
  const [artifactsUrl, setArtifactsUrl] = useState<string | null>(null);

  // Keep the in-flight `/config` promise, not just the value it lands on: a
  // consumer that snapshots the artifact URL into fetched data has to await it,
  // since re-rendering with the value later cannot correct what it already stored
  // (see `resolveBuild`).
  const artifactsSettled = useMemo(
    () =>
      backendUrlValue
        ? fetchArtifactsUrl(backendUrlValue)
        : Promise.resolve(null),
    [backendUrlValue],
  );

  useEffect(() => {
    setArtifactsUrl(null);
    let active = true;
    artifactsSettled.then((u) => active && setArtifactsUrl(u)).catch(() => {});
    return () => {
      active = false;
    };
  }, [artifactsSettled]);

  const worker = useMemo<WorkerHandle | null>(() => {
    if (!backendUrlValue) return null;
    // Register/login proxy to the auth service; fall back to the backend URL when
    // the shell reported no dedicated auth URL (a single-box dev setup).
    const auth = authUrlValue ?? backendUrlValue;
    return {
      id: "backend",
      label: "Backend",
      url: backendUrlValue,
      // Not the desktop's old in-process local core — this drives runs over HTTP,
      // exactly like the web console — so the editor offers the split
      // push/review/publish web flow (push is a no-op; the driver already pushed).
      local: false,
      client: createBackendExec(backendUrlValue, auth, {
        current: artifactsUrl,
        settled: artifactsSettled,
      }),
      identity: {
        url: backendUrlValue,
        version: null,
        backendId: backendUrlValue,
      },
      // The execution path *is* the backend, so it trivially matches it.
      backendMatch: "match",
    };
  }, [backendUrlValue, authUrlValue, artifactsUrl, artifactsSettled]);

  const workers = useMemo(() => (worker ? [worker] : []), [worker]);

  return {
    workers,
    activeId: worker?.id ?? null,
    active: worker,
    // A single, fixed execution target (the backend); nothing to switch or add.
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  };
}

// Bundle both connections, resolving the shell's URLs once and feeding them to
// each. Exposed as a single hook so App.tsx mounts them in lockstep.
export function useDesktopConnections(): {
  backend: BackendContextValue;
  workers: WorkersContextValue;
} {
  const urls = useShellUrls();
  const backend = useBackendConnection(urls.backend);
  const workers = useExecConnection(urls.backend, urls.auth);
  return { backend, workers };
}
