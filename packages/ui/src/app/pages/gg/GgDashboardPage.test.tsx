import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { GgAggregateResponse } from "@test-cabinet/run-record/gg-aggregate";
import {
  WorkersProvider,
  type WorkersContextValue,
} from "../../../client/context";
import type { WorkerClient } from "../../../client/clients";
import { GgDashboardPage } from "./GgDashboardPage";

// Only the dashboard's own queries and figures are under test; stub the chrome and
// the chart widget (Plot needs layout the test DOM does not provide). The ring
// widget is left real — it is plain SVG, and the terminal-state mix it draws is one
// of the figures under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));
vi.mock("@test-cabinet/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChartWidget: ({ title }: { title: string }) => <div>chart:{title}</div>,
}));

// The grand-total response: one ungrouped bucket whose metrics come back in the
// order the dashboard requested them.
const OVERVIEW: GgAggregateResponse = {
  totalRuns: 12,
  buckets: [
    {
      key: [],
      n: 12,
      metrics: [
        { metric: { kind: "score" }, agg: "avg", value: 7.5, contributing: 12 },
        { metric: { kind: "cost" }, agg: "avg", value: 1.25, contributing: 12 },
        {
          metric: { kind: "runTimeSeconds" },
          agg: "avg",
          value: 120,
          contributing: 12,
        },
        {
          metric: { kind: "totalTokens" },
          agg: "avg",
          value: 250_000,
          contributing: 12,
        },
        {
          metric: { kind: "summary", field: "ran_out_of_context" },
          agg: "avg",
          value: 0.25,
          contributing: 12,
        },
        {
          metric: { kind: "summary", field: "agents_spawned" },
          agg: "avg",
          value: 3,
          contributing: 12,
        },
        {
          metric: { kind: "summary", field: "compactions" },
          agg: "avg",
          value: 1.5,
          contributing: 12,
        },
      ],
      stateDistribution: [
        { state: "completed", count: 10 },
        { state: "hung", count: 2 },
      ],
    },
  ],
} as unknown as GgAggregateResponse;

// A grouped response: two configurations, each with an average score.
const BY_PRESET: GgAggregateResponse = {
  totalRuns: 12,
  buckets: [
    {
      key: [{ facet: { kind: "preset" }, value: "minimal" }],
      n: 7,
      metrics: [
        { metric: { kind: "score" }, agg: "avg", value: 6, contributing: 7 },
      ],
      stateDistribution: [],
    },
    {
      key: [{ facet: { kind: "preset" }, value: "full" }],
      n: 5,
      metrics: [
        { metric: { kind: "score" }, agg: "avg", value: 9, contributing: 5 },
      ],
      stateDistribution: [],
    },
  ],
} as unknown as GgAggregateResponse;

function renderPage(aggregate: WorkerClient["aggregateGgRuns"]) {
  const workers = {
    workers: [],
    activeId: "local",
    active: {
      id: "local",
      label: "Local",
      url: null,
      local: true,
      client: { aggregateGgRuns: aggregate } as unknown as WorkerClient,
      identity: null,
      backendMatch: "unknown",
    },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
  return render(
    <MemoryRouter initialEntries={["/gg"]}>
      <WorkersProvider value={workers}>
        <GgDashboardPage />
      </WorkersProvider>
    </MemoryRouter>,
  );
}

describe("GgDashboardPage", () => {
  it("shows the cross-run headline figures, how runs ended, and the breakdowns", async () => {
    // The dashboard issues one ungrouped query for the headline figures, then one
    // grouped query per breakdown — resolved here in that order.
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce(OVERVIEW)
      .mockResolvedValueOnce(BY_PRESET)
      .mockResolvedValueOnce(BY_PRESET);
    renderPage(aggregate);

    // The run count is a headline tile — and only that, never also a line of prose
    // above the tiles saying the same thing.
    const countTile = (await screen.findByText("gg runs recorded")).closest(
      "div",
    )!;
    expect(within(countTile).getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("12 gg runs recorded")).not.toBeInTheDocument();

    // Headline tiles read straight off the grand-total bucket's metrics, in request
    // order: score, cost, runtime, tokens, then the summary fields.
    expect(screen.getByText("7.5")).toBeInTheDocument();
    expect(screen.getByText("$1.25")).toBeInTheDocument();
    // A boolean summary field averages to a rate, shown as a percentage.
    expect(screen.getByText("25%")).toBeInTheDocument();

    // The terminal-state mix is a ring, one slice (and legend entry) per state.
    expect(
      screen.getByRole("img", { name: /How they ended/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("10 · 83%")).toBeInTheDocument();
    expect(screen.getByText("2 · 17%")).toBeInTheDocument();

    // Both breakdowns render once their grouped query resolves.
    await waitFor(() =>
      expect(screen.getByText("chart:By configuration")).toBeInTheDocument(),
    );
    expect(screen.getByText("chart:By primary model")).toBeInTheDocument();
    expect(aggregate).toHaveBeenCalledTimes(3);
  });
});
