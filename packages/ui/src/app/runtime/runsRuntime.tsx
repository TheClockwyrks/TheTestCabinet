import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { InProgressRun } from "../data/galleryContext";

// Session-scoped state for runs the user launches and watches. A run only gains
// a RunRecord at completion, so a freshly launched run lives here — surfaced
// ahead of the completed runs on the Runs page and driven by the live monitor —
// until it finishes and the data source picks it up as a produced run. `track`
// records a launch, `update` reflects state changes, `remove` clears it once the
// completed run appears, and `requestRefresh` nudges the data source to re-read
// the worker's produced runs.
export interface RunsRuntime {
  inProgress: InProgressRun[];
  /** Bumped to ask the data source to re-fetch produced runs. */
  refreshToken: number;
  track(run: InProgressRun): void;
  update(runId: string, patch: Partial<InProgressRun>): void;
  remove(runId: string): void;
  requestRefresh(): void;
}

const noop = () => {};

// Default no-op runtime, so components (e.g. the Runs page) can read it even on
// the static site where no provider is mounted. There, `inProgress` is always
// empty and `canExecute` is false, so nothing drives it.
const DEFAULT: RunsRuntime = {
  inProgress: [],
  refreshToken: 0,
  track: noop,
  update: noop,
  remove: noop,
  requestRefresh: noop,
};

const RunsRuntimeContext = createContext<RunsRuntime>(DEFAULT);

export function RunsRuntimeProvider({ children }: { children: ReactNode }) {
  const [inProgress, setInProgress] = useState<InProgressRun[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  const track = useCallback((run: InProgressRun) => {
    setInProgress((prev) => [
      run,
      ...prev.filter((r) => r.runId !== run.runId),
    ]);
  }, []);
  const update = useCallback((runId: string, patch: Partial<InProgressRun>) => {
    setInProgress((prev) =>
      prev.map((r) => (r.runId === runId ? { ...r, ...patch } : r)),
    );
  }, []);
  const remove = useCallback((runId: string) => {
    setInProgress((prev) =>
      // Returning the same array when the run is not in the list keeps this a true
      // no-op. A finished run is now announced twice — once as a run-lifecycle
      // event and once as a completion notification — and without this the second
      // one would hand React a fresh array identity and re-render every consumer
      // of the list for nothing.
      prev.some((r) => r.runId === runId)
        ? prev.filter((r) => r.runId !== runId)
        : prev,
    );
  }, []);
  const requestRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  const value = useMemo<RunsRuntime>(
    () => ({ inProgress, refreshToken, track, update, remove, requestRefresh }),
    [inProgress, refreshToken, track, update, remove, requestRefresh],
  );
  return (
    <RunsRuntimeContext.Provider value={value}>
      {children}
    </RunsRuntimeContext.Provider>
  );
}

export function useRunsRuntime(): RunsRuntime {
  return useContext(RunsRuntimeContext);
}
