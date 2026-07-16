import { createContext, useContext, type ReactNode } from "react";
import type { BackendClient, WorkerClient } from "./clients";
import type { BackendIdentity, BackendMatch, WorkerIdentity } from "./types";

// The console reads two contexts: the active backend (catalog + published data)
// and the worker set (execution). Each app builds the context value with its own
// transport and state — web with HTTP clients and localStorage, tauri with
// invoke-backed clients and a built-in local worker — and the console renders
// against the interfaces alone.

// --- Backend ---

export type BackendStatus = "unconfigured" | "connecting" | "ready" | "error";

export interface BackendContextValue {
  /** The active backend client, or null when none is configured/reachable. */
  client: BackendClient | null;
  /** The active backend's identity once probed. */
  identity: BackendIdentity | null;
  status: BackendStatus;
  error: string | null;
  /** The configured backend URL (may be set but not yet reachable). */
  url: string | null;
  /** Point the UI at a different backend instance (e.g. staging vs prod). */
  setUrl: (url: string) => void;
}

const BackendContext = createContext<BackendContextValue | null>(null);

export function BackendProvider({
  value,
  children,
}: {
  value: BackendContextValue;
  children: ReactNode;
}) {
  return (
    <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
  );
}

export function useBackend(): BackendContextValue {
  const ctx = useContext(BackendContext);
  if (!ctx) {
    throw new Error("useBackend must be used within a <BackendProvider>");
  }
  return ctx;
}

// The backend context if one is mounted, else null — for components that render
// on both the consoles and the static site (which mounts no `BackendProvider`)
// and must degrade gracefully rather than throw. Console-only components should
// use {@link useBackend}, which asserts the provider is present.
export function useOptionalBackend(): BackendContextValue | null {
  return useContext(BackendContext);
}

// --- Workers ---

// One configured worker plus the derived state the console renders: its probed
// identity and whether it is bound to the active backend.
export interface WorkerHandle {
  /** Stable id (the local worker uses the reserved id "local"). */
  id: string;
  /** Display label. */
  label: string;
  /** The worker's base URL, or null for the built-in local (Tauri) worker. */
  url: string | null;
  /** True for the Tauri built-in local worker, which can't be removed. */
  local: boolean;
  client: WorkerClient;
  identity: WorkerIdentity | null;
  /** Whether this worker shares the active backend. */
  backendMatch: BackendMatch;
}

export interface AddWorkerInput {
  url: string;
  label?: string;
}

export interface WorkersContextValue {
  workers: WorkerHandle[];
  activeId: string | null;
  active: WorkerHandle | null;
  setActive: (id: string) => void;
  addWorker: (input: AddWorkerInput) => void;
  removeWorker: (id: string) => void;
}

const WorkersContext = createContext<WorkersContextValue | null>(null);

export function WorkersProvider({
  value,
  children,
}: {
  value: WorkersContextValue;
  children: ReactNode;
}) {
  return (
    <WorkersContext.Provider value={value}>{children}</WorkersContext.Provider>
  );
}

export function useWorkers(): WorkersContextValue {
  const ctx = useContext(WorkersContext);
  if (!ctx) {
    throw new Error("useWorkers must be used within a <WorkersProvider>");
  }
  return ctx;
}

// The workers context if one is mounted, else null — for components that render
// on both the consoles and the static site (which mounts no `WorkersProvider`)
// and must degrade gracefully rather than throw. Console-only components should
// use {@link useWorkers}, which asserts the provider is present.
export function useOptionalWorkers(): WorkersContextValue | null {
  return useContext(WorkersContext);
}
