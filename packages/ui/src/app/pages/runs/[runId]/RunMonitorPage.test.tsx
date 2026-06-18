import { act, render, screen } from "@testing-library/react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { WorkersProvider } from "../../../../client/context";
import type { WorkersContextValue } from "../../../../client/context";
import type { WorkerClient } from "../../../../client/clients";
import type { HarnessEvent, RunOutcome } from "../../../../client/types";
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

const RUN_ID = "run-123";

type Handlers = Parameters<WorkerClient["subscribeToRun"]>[1];

function event(fields: Partial<HarnessEvent> & { type: string }): HarnessEvent {
  return { timestamp: "2026-06-18T00:00:00Z", ...fields };
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
    // The type shows once, in its own column; the detail no longer repeats it.
    expect(screen.getByText("COMMAND")).toBeInTheDocument();
    expect(screen.getByText("ls")).toBeInTheDocument();
    expect(screen.getByText("WRITE")).toBeInTheDocument();
    expect(screen.getByText("out.txt")).toBeInTheDocument();
    expect(screen.queryByText(/command: ls/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for events/i)).not.toBeInTheDocument();
  });

  it("shows the waiting message before any events arrive", () => {
    const { value } = makeWorkers(() => {
      // Never delivers — the run is still starting up.
    });

    renderMonitor(value);

    expect(screen.getByText(/Waiting for events/i)).toBeInTheDocument();
    expect(screen.queryByText(/Run complete/i)).not.toBeInTheDocument();
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
