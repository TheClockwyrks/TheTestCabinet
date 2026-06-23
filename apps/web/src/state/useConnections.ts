import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "../transport/httpBackend";

const BACKEND_KEY = "tcab.web.backendUrl";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// The active backend: the single URL the console talks to. It is the source of
// truth for the catalog and published data (the `BackendClient`), and — since the
// per-run-Job refactor — the control plane for executing runs too (see
// {@link useExecConnection}). Probes `/healthz` to confirm reachability and learn
// the backend's identity. Switchable for staging vs prod.
export function useBackendConnection(): BackendContextValue {
  const [url, setUrlState] = useState<string | null>(
    () =>
      readStored<string>(BACKEND_KEY, import.meta.env.VITE_BACKEND_URL ?? "") ||
      null,
  );
  const [identity, setIdentity] = useState<BackendIdentity | null>(null);
  const [status, setStatus] = useState<BackendStatus>("unconfigured");
  const [error, setError] = useState<string | null>(null);

  // One client instance per URL, stable across renders.
  const client = useMemo<BackendClient | null>(
    () => (url ? createHttpBackend(url) : null),
    [url],
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

  const setUrl = useCallback((next: string) => {
    const trimmed = next.trim();
    localStorage.setItem(BACKEND_KEY, JSON.stringify(trimmed));
    setUrlState(trimmed || null);
  }, []);

  return { client, identity, status, error, url, setUrl };
}

// The run-execution connection. There is no longer a separate worker the console
// registers or talks to — a run is enqueued on the backend's `/jobs` queue, a
// driver pod runs it, and progress streams back through the backend. So this
// resolves to a *single* execution handle bound to the active backend, presented
// through the shared `WorkersContextValue` the gallery already reads (one
// non-removable entry, no list, no per-pod registration, no `tcab.web.workers`
// storage). Add/remove are absent — there is nothing to add.
//
// A pre-publish run's build and media live behind the separate artifact service,
// whose base URL the backend reports at `GET /config`. We fetch it once per
// backend so the execution client can resolve those root-relative links; it is
// `null` (links left unresolved) until the fetch resolves or when no artifact
// service is configured.
export function useExecConnection(
  backendUrl: string | null,
): WorkersContextValue {
  const authUrl = backendUrl
    ? (import.meta.env.VITE_AUTH_URL ?? backendUrl)
    : null;
  const [artifactsUrl, setArtifactsUrl] = useState<string | null>(null);

  // Resolve the artifact service's base URL from the backend's `/config` whenever
  // the backend changes. Best-effort — an unreachable backend leaves it null, so
  // pre-publish links stay unresolved (today's behavior).
  useEffect(() => {
    setArtifactsUrl(null);
    if (!backendUrl) return;
    let active = true;
    fetchArtifactsUrl(backendUrl)
      .then((u) => active && setArtifactsUrl(u))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [backendUrl]);

  const worker = useMemo<WorkerHandle | null>(() => {
    if (!backendUrl || !authUrl) return null;
    return {
      id: "backend",
      label: "Backend",
      url: backendUrl,
      // Not the desktop's in-process local core — this drives runs over HTTP — so
      // the editor offers the split push/review/publish web flow (push is a no-op
      // here; the driver already pushed the record).
      local: false,
      client: createBackendExec(backendUrl, authUrl, artifactsUrl),
      identity: { url: backendUrl, version: null, backendId: backendUrl },
      // The execution path *is* the backend, so it trivially matches it.
      backendMatch: "match",
    };
    // Rebuild when the backend, auth URL, or resolved artifacts URL changes.
  }, [backendUrl, authUrl, artifactsUrl]);

  const workers = useMemo(() => (worker ? [worker] : []), [worker]);

  return {
    workers,
    activeId: worker?.id ?? null,
    active: worker,
    // There is a single, fixed execution target now; switching/adding/removing a
    // worker no longer exists, so these are no-ops.
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  };
}
