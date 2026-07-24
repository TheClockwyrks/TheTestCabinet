import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import type { WorkerClient } from "../../../client/clients";
import { GgAggregatePage } from "./GgAggregatePage";

// Stub the page chrome and data hooks, mirroring the other page tests — the logic
// under test is the query builder and the URL it runs a query by navigating to,
// not the app shell or catalog.
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

const workersValue = {
  workers: [],
  activeId: "local",
  active: {
    id: "local",
    label: "Local",
    url: null,
    local: true,
    client: {} as unknown as WorkerClient,
    identity: null,
    backendMatch: "unknown",
  },
  setActive: () => {},
  addWorker: () => {},
  removeWorker: () => {},
} as unknown as WorkersContextValue;

// Reports the location the builder navigated to, so a test can assert the query it
// encoded into the results URL.
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

function renderPage(initialEntry = "/gg/aggregate") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BackendProvider value={backendValue}>
        <WorkersProvider value={workersValue}>
          <Routes>
            <Route path="/gg/aggregate" element={<GgAggregatePage />} />
            <Route path="/gg/aggregate/results" element={<LocationProbe />} />
          </Routes>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

describe("GgAggregatePage", () => {
  it("renders the query builder", () => {
    renderPage();
    expect(screen.getByText("Facet filters")).toBeInTheDocument();
    expect(screen.getByText("Metric filters")).toBeInTheDocument();
    expect(screen.getByText("Group by")).toBeInTheDocument();
    expect(screen.getByText("Metrics")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run query" }),
    ).toBeInTheDocument();
  });

  it("runs a query by navigating to its own URL, carrying the whole query", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Run query" }));

    // The default query — gg's canonical ablation question — encodes into the
    // results URL, so the answer is a page that can be shared.
    const location = screen.getByTestId("location").textContent ?? "";
    const [path, search] = location.split("?");
    expect(path).toBe("/gg/aggregate/results");
    const params = new URLSearchParams(search);
    expect(params.getAll("group")).toEqual(["capabilityEnabled:compaction"]);
    expect(params.getAll("metric")).toEqual(["avg|score"]);
  });

  it("opens on the query its own URL carries, so a revised query keeps its clauses", () => {
    renderPage(
      "/gg/aggregate?case=carom&group=slotModel:primary" +
        "&metric=sum|summary:issues_reopened&ff=preset|eq|full",
    );

    // Every clause of the incoming query is loaded back into the builder…
    expect(screen.getByDisplayValue("carom")).toBeInTheDocument();
    expect(screen.getByLabelText("slot")).toHaveValue("primary");
    expect(screen.getByLabelText("aggregation")).toHaveValue("sum");
    expect(screen.getByLabelText("summary field")).toHaveValue(
      "issues_reopened",
    );

    // …and running it again reproduces the same query.
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    const search = (screen.getByTestId("location").textContent ?? "").split(
      "?",
    )[1];
    const params = new URLSearchParams(search);
    expect(params.get("case")).toBe("carom");
    expect(params.getAll("group")).toEqual(["slotModel:primary"]);
    expect(params.getAll("metric")).toEqual(["sum|summary:issues_reopened"]);
    expect(params.getAll("ff")).toEqual(["preset|eq|full"]);
  });
});
