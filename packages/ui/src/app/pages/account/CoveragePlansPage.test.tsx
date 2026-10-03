import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { CoveragePlanSummary } from "@clockwyrks/run-record/coverage";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { CoveragePlansPage, planProgress } from "./CoveragePlansPage";

// The page's app chrome reads contexts none of these tests are about; stub it as the
// other account page tests do.
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
// A plan belongs to an account, so a token is what makes the list exist at all.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

// A plan card's bar tracks runs done (the runs that count, capped at each cell's
// target), the text beside it is only the cells filled, and the run detail rides in
// the bar's hover text.

function summary(over: Partial<CoveragePlanSummary> = {}): CoveragePlanSummary {
  return {
    id: "p1",
    name: "v0.6.x sweep",
    runsPerCell: 3,
    cellsFilled: 0,
    cellsTotal: 0,
    cellsBlocked: 0,
    runsDone: 0,
    runsTotal: 0,
    runsInFlight: 0,
    runsMissing: 0,
    runsUnreviewed: 0,
    filling: false,
    ...over,
  };
}

// 2 cases × 4 combinations at 3 runs/cell: five cells filled (one over target),
// two with one counted run and two in flight, one blocked with nothing.
const WORKED = summary({
  cellsFilled: 5,
  cellsTotal: 8,
  cellsBlocked: 1,
  runsDone: 17,
  runsTotal: 24,
  runsInFlight: 4,
  runsMissing: 3,
  runsUnreviewed: 6,
  filling: true,
});

describe("planProgress", () => {
  it("draws the bar from runs done of the total", () => {
    const progress = planProgress(WORKED);
    expect(progress.runsDone).toBe(17);
    expect(progress.runsTotal).toBe(24);
    expect(progress.donePct).toBeCloseTo(70.83, 1);
  });

  it("puts the run detail in the hover text, blocked cells only when any", () => {
    expect(planProgress(WORKED).title).toBe(
      "17 of 24 runs done · 4 launched and in flight · 3 to launch · 1 blocked",
    );
    expect(planProgress({ ...WORKED, cellsBlocked: 0 }).title).toBe(
      "17 of 24 runs done · 4 launched and in flight · 3 to launch",
    );
  });

  it("does not divide by zero on an empty plan", () => {
    expect(planProgress(summary()).donePct).toBe(0);
  });
});

// This is the screen an operator arriving to schedule gg runs reads first, so the
// empty state has to name what a plan actually crosses its cases with: combinations,
// which take two shapes.
describe("CoveragePlansPage", () => {
  it("names combinations, not harness/model pairs, on the empty state", async () => {
    const value = {
      client: { getCoveragePlansSummary: vi.fn().mockResolvedValue([]) },
      identity: null,
      status: "ready",
      error: null,
      url: null,
      setUrl: () => {},
    } as unknown as BackendContextValue;
    render(
      <MemoryRouter>
        <BackendProvider value={value}>
          <CoveragePlansPage />
        </BackendProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/the combinations you want covered/),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/gg\s+configuration/)).toBeTruthy();
    expect(screen.queryByText(/harness\/model/)).toBeNull();
  });

  it("shows only the cells filled beside the bar, and nothing about reviews", async () => {
    const value = {
      client: { getCoveragePlansSummary: vi.fn().mockResolvedValue([WORKED]) },
      identity: null,
      status: "ready",
      error: null,
      url: null,
      setUrl: () => {},
    } as unknown as BackendContextValue;
    const { container } = render(
      <MemoryRouter>
        <BackendProvider value={value}>
          <CoveragePlansPage />
        </BackendProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("5/8 cells")).toBeTruthy());
    expect(screen.getByText("3 runs/cell")).toBeTruthy();
    expect(
      container.querySelector(
        '[title="17 of 24 runs done · 4 launched and in flight · 3 to launch · 1 blocked"]',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/waiting on you|top-up|missing/i);
  });
});
