import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../client/auth";
import { useOptionalBackend } from "../../client/context";
import type {
  ModelProbe,
  ModelProbeDetail,
  ModelProbeProviders,
  ModelProbeTriggerInput,
} from "../../client/types";
import { useGalleryData } from "./galleryContext";

// How often a running probe is re-read. A probe takes tens of seconds (a few
// dozen completion calls), so a couple of seconds keeps the page live without
// hammering the backend — the same cadence the kill-await poll uses.
export const PROBE_POLL_MS = 2000;

// The async state of a model's probe history. `unavailable` covers a host with
// no backend client at all (the static site) — distinct from a `ready` result
// with no probes, which means none have been run.
export type ModelProbesState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; probes: ModelProbe[] };

/**
 * The model's probe history (`GET /models/{slug}/probes`), newest first, kept
 * live: while any listed probe is still `running` the list is re-read every
 * {@link PROBE_POLL_MS} until every row is terminal. `prepend` puts a
 * just-triggered probe at the head immediately, so the operator sees their row
 * without waiting a poll tick.
 *
 * Callers should remount the hook per model (key the consuming component by the
 * slug) rather than expect it to reset itself on a slug change.
 */
export function useModelProbes(slug: string): {
  state: ModelProbesState;
  prepend: (probe: ModelProbe) => void;
} {
  const client = useOptionalBackend()?.client ?? null;
  const [state, setState] = useState<ModelProbesState>(
    client ? { status: "loading" } : { status: "unavailable" },
  );
  // Bumped to re-read the list; the fetch effect depends on it.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!client) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    client
      .listModelProbes(slug)
      .then((probes) => {
        if (active) setState({ status: "ready", probes });
      })
      .catch((e) => {
        if (!active) return;
        // A failed poll re-read keeps the last good list rather than replacing
        // it with an error page; only the initial load surfaces the failure.
        setState((prev) =>
          prev.status === "ready"
            ? prev
            : { status: "error", message: errorMessage(e) },
        );
      });
    return () => {
      active = false;
    };
  }, [client, slug, epoch]);

  const anyRunning =
    state.status === "ready" &&
    state.probes.some((probe) => probe.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setTimeout(() => setEpoch((e) => e + 1), PROBE_POLL_MS);
    return () => clearTimeout(timer);
  }, [anyRunning, epoch]);

  const prepend = useCallback((probe: ModelProbe) => {
    setState((prev) =>
      prev.status === "ready"
        ? { status: "ready", probes: [probe, ...prev.probes] }
        : { status: "ready", probes: [probe] },
    );
  }, []);

  return { state, prepend };
}

// The async state of one probe's detail. `idle` means no probe is selected
// (nothing to show, not a failure).
export type ModelProbeDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ModelProbeDetail };

/**
 * One probe's full detail (`GET /model-probes/{id}`): the probe, its items with
 * the raw replies, and the request as sent. While the probe is still `running`
 * the detail is re-read every {@link PROBE_POLL_MS}, so items appear as the
 * matrix progresses and the verdict lands without a manual refresh.
 */
export function useModelProbeDetail(id: string | null): ModelProbeDetailState {
  const client = useOptionalBackend()?.client ?? null;
  const [state, setState] = useState<ModelProbeDetailState>({ status: "idle" });
  const [epoch, setEpoch] = useState(0);
  // Which id the current state belongs to, so switching probes shows a loading
  // state instead of the previous probe's detail, while a poll re-read of the
  // same probe keeps the settled view up (no flash back to loading).
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!client || !id) {
      lastId.current = null;
      setState({ status: "idle" });
      return;
    }
    let active = true;
    if (lastId.current !== id) {
      lastId.current = id;
      setState({ status: "loading" });
    }
    client
      .getModelProbe(id)
      .then((detail) => {
        if (active && detail.probe.id === id)
          setState({ status: "ready", detail });
      })
      .catch((e) => {
        if (!active) return;
        setState((prev) =>
          prev.status === "ready" && prev.detail.probe.id === id
            ? prev
            : { status: "error", message: errorMessage(e) },
        );
      });
    return () => {
      active = false;
    };
  }, [client, id, epoch]);

  const running =
    state.status === "ready" && state.detail.probe.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setEpoch((e) => e + 1), PROBE_POLL_MS);
    return () => clearTimeout(timer);
  }, [running, epoch]);

  return state;
}

// The probe-trigger capability, bound to the active backend client and the
// signed-in token — the shape `useModelConfig` established, kept as its own
// hook so the probe surface never widens the model-config gate.
export interface ModelProbeActions {
  /** Trigger a probe of the model; resolves to the row, already running. */
  trigger(slug: string, input: ModelProbeTriggerInput): Promise<ModelProbe>;
  /** The providers OpenRouter lists for the model, to pin a probe to one. */
  listProviders(slug: string): Promise<ModelProbeProviders>;
}

/**
 * The probe-trigger capability, or `null` when triggering probes is not
 * possible here (a read-only host, a transport without the trigger, or a
 * logged-out session — the caller shows a sign-in notice for that last case).
 */
export function useModelProbeActions(): ModelProbeActions | null {
  const { canExecute } = useGalleryData();
  const client = useOptionalBackend()?.client ?? null;
  const { token } = useAuth();

  return useMemo<ModelProbeActions | null>(() => {
    if (
      !canExecute ||
      !token ||
      !client?.triggerModelProbe ||
      !client.listModelProbeProviders
    ) {
      return null;
    }
    const { triggerModelProbe, listModelProbeProviders } = client;
    return {
      trigger: (slug, input) => triggerModelProbe(slug, input, token),
      listProviders: (slug) => listModelProbeProviders(slug, token),
    };
  }, [canExecute, client, token]);
}

// A thrown fetch failure as display text: the Error's message (the transport
// already folds the backend's `{ error: { message } }` envelope into it),
// without the "Error: " prefix `String(e)` would add.
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
