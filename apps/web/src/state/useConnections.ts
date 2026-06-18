import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AddWorkerInput,
  BackendClient,
  BackendContextValue,
  BackendIdentity,
  BackendStatus,
  BackendMatch,
  WorkerClient,
  WorkerHandle,
  WorkerIdentity,
  WorkersContextValue,
} from "@test-cabinet/ui/client";
import { createHttpBackend } from "../transport/httpBackend";
import { createHttpWorker } from "../transport/httpWorker";

const BACKEND_KEY = "tcab.web.backendUrl";
const WORKERS_KEY = "tcab.web.workers";

interface StoredWorker {
  id: string;
  label: string;
  url: string;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// The active backend: a single instance the console resolves the catalog and
// published data from, switchable for staging vs prod. Probes `/healthz` to
// confirm reachability and learn the backend's identity.
export function useBackendConnection(): BackendContextValue {
  const [url, setUrlState] = useState<string | null>(
    () => readStored<string>(BACKEND_KEY, import.meta.env.VITE_BACKEND_URL ?? "") || null,
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

// The set of workers (execution). Starts empty in the web app; the user adds
// worker servers by URL. Each worker is probed for its bound backend and checked
// against the active backend so the console never asks a worker for a test case
// it can't resolve.
export function useWorkerConnections(
  backendIdentity: BackendIdentity | null,
): WorkersContextValue {
  const [stored, setStored] = useState<StoredWorker[]>(() =>
    readStored<StoredWorker[]>(WORKERS_KEY, []),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => readStored<StoredWorker[]>(WORKERS_KEY, [])[0]?.id ?? null,
  );
  const [identities, setIdentities] = useState<
    Record<string, WorkerIdentity | null>
  >({});

  // Cache one client per worker id so handles and subscriptions stay stable.
  const clients = useRef(new Map<string, WorkerClient>());

  // Persist the stored list whenever it changes.
  useEffect(() => {
    localStorage.setItem(WORKERS_KEY, JSON.stringify(stored));
  }, [stored]);

  // (Re)build clients and probe each worker's identity when the list changes.
  useEffect(() => {
    const ids = new Set(stored.map((w) => w.id));
    for (const id of clients.current.keys()) {
      if (!ids.has(id)) clients.current.delete(id);
    }
    let active = true;
    for (const w of stored) {
      if (!clients.current.has(w.id)) {
        clients.current.set(w.id, createHttpWorker(w.url));
      }
      if (!(w.id in identities)) {
        clients.current
          .get(w.id)!
          .identity()
          .then((id) => active && setIdentities((m) => ({ ...m, [w.id]: id })))
          .catch(() => active && setIdentities((m) => ({ ...m, [w.id]: null })));
      }
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const matchFor = useCallback(
    (id: WorkerIdentity | null): BackendMatch => {
      if (!id || id.backendId == null) return "unverified";
      if (!backendIdentity) return "unverified";
      return id.backendId === backendIdentity.id ? "match" : "mismatch";
    },
    [backendIdentity],
  );

  const workers = useMemo<WorkerHandle[]>(
    () =>
      stored.map((w) => {
        const identity = identities[w.id] ?? null;
        return {
          id: w.id,
          label: w.label || w.url,
          url: w.url,
          local: false,
          client: clients.current.get(w.id) ?? createHttpWorker(w.url),
          identity,
          backendMatch: matchFor(identity),
        };
      }),
    [stored, identities, matchFor],
  );

  const active = workers.find((w) => w.id === activeId) ?? workers[0] ?? null;

  const addWorker = useCallback((input: AddWorkerInput) => {
    const id = crypto.randomUUID();
    setStored((prev) => [
      ...prev,
      { id, label: input.label ?? "", url: input.url },
    ]);
    setActiveId((prev) => prev ?? id);
  }, []);

  const removeWorker = useCallback((id: string) => {
    setStored((prev) => prev.filter((w) => w.id !== id));
    setIdentities((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  const setActive = useCallback((id: string) => setActiveId(id), []);

  return {
    workers,
    activeId: active?.id ?? null,
    active,
    setActive,
    addWorker,
    removeWorker,
  };
}
