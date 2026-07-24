import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { GgAggregateResponse } from "@test-cabinet/run-record/gg-aggregate";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import type { WorkerClient } from "../../../client/clients";
import { GgAggregateResultsPage } from "./GgAggregateResultsPage";

// Stub the chrome and the chart widget (Plot needs layout the test DOM does not
// provide); what is under test is the query the URL stands for and the buckets it
// renders.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: null }),
}));
vi.mock("@test-cabinet/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChartWidget: ({ title }: { title: string }) => <div>chart:{title}</div>,
}));

const backendValue: BackendContextValue = {
  client: null,
  identity: null,
  status: "unconfigured",
  error: null,
  url: null,
  setUrl: () => {},
};

// Two buckets (compaction off vs on), each with an aggregated metric and a
// terminal-state mix. The second bucket's metric is absent so the "never show a
// misleading 0" path is exercised.
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

// The doc's canonical study, as a shared link: group by whether compaction was on,
// average the context-overflow rate, charting that metric.
const SEARCH =
  "?group=capabilityEnabled:compaction" +
  "&metric=avg|summary:ran_out_of_context&chart=0";

function renderPage(
  aggregate: WorkerClient["aggregateGgRuns"],
  search = SEARCH,
) {
  return render(
    <MemoryRouter initialEntries={[`/gg/aggregate/results${search}`]}>
      <BackendProvider value={backendValue}>
        <WorkersProvider value={workersValue(aggregate)}>
          <Routes>
            <Route
              path="/gg/aggregate/results"
              element={<GgAggregateResultsPage />}
            />
          </Routes>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgAggregateResultsPage", () => {
  it("runs the query its URL carries and renders the buckets", async () => {
    const aggregate = vi.fn().mockResolvedValue(RESPONSE);
    renderPage(aggregate);

    // The query posted is the one the URL encoded — no builder involved.
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

    // The chart is the selected metric, per bucket.
    expect(
      screen.getByText(/chart:avg Ran out of context .* per bucket/i),
    ).toBeInTheDocument();
  });

  it("leads back to the builder with the same query loaded", async () => {
    renderPage(vi.fn().mockResolvedValue(RESPONSE));
    const back = await screen.findByRole("link", { name: /Edit query/i });
    const href = back.getAttribute("href") ?? "";
    const [path, search] = href.split("?");
    expect(path).toBe("/gg/aggregate");
    // Every clause travels back, so the builder reopens on this same query rather
    // than on a blank one.
    const params = new URLSearchParams(search);
    expect(params.getAll("group")).toEqual(["capabilityEnabled:compaction"]);
    expect(params.getAll("metric")).toEqual(["avg|summary:ran_out_of_context"]);
    expect(params.get("chart")).toBe("0");
  });

  it("shows an empty-state message when no runs match", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      totalRuns: 0,
      buckets: [],
    } satisfies GgAggregateResponse);
    renderPage(aggregate);
    expect(await screen.findByText(/No gg runs matched/i)).toBeInTheDocument();
  });
});
