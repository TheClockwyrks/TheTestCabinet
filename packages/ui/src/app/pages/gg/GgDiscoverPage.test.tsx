// Discover, end to end: the URL, the range, the request that goes out, and the legacy
// redirect that lands here.
//
// The state model is the thing worth pinning. The **URL carries the query as text**, never
// its compiled form — that is what keeps `now-30d` relative, so a link shared on Monday
// still means "the last thirty days" when it is opened on Friday — while the **compiled**
// query is derived and sent, so the backend needs no parser and no clock.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgQuery } from "@test-cabinet/run-record/gg-query";
import { BackendProvider, type BackendContextValue } from "../../../client/context";
import { GgDiscoverPage } from "./GgDiscoverPage";
import { GgLegacyRedirect } from "./discover/GgLegacyRedirect";

// The app chrome reads contexts irrelevant to the surface under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({ PromptHeader: () => null }));
vi.mock("../../../client/auth", () => ({ useAuth: () => ({ token: "t0" }) }));

const runGgQuery = vi.fn();
const getGgFields = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { runGgQuery, getGgFields },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

/** Reports the current location, so a redirect can be asserted on. */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Where />
        <Routes>
          <Route path="/gg/query" element={<GgDiscoverPage />} />
          <Route path="/gg/aggregate" element={<GgLegacyRedirect />} />
          <Route path="/gg/aggregate/results" element={<GgLegacyRedirect />} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

/** The last query the page compiled and sent. */
function lastQuery(): GgQuery {
  const call = runGgQuery.mock.calls[runGgQuery.mock.calls.length - 1];
  return call?.[0] as GgQuery;
}

const where = () => screen.getByTestId("where").textContent ?? "";

describe("GgDiscoverPage", () => {
  beforeEach(() => {
    runGgQuery.mockReset();
    getGgFields.mockReset();
    runGgQuery.mockResolvedValue({ totalRuns: 0, documents: [], truncated: false });
    getGgFields.mockResolvedValue({ documents: 0, fields: [] });
  });

  it("compiles the URL's text and sends the compiled form", async () => {
    renderAt("/gg/query?q=" + encodeURIComponent("state:hung or state:timed_out"));
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    // The wire form is the tree, not the text — the server never parses.
    expect(lastQuery().filter).toEqual({
      kind: "or",
      clauses: [
        { kind: "compare", field: "state", op: "eq", value: "hung" },
        { kind: "compare", field: "state", op: "eq", value: "timed_out" },
      ],
    });
  });

  it("scopes the query with the range, without putting it in the text", async () => {
    renderAt("/gg/query?q=" + encodeURIComponent("state:hung") + "&range=24h");
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    const filter = lastQuery().filter;
    expect(filter?.kind).toBe("and");
    const clauses = filter?.kind === "and" ? filter.clauses : [];
    // Resolved to absolute milliseconds here, so the backend needs no clock of its own.
    expect(clauses[0]).toMatchObject({ kind: "range", field: "started" });
    expect(typeof (clauses[0] as { from?: number }).from).toBe("number");
    expect(clauses[1]).toEqual({ kind: "compare", field: "state", op: "eq", value: "hung" });
  });

  it("sends the range alone when the query is empty", async () => {
    renderAt("/gg/query?range=7d");
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    expect(lastQuery().filter).toMatchObject({ kind: "range", field: "started" });
  });

  it("puts a submitted query in the URL, as text", async () => {
    renderAt("/gg/query");
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    const box = screen.getByRole("combobox", { name: "Query" });
    fireEvent.change(box, { target: { value: "state:hung" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(where()).toContain("q=state%3Ahung"));
  });

  it("renders the aggregated shape when the response carries columns", async () => {
    runGgQuery.mockResolvedValue({
      totalRuns: 3,
      buckets: [
        {
          key: [{ field: "preset", value: "planning" }],
          n: 3,
          values: [{ name: "count()", value: 3, contributing: 3 }],
        },
      ],
      columns: [{ name: "count()", func: "count" }],
      truncated: false,
    });
    renderAt("/gg/query?q=" + encodeURIComponent("| stats count() by preset"));
    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "planning" })).toBeInTheDocument(),
    );
    // The matched-run count is the denominator every figure on the page is read against,
    // so it is stated whatever shape the result came back in.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          (element.textContent ?? "").startsWith("3 runs matched"),
      ),
    ).toBeInTheDocument();
  });
});

describe("the legacy redirect", () => {
  beforeEach(() => {
    runGgQuery.mockReset().mockResolvedValue({ totalRuns: 0, buckets: [], columns: [], truncated: false });
    getGgFields.mockReset().mockResolvedValue({ documents: 0, fields: [] });
  });

  it("forwards an old results link to the equivalent TCQ query", async () => {
    // The best property of the surface this replaces was that the URL *was* the query, and
    // those URLs were pasted into issues. They redirect rather than 404.
    renderAt("/gg/aggregate/results?group=capabilityEnabled:compaction&metric=avg|score&chart=0");
    await waitFor(() => expect(where()).toContain("/gg/query"));
    // A space rides as `+` and the pipe is percent-encoded; what matters is that the
    // *text* crossed intact.
    expect(decodeURIComponent(where().replace(/\+/g, " "))).toContain(
      "q=| stats avg(score) by cap.compaction",
    );
  });

  it("forwards the builder's own address too", async () => {
    renderAt("/gg/aggregate?ff=terminalStatus|eq|hung");
    await waitFor(() => expect(where()).toContain("/gg/query"));
    expect(decodeURIComponent(where())).toContain("q=state:hung");
  });

  it("runs the transcoded query rather than only showing it", async () => {
    renderAt("/gg/aggregate/results?ff=terminalStatus|eq|hung");
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    expect(lastQuery().filter).toEqual({
      kind: "compare",
      field: "state",
      op: "eq",
      value: "hung",
    });
  });
});
