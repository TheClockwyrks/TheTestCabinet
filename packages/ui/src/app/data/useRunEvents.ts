import { useEffect, useState } from "react";
import type { RunEventStreams } from "../../client/types";
import { useGalleryData } from "./galleryContext";

// The async state of a run's recorded events, for the Events tab. `unsupported`
// covers a host that can't provide events for the run at all (e.g. a Tauri
// published run, or a host with no fetcher) — distinct from a `ready` result
// whose `events` array is empty, which means the run simply recorded none.
export type RunEventsState =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "error"; message: string }
  | { status: "ready"; data: RunEventStreams };

// Resolve a run's recorded event streams through the host's `fetchRunEvents`,
// tracking loading/error/unsupported. Re-fetches when the run id or the host's
// fetcher changes. The fetcher is stable per host (memoized), so this does not
// loop.
export function useRunEvents(runId: string): RunEventsState {
  const { fetchRunEvents } = useGalleryData();
  const [state, setState] = useState<RunEventsState>(
    fetchRunEvents ? { status: "loading" } : { status: "unsupported" },
  );

  useEffect(() => {
    if (!fetchRunEvents) {
      setState({ status: "unsupported" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    fetchRunEvents(runId)
      .then((data) => {
        if (!active) return;
        setState(
          data ? { status: "ready", data } : { status: "unsupported" },
        );
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
