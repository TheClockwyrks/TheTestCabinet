import type {
  BackendClient,
  BackendContextValue,
  BackendIdentity,
  BackendStatus,
  WorkerHandle,
  WorkersContextValue,
} from "@clockwyrks/ui/client";
import {
  createBackendExec,
  createHttpBackend,
  fetchArtifactsUrl,
} from "@clockwyrks/ui/transport";
import { useCallback, useEffect, useMemo, useState } from "react";

const BACKEND_KEY = "tcab.web.backendUrl";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** One answer to a backend's identity probe, and the client it came from. */
interface Probe {
  readonly client: BackendClient;
  readonly identity: BackendIdentity | null;
  readonly status: "ready" | "error";
  readonly error: string | null;
}

// The active backend: the single URL the console talks to. It is the source of
// truth for the catalog and published data (the `BackendClient`), and — since the
// per-run-Job refactor — the control plane for executing runs too (see
// {@link useExecConnection}). Probes `/healthz` to confirm reachability and learn
// the backend's identity. Switchable for staging vs prod.
export function useBackendConnection(): BackendContextValue {
  const [url, setUrlState] = useState<string | null>(
    () =>
      // The user's localStorage override always wins (the settings UI lets an
      // operator point a deployment-served console at a local stack). Below it,
      // the deployment's runtime config (window.__TCAB_CONFIG__, injected into
      // /config.js at container start) is preferred over the build-time
      // VITE_BACKEND_URL — one tcab-web image serves every environment, so the
      // URL cannot be baked at build. Empty string ⇒ unconfigured (→ null).
      readStored<string>(
        BACKEND_KEY,
        globalThis.__TCAB_CONFIG__?.backendUrl ??
          import.meta.env.VITE_BACKEND_URL ??
          "",
      ) || null,
  );
  // What the last probe of a client answered, kept with the client it probed. A
  // probe that belongs to another client (the URL changed since) reads as
  // "connecting", so nothing has to be cleared when the URL changes: the state
  // is derived from which client the answer is for.
  const [probe, setProbe] = useState<Probe | null>(null);

  // One client instance per URL, stable across renders.
  const client = useMemo<BackendClient | null>(
    () => (url ? createHttpBackend(url) : null),
    [url],
  );

  useEffect(() => {
    if (!client) return;
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

  const current = client !== null && probe?.client === client ? probe : null;
  const status: BackendStatus =
    client === null ? "unconfigured" : (current?.status ?? "connecting");
  const identity = current?.identity ?? null;
  const error = current?.error ?? null;

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
  // Auth service URL: the deployment's runtime config (injected /config.js) is
  // preferred over the build-time VITE_AUTH_URL, then falls back to the backend
  // URL (the single-box dev setup where the backend also fronts auth).
  const authUrl = backendUrl
    ? (globalThis.__TCAB_CONFIG__?.authUrl ??
      import.meta.env.VITE_AUTH_URL ??
      backendUrl)
    : null;

  // Resolve the artifact service's base URL from the backend's `/config` whenever
  // the backend changes. Best-effort — an unreachable backend leaves it null, so
  // pre-publish links stay unresolved (today's behavior). The in-flight promise is
  // kept, not just the value it lands on: a consumer that snapshots the URL into
  // fetched data has to await it, since re-rendering with the value later cannot
  // correct what it already stored (see `resolveBuild`).
  const artifactsSettled = useMemo(
    () => (backendUrl ? fetchArtifactsUrl(backendUrl) : Promise.resolve(null)),
    [backendUrl],
  );

  // The resolved URL is kept with the promise it came from, so a backend switch
  // reads as "not resolved yet" until the new backend answers.
  const [resolved, setResolved] = useState<{
    readonly from: Promise<string | null>;
    readonly url: string | null;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      // Never rejects: an unreachable backend resolves null.
      const url = await artifactsSettled;
      if (!controller.signal.aborted)
        setResolved({ from: artifactsSettled, url });
    })();
    return () => {
      controller.abort();
    };
  }, [artifactsSettled]);
  const artifactsUrl =
    resolved?.from === artifactsSettled ? resolved.url : null;

  const worker = useMemo<WorkerHandle | null>(
    () =>
      backendUrl && authUrl
        ? {
            id: "backend",
            label: "Backend",
            url: backendUrl,
            client: createBackendExec(backendUrl, authUrl, {
              current: artifactsUrl,
              settled: artifactsSettled,
            }),
            identity: { url: backendUrl, version: null, backendId: backendUrl },
            // The execution path *is* the backend, so it trivially matches it.
            backendMatch: "match",
          }
        : null,
    // Rebuild when the backend, auth URL, or resolved artifacts URL changes.
    [backendUrl, authUrl, artifactsUrl, artifactsSettled],
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
