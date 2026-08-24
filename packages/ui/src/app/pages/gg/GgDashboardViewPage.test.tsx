// A dashboard, rendered — and the one property the whole surface exists to have.
//
// **Eight panels, one request.** Asserted by *request count*, not by "the board rendered":
// a board that draws correctly while issuing eight requests is the failure this test
// exists to catch. The batch is what makes every panel of a board report the same corpus —
// the backend's document index reconciles on a timer, so eight separate scans can
// legitimately answer from two different corpora, which reads as a data bug rather than as
// a stale cache.
//
// The other assertions are the consequences of the board owning the range: one picker
// scopes every panel, the built-in overview needs no fetch at all, and a broken panel is
// reported in place rather than dropped (render order is the only binding between a panel
// and its answer in a batched response).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GgQueryBatch,
  GgQueryResponse,
} from "@test-cabinet/run-record/gg-query";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GgDashboardViewPage } from "./GgDashboardViewPage";
import { OVERVIEW_DASHBOARD } from "./dashboards/overviewDashboard";

// The app chrome reads contexts irrelevant to the surface under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  // The header's chrome is not what these tests are about; its slots are, because a
  // page's own actions live in them. Stub the chrome and pass the slots through, so a
  // control that moves into the header does not silently vanish from the test.
  PromptHeader: ({
    titleActions,
    actions,
  }: {
    titleActions?: ReactNode;
    actions?: ReactNode;
  }) => (
    <>
      {titleActions}
      {actions}
    </>
  ),
}));
vi.mock("../../../client/auth", () => ({ useAuth: () => ({ token: "t0" }) }));

const runGgQueryBatch = vi.fn();
const getGgDashboard = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { runGgQueryBatch, getGgDashboard },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

/** An answer shaped like a one-column aggregation, so a panel renders a real figure. */
function bucketed(count: number): GgQueryResponse {
  return {
    totalRuns: count,
    truncated: false,
    columns: [{ name: "count", func: "count" }],
    buckets: [
      {
        key: [{ field: "model", value: "mock/echo" }],
        n: count,
        values: [{ kind: "number", value: count }],
      },
    ],
  } as unknown as GgQueryResponse;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route
            path="/gg/dashboards/:dashboardId"
            element={<GgDashboardViewPage />}
          />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

/** The last batch body that went out. */
function lastBatch(): GgQueryBatch {
  const call =
    runGgQueryBatch.mock.calls[runGgQueryBatch.mock.calls.length - 1];
  return call?.[0] as GgQueryBatch;
}

describe("GgDashboardViewPage", () => {
  beforeEach(() => {
    runGgQueryBatch.mockReset();
    getGgDashboard.mockReset();
    runGgQueryBatch.mockImplementation((batch: GgQueryBatch) =>
      Promise.resolve({
        results: batch.queries.map((_, i) => bucketed(i + 1)),
      }),
    );
  });

  it("renders the overview's eight panels from exactly one batch request", async () => {
    renderAt("/gg/dashboards/overview");
    await waitFor(() => expect(runGgQueryBatch).toHaveBeenCalled());

    // The property, stated three ways: one request, carrying every panel, and no
    // single-query call alongside it.
    expect(runGgQueryBatch).toHaveBeenCalledTimes(1);
    expect(OVERVIEW_DASHBOARD.panels).toHaveLength(8);
    expect(lastBatch().queries).toHaveLength(8);

    // And the board really did draw all eight, in order.
    for (const panel of OVERVIEW_DASHBOARD.panels) {
      expect(
        screen.getByRole("heading", { name: panel.title }),
      ).toBeInTheDocument();
    }
  });

  it("resolves the built-in overview without fetching a board", async () => {
    // It is defined as ordinary query text in code, not stored — so it works on a
    // deployment where the account has saved nothing at all.
    renderAt("/gg/dashboards/overview");
    await waitFor(() => expect(runGgQueryBatch).toHaveBeenCalled());
    expect(getGgDashboard).not.toHaveBeenCalled();
  });

  it("scopes every panel with the board's one range, and still sends one request", async () => {
    renderAt("/gg/dashboards/overview");
    await waitFor(() => expect(runGgQueryBatch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Time range"), {
      target: { value: "24h" },
    });
    await waitFor(() => expect(runGgQueryBatch).toHaveBeenCalledTimes(2));

    const queries = lastBatch().queries;
    expect(queries).toHaveLength(8);
    // Every panel carries the range bound — none of them opts out, because a panel has
    // no picker of its own.
    for (const query of queries) {
      expect(JSON.stringify(query.filter)).toContain('"field":"started"');
    }
    // And the histogram panel was retuned to the range's hourly interval rather than
    // keeping the `1d` its text spells.
    expect(JSON.stringify(queries[0]?.stats?.groupBy)).toContain(
      '"unit":"hour"',
    );
  });

  it("loads a stored board by id and batches its panels too", async () => {
    getGgDashboard.mockResolvedValue({
      id: "d1",
      name: "capability sweep",
      description: "",
      rangeId: "all",
      updatedAt: "2026-08-01T00:00:00Z",
      panels: [
        { title: "By model", query: "| stats count() by model", width: 6 },
        { title: "By preset", query: "| stats count() by preset", width: 6 },
      ],
    });
    renderAt("/gg/dashboards/d1");
    await waitFor(() => expect(runGgQueryBatch).toHaveBeenCalled());
    expect(getGgDashboard).toHaveBeenCalledWith("d1", "t0");
    expect(runGgQueryBatch).toHaveBeenCalledTimes(1);
    expect(lastBatch().queries).toHaveLength(2);
  });

  it("reports a panel that failed to parse rather than dropping it", async () => {
    getGgDashboard.mockResolvedValue({
      id: "d2",
      name: "broken",
      description: "",
      rangeId: "all",
      updatedAt: "2026-08-01T00:00:00Z",
      panels: [
        { title: "Fine", query: "| stats count() by model", width: 6 },
        { title: "Broken", query: "| stats", width: 6 },
      ],
    });
    renderAt("/gg/dashboards/d2");
    await waitFor(() => expect(runGgQueryBatch).toHaveBeenCalled());

    // The broken panel keeps its slot — render order is what binds a panel to its
    // answer — and says what is wrong instead of rendering an empty card, which would
    // be indistinguishable from a query that legitimately matched nothing.
    expect(screen.getByRole("heading", { name: "Broken" })).toBeInTheDocument();
    expect(lastBatch().queries).toHaveLength(2);
    expect(screen.getByText(/Expected/i)).toBeInTheDocument();
  });
});
