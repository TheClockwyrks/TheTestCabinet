import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import type { WorkerClient } from "../../../client/clients";
import type { GgAggregateResponse } from "@test-cabinet/run-record/gg-aggregate";
import { GgAggregatePage } from "./GgAggregatePage";

// Stub the page chrome and data hooks, mirroring the other page tests — the logic
// under test is the query builder + result rendering, not the app shell or catalog.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// A local worker needs no sign-in, so a signed-out stub still lets the query run.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: null }),
}));
vi.mock("../../data/useTestCases", () => ({
  useTestCases: () => ({
    testCases: [{ slug: "carom", name: "Carom" }],
    status: "ready",
  }),
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));

const backendValue: BackendContextValue = {
  client: null,
  identity: null,
  status: "unconfigured",
  error: null,
  url: null,
  setUrl: () => {},
};

// A mocked aggregate response: two buckets (compaction off vs on), each with an
// aggregated metric and a terminal-state mix. The second bucket's metric is absent
// so the "never show a misleading 0" path is exercised.
const RESPONSE: GgAggregateResponse = {
  totalRuns: 7,
  buckets: [
    {
      key: [
        {
          facet: { kind: "capabilityEnabled", capability: "compaction" },
          value: "false",
        },
      ],
      n: 4,
      metrics: [
        {
          metric: { kind: "summary", field: "ran_out_of_context" },
          agg: "avg",
          value: 0.75,
          contributing: 4,
        },
      ],
      stateDistribution: [
        { state: "completed", count: 3 },
        { state: "timed_out", count: 1 },
      ],
    },
    {
      key: [
        {
          facet: { kind: "capabilityEnabled", capability: "compaction" },
          value: "true",
        },
      ],
      n: 3,
      metrics: [
        {
          metric: { kind: "summary", field: "ran_out_of_context" },
          agg: "avg",
          value: undefined,
          contributing: 0,
        },
      ],
      stateDistribution: [{ state: "completed", count: 3 }],
    },
  ],
};

function workersValue(
  aggregate: WorkerClient["aggregateGgRuns"],
): WorkersContextValue {
  const client = { aggregateGgRuns: aggregate } as unknown as WorkerClient;
  return {
    workers: [],
    activeId: "local",
    active: {
      id: "local",
      label: "Local",
      url: null,
      local: true,
      client,
      identity: null,
      backendMatch: "unknown",
    },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
}

function renderPage(aggregate: WorkerClient["aggregateGgRuns"]) {
  return render(
    <MemoryRouter initialEntries={["/gg/aggregate"]}>
      <BackendProvider value={backendValue}>
        <WorkersProvider value={workersValue(aggregate)}>
          <Routes>
            <Route path="/gg/aggregate" element={<GgAggregatePage />} />
          </Routes>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgAggregatePage", () => {
  it("renders the query builder", () => {
    renderPage(vi.fn());
    expect(screen.getByText("Facet filters")).toBeInTheDocument();
    expect(screen.getByText("Metric filters")).toBeInTheDocument();
    expect(screen.getByText("Group by")).toBeInTheDocument();
    expect(screen.getByText("Metrics")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run query" }),
    ).toBeInTheDocument();
  });

  it("builds a query from an example and renders the response as a table + chart", async () => {
    const aggregate = vi.fn().mockResolvedValue(RESPONSE);
    renderPage(aggregate);

    // A one-click example study populates the builder with a group-by + metric.
    fireEvent.click(
      screen.getByRole("button", {
        name: /Compaction on\/off .* context-overflow rate/i,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Run query" }));

    // The query posted groups by the compaction-enabled facet with the
    // context-overflow-rate metric — the doc's canonical study.
    await waitFor(() => expect(aggregate).toHaveBeenCalledTimes(1));
    const query = aggregate.mock.calls[0]![0];
    expect(query.groupBy).toEqual([
      { kind: "capabilityEnabled", capability: "compaction" },
    ]);
    expect(query.metrics).toEqual([
      { metric: { kind: "summary", field: "ran_out_of_context" }, agg: "avg" },
    ]);

    // The response renders: the total, both bucket rows, the present metric value,
    // and — crucially — the absent metric as an em dash, not a 0.
    await screen.findByText(/7 gg runs matched/i);
    const table = screen.getByRole("table");
    expect(within(table).getByText("0.75")).toBeInTheDocument();
    expect(within(table).getByText("—")).toBeInTheDocument();
    // The bucket keys (compaction false/true) label the rows.
    expect(within(table).getByText("false")).toBeInTheDocument();
    expect(within(table).getByText("true")).toBeInTheDocument();

    // The chart mounts as an accessible figure.
    expect(
      screen.getByRole("img", { name: /per bucket/i }),
    ).toBeInTheDocument();
  });

  it("shows an empty-state message when no runs match", async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValue({
        totalRuns: 0,
        buckets: [],
      } satisfies GgAggregateResponse);
    renderPage(aggregate);
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    expect(await screen.findByText(/No gg runs matched/i)).toBeInTheDocument();
  });
});
