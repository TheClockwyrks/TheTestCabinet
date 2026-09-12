import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../client/auth";
import type { WorkerClient } from "../../../client/clients";
import {
  WorkersProvider,
  type WorkersContextValue,
} from "../../../client/context";
import type { InProgressRun } from "../../../client/types";
import { ConfirmDialogProvider } from "../../components/ConfirmDialog";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { RunsRuntimeProvider, useRunsRuntime } from "../../runtime/runsRuntime";
import { StopRunsControls } from "./StopRunsControls";

// The toast container is app chrome; the sweeps' report is not what these cover.
vi.mock("../../components/MessageToast", () => ({ showToast: () => {} }));

function inFlight(runId: string, state: InProgressRun["state"]): InProgressRun {
  return {
    runId,
    testCaseSlug: "carom",
    testCaseVersion: "1.0.0",
    variant: "base",
    harnessSlug: "gg",
    modelId: "anthropic/claude",
    engine: null,
    ggPreset: null,
    startedAt: "2026-01-01T00:00:00Z",
    state,
  } as unknown as InProgressRun;
}

// Seeds the runtime's in-flight list, and reports how many produced-run refreshes
// the runtime has been asked for — the signal the whole deferred path exists to
// deliver.
function Harness({ runs }: { runs: InProgressRun[] }) {
  const runtime = useRunsRuntime();
  const seeded = runtime.inProgress.length > 0;
  return (
    <>
      {!seeded && (
        <button type="button" onClick={() => runs.forEach(runtime.track)}>
          seed
        </button>
      )}
      <span data-testid="refreshes">{runtime.refreshToken}</span>
      <StopRunsControls />
    </>
  );
}

function mount(runs: InProgressRun[], landAfter: number) {
  localStorage.setItem(
    "tcab.auth",
    JSON.stringify({ token: "tok", account: { username: "zach" } }),
  );
  let reads = 0;
  const getRun = vi.fn(async (runId: string) => {
    reads += 1;
    return { runId, record: reads >= landAfter ? { id: runId } : null };
  });
  const cancelActive = vi.fn(async () => ({
    canceled: runs.length,
    includedWaiting: false,
    includedActive: true,
  }));
  const client = {
    getRun,
    cancelWaitingRuns: async () => ({
      canceled: 0,
      includedWaiting: true,
      includedActive: false,
    }),
    cancelActiveRuns: cancelActive,
    cancelAllRuns: async () => ({
      canceled: 0,
      includedWaiting: true,
      includedActive: true,
    }),
  } as unknown as WorkerClient;
  const workers = {
    workers: [],
    activeId: "w1",
    active: { id: "w1", label: "w1", url: null, local: true, client },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
  const gallery = {
    producedSummaries: [],
    localIds: new Set<string>(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
  const wrapper = (children: ReactNode) => (
    <WorkersProvider value={workers}>
      <AuthProvider>
        <ConfirmDialogProvider>
          <RunsRuntimeProvider>
            <GalleryDataProvider value={gallery}>
              {children}
            </GalleryDataProvider>
          </RunsRuntimeProvider>
        </ConfirmDialogProvider>
      </AuthProvider>
    </WorkersProvider>
  );
  render(wrapper(<Harness runs={runs} />));
  fireEvent.click(screen.getByRole("button", { name: "seed" }));
  return { getRun, cancelActive };
}

function refreshes(): number {
  return Number(screen.getByTestId("refreshes").textContent);
}

describe("StopRunsControls", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  // The cleanest reproduction of the reported bug: these three buttons called the
  // bulk cancel transports directly, so the ONLY refresh they fired was the one at
  // cancel time — which is always too early, because a canceled run's record does
  // not exist until its driver has stopped the harness and posted it back. The
  // worklist that decides which runs the console offers to delete therefore never
  // learned about the run, for the rest of the session.
  it("watches the runs it swept until their records land, then refreshes again", async () => {
    const { cancelActive } = mount([inFlight("run-a", "running")], 3);

    fireEvent.click(screen.getByRole("button", { name: "Kill active" }));
    // The confirmation's affirmative carries the same label as the trigger, so
    // reach for it inside the dialog.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Kill active" }),
    );
    await waitFor(() => expect(cancelActive).toHaveBeenCalled());
    // The immediate refresh, which on its own is the whole of the old behaviour.
    await waitFor(() => expect(refreshes()).toBe(1));

    // The record lands a few polls later, and the worklist is re-read then.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(refreshes()).toBeGreaterThan(1));
  });

  // A run cancelled before it ever started has no driver and produces no record,
  // so watching it would poll until the budget expired for nothing.
  it("watches nothing for a sweep of runs that never started", async () => {
    const { getRun } = mount([inFlight("run-q", "queued")], 1);

    fireEvent.click(screen.getByRole("button", { name: "Clear pending" }));
    await waitFor(() => expect(refreshes()).toBe(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getRun).not.toHaveBeenCalled();
  });
});
