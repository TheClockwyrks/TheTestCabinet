import { useEffect, useState } from "react";
import type { LoadProgress, RunEventStreams } from "../../client/types";
import { useGalleryData } from "./galleryContext";

// The async state of a run's recorded events, for the Events tab. `unsupported`
// covers a host that can't provide events for the run at all (e.g. a Tauri
// published run, or a host with no fetcher) — distinct from a `ready` result
// whose `events` array is empty, which means the run simply recorded none. While
// `loading`, `progress` carries the latest transfer tick (`null` until the first
// one, or when the host can't observe the transfer) for the tab's progress bar.
export type RunEventsState =
  | { status: "loading"; progress: LoadProgress | null }
  | { status: "unsupported" }
  | { status: "error"; message: string }
  | { status: "ready"; data: RunEventStreams };

// Resolve a run's recorded event streams through the host's `fetchRunEvents`,
// tracking loading/error/unsupported and surfacing transfer progress.
//
// The read is keyed on the run id and on the fetcher's identity, and the
// identity is load-bearing in both directions. A host's fetcher is its
// transport: the console's `useLiveGallery` rebuilds it only when the backend or
// the worker connection changes (the produced worklist it consults is read
// through a ref), and the static site's never changes — so a run finishing and
// bumping the refresh token hands this hook the same fetcher, and a loaded feed
// stays loaded, keeping the reader's place in the virtualized list. A switched
// backend is a different run store whose copy of the events may be the only one,
// and it hands this hook a new fetcher, which restarts the read; that is also the
// only retry a read that settled as `error` or `unsupported` gets, so the
// identity must not be held constant across a transport change either.
export function useRunEvents(runId: string): RunEventsState {
  const { fetchRunEvents } = useGalleryData();
  const [state, setState] = useState<RunEventsState>(
    fetchRunEvents
      ? { status: "loading", progress: null }
      : { status: "unsupported" },
  );

  useEffect(() => {
    if (!fetchRunEvents) {
      setState({ status: "unsupported" });
      return;
    }
    let active = true;
    setState({ status: "loading", progress: null });
    fetchRunEvents(runId, (progress) => {
      // Ignore late ticks once the read has resolved or the run id changed.
      if (active) setState({ status: "loading", progress });
    })
      .then((data) => {
        if (!active) return;
        setState(data ? { status: "ready", data } : { status: "unsupported" });
      })
      .catch((e) => {
        if (active) setState({ status: "error", message: String(e) });
      });
    return () => {
      active = false;
    };
  }, [fetchRunEvents, runId]);

  return state;
}
