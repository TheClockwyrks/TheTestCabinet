import { useEffect, useMemo, useState } from "react";
import type {
  BackendContextValue,
  BackendIdentity,
  BackendStatus,
  WorkerHandle,
  WorkerIdentity,
  WorkersContextValue,
} from "@test-cabinet/ui/client";
import { createTauriBackend } from "../transport/tauriBackend";
import { createTauriWorker } from "../transport/tauriWorker";

// The desktop's connections are fixed: a single backend (the core's catalog,
// resolved over IPC) and one built-in local worker (the embedded core). Unlike
// the web app there is nothing to configure — no URLs, no add/remove — so these
// build constant context values, probing identity for display only.

export function useTauriBackend(): BackendContextValue {
  const client = useMemo(() => createTauriBackend(), []);
  const [identity, setIdentity] = useState<BackendIdentity | null>(null);
  const [status, setStatus] = useState<BackendStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .identity()
      .then((id) => {
        if (!active) return;
        setIdentity(id);
        setStatus("ready");
      })
      .catch((e) => {
        if (!active) return;
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
    url: identity?.url ?? "tauri://local",
    setUrl: () => {},
  };
}

export function useTauriWorkers(): WorkersContextValue {
  const client = useMemo(() => createTauriWorker(), []);
  const [identity, setIdentity] = useState<WorkerIdentity | null>(null);

  useEffect(() => {
    let active = true;
    client
      .identity()
      .then((id) => active && setIdentity(id))
      .catch(() => active && setIdentity(null));
    return () => {
      active = false;
    };
  }, [client]);

  const worker = useMemo<WorkerHandle>(
    () => ({
      id: "local",
      label: "Local core",
      url: null,
      local: true,
      client,
      identity,
      // The local core publishes to the same backend the catalog resolves from.
      backendMatch: "match",
    }),
    [client, identity],
  );

  return {
    workers: [worker],
    activeId: "local",
    active: worker,
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  };
}
