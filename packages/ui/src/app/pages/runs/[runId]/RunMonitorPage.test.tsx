import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { WorkersProvider } from "../../../../client/context";
import type { WorkersContextValue } from "../../../../client/context";
import type { WorkerClient } from "../../../../client/clients";
import type {
  AssetPreview,
  HarnessEvent,
  RunOutcome,
} from "../../../../client/types";
import { RunsRuntimeProvider } from "../../../runtime/runsRuntime";
import { RunMonitorPage } from "./RunMonitorPage";

// The page's app chrome reads contexts (gallery data, backdrop settings) that
// are irrelevant to run monitoring. Stub it so the test exercises only the
// subscription/state logic where the bug lives.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// The monitor resolves the run's case from the gallery data to decide whether to
// show the asset view; these tests don't exercise that, so stub the hook with an
// empty catalog rather than standing up a whole GalleryDataProvider.
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => ({ testCases: [] }),
}));

const RUN_ID = "run-123";

type Handlers = Parameters<WorkerClient["subscribeToRun"]>[1];

function event(fields: Partial<HarnessEvent> & { type: string }): HarnessEvent {
  return { timestamp: "2026-06-18T00:00:00Z", ...fields };
}

function preview(
  frame: number,
  operationCount: number,
  operation?: string,
): AssetPreview {
  // A short stand-in for the base64 PNG; the view only embeds it as a data URL.
  return { frame, operationCount, operation, image: "AAAA" };
}

const completed: RunOutcome = {
  kind: "completed",
  // The page only reads id / status.state / validation.loaded off the record.
  record: {
    id: RUN_ID,
    status: { state: "passed" },
    validation: { loaded: true },
  } as unknown as RunRecord,
};

// Build a workers context whose active worker drives `subscribeToRun` from the
// supplied delivery function, counting how many times it is subscribed. Delivery
// runs on a macrotask (as a real streaming transport would), so a regression
// that re-subscribes in a loop surfaces as a rising call count rather than a
// synchronous hang.
function makeWorkers(deliver: (handlers: Handlers) => void) {
  const subscribeToRun = vi.fn((_runId: string, handlers: Handlers) => {
    setTimeout(() => deliver(handlers), 0);
    return () => {};
  });
  const client = { subscribeToRun } as unknown as WorkerClient;
  const value = {
    workers: [],
    activeId: "w1",
    active: { id: "w1", label: "Worker", url: null, local: true, client, identity: null, backendMatch: "unknown" },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
  return { value, subscribeToRun };
}

// Let pending macrotasks (deliveries, and any erroneous re-subscribe loop) drain
// so assertions see the steady state.
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function renderMonitor(workers: WorkersContextValue) {
  return render(
    <MemoryRouter initialEntries={[`/runs/${RUN_ID}/live`]}>
      <WorkersProvider value={workers}>
        <RunsRuntimeProvider>
          <Routes>
            <Route path="/runs/:runId/live" element={<RunMonitorPage />} />
          </Routes>
        </RunsRuntimeProvider>
      </WorkersProvider>
    </MemoryRouter>,
  );
}

describe("RunMonitorPage", () => {
  it("settles on the completion notice and subscribes exactly once when a run finishes", async () => {
    // Replay two events then complete. The completion handler mutates the runs
    // runtime (remove + requestRefresh), which recreates the runtime object. The
    // monitor effect must NOT treat that as a reason to re-subscribe — doing so
    // resets state, replays the stream, fires onDone again, and loops, flickering
    // the UI between "running" and "done".
    const { value, subscribeToRun } = makeWorkers((handlers) => {
      handlers.onEvent(event({ type: "command", command: "ls" }));
      handlers.onEvent(event({ type: "write", path: "out.txt" }));
      handlers.onDone(completed);
    });

    renderMonitor(value);
    expect(await screen.findByText(/Run complete/i)).toBeInTheDocument();
    await settle();

    // The regression re-subscribes repeatedly; the fix keeps it at one.
    expect(subscribeToRun).toHaveBeenCalledTimes(1);
    // The completion notice is stable and the streamed events remain in the feed.
    expect(screen.getByText(/Run complete/i)).toBeInTheDocument();
    // The feed is labelled, with the run id beneath it and a Follow toggle that
    // defaults to active (auto-following).
    expect(screen.getByText("Live Event Feed")).toBeInTheDocument();
    const follow = screen.getByRole("button", { name: "Follow" });
    expect(follow).toHaveAttribute("aria-pressed", "true");
    // The type shows once, in its own column; the detail no longer repeats it.
    expect(screen.getByText("COMMAND")).toBeInTheDocument();
    expect(screen.getByText("ls")).toBeInTheDocument();
    expect(screen.getByText("WRITE")).toBeInTheDocument();
    expect(screen.getByText("out.txt")).toBeInTheDocument();
    expect(screen.queryByText(/command: ls/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for events/i)).not.toBeInTheDocument();
  });

  it("toggles auto-follow when the Follow button is clicked", async () => {
    const { value } = makeWorkers((handlers) => {
      handlers.onEvent(event({ type: "command", command: "ls" }));
    });

    renderMonitor(value);
    const follow = await screen.findByRole("button", { name: "Follow" });

    // Defaults to following; each click flips the state.
    expect(follow).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(follow);
    expect(follow).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(follow);
    expect(follow).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the waiting message before any events arrive", () => {
    const { value } = makeWorkers(() => {
      // Never delivers — the run is still starting up.
    });

    renderMonitor(value);

    expect(screen.getByText(/Waiting for events/i)).toBeInTheDocument();
    expect(screen.queryByText(/Run complete/i)).not.toBeInTheDocument();
  });

  it("shows the live drawing for a single-sprite run as frames stream in", async () => {
    const { value } = makeWorkers((handlers) => {
      // A single sprite is always frame 0; two operations land in succession.
      handlers.onPreview?.(preview(0, 1, "fill_background"));
      handlers.onPreview?.(preview(0, 2, "fill_rect"));
    });

    renderMonitor(value);

    // The live drawing panel appears, showing the current sprite and its latest
    // operation count — and no per-frame rail, since a single sprite has one slot.
    expect(await screen.findByText("Live drawing")).toBeInTheDocument();
    // With no resolved case the lone slot is named after the default asset label.
    expect(screen.getByAltText("Sprite")).toBeInTheDocument();
    expect(screen.getByText(/2 operations · fill_rect/)).toBeInTheDocument();
    expect(screen.queryByText(/started$/)).not.toBeInTheDocument();
  });

  it("shows every frame and highlights the active one for a sprite sheet", async () => {
    const { value } = makeWorkers((handlers) => {
      handlers.onPreview?.(preview(0, 3));
      handlers.onPreview?.(preview(1, 1, "line"));
    });

    renderMonitor(value);

    // A sheet draws into more than frame 0, so the most-recently-drawn frame shows
    // large (frame 1, its caption) and a rail lists the status of every frame.
    expect(await screen.findByText("Live drawing")).toBeInTheDocument();
    // The large view follows the frame being drawn (frame 1) with its latest op.
    // The caption splits the slot name from the op detail, so match the detail.
    expect(screen.getByText(/1 operation · line/)).toBeInTheDocument();
    // The rail lists every started frame and each slot's op count.
    expect(screen.getByText("2/2 started")).toBeInTheDocument();
    expect(screen.getByText("Frame 0")).toBeInTheDocument();
    expect(screen.getByText("3 ops")).toBeInTheDocument();
  });

  it("surfaces a failed outcome without looping", async () => {
    const { value, subscribeToRun } = makeWorkers((handlers) => {
      handlers.onDone({ kind: "failed", message: "container exited 1" });
    });

    renderMonitor(value);
    expect(
      await screen.findByText(/Run failed: container exited 1/),
    ).toBeInTheDocument();
    await settle();

    expect(subscribeToRun).toHaveBeenCalledTimes(1);
  });
});
