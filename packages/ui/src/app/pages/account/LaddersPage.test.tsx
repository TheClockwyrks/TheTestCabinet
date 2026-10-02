import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  LadderDispatchSummary,
  LadderSummary,
  SlotCounts,
} from "@clockwyrks/run-record/ladders";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { LaddersPage, ladderCardView } from "./LaddersPage";

vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: ({ titleActions }: { titleActions?: ReactNode }) => (
    <>{titleActions}</>
  ),
}));
vi.mock("../../components/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: async () => true, alert: async () => {} }),
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

function slots(over: Partial<SlotCounts> = {}): SlotCounts {
  return {
    total: 12,
    running: 0,
    blocked: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    ...over,
  };
}

function summary(
  dispatch: LadderDispatchSummary | null,
  over: Partial<LadderSummary> = {},
): LadderSummary {
  return {
    id: "l1",
    name: "Easy to hard",
    rungs: 4,
    runsPerCell: 2,
    climbers: 3,
    dispatch,
    ...over,
  };
}

// Worked example A: 3 climbers × 4 rungs at 2 runs/rung (rung 4 asks 3), so 27 runs.
// A passed rungs 1–2 and has one of rung 3's runs counted; B failed rung 1 and skips
// the rest; C has rung 1's two runs in flight.
const A = summary({
  id: "d1",
  status: "running",
  startedAt: "2026-10-02T10:00:00Z",
  slots: slots({ running: 2, passed: 2, failed: 1, skipped: 3, pending: 4 }),
  runs: { total: 27, done: 14, inFlight: 3 },
});

// Worked example C: A, then Stop without cancelling running runs.
const C = summary({
  id: "d1",
  status: "stopped",
  startedAt: "2026-10-02T10:00:00Z",
  endedAt: "2026-10-02T11:00:00Z",
  slots: slots({ passed: 2, failed: 1, skipped: 9 }),
  runs: { total: 27, done: 24, inFlight: 3 },
});

// The card is a configuration headline and the latest dispatch's totals: a bar of runs
// done (a full bar means nothing is left to execute) and rung-slot totals under it,
// never a per-climber breakdown.
describe("ladderCardView", () => {
  it("describes the configuration only", () => {
    expect(ladderCardView(A).description).toBe(
      "4 rungs · 2 runs/rung · 3 climbers",
    );
    expect(
      ladderCardView(summary(null, { rungs: 1, climbers: 1 })).description,
    ).toBe("1 rung · 2 runs/rung · 1 climber");
    expect(
      ladderCardView(summary(null, { rungs: 1, climbers: 1, runsPerCell: 1 }))
        .description,
    ).toBe("1 rung · 1 run/rung · 1 climber");
  });

  it("reads a ladder never run as Not run yet with an empty bar and zeros", () => {
    const view = ladderCardView(summary(null));
    expect(view.badge).toBe("Not run yet");
    expect(view.donePct).toBe(0);
    expect(view.counts).toEqual({
      running: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("draws a running dispatch's bar from runs done of the total", () => {
    const view = ladderCardView(A);
    expect(view.badge).toBe("Running");
    expect(view.donePct).toBeCloseTo((14 / 27) * 100);
    expect(view.counts).toEqual({
      running: 2,
      passed: 2,
      failed: 1,
      skipped: 3,
    });
    expect(view.title).toBe("14 of 27 runs done · 3 in flight · 4 pending");
  });

  it("counts a stopped dispatch's never-run slots as skipped", () => {
    const view = ladderCardView(C);
    expect(view.badge).toBe("Stopped");
    expect(view.counts.skipped).toBe(9);
    expect(view.counts.running).toBe(0);
    expect(view.donePct).toBeCloseTo((24 / 27) * 100);
  });

  it("reads a finished dispatch as a full bar", () => {
    const view = ladderCardView(
      summary({
        id: "d1",
        status: "finished",
        startedAt: "2026-10-02T10:00:00Z",
        endedAt: "2026-10-02T12:00:00Z",
        slots: slots({ passed: 5, failed: 2, skipped: 5 }),
        runs: { total: 27, done: 27, inFlight: 0 },
      }),
    );
    expect(view.badge).toBe("Finished");
    expect(view.donePct).toBe(100);
  });

  it("folds blocked slots into running and calls them out on hover", () => {
    const view = ladderCardView(
      summary({
        id: "d1",
        status: "running",
        startedAt: "2026-10-02T10:00:00Z",
        slots: slots({ running: 1, blocked: 1 }),
        runs: { total: 27, done: 0, inFlight: 1 },
      }),
    );
    expect(view.counts.running).toBe(2);
    expect(view.title).toMatch(/· 1 blocked/);
  });
});

function renderList(list: LadderSummary[]) {
  const value = {
    client: { getLaddersSummary: vi.fn().mockResolvedValue(list) },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
  return render(
    <MemoryRouter>
      <BackendProvider value={value}>
        <LaddersPage />
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("LaddersPage", () => {
  it("shows the configuration, the status, the bar and the slot totals", async () => {
    const { container } = renderList([A]);
    await waitFor(() => expect(screen.getByText("Easy to hard")).toBeTruthy());
    expect(screen.getByText("4 rungs · 2 runs/rung · 3 climbers")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("52");
    expect(bar.getAttribute("title")).toBe(
      "14 of 27 runs done · 3 in flight · 4 pending",
    );
    expect(container.textContent).toMatch(
      /2 running · 2 passed · 1 failed · 3 skipped/,
    );
    // High level only: nothing about reviews, nothing per climber.
    const card = screen.getByText("Easy to hard").parentElement!;
    expect(card.textContent).not.toMatch(/review/i);
    expect(card.textContent).not.toMatch(/opus|claude/i);
  });

  it("keeps the same slots for a ladder never run", async () => {
    const { container } = renderList([summary(null)]);
    await waitFor(() => expect(screen.getByText("Not run yet")).toBeTruthy());
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "0",
    );
    expect(container.textContent).toMatch(
      /0 running · 0 passed · 0 failed · 0 skipped/,
    );
  });

  it("says what a ladder is and how to start one when there are none", async () => {
    renderList([]);
    await waitFor(() =>
      expect(screen.getByText(/You have no ladders yet/)).toBeTruthy(),
    );
    expect(screen.getByText(/Press Run ladder/)).toBeTruthy();
  });
});
